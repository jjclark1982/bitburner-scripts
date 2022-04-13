import { drawTable } from "lib/box-drawing";

// TODO: define separate ServerPoolInfo and ServerPoolBackend classes,
// to support different levels of RAM use for imports

export async function deploy(params={}) {
    const {ns, script, threads, args, allowSplit, requireAll} = params;
    const serverPool = new ServerPool({ns, scriptRam: script, logLevel:2});
    return await serverPool.deploy(params);
}

export function serverPool(ns, scriptRam) {
    return new ServerPool({ns, scriptRam});
}

const FLAGS = [
    ["help", false],
    ["threads", 1]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return [...data.scripts, ...data.servers];
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");
    ns.clearLog();

    const flags = {
        ns: ns,
        threads: 1
    };
    if (ns.args.includes("--help")) {
        ns.tprint([
            "Run a script on any available server, splitting threads into different processes if needed.",
            '',
            `Usage: run ${ns.getScriptName()} [--threads n] script [args...]`,
            '',
            `Exmaple: run ${ns.getScriptName()} --threads 1000 /batch/grow.js ecorp`,
            ' '
        ]);
        return;
    }

    if (ns.args[0] == '--threads') {
        flags.threads = ns.args[1];
        ns.args = ns.args.slice(2);
    }
    if (ns.args.length > 0) {
        flags.script = ns.args.shift();
        flags.args = ns.args;
    }
    const serverPool = new ServerPool({ns, scriptRam:flags.script || 2.0, logLevel:2});
    ns.print(serverPool.report());

    if (flags.script) {
        await serverPool.deploy({...flags, allowSplit:true});
    }
    else {
        ns.tail();
        await ns.asleep(100);
    }
}

export class ServerPool {
    constructor({ns, scriptRam, reservedRam, logLevel}) {
        this.ns = ns;
        if (typeof(scriptRam) === "string") {
            scriptRam = ns.getScriptRam(scriptRam, 'home');
        }
        // smallest possible script
        this.scriptRam = scriptRam || 1.6;
        // By default, reserve up to 1 TB of RAM on home and hacknet servers
        this.reservedRam = reservedRam || 1024;

        this.logLevel = logLevel || 0;

        // compute most properties on first pass as this is usually only called once per deploy
        const servers = {};
        this.totalServers = 0;
        this.totalRam = 0;
        this.totalUsedRam = 0;
        this.totalThreadsAvailable = 0;
        this.largestServer = null;
        for (const hostname of getAllHosts(ns)) {
            const server = new CloudServer({...this, hostname});
            if (!server.canRunScripts()) {
                continue;
            }
            this.totalServers += 1;
            this.totalRam += server.maxRam;
            this.totalUsedRam += server.ramUsed;
            this.totalThreadsAvailable += server.availableThreads;
            if (server.availableThreads > (this.largestServer?.availableThreads || 0)) {
                this.largestServer = server;
            }
            servers[hostname] = server;
        }
        this.maxThreadsAvailable = this.largestServer?.availableThreads || 0;
        this.servers = servers;
        this.smallestServers = Object.values(servers).sort((a,b)=>(
            a.maxRam - b.maxRam
        ));
    }

    [Symbol.iterator]() {
        return this.smallestServers[Symbol.iterator]();
    }

    getServer(hostname) {
        return this.servers[hostname];
    }

    smallestServersWithThreads(threads=1, exclude={}) {
        return this.smallestServers.filter((server)=>(
            !(server.hostname in exclude) &&
            server.availableThreads >= threads
        )).sort((a,b)=>(
            a.availableThreads - b.availableThreads
        ));
    }

    smallestServerWithThreads(threads) {
        return this.smallestServersWithThreads(threads)[0];
    }

    largestServers(exclude={}) {
        return this.smallestServers.filter((server)=>(
            !(server.hostname in exclude) &&
            server.availableThreads > 0
        )).reverse();
    }

    largestThreadsAvailable() {
        return this.largestServer?.availableThreads || 0;
    }

    medianThreadSize() {
        const server = this.smallestServers[Math.floor(this.smallestServers.length*7/8)];
        return Math.floor(server.maxRam / this.scriptRam);
    }

    async deploy({server, host, script, threads, args, dependencies, allowSplit, requireAll}) {
        if (!server && host) {
            server = this.getServer(host);
        }
        if (!server) {
            if (threads == 'max') {
                server = this.largestServer;
            }
            else {
                server = this.smallestServerWithThreads(threads);
            }
        }
        if (server) {
            let result = await server.deploy({script, threads, args, dependencies});
            if (result.pid) {
                this.logInfo(`Running on ${server.hostname} with PID ${result.pid}: ${result.threads}x ${script} ${(args||[]).join(' ')}`);
            }
            else {
                this.logWarn(`Not enough available RAM on ${server.hostname} to run ${script}`);
            }
            return result;
        }
        else if (allowSplit) {
            const batch = this.splitJob({script, threads, args, requireAll});
            return await this.deployBatch(batch);
        }
        else {
            this.logWarn(`No suitable server to run ${threads}x ${script} ${args.join(' ')}`);
        }
    }

