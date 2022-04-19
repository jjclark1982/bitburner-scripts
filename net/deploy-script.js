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
 * @param {object} job - description of the script to run
 * @returns 
 */
export async function deploy(ns, job={}) {
    const {host, script, threads, args, dependencies, allowSplit, requireAll} = job;
    const serverPool = new ServerPool(ns);
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
    await deploy(flags);
}

export class ServerPool extends ServerList {
    ServerClass = ScriptableServer;
    logLevel = 2;

    constructor(ns, params={}) {
        super(ns, params);
        Object.assign(this, params);
        this.pendingJobs = {};
        ns.atExit(this.tearDown.bind(this));
    }

    tearDown() {
        for (const timeout in this.pendingJobs) {
            clearTimeout(timeout);
        }
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
                server = this.getBiggestServers(scriptRam)[0];
            }
            else {
                server = this.getSmallestServersWithThreads(scriptRam, threads)[0];
            }
        }
        if (server) {
            let process = await server.deploy(job);
            if (process.pid) {
                if (this.logLevel >= 2) { ns.tprint(`Running on ${server.hostname} with PID ${process.pid}: ${process.threads}x ${script} ${(args||[]).join(' ')}`); }
            }
            else if (threads > 0) {
                ns.tprint(`ERROR: Failed to deploy ${threads}x ${script} on ${server.hostname} (${this.ns.nFormat(scriptRam*threads*1e9, "0.0 b")} / ${this.ns.nFormat(server.availableRam() * 1e9, "0 b")} RAM)`);
            }
            return process;
        }
        else if (allowSplit) {
            const batch = this.splitJob({script, threads, args, requireAll});
            return await this.deployBatch(batch);
        }
        else {
            ns.tprint(`WARNING: No suitable server to run ${threads}x ${script} ${args||[].join(' ')}`);
        }
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
            ns.tprint("ERROR: Not enough RAM in server pool to run entire job.");
            return null;
        }
        const batch = [];
        const usedServers = {};
        let threadsNeeded = Math.min(threads, maxThreads);
        while (threadsNeeded > 0) {
            let server = this.getSmallestServersWithThreads(scriptRam, threadsNeeded, usedServers)[0];
            if (!server) {
                server = this.getBiggestServers(scriptRam, usedServers)[0];
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
        if (!this.running) {
            return;
        }
        const {ns} = this;

        const totalThreads = jobs.reduce((total, job)=>(total + job.threads), 0);
        const scriptRam = jobs.reduce((total, job)=>(Math.max(total, ns.getScriptRam(job.script))), 0);
        if (totalThreads > this.totalThreadsAvailable(scriptRam)) {
            ns.tprint(`WARNING: Batch requires ${ns.nFormat(totalThreads, '0,0')} threads but server pool has only ${this.totalThreadsAvailable(scriptRam)} threads available.`);
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
            ns.tprint(`INFO: Deployed ${this.ns.nFormat(totalThreads, '0,0')} total threads.`);
        }
        return results;
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
     * Deploy a list of jobs at their specified startTimes.
     * TODO: address redundancies between this and deployBatch
     * @param {Job[]} jobs
     * @param {number} safetyFactor 
     * @returns {boolean} success
     */
    deployBatchLater(jobs=[], safetyFactor=1.1) {
        const {ns} = this;
        this.batchID ||= 0;
        this.batchID++;
    
        let totalThreads = 0;
        let earliestStartTime = Infinity;
        let maxScriptRam = 1.6;
        for (const job of jobs) {
            totalThreads += job.threads;
            if (job.startTime !== undefined && job.startTime < earliestStartTime) {
                earliestStartTime = job.startTime;
            }
            const scriptRam = ns.getScriptRam(job.script, 'home');
            if (scriptRam > maxScriptRam) {
                maxScriptRam = scriptRam;
            }
        }
    
        // If planned start time was in the past, shift entire batch to future
        // and update times in-place.
        let startTimeAdjustment = Date.now() - earliestStartTime;
        if (startTimeAdjustment > 0) {
            startTimeAdjustment += 100;
            ns.print(`Batch ${this.batchID} adjusting start time by ${startTimeAdjustment}`);
            for (const job of jobs) {
                job.startTime += startTimeAdjustment;
                job.endTime += startTimeAdjustment;
                if (job.args.includes('--startTime')) {
                    job.args[job.args.indexOf('--startTime')+1] += startTimeAdjustment;
                }
            }
        }
    
        // Abort if the entire batch will not fit in RAM.
        // (Difficult to be sure because conditions may change before scheduled jobs start.)
        if (totalThreads * safetyFactor > this.totalThreadsAvailable(maxScriptRam)) {
            ns.tprint("ERROR: Batch skipped: not enough RAM in server pool.");
            return false;
        }
    
        // Schedule each job in the batch.
        for (const [index, job] of jobs.entries()) {
            // Append batch id and job index to ensure unique process id.
            job.args.push(`batch-${this.batchID}.${index+1}`);
            this.deployLater(job);
        }
        return true;
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
