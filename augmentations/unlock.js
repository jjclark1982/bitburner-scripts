/*

/augmentations/unlock.js (34.1 GB)

List augmentations that can be unlocked soon, sorted by least reputation required.
Optionally work to unlock them.

Usage:
run /augmentations/unlock.js [ hacking | charisma | combat | crime | faction | hacknet | bladeburner | all ... ] [ --begin ]

*/

import { DOMAINS, getAllAugmentations, averageValue } from "augmentations/info.js";
import { canPurchaseFrom } from "augmentations/buy.js";

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
            'List augmentations that can be unlocked soon, sorted by least reputation required. Optionally work to unlock them.',
            '',
            'Usage: ',
            `> ${ns.getScriptName()} [ ${Object.keys(DOMAINS).join(' | ')} ... ] [ --begin ]`,
            '',
            'Example: List all augmentations that increase combat or crime stats.',
            `> run ${ns.getScriptName()} combat crime`,
            '',
            'Example: Work for all factions that will unlock hacking augmentations.',
            `> run ${ns.getScriptName()} hacking --begin`,
            ' '
        ].join("\n"));
        return;
    }

    const futureAugs = getFutureAugs(ns, {domains});
    const summary = [`Augmentation Unlocking Plan: ${domains.join(', ')}`];
    for (const aug of futureAugs) {
        const faction = aug.neededFactions[0];
        const rep = sprintf("%+12s", ns.nFormat(faction.repNeeded, '0,0'));
        const value = averageValue(aug, domains).toFixed(2);
        summary.push(`${rep} more rep with ${faction.name} for '${aug.name}' (${value}x)`);
    }
    ns.print(summary.join("\n"), "\n");

    if (flags.begin) {
        await unlockAugs(ns, domains);
    }
    else {
        ns.tail();
    }
}

export async function unlockAugs(ns, domains) {
    let futureAugs = getFutureAugs(ns, {domains, requireWorkable: true});
    while (futureAugs.length > 0) {
        const aug = futureAugs[0];
        const faction = aug.canWorkNow;
        const player = ns.getPlayer();
        if (player.isWorking && player.workType !== "Working for Faction") {
            ns.tprint(`Not starting faction work because player is already ${player.workType}.`);
            return;
        }
        for (const workType of getWorkTypes(player)) {
            if (ns.workForFaction(faction.name, workType, false)) {
                break;
            }
        }
        await ns.sleep(60*1000);
        if (!ns.getPlayer().isWorking) {
            // Support manually exiting the process.
            return;
        }
        futureAugs = getFutureAugs(ns, {domains, requireWorkable: true});
    }
}

export function getFutureAugs(ns, {domains, requireWorkable}) {
    const allAugs = Object.values(getAllAugmentations(ns));
    const ownedAugs = ns.singularity.getOwnedAugmentations(true);

    const futureAugs = allAugs.map(function(aug){
        aug.canPurchaseFrom = canPurchaseFrom(ns, aug);
        aug.neededFactions = factionsToWork(aug);
        aug.canWorkNow = aug.neededFactions.filter((fac)=>canWorkForFaction(ns, fac.name))[0];
        return aug;
    }).filter(function(aug){
        return (
            (!requireWorkable || aug.canWorkNow) &&
            (!ownedAugs.includes(aug.name)) &&
            (aug.neededFactions.length > 0) &&
            (averageValue(aug, domains) > 1.0)
        )
    }).map(function(aug){
        aug.sortKey = averageValue(aug, domains) / aug.neededFactions[0].repNeeded;
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

export function canWorkForFaction(ns, faction) {
    const specialFactions = ["Church of the Machine God", "Bladeburners"]
    if (ns.gang.inGang()) {
        specialFactions.push(ns.gang.getGangInformation().faction);
    }
    if (specialFactions.includes(faction)) {
        return false;
    }
    return ns.getPlayer().factions.includes(faction);
}

export function getWorkTypes(player) {
    if (player.hacking > player.strength) {
        return ["hacking contracts", "field work", "security"];
    }
    else {
        return ["field work", "security", "hacking contracts"];
    }
}
