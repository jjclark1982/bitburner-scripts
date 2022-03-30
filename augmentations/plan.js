/*

/augmentations/plan.js

List the best augmentations available now, most expensive first.

Usage:
run /augmentations/plan.js [ hacking | combat | cha | faction | blade | hacknet | neuro | all ... ] [ --buy ]

*/

import { DOMAINS, getAllAugmentations, totalValue } from "augmentations/info.js";

const FLAGS = [
    ["help", false],
    ["buy", false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return Object.keys(DOMAINS);
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
            `${ns.getScriptName()} [ ${Object.keys(DOMAINS).join(' | ')} ... ] [ --buy ]`,
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
        if (!(filter in DOMAINS)) {
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
    ns.tprint([
        "Finished buying augmentations. Don't forget:",
        "  - Buy augmentations for sleeves",
        "  - Buy equipment for gang members",
        "  - Upgrade home server",
        "  - Spend hacknet hashes on Bladeburner rank and SP",
        "  - Spend hacknet hashes on corporation research and funds",
        "  - Buyback corporation shares"
    ].join("\n"));
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
    const augs = getAllAugmentations(ns);
    for (const [name, aug] of Object.entries(augs)) {
        aug.canPurchaseFrom = canPurchaseFrom(ns, aug, plannedAugs);
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
