const SCRIPT_RAM = 1.75; // Default thread cost for estimating capacity of pool
let batchID = 0;         // Global counter used to ensure unique processes

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
    const serverPool = getServerPool({ns, scriptRam});
    for (const server of serverPool) {
        ns.print(sprintf("%-18s %7s RAM (%s threads)",
            server.hostname+":",
            ns.nFormat(server.availableRam*1e9, "0.0 b"),
            ns.nFormat(server.availableThreads, "0,0")
        ));
    }
    ns.print(`\nTotal servers in pool: ${serverPool.length}`);
    ns.print(`Total threads available: ${ns.nFormat(serverPool.totalThreads, "0,0")}`);

    if (params.script) {
        await copyToPool({ns}, params.script);
        runOnPoolNow({...params, verbose: true});
    }
    else {
        ns.tail();
        await ns.asleep(100);
    }
}

export async function copyToPool({ns}, scriptNames) {
    // TODO: handle copying these same files to servers added to the pool later
    for (const server of getServerPool({ns})) {
        await ns.scp(scriptNames, "home", server.hostname);
    }
}

export function getServerPool({ns, scriptRam}) {
    scriptRam ||= SCRIPT_RAM;
    let totalThreads = 0;
    const servers = getAllHosts({ns}).map(function(hostname){
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
    // Run the script on one or more hosts, selected based on current availability.
    const scriptRam = ns.getScriptRam(script, "home");
    const ramNeeded = scriptRam * threads;
    let threadsNeeded = threads;
    const serverPool = getServerPool({ns, scriptRam});
    for (const server of serverPool) {
        const threadsToUse = Math.min(threadsNeeded, server.availableThreads);
        if (threadsToUse > 0) {
            if (!ns.ls(server.hostname).includes(script)) {
                ns.tprint(`Script '${script}' not present on server ${server.hostname}`);
            }
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
    let {ns, startTime} = params;
    const now = Date.now();
    if (startTime === undefined) {
        startTime = now + 1;
    }

    setTimeout(function(){
        runOnPoolNow(params);
    }, startTime - now);
}

export function runBatchOnPool(params, jobs) {
    // Run the entire batch, if there is more than enough RAM for the entire batch.
    // A job is of the format {script, threads, args, startTime}
    let {ns, serverPool, safetyFactor=1.1} = params

    batchID++;

    let totalThreads = 0;
    let earliestStartTime = Infinity;
    let maxScriptRam = SCRIPT_RAM;
    for (const job of jobs) {
        totalThreads += job.threads;
        if (job.startTime !== undefined && job.startTime < earliestStartTime) {
            earliestStartTime = job.startTime;
        }
        const scriptRam = ns.getScriptRam(job.script, "home");
        if (scriptRam > maxScriptRam) {
            maxScriptRam = scriptRam;
        }
    }

    // If planned start time was in the past, shift entire batch to future
    // and update times in-place.
    const startTimeAdjustment = Date.now() - earliestStartTime;
    if (startTimeAdjustment > 0) {
        ns.print(`Batch ${batchID} adjusting start time by ${startTimeAdjustment + 100}`);
        for (const job of jobs) {
            job.startTime += startTimeAdjustment + 100;
            job.endTime += startTimeAdjustment + 100;
        }
    }

    // Abort if the entire batch will not fit in RAM.
    // (Difficult to be sure because conditions may change before scheduled jobs start.)
    if (serverPool === undefined) {
        serverPool = getServerPool({ns, scriptRam:maxScriptRam});
    }
    if (totalThreads * safetyFactor > serverPool.totalThreads) {
        ns.tprint("Batch skipped: not enough RAM in server pool.");
        return false;
    }

    // Schedule each job in the batch.
    for (const [index, job] of jobs.entries()) {
        // Append batch id and job index to ensure unique process id.
        job.args.push(batchID);
        job.args.push(index+1);
        runOnPool({ns, ...job});
    }
    return true;
}

export function getAllHosts({ns}, entry = 'home') {
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
