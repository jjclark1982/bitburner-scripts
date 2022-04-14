import { drawTable } from "lib/box-drawing";
import { Server, ServerService } from '/service/servers';

const FLAGS = [
    ["help", false],
    ["port", 8]
]

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("asleep");
    ns.disableLog("scan");
    ns.clearLog();
    ns.tail();

    const flags = ns.flags(FLAGS);
    if (flags.help) {
        ns.tprint("Provide script deployment services on a netscript port")
        return;
    }

    const computeService = new ComputeService(ns);
    await computeService.work(flags.port);
}

export class ComputeService extends ServerService {
    async deploy({server, script, threads, args, dependencies, allowSplit, requireAll}) {
        const {ns} = this;
        const scriptRam = ns.getScriptRam(script, 'home');

        if (typeof(server) === 'string') {
            server = this.loadServer(server);
        }
        if (!server) {
            if (threads == 'max') {
                server = this.getServersWithMostThreads(scriptRam)[0];
            }
            else {
                server = this.getSmallestServersWithThreads(scriptRam, threads)[0];
            }
        }
        if (server) {
            let result = await server.deploy({script, threads, args, dependencies});
            if (result.pid) {
                ns.tprint(`Running on ${server.hostname} with PID ${result.pid}: ${result.threads}x ${script} ${(args||[]).join(' ')}`);
            }
            else {
                ns.tprint(`ERROR: Failed to deploy ${threads}x ${script} on ${server.hostname} (${this.ns.nFormat(scriptRam*threads*1e9, "0.0 b")} / ${this.ns.nFormat(server.availableRam() * 1e9, "0 b")} RAM)`);
            }
            return result;
        }
        else if (allowSplit) {
            const batch = this.splitJob({script, threads, args, requireAll});
            return await this.deployBatch(batch);
        }
        else {
            ns.tprint(`WARNING: No suitable server to run ${threads}x ${script} ${args||[].join(' ')}`);
        }
    }

    splitJob({script, threads, args, requireAll}) {
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
                server = this.getServersWithMostThreads(scriptRam, usedServers)[0];
            }
            if (!server) {
                break;
            }
            usedServers[server.hostname] = true;
            const threadsToUse = Math.min(threadsNeeded, server.availableThreads(scriptRam));
            const job = {script, args, threads:threadsToUse, server};
            batch.push(job);
            threadsNeeded -= threadsToUse;
        }
        return batch;
    }

    async deployBatch(jobs=[]) {
        const {ns} = this;

        const totalThreads = jobs.reduce((total, job)=>(total + job.threads), 0);
        const scriptRam = jobs.reduce((total, job)=>(Math.max(total, ns.getScriptRam(job.script))), 0);
        if (totalThreads > this.totalThreadsAvailable(scriptRam)) {
            ns.tprint(`WARNING: Batch requires ${ns.nFormat(totalThreads, '0,0')} threads but server pool has only ${this.totalThreadsAvailable(scriptRam)} threads available.`);
            return null;
        }
        const results = [];
        for(const job of jobs) {
            const result = await this.deploy(job);
            results.push(result)
        }
        if (jobs.length > 1) {
            ns.tprint(`Deployed ${this.ns.nFormat(totalThreads, '0,0')} total threads.`);
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
            {header: "Used RAM", field: ["ramUsed", "maxRam"],  format: [formatRAM], width: 15, itemWidth: 6, align:"center"}
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

export class ScriptableServer extends Server {
    async deploy({script, threads, args=[], dependencies=[]}) {
        const {ns} = this;
        scriptRam = ns.getScriptRam(script, 'home');

        if (threads == 'max') {
            threads = this.getAvailableThreads(scriptRam);
        }

        await ns.scp([script, ...dependencies], 'home', this.hostname);
        const pid = ns.exec(script, this.hostname, threads, ...args);
        return {pid, server:this.hostname, script, threads}
    }
}
