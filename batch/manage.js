import { mostProfitableTargets, planHack, planWeaken, planGrow, BATCH_SCRIPTS } from "batch/analyze.js";
import { getServerPool, runBatchOnPool, copyToPool } from "batch/pool.js";


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
const t0_by_target = {};
const next_start_by_target = {};

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

    const args = ns.flags(FLAGS);
    args.ns = ns;
    if (args.help) {
        ns.tprint("This script manages batches of hack/weaken/grow/weaken cycles against multiple target servers.");
        ns.tprint(`Usage: run ${ns.getScriptName()} [target...]`);
        ns.tprint(`Exmaple: run ${ns.getScriptName()} ecorp foodnstuff`);
        return;
    }
    if (args._.length > 0) {
        args.targets = args._;
        delete args._;
    }

    await copyToPool({ns}, BATCH_SCRIPTS);

    while (true) {
        const serverPool = getServerPool({ns});
        await runMultiHWGW({...args, serverPool});
        await ns.asleep(getNextBatchDelay());
    }
}

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
        targets = mostProfitableTargets(ns).slice(0,8);
    }

    serverPool.threadsUsed ||= 0;
    for (const target of targets) {
        if (serverPool.threadsUsed > serverPool.totalThreads * 0.9) {
            break;
        }
        serverPool.threadsUsed += await runHWGW({...params, target});
    }
}

export async function runHWGW(params) {
    const {ns, target, tDelta} = params;

    if (t0_by_target[params.target] === undefined) {
        const w0Job = planWeaken(params);
        await runBatchOnPool({ns}, [w0Job]);
        t0_by_target[params.target] = Date.now() + w0Job.time;
    }
    const t0 = t0_by_target[params.target];

    const hJob  = planHack({  ...params, endTime: t0 + 1*tDelta, security:0 });
    const w1Job = planWeaken({...params, endTime: t0 + 2*tDelta, security:hJob.security+1 });
    const gJob  = planGrow({  ...params, endTime: t0 + 3*tDelta, security:0, moneyPercent: hJob.moneyMult*0.95});
    const w2Job = planWeaken({...params, endTime: t0 + 4*tDelta, security:gJob.security+1 });

    const batch = [hJob, w1Job, gJob, w2Job];

    await runBatchOnPool({ns}, batch);
    t0_by_target[params.target] = w2Job.endTime + tDelta;
    next_start_by_target[params.target] = w1Job.startTime + 5 * tDelta;

    const threadsUsed = hJob.threads + w1Job.threads + gJob.threads + w2Job.threads;
    return threadsUsed;
}
