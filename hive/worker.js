const FLAGS = [
    ["port", 1],
    ["id"],
];

/** @param {NS} ns **/
export async function main(ns) {
    // List the functions this worker is capable of, for RAM calculation.
    const capabilities = {
        "hack": ns.hack,
        "grow": ns.grow,
        "weaken": ns.weaken
    }
    const worker = new Worker(ns, capabilities);
    await worker.work();
}

class Worker {
    constructor(ns, capabilities) {
        const flags = ns.flags(FLAGS);
        const id = flags.id;

        this.id = id;
        this.capabilities = capabilities;
        this.pool = ns.getPortHandle(flags.port).peek();
        this.process = this.pool.workers[id]?.process;
        this.ns = ns;
        this.nextFreeTime = Date.now();
        this.jobQueue = [];
        this.running = true;

        this.pool.workers[id] = this;

        ns.atExit(this.stop.bind(this));

        this.pool.ns.print(`Worker ${this.id} started.`);
    }

    async work() {
        while (this.running) {
            await this.ns.asleep(1000);
            // await ns.asleep(this.nextFreeTime + 1000 - Date.now());
            // this.nextFreeTime = Math.max(this.nextFreeTime, Date.now());
        }
        this.pool.ns.print(`Worker ${this.id} stopping.`);
    }

    stop() {
        delete this.pool.workers[this.id];
    }

    addJob(job) {
        const {ns} = this;
        const now = Date.now();
        if (job.startTime < Math.max(now, this.nextFreeTime)) {
            return false;
        }
        jobQueue.push(job);
        this.nextFreeTime = job.endTime;
        setTimeout(this.runJob.bind(this), job.startTime - now);
        return true;
    }

    async runJob() {
        const job = this.jobQueue.shift(); // are we sure that it is the next one? double check start time
        const {func, args, startTime, endTime} = job;
        ns.tprint(`Worker ${this.id} started ${func}. (${job.startTime} - ${Date.now()} = ${job.startTime - Date.now()})`);
        await this.capabilities[func](...args);
        ns.tprint(`Worker ${this.id} finished ${func}. (${job.endTime} - ${Date.now()} = ${job.endTime - Date.now()})`);
    }
}
