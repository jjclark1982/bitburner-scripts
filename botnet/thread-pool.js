import { drawTable } from "/lib/box-drawing";
import { Batch } from "/hacking/batch-model";
import { PortService } from "/lib/port-service";
import { ServerPool } from "/net/deploy-script"; // this is the main RAM cost, it could go in a separate process

const FLAGS = [
    ["port", 3],
    ["verbose", false],
    ["test", false]
];

const SCRIPT_CAPABILITIES = [
    {script: "/botnet/worker-hack.js", capabilities: ['hack'], dependencies: ["/botnet/worker.js"]},
    {script: "/botnet/worker-grow.js", capabilities: ['grow'], dependencies: ["/botnet/worker.js"]},
    {script: "/botnet/worker-weaken.js", capabilities: ['weaken'], dependencies: ["/botnet/worker.js"]},
    {script: "/botnet/worker.js", capabilities: ['hack', 'grow', 'weaken']}
];

/*

Overall process:
pool, manager, and workers launch in any order.
pool publishes itself on a port.
other scripts wait until they see something on that port.
workers then call pool.registerWorker(this)

*/

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("asleep");
    ns.disableLog("scan");
    ns.disableLog("scp");
    ns.disableLog("exec");
    ns.clearLog();

    const flags = ns.flags(FLAGS);
    flags.ns = ns;

    const threadPool = new ThreadPool(flags);
    
    if (flags.test) {
        setTimeout(async function(){
            const spec = [
                {threads: 10},
                {threads: 20},
                {threads: 30},
                {threads: 40},
                {threads: 50, startTime: performance.now() + 1000}
            ];
            await threadPool.getWorkers(spec);
            await ns.asleep(2000);
            await threadPool.getWorkers(spec);
        }, 100)
    }

    await threadPool.serve();
}

export class ThreadPool extends PortService {
    constructor({ns, port}) {
        super(ns, port);
        this.serverPool = new ServerPool(ns, {logLevel: 0});

        this.process = ns.getRunningScript();
        this.workers = {};
        this.nextWorkerID = 1;

        ns.print(`Started ThreadPool on port ${this.portNum}.`);
    }

    tearDown() {
        this.running = false;
        // When the pool process exits, signal all the workers and clients to stop.
        for (const worker of Object.values(this.workers)) {
            worker.running = false;
            // worker.ns.exit();  // this can be useful for debugging
        }
        PortService.prototype.tearDown.call(this);
    }

    async dispatchJobs(batch, {allowPartial, allowDelay}={}) {
        // Get workers (this can take some time due to launching and registering)
        const workers = await this.getWorkers(batch, {allowPartial, allowDelay});
        if (!workers) {
            this.ns.tprint(`Failed to allocate workers for batch.`);
            return null;
        }
        // Update batch schedule after getting workers
        if (typeof(batch.ensureStartInFuture === 'function')) {
            batch.ensureStartInFuture(performance.now());
        }
        // Dispatch each job
        const results = [];
        for (const job of batch) {
            const result = await this.dispatchJob(job, {allowDelay});
            results.push(result);
            if (!result) {
                // TODO: shift this and following jobs to future
            }
        }
        return results;
    }

    async dispatchJob(job, {allowDelay}={}) {
        if (job.threads <= 0) {
            return true;
        }
        job.threads ||= 1;
        const worker = await this.getWorker({...job, allowDelay});
        return worker?.addJob(job);
    }

    /**
     * Get a block of workers matching certain specs.
     * @param {array} specs 
     * @param {object} params
     * @returns {array} Worker objects if all specs could be satisfied, or null.
     */
    async getWorkers(specs, {allowPartial, allowDelay}) {
        const workers = {};
        for (const spec of specs) {
            if (spec.threads == 0) {
                continue;
            }
            const worker = await this.getWorker({...spec, exclude:workers});
            if (worker) {
                workers[worker.id] = worker;
            }
            else if (!allowPartial) {
                return null;
            }
            // TODO: Lock this worker for this job (if the whole batch can be met)
            //     worker.nextFreeTime = startTime-1;
        }
        return workers;
    }

