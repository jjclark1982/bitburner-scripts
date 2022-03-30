/*

/augmentations/future.js

List the best augmentations available to graft.

run /augmentations/graft.js [ hacking | combat | cha | faction | blade | hacknet | neuro ] ... [ --begin ]

*/

import { DOMAINS, getAllAugmentations, totalValue } from "augmentations/info.js";

const FLAGS = [
    ['help', false],
    ['begin', false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return Object.keys(DOMAINS);
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
            `${ns.getScriptName()} [ ${Object.keys(DOMAINS).join(' | ')} ... ]`,
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
    const allAugs = Object.values(getAllAugmentations(ns));
    const ownedAugs = ns.getOwnedAugmentations(true);
    const exclude = ["The Red Pill", "NeuroFlux Governor"];

    const graftableAugs = allAugs.map(function(aug){
        estimateGraftValues(ns, aug);
        aug.totalValue = totalValue(aug, domains);
        aug.price = ns.grafting.getAugmentationGraftPrice(aug.name);
        aug.time = ns.grafting.getAugmentationGraftTime(aug.name);
        aug.sortKey = (aug.totalValue-1) / aug.time;
        return aug;
    }).filter(function(aug){
        return (
            (!exclude.includes(aug.name)) &&
            (!ownedAugs.includes(aug.name)) //&&
            // (aug.totalValue > 1.0)
            // TODO: check whether prereqs get enforced in future versions
        )
    }).sort(function(a,b){
        return b.sortKey - a.sortKey;
    });

    return graftableAugs;
}

export function estimateGraftValues(ns, aug) {
    const entropy = {
        name: "Entropy",
        stats: entropyStats,
        value: {}
    };
    aug.stats = {};
    for (const [key, value] of Object.entries(ns.getAugmentationStats(aug.name))) {
        aug.stats[key] = value * EntropyEffect;
        // TODO: check whether 'cost' ones get inverted in future versions
    }
    aug.value = {};
    for (const [domain, estimate] of Object.entries(DOMAINS)) {
        aug.value[domain] = estimate(aug) * estimate(entropy);
    }
}

export const EntropyEffect = 0.98;
export const entropyStats = {
    hacking_chance_mult: EntropyEffect,
    hacking_speed_mult: EntropyEffect,
    hacking_money_mult: EntropyEffect,
    hacking_grow_mult: EntropyEffect,

    hacking_mult: EntropyEffect,
    strength_mult: EntropyEffect,
    defense_mult: EntropyEffect,
    dexterity_mult: EntropyEffect,
    agility_mult: EntropyEffect,
    charisma_mult: EntropyEffect,

    // exp is less important for grafting because it doesn't get reset
    hacking_exp_mult: Math.sqrt(EntropyEffect),
    strength_exp_mult: Math.sqrt(EntropyEffect),
    defense_exp_mult: Math.sqrt(EntropyEffect),
    dexterity_exp_mult: Math.sqrt(EntropyEffect),
    agility_exp_mult: Math.sqrt(EntropyEffect),
    charisma_exp_mult: Math.sqrt(EntropyEffect),

    company_rep_mult: EntropyEffect,
    faction_rep_mult: EntropyEffect,

    crime_money_mult: EntropyEffect,
    crime_success_mult: EntropyEffect,

    hacknet_node_money_mult: EntropyEffect,
    hacknet_node_purchase_cost_mult: EntropyEffect,
    hacknet_node_ram_cost_mult: EntropyEffect,
    hacknet_node_core_cost_mult: EntropyEffect,
    hacknet_node_level_cost_mult: EntropyEffect,

    work_money_mult: EntropyEffect,

    bladeburner_max_stamina_mult: EntropyEffect,
    bladeburner_stamina_gain_mult: EntropyEffect,
    bladeburner_analysis_mult: EntropyEffect,
    bladeburner_success_chance_mult: EntropyEffect,
};
