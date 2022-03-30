/*

/augmentations/future.js

List the best augmentations available soon, sorted by least reputation required.

run /augmentations/future.js [ hacking | combat | cha | faction | blade | hacknet | neuro ] ...

*/

import { DOMAINS, getAllAugmentations, totalValue } from "augmentations/info.js";
import { canPurchaseFrom } from "augmentations/plan.js";

const FLAGS = [
    ['help', false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return Object.keys(DOMAINS);
}

/** @param {NS} ns **/
export function main(ns) {
    const args = ns.flags(FLAGS);
    let domains = args._;
    if (domains.length == 0) {
        domains = ['all'];
    }

    if (args.help) {
        ns.tprint([
            'List the best augmentations available soon, sorted by least reputation required.',
            '',
            'Usage: ',
            `${ns.getScriptName()} [ ${Object.keys(DOMAINS).join(' | ')} ... ]`,
            ' '
        ].join("\n"));
        return;
    }

    ns.clearLog();
    ns.tail();

    const futureAugs = getFutureAugs(ns, domains);
    const summary = [`Future Augmentation Plan: ${domains.join(', ')}`];
    for (const aug of futureAugs) {
        const faction = aug.neededFactions[0];
        const rep = sprintf("%+12s", ns.nFormat(faction.repNeeded, '0,0'));
        summary.push(`${rep} more rep with ${faction.name} for '${aug.name}' (${totalValue(aug, domains).toFixed(2)}x)`);
    }
    ns.print(summary.join("\n"), "\n");
}

export function getFutureAugs(ns, domains) {
    const allAugs = Object.values(getAllAugmentations(ns));
    const ownedAugs = ns.getOwnedAugmentations(true);

    const futureAugs = allAugs.map(function(aug){
        aug.canPurchaseFrom = canPurchaseFrom(ns, aug);
        aug.neededFactions = factionsToWork(aug);
        return aug;
    }).filter(function(aug){
        return (
            (!ownedAugs.includes(aug.name)) &&
            (aug.neededFactions.length > 0) &&
            (totalValue(aug, domains) > 1.0)
        )
    }).map(function(aug){
        aug.sortKey = totalValue(aug, domains) / aug.neededFactions[0].repNeeded;
        return aug;
    }).sort(function(a,b){
        return b.sortKey - a.sortKey;
    });

    return futureAugs;
}

export function factionsToWork(aug) {
    if (aug.canPurchaseFrom) {
        return [];
    };
    const neededFactions = Object.entries(aug.factions).map(function([faction, [rep, repReq]]){
        return {
            name: faction,
            rep: rep,
            repNeeded: aug.repReq - rep
        }
    }).filter(function(faction){
        return (faction.repNeeded > 0)
    }).sort(function(a,b){
        return (a.repNeeded - b.repNeeded)
    });

    return neededFactions;
}