    /**
     * Get a new or existing worker with the requested specs:
     * - has at least `threads` threads
     * - has capability to perform the function `task`,
     * - is available by `startTime`
     * @param {object} spec
     * @returns {Worker}
     */
    async getWorker({threads, startTime, task, exclude}) {
        exclude ||= {};
        startTime ||= performance.now();
        const capabilities = task ? [task] : [];
        const matchingWorkers = Object.values(this.workers).filter((worker)=>(
            !exclude[worker.id] && 
            worker.running &&
            !(worker.nextFreeTime > startTime) &&
            worker.process.threads >= threads &&
            worker.process.threads < threads*2 &&
            capabilities.every((task)=>task in worker.capabilities)
        )).sort((a,b)=>(
            a.process?.threads - b.process?.threads
        ));
        const worker = matchingWorkers[0];
        if (worker) {
            return worker;
        }
        else {
            return await this.spawnWorker(threads, capabilities);
        }
    }
    
    /** Create a new worker with `threads` threads (ignores number of CPU cores) */
    async spawnWorker(threads, capabilities) {
        const {ns, portNum} = this;
        threads = Math.ceil(threads);

        // Find a suitable script.
        let {script, dependencies} = getScriptWithCapabilities(capabilities);
        if (!script) {
            this.logWarn(`Failed to start worker with ${threads} threads: No script capable of ${JSON.stringify(capabilities)}.`);
            return null;
        }

        // Find a suitable server.
        const scriptRam = ns.getScriptRam(script, 'home');
        const server = this.serverPool.getSmallestServers({scriptRam, threads})[0];
        if (!server) {
            this.logWarn(`Failed to start worker with ${threads} threads: Not enough RAM on any available server.`);
            return null;
        }
        // Promote the worker to a larger or more capable one if the server is nearly full.
        if (server.availableRam >= 2.0 * threads && server.availableRam < 2.5 * threads) {
            script = getScriptWithCapabilities(['hack', 'grow', 'weaken']).script;
            dependencies = [];
            threads = Math.floor(server.availableRam / 2.0);
        }

        // Create the worker process.
        while (this.nextWorkerID in this.workers) {
            this.nextWorkerID++;
        }
        const workerID = this.nextWorkerID++;
        this.workers[workerID] = {
            id: workerID,
            running: false
        };
        const args = ["--port", portNum, "--id", workerID];
        const {pid} = await this.serverPool.deploy({server, script, threads, args, dependencies});
        if (!pid) {
            this.logWarn(`Failed to start worker ${workerID}.`);
            delete this.workers[workerID];
            return null;
        }
        this.workers[workerID].process = {pid, threads};
        this.logInfo(`Started worker ${workerID} (PID ${pid}) with ${threads} threads on ${server.hostname}.`);

        // Wait for the worker process to register with us.
        while (!this.workers[workerID].running) {
            await ns.asleep(20);
        }
        return this.workers[workerID];
    }

    /** Link this worker and pool to each other */
    registerWorker(worker) {
        const {ns} = this;
        const launchedWorker = this.workers[worker.id];
        if (launchedWorker?.running) {
            // If multiple workers claim the same ID, stop the older one.
            launchedWorker.running = false;
        }
        if (launchedWorker?.process) {
            // Fill in process information if we already know the PID
            worker.process = ns.getRunningScript(launchedWorker.process.pid);
        }
        else {
            // Otherwise search for the process (it may have launched on page load)
            worker.process = this.findWorkerProcess(worker);
        }
        this.workers[worker.id] = worker;
    }

