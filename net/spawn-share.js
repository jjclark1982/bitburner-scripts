import { runMaxThreadsOnHost, getBiggestHost } from "net/lib.js";

export function autocomplete(data) {
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    if (ns.args.length == 0 && ns.getPurchasedServers().length == 0) {
        // do not automatically pick a host right after augmentation
        return;
    }

    const host = ns.args[0] || getBiggestHost(ns);

    let reservedRam = 0;
    if (host == 'home') {
        reservedRam = (ns.args[1] || 128.0);
    }
    const script = "/net/share.js";
    await runMaxThreadsOnHost({ns, host, script, reservedRam});
}
