/*

run player/train.js --strength 100 --defense 100 --dexterity 100 --agility 100 --focus

*/

const FLAGS = [
    ['hacking', 0],
    ['charisma', 0],
    ['strength', 0],
    ['defense', 0],
    ['dexterity', 0],
    ['agility', 0],
    ['focus', false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("sleep");
    const flags = ns.flags(FLAGS);
    const focus = flags.focus;
    delete flags.focus;
    delete flags._;
    await prepareStats(ns, flags, focus);
}

export async function prepareStats(ns, targetStats, focus=false) {
    for (const [stat, statTarget] of Object.entries(targetStats)) {
        while (ns.getPlayer()[stat] < statTarget) {
            if (!ns.isBusy()) {
                trainStat(ns, stat, focus);
            }
            await ns.sleep(1*1000);
        }
        ns.stopAction();
    }
}

export function trainStat(ns, stat, focus=false) {
    if (stat == 'hacking') {
        ns.universityCourse("Rothman University", "Algorithms", focus);
    }
    else if (stat == 'charisma') {
        ns.universityCourse("Rothman University", "Leadership", focus);
    }
    else {
        ns.gymWorkout("Powerhouse Gym", stat, focus);
    }
}
