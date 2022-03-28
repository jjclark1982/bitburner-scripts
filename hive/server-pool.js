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
        this.scriptRam = scriptRam || SCRIPT_RAM;
        this.verbose = verbose;
        this.servers = getServersForScript(ns, scriptRam);
    }

    [Symbol.iterator]() {
        return this.servers[Symbol.iterator]();
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

    totalThreads() {
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

    report() {
        const {ns} = this;
        let poolInfo = [`Server Pool for ${ns.nFormat(this.scriptRam*1e9, "0.0[0] b")} script:`];
        for (const server of this.servers) {
            poolInfo.push(sprintf("  %-20s %8s RAM (%s threads)",
                server.hostname + ":",
                ns.nFormat(server.maxRam*1e9, "0.0 b"),
                ns.nFormat(server.availableThreads, "0,0")
            ));
        }
        poolInfo.push('');
        poolInfo.push(`Total servers in pool: ${this.totalServers()}`);
        poolInfo.push(`Total threads available: ${ns.nFormat(this.totalThreads(), "0,0")}`);
        poolInfo.push('');
        return poolInfo.join('\n');
    }

    async runScript({server, script, threads, args}) {
        const {ns} = this;
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
        return await this.runScript({server, script, threads, args})
    }

    async runOnLargest({script, args, reservedRam}) {
        // Run the maximum threads of the script on a single server.
        const {ns} = this;
        const server = this.largestServers()[0];
        args ||= [];
        reservedRam ||= 0;

        const scriptRam = ns.getScriptRam(script, 'home');
        let availableRam = server.maxRam - server.ramUsed - reservedRam;
        const threads = Math.floor(availableRam / scriptRam);
        return await this.runScript({server, script, threads, args});
    }

    async runDistributed({script, threads, args, requireAll}) {
        // Run the script on one or more hosts, selected based on current availability.
        let threadsNeeded = threads;
        if (this.totalThreads < threadsNeeded && requireAll) {
            this.logWarn(`Not enough RAM in server pool to run entire job: ${threads}x ${script} ${args}`);
        }
        for (const server of this.largestServers()) {
            const threadsToUse = Math.min(threadsNeeded, server.availableThreads);
            if (threadsToUse > 0) {
                await this.runScript({server, script, threads:threadsToUse, args});
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

function getServersForScript(ns, scriptRam) {
    const servers = getAllHosts(ns).map((hostname)=>{
        const server = ns.getServer(hostname);
        let reservedRam = 0;
        if ((server.hostname === "home") || server.hashCapacity) {
            // Reserve RAM on home and hacknet servers
            reservedRam = Math.min(1024, server.maxRam * 3 / 4);
        }
        server.availableRam = Math.max(0, server.maxRam - server.ramUsed - reservedRam);
        if (server.hasAdminRights) {
            server.availableThreads = Math.floor(server.availableRam / scriptRam);
        }
        else {
            server.availableThreads = 0;
        }
        server.sortKey = server.maxRam; //server.availableThreads * (1 + server.cpuCores/16);
        return server;
    }).filter((server)=>(
        server.hasAdminRights &&
        server.maxRam > 0
    )).sort((a,b)=>(
        b.sortKey - a.sortKey
    ));
    return servers;
}
