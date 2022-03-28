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
        this.logInfo(`Worker ${this.id} started ${func}. (${timeError(Date.now(), job.startTime)})`);
        await this.capabilities[func](...args);
        this.currentJob = {
            startTime: Date.now()
        };
        this.logInfo(`Worker ${this.id} finished ${func}. (${timeError(Date.now(), job.endTime)})`);
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
        let threads = '';
        if (this.process) {
            threads = ns.nFormat(this.process.threads, "0,0");
        }
        if (this.currentJob?.threads) {
            threads = ns.nFormat(this.currentJob.threads, "0,0") + ' / ' + threads;
        }
        let elapsedTime = tFormat(this.elapsedTime(now));
        let remainingTime = tFormat(this.remainingTime(now), 2);
        return sprintf(" %6s │ %9s │ %5s │ %6s │ %8s │ %9s",
            this.id,
            threads,
            this.jobQueue.length || '',
            this.currentJob.func || '',
            elapsedTime || '',
            remainingTime || ''
        );
    }
}

function timeError(actual, expected) {
    const tErr = actual - expected;
    return `${tErr > 0 ? '+' : ''}${tErr} ms`;
}

function tFormat(timeMS, precision=0) {
    if (!timeMS) {
        return '';
    }
    const d = new Date(2000, 1, 1, 0, 0, timeMS/1000)
    let timeStr = d.toTimeString().slice(0,8);
    if (timeMS >= 60 * 60 * 1000) {
        timeStr = timeStr.slice(0,8);
    }
    else if (timeMS >= 10 * 60 * 1000) {
        timeStr = timeStr.slice(3,8);
    }
    else {
        timeStr = timeStr.slice(4,8);
    }
    if (precision > 0) {
        let msStr = (timeMS / 1000 - Math.floor(timeMS/1000)).toFixed(precision);
        timeStr += msStr.substring(1);
    }
    return timeStr;
}
