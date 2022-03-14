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
        const delay = args.startTime - Date.now();
        if (delay < -10*1000) {
            return;
        }
        await ns.sleep(delay);
    }
    if (args.verbose) {
        ns.tprint(`  ${Date.now()}: Starting hack   ${JSON.stringify(ns.args)}`);
    }
    await ns.hack(target);
    if (args.verbose) {
        ns.tprint(`  ${Date.now()}: Finished hack   ${JSON.stringify(ns.args)}`);
    }
}
