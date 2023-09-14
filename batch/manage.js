import { ServerPool } from "/net/deploy-script";
import { HackPlanner, HackableServer } from "/hacking/planner";

/*

batch-based hacking using a pool of hosts

list all usable hosts
    calculate total number of 1.75gb RAM slots
    skip hacknet servers and home server
identify most profitable targets
for each target:
    schedule a net-positive HWGW batch that will fit in available RAM
    allocate each job to one or more hosts when needed

*/


const FLAGS = [
    ["help", false],
    ["tDelta", 100],
    ["moneyPercent", 0.05],
    ["reserveRam", false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("scan");
    ns.disableLog("asleep");
    ns.disableLog("exec");
    ns.disableLog("scp");
    ns.clearLog();
    // ns.tail();

    const flags = ns.flags(FLAGS);
    flags.ns = ns;
    if (flags.help) {
        ns.tprint("This script manages batches of hack/weaken/grow/weaken cycles against multiple target servers.");
        ns.tprint(`Usage: run ${ns.getScriptName()} [target...]`);
        ns.tprint(`Exmaple: run ${ns.getScriptName()} ecorp foodnstuff`);
        return;
    }
    if (flags._.length > 0) {
        flags.targets = flags._;
        delete flags._;
    }

    const serverPool = new ServerPool(ns, {logLevel: 4, logFunc: ns.print});
    while (true) {
        await runMultiHWGW({...flags, serverPool});
        await ns.asleep(getNextBatchDelay());
    }
}

const t0_by_target = {};
const next_start_by_target = {};
const SCRIPT_RAM = 1.75;

function getNextBatchDelay() {
    let earliestStart = Infinity;
    for (const startTime of Object.values(next_start_by_target)) {
        if (startTime < earliestStart) {
            earliestStart = startTime;
        }
    }
    return earliestStart - performance.now() - 100;
}

export async function runMultiHWGW(params) {
    let {ns, serverPool, targets} = params;

    if (targets === undefined) {
        // continually recalculate most profitable targets
        const hackPlanner = new HackPlanner(ns);
        targets = hackPlanner.mostProfitableServers(params).map((plan)=>plan.server.hostname).slice(0,8);
    }

    serverPool.threadsUsed = 0;
    for (const target of targets) {
        if (serverPool.threadsUsed > serverPool.totalThreadsAvailable(SCRIPT_RAM) * 0.9) {
            break;
        }
        serverPool.threadsUsed += await runHWGW({...params, target});
    }
}

let batchID = 0;
export async function runHWGW(params) {
    const {ns, target, tDelta, serverPool} = params;
    const server = new HackableServer(ns, target);
    batchID++;

    if (t0_by_target[target] === undefined) {
        const batch = server.planPrepBatch(params);
        const scripts = convertToScripts({batchID});
        await serverPool.deployBatch(scripts);
        t0_by_target[target] = performance.now() + scripts.totalDuration(tDelta);
        return batch.peakThreads();
    }
    const t0 = t0_by_target[target];

    const batch = server.planHackingBatch(params);
    batch.setFirstEndTime(t0, tDelta);
    adjustSchedule(batch);

    const scripts = batch.convertToScripts({batchID});
    await serverPool.deployBatch(scripts);
    t0_by_target[target] = scripts.lastEndTime() + tDelta;
    next_start_by_target[target] = scripts.earliestStartTime() + 5 * tDelta;

    const threadsUsed = batch.peakThreads();
    return threadsUsed;
}

function adjustSchedule(jobs=[]) {
    let earliestStartTime = Infinity;
    for (const job of jobs) {
        if (job.startTime !== undefined && job.startTime < earliestStartTime) {
            earliestStartTime = job.startTime;
        }
        else if (job.args?.includes('--startTime') && job.args[job.args.indexOf('--startTime')+1] < earliestStartTime) {
            earliestStartTime = job.args[job.args.indexOf('--startTime')+1];
        }
    }

    // If planned start time was in the past, shift entire batch to future
    // and update times in-place.
    let startTimeAdjustment = performance.now() - earliestStartTime;
    if (startTimeAdjustment > 0) {
        startTimeAdjustment += 100;
        console.log(`Adjusting start time by ${startTimeAdjustment}`);
        for (const job of jobs) {
            if ('startTime' in job) {
                job.startTime += startTimeAdjustment;
            }
            if ('endTime' in job) {
                job.endTime += startTimeAdjustment;
            }
            if (job.args?.includes('--startTime')) {
                job.args[job.args.indexOf('--startTime')+1] += startTimeAdjustment;
            }
        }
    }
}
