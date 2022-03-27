const FLAGS = [
    ["port", 1]
];

/** @param {NS} ns **/
export async function main(ns) {
    await killWorkers(ns);
}

export async function killWorkers(ns) {
    const flags = ns.flags(FLAGS);
    const port = ns.getPortHandle(flags.port);

    const db = port.peek();
    for (const worker of Object.values(db.workers)) {
        worker.running = false;
    }
    await ns.sleep(2000);
    for (const script of Object.values(db.scripts)) {
        if (worker?.process) {
            ns.kill(worker.process.pid);
        }
    }
}
