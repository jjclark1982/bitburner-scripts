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

    const host = ns.args[0] || ns.getHostname();
    const scriptRam = ns.getScriptRam(CHARGE, 'home');
    const server = ns.getServer(host);
    let availableRam = server.maxRam - server.ramUsed;
    if (host == 'home') {
        availableRam -= 10.0;
    }
    const threads = Math.floor(availableRam / scriptRam);
    await ns.scp(CHARGE, 'home', host);
    ns.exec(CHARGE, host, threads, ...xy);
}
