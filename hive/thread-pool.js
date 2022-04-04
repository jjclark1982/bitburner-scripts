import { ServerPool } from "net/server-pool.js";
import { drawTable } from "lib/box-drawing.js";

const FLAGS = [
    ["port", 1],
    ["verbose", false]
];

const SCRIPT_CAPABILITIES = {
    "/hive/worker.js": ['hack', 'grow', 'weaken']
};

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

    const threadPool = new ThreadPool({ns, ...flags});
    eval("window").db = threadPool;
    
    // const spec = [
    //     {threads: 10},
    //     {threads: 20},
    //     {threads: 30},
    //     {threads: 40},
    //     {threads: 50, startTime: Date.now() + 1000}
    // ];
    // await threadPool.getWorkers(spec);
    // await ns.asleep(2000);
    // await threadPool.getWorkers(spec);

    await threadPool.work();
}

export class ThreadPool {
    constructor({ns, port, verbose}) {    
        this.ns = ns;
        this.portNum = port;
        this.port = ns.getPortHandle(this.portNum);
        this.process = ns.getRunningScript();
        this.workers = {};
        this.nextWorkerID = 1;

        this.port.clear();
        this.port.write(this);

        ns.atExit(this.stop.bind(this));

        ns.print(`Started ThreadPool on port ${this.portNum}.`);
    }

    async work() {
        const {ns} = this;
        while(true) {
            ns.clearLog();
            ns.print(this.report());
            await ns.asleep(200);
        }
    }

    stop() {
        for (const worker of Object.values(this.workers)) {
            worker.running = false;
        }
        this.ns.getPortHandle(this.portNum).clear();
    }

    async dispatchJobs(batch) {
        const workers = await this.getWorkers(batch);
        if (!workers) {
            ns.tprint(`Failed to allocate workers for batch.`);
            return;
        }
        for (const job of batch) {
            await this.dispatchJob(job);
        }
    }

    async dispatchJob(job) {
        if (job.threads == 0) {
            return true;
        }
        const worker = await this.getWorker(job);
        return worker?.addJob(job);
    }

    async getWorkers(specs) {
        // Get a block of workers matching certain specs.
        // Returns an array of Worker objects if all specs could be satisfied.
        // Returns null if any spec could not be satisfied.
        const workers = {};
        for (const spec of specs) {
            if (spec.threads == 0) {
                continue;
            }
            const worker = await this.getWorker({...spec, exclude:workers});
            if (!worker) {
                return null;
            }
            workers[worker.id] = worker;
            // TODO: Lock this worker for this job (if the whole batch can be met)
            //     worker.nextFreeTime = startTime-1;
        }
        return workers;
    }

    async getWorker({threads, startTime, func, exclude}) {
        // Get a new or existing worker with the requested specs:
        // - has at least `threads` threads
        // - has capability to perform the function `func`,
        // - is available by `startTime`
        exclude ||= {};
        startTime ||= Date.now();
        const capabilities = func ? [func] : [];
        const matchingWorkers = Object.values(this.workers).filter((worker)=>(
            !exclude[worker.id] && 
            worker.running &&
            worker.nextFreeTime < startTime &&
            worker.process?.threads >= threads &&
            capabilities.every((func)=>func in worker.capabilities)
        )).sort((a,b)=>(
            a.threads - b.threads
        ));
        const worker = matchingWorkers[0];
        if (worker) {
            return worker;
        }
        else {
            return await this.spawnWorker(threads, capabilities);
        }
    }
    
    async spawnWorker(threads, capabilities) {
        // Create a new worker with `threads` threads.
        // (Ignores number of CPU cores.)
        const {ns, portNum} = this;
        threads = Math.ceil(threads);

        // Assign unique workerID.
        while (this.nextWorkerID in this.workers) {
            this.nextWorkerID++;
        }
        const worker = {
            id: this.nextWorkerID++,
            running: false
        };
        this.workers[worker.id] = worker;

        // Find a suitable server.
        const script = getScriptWithCapabilities(capabilities);
        if (!script) {
            this.logWarn(`Failed to start worker with ${threads} threads: No script capable of ${JSON.stringify(capabilities)}.`);
            return null;
        }
        const serverPool = new ServerPool({ns, scriptRam: script});
        const server = serverPool.smallestServerWithThreads(threads);
        if (!server) {
            this.logWarn(`Failed to start worker with ${threads} threads: Not enough RAM on any available server.`);
            return null;
        }
        if ((server.availableThreads - threads < 4) || (threads > server.availableThreads * 3 / 4)) {
            // Round up a process size to fill an entire server.
            // worker.id = `${server.hostname}-${worker.id}`;
            threads = server.availableThreads;
        }

        // Spawn the worker process.
        const args = ["--port", portNum, "--id", worker.id];
        const pid = await serverPool.deploy({server, script, threads, args});
        this.workers[worker.id].process = {pid, threads};
        if (!pid) {
            this.logWarn(`Failed to start worker ${worker.id}.`);
            return null;
        }
        this.logInfo(`Running worker ${worker.id} (PID ${pid}) with ${threads} threads on ${server.hostname}.`);
        return worker;
    }

    registerWorker(worker) {
        const {ns} = this;
        // Link this worker and pool to each other
        const launchedWorker = this.workers[worker.id];
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

    findWorkerProcess(worker) {
        const {ns} = this;
        const scriptName = worker.ns.getScriptName();
        const args = worker.ns.args;
        const serverPool = new ServerPool({ns});
        for (const server of serverPool) {
            const process = this.ns.getRunningScript(scriptName, server.hostname, ...args);
            if (process) {
                return process;
            }
        }
        return null;
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
            if (!t) {
                return '';
            }
            return ns.nFormat(t, "0a");
        }
        const now = Date.now();
        const columns = [
            {header: "Worker", field: "id"},
            {header: "Threads", field: "threads", format: [formatThreads]},
            {header: "Queue", field: "queue"},
            {header: "Task  ", field: "task"},
            {header: "Elapsed ", field: "elapsedTime", format: drawTable.time},
            {header: "Remaining", field: "remainingTime", format: drawTable.time, formatArgs: [2]},
            {header: "Drift  ", field: "drift" }
        ];
        columns.title = `Thread Pool (Port ${this.portNum})`;
        const rows = Object.values(this.workers).map((worker)=>workerReport(worker, now));
        return drawTable(columns, rows);
    }
}

function getScriptWithCapabilities(capabilities) {
    for (const [script, caps] of Object.entries(SCRIPT_CAPABILITIES)) {
        if (capabilities.every((func)=>caps.includes(func))) {
            return script;
        }
    }
    return null;
}

function workerReport(worker, now) {
    now ||= Date.now();
    return {
        id: worker.id,
        threads: [worker.currentJob?.threads, worker.process?.threads],
        queue: worker.jobQueue?.length,
        task: worker.currentJob?.func,
        elapsedTime: worker.elapsedTime? worker.elapsedTime(now) : null,
        remainingTime: worker.remainingTime? worker.remainingTime(now) : null,
        drift: worker.drift ? worker.drift.toFixed(0) + ' ms' : ''
    };
}