    /** Locate the process for a script that wasn't launched by this pool (such as after reload from save) */
    findWorkerProcess(worker) {
        const {ns} = this;
        const scriptName = worker.ns.getScriptName();
        const args = worker.ns.args;
        for (const server of this.serverPool) {
            const process = this.ns.getRunningScript(scriptName, server.hostname, ...args);
            if (process) {
                return process;
            }
        }
        return null;
    }

    removeWorker(workerID) {
        // const worker = this.workers[workerID];
        // if (this.running) {
        //     worker.process = this.ns.getRunningScript(worker.process.pid);
        //     this.process.offlineExpGained += worker.process.offlineExpGained;
        //     this.process.offlineMoneyMade += worker.process.offlineMoneyMade;
        //     this.process.onlineExpGained += worker.process.onlineExpGained;
        //     this.process.onlineMoneyMade += worker.process.onlineMoneyMade;
        // }
        delete this.workers[workerID];
    }

    getMaxTotalRam() {
        const {ns} = this;
        const scriptRam = 1.75;
        const threads = Object.values(this.workers).reduce((total, worker)=>(
            total + (worker.process?.threads || 0)
        ), this.serverPool.totalThreadsAvailable(scriptRam));
        return threads * scriptRam;
    }

    getMaxThreadsPerJob() {
        const {ns} = this;
        const scriptRam = 1.75;
        const potentialThreads = Math.floor(this.serverPool.maxThreadsAvailable(scriptRam) / 4);
        const maxThreads = Object.values(this.workers).reduce((total, worker)=>(
            Math.max(total, worker.process?.threads || 0)
        ), potentialThreads);
        return maxThreads;
    }

    getOnlineMoneyMade() {
        return Object.values(this.workers).reduce((total, worker)=>(
            total + (this.ns.getRunningScript(worker.process.pid).onlineMoneyMade || 0)
        ), this.process.onlineMoneyMade);
    }

    logWarn(...args) {
        this.ns.tprint(...args);
    }

    logInfo(...args) {
        if (this.verbose) {
            this.ns.tprint(...args);
        }
    }

    report() {
        const {ns} = this;
        const formatThreads = function(t){
            if (!t) { return ''; }
            return ns.nFormat(t, "0a");
        }
        const now = performance.now();
        const columns = [
            {header: "Worker", field: "description"},
            {header: " Threads ", field: "threads", format: [formatThreads]},
            {header: "Task", field: "task", width: 6, align: "center"},
            {header: "Queue", field: "queue", align: "left", truncate: true},
            {header: "Elapsed ", field: "elapsedTime", format: drawTable.time},
            {header: "Remaining", field: "remainingTime", format: drawTable.time, formatArgs: [2]},
            {header: "Drift   ", field: "drift" }
        ];
        let moneyMade = this.getOnlineMoneyMade();
        const moneyPerSec = ns.nFormat((moneyMade / (ns.getRunningScript().onlineRunningTime)) || 0, "$0,0.0a")
        moneyMade = ns.nFormat(moneyMade, "$0,0.0a");
        columns.title = `Thread Pool (Port ${this.portNum}) Money made: ${moneyMade} (${moneyPerSec} / sec)`;
        const rows = Object.values(this.workers).map((worker)=>workerReport(worker, now));
        return drawTable(columns, rows);
    }
}

function getScriptWithCapabilities(caps) {
    for (const workerType of SCRIPT_CAPABILITIES) {
        if (caps.every((task)=>workerType.capabilities.includes(task))) {
            return workerType;
        }
    }
    return null;
}

function workerReport(worker, now) {
    now ||= performance.now();
    return {
        description: worker.description || worker.id,
        threads: [worker.currentJob?.threads, worker.process?.threads],
        task: worker.currentJob?.task,
        queue: (new Batch(...(worker.jobQueue || []))).summary(),
        elapsedTime: worker.elapsedTime? worker.elapsedTime(now) : null,
        remainingTime: worker.remainingTime? worker.remainingTime(now) : null,
        drift: worker.drift ? worker.drift.toFixed(0) + ' ms' : ''
    };
}
