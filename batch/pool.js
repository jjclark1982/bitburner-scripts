const SCRIPT_RAM = 1.75; // Default thread cost for estimating capacity of pool
let batchID = 0;         // Global counter used to ensure unique processes

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

const FLAGS = [
    ["help", false],
    ["threads", 1]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return [...data.scripts, ...data.servers];
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");
    ns.clearLog();
    // ns.tail();

    const params = ns.flags(FLAGS);
    params.ns = ns;
    if (params.help) {
        ns.tprint("Run a script on any available server, splitting threads into different processes if needed.");
        ns.tprint(`Usage: run ${ns.getScriptName()} [--threads n] script [args...]`);
        ns.tprint(`Exmaple: run ${ns.getScriptName()} --threads 1000 /batch/grow.js ecorp`);
        return;
    }

    if (params._.length > 0) {
        params.script = params._.shift();
        params.args = params._;
        delete params._;
    }
    let scriptRam = SCRIPT_RAM;
    if (params.script) {
        scriptRam = ns.getScriptRam(params.script, "home");
    }
    const servers = getServerPool(ns, scriptRam);
    // for (const server of servers) {
    //     ns.print(`${server.hostname}: ${server.availableThreads}`);
    // }
    ns.tprint(`Servers in pool: ${servers.length}`);
    ns.tprint(`Total threads available: ${servers.totalThreads}`);

    if (params.script) {
        await copyToPool(ns, params.script);
        runOnPoolNow({...params, verbose: true});
    }
    await ns.asleep(100);
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
        server.sortKey = server.maxRam;
        if (server.hostname === "home" || server.hashRate) {
            // Reserve RAM on home and hacknet servers, and use them last.
            server.maxRam = server.maxRam / 2;
            server.sortKey = -server.sortKey;
        }
        server.availableRam = server.maxRam - server.ramUsed;
        server.availableThreads = Math.floor(server.availableRam / scriptRam);
        totalThreads += server.availableThreads;
        return server;
    }).filter(function(server){
        return (
            server.hasAdminRights &&
            server.availableThreads > 0
        )
    }).sort(function(a,b){
        return b.sortKey - a.sortKey;
    });
    servers.totalThreads = totalThreads;
    return servers;
}

export function runOnPoolNow({ns, script, threads, args, verbose}) {
    // run the script on one or more hosts, selected based on current availability.
    const ramPerThread = ns.getScriptRam(script, "home");
    let ramNeeded = ramPerThread * threads;
    let threadsNeeded = threads;
    const pool = getServerPool(ns, ramPerThread);
    for (const server of pool) {
        const threadsToUse = Math.min(threadsNeeded, server.availableThreads);
        if (threadsToUse > 0) {
            if (verbose) {
                ns.tprint(`Running on ${server.hostname}: ${threadsToUse}x ${script} ${args.join(' ')}`);
            }
            ns.exec(script, server.hostname, threadsToUse, ...args);
            threadsNeeded -= threadsToUse;
        }
        if (threadsNeeded <= 0) {
            break;
        }
    }
    if (threadsNeeded > 0) {
        ns.tprint(`Failed to run entire job on pool: ${threads}x ${script} ${args}`);
    }
}

export function runOnPool(params) {
    let {ns, startTime, endTime} = params;
    const now = Date.now();
    if (startTime === undefined) {
        startTime = now + 1;
    }

    setTimeout(function(){
        //ns.print(`Expected start time of ${params.script} ${JSON.stringify(params.args)}`);
        runOnPoolNow(params);
    }, startTime - now);

    // if (endTime !== undefined) {
    //     setTimeout(function(){
    //         ns.print(`${now} Expected end time of ${params.script} ${JSON.stringify(params.args)}`);
    //     }, endTime - now);
    // }
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
        // TODO: investigate why this is reaching nummers as high as 700
        //  - maybe it is not being propagated back to manage.js 
        ns.print(`Batch ${batchID} adjusting start time by ${startTimeAdjustment + 100}`);
        for (const job of jobs) {
            job.startTime += startTimeAdjustment + 100;
            job.endTime += startTimeAdjustment + 100;
        }
    }
    // abort if the entire batch will not fit in ram.
    // (difficult to be sure because conditions may change before scheduled jobs start)
    const pool = getServerPool(ns);
    if (totalThreads * safetyFactor > pool.totalThreads) {
        ns.tprint("Batch skipped: not enough RAM in server pool.");
        return false;
    }
    for (const [index, job] of jobs.entries()) {
        // append batch id and job index to ensure unique process id
        job.args.push(batchID);
        job.args.push(index+1);
        runOnPool({ns, ...job});
    }
    return true;
}

export function getAllHosts(ns, entry = 'home') {
    if (getAllHosts.cache === undefined) {
        getAllHosts.cache = {};
    }
    const scanned = getAllHosts.cache;

    let toScan = [entry];
    while (toScan.length > 0) {
        const host = toScan.shift();
        if (host in scanned) {
            continue;
        }
        scanned[host] = true;
        toScan = toScan.concat(ns.scan(host));
    }
    const allHosts = Object.keys(scanned);
    return allHosts;
}
