import { getThreadPool } from "/hive/worker";
import { ServerModel } from "/hacking/planner";
import { serverPool } from "/net/server-pool";

const FLAGS = [
    ["help", false],
    ["backend", "thread-pool"],
    ["port", 3],
    ["tDelta", 100],
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

    let backend;
    if (flags.backend == "thread-pool") {
        backend = await getThreadPool(ns, flags.port);
    }
    delete flags.backend;
    delete flags.port;

    const targets = flags._;
    delete flags._;
    if (!flags.maxTotalRam) {
        const pool = serverPool(ns);
        const availableRam = pool.totalRam - pool.totalUsedRam;
        // reserve at most 1 TB of ram for other purposes
        flags.maxTotalRam = Math.max(availableRam*0.9, availableRam-1024);
    }

    const manager = new PrepManager(ns, backend, targets, flags)
    await manager.work();
}

export class PrepManager {
    constructor(ns, backend, targets=[], params={}) {
        this.ns = ns;
        this.backend = backend;
        this.params = params;

        this.targets = targets.map((hostname)=>(
            new ServerModel(ns, hostname)
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