    splitJob({script, threads, args, requireAll}) {
        if (requireAll && threads > this.totalThreadsAvailable) {
            this.logWarn("Not enough RAM in server pool to run entire job.");
            return null;
        }
        const batch = [];
        const usedServers = {};
        let threadsNeeded = Math.min(threads, this.totalThreadsAvailable);
        while (threadsNeeded > 0) {
            let server = this.smallestServersWithThreads(threadsNeeded, usedServers)[0];
            if (!server) {
                server = this.largestServers(usedServers)[0];
            }
            if (!server) {
                break;
            }
            usedServers[server.hostname] = true;
            const threadsToUse = Math.min(threadsNeeded, server.availableThreads);
            const job = {script, args, threads:threadsToUse, host:server.hostname};
            batch.push(job);
            threadsNeeded -= threadsToUse;
        }
        return batch;
    }

    async deployBatch(jobs=[]) {
        if (!jobs) {
            return null;
        }
        const totalThreads = jobs.reduce((total, job)=>(total + job.threads), 0);
        if (totalThreads > this.totalThreadsAvailable) {
            this.logWarn("Not enough RAM in server pool to run entire batch");
            return null;
        }
        const results = [];
        for(const job of jobs) {
            const result = await this.deploy(job);
            results.push(result)
        }
        if (jobs.length > 1) {
            this.logInfo(`Deployed ${this.ns.nFormat(totalThreads, '0,0')} total threads.`);
        }
        return results;
    }

    logInfo(...args) {
        if (this.logLevel >= 2) {
            this.ns.tprint(...args);
        }
        else if (this.logLevel >= 1) {
            this.ns.print(...args);
        }
    }

    logWarn(...args) {
        if (this.logLevel >= 1) {
            this.ns.tprint(...args);
        }
        else {
            this.ns.print(...args);
        }
    }

    report() {
        const {ns} = this;
        let poolInfo = [];
        function formatRAM(ram) {
            return ns.nFormat(ram*1e9, "0 b");
        }
        const columns = [
            {header: "Hostname", field: "hostname", width: 20, align: "left"},
            {header: "Used RAM", field: ["ramUsed", "maxRam"],  format: [formatRAM], width: 15, itemWidth: 6, align:"center"}
        ];
        columns.title = "Servers with Admin Rights";
        const rows = this.smallestServers.slice().sort((a,b)=>(
            b.maxRam - a.maxRam
        ));
        const summary = [{
            hostname: `Total servers: ${this.totalServers}`,
            ramUsed: this.totalUsedRam,
            maxRam: this.totalRam,
        }];
        poolInfo.push(drawTable(columns, rows, summary));
        poolInfo.push(`Total RAM available: ${ns.nFormat((this.totalRam - this.totalUsedRam)*1e9, "0 b")}`);
        poolInfo.push(`Total ${ns.nFormat(this.scriptRam*1e9, "0.0[0] b")} threads available: ${ns.nFormat(this.totalThreadsAvailable, "0,0")}`);
        poolInfo.push(' ');
        return poolInfo.join('\n');
    }
}

export class CloudServer {
    constructor({ns, hostname, scriptRam, reservedRam}) {
        this.ns = ns;
        if (typeof(scriptRam) === "string") {
            scriptRam = ns.getScriptRam(scriptRam, 'home');
        }
        scriptRam ||= 1.6;
        reservedRam ||= 0;

        Object.assign(this, ns.getServer(hostname));

        this.freeRam = this.maxRam - this.ramUsed;
        this.availableRam = this.freeRam;
        if ((this.hostname === "home") || this.hashCapacity) {
            this.availableRam -= Math.min(reservedRam, this.maxRam * 3 / 4);
        }
        this.availableRam = Math.max(0, this.availableRam);

        if (this.hasAdminRights) {
            this.availableThreads = Math.floor(this.availableRam / scriptRam);
        }
        else {
            this.availableThreads = 0;
        }
    }

    canRunScripts() {
        return (this.hasAdminRights && this.maxRam > 0)
    }

    async deploy({script, threads, args, dependencies=[]}) {
        const {ns} = this;

        if (threads == 'max') {
            threads = this.availableThreads;
        }

        args ||= [];

        await ns.scp([script, ...dependencies], 'home', this.hostname);
        const pid = ns.exec(script, this.hostname, threads, ...args);
        if (pid) {
            this.availableRam -= (threads * this.scriptRam);
            this.availableThreads -= threads;
        }
        return {pid, host:this.hostname, script, threads}
    }
}

export function getAllHosts(ns) {
    getAllHosts.cache ||= {};
    const scanned = getAllHosts.cache;
    const toScan = ['home'];
    while (toScan.length > 0) {
        const host = toScan.shift();
        scanned[host] = true;
        for (const nextHost of ns.scan(host)) {
            if (!(nextHost in scanned)) {
                toScan.push(nextHost);
            }
        }
    }
    const allHosts = Object.keys(scanned);
    return allHosts;
}
