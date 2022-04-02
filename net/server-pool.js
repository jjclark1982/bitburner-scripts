import { drawTable } from "lib/box-drawing.js";

const SCRIPT_RAM = 2.0; // Default thread cost for estimating capacity of pool

const FLAGS = [
    ["help", false],
    ["threads", 1],
    ["verbose", 2]
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
        threads: 1,
        verbose: 2
    };
    if (ns.args.includes("--help")) {
        ns.tprint("Run a script on any available server, splitting threads into different processes if needed.");
        ns.tprint(`Usage: run ${ns.getScriptName()} [--threads n] script [args...]`);
        ns.tprint(`Exmaple: run ${ns.getScriptName()} --threads 1000 /batch/grow.js ecorp`);
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
    let scriptRam = SCRIPT_RAM;
    if (flags.script) {
        scriptRam = ns.getScriptRam(flags.script, "home");
    }
    const serverPool = new ServerPool(ns, scriptRam, flags.verbose);
    ns.print(serverPool.report());

    if (flags.script) {
        await serverPool.runDistributed({...flags});
    }
    else {
        ns.tail();
        await ns.asleep(100);
    }
}

export class ServerPool {
    constructor(ns, scriptRam, verbose) {
        this.ns = ns;
        if (typeof(scriptRam) === "string") {
            scriptRam = ns.getScriptRam(scriptRam, 'home');
        }
        this.scriptRam = scriptRam || SCRIPT_RAM;
        this.verbose = verbose;
        this.servers = getServersForScript(ns, scriptRam);
    }

    [Symbol.iterator]() {
        return this.servers[Symbol.iterator]();
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
        const rows = this.servers.map((server)=>{
            return {
                ...server,
                ramBytes: [server.ramUsed*1e9, server.maxRam*1e9]
            }
        });
        const summary = [{
            hostname: `Total servers: ${this.totalServers()}`,
            ramUsed: this.totalUsedRam(),
            maxRam: this.totalRam(),
        }];
        poolInfo.push(drawTable(columns, rows, summary));
        poolInfo.push(`Total RAM available: ${ns.nFormat((this.totalRam() - this.totalUsedRam())*1e9, "0 b")}`);
        poolInfo.push(`Total ${ns.nFormat(this.scriptRam*1e9, "0.0[0] b")} threads available: ${ns.nFormat(this.totalThreadsAvailable(), "0,0")}`);
        poolInfo.push(' ');
        return poolInfo.join('\n');
    }

    logInfo(...args) {
        if (this.verbose >= 2) {
            this.ns.tprint(...args);
        }
        else if (this.verbose >= 1) {
            this.ns.print(...args);
        }
    }

    logWarn(...args) {
        if (this.verbose >= 1) {
            this.ns.tprint(...args);
        }
        else {
            this.ns.print(...args);
        }
    }

    getServer(hostname) {
        if (!hostname) {
            return null;
        }
        for (const server of this.servers) {
            if (server.hostname == hostname) {
                return server;
            }
        }
        return null;
    }

    totalServers() {
        return this.servers.length;
    }

    totalRam() {
        return this.servers.reduce((total, server)=>(
            total + server.maxRam
        ), 0);
    }

    totalUsedRam() {
        return this.servers.reduce((total, server)=>(
            total + server.ramUsed
        ), 0);
    }

    totalThreadsAvailable() {
        return this.servers.reduce((total, server)=>(
            total + server.availableThreads
        ), 0);
    }

    smallestServersWithThreads(threads) {
        return this.servers.filter((server)=>(
            server.availableThreads >= threads
        )).sort((a,b)=>(
            a.maxRam - b.maxRam
        ));
    }

    largestServers() {
        return this.servers.filter((server)=>(
            server.availableThreads > 0
        )).sort((a,b)=>(
            b.availableThreads - a.availableThreads
        ));
    }

    async runOnServer({server, script, threads, args}) {
        const {ns} = this;
        args ||= [];
        if (!server) {
            this.logWarn(`No suitable server to run ${script}`);
            return null;
        }
        await ns.scp(script, 'home', server.hostname);
        if (threads > 0) {
            const pid = ns.exec(script, server.hostname, threads, ...args);
            this.logInfo(`Running on ${server.hostname} with PID ${pid}: ${threads}x ${script} ${args.join(' ')}`);
            return pid;
        }
        else {
            this.logWarn(`Not enough available RAM on ${server.hostname} to run ${script}`);
            return null;
        }
    }

