const FLAGS = [
    ["verbose", false],
    ["loop", false],
    ["startTime"]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    const flags = ns.flags(FLAGS);
    const target = flags._.shift();
    if (flags.startTime) {
        const delay = flags.startTime - Date.now();
        if (delay < -10*1000) {
            return;
        }
        await ns.sleep(delay);
    }
    let count = 0;
    while (flags.loop || count++ == 0) {
        if (flags.verbose) {
            ns.tprint(`  ${Date.now()}: Starting hack   ${JSON.stringify(ns.args)}`);
        }
        await ns.hack(target);
        if (flags.verbose) {
            ns.tprint(`  ${Date.now()}: Finished hack   ${JSON.stringify(ns.args)}`);
        }
    }
}
