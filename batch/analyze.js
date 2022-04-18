import { drawTable } from "lib/box-drawing.js";
import { getAllHostnames } from "/net/server-list.js";

export const HACK = "/batch/hack.js";
export const GROW = "/batch/grow.js";
export const WEAKEN = "/batch/weaken.js";
export const BATCH_SCRIPTS = [HACK, GROW, WEAKEN];
export const SCRIPT_RAM = 1.75;

/** @param {NS} ns **/
export async function main(ns) {
	const columns = [
		{header: "Hostname", field: "hostname", width: 18, align: "left"},
        {header: "Prep Time", field: "prepTime", format: drawTable.time},
		{header: " $/sec/thread", field: "profit", format: ns.nFormat, formatArgs:["$0,0.00"]},
	];
	columns.title = "Most Profitable Servers to Hack";
	const servers = mostProfitableTargets(ns);

	ns.clearLog();
	ns.print(drawTable(columns, servers));
	ns.tail();
}

export function mostProfitableTargets(ns) {
	const player = ns.getPlayer();
	const mostProfitableServers = [...getAllHostnames(ns)].map((target)=>{
		const server = ns.getServer(target);
		server.profit = getServerProfit(ns, target);
		server.prepTime = planWeaken({ns, target}).duration;
		return server;
	}).filter(server=>(
		server.requiredHackingSkill <= player.hacking &&
		server.hasAdminRights &&
		server.moneyMax > 0
	)).sort((a,b)=>(
        b.profit - a.profit
    ));
    
    return mostProfitableServers;
}

function getServerProfit(ns, target) {
	// profitability for a HWGW batch:
	// money per second for an ideal batch / ram used for an ideal batch

	const server = ns.getServer(target);

	// assume minimum security and max money
	server.hackDifficulty = server.minDifficulty;
	server.moneyAvailable = server.moneyMax;

	const params = {
		ns: ns,
		target: target,
		cores: 1,
		moneyPercent: 0.05,
		tDelta: 100
	};
    const hJob = planHack({...params, security:0});
    const w1Job = planWeaken({...params, security:hJob.security+1});
    const gJob = planGrow({...params, security:0});
    const w2Job = planWeaken({...params, security:gJob.security+1});

    const ramNeededPerBatch = (
        SCRIPT_RAM * gJob.threads +
        SCRIPT_RAM * w1Job.threads +
        SCRIPT_RAM * hJob.threads +
        SCRIPT_RAM * w2Job.threads
    );
	const numBatches = w2Job.duration / params.tDelta;
	const ramNeeded = ramNeededPerBatch * numBatches;
    const threadsNeeded = ramNeeded / SCRIPT_RAM;

	const moneyGotten = server.moneyMax * params.moneyPercent;
	const moneyPerSecond = moneyGotten / (4 * params.tDelta / 1000);

	return moneyPerSecond / threadsNeeded;
}

export function planHack(params) {
	const {ns, target, moneyPercent, security} = params;
    const player = ns.getPlayer();
    const server = ns.getServer(target);
    if (security !== undefined) {
        server.hackDifficulty = server.minDifficulty + security;
    }

    const hackTime = ns.formulas.hacking.hackTime(server, player);
    const hackPercentPerThread = ns.formulas.hacking.hackPercent(server, player);
    const hackThreads = Math.ceil(moneyPercent / hackPercentPerThread);
    const hackSecurity = ns.hackAnalyzeSecurity(hackThreads);
	const effectivePct = hackThreads * hackPercentPerThread;

	return makeJob({
		...params,
		script: HACK,
		task: 'hack',
		threads: hackThreads,
		security: hackSecurity,
		moneyMult: 1-effectivePct,
		duration: hackTime
	});
}

export function planWeaken(params) {
	const {ns, target, security} = params;
	const cores = params.cores || 1;
    const player = ns.getPlayer();
    const server = ns.getServer(target);
    if (security !== undefined) {
        server.hackDifficulty = server.minDifficulty + security;
    }

    const weakTime = ns.formulas.hacking.weakenTime(server, player);
    const weakSecPerThread = -ns.weakenAnalyze(1, cores);
    const weakSecurity = server.minDifficulty - server.hackDifficulty;
    const weakThreads = Math.ceil(weakSecurity / weakSecPerThread);

	return makeJob({
		...params,
		script: WEAKEN,
		task: 'weaken',
		threads: weakThreads,
		security: weakSecurity,
		moneyMult: 1,
		duration: weakTime
	});
}

export function planGrow(params) {
	const {ns, target, moneyPercent, security} = params;
	const cores = params.cores || 1;
    const player = ns.getPlayer();
    const server = ns.getServer(target);
    if (security !== undefined) {
        server.hackDifficulty = server.minDifficulty + security;
    }

    const growTime = ns.formulas.hacking.growTime(server, player);
    const growPercent = (1 / moneyPercent);
    // const growPercentPerThread = ns.formulas.hacking.growPercent(server, 1, player, cores);
    // const growThreads = Math.ceil((growPercent-1) / (growPercentPerThread-1)) + 1;
	const growThreads = calculateGrowThreads(ns, target, player, cores, moneyPercent);
	const effectivePercent = ns.formulas.hacking.growPercent(server, growThreads, player, cores);
    const growSecurity = ns.growthAnalyzeSecurity(growThreads);

	return makeJob({
		...params,
		script: GROW,
		task: 'grow',
		threads: growThreads,
		security: growSecurity,
		moneyMult: effectivePercent,
		duration: growTime
	});
}

export function calculateGrowThreads(ns, server, playerObject, cores, moneyPct) {
	// iteratively find the number of grow threads needed.
	// slower but more accurate than estimation with (moneyPct-1) / (growPercentPerThread-1)
	// TODO: unbounded binary search
    let threads = 1;
    let newMoney = 0;

    let serverObject = ns.getServer(server);
    serverObject.hackDifficulty = serverObject.minDifficulty;
    serverObject.moneyAvailable = serverObject.moneyMax * moneyPct;

    while (true) {
        let serverGrowth = ns.formulas.hacking.growPercent(serverObject, threads, playerObject, cores);
        newMoney = (serverObject.moneyAvailable + threads) * serverGrowth;
        if (newMoney >= serverObject.moneyMax)
            break;
        threads++;
    }

    return threads;
}

export function makeJob(params) {
	const {script, task, target, threads, security, moneyMult, duration, endTime} = params;
	const args = [target];
	const job = {
		script,
		task,
		args,
		threads,
		security,
		moneyMult,
		duration,
	};
	if (endTime !== undefined) {
		job.endTime = endTime;
		job.startTime = endTime - duration;
		if (params.reserveRam) {
			job.args.push('--startTime');
			job.args.push(job.startTime);
		}
	}
	return job;
}
