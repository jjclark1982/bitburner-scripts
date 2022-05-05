import { deploy } from "net/deploy-script";

export function autocomplete(data) {
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    if (ns.args.length == 0 && ns.getPurchasedServers().length == 0) {
        // do not automatically pick a host right after augmentation
        return;
    }

    const host = ns.args[0];
    const reservedRam = ns.args[1];
    const script = "/share/share.js";

    await deploy(ns, {host, script, reservedRam, threads:'max'}, {logLevel: 4});
}
