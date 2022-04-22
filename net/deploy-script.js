/*

/net/deploy-script.js - run a script on any available server

Usage:

4.2 GB import
import { ServerPool, HackableServer } from "/net/deploy-server";

5.8 GB daemon (Port 2)
> run /service/compute.js

5.8 GB executable
> run /net/deploy-server.js [--threads n] script [args...]

*/


import { drawTable } from "/lib/box-drawing";
import { ServerModel, ServerList } from '/net/server-list';

/**
 * deploy - main API for ServerPool library
 * @param {NS} ns 
 * @param {object} job
 * @param {string} job.script - filename of script to run
 * @param {string} [job.host] - host to run on (optional)
 * @param {*} [job.threads=1] - set to 'max' to use as many threads as possible
 * @param {string[]} [job.dependencies] - list of other scripts to copy to the host
 * @param {boolean} [job.allowSplit] - whether to allow splitting a large job into multiple processes
 * @param {boolean} [job.requireAll] - whether to abort a split job if it cannot be run entirely
 * @param {object} params
 * @param {number} [params.logLevel] - 1 for errors, 2 for warnings, 3 for info, 4 for debug
 * @param {function} [params.logFunc] - function to use for logging (default ns.tprint)
 * @returns 
 */
export async function deploy(ns, job={}, params={}) {
    const {host, script, threads, args, dependencies, allowSplit, requireAll} = job;
    const serverPool = new ServerPool(ns, params);
    return await serverPool.deploy(job);
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

    if (ns.args.includes("--help") || ns.args.length == 0) {
        ns.tprint([
            "Run a script on any available server, splitting threads into different processes if needed.",
            '',
            `Usage: run ${ns.getScriptName()} [--threads n] script [args...]`,
            '',
            `Exmaple: run ${ns.getScriptName()} --threads 1000 /batch/grow.js ecorp`,
            ' '
        ].join('\n'));
        return;
    }

    const flags = {
        ns: ns,
        threads: 1,
        allowSplit: true
    };
    if (ns.args[0] == '--threads') {
        flags.threads = ns.args[1];
        ns.args = ns.args.slice(2);
    }
    if (ns.args.length > 0) {
        flags.script = ns.args.shift();
        flags.args = ns.args;
    }
    await deploy(ns, flags, {logLevel: 4});
}

export class ServerPool extends ServerList {
    ServerClass = ScriptableServer;
    logLevel = 2;

    constructor(ns, params={}) {
        super(ns, params);
        Object.assign(this, params);
        this.logFunc ||= ns.tprint;
        this.pendingJobs = {};
        ns.atExit(this.tearDown.bind(this));
    }

    tearDown() {
        for (const timeout in this.pendingJobs) {
            clearTimeout(timeout);
        }
    }

    logDebug(...args) {
        if (this.logLevel > 3) { this.logFunc(...args); }
    }

    logInfo(...args) {
        if (this.logLevel > 2) { this.logFunc("INFO: ", ...args); }
    }

    logWarn(...args) {
        if (this.logLevel > 1) { this.logFunc("WARNING: ", ...args); }
    }

    logError(...args) {
        if (this.logLevel > 0) { this.logFunc("ERROR: ", ...args); }
    }

    /**
     * deploy
     * @param {Job} job
     * @param {boolean} job.allowSplit - whether to allow splitting a large job into smaller processes with the same total thread count
     * @returns {object} process
     */
    async deploy(job) {
        let {host, server, script, threads=1, args, dependencies, allowSplit, requireAll} = job;
        const {ns} = this;
        const scriptRam = ns.getScriptRam(script, 'home');
        delete this.pendingJobs[job.timeout];

        if (host && !server) {
            server = this.loadServer(host);
        }
        if (!server) {
            if (threads == 'max') {
                server = this.getBiggestServers({scriptRam})[0];
            }
            else {
                server = this.getSmallestServers({scriptRam, threads})[0];
            }
        }
        if (server) {
            let process = await server.deploy(job);
            if (process.pid) {
                this.logDebug(`Running on ${server.hostname} with PID ${process.pid}: ${process.threads}x ${script} ${(args||[]).join(' ')}`);
            }
            else if (threads > 0) {
                this.logError(`Failed to deploy ${threads}x ${script} on ${server.hostname} (${this.ns.nFormat(scriptRam*threads*1e9, "0.0 b")} / ${this.ns.nFormat(server.availableRam() * 1e9, "0 b")} RAM)`);
            }
            return process;
        }
        else if (allowSplit) {
            const batch = this.splitJob({script, threads, args, requireAll});
            return await this.deployBatch(batch);
        }
        else {
            this.logWarn(`No suitable server to run ${threads}x ${script} ${args||[].join(' ')}`);
        }
    }

    /**
     * Deploy a job at its specified startTime.
     * @param {object} job 
     * @param {number} job.startTime
     * @returns {object} process
     */
     deployLater(job) {
        const now = Date.now();
        job.startTime ||= now;
        job.process ||= {};
        job.timeout = setTimeout(this.deploy.bind(this, job), job.startTime - now);
        this.pendingJobs ||= {};
        this.pendingJobs[job.timeout] = job;
        return job.process;
    }

