import { runMaxThreadsOnHost, getAllHosts } from "net/lib.js";
import { getServerPool } from "batch/pool.js";

const FLAGS = [
    ["port", 1]
];

const WORKER = "/hive/worker.js";

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("asleep");
    ns.disableLog("scan");
    ns.disableLog("scp");
    ns.disableLog("exec");
    ns.clearLog();

    const flags = ns.flags(FLAGS);

    const threadPool = new ThreadPool(ns, flags.port);
    window.db = threadPool;
    
    const spec = [
        {threads: 10},
        {threads: 20},
        {threads: 30},
        {threads: 40},
        {threads: 50, freeTime: Date.now() - 60*1000}
    ];
    await threadPool.getWorkers(spec);
    await ns.asleep(2000);
    await threadPool.getWorkers(spec);
    await threadPool.work();
}

class ThreadPool {
    constructor(ns, portNum) {        
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
        while(true) {
            await this.ns.asleep(1000);
        }
    }

    stop() {
        for (const worker of Object.values(this.workers)) {
            worker.running = false;
        }
        this.ns.getPortHandle(this.portNum).clear();
    }

    async getWorkers(specs) {
        // Get a block of workers matching certain specs.
        // Returns an array of Worker objects if all specs could be satisfied.
        // Returns null if any spec could not be satisfied.
        const workers = {};
        for (const {threads, freeTime} of specs) {
            const worker = await this.getWorker(threads, freeTime, workers);
            if (!worker) {
                return null;
            }
            workers[worker.id] = worker;
        }
        return workers;
    }

    async getWorker(threads, freeTime, exclude={}) {
        // Get a new or existing worker with at least `threads` threads,
        // which is available after `freeTime`.
        freeTime ||= Date.now();
        const matchingWorkers = Object.values(this.workers).filter((worker)=>(
            !exclude[worker.id] && 
            worker.process.threads >= threads &&
            worker.nextFreeTime < freeTime
        )).sort((a,b)=>(
            a.threads - b.threads
        ));
        if (matchingWorkers.length > 0) {
            return matchingWorkers[0];
        }
        else {
            return await this.spawnWorker(threads);
        }
    }
    
    async spawnWorker(threads) {
        // Create a new worker with `threads` threads.
        // Ignores number of CPU cores.
        const {ns, portNum} = this;

        threads = Math.ceil(threads);
        const workerID = this.nextWorkerID++;
        const script = WORKER;
        const args = ["--port", portNum, "--id", workerID];
        const scriptRam = ns.getScriptRam(WORKER, 'home');
        const neededRam = scriptRam * threads;
    
        const server = getSmallestServerWithRam(ns, scriptRam, threads);
        if (!server) {
            ns.print(`Failed to start worker with ${threads} threads: Not enough RAM on any available server.`);
            return null;
        }
        await ns.scp(script, 'home', server.hostname);
        if (server.availableThreads - threads < 4) {
            threads = server.availableThreads;
        }
    
        const pid = ns.exec(script, server.hostname, threads, ...args);
        this.workers[workerID] ||= {};
        const worker = this.workers[workerID];
        worker.id = workerID;
        worker.process = ns.getRunningScript(pid);
        ns.print(`Created worker ${workerID} with ${threads} threads on ${server.hostname}.`);
        return worker;
    }
}

function getSmallestServerWithRam(ns, scriptRam, threads) {
    const servers = getServerPool({ns, scriptRam}).filter((server)=>(
        server.availableThreads >= threads
    )).sort((a,b)=>(
        a.availableThreads - b.availableThreads
    ));
    return servers[0];
}
