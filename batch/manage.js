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

TODO: include a "maxThreads" limit when planning a batch, maybe use it to dynamically adjust moneyPercent
TODO: calculate batch stats (init time, RAM/batch, ideal $/batch, total RAM)

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

    const serverPool = new ServerPool(ns, {logLevel: 4});
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
    return earliestStart - Date.now() - 100;
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

export async function runHWGW(params) {
    const {ns, target, tDelta, serverPool} = params;
    const server = new HackableServer(ns, target);

    if (t0_by_target[target] === undefined) {
        const batch = server.planPrepBatch(params);
        convertToScripts(batch, params);
        await serverPool.deployBatch(batch);
        t0_by_target[target] = Date.now() + batch.totalDuration(tDelta);
        return batch.peakThreads();
    }
    const t0 = t0_by_target[target];

    const batch = server.planHackingBatch(params);
    batch.setFirstEndTime(t0, tDelta);

    convertToScripts(batch, params);
    adjustSchedule(batch);
    await serverPool.deployBatch(batch);
    t0_by_target[target] = batch.lastEndTime() + tDelta;
    next_start_by_target[target] = batch.earliestStartTime() + 5 * tDelta;

    const threadsUsed = batch.peakThreads();
    return threadsUsed;
}

const TASK_TO_SCRIPT = {
    'hack': '/batch/hack.js',
    'grow': '/batch/grow.js',
    'weaken': '/batch/weaken.js'
};
let batchID = 0;
export function convertToScripts(jobs=[], params={}) {
    for (const [index, job] of jobs.entries()) {
        job.script = TASK_TO_SCRIPT[job.task];
        const options = job.args.pop();
        // if (options.stock) {
        //     job.args.push('--stock');
        // }
        job.args.push(`batch-${batchID++}.${index+1}`);
		if (params.reserveRam && job.startTime) {
			job.args.push('--startTime');
			job.args.push(job.startTime);
            delete job.startTime;
		}
        job.allowSplit = true;
    }
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
    let startTimeAdjustment = Date.now() - earliestStartTime;
    if (startTimeAdjustment > 0) {
        startTimeAdjustment += 100;
        ns.print(`Adjusting start time by ${startTimeAdjustment}`);
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
