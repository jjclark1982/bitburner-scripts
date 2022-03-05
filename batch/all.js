import { mostProfitableServers, planHack, planWeaken, planGrow, BATCH_SCRIPTS } from "batch/rank-targets.js";
import { getServerPool, runBatchOnPool, copyToPool } from "batch/pool.js";

const FLAGS = [
    ["help", false],
    ["tDelta", 100],
    ["moneyPercent", 0.25]
];
const t0_by_target = {};

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("scan");
    ns.disableLog("asleep");
    const args = ns.flags(FLAGS);
    args.ns = ns;
    if (args.help) {
        ns.tprint("This script manages batches of hack/weaken/grow/weaken cycles against multiple target servers.");
        ns.tprint(`Usage: run ${ns.getScriptName()}`);
        return;
    }
    if (args._.length > 0) {
        args.targets = args._;
        delete args._;
    }
    if (args.targets === undefined) {
        args.targets = mostProfitableServers(ns).slice(0,8);
    }

    // ns.clearLog();
    // ns.tail();

    await copyToPool(ns, BATCH_SCRIPTS);

    while (true) {
        runMultiHWGW(args);
        await ns.asleep(4 * args.tDelta);
    }
}

export function runMultiHWGW(params) {
    const {ns, targets} = params;
    const serverPool = getServerPool(ns);

    let threadsUsed = 0;
    for (const target of targets) {
        threadsUsed += runHWGW({...params, target});
        if (threadsUsed > serverPool.totalThreads * 0.9) {
            break;
        }
    }
}

export function runHWGW(params) {
    const {ns, target, tDelta} = params;

    if (t0_by_target[params.target] === undefined) {
        const w0Job = planWeaken(params);
        runBatchOnPool(ns, [w0Job]);
        t0_by_target[params.target] = Date.now() + w0Job.time;
    }
    const t0 = t0_by_target[params.target];

    const hJob  = planHack({  ...params, difficulty:0,               endTime: t0 + 1 * tDelta});
    const w1Job = planWeaken({...params, difficulty:hJob.security+1, endTime: t0 + 2 * tDelta});
    const gJob  = planGrow({  ...params, difficulty:0,               endTime: t0 + 3 * tDelta});
    const w2Job = planWeaken({...params, difficulty:gJob.security+1, endTime: t0 + 4 * tDelta});

    const batch = [hJob, w1Job, gJob, w2Job];

    runBatchOnPool(ns, batch);
    t0_by_target[params.target] = w2Job.endTime;

    const threadsUsed = hJob.threads + w1Job.threads + gJob.threads + w2Job.threads;
    return threadsUsed;
}
