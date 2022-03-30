/*

/augmentations/future.js

List the best augmentations available to graft.

run /augmentations/graft.js [ hacking | combat | cha | faction | blade | hacknet | neuro ] ... [ --begin ]

*/

import { FILTERS, getKnownAugs, totalValue } from "augmentations/plan.js";

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
            'List the best augmentations available to graft.',
            '',
            'Usage: ',
            `${ns.getScriptName()} [ ${Object.keys(FILTERS).join(' | ')} ... ]`,
            ' '
        ].join("\n"));
        return;
    }

    ns.clearLog();
    ns.tail();

    const graftableAugs = getGraftableAugs(ns, filters);
    const summary = [`Augmentation Grafting Plan: ${filters.join(', ')}`];
    for (const aug of graftableAugs) {
        const price = sprintf("%10s", ns.nFormat(aug.price, "$0.0a"));
        summary.push(`${price} (${(aug.time/60/60/1000).toFixed(1)} hr) for (${aug.totalValue.toFixed(2)}x) '${aug.name}'`);
    }
    ns.print(summary.join("\n"), "\n");
}

export function getGraftableAugs(ns, domains) {
    const allAugs = Object.values(getKnownAugs(ns));
    const ownedAugs = ns.getOwnedAugmentations(true);

    const graftableAugs = allAugs.map(function(aug){
        estimateGraftValues(ns, aug);
        aug.totalValue = totalValue(aug, domains);
        aug.price = ns.grafting.getAugmentationGraftPrice(aug.name);
        aug.time = ns.grafting.getAugmentationGraftTime(aug.name);
        aug.sortKey = (aug.totalValue-1) / aug.time;
        return aug;
    }).filter(function(aug){
        return (
            (!ownedAugs.includes(aug.name)) &&
            (aug.totalValue > 1.0)
            // TODO: check whether prereqs get enforced in future versions
        )
    }).sort(function(a,b){
        return b.sortKey - a.sortKey;
    });

    return graftableAugs;
}

export function estimateGraftValues(ns, aug) {
    const EntropyEffect = 0.98;
    aug.stats = {};
    for (const [key, value] of Object.entries(ns.getAugmentationStats(aug.name))) {
        aug.stats[key] = value * EntropyEffect;
        // TODO: check whether 'cost' ones get inverted in future versions
    }
    aug.value = {};
    for (const [domain, estimate] of Object.entries(FILTERS)) {
        aug.value[domain] = estimate(aug);
        if (aug.name == "CashRoot Starter Kit") {
            aug.value['hacking'] = 1;
        }
    }
}
