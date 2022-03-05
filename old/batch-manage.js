const HACK = "/batch/hack.js";
const GROW = "/batch/grow.js";
const WEAKEN = "/batch/weaken.js";
const BATCH_SCRIPTS = [HACK, GROW, WEAKEN];

const FLAGS = [
    ["help", false],
    ["target"],
    ["host"],
    ["tDelta", 100],
    ["moneyPercent", 0.25]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("asleep");
    const args = ns.flags(FLAGS);
    if (args.help) {
        ns.tprint("This script manages batches of hack/weaken/grow/weaken cycles against a target server.");
        ns.tprint(`Usage: run ${ns.getScriptName()} target [--host host]`);
        ns.tprint("Example:");
        ns.tprint(`> run ${ns.getScriptName()} n00dles --host pserv-1`);
        return;
    }
    if (!args.target && args._.length > 0) {
        args.target = args._.shift();
    }
    if (!args.host) {
        args.host = ns.getHostname();
    }
    args.cores = ns.getServer(args.host).cpuCores;
    args.ns = ns;

    // ns.tprint(JSON.stringify(args, null, 2));
    // return;

    await manageBatch(args);
}

export async function manageBatch(params={ns, host, target, tDelta:100, moneyPercent:.25}) {
    const {ns, host, target, tDelta} = params;

    // ensure the batch scripts are available on the host
    if (host != 'home') {
        await ns.scp(BATCH_SCRIPTS, 'home', host);
    }

    // kill all batch scripts on host before measuring ram
    for (const scriptName of BATCH_SCRIPTS) {
        ns.scriptKill(scriptName, host);
    }

    // w0 - weaken server to minimum security - this will finish at time t0
    const stats = analyzeTarget(params);
    if (stats.weakThreads > 0) {
        ns.exec(WEAKEN, host, stats.weakThreads, target);
    }
    let t0 = Date.now() + stats.weakTime;

    // repeat the following (while RAM permits):
    for (let batchID = 0; true; batchID++) {
        // TODO: dynamically adjust params.moneyPercent based on current RAM availability
        //  (but it would need to go HWGW instead of GWHW)
        t0 = execBatch(params, t0, batchID);
        await ns.asleep(4 * tDelta);
    }
}

export function execBatch(params, t0, batchID) {
    const {ns, host, target, tDelta} = params;

    // g - grow server to max money - finish at time t0 + 1d
    const gStats = analyzeTarget(params, "min");
    const t_g_end = t0 + 1 * tDelta;
    const t_g_start = t_g_end - gStats.growTime;

    // w1 - weaken server to minimum security - finish at time t0 + 2d
    const w1Stats = analyzeTarget(params, gStats.growSecurity + 1);
    const t_w1_end = t0 + 2 * tDelta;
    const t_w1_start = t_w1_end - w1Stats.weakTime;

    // h - hack server for calculated moneyPercent - finish at time t0 + 3d
    const hStats = analyzeTarget(params, "min");
    const t_h_end = t0 + 3 * tDelta;
    const t_h_start = t_h_end - hStats.hackTime;

    // w2 - weaken server to minimum security - finish at time t0 + 4d
    const w2Stats = analyzeTarget(params, hStats.hackSecurity + 1);
    const t_w2_end = t0 + 4 * tDelta;
    const t_w2_start = t_w2_end - w2Stats.weakTime;

    // launch this batch if there is enough RAM available
    // TODO: reserve RAM planned for other batches?
    const ramNeeded = (
        ns.getScriptRam(GROW,   host) * gStats.growThreads +
        ns.getScriptRam(WEAKEN, host) * w1Stats.weakThreads +
        ns.getScriptRam(HACK,   host) * hStats.hackThreads +
        ns.getScriptRam(WEAKEN, host) * w2Stats.weakThreads
    );
    const ramAvailable = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
    if (ramNeeded <= ramAvailable) {
        execAt(ns, t_g_start,  [GROW,   host, gStats.growThreads,  target, batchID]);
        execAt(ns, t_w1_start, [WEAKEN, host, w1Stats.weakThreads, target, batchID]);
        execAt(ns, t_h_start,  [HACK,   host, hStats.hackThreads,  target, batchID]);
        execAt(ns, t_w2_start, [WEAKEN, host, w2Stats.weakThreads, target, batchID, 2]);
    }

    return t_w2_end;
}

export function analyzeTarget(params, difficulty) {
    const {ns, target, cores, moneyPercent} = params;

    // TODO: scale moneyPercent to available RAM

    const player = ns.getPlayer();

    const server = ns.getServer(target);
    if (difficulty == "min") {
        server.hackDifficulty = server.minDifficulty;
    }
    else if (difficulty) {
        server.hackDifficulty = server.minDifficulty + difficulty;
    }

    let weakTime = ns.formulas.hacking.weakenTime(server, player);
    //const weakSecPerThread = DefaultWeakenAmount * ns.getBitNodeMultipliers().ServerWeakenRate;
    const weakSecPerThread = -ns.weakenAnalyze(1, cores);
    const weakSecurity = server.minDifficulty - server.hackDifficulty;
    const weakThreads = Math.ceil(weakSecurity / weakSecPerThread);
    if (weakThreads == 0) {
        weakTime = 0;
    }

    const growTime = ns.formulas.hacking.growTime(server, player);
    const growPercentPerThread = ns.formulas.hacking.growPercent(server, 1, player, cores);
    const growPercent = (1 / (1 - moneyPercent)) * 1.05; // 5% margin to correct for errors
    const growThreads = Math.ceil(((1-growPercent) / (1-growPercentPerThread)));
    const growSecurity = ns.growthAnalyzeSecurity(growThreads);

    const hackTime = ns.formulas.hacking.hackTime(server, player);
    const hackPercentPerThread = ns.formulas.hacking.hackPercent(server, player);
    const hackThreads = Math.ceil(moneyPercent / hackPercentPerThread);
    const hackSecurity = ns.hackAnalyzeSecurity(hackThreads);

    const stats = {
        minDiff: server.minDifficulty,

        weakTime: weakTime,
        weakThreads: weakThreads,
        weakSecurity: weakSecurity,

        growPercentPerThread: growPercentPerThread,
        growTime: growTime,
        growThreads: growThreads,
        growSecurity: growSecurity,

        hackPercentPerThread: hackPercentPerThread,
        hackTime: hackTime,
        hackThreads: hackThreads,
        hackSecurity: hackSecurity
    };
    return stats;
}

export function execAt(ns, startTime, args) {
    // Schedule a function (defined by `args`) to start at `startTime`.
    // This will fail without crashing if there is not enough RAM available.
    setTimeout(function(){
        const threads = args[2];
        if (threads > 0) {
            ns.exec(...args);
        }
    }, startTime - Date.now());
}