import { mostProfitableServers, planHack, planWeaken, planGrow } from "batch/rank-targets.js";
import { getServerPool, runOnPool, runBatchOnPool, copyToPool } from "batch/pool.js";

const HACK = "/batch/hack.js";
const GROW = "/batch/grow.js";
const WEAKEN = "/batch/weaken.js";
const BATCH_SCRIPTS = [HACK, GROW, WEAKEN];

const FLAGS = [
    ["help", false],
    ["tDelta", 100],
    ["moneyPercent", 0.25]
];

const t0_by_target = {};
let batch_id = 0;

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
        ns.tprint("This script manages batches of hack/weaken/grow/weaken cycles against a target server.");
        ns.tprint(`Usage: run ${ns.getScriptName()}`);
        return;
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
    const {ns} = params;

    const targets = mostProfitableServers(ns);
    const serverPool = getServerPool(ns);
    let threadsUsed = 0;

    for (const target of targets.slice(0,8)) {
        threadsUsed += runHWGW({...params, target});
        if (threadsUsed > serverPool.totalThreads * 0.9) {
            break;
        }
    }
}

export function runHWGW(params) {
    const {ns, target, tDelta} = params;

    batch_id += 1;
    if (t0_by_target[params.target] === undefined) {
        const w0Job = planWeaken(params);
        w0Job.args = [target];
        runOnPool({...w0Job, ns});
        t0_by_target[params.target] = Date.now() + w0Job.time;
    }
    const t0 = t0_by_target[params.target];

    const hJob = planHack({...params, difficulty:0});
    hJob.startTime = t0 + 1 * tDelta - hJob.time;
    hJob.args = [target, batch_id];

    const w1Job = planWeaken({...params, difficulty:hJob.security+1});
    w1Job.startTime = t0 + 2 * tDelta - w1Job.time;
    w1Job.args = [target, batch_id];

    const gJob = planGrow({...params, difficulty:0});
    gJob.startTime = t0 + 3 * tDelta - gJob.time;
    gJob.args = [target, batch_id];

    const w2Job = planWeaken({...params, difficulty:gJob.security+1});
    w2Job.startTime = t0 + 4 * tDelta - w2Job.time;
    w2Job.args = [target, batch_id + 0.5];

    const batch = [hJob, w1Job, gJob, w2Job];

    runBatchOnPool(ns, batch);
    t0_by_target[params.target] = t0 + 4 * tDelta;

    const threadsUsed = hJob.threads + w1Job.threads + gJob.threads + w2Job.threads;
    return threadsUsed;
}
