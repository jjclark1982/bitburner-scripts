const FLAGS = [
    ["port", 3],
    ["id"],
    ["tDelta", 1000]
];

/** @param {NS} ns **/
export async function main(ns) {
    // List the functions this worker is capable of, for static RAM calculation.
    const capabilities = {
        "hack": ns.hack,
        "grow": ns.grow,
        "weaken": ns.weaken
    }
    const worker = new Worker(ns, capabilities);
    await worker.work();
}

export class Worker {
    constructor(ns, capabilities={}) {
        ns.disableLog("asleep");

        const flags = ns.flags(FLAGS);

        this.id = flags.id;
        this.portNum = flags.port;
        this.tDelta = flags.tDelta;
        this.ns = ns;
        this.scriptName = ns.getScriptName();
        this.capabilities = capabilities;
        this.description = `${this.shortCaps()}${this.id || '???'}`
        this.nextFreeTime = performance.now() + flags.tDelta;
        this.jobQueue = [];
        this.currentJob = {
            startTime: performance.now()
        };
        this.running = false;

        ns.atExit(this.tearDown.bind(this));
    }

    async work() {
        let {ns} = this;
        // Register with the thread pool.
        this.pool = await getThreadPool(ns, this.portNum);
        if (!this.pool) {
            ns.tprint(`Worker unable to find ThreadPool on port ${this.portNum}. Exiting.`);
            return;
        }
        this.nextFreeTime = performance.now();
        this.pool.registerWorker(this);
        ns.print(`Worker ${this.id} registered with thread pool. Starting work.`);
        // Block until something sets running to false
        this.running = true;
        while (this.running || this.currentJob.task) {
            await ns.asleep(1000);
            // Terminate a worker that has not been used in a while.
            if (!this.currentJob.task && this.jobQueue.length == 0 && this.elapsedTime() > 1*60*1000) {
                this.running = false;
            }
        }
        ns.print(`Worker ${this.id} stopping.`);
    }

    tearDown() {
        this.running = false;
        // When this worker exits for any reason, remove it from the pool database.
        if (this.pool?.removeWorker) {
            this.pool.removeWorker(this.id);
        }
    }

    shortCaps() {
        if (Object.keys(this.capabilities).length == 1) {
            const cap = Object.keys(this.capabilities)[0];
            return `${cap.substr(0,1)}`;
        }
        return '*';
    }

    addJob(job) {
        if (!this.running) {
            return false;
        }

        const {ns} = this;
        const now = performance.now();

        // Validate job parameters.
        job.args ||= [];
        if (!job.startTime) {
            job.startTime = this.nextFreeTime + this.tDelta;
        }
        if (job.startTime < Math.max(now, this.nextFreeTime)) {
            const drift = job.startTime - Math.max(now, this.nextFreeTime);
            console.log(`Worker ${this.id} declined job: ${job.task} ${JSON.stringify(job.args)} (${drift.toFixed(0)} ms)`);
            return false;
        }
        if (!job.endTime && job.duration) {
            job.endTime = job.startTime + job.duration
        }

        // Schedule the job to run.
        this.jobQueue.push(job);
        this.nextFreeTime = job.endTime + this.tDelta;
        setTimeout(()=>{
            this.runNextJob(job);
        }, job.startTime - now);
        // console.log(`Worker ${this.id} accepted job: ${job.task} ${JSON.stringify(job.args)} (${(job.startTime - now).toFixed(0)} ms)`);
        return true;
    }

    async runNextJob(expectedJob) {
        if (!this.running) {
            return;
        }
        if (this.currentJob.task) {
            setTimeout(()=>{
                this.runNextJob(expectedJob);
            }, this.tDelta);
            console.log([
                `ERROR: Worker ${this.id} tried to start ${this.jobQueue[0]?.task} before finishing ${this.currentJob.task}`,
                `current end: ${this.currentJob.endTime}, next start: ${this.jobQueue[0].startTime} (${this.jobQueue[0].startTime - this.currentJob.endTime})`,
                `now: ${performance.now()}, expected start time: ${expectedJob.startTime}`
            ].join('\n'));
            return;
        }
        
        // Take the next job from the queue.
        const job = this.jobQueue.shift();

        // Run a 'shouldStart' callback if provided.
        if (typeof(job.shouldStart) === 'function') {
            if (!job.shouldStart(job)) {
                job.cancelled = true;
                if (this.jobQueue.length == 0) {
                    this.nextFreeTime = performance.now();
                }
                return;
            }
        }

        // Record actual start time.
        job.startTimeActual = performance.now();
        this.drift = job.startTimeActual - job.startTime;
        this.ns.print(`Starting job: ${job.task} ${JSON.stringify(job.args)} (${this.drift.toFixed(0)} ms)`);

        // Run the task.
        this.currentJob = job;
        job.resultActual = await this.capabilities[job.task](...(job.args||[]));

        // Record actual end time.
        job.endTimeActual = performance.now();
        job.durationActual = job.endTimeActual - job.startTimeActual;
        this.drift = job.endTimeActual - job.endTime;
        this.ns.print(`Completed job: ${job.task} ${JSON.stringify(job.args)} (${this.drift.toFixed(0)} ms)`);

        // Mark this worker as idle.
        this.currentJob = {
            startTime: performance.now()
        };

        // Run an 'didFinish' callback if provided.
        if (typeof(job.didFinish) === 'function') {
            job.didFinish(job);
        }
    }

    elapsedTime(now) {
        now ||= performance.now();
        if (this.currentJob.startTime) {
            return now - this.currentJob.startTime;
        }
        else {
            return null;
        }
    }

    remainingTime(now) {
        now ||= performance.now();
        let endTime;
        if (this.currentJob.endTime) {
            endTime = this.currentJob.endTime;
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
}

export async function getThreadPool(ns, portNum=3) {
    const port = ns.getPortHandle(portNum);
    let tries = 50;
    while (port.empty() && tries-- > 0) {
        await ns.asleep(50);
    }
    if (port.empty()) {
        return null;
    }
    return port.peek();
}
