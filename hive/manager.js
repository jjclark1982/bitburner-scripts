import { getThreadPool } from "/hive/worker";
import { planHack, planWeaken, planGrow } from "batch/analyze.js";

/*

-> create a dashboard showing target information
    - number of jobs dispatched
    - number of jobs pending?
    - cycle duration
    - latestEndTime
    - latestStartTime

Then the general process for a target is:
    sleep until nextStartTime-ε
    plan a batch:
        if money is high: hack
        while sec is high: weaken
        while money is low: grow
        while sec is high: weaken
    (This can result in the typical prep WGW and typical batch HWGW, but also HGHGHGW)
*/

class MultiHackManager {
    constructor(ns, targets) {
        const now = Date.now();
        this.targets = Object.fromEntries(targets.map((target)=>(
            [target, new HackManager(ns, target)]
        )))
    }
}

class HackManager {
    constructor(ns, target, threadPool) {
        this.ns = ns;
        this.target = target;
        this.latestStartTime = Date.now();
        this.latestEndTime = null;
        this.threadPool = threadPool;
    }

    estimateProfit() {}

    planBatch() {}

    runBatch(batch) {}

    planPrep(server, t0) {
        const {ns} = this;
        server ||= ns.getServer(this.hostname);
        const batch = [];
        const workers = {};
        while (server.hackDifficulty > server.minDifficulty) {
            const {nextServer, change, job} = this.planWeaken(server, maxThreads);
            batch.push(job);
            // need to know endTime to set startTime (doable)
            // need to know startTime to select host.
            // need to know host to set maxThreads.
            // TODO: write threadPool.maxThreadsAtTime(startTime)

            // select a worker after defining job, and exclude it from the rest of this batch
            worker = self.threadPool.getWorker({...job, exclude:workers});
            if (worker) {
                workers[worker.id] = worker;
                server = nextServer;
            }
            else {
                // this step failed, maybe try a smaller maxThreads?
                return null
            }
        }
        while (server.moneyAvailable < server.moneyMax) {
            const {nextServer, change, job} = this.planWeaken(server);
            batch.push(job);
            server = nextServer;
        }
        server.moneyAvailable = server.moneyMax;

    }

    planWeaken(server, maxThreads, cores=1) {
        const {ns} = this;
        server ||= ns.getServer(this.target);
        const player = ns.getPlayer();
    
        const weakTime = ns.formulas.hacking.weakenTime(server, player);
        const weakSecPerThread = -ns.weakenAnalyze(1, cores);
        const weakSecurity = server.minDifficulty - server.hackDifficulty;
        const weakThreads = Math.min(maxThreads, Math.ceil(weakSecurity / weakSecPerThread));
        const effectiveSecurity = ns.weakenAnalyze(weakThreads, cores);

        const nextServer = {
            ...server,
            hackDifficulty: Math.max(server.minDifficulty, server.hackDifficulty - effectiveSecurity)
        };
        const change = {
            security: nextServer.hackDifficulty - server.hackDifficulty,
            moneyMult: nextServer.money / server.money
        };
        const job = {
            task: 'weaken',
            args: [server.hostname, {threads: weakThreads}],
            threads: weakThreads,
            duration: weakTime,
            result: nextServer
        };

        return {
            nextServer,
            change,
            job
        }
    }
}



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
    const {moneyPercent, tDelta} = flags;
    const targets = flags._;
    const target = targets[0];

    delete t0_by_target[target];

    if (flags.help || targets.length == 0) {
        ns.tprint("manage hacking a target");
        return;
    }

    const threadPool = await getThreadPool(ns, flags.port);

    const batch = planHWGW({ns, target, moneyPercent, tDelta})

    await threadPool.dispatchJobs(batch);

    ns.print("batch:", JSON.stringify(batch, null, 2));
    ns.tail();
}


export function planHWGW(params) {
    const {ns, target, moneyPercent, tDelta} = params;

    const batch = [];

    if (t0_by_target[target] === undefined) {
        const w0Job = planWeaken(params);
        batch.push(w0Job);
        t0_by_target[target] = Date.now() + w0Job.duration;
    }
    const t0 = t0_by_target[target];

    // given an initial hack percentage and thread pool,
    // maintain a virtual server object,
    // and keep adding viable WGW jobs until it reaches equilibrium. (same as prep)
    // to check if a step is viable, need to know the max threads available in the pool,
    // or maintain an exclusion list.

    const hJob  = planHack({  ...params, endTime: t0 + 1*tDelta, security:0 });
    const w1Job = planWeaken({...params, endTime: t0 + 2*tDelta, security:hJob.security*1.1 });
    const gJob  = planGrow({  ...params, endTime: t0 + 3*tDelta, security:0, moneyPercent: hJob.moneyMult*0.95});
    const w2Job = planWeaken({...params, endTime: t0 + 4*tDelta, security:gJob.security*1.1 });

    batch.push(hJob, w1Job, gJob, w2Job);

    for (const job of batch) {
        job.args.push({threads: job.threads});
        // TODO: set {stock: true} for grow jobs if we hold a long position
        //       set {stock: true} for hack jobs if we hold a short position
    }

    t0_by_target[target] = w2Job.endTime + tDelta;
    next_start_by_target[target] = w1Job.startTime + 5 * tDelta;
    const threadsUsed = hJob.threads + w1Job.threads + gJob.threads + w2Job.threads;

    return batch;
}