    async runOnSmallest({script, threads, args, roundUpThreads}) {
        // Run the script on the smallest server possible.
        // Optionally increase the number of threads by `roundUpThreads` to fill up available RAM.
        const server = this.smallestServersWithThreads(threads)[0];
        if (server.availableThreads - threads < roundUpThreads) {
            this.logInfo(`Rounding up threads from ${threads} to ${server.availableThreads}`)
            threads = server.availableThreads;
        }
        return await this.runOnServer({server, script, threads, args})
    }

    async runMaxThreads({host, script, args, reservedRam}) {
        // Run the maximum threads of the script on a single server.
        // (Useful for charging Stanek's Gift.)
        const {ns} = this;
        let server = this.getServer(host);
        if (!server) {
            server = this.largestServers()[0];
        }
        if (!server) {
            this.logWarn(`Not enough RAM in server pool to run ${script} ${args}`);
            return;
        }
        args ||= [];

        const scriptRam = ns.getScriptRam(script, 'home');
        let availableRam = server.availableRam;
        if (reservedRam) {
            availableRam = server.maxRam - server.ramUsed - reservedRam;
        }
        const threads = Math.floor(availableRam / scriptRam);
        return await this.runOnServer({server, script, threads, args});
    }

    async runDistributed({script, threads, args, requireAll}) {
        // Run the script on one or more hosts, selected based on current availability.
        let threadsNeeded = threads;
        if (this.totalThreadsAvailable() < threadsNeeded && requireAll) {
            this.logWarn(`Not enough RAM in server pool to run entire job: ${threads}x ${script} ${args}`);
        }
        let servers = this.smallestServersWithThreads(threads);
        if (servers.length == 0) {
            servers = this.largestServers();
        }
        for (const server of servers) {
            const threadsToUse = Math.min(threadsNeeded, server.availableThreads);
            if (threadsToUse > 0) {
                await this.runOnServer({server, script, threads:threadsToUse, args});
                threadsNeeded -= threadsToUse;
            }
            if (threadsNeeded <= 0) {
                break;
            }
        }
        if (threadsNeeded > 0) {
            this.logWarn(`Failed to run entire job on pool: ${threads}x ${script} ${args}`);
        }
    }

    // Note that this implementation does not include `runBatchOnPool` functionality,
    // including scheduling `startTime` of jobs.
}

function getAllHosts(ns) {
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

function getAllServers(ns) {
    const servers = getAllHosts(ns).map(ns.getServer).sort((a,b)=>(
        b.maxRam - a.maxRam
    ))
    return servers;
}

function getServersForScript(ns, scriptRam) {
    const servers = getAllServers(ns).map((server)=>{
        // Reserve up to 1 TB of RAM on home and hacknet servers
        let reservedRam = 0;
        if ((server.hostname === "home") || server.hashCapacity) {
            reservedRam = Math.min(1024, server.maxRam * 3 / 4);
        }
        server.availableRam = Math.max(0, server.maxRam - server.ramUsed - reservedRam);
        if (server.hasAdminRights) {
            server.availableThreads = Math.floor(server.availableRam / scriptRam);
        }
        else {
            server.availableThreads = 0;
        }
        return server;
    }).filter((server)=>(
        server.hasAdminRights &&
        server.maxRam > 0
    ));
    return servers;
}

export async function runOnSmallest(ns, params) {
    const {script, threads, args, roundUpThreads} = params;
    const verbose = 2;
    const serverPool = new ServerPool(ns, script, verbose);
    return await serverPool.runOnSmallest(params);
}

export async function runMaxThreads(ns, params) {
    const {host, script, args, reservedRam} = params;
    const verbose = 2;
    const serverPool = new ServerPool(ns, script, verbose);
    return await serverPool.runMaxThreads(params);
}

export async function runDistributed(ns, params) {
    const {script, threads, args, requireAll} = params;
    const verbose = 2;
    const serverPool = new ServerPool(ns, script, verbose);
    return await serverPool.runDistributed(params);
}
