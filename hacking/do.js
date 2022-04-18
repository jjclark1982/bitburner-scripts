const FLAGS = [
    ["startTime", 0],
    ["repeatPeriod", 0],
    ["stock", false],
    ["verbose", false],
    ["help", false],
    ["id", '']
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
    const args = flags._;
    const options = {stock: flags.stock};

    if (flags.help || !OPERATIONS.includes(operation) || args.length < 1) {
        ns.tprint([
            'Perform a hack/grow/weaken operation on a server.', ' ',
            'Usage:',
            `> run ${ns.getScriptName()} [ ${OPERATIONS.join(' | ')} ] hostname [ --startTime ms ] [ --repeatPeriod ms ]`, ' ',
            'Example: weaken foodnstuff one time with 10 threads',
            `> run ${ns.getScriptName()} -t 10 weaken foodnstuff`, ' '
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
        if (flags.verbose) { ns.tprint(`  [${formatTimestamp()}] Starting ${operation} ${args.join(' ')} ${JSON.stringify(options)} (${formatTimeDiff(Date.now(), startTime)})`); }
        await ns[operation](...args, options);
        if (flags.verbose) { ns.tprint(`  [${formatTimestamp()}] Finished ${operation} ${args.join(' ')}`); }

        // Update startTime if repeat is enabled.
        now = Date.now();
        if (flags.repeatPeriod > 0) {
            const numPeriods = Math.ceil((now - startTime) / flags.repeatPeriod);
            startTime += numPeriods * flags.repeatPeriod;
        }
    }
}

function formatTimestamp(timestamp, precision=2) {
    timestamp ||= new Date();
    let timeStr = timestamp.toTimeString().slice(0,8);
    if (precision > 0) {
        const msStr = (timestamp / 1000 - Math.floor(timestamp/1000)).toFixed(precision);
        timeStr += msStr.substring(1);
    }
    return timeStr;
}

function formatTimeDiff(expected, observed) {
    return `${expected >= observed ? '+' : ''}${expected - observed} ms`;
}
