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
        ]);
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

    async deploy(job) {
        let {host, server, script, threads=1, args, dependencies, allowSplit, requireAll} = job;
        const {ns} = this;
        const scriptRam = ns.getScriptRam(script, 'home');

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
                ns.tprint(`Running on ${server.hostname} with PID ${process.pid}: ${process.threads}x ${script} ${(args||[]).join(' ')}`);
            }
            else {
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

    deployLater(job) {
        const now = Date.now();
        job.startTime ||= now;
        job.process ||= {};
        setTimeout(this.deploy.bind(this, job), job.startTime - now);
        return job.process;
    }

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
