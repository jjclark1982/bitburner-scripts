/*

/augmentations/find-factions.js

List the best augmentations available soon, sorted by least reputation required.

run /augmentations/find-factions.js [ hacking | combat | cha | faction | blade | hacknet | neuro ] ...

*/

import { getFutureAugs, FILTERS } from "augmentations/plan.js";

export function autocomplete(data, args) {
    return Object.keys(FILTERS);
}

/** @param {NS} ns **/
export function main(ns) {
    ns.clearLog();
    ns.tail();

    const args = ns.flags([]);
    let filters = args._;
    if (filters.length == 0) {
        filters = ['all'];
    }

    const futureAugs = getFutureAugs(ns, filters);
    const summary = [`Future Augmentation Plan: ${filters.join(', ')}`];
    for (const aug of futureAugs) {
        const faction = aug.neededFactions[0];
        summary.push(`  '${aug.name}' from ${faction.name} for ${ns.nFormat(faction.repNeeded, '0,')} more reputation`);
    }
    ns.print(summary.join("\n"), "\n");
}
