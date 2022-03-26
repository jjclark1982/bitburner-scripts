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
    const portNum = flags.port;
    const portHandle = ns.getPortHandle(portNum);

    const db = {
        manager: {
            ns: ns,
            process: ns.getRunningScript()
        },
        workers: {},
        nextWorkerID: 1
    };
    portHandle.clear();
    portHandle.write(db);
    ns.print(`Started manager on port ${portNum}.`);

    window.db = db;

    let threads = 1
    while (threads <= 1024) {
        await spawnWorker({ns, db, portNum, threads});
        threads *= 1.1;
    }

    ns.atExit(function(){
        for (const worker of Object.values(db.workers)) {
            worker.running = false;
        }
        portHandle.clear();
    });

    while(true) {
        await ns.asleep(1000);
    }
}

async function spawnWorker({ns, db, portNum, threads}) {
    threads = Math.ceil(threads);
    const workerID = db.nextWorkerID++;
    const script = WORKER;
    const args = ["--port", portNum, "--id", workerID];
    const scriptRam = ns.getScriptRam(WORKER, 'home');
    const neededRam = scriptRam * threads;

    const server = getSmallestServerWithRam(ns, scriptRam, threads);
    if (!server) {
        return null;
    }
    await ns.scp(script, 'home', server.hostname);
    if (server.availableThreads - threads < 4) {
        threads = server.availableThreads;
    }

    const pid = ns.exec(script, server.hostname, threads, ...args);
    db.workers[workerID] ||= {};
    const worker = db.workers[workerID];
    worker.process = ns.getRunningScript(pid);
    ns.print(`Started worker ${workerID} with ${threads} threads on ${server.hostname}.`);
    return worker;
}

function getSmallestServerWithRam(ns, scriptRam, threads) {
    const servers = getServerPool({ns, scriptRam}).filter((server)=>{
        return server.availableThreads >= threads;
    }).sort((a,b)=>{
        return a.availableThreads - b.availableThreads;
    });
    return servers[0];
}
