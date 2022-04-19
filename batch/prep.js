import { ServerPool } from "/net/deploy-script";
import { HackPlanner, HackableServer } from "/hacking/planner";
import { convertToScripts } from "/batch/manage.js";

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
            "Prepare servers for hacking.", "",
            `Usage: run ${ns.getScriptName()} [target...]`, "",
            `Exmaple: run ${ns.getScriptName()} ecorp foodnstuff`, " "
        ].join("\n"));
        return;
    }

    for (const target of args._) {
        await runPrep({...args, target});
    }
    await ns.asleep(1*1000);
}

export async function runPrep(params) {
    const {ns, target, tDelta} = params;
    const server = new HackableServer(ns, target);

    const batch = server.planPrepBatch(params);
    convertToScripts(batch);
    ns.tprint(`batch: ${batch.longSummary()}`);

    const serverPool = new ServerPool(ns, {logLevel: 4});
    await serverPool.deployBatch(batch);    
    return batch;
}
