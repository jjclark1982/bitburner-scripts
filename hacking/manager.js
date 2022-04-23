import { getThreadPool } from "/botnet/worker";
import { HackableServer, HackPlanner } from "/hacking/planner";

const FLAGS = [
    ["help", false],
    ["backendPort", 3],        // default port for ThreadPool
    ["tDelta", 100],           // milliseconds between effects
    ["maxTotalRam", 0],        // optional (will be read from backend)
    ["maxThreadsPerJob", 0],   // optional (will be read from backend)
    ["moneyPercent", 0.05],    // (will be overwritten by optimizer)
    ["hackMargin", 0.25],      // (will be overwritten by optimizer)
    ["prepMargin", 0.5],       // (will be overwritten by optimizer)
    ["naiveSplit", false],     // not currently used
    ["reserveRam", true],      // weather to calculate batch RAM requirement based on peak amount
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

    const backend = await getThreadPool(ns, flags.backendPort);
    delete flags.backendPort;

    flags.maxTotalRam ||= backend.getMaxTotalRam();
    flags.maxThreadsPerJob ||= backend.getMaxThreadsPerJob();

    const targets = flags._;
    delete flags._;

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
        const planner = new HackPlanner(ns, params);
        for (const plan of planner.mostProfitableServers(targets, params)) {
            this.targets.push(plan.server);
            this.plans[plan.server.hostname] = plan;
        }
        ns.atExit(this.tearDown.bind(this));
    }

    tearDown() {
        this.running = false;
    }

    async work() {
        const {ns, targets} = this;

        this.running = true;
        while (this.running && this.backend.running) {
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

        // Decide whether prep is needed.
        // TODO: use params to set 'secMargin' input to this function.
        // TODO: keep track of server "safe" time versus "active" time, to avoid unnecessary prep.
        const isPrepBatch = !server.isPrepared();

        // Plan a batch based on target state and parameters
        const batch = isPrepBatch ? server.planPrepBatch(params) : server.planHackingBatch(params);

        // Schedule the batch
        if (!server.nextFreeTime) {
            batch.setStartTime(now);
            server.nextFreeTime = now + batch.totalDuration(params.tDelta) - batch.activeDuration(params.tDelta);
        }
        batch.setFirstEndTime(server.nextFreeTime);
        batch.ensureStartInFuture(now, params.tDelta);
        if (batch.earliestStartTime() < now) {
            ns.tprint("ERROR: batch.earliestStartTime was inconsistent")
        }

        // Add an `onFinish` callback to check batch results for desync
        batch[batch.length-1].onFinish = (job)=>{
            if (!this.running) {return;}
            const expectedServer = job.result;
            const actualServer = job.result.copy().reload();
            if (actualServer.hackDifficulty > expectedServer.hackDifficulty) {
                ns.print(`WARNING: desync detected after batch ${batchID}. Reloading server state and adjusting parameters.`);
                server.reload();
                const newParams = server.mostProfitableParamsSync(this.params);
                this.plans[server.hostname] = server.planBatchCycle(newParams);
                server.reload();
            }
            // console.log(`Finished batch ${batchID}. Expected security:`, job.result.hackDifficulty, "Actual:", job.result.copy().reload().hackDifficulty);
        }

        // Dispatch the batch
        const result = await this.backend.dispatchJobs(batch, isPrepBatch); // TODO: use isPrepBatch to allow dispatchJobs to shift jobs farther into the future
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
        if (isPrepBatch) {
            server.nextStartTime = batch.lastEndTime() + params.tDelta;
        }
        else {
            server.nextFreeTime = batch.lastEndTime() + params.tDelta + batchCycle.timeBetweenStarts;
            server.nextStartTime = batch.earliestStartTime() - params.tDelta + batchCycle.timeBetweenStarts;
        }
        await ns.asleep(server.nextStartTime - Date.now()); // this should be timeBetweenStarts before the following batch's earliest start
    }
}
