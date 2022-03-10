/*
    identify valuable augmentations
    - ones that increase desired stat
    - can afford

    while this list is not empty,
    buy the most expensive aug in the list

*/

const FLAGS = [
    ["help", false],
    ["buy", false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return ['hacking', 'combat', 'faction', 'all'];
}

/** @param {NS} ns **/
export async function main(ns) {
    const args = ns.flags(FLAGS);
    const domain = args._.shift();

    if (args.help) {
        for (const aug of selectAugs(ns, domain)) {
            ns.print(`${aug.name}: ${aug.value[domain] || ''} ${ns.nFormat(aug.price, "$0.0a")}`);
        }
        ns.tail();
    }
    else {
        await buyAugs(ns, domain, args.buy);
    }
}

export async function buyAugs(ns, domain, shouldBuy) {
    const plannedAugs = {};
    let bestAugs = selectAugs(ns, domain, plannedAugs);
    while (bestAugs.length > 0) {
        const aug = bestAugs.shift();
        ns.tprint(`Purchasing '${aug.name}' from ${aug.canPurchaseFrom} for ${ns.nFormat(aug.price, "$0.0a")}`);
        plannedAugs[aug.name] = true;
        if (shouldBuy) {
            ns.purchaseAugmentation(aug.canPurchaseFrom, aug.name);
            await ns.sleep(100);
            bestAugs = selectAugs(ns, domain, plannedAugs);
        }
    }
}

export function selectAugs(ns, domain, exclude={}) {
    for (const aug of ns.getOwnedAugmentations(true)) {
        exclude[aug] = true;
    }
    exclude["NeuroFlux Governor"] = false;
    const bestAugs = Object.values(listPotentialAugs(ns)).filter(function(aug) {
        return (
            aug.canPurchaseFrom != null &&
            aug.price < ns.getPlayer().money &&
            aug.value[domain] > 1.0 &&
            !exclude[aug.name]
        )
    }).sort(function(a,b){
        return b.sortKey - a.sortKey
    });
    return bestAugs;
}

export function listPotentialAugs(ns) {
    const player = ns.getPlayer();
    const augs = {};
    for (const faction of player.factions) {
        for (const name of ns.getAugmentationsFromFaction(faction)) {
            augs[name] ||= {};
            const aug = augs[name]
            aug.name = name;
            aug.factions ||= [];
            aug.factions.push(faction);
            aug.repReq = ns.getAugmentationRepReq(name);
            aug.price = ns.getAugmentationPrice(name);
            aug.stats = ns.getAugmentationStats(name);
            aug.value = {
                hacking: estimateHackingValue(aug),
                combat: estimateCombatValue(aug),
                faction: estimateFactionValue(aug)
            };
            aug.value.all = aug.value.hacking + aug.value.combat + aug.value.faction;
            aug.canPurchaseFrom = canPurchaseFrom(ns, aug);
            aug.sortKey = aug.price;
            if (aug.name == "NeuroFlux Governor") {
                aug.sortKey = aug.price / 10;
            }
        }
    }
    return augs;
}

export function canPurchaseFrom(ns, aug) {
    const ownedAugs = ns.getOwnedAugmentations();
    for (const prereq of ns.getAugmentationPrereq(aug.name)) {
        if (!ownedAugs.includes(prereq)) {
            return null;
        }
    }

    for (const faction of aug.factions) {
        if (ns.getFactionRep(faction) >= aug.repReq) {
            return faction;
        }
    }
}

export function estimateHackingValue(aug) {
    const stats = aug.stats;
    return (
        (stats.hacking_mult || 1.0) *
        (stats.hacking_exp_mult || 1.0) *
        (stats.hacking_chance_mult || 1.0) *
        (stats.hacking_money_mult || 1.0) *
        (stats.hacking_speed_mult || 1.0)
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

export function estimateFactionValue(aug) {
    const stats = aug.stats;
    return (
        (stats.charisma_exp_mult || 1.0) *
        (stats.charisma_mult || 1.0) *
        ((stats.company_rep_mult || 1.0) + (stats.faction_rep_mult || 1.0) - 1.0)
    )
}
