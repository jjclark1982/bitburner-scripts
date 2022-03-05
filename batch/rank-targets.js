import {getAllHosts} from "lib.ns";
const SCRIPT_RAM = 1.75;

/** @param {NS} ns **/
export async function main(ns) {
	const hosts = {};
	for (const host of mostProfitableServers(ns)) {
		hosts[host] = getServerProfit(ns, host);
	}

	ns.tprint(JSON.stringify(hosts, null, 2));
}

export function mostProfitableServers(ns) {
	const mostProfitableServers = getAllHosts(ns).filter(function(host){
        return ns.getServer(host).hasAdminRights && host != "home";
    }).filter(function(host){
        return ns.getServer(host).moneyMax > 0;
    }).filter(function(host){
        return ns.getServer(host).requiredHackingSkill <= ns.getPlayer().hacking;
    }).sort(function(a,b){
        return getServerProfit(ns,b) - getServerProfit(ns,a);
    });

	return mostProfitableServers;
}

function getServerProfit(ns, target) {
	// profitability for a HWGW batch:
	// money hacked per ideal batch / ram used per ideal batch

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
    const hStats = planHack({...params, difficulty:0});
    const w1Stats = planWeaken({...params, difficulty:hStats.security+1});
    const gStats = planGrow({...params, difficulty:0});
    const w2Stats = planWeaken({...params, difficulty:gStats.security+1});

    const ramNeededPerBatch = (
        SCRIPT_RAM * gStats.threads +
        SCRIPT_RAM * w1Stats.threads +
        SCRIPT_RAM * hStats.threads +
        SCRIPT_RAM * w2Stats.threads
    );
	const numBatches = w1Stats.time / params.tDelta;
	const ramNeeded = ramNeededPerBatch * numBatches;

	const moneyGotten = server.moneyMax * params.moneyPercent;
	const moneyPerSecond = moneyGotten / (4 * params.tDelta / 1000);

	return moneyPerSecond / ramNeeded;
}

export function planHack({ns, target, cores, moneyPercent, difficulty}) {
    const player = ns.getPlayer();
    const server = ns.getServer(target);
    if (difficulty !== undefined) {
        server.hackDifficulty = server.minDifficulty + difficulty;
    }

    const hackTime = ns.formulas.hacking.hackTime(server, player);
    const hackPercentPerThread = ns.formulas.hacking.hackPercent(server, player);
    const hackThreads = Math.ceil(moneyPercent / hackPercentPerThread);
    const hackSecurity = ns.hackAnalyzeSecurity(hackThreads);

	return {
		script: "/batch/hack.js",
		time: hackTime,
		threads: hackThreads,
		security: hackSecurity
	}
}

export function planWeaken({ns, target, cores, moneyPercent, difficulty}) {
    const player = ns.getPlayer();
    const server = ns.getServer(target);
    if (difficulty !== undefined) {
        server.hackDifficulty = server.minDifficulty + difficulty;
    }

    let weakTime = ns.formulas.hacking.weakenTime(server, player);
    const weakSecPerThread = -ns.weakenAnalyze(1, cores);
    const weakSecurity = server.minDifficulty - server.hackDifficulty;
    const weakThreads = Math.ceil(weakSecurity / weakSecPerThread);
    if (weakThreads == 0) {
        weakTime = 0;
    }

	return {
		script: "/batch/weaken.js",
		time: weakTime,
		threads: weakThreads,
		security: weakSecurity
	}
}

export function planGrow({ns, target, cores, moneyPercent, difficulty}) {
    const player = ns.getPlayer();
    const server = ns.getServer(target);
    if (difficulty !== undefined) {
        server.hackDifficulty = server.minDifficulty + difficulty;
    }

    const growTime = ns.formulas.hacking.growTime(server, player);
    const growPercentPerThread = ns.formulas.hacking.growPercent(server, 1, player, cores);
    const growPercent = (1 / (1 - (moneyPercent*1.1))); // 10% margin to correct for errors
    const growThreads = Math.ceil(((1-growPercent) / (1-growPercentPerThread)));
    const growSecurity = ns.growthAnalyzeSecurity(growThreads);

	return {
		script: "/batch/grow.js",
		time: growTime,
		threads: growThreads,
		security: growSecurity
	}
}
