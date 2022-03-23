/*

/augmentations/plan.js

List the best augmentations available now, most expensive first.

Usage:
run /augmentations/plan.js [ hacking | combat | cha | faction | blade | hacknet | neuro | all ... ] [ --buy ]

*/

const FLAGS = [
    ["help", false],
    ["buy", false]
];

export const FILTERS = {
    "hacking":     estimateHackingValue,
    "charisma":    estimateCharismaValue,
    "combat":      estimateCombatValue,
    "crime":       estimateCrimeValue,
    "faction":     estimateFactionValue,
    "hacknet":     estimateHacknetValue,
    "bladeburner": estimateBladeburnerValue,
    "neuroflux":   estimateNeurofluxValue,
    "all":         estimateAllValue            // note that 'all' runs last so that it can refer to others
};

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return Object.keys(FILTERS);
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog('sleep');
    ns.clearLog();

    const args = ns.flags(FLAGS);
    const filters = args._;
    if (args.help || filters.length == 0) {
        ns.tprint([
            `Select augmentations to buy.`,
            '',
            'Usage: ',
            `${ns.getScriptName()} [ ${Object.keys(FILTERS).join(' | ')} ... ] [ --buy ]`,
            '',
            `Example: See all augs that increase hacking, including NeuroFlux Governor`,
            `> run ${ns.getScriptName()} hacking neuroflux`,
            '',
            `Example: Buy all augs that increase hacking, including NeuroFlux Governor repeatedly`,
            `> run ${ns.getScriptName()} hacking neuroflux --buy`,
            ' '
        ].join("\n"));
        return;
    }
    for (const filter of filters) {
        if (!(filter in FILTERS)) {
            ns.tprint(`Unknown augmentation type: '${filter}'`);
            return;
        }
    }


    const augPlan = planAugs(ns, filters);
    const summary = [`Augmentation Plan: ${filters.join(', ')}`];
    for (const aug of augPlan) {
        summary.push(`  '${aug.name}' from ${aug.canPurchaseFrom} for ${ns.nFormat(aug.price, "$0.0a")}`)
    }
    ns.print(summary.join("\n"), "\n");

    if (args.buy) {
        await buyAugs(ns, filters);
    }
    else {
        ns.tail();
    }
}

export async function buyAugs(ns, filters) {
    const plannedAugs = {};
    let selectedAugs = selectAugs(ns, filters, plannedAugs);
    while (selectedAugs.length > 0) {
        const aug = selectedAugs.shift();
        plannedAugs[aug.name] = true;
        if (aug.price < ns.getPlayer().money) {
            ns.purchaseAugmentation(aug.canPurchaseFrom, aug.name);
            ns.tprint(`Purchased '${aug.name}' from ${aug.canPurchaseFrom} for ${ns.nFormat(aug.price, "$0.0a")}`);
        }
        selectedAugs = selectAugs(ns, filters, plannedAugs);
        if (ns.getAugmentationPrice("NeuroFlux Governor") < ns.getPlayer().money) {
            delete plannedAugs["NeuroFlux Governor"];
        }
        while (selectedAugs.length > 0 && selectedAugs[0].name in plannedAugs) {
            selectedAugs.shift();
        }
        await ns.sleep(100);
    }
}

export function planAugs(ns, filters) {
    const plannedAugs = {};
    let selectedAugs = selectAugs(ns, filters, plannedAugs);
    while (selectedAugs.length > 0) {
        const aug = selectedAugs.shift();
        plannedAugs[aug.name] = aug;
        selectedAugs = selectAugs(ns, filters, plannedAugs);
        while (selectedAugs.length > 0 && selectedAugs[0].name in plannedAugs) {
            selectedAugs.shift();
        }
    }
    return Object.values(plannedAugs);
}

export function selectAugs(ns, filters, plannedAugs) {
    const exclude = {};
    for (const aug of Object.keys(plannedAugs)) {
        exclude[aug] = true;
    }
    for (const aug of ns.getOwnedAugmentations(true)) {
        exclude[aug] = true;
    }
    exclude["NeuroFlux Governor"] = false;
    const knownAugs = getKnownAugs(ns, plannedAugs);
    const buyableAugs = Object.values(knownAugs).filter(function(aug) {
        return (
            aug.canPurchaseFrom != null &&
            totalValue(aug, filters) > 1.0 &&
            !exclude[aug.name]
        )
    }).sort(function(a,b){
        return b.sortKey - a.sortKey
    });
    return buyableAugs;
}

export function getKnownAugs(ns, plannedAugs) {
    const player = ns.getPlayer();
    const augs = {};
    // Instantiate all aug objects from current factions
    for (const faction of player.factions) {
        for (const name of ns.getAugmentationsFromFaction(faction)) {
            augs[name] ||= {};
            const aug = augs[name]
            aug.factions ||= {};
            aug.factions[faction] = [ns.getFactionRep(faction), ns.getAugmentationRepReq(name)];
        }
    }
    // Populate aug objects with details
    for (const [name, aug] of Object.entries(augs)) {
        aug.name = name;
        aug.repReq = ns.getAugmentationRepReq(name);
        aug.price = ns.getAugmentationPrice(name);  // TODO: estimate future prices with MultipleAugMultiplier = 1.9;
        aug.stats = ns.getAugmentationStats(name);
        aug.value = {};
        for (const [domain, estimate] of Object.entries(FILTERS)) {
            aug.value[domain] = estimate(aug);
        }
        aug.prereqs = ns.getAugmentationPrereq(aug.name);
        aug.canPurchaseFrom = canPurchaseFrom(ns, aug, plannedAugs);
        aug.neededFactions = factionsToWork(aug);
        aug.sortKey = aug.price;
        if (aug.name == "NeuroFlux Governor") {
            aug.sortKey = 1e3;
        }
    }
    // Adjust sortKey of prerequisites if their successors could be bought immediately
    for (const [name, aug] of Object.entries(augs)) {
        for (const prereq of aug.prereqs) {
            const plan = {};
            plan[prereq] = true;
            if (augs[prereq].canPurchaseFrom && canPurchaseFrom(ns, aug, plan)) {
                aug.sortKey += augs[prereq].sortKey;
                augs[prereq].sortKey = aug.sortKey + 1;
            }
        }
    }
    return augs;
}

