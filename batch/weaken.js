const FLAGS = [
    ["verbose", false],
    ["startTime"]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    const args = ns.flags(FLAGS);
    const target = args._.shift();
    if (args.startTime) {
        await ns.sleep(args.startTime - Date.now());
    }
    if (args.verbose) {
        ns.tprint(`  ${Date.now()}: Starting weaken ${JSON.stringify(ns.args)}`);
    }
    await ns.weaken(target);
    if (args.verbose) {
        ns.tprint(`  ${Date.now()}: Finished weaken ${JSON.stringify(ns.args)}`);
    }
}
