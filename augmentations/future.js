/*

/augmentations/future.js

List the best augmentations available soon, sorted by least reputation required.

run /augmentations/future.js [ hacking | combat | cha | faction | blade | hacknet | neuro ] ...

*/

import { getFutureAugs, FILTERS } from "augmentations/plan.js";

const FLAGS = [
    ['help', false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return Object.keys(FILTERS);
}

/** @param {NS} ns **/
export function main(ns) {
    const args = ns.flags(FLAGS);
    let filters = args._;
    if (filters.length == 0) {
        filters = ['all'];
    }

    if (args.help) {
        ns.tprint([
            'List the best augmentations available soon, sorted by least reputation required.',
            '',
            'Usage: ',
            `${ns.getScriptName()} [ ${Object.keys(FILTERS).join(' | ')} ... ]`,
            ' '
        ].join("\n"));
        return;
    }

    ns.clearLog();
    ns.tail();


    const futureAugs = getFutureAugs(ns, filters);
    const summary = [`Future Augmentation Plan: ${filters.join(', ')}`];
    for (const aug of futureAugs) {
        const faction = aug.neededFactions[0];
        summary.push(`  '${aug.name}' from ${faction.name} for ${ns.nFormat(faction.repNeeded, '0,')} more reputation`);
    }
    ns.print(summary.join("\n"), "\n");
}