export function canPurchaseFrom(ns, aug, plannedAugs={}) {
    const ownedAugs = ns.getOwnedAugmentations(true);
    for (const prereq of aug.prereqs) {
        if (!(ownedAugs.includes(prereq) || prereq in plannedAugs)) {
            return null;
        }
    }
    for (const [faction, [rep, repReq]] of Object.entries(aug.factions)) {
        if (rep >= repReq) {
            return faction;
        }
    }
    return null;
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

export function getFutureAugs(ns, filters) {
    const allAugs = Object.values(getKnownAugs(ns));

    const futureAugs = allAugs.filter(function(aug){
        return (
            (aug.neededFactions.length > 0) &&
            (totalValue(aug, filters) > 1.0)
        )
    }).map(function(aug){
        aug.sortKey = totalValue(aug, filters) / aug.neededFactions[0].repNeeded;
        return aug;
    }).sort(function(a,b){
        return b.sortKey - a.sortKey;
    });

    return futureAugs;
}


// -------------------- value estimators --------------------


export function estimateHackingValue(aug) {
    const stats = aug.stats;
    if (aug.name === "BitRunners Neurolink") {
        return 2;
    }
    if (aug.name === "CashRoot Starter Kit") {
        return 2;
    }
    if (aug.name === "PCMatrix") {
        return 1.5;
    }
    return (
        (stats.hacking_mult || 1.0) *
        (stats.hacking_exp_mult || 1.0) *
        (stats.hacking_chance_mult || 1.0) *
        (stats.hacking_money_mult || 1.0) *
        (stats.hacking_speed_mult || 1.0) *
        (stats.hacking_grow_mult || 1.0)
    )
}

export function estimateCombatValue(aug) {
    const stats = aug.stats;
    return (
        (stats.agility_exp_mult || 1.0) * (stats.agility_mult || 1.0) +
        (stats.defense_exp_mult || 1.0) * (stats.defense_mult || 1.0) +
        (stats.strength_exp_mult || 1.0) * (stats.strength_mult || 1.0) +
        (stats.dexterity_exp_mult || 1.0) * (stats.dexterity_mult || 1.0)
        - 3.0
    )
}

export function estimateCharismaValue(aug) {
    const stats = aug.stats;
    return (
        (stats.charisma_exp_mult || 1.0) *
        (stats.charisma_mult || 1.0)
    )
}

export function estimateCrimeValue(aug) {
    const stats = aug.stats;
    return (
        (stats.crime_money_mult || 1.0) * (stats.crime_success_mult || 1.0)
    )
}

export function estimateFactionValue(aug) {
    const stats = aug.stats;
    if (aug.name === "Neuroreceptor Management Implant") {
        return 2;
    }
    return (
        (stats.company_rep_mult || 1.0)
        +
        Math.sqrt(stats.work_money_mult || 1.0)
        +
        (stats.faction_rep_mult || 1.0)
        - 2.0
    )
}

export function estimateHacknetValue(aug) {
    const stats = aug.stats;
    return (
        (
            (stats.hacknet_node_money_mult || 1.0) *
            (1 / (stats.hacknet_node_level_cost_mult || 1.0)) *
            (1 / (stats.hacknet_node_core_cost_mult || 1.0)) *
            (1 / (stats.hacknet_node_ram_cost_mult || 1.0))
        ) 
        +
        (1 / (stats.hacknet_node_purchase_cost_mult || 1.0))
        - 1.0
    )
}

export function estimateBladeburnerValue(aug) {
    const stats = aug.stats;
    if (aug.name === "The Blade's Simulacrum") {
        return 2;
    }
    return (
        ((stats.bladeburner_success_chance_mult || 1.0) * (stats.bladeburner_stamina_gain_mult || 1.0))
        +
        (stats.bladeburner_max_stamina_mult || 1.0)
        +
        (stats.bladeburner_analysis_mult || 1.0)
        - 2.0
    )
}

export function estimateNeurofluxValue(aug) {
    if (aug.name === "NeuroFlux Governor") {
        return 2;
    }
    else {
        return 1;
    }
}

export function estimateAllValue(aug) {
    delete aug.value.all;
    const total = totalValue(aug);
    // if (total <= 1.0) {
    //     console.log("some aug had no ALL value: ", aug);
    // }
    return total;
}

export function totalValue(aug, domains) {
    let total = 1.0;
    for (const domain of domains || Object.keys(aug.value)) {
        total += Math.max(0, aug.value[domain] - 1.0);
    }
    return total;
}
