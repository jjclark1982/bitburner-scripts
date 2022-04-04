import { getThreadPool } from "/hive/worker";

const FLAGS = [
    ["port", 1]
];

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("asleep");
    const flags = ns.flags(FLAGS)
    await stopWorkers(ns, flags.port);
}

export async function stopWorkers(ns, portNum) {
    const threadPool = await getThreadPool(ns, portNum) || {workers:[]};

    // gracefully stop all workers
    for (const worker of Object.values(threadPool.workers)) {
        worker.running = false;
    }
    await ns.asleep(2000);
    for (const worker of Object.values(threadPool.workers)) {
        if (worker?.process) {
            ns.kill(worker.process.pid);
        }
    }
    await ns.asleep(2000);

    // gracefully stop the thread pool
    threadPool.running = false;
    await ns.asleep(2000);
    ns.kill(threadPool.process.pid);
}
