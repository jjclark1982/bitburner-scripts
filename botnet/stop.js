import { getThreadPool } from "/botnet/worker";

const FLAGS = [
    ["port", 3],
    ["force", false]
];

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("asleep");
    const flags = ns.flags(FLAGS)
    await stopWorkers(ns, flags.port, flags.force);
}

export async function stopWorkers(ns, portNum, force) {
    const threadPool = await getThreadPool(ns, portNum) || {workers:[]};

    // gracefully stop the thread pool
    threadPool.running = false;

    // gracefully stop all workers
    for (const worker of Object.values(threadPool.workers)) {
        worker.running = false;
    }

    if (force) {
        // terminate the pool
        await ns.asleep(2000);
        if (threadPool?.process?.pid) {
            ns.kill(threadPool.process.pid);
        }
    
        // terminate remaining workers
        await ns.asleep(1000);
        for (const worker of Object.values(threadPool.workers)) {
            if (worker?.process?.pid) {
                ns.kill(worker.process.pid);
            }
        }
    }
}
