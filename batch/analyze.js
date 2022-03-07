import { getAllHosts } from "batch/pool.js";

export const HACK = "/batch/hack.js";
export const GROW = "/batch/grow.js";
export const WEAKEN = "/batch/weaken.js";
export const BATCH_SCRIPTS = [HACK, GROW, WEAKEN];
export const SCRIPT_RAM = 1.75;

/** @param {NS} ns **/
export async function main(ns) {
	const hosts = {};
	for (const host of mostProfitableTargets(ns)) {
		hosts[host] = getServerProfit(ns, host);
	}

	ns.tprint(JSON.stringify(hosts, null, 2));
}

export function mostProfitableTargets(ns) {
	const player = ns.getPlayer();
	const mostProfitableServers = getAllHosts(ns).filter(function(host){
		const server = ns.getServer(host);
		return (
			server.hasAdminRights &&
			server.moneyMax > 0 &&
			server.requiredHackingSkill <= player.hacking &&
			server.hostname !== "home"
		)
    }).sort(function(a,b){
        return getServerProfit(ns,b) - getServerProfit(ns,a);
    });

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
		moneyPercent: 0.25,
		tDelta: 100
	};
    const hJob = planHack({...params, difficulty:0});
    const w1Job = planWeaken({...params, difficulty:hJob.security+1});
    const gJob = planGrow({...params, difficulty:0});
    const w2Job = planWeaken({...params, difficulty:gJob.security+1});

    const ramNeededPerBatch = (
        SCRIPT_RAM * gJob.threads +
        SCRIPT_RAM * w1Job.threads +
        SCRIPT_RAM * hJob.threads +
        SCRIPT_RAM * w2Job.threads
    );
	const numBatches = w1Job.time / params.tDelta;
	const ramNeeded = ramNeededPerBatch * numBatches;

	const moneyGotten = server.moneyMax * params.moneyPercent;
	const moneyPerSecond = moneyGotten / (4 * params.tDelta / 1000);

	return moneyPerSecond / ramNeeded;
}

export function planHack(params) {
	const {ns, target, moneyPercent, difficulty} = params;
    const player = ns.getPlayer();
    const server = ns.getServer(target);
    if (difficulty !== undefined) {
        server.hackDifficulty = server.minDifficulty + difficulty;
    }

    const hackTime = ns.formulas.hacking.hackTime(server, player);
    const hackPercentPerThread = ns.formulas.hacking.hackPercent(server, player);
    const hackThreads = Math.ceil(moneyPercent / hackPercentPerThread);
    const hackSecurity = ns.hackAnalyzeSecurity(hackThreads);
	const effectivePct = hackThreads * hackPercentPerThread * 1.1;

	return makeJob({
		...params,
		script: HACK,
		threads: hackThreads,
		security: hackSecurity,
		money: effectivePct,
		time: hackTime
	});
}

export function planWeaken(params) {
	const {ns, target, cores, moneyPercent, difficulty} = params;
    const player = ns.getPlayer();
    const server = ns.getServer(target);
    if (difficulty !== undefined) {
        server.hackDifficulty = server.minDifficulty + difficulty;
    }

    const weakTime = ns.formulas.hacking.weakenTime(server, player);
    const weakSecPerThread = -ns.weakenAnalyze(1, cores);
    const weakSecurity = server.minDifficulty - server.hackDifficulty;
    const weakThreads = Math.ceil(weakSecurity / weakSecPerThread);

	return makeJob({
		...params,
		script: WEAKEN,
		threads: weakThreads,
		security: weakSecurity,
		money: 0,
		time: weakTime
	});
}

export function planGrow(params) {
	const {ns, target, cores, moneyPercent, difficulty, endTime} = params;
    const player = ns.getPlayer();
    const server = ns.getServer(target);
    if (difficulty !== undefined) {
        server.hackDifficulty = server.minDifficulty + difficulty;
    }

    const hackPercentPerThread = ns.formulas.hacking.hackPercent(server, player);
    const hackThreads = Math.ceil(moneyPercent / hackPercentPerThread);
	const effectivePct = hackThreads * hackPercentPerThread * 1.1;
	server.moneyAvailable = server.moneyMax * (1 - effectivePct);

    const growTime = ns.formulas.hacking.growTime(server, player);
    const growPercentPerThread = ns.formulas.hacking.growPercent(server, 1, player, cores);
    const growPercent = (1 / (1 - effectivePct));
    const growThreads = Math.ceil((growPercent-1) / (growPercentPerThread-1)) + 1;
    const growSecurity = ns.growthAnalyzeSecurity(growThreads);

	return makeJob({
		...params,
		script: GROW,
		threads: growThreads,
		security: growSecurity,
		money: growPercent,
		time: growTime
	});
}

export function makeJob(params) {
	const {script, target, threads, security, money, time, endTime} = params;
	const job = {
		script: script,
		args: [target],
		threads: threads,
		security: security,
		money: money,
		time: time
	};
	if (endTime !== undefined) {
		job.endTime = endTime;
		job.startTime = endTime - time;
	}
	return job;
}
