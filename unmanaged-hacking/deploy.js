import { deploy } from "net/deploy-script.js";

const FLAGS = [];

export function autocomplete(data, args) {
	data.flags(FLAGS);
	return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
	const flags = ns.flags(FLAGS);
	const target = flags._.shift();

    const minSecurity = ns.getServerMinSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const money = ns.getServerMoneyAvailable(target);
    const threads = Math.ceil(ns.growthAnalyze(target, maxMoney / Math.max(1,money)) / 2);

    const script = "/unmanaged-hacking/hack-grow-weaken.js";
    const args = [target, "--minSecurity", minSecurity, "--maxMoney", maxMoney];

    // ns.run(script, threads, ...args);
    await deploy(ns, {script, threads, args}, {allowSplit: true, logLevel: 3});
}
