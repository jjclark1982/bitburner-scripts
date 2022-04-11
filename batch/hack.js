const FLAGS = [
    ["verbose", false],
    ["startTime", 0],
    ["repeatPeriod", 0]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    const flags = ns.flags(FLAGS);
    const target = flags._.shift();

    let now = Date.now();
    let startTime = flags.startTime || now;
    while (startTime >= now) {
        // Wait until startTime.
        if (startTime > now) {
            await ns.asleep(startTime - now);
        }

        // Run the operation.
        if (flags.verbose) { ns.tprint(`  ${Date.now()}: Starting hack   ${JSON.stringify(ns.args)}`); }
        await ns.hack(target);
        now = Date.now();
        if (flags.verbose) { ns.tprint(`  ${Date.now()}: Finished hack   ${JSON.stringify(ns.args)}`); }

        // Update startTime if repeat is enabled.
        if (flags.repeatPeriod > 0) {
            const numPeriods = 1 + Math.floor((now - startTime) / flags.repeatPeriod);
            startTime += numPeriods * flags.repeatPeriod;
        }
    }
}
