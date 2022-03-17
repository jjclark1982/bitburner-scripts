import { ascendIfReady } from "gang/ascend.js";

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("sleep");

    // ns.tail();
    // ns.print(JSON.stringify(getEquipments(ns), null ,2))
    // await ns.sleep(100);
    // return;

    if (!ns.gang.inGang) {
        return;
    }

    while (true) {
        await updateMembers(ns);
        await ns.sleep(10*1000);
        updateTerritory(ns);
    }
}

async function updateMembers(ns) {
    if (ns.gang.canRecruitMember()) {
        ns.gang.recruitMember(makeid());
    }
    for (const memberName of ns.gang.getMemberNames()) {
        const member = ns.gang.getMemberInformation(memberName);
        await ns.sleep(2500);
        updateMember(ns, member);
    }
}

function updateMember(ns, member) {
    const gang = ns.gang.getGangInformation();
    
    ascendIfReady(ns, member, 3.0);

    buyAugs(ns, member);

    if (member.cha_exp < 1000) {
        ns.gang.setMemberTask(member.name, "Train Charisma")
    }
    else if (member.hack_exp < 1000) {
        ns.gang.setMemberTask(member.name, "Train Hacking")
    }
    else if (member.str_exp < 10000) {
        ns.gang.setMemberTask(member.name, "Train Combat")
    }
    else if (gang.wantedLevelGainRate > 0) {
        ns.gang.setMemberTask(member.name, "Vigilante Justice");
    }
    else if (member.str > 50000 && gang.territory < 0.99) {
        ns.gang.setMemberTask(member.name, "Territory Warfare");
    }
    else {
        // for (const taskName of ns.gang.getTaskNames()) {
        //     const task = ns.gang.getTaskStats(taskName);
        //     ns.print(JSON.stringify(task, null, 2));
        // }
        // TODO: check if task.isHacking matches our gang
        // TODO: check if effective wanted level change < gang.wantedLevelGainRate

        ns.gang.setMemberTask(member.name, "Strongarm Civilians")
    }
}

function buyAugs(ns, member) {
    const player = ns.getPlayer();
    for (const equip of getEquipments(ns)) {
        if (member.upgrades.includes(equip.name) || member.augmentations.includes(equip.name)) {
            continue;
        }
        let fundsFraction = 0.0001;
        if (equip.type == "Augmentation") {
            fundsFraction = 0.001;
        }
        if (equip.type == "Rootkit") {
            fundsFraction = 0.00005;
        }
        if (equip.cost < player.money * fundsFraction) {
            ns.gang.purchaseEquipment(member.name, equip.name);
        }
    }
}

function getEquipments(ns) {
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

function updateTerritory(ns) {
    const gang = ns.gang.getGangInformation();
    const allGangs = ns.gang.getOtherGangInformation();

    if (gang.territory > 0.99 && gang.territoryWarfareEngaged) {
        ns.gang.setTerritoryWarfare(false);
        return;
    }

    let anyStronger = false;
    for (const gangName of Object.keys(allGangs)) {
        if (gangName == gang.faction) {
            continue;
        }
        // TODO: maybe check actual ns.gang.getChanceToWinClash(gangName)
        if (allGangs[gangName].power > gang.power) {
            anyStronger = true;
            break;
        }
    }

    if (anyStronger && gang.territoryWarfareEngaged) {
        ns.gang.setTerritoryWarfare(false);
    }
    else if (!anyStronger && !gang.territoryWarfareEngaged) {
        ns.gang.setTerritoryWarfare(true);
    }
}

function makeid(length=6) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
   }
   return result;
}
