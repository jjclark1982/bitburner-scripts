import {getAllHosts} from "lib.ns";
import {analyzeTarget} from "batch/manage.js";

const SCRIPT_RAM = 1.75;

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
    const gStats = analyzeTarget(params, "min");
    const w1Stats = analyzeTarget(params, gStats.growSecurity + 1);
    const hStats = analyzeTarget(params, "min");
    const w2Stats = analyzeTarget(params, hStats.hackSecurity + 1);
	
    const ramNeededPerBatch = (
        SCRIPT_RAM * gStats.growThreads +
        SCRIPT_RAM * w1Stats.weakThreads +
        SCRIPT_RAM * hStats.hackThreads +
        SCRIPT_RAM * w2Stats.weakThreads
    );
	const numBatches = w1Stats.weakTime / params.tDelta;
	const ramNeeded = ramNeededPerBatch * numBatches;

	const moneyGotten = server.moneyMax * params.moneyPercent;

	return moneyGotten / ramNeeded;
}



/** @param {NS} ns **/
export async function main(ns) {
    const comparator = function(h1, h2) {
        return getServerProfit(ns, h1) - getServerProfit(ns, h2);
    };

	const mostProfitableServers = getAllHosts(ns).filter(function(host){
        return ns.hasRootAccess(host) && host != "home";
    }).filter(function(host){
        return ns.getServerMaxMoney(host) > 0;
    }).filter(function(host){
        return ns.getServerRequiredHackingLevel(host) <= ns.getHackingLevel();
    }).sort(function(a,b){
        return getServerProfit(ns,b) - getServerProfit(ns,a);
    });

	let hosts = {};
	for (const host of mostProfitableServers) {
		hosts[host] = getServerProfit(ns, host);
	}
	ns.tprint(JSON.stringify(hosts, null, 2));

}