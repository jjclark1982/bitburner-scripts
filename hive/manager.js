import { getThreadPool } from "/hive/worker";
import { ServerModel, mostProfitableServers } from "/hive/planner";
import { serverPool } from "/net/server-pool";

const FLAGS = [
    ["help", false],
    ["port", 1],
    ["moneyPercent", 0.05],
    ["maxThreadsPerJob", 512],
    ["hackMargin", 0.25],
    ["prepMargin", 0.5],
    ["naiveSplit", false],
    ["cores", 1],
    ["maxTotalRam"],
    ["tDelta", 100]
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
    const portNum = flags.port;
    delete flags.port;
    const targets = flags._;
    delete flags._;
    if (!flags.maxTotalRam) {
        const serverPool = serverPool(ns);
        const availableRam = serverPool.totalRam - serverPool.totalUsedRam;
        // reserve at most 1 TB of ram for other purposes
        flags.maxTotalRam = Math.max(availableRam*0.85, availableRam-1024);
    }

    const manager = new HackingManager(ns, portNum, targets, flags)
    await manager.work();
}

export class HackingManager {
    constructor(ns, portNum=1, targets=[], params={}) {
        this.ns = ns;
        this.portNum = portNum,
        this.params = params;

        this.targets = mostProfitableServers(ns, targets, params);
    }

    async work() {
        const {ns, targets} = this;
        this.pool = await getThreadPool(ns, this.portNum);

        while (true) {
            const target = this.targets[0];
            await this.hackOneTargetOneTime(target);
            // TODO: re-select optimal target as conditions change
        }
    }

    async hackOneTargetOneTime(server) {
        const {ns, params} = this;
        const now = Date.now();

        // plan a batch based on target state
        const batch = server.planHackingBatch(params);

        // schedule the batch
        if (!server.nextFreeTime) {
            batch.setStartTime(now);
            server.nextFreeTime = batch.lastEndTime();
        }
        batch.setFirstEndTime(server.nextFreeTime + params.tDelta);
        server.nextFreeTime = batch.lastEndTime();
        server.nextStartTime = batch.earliestStartTime();

        // dispatch the batch
        // TODO: check memory availability before dispatching. use total ram to calculate time between batches.
        ns.print(`Starting ${batch.summary()} batch for ${server.hostname}`);
        await this.pool.dispatchJobs(batch);

        // block until the expected start time, so we don't spam the queue
        await ns.asleep(server.nextStartTime - now);
    }
}
