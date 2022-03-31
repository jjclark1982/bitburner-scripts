import { planHack, planWeaken, planGrow, BATCH_SCRIPTS } from "batch/analyze.js";
import { runBatchOnPool, copyToPool } from "batch/pool.js";

const FLAGS = [
    ["help", false],
    ["tDelta", 1000],
    ["reserveRam", true]
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

    const args = ns.flags(FLAGS);
    args.ns = ns;
    if (args.help) {
        ns.tprint([
            "Prepare servers for hacking.",
            "",
            `Usage: run ${ns.getScriptName()} [target...]`,
            "",
            `Exmaple: run ${ns.getScriptName()} ecorp foodnstuff`,
            " "
        ].join("\n"));
        return;
    }

    for (const target of args._) {
        await copyToPool({ns}, BATCH_SCRIPTS);
        await runPrep({...args, target});
    }
    await ns.asleep(1*1000);
}

export async function runPrep(params) {
    const {ns, target, tDelta} = params;
    const server = ns.getServer(target);
    const money = Math.max(1,server.moneyAvailable);
    const moneyMax = Math.max(1,server.moneyMax);
    const moneyPercent = money / moneyMax;

    const w0Job = planWeaken(params);
    const t0 = Date.now() + w0Job.duration;
    const gJob  = planGrow({  ...params, endTime: t0 + 1*tDelta, security:0, moneyPercent: moneyPercent });
    const w2Job = planWeaken({...params, endTime: t0 + 2*tDelta, security:gJob.security+1 });

    const batch = [w0Job, gJob, w2Job];

    ns.print("batch: ", JSON.stringify(batch, null, 2));

    await runBatchOnPool({ns}, batch);

    return batch;
}
