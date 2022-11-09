import { ServerPool } from "/net/deploy-script";
import { HackPlanner, HackableServer } from "/hacking/planner";

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

    const serverPool = new ServerPool(ns, {logLevel: 4, logFunc: ns.print});

    let batchID = 0;
    while (!server.reload().isPrepared()) {
        batchID++;
        const batch = server.planPrepBatch(params);
        ns.print(`INFO: batch: ${batch.longSummary()}`);
        const scriptJobs = batch.convertToScripts({batchID, reserveRam: true});

        // await serverPool.deployBatch(scriptJobs, {requireAll: false});
        for (const job of scriptJobs) {
            const result = await serverPool.deploy(job, {allowSplit: true});
            if (Array.isArray(result)) {
                if (!result[result.length-1].pid) {
                    break;
                }
            }
            else if (!result.pid) {
                break;
            }
        }
        for (const job of scriptJobs) {
            if (job.process?.pid) {
                while (ns.isRunning(job.process.pid)) {
                    await ns.asleep(1000);
                }
            }
        }
    }
    ns.tprint(`INFO: ${server.hostname} is prepared for hacking.`);
}
