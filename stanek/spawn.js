const CHARGE = "/stanek/charge-x-y.js";

/** @param {NS} ns **/
export async function main(ns) {
    const host = ns.args[0] || ns.getHostname();

	const fragments = ns.stanek.activeFragments();
    const xy = [];
    for (const fragment of fragments) {
        xy.push(fragment.x);
        xy.push(fragment.y);
    }
    const scriptRam = ns.getScriptRam(CHARGE, 'home');
    const server = ns.getServer(host);
    const availableRam = server.maxRam - server.ramUsed; // - ns.getScriptRam(ns.getScriptName(), host);
    const threads = Math.floor(availableRam / scriptRam);
    await ns.scp(CHARGE, 'home', host);
    ns.exec(CHARGE, host, threads, ...xy);
}
