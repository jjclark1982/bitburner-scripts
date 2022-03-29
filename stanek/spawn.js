import { runMaxThreadsOnHost, getBiggestHost } from "net/lib.js";

export function autocomplete(data) {
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    const fragments = ns.stanek.activeFragments();
    const xy = [];
    for (const fragment of fragments) {
        if (fragment.limit == 1) {
            xy.push(fragment.x);
            xy.push(fragment.y);
        }
    }

    const host = ns.args[0] || getBiggestHost(ns);

    let reservedRam = 0;
    if (host == 'home') {
        reservedRam = (ns.args[1] || 128.0);
    }
    const script = "/stanek/charge-x-y.js";
    const args = xy;
    await runMaxThreadsOnHost({ns, host, script, args, reservedRam});
}
