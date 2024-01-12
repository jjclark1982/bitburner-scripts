/*

/augmentations/buy.js (35.6 GB)

List augmentations that boost a given kind of stats, starting with the most expensive.
Optionally buy them.

Usage:
run /augmentations/buy.js [ hacking | charisma | combat | crime | faction | hacknet | bladeburner | all ... ] [ --begin ]

*/

import { DOMAINS, getAllAugmentations, averageValue } from "augmentations/info.js";

const FLAGS = [
    ["help", false],
    ["begin", false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return Object.keys(DOMAINS);
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog('sleep');
    ns.clearLog();

    const flags = ns.flags(FLAGS);
    const domains = flags._;
    if (flags.help || domains.length == 0) {
        ns.tprint([
            `List augmentations that boost a given kind of stats, starting with the most expensive. Optionally buy them.`,
            '',
            'Usage: ',
            `${ns.getScriptName()} [ ${Object.keys(DOMAINS).join(' | ')} ... ] [ --begin ]`,
            '',
            `Example: List all augs that increase hacking stats or faction rep gain`,
            `> run ${ns.getScriptName()} hacking faction`,
            '',
            `Example: Buy all augs that increase hacking, including NeuroFlux Governor repeatedly`,
            `> run ${ns.getScriptName()} hacking --begin`,
            ' '
        ].join("\n"));
        return;
    }
    for (const domain of domains) {
        if (!(domain in DOMAINS)) {
            ns.tprint(`Unknown augmentation type: '${domain}'`);
            return;
        }
    }

    const augPlan = planAugs(ns, domains);
    const summary = [`Augmentation Buying Plan: ${domains.join(', ')}`];
    for (const aug of augPlan) {
        const value = averageValue(aug, domains).toFixed(2);
        summary.push(`  '${aug.name}' (${value}x) from ${aug.canPurchaseFrom} for ${ns.nFormat(aug.price, "$0.0a")}`)
    }
    ns.print(summary.join("\n"), "\n");

    if (flags.begin) {
        await buyAugs(ns, domains);
    }
    else {
        ns.tail();
    }
}

export async function buyAugs(ns, domains) {
    const plannedAugs = {};
    let selectedAugs = selectAugs(ns, domains, plannedAugs);
    while (selectedAugs.length > 0) {
        const aug = selectedAugs.shift();
        plannedAugs[aug.name] = true;
        if (aug.price < ns.getPlayer().money) {
            ns.purchaseAugmentation(aug.canPurchaseFrom, aug.name);
            ns.tprint(`Purchased '${aug.name}' from ${aug.canPurchaseFrom} for ${ns.nFormat(aug.price, "$0.0a")}`);
        }
        selectedAugs = selectAugs(ns, domains, plannedAugs);
        if (ns.singularity.getAugmentationPrice("NeuroFlux Governor") < ns.getPlayer().money) {
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

export function planAugs(ns, domains) {
    const plannedAugs = {};
    let selectedAugs = selectAugs(ns, domains, plannedAugs);
    while (selectedAugs.length > 0) {
        const aug = selectedAugs.shift();
        plannedAugs[aug.name] = aug;
        selectedAugs = selectAugs(ns, domains, plannedAugs);
        while (selectedAugs.length > 0 && selectedAugs[0].name in plannedAugs) {
            selectedAugs.shift();
        }
    }
    return Object.values(plannedAugs);
}

export function selectAugs(ns, domains, plannedAugs) {
    const exclude = {};
    for (const aug of Object.keys(plannedAugs)) {
        exclude[aug] = true;
    }
    for (const aug of ns.singularity.getOwnedAugmentations(true)) {
        exclude[aug] = true;
    }
    exclude["NeuroFlux Governor"] = false;
    const knownAugs = getKnownAugs(ns, plannedAugs);
    const buyableAugs = Object.values(knownAugs).filter(function(aug) {
        return (
            aug.canPurchaseFrom != null &&
            averageValue(aug, domains) > 1.0 &&
            !exclude[aug.name]
        )
    }).sort(function(a,b){
        return b.sortKey - a.sortKey
    });
    return buyableAugs;
}

export function getKnownAugs(ns, plannedAugs) {
    const augs = getAllAugmentations(ns);
    // Fill in purchasing info
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
    const ownedAugs = ns.singularity.getOwnedAugmentations(true);
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
