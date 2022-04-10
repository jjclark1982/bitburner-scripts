import { getThreadPool } from "/hive/worker";
import { ServerModel, mostProfitableServers } from "/hive/planner";
import { serverPool } from "/net/server-pool";

const FLAGS = [
    ["help", false],
    ["backend", "thread-pool"],
    ["port", 1],
    ["tDelta", 100],
    ["maxTotalRam", 0],        // optional (will be read from backend)
    ["maxThreadsPerJob", 128], // TODO: read this from backend
    ["moneyPercent", 0.05],    // (will be overwritten by optimizer)
    ["hackMargin", 0.25],      // (will be overwritten by optimizer)
    ["prepMargin", 0.5],       // (will be overwritten by optimizer)
    ["naiveSplit", false],     // not currently used
    ["cores", 1],              // not currently used
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return data.servers;
}

/*

TODO: create a dashboard showing target information
    - number of jobs dispatched
    - number of jobs pending?
    - cycle duration
    - latestEndTime
    - latestStartTime

TODO: support multiple targets.
Measure total ram in the server pool
while some ram is not reserved:
- select the target with most $/sec/GB
- reserve enough ram to completely exploit that target
- if any ram remains, proceed to the next target

*/

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog('scan');
    ns.disableLog('asleep');
    ns.clearLog();
    const flags = ns.flags(FLAGS);
    if (flags.help) {
        ns.tprint("Manage hacking a server.")
        return;
    }
    delete flags.help;

    let backend;
    if (flags.backend == "thread-pool") {
        backend = await getThreadPool(ns, flags.port);
    }
    delete flags.backend;
    delete flags.port;

    const targets = flags._;
    delete flags._;
    if (!flags.maxTotalRam) {
        const pool = serverPool(ns);
        const availableRam = pool.totalRam - pool.totalUsedRam;
        // reserve at most 1 TB of ram for other purposes
        flags.maxTotalRam = Math.max(availableRam*0.9, availableRam-1024);
    }

    const manager = new HackingManager(ns, backend, targets, flags)
    await manager.work();
}

export class HackingManager {
    constructor(ns, backend, targets=[], params={}) {
        this.ns = ns;
        this.backend = backend;
        this.params = params;
        this.batchID = 0;

        this.targets = [];
        this.plans = {};
        for (const plan of mostProfitableServers(ns, targets, params)) {
            this.targets.push(plan.server);
            this.plans[plan.server.hostname] = plan;
        }
    }

    async work() {
        const {ns, targets} = this;

        while (true) {
            const target = this.targets[0];
            eval("window").target = target;
            await this.hackOneTargetOneTime(target);
            // TODO: re-select optimal target as conditions change
        }
    }

    async hackOneTargetOneTime(server) {
        const {ns} = this;
        const batchCycle = this.plans[server.hostname];
        const params = batchCycle.params;
        const now = Date.now() + params.tDelta;
        const prevServer = server.copy();
        const batchID = this.batchID++;

        // Plan a batch based on target state and parameters
        const batch = server.planHackingBatch(params);

        // Schedule the batch
        if (!server.nextFreeTime) {
            batch.setStartTime(now);
            server.nextFreeTime = batch.lastEndTime();
        }
        batch.setFirstEndTime(server.nextFreeTime);
        if (batch.earliestStartTime() < now) {
            ns.tprint("ERROR: batch.earliestStartTime was inconsistent")
        }

        // Add an `onFinish` callback to check on batch results and adjust params
        batch[batch.length-1].onFinish = function(job){
            const expectedServer = job.result;
            const actualServer = job.result.copy().reload();
            if (actualServer.hackDifficulty > expectedServer.hackDifficulty) {
                ns.print(`WARNING: desync detected after batch ${batchID}. Reloading server state and adjusting parameters.`);
                server.reload();
                const newParams = server.mostProfitableParameters(this.params);
                this.plans[server.hostname] = server.planBatchCycle(newParams);
                server.reload();
            }
            // console.log(`Finished batch ${batchID}. Expected security:`, job.result.hackDifficulty, "Actual:", job.result.copy().reload().hackDifficulty);
        }

        // Dispatch the batch
        const result = await this.backend.dispatchJobs(batch);
        if (result) {
            ns.print(`Dispatched batch ${batchID}: ${batch.moneySummary()} ${batch.summary()} batch for ${server.hostname}`);
        }
        // If dispatch failed, rollback state
        if (!result) {
            ns.print(`Failed to dispatch batch ${batchID}: ${batch.summary()} batch for ${server.hostname}. Skipping this batch.`);
            Object.assign(server, prevServer);
            // TODO: check whether params.maxThreadsPerJob still fits in backend
        }

        // Update the schedule for this target, and block until the schedule is free.
        server.nextFreeTime = batch.lastEndTime() + params.tDelta + batchCycle.timeBetweenBatches;
        server.nextStartTime = batch.earliestStartTime();
        await ns.asleep(server.nextStartTime - Date.now()); // this should be timeBetweenBatches before the following batch's earliest start
    }
}
