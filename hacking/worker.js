const FLAGS = [
    ["startTime", 0],
    ["repeatPeriod", 0],
    ["additionalMsec", 0],
    ["stock", false],
    ["verbose", false],
    ["help", false],
    ["id", '']
];

const TASKS = [
    'hack',
    'grow',
    'weaken'
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return [...TASKS, ...data.servers];
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.grow; // for static RAM calculation

    const flags = ns.flags(FLAGS);
    const task = flags._.shift();
    const args = flags._;
    const options = {
        additionalMsec: flags.additionalMsec,
        stock: flags.stock
    };

    if (flags.help || !TASKS.includes(task) || args.length < 1) {
        ns.tprint([
            'Perform a hack / grow / weaken task on a server.', ' ',
            'Usage:',
            `> run ${ns.getScriptName()} [ ${TASKS.join(' | ')} ] hostname [ --startTime ms ] [ --repeatPeriod ms ]`, ' ',
            'Example: weaken foodnstuff one time with 10 threads',
            `> run ${ns.getScriptName()} -t 10 weaken foodnstuff`, ' '
        ].join('\n'));
        return;
    }

    let now = performance.now();
    let startTime = flags.startTime || now;
    while (startTime >= now) {
        // Wait until startTime.
        if (startTime > now) {
            await ns.asleep(startTime - now);
        }

        // Run the task.
        if (flags.verbose) { ns.tprint(`  [${formatTimestamp()}] Starting ${task} ${args.join(' ')} ${JSON.stringify(options)} (${formatTimeDiff(performance.now(), startTime)})`); }
        await ns[task](args[0], options);
        if (flags.verbose) { ns.tprint(`  [${formatTimestamp()}] Finished ${task} ${args.join(' ')}`); }

        // Update startTime if repeat is enabled.
        now = performance.now();
        if (flags.repeatPeriod > 0) {
            const numPeriods = Math.ceil((now - startTime) / flags.repeatPeriod);
            startTime += numPeriods * flags.repeatPeriod;
        }
    }
}

function formatTimestamp(timestamp, precision=3) {
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
