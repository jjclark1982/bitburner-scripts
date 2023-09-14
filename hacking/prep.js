import { getThreadPool } from "/botnet/worker";
import { HackableServer } from "/hacking/planner";

const FLAGS = [
    ["help", false],
    ["backendPort", 3],        // default port for ThreadPool
    ["tDelta", 100],           // milliseconds between effects
    ["maxTotalRam", 0],        // optional (will be read from backend)
    ["maxThreadsPerJob", 0],   // optional (will be read from backend)
    ["reserveRam", true],      // whether to calculate batch RAM requirement based on peak amount
    ["secMargin", 0.5],        // how much security level to allow between "grow" operations
    ["naiveSplit", false],     // whether to split large jobs based solely on thread count
    ["cores", 1],              // not currently used
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog('scan');
    ns.disableLog('asleep');
    ns.clearLog();
    const flags = ns.flags(FLAGS);
    if (flags.help) {
        ns.tprint("Prepare a server for hacking.")
        return;
    }
    delete flags.help;

    const backend = await getThreadPool(ns, flags.backendPort);
    delete flags.backendPort;

    flags.maxTotalRam ||= backend.getMaxTotalRam();
    flags.maxThreadsPerJob ||= backend.getMaxThreadsPerJob();

    const targets = flags._;
    delete flags._;

    const manager = new PrepManager(ns, backend, targets, flags)
    await manager.work();
}

export class PrepManager {
    constructor(ns, backend, targets=[], params={}) {
        this.ns = ns;
        this.backend = backend;
        this.params = params;

        this.targets = targets.map((hostname)=>(
            new HackableServer(ns, hostname)
        ));
    }

    async work() {
        const {ns, targets} = this;

        for (const target of this.targets) {
            await this.prepTarget(target);
        }
    }

    async prepTarget(server) {
        const {ns, params} = this;
        const now = performance.now() + params.tDelta;

        // TODO: investigate infinite loop in this program when very little RAM is available. it is happening in 'manager.js' too.

        const prepBatch = server.planPrepBatch(this.params);
        prepBatch.setStartTime(now);
        
        for (const job of prepBatch) {
            let result = await this.backend.dispatchJob(job); // TODO: confirm that this job can be added to an existing queue
            while (!result) {
                await ns.asleep(1000);
                let result = await this.backend.dispatchJob(job);
            }
        }
        if (prepBatch.length > 0) {
            server.nextStartTime = prepBatch.lastEndTime();
            await ns.asleep(prepBatch.lastEndTime() - performance.now());
        }
        ns.tprint(`INFO: ${server.hostname} is prepared for hacking.`);
    }
}
