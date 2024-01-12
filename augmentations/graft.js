/*

/augmentations/graft.js (43.1 GB)

List the best augmentations available to graft.
Optionally graft them.

run /augmentations/graft.js [ hacking | charisma | combat | crime | faction | hacknet | bladeburner | all ... ] [ --begin ]

*/

import { DOMAINS, getAllAugmentations, averageValue } from "augmentations/info.js";

const FLAGS = [
    ['help', false],
    ['begin', false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return Object.keys(DOMAINS);
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("sleep");
    ns.clearLog();

    const flags = ns.flags(FLAGS);
    let domains = flags._;
    if (domains.length == 0) {
        domains = ['all'];
    }

    if (flags.help) {
        ns.tprint([
            'List the best augmentations available to graft, sorted by (multipliers / time). Optionally graft them.',
            '',
            'Usage: ',
            `${ns.getScriptName()} [ ${Object.keys(DOMAINS).join(' | ')} ... ] [ --begin ]`,
            '',
            'Example: List all augmentations that increase charisma or faction rep gain.',
            `> run ${ns.getScriptName()} charisma faction`,
            '',
            'Example: Graft all augmentations that increase hacking stats.',
            `> run ${ns.getScriptName()} hacking --begin`,
            ' '
        ].join("\n"));
        return;
    }

    const graftableAugs = getGraftableAugs(ns, {domains});
    const summary = [`Augmentation Grafting Plan: ${domains.join(', ')}`];
    for (const aug of graftableAugs) {
        const price = sprintf("%10s", ns.nFormat(aug.price, "$0.0a"));
        summary.push(`${price} (${(aug.time/60/60/1000).toFixed(1)} hr) for (${aug.totalValue.toFixed(2)}x) '${aug.name}'`);
    }
    ns.print(summary.join("\n"), "\n");

    if (flags.begin) {
        await graftAugs(ns, domains);
    }
    else {
        ns.tail();
    }
}

export async function graftAugs(ns, domains) {
    let augs = getGraftableAugs(ns, {domains, canAfford: true});
    while (augs.length > 0) {
        const aug = augs[0];
        const player = ns.getPlayer();
        if (player.isWorking) {
            if (player.workType == "Grafting an Augmentation") {
                ns.print(`Waiting to finish ${player.workType}...`);
                while (ns.getPlayer().workType == "Grafting an Augmentation") {
                    await ns.sleep(60*1000);
                }
                continue;
            }
            else {
                ns.tprint(`Not starting grafting because player is already ${player.workType}.`);
                return;
            }
        }
        if (player.city !== "New Tokyo") {
            ns.travelToCity("New Tokyo");
        }
        const success = ns.grafting.graftAugmentation(aug.name);
        if (success) {
            ns.print(`Started to graft '${aug.name}'.`);
            await ns.sleep(aug.time);
        }
        else {
            ns.print(`Failed to graft '${aug.name}'.`);
            await ns.sleep(1000);
        }
        augs = getGraftableAugs(ns, {domains, canAfford: true});
    }
    ns.tprint("Grafted all affordable net-positive augmentations.");
}

export function getGraftableAugs(ns, {domains, canAfford}) {
    const allAugs = Object.values(getAllAugmentations(ns));
    const ownedAugs = ns.singularity.getOwnedAugmentations(true);
    const exclude = ["The Red Pill", "NeuroFlux Governor"];

    let graftableAugs = allAugs.filter((aug)=>(
        (!aug.isSpecial) &&
        (!exclude.includes(aug.name)) &&
        (!ownedAugs.includes(aug.name))
    )).map(function(aug){
        estimateGraftValues(ns, aug);
        aug.totalValue = averageValue(aug, domains);
        aug.price = ns.grafting.getAugmentationGraftPrice(aug.name);
        aug.time = ns.grafting.getAugmentationGraftTime(aug.name);
        aug.sortKey = (aug.totalValue-1) / (aug.time + 15*60*1000);
        aug.prereqsMet = aug.prereqs.every((a)=>ownedAugs.includes(a));
        return aug;
    }).sort(function(a,b){
        return b.sortKey - a.sortKey;
    });

    if (canAfford) {
        graftableAugs = graftableAugs.filter((aug)=>(
            aug.prereqsMet &&
            (aug.price < ns.getPlayer().money) &&
            (aug.totalValue > 1.0)
        ));
    }

    return graftableAugs;
}

export function estimateGraftValues(ns, aug) {
    const entropy = {
        name: "Entropy",
        stats: entropyStats,
        value: {}
    };
    aug.stats = {};
    for (const [key, value] of Object.entries(ns.singularity.getAugmentationStats(aug.name))) {
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
