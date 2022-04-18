const FLAGS = [
    ["verbose", false],
    ["startTime", 0],
    ["repeatPeriod", 0],
    ["stock", false],
    ["help", false]
];

const OPERATIONS = [
    'hack',
    'grow',
    'weaken'
];

export function autocomplete(data, args) {
    data.flags(FLAGS);

    return [...OPERATIONS, ...data.servers];
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.weaken; // for static RAM calculation

    const flags = ns.flags(FLAGS);
    const operation = flags._.shift();
    const target = flags._.shift();

    if (flags.help || !operation || !target) {
        ns.tprint([
            "Perform a hack/grow/weaken operation on a server.",
            '',
            'Usage:',
            `> run ${ns.getScriptName()} [ hack | grow | weaken ] hostname [ --startTime ms ] [ --repeatPeriod ms ]`,
            '',
            `Example: weaken foodnstuff one time`,
            `> run ${ns.getScriptName()} weaken foodnstuff`,
            ' '
        ].join('\n'));
        return;
    }

    let now = Date.now();
    let startTime = flags.startTime || now;
    while (startTime >= now) {
        // Wait until startTime.
        if (startTime > now) {
            await ns.asleep(startTime - now);
        }

        // Run the operation.
        if (flags.verbose) { ns.tprint(`  ${Date.now()}: Starting ${JSON.stringify(ns.args)}`); }
        await ns[operation](target, {stock: flags.stock});
        now = Date.now();
        if (flags.verbose) { ns.tprint(`  ${Date.now()}: Finished ${JSON.stringify(ns.args)}`); }

        // Update startTime if repeat is enabled.
        if (flags.repeatPeriod > 0) {
            const numPeriods = 1 + Math.floor((now - startTime) / flags.repeatPeriod);
            startTime += numPeriods * flags.repeatPeriod;
        }
    }
}
