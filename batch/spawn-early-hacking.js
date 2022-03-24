const FLAGS = [];

export function autocomplete(data, args) {
	data.flags(FLAGS);
	return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
	const params = ns.flags(FLAGS);
	const target = params._.shift();
    delete params._;

    const minSecurity = ns.getServerMinSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const money = ns.getServerMoneyAvailable(target);
    const threads = Math.ceil(ns.growthAnalyze(target, maxMoney / Math.max(1,money)) / 2);

    ns.run("/batch/pool.js", 1, '--threads', threads, "/net/farm.js", target, "--minSecurity", minSecurity, "--maxMoney", maxMoney);
    // ns.run("/net/farm.js", threads, target, "--minSecurity", minSecurity, "--maxMoney", maxMoney);
}
