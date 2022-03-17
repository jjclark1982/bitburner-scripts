import {getAllHosts} from "lib.ns";

const CHARGE = "/stanek/charge-x-y.js";

export function autocomplete(data) {
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    const fragments = ns.stanek.activeFragments();
    const xy = [];
    for (const fragment of fragments) {
        xy.push(fragment.x);
        xy.push(fragment.y);
    }

    const host = ns.args[0] || getBiggestHost(ns);

    const scriptRam = ns.getScriptRam(CHARGE, 'home');
    const server = ns.getServer(host);
    let availableRam = server.maxRam - server.ramUsed;
    if (host == 'home') {
        availableRam -= (ns.args[1] || 128.0);
    }
    const threads = Math.floor(availableRam / scriptRam);
    if (threads > 0 && xy.length > 0) {
        ns.tprint(`Running on ${host}: ${threads}x ${CHARGE} ${xy.join(' ')}`);
        await ns.scp(CHARGE, 'home', host);
        ns.exec(CHARGE, host, threads, ...xy);
    }
}

function getBiggestHost(ns) {
    const biggestHosts = getAllHosts(ns).map(function(host){
        return ns.getServer(host);
    }).filter(function(server){
        return server.hasAdminRights;
    }).sort(function(a,b){
        return (b.maxRam - a.maxRam);
    });
    return biggestHosts[0].hostname;
}
