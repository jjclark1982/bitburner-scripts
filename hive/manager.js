import { getThreadPool } from "/hive/worker";
import { ServerModel, mostProfitableServers } from "/hive/planner";
import { serverPool } from "/net/server-pool";

const FLAGS = [
    ["help", false],
    ["backend", "thread-pool"],
    ["port", 1],
    ["moneyPercent", 0.05],
    ["hackMargin", 0.25],
    ["prepMargin", 0.5],
    ["naiveSplit", false],
    ["cores", 1],
    ["maxTotalRam"],
    ["maxThreadsPerJob", 64],
    ["tDelta", 100],
]

/*

-> create a dashboard showing target information
    - number of jobs dispatched
    - number of jobs pending?
    - cycle duration
    - latestEndTime
    - latestStartTime

Then the general process for a target is:
    sleep until nextStartTime-ε
    plan a batch:
        if money is high: hack
        while sec is high: weaken
        while money is low: grow
        while sec is high: weaken
    (This can result in the typical prep WGW and typical batch HWGW, but also HGHGHGW)
*/

/*

HackingManager just needs to keep track of pay windows for each target:

- nextFreeTime (= latestEndTime + tDelta)
- nextStartTime

then it can loop:
    plan a batch for nextFreeTime
    sleep until nextStartTime
    deploy the batch to either ServerPool or ThreadPool


To automatically select targets, we keep track of the above and calculate priorities.

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
        ns.tprint("manage hacking a server")
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
        flags.maxTotalRam = Math.max(availableRam*0.85, availableRam-1024);
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
        this.batchID++;

        // Plan a batch based on target state and parameters
        const batch = server.planHackingBatch(params);

        // Schedule the batch
        if (!server.nextFreeTime) {
            batch.setStartTime(now);
            server.nextFreeTime = batch.lastEndTime();
        }
        batch.setFirstEndTime(server.nextFreeTime + params.tDelta);
        if (batch.earliestStartTime() < now) {
            ns.tprint("ERROR: batch.earliestStartTime was inconsistent")
        }
        server.nextFreeTime = batch.lastEndTime() + params.tDelta + batchCycle.timeBetweenBatches;
        server.nextStartTime = batch.earliestStartTime();

        // Dispatch the batch
        // TODO: check memory availability before dispatching. use total ram to calculate time between batches.
        const result = await this.backend.dispatchJobs(batch);
        if (result) {
            ns.print(`Dispatched batch ${this.batchID}: ${batch.summary()} batch for ${server.hostname}`);
        }
        // If dispatch failed, rollback state and reduce thread size
        if (!result) {
            ns.print(`Failed to dispatch batch ${this.batchID}: ${batch.summary()} batch for ${server.hostname}. Recalculating parameters.`);
            const newParams = server.mostProfitableParameters({
                ...params,
                maxThreadsPerJob: params.maxThreadsPerJob * 7/8,
                maxTotalRam: params.maxTotalRam * 7/8
            });
            ns.tprint(JSON.stringify(newParams, null, 2));
            this.plans[server.hostname] = server.planBatchCycle(newParams); // TODO: make this return an object instead of setting server.timeBetweenBatches
            Object.assign(server, prevServer);
        }

        // Block until the expected start time, so we don't spam the queue
        await ns.asleep(server.nextStartTime - Date.now());
    }
}
