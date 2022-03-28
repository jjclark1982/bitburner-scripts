import { ServerPool } from "hive/server-pool.js";

const FLAGS = [
    ["port", 1]
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

export class ThreadPool {
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
            console.log("stopping worker", worker);
            worker.running = false;
        }
        this.ns.getPortHandle(this.portNum).clear();
    }

    async getWorkers(specs) {
        // Get a block of workers matching certain specs.
        // Returns an array of Worker objects if all specs could be satisfied.
        // Returns null if any spec could not be satisfied.
        const workers = {};
        for (const {threads, freeTime, capabilities} of specs) {
            const worker = await this.getWorker(threads, freeTime, capabilities, workers);
            if (!worker) {
                return null;
            }
            workers[worker.id] = worker;
        }
        return workers;
    }

    async getWorker(threads, freeTime, capabilities=[], exclude={}) {
        // Get a new or existing worker with the requested specs:
        // - has at least `threads` threads
        // - has every capability listed in `capabilities`,
        // - is available after `freeTime`
        freeTime ||= Date.now();
        const matchingWorkers = Object.values(this.workers).filter((worker)=>(
            !exclude[worker.id] && 
            worker.process.threads >= threads &&
            worker.nextFreeTime < freeTime &&
            capabilities.every((func)=>func in worker.capabilities)
        )).sort((a,b)=>(
            a.threads - b.threads
        ));
        if (matchingWorkers.length > 0) {
            return matchingWorkers[0];
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
        const workerID = this.nextWorkerID++;
        const script = getScriptWithCapabilities(capabilities);
        if (!script) {
            ns.print(`Failed to start worker with ${threads} threads: No script capable of ${JSON.stringify(capabilities)}.`);
            return null;
        }
        const args = ["--port", portNum, "--id", workerID];
        const scriptRam = ns.getScriptRam(script, 'home');
        const neededRam = scriptRam * threads;
    
        const pool = new ServerPool(ns, scriptRam);
        const pid = await pool.runOnSmallest({script, threads, args, roundUpThreads: 4});

        if (!pid) {
            ns.print(`Failed to start worker with ${threads} threads: Not enough RAM on any available server.`);
            return null;
        }
        this.workers[workerID] ||= {};
        const worker = this.workers[workerID];
        worker.id = workerID;
        worker.process = ns.getRunningScript(pid);
        ns.print(`Running worker ${workerID} with ${worker.process.threads} threads on ${worker.process.server}.`);
        return worker;
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

function getSmallestServerWithRam(ns, scriptRam, threads) {
    const servers = getServerPool({ns, scriptRam}).filter((server)=>(
        server.availableThreads >= threads
    )).sort((a,b)=>(
        a.availableThreads - b.availableThreads
    ));
    return servers[0];
}
