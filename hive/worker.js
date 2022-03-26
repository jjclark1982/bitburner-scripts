const FLAGS = [
    ["port", 1],
    ["id"],
];

/** @param {NS} ns **/
export async function main(ns) {
    // List the functions this worker is capable of, for RAM calculation.
    const functions = {
        "hack": ns.hack,
        "grow": ns.grow,
        "weaken": ns.weaken
    }
    await runWorker(ns, functions);
}

export async function runWorker(ns, functions) {
    const flags = ns.flags(FLAGS);
    const port = ns.getPortHandle(flags.port);
    const id = flags.id;

    const db = port.peek();
    db.workers[id] ||= {};
    const worker = db.workers[id];

    Object.assign(worker, {
        id: id,
        ns: ns,
        functions: functions,
        nextFreeTime: Date.now(),
        jobQueue: [],
        running: true,
        scheduleJob: ((job)=>{
            const now = Date.now();
            if (job.startTime < Math.max(now, worker.nextFreeTime)) {
                return false;
            }
            jobQueue.push(job);
            const {func, args, startTime, endTime} = job;
            worker.nextFreeTime = job.endTime;
            setTimeout(()=>{
                // worker.jobQueue.shift();
                ns.tprint(`Worker ${id} started ${func}. (${job.startTime}, ${Date.now()})`);
                await worker.functions[func](...args);
                ns.tprint(`Worker ${id} finished ${func}. (${job.endTime}, ${Date.now()})`);
            }, job.startTime - now);
            return true;
        })
    });

    ns.atExit(function(){
        delete db.workers[id];
    });

    ns.tprint(`Worker ${id} starting.`);
    while (worker.running) {
        await ns.asleep(worker.nextFreeTime + 1000 - Date.now());
        worker.nextFreeTime = Math.max(worker.nextFreeTime, Date.now());
    }
    ns.tprint(`Worker ${id} exiting.`);
};
