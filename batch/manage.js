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
    ["moneyPercent", 0.10]
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
        await ns.asleep(4 * args.tDelta);
    }
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

    const hJob  = planHack({  ...params, difficulty:0,               endTime: t0 + 1 * tDelta});
    const w1Job = planWeaken({...params, difficulty:hJob.security+1, endTime: t0 + 2 * tDelta});
    const gJob  = planGrow({  ...params, difficulty:0,               endTime: t0 + 3 * tDelta});
    const w2Job = planWeaken({...params, difficulty:gJob.security+1, endTime: t0 + 4 * tDelta});

    const batch = [hJob, w1Job, gJob, w2Job];

    await runBatchOnPool({ns}, batch);
    t0_by_target[params.target] = w2Job.endTime + tDelta;

    const threadsUsed = hJob.threads + w1Job.threads + gJob.threads + w2Job.threads;
    return threadsUsed;
}
