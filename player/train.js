const FLAGS = [
    ['hacking', 0],
    ['charisma', 0],
    ['strength', 0],
    ['defense', 0],
    ['dexterity', 0],
    ['agility', 0]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const flags = ns.flags(FLAGS);
    delete flags._;
    await prepareStats(flags);
}

export async function prepareStats(ns, targetStats) {
    for (const stat in targetStats) {
        const statTarget = targetStats[stat];
        while (ns.getPlayer()[stat] < statTarget) {
            if (!ns.isBusy()) {
                trainStat(ns, stat);
            }
            await ns.sleep(1*1000);
        }
        ns.stopAction();
    }
}

export function trainStat(ns, stat) {
    if (stat == 'hacking') {
        ns.universityCourse("Rothman University", "Algorithms");
    }
    else if (stat == 'charisma') {
        ns.universityCourse("Rothman University", "Leadership");
    }
    else {
        ns.gymWorkout("Powerhouse Gym", stat);
    }
}
