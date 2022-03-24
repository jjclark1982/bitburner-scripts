const FLAGS = [
	["minSecurity", 1],
	["maxMoney", 1e7]
];

export function autocomplete(data, args) {
	data.flags(FLAGS);
	return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
	const params = ns.flags(FLAGS);
	const target = params._.shift();
    delete params._;

	while (true) {
		if (ns.getServerSecurityLevel(target) > 1 + params.minSecurity) {
			await ns.weaken(target);
		}
		else if (ns.getServerMoneyAvailable(target) < 0.9 * params.maxMoney) {
			await ns.grow(target);
		}
		else {
			await ns.hack(target);
		}
	}
}
