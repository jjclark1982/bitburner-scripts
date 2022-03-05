import {getAllHosts} from "lib.ns";
const SCRIPT_RAM = 1.75;
let batchID = 0;

/*

batch-based hacking using a pool of hosts

list all usable hosts
    calculate total number of 1.75gb RAM slots
    skip hacknet servers and home server
identify most profitable targets
for each target:
    schedule a net-positive HWGW batch that will fit in available RAM
    allocate each job to one or more hosts when needed

*/

export function autocomplete(data, args) {
    data.flags([]);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");
    ns.clearLog();
    ns.tail();
    const servers = getServerPool(ns);
    for (const server of servers) {
        ns.print(`${server.hostname}: ${server.availableThreads}`);
    }
    ns.print(`Total threads available: ${servers.totalThreads}`);

    await ns.sleep(1000);
}

export async function copyToPool(ns, scriptNames) {
    for (const server of getServerPool(ns)) {
        await ns.scp(scriptNames, "home", server.hostname);
    }
}

export function getServerPool(ns, scriptRam=SCRIPT_RAM) {
    let totalThreads = 0;
    const servers = getAllHosts(ns).map(function(hostname){
        const server = ns.getServer(hostname);
        server.availableRam = server.maxRam - server.ramUsed;
        server.availableThreads = Math.floor(server.availableRam / scriptRam);
        totalThreads += server.availableThreads;
        return server;
    }).filter(function(server){
        return (
            server.availableRam >= SCRIPT_RAM &&
            server.hasAdminRights &&
            !server.hashRate &&
            server.hostname !== "home"
        )
    }).sort(function(a,b){
        return b.maxRam - a.maxRam
    });
    servers.totalThreads = totalThreads;
    return servers;
}

export async function runOnPoolNow({ns, script, threads, args}) {
    // run the script on one or more hosts, selected based on current availability
    const ramPerThread = ns.getScriptRam(script, 'home');
    let ramNeeded = ramPerThread * threads;
    let threadsNeeded = threads;
    const pool = getServerPool(ns);
    for (const server of pool) {
        const threadsToUse = Math.min(threadsNeeded, server.availableThreads);
        if (threadsToUse > 0) {
            // ns.tprint(`running on ${server.hostname}: ${threadsToUse}x ${script} ${JSON.stringify(args)}`);
            //await ns.scp(script, "home", server.hostname); // TODO: check if already exists
            ns.exec(script, server.hostname, threadsToUse, ...args);
            threadsNeeded -= threadsToUse;
        }
        if (threadsNeeded <= 0) {
            break;
        }
    }
    if (threadsNeeded > 0) {
        ns.tprint(`failed to run entire job on pool: ${threads}x ${script} ${args}`);
    }
}

export function runOnPool(params) {
    let {startTime} = params;
    const now = Date.now();
    if (startTime === undefined) {
        startTime = now + 1;
    }
    setTimeout(function(){
        runOnPoolNow(params);
    }, startTime - now);
}

export function runBatchOnPool(ns, jobs, safetyFactor=1.1) {
    // run the entire batch, if there is more than enough ram for the entire batch.
    // a job is of the format {startTime, script, threads, args}

    batchID++;

    let totalThreads = 0;
    let earliestStartTime = Infinity;
    for (const job of jobs) {
        totalThreads += job.threads;
        if (job.startTime !== undefined && job.startTime < earliestStartTime) {
            earliestStartTime = job.startTime;
        }
    }
    // if planned start time was in the past, shift entire batch to future
    // and update times in-place
    const startTimeAdjustment = Date.now() - earliestStartTime;
    if (startTimeAdjustment > 0) {
        ns.print(`Batch ${batchID} adjusting start time by ${startTimeAdjustment}`);
        for (const job of jobs) {
            job.startTime += startTimeAdjustment + 50;
            job.endTime += startTimeAdjustment + 50;
        }
    }
    const pool = getServerPool(ns);
    if (totalThreads * safetyFactor > pool.totalThreads) {
        ns.tprint("Batch skipped: not enough RAM in server pool.");
        return false;
    }
    for (const [index, job] of jobs.entries()) {
        job.args.push(batchID);
        job.args.push(index);
        runOnPool({ns, ...job});
    }
}
