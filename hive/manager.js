import { planHack, planWeaken, planGrow } from "batch/analyze.js";

const t0_by_target = {};
const next_start_by_target = {};

const FLAGS = [
    ["help", false],
    ["port", 1],
    ["moneyPercent", 0.05],
    ["tDelta", 100]
];

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("asleep");
    ns.clearLog();

    const flags = ns.flags(FLAGS);
    const {port, moneyPercent, tDelta} = flags;
    const targets = flags._;
    const target = targets[0];

    if (flags.help || targets.length == 0) {
        ns.tprint("manage hacking a target");
        return;
    }

    const threadPool = ns.getPortHandle(port).peek();

    const batch = planHWGW({ns, target, moneyPercent, tDelta})

    ns.print("batch:", JSON.stringify(batch, null, 2));
    ns.tail();
}

export function planHWGW(params) {
    const {ns, target, moneyPercent, tDelta} = params;

    if (t0_by_target[params.target] === undefined) {
        const w0Job = planWeaken(params);
        t0_by_target[params.target] = Date.now() + w0Job.time;
    }
    const t0 = t0_by_target[params.target];

    const hJob  = planHack({  ...params, endTime: t0 + 1*tDelta, security:0 });
    const w1Job = planWeaken({...params, endTime: t0 + 2*tDelta, security:hJob.security*1.1 });
    const gJob  = planGrow({  ...params, endTime: t0 + 3*tDelta, security:0, moneyPercent: hJob.moneyMult*0.95});
    const w2Job = planWeaken({...params, endTime: t0 + 4*tDelta, security:gJob.security*1.1 });

    const batch = [hJob, w1Job, gJob, w2Job];

    return batch;

    t0_by_target[params.target] = w2Job.endTime + tDelta;
    next_start_by_target[params.target] = w1Job.startTime + 5 * tDelta;

    const threadsUsed = hJob.threads + w1Job.threads + gJob.threads + w2Job.threads;
    return threadsUsed;
}
