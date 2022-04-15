import { getThreadPool } from "/hive/worker";
import { HackableServer } from "/hacking/planner";

const FLAGS = [
    ["help", false],
    ["backendPort", 3],        // default port for ThreadPool
    ["tDelta", 100],           // milliseconds between effects
    ["maxTotalRam", 0],        // optional (will be read from backend)
    ["maxThreadsPerJob", 128], // TODO: read this from backend
    ["reserveRam", true],      // whether to calculate batch RAM requirement based on peak amount
    ["prepMargin", 0.5],       // how much security level to allow between "grow" operations
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
        const now = Date.now() + params.tDelta;

        const prepBatch = server.planPrepBatch(this.params);

        prepBatch.setStartTime(now);
        await this.backend.dispatchJobs(prepBatch);
        server.nextStartTime = prepBatch.lastEndTime();
    }
}
