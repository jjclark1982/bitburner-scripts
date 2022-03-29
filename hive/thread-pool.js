import { ServerPool } from "hive/server-pool.js";
import { drawTable } from "hive/table.js";

const FLAGS = [
    ["port", 1],
    ["verbose", false]
];

const SCRIPT_CAPABILITIES = {
    "/hive/worker.js": ['hack', 'grow', 'weaken']
};

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("asleep");
    ns.disableLog("scan");
    ns.disableLog("scp");
    ns.disableLog("exec");
    ns.clearLog();

    const flags = ns.flags(FLAGS);

    const threadPool = new ThreadPool(ns, flags.port, flags.verbose);
    window.db = threadPool;
    
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
    constructor(ns, portNum, verbose) {    
        this.ns = ns;
        this.portNum = portNum;
        this.process = ns.getRunningScript();
        this.workers = {};
        this.nextWorkerID = 1;

        const portHandle = ns.getPortHandle(this.portNum);
        portHandle.clear();
        portHandle.write(this);
    
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
        return await this.getWorker(job)?.addJob(job);
    }

    async getWorkers(specs) {
        // Get a block of workers matching certain specs.
        // Returns an array of Worker objects if all specs could be satisfied.
        // Returns null if any spec could not be satisfied.
        const workers = {};
        for (const spec of specs) {
            const worker = await this.getWorker({...spec, exclude:workers});
            if (!worker) {
                return null;
            }
            workers[worker.id] = worker;
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
            worker.process.threads >= threads &&
            worker.nextFreeTime < startTime &&
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
        // Ignores number of CPU cores.
        const {ns, portNum} = this;

        threads = Math.ceil(threads);
        let workerID = this.nextWorkerID++;
        const script = getScriptWithCapabilities(capabilities);
        if (!script) {
            this.logWarn(`Failed to start worker with ${threads} threads: No script capable of ${JSON.stringify(capabilities)}.`);
            return null;
        }
        const scriptRam = ns.getScriptRam(script, 'home');
        const neededRam = scriptRam * threads;
    
        const serverPool = new ServerPool(ns, scriptRam);
        const server = serverPool.smallestServersWithThreads(threads)[0];
        if (!server) {
            this.logWarn(`Failed to start worker with ${threads} threads: Not enough RAM on any available server.`);
            return null;
        }
        if ((server.availableThreads - threads < 4) || (threads > server.availableThreads / 2)) {
            // workerID = `${server.hostname}-${workerID}`;
            threads = server.availableThreads;
        }
        const args = ["--port", portNum, "--id", workerID];
        const pid = await serverPool.runOnServer({server, script, threads, args});

        if (!pid) {
            this.logWarn(`Failed to start worker ${workerID}.`);
            return null;
        }
        if (!this.workers[workerID]) {
            // Give the process a moment to launch.
            await ns.asleep(100);
        }
        this.workers[workerID] ||= {id: workerID}; // Create a placeholder if necessary.
        const worker = this.workers[workerID];
        worker.process = ns.getRunningScript(pid);
        this.logInfo(`Running worker ${workerID} with ${worker.process.threads} threads on ${worker.process.server}.`);
        return worker;
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
        const now = Date.now();
        const columns = [
            {header: "Worker", field: "id"},
            {header: "Threads", field: "threads", format: "fraction"},
            {header: "Queue", field: "queue"},
            {header: " Task ", field: "task"},
            {header: " Elapsed", field: "elapsedTime", format: "time"},
            {header: "Remaining", field: "remainingTime", format: "time", precision: 2},
            {header: " Drift ", field: "drift" }
        ];
        const rows = Object.values(this.workers).map((worker)=>worker.report(now));
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
