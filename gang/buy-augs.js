/** @param {NS} ns **/
export async function main(ns) {
    if (!ns.gang.inGang()) {
        return;
    }
    buyAugsForAllMembers(ns);
}

export function buyAugsForAllMembers(ns) {
    for (const memberName of ns.gang.getMemberNames()) {
        buyAugs(ns, member);
    }
}

export function buyAugs(ns, member) {
    const player = ns.getPlayer();
    const gang = ns.gang.getGangInformation();
    for (const equip of getEquipments(ns)) {
        if (member.upgrades.includes(equip.name) || member.augmentations.includes(equip.name)) {
            continue;
        }
        let fundsFraction = 0.0001;
        if (equip.type == "Augmentation") {
            fundsFraction = 0.001;
        }
        else if ((equip.type == "Rootkit") != (gang.isHacking)) {
            fundsFraction = 0.00005;
        }
        if (equip.cost < player.money * fundsFraction) {
            ns.gang.purchaseEquipment(member.name, equip.name);
        }
    }
}

export function getEquipments(ns) {
    const equipments = ns.gang.getEquipmentNames().map(function(name){
        return {
            name: name,
            type: ns.gang.getEquipmentType(name),
            cost: ns.gang.getEquipmentCost(name),
            stats: ns.gang.getEquipmentStats(name)
        }
    });
    return equipments;
}
