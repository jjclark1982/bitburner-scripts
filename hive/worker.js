const FLAGS = [
    ["port", 1],
    ["id"],
    ["verbose", false]
];

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("asleep");

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
        this.ns = ns;
        this.verbose = flags.verbose;
        this.capabilities = capabilities;
        this.pool = ns.getPortHandle(flags.port).peek();
        this.nextFreeTime = Date.now();
        this.jobQueue = [];
        this.currentJob = {
            startTime: Date.now()
        };
        this.running = true;
        this.process = this.pool.workers[id]?.process;

        this.pool.workers[id] = this;

        ns.atExit(this.stop.bind(this));

        this.logInfo(`Worker ${this.id} started.`);
    }

    async work() {
        while (this.running) {
            await this.ns.asleep(1000);
            // await ns.asleep(this.nextFreeTime + 1000 - Date.now());
            // this.nextFreeTime = Math.max(this.nextFreeTime, Date.now());
        }
        this.logInfo(`Worker ${this.id} stopping.`);
    }

    stop() {
        delete this.pool.workers[this.id];
    }

    addJob(job) {
        const {ns} = this;
        const now = Date.now();
        if (!job.startTime) {
            job.startTime = now;
        }
        if (job.startTime <= Math.max(now, this.nextFreeTime)) {
            return false;
        }
        this.jobQueue.push(job);
        this.nextFreeTime = job.endTime;
        setTimeout(this.runJob.bind(this), job.startTime - now);
        return true;
    }

    async runJob() {
        const job = this.jobQueue.shift(); // are we sure that it is the next one? double check start time
        const {func, args, startTime, endTime} = job;
        this.currentJob = job;
        this.drift = Date.now() - job.startTime;
        await this.capabilities[func](...args);
        this.currentJob = {
            startTime: Date.now()
        };
        this.drift = Date.now() - job.endTime;
    }

    logInfo(...args) {
        const {ns} = this;
        if (this.verbose) {
            ns.tprint(...args);
        }
        else {
            ns.print(...args);
        }
    }

    elapsedTime(now) {
        now ||= Date.now();
        if (this.currentJob.startTime) {
            return now - this.currentJob.startTime;
        }
        else {
            return null;
        }
    }

    remainingTime(now) {
        now ||= Date.now();
        let endTime;
        if (this.currentJob.endTime) {
            endTime = this.currentJob.endTime;
        }
        else if (this.currentJob.startTime && this.currentJob.duration) {
            endTime = this.currentJob.startTime + this.currentJob.duration;
        }
        else if (this.jobQueue.length > 0) {
            endTime = this.jobQueue[0].startTime;
        }
        if (endTime) {
            return endTime - now;
        }
        else {
            return null;
        }
    }

    report(now) {
        const ns = this.pool.ns; // use other process to format text during task
        now ||= Date.now();
        return {
            id: this.id,
            threads: [this.currentJob?.threads, this.process?.threads],
            queue: this.jobQueue.length,
            task: this.currentJob.func,
            elapsedTime: this.elapsedTime(now),
            remainingTime: this.remainingTime(now),
            drift: this.drift ? this.drift.toFixed(0) + ' ms' : ''
        };
    }
}
