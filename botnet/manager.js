import { getThreadPool } from "/botnet/worker";
import { HackableServer, HackPlanner } from "/hacking/planner";
import { renderBatches, logHTML } from "/hacking/batch-view";

const FLAGS = [
    ["help", false],
    ["backendPort", 3],        // default port for ThreadPool
    ["tDelta", 100],           // milliseconds between effects
    ["maxTotalRam", 0],        // optional (will be read from backend)
    ["maxThreadsPerJob", 0],   // optional (will be read from backend)
    ["moneyPercent", 0.05],    // (will be overwritten by optimizer)
    ["secMargin"],             // security margin, eg 0 for HWGW
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
    if (typeof(flags.secMargin) !== "undefined") {
        flags.secMargin = parseInt(flags.secMargin);
    }

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
        this.allBatches = [];
        this.serverSnapshots = [];
        this.t0 = performance.now();

        this.targets = [];
        this.plans = {};
        const planner = new HackPlanner(ns, params);
        for (const plan of planner.mostProfitableServers(params, targets)) {
            const target = plan.server;
            target.expectedSecurity = [[performance.now(), target.hackDifficulty]];
            this.targets.push(target);
            this.plans[target.hostname] = plan;
        }
        ns.atExit(this.tearDown.bind(this));

        eval("window").hackManager = this;
    }

    tearDown() {
        this.running = false;
    }

    async work() {
        const {ns, targets} = this;

        this.running = true;
        this.startAnimation();
        while (this.running && this.backend.running) {
            const target = this.targets[0];
            await this.hackOneTargetOneTime(target);
            // TODO: re-select optimal target as conditions change

            // ns.clearLog();
            // ns.print(this.report());

            // this.report();
        }
    }

    async hackOneTargetOneTime(server) {
        const {ns} = this;
        const batchCycle = this.plans[server.hostname];
        const params = batchCycle.params;
        const now = performance.now() + params.tDelta;
        const prevServer = server.copy();
        const batchID = this.batchID++;

        // TODO: slice target.expectedSecurity to only items after now

        // Decide whether prep is needed.
        const isPrepBatch = !server.isPrepared();

        // Plan a batch based on target state and parameters
        const batch = isPrepBatch ? server.planPrepBatch(params) : server.planHackingBatch(params);
        if (batch.length == 0) {
            ns.print("ERROR: batch was empty");
            await ns.asleep(1000);
            server.reload();
            return;
        }

        // Schedule the batch
        if (!server.nextFreeTime) {
            batch.setStartTime(now);
            server.nextFreeTime = now + batch.totalDuration(params.tDelta) - batch.activeDuration(params.tDelta);
        }
        batch.setFirstEndTime(server.nextFreeTime, params.tDelta);
        batch.ensureStartInFuture(now, params.tDelta);
        batch.scheduleForSafeWindows(params.tDelta, server.expectedSecurity)

        // Add callbacks to check for desync
        for (const job of batch) {
            job.shouldStart = this.shouldStart.bind(this);
            job.didFinish = this.didFinish.bind(this);
        }
        batch[batch.length-1].didFinish = this.didFinish.bind(this);

        // Dispatch the batch
        const result = await this.backend.dispatchJobs(batch, {allowPartial: isPrepBatch}); // TODO: use isPrepBatch to allow dispatchJobs to shift jobs farther into the future
        if (!result) {
            // If dispatch failed, rollback state
            ns.print(`WARNING: Failed to dispatch batch ${batchID}: ${batch.summary()} batch for ${server.hostname}. Skipping this batch.`);
            server.reload(prevServer);
            await ns.asleep(1000);
            return;
        }

        ns.print(`Dispatched batch ${batchID}: ${batch.moneySummary()} ${batch.summary()} batch for ${server.hostname}`);
        for (const job of batch) {
            server.expectedSecurity.push([job.endTime, job.result.hackDifficulty]);
        }
        // Update the schedule for this target, and block until the schedule is free.
        if (isPrepBatch) {
            server.nextStartTime = batch.lastEndTime() + params.tDelta;
        }
        else {
            server.nextFreeTime = batch.lastEndTime() + params.tDelta; // * 2
            server.nextStartTime = batch.earliestStartTime() - params.tDelta + batchCycle.timeBetweenStarts; // TODO: update timeBetweenStarts based on current RAM
        }
        this.allBatches.push(batch);
        await ns.asleep(server.nextStartTime - performance.now()); // this should be timeBetweenStarts before the following batch's earliest start
    }

    shouldStart(job) {
        const {ns} = this;
        const actualServer = job.result.copy().reload();
        this.serverSnapshots.push([performance.now(), actualServer]);
        if (job.task == 'weaken') {
            return true;
        }
        if (job.task == 'hack' && !this.running) {
            return false;
        }
        if (actualServer.hackDifficulty > job.startDifficulty) {
            // if (job.task == 'grow') {
            //     ns.print(`INFO: Reducing threads for ${job.task} job: ${actualServer.hackDifficulty.toFixed(2)} > ${job.startDifficulty.toFixed(2)} security.`);
            //     job.threads /= 2;
            //     job.args[1].threads = job.threads;
            //     return true;
            // }
            ns.print(`WARNING: Cancelling ${job.task} job: ${actualServer.hackDifficulty.toFixed(2)} > ${job.startDifficulty.toFixed(2)} security.`);
            return false;
        }
        return true;
    }

    didFinish(job) {
        const {ns} = this;
        const server = this.targets.find((s)=>s.hostname === job.result.hostname);
        if (!this.running || !server) {
            return;
        }
        const expectedServer = job.result;
        const actualServer = job.result.copy().reload();
        this.serverSnapshots.push([performance.now(), actualServer]);
        if (actualServer.hackDifficulty > expectedServer.hackDifficulty) {
            ns.print(`WARNING: desync detected after batch ${this.batchID}. Reloading server state and adjusting parameters.`);
            server.reload(actualServer);
            // TODO: move this slow calculation to before/after a prep cycle in the main loop
            const newParams = server.mostProfitableParamsSync(this.params);
            this.plans[server.hostname] = server.planBatchCycle(newParams);
            server.reload();
            server.expectedSecurity = [[performance.now(), server.hackDifficulty]];
        }
        // console.log(`Finished batch ${batchID}. Expected security:`, job.result.hackDifficulty, "Actual:", job.result.copy().reload().hackDifficulty);
    }

    startAnimation() {
        const {ns} = this;
        ns.print("Visualization of hacking operations:");
        this.animationEl = renderBatches();
        logHTML(ns, this.animationEl);
        requestAnimationFrame(this.updateAnimation.bind(this));
    }

    updateAnimation() {
        if (!this.running) {
            return;
        }
        requestAnimationFrame(this.updateAnimation.bind(this));
        this.animationEl = renderBatches(this.animationEl, this.allBatches, this.serverSnapshots);
    }
}

