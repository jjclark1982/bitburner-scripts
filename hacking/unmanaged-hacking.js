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
	const flags = ns.flags(FLAGS);
	const target = flags._.shift();

	while (true) {
		if (ns.getServerSecurityLevel(target) > 1 + flags.minSecurity) {
			await ns.weaken(target);
		}
		else if (ns.getServerMoneyAvailable(target) < 0.9 * flags.maxMoney) {
			await ns.grow(target);
		}
		else {
			await ns.hack(target);
		}
	}
}