    /**
     * Convert a large job into a batch of smaller jobs that will fit on this pool.
     * @param {Job} job
     * @param {boolean} job.requireAll - whether to cancel if there is not enouh RAM for the entire batch.
     * @returns {Job[]} batch of jobs
     */
    splitJob({script, threads, args, startTime, requireAll}) {
        const {ns} = this;
        const scriptRam = ns.getScriptRam(script, 'home');
        const maxThreads = this.totalThreadsAvailable(scriptRam);

        if (requireAll && threads > maxThreads) {
            this.logError("Not enough RAM in server pool to run entire job.");
            return null;
        }
        const batch = [];
        const usedServers = {};
        let threadsNeeded = Math.min(threads, maxThreads);
        while (threadsNeeded > 0) {
            let server = this.getSmallestServers({scriptRam, threads:threadsNeeded, exclude:usedServers})[0];
            if (!server) {
                server = this.getBiggestServers({scriptRam, threads:1, exclude:usedServers})[0];
            }
            if (!server) {
                break;
            }
            usedServers[server.hostname] = true;
            const threadsToUse = Math.min(threadsNeeded, server.availableThreads(scriptRam));
            const job = {script, args, threads:threadsToUse, server, startTime};
            batch.push(job);
            threadsNeeded -= threadsToUse;
        }
        return batch;
    }

    /**
     * Deploy a list of jobs, if there is enough RAM for all of them.
     * @param {Job[]} jobs - list of jobs
     * @returns {object[]} list of processes
     */
    async deployBatch(jobs=[]) {
        const {ns} = this;

        const totalThreads = jobs.reduce((total, job)=>(total + job.threads), 0);
        const scriptRam = jobs.reduce((total, job)=>(Math.max(total, ns.getScriptRam(job.script))), 0);
        if (totalThreads > this.totalThreadsAvailable(scriptRam)) {
            this.logWarn(`Batch requires ${ns.nFormat(totalThreads, '0,0')} threads but server pool has only ${this.totalThreadsAvailable(scriptRam)} threads available.`);
            return null;
        }
        const results = [];
        for(const job of jobs) {
            if (job.startTime) {
                this.deployLater(job);
                results.push(job);
            }
            else {
                const result = await this.deploy(job);
                results.push(result)
            }
        }
        if (jobs.length > 1) {
            this.logInfo(`Deployed ${this.ns.nFormat(totalThreads, '0,0')} total threads.`);
        }
        return results;
    }

    report() {
        const {ns} = this;
        let lines = [];
        function formatRAM(ram) {
            return ns.nFormat(ram*1e9 || 0, "0.[0] b");
        }
        const columns = [
            {header: "Hostname", field: "hostname", width: 20, align: "left"},
            {header: "Used RAM    ", field: ["ramUsed", "maxRam"],  format: [formatRAM], width: 17, itemWidth: 6, align:"right"}
        ];
        columns.title = "Servers with Admin Rights";
        const servers = this.getScriptableServers();
        const rows = servers.sort((a,b)=>(
            b.maxRam - a.maxRam
        ));
        const summary = {
            hostname: `Total servers: ${servers.length}`,
            ramUsed: this.totalRamUsed(),
            maxRam: this.totalRam(),
        };
        lines.push(drawTable(columns, rows, [summary]));
        lines.push(`Total RAM available: ${ns.nFormat((summary.maxRam - summary.ramUsed)*1e9, "0.[0] b")}`);
        const scriptRam = 1.75;
        lines.push(`Total ${ns.nFormat(scriptRam*1e9, "0.0[0] b")} threads available: ${ns.nFormat(this.totalThreadsAvailable(scriptRam), "0,0")}`);
        lines.push(' ');
        return lines.join('\n');
    }
}

export class ScriptableServer extends ServerModel {
    async deploy(job) {
        const {ns} = this;
        job.args ||= [];
        job.threads ||= 1;
        const scriptRam = ns.getScriptRam(job.script, 'home');
        if (job.threads == 'max') {
            job.threads = this.availableThreads(scriptRam);
        }
        const {script, threads, args, dependencies} = job;

        job.process ||= {};
        Object.assign(job.process, {
            server: this.hostname,
            filename: script,
            args: args,
            threads,
            ramUsage: scriptRam
        });
        if (threads > 0) {
            await ns.scp([script, ...(dependencies||[])], 'home', this.hostname);
            job.process.pid = ns.exec(script, this.hostname, threads, ...args);
            this.reload();
        }
        return job.process;
    }
}

/**
 * Job
 * @typedef {Object} Job
 * @property {string} script - the script to run
 * @property {string[]} [args] - the arguments to the script
 * @property {number} [threads=1] - number of threads
 * @property {number} [duration] - duration of this task in milliseconds
 * @property {number} [startTime] - time to schedule start
 * @property {number} [endTime] - time to schedule end
 * @property {string} [host] - hostname to run on (optional)
 * @property {ScriptableServer} [server] - server to run on (optional)
 * @property {string[]} [dependencies] - additional scripts to copy to the server
 */
