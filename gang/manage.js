import { ascendIfReady } from "gang/ascend.js";
import { buyAugs } from "gang/buy-augs.js";

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("sleep");

    if (!ns.gang.inGang()) {
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

    const wantedStats = {
        cha_exp: 1000,
        str_exp: (gang.isHacking ? 1000 : 10000),
        hack_exp: (gang.isHacking ? 10000 : 1000)
    };

    if (member.cha_exp < wantedStats.cha_exp) {
        ns.gang.setMemberTask(member.name, "Train Charisma")
    }
    else if (member.hack_exp < wantedStats.hack_exp) {
        ns.gang.setMemberTask(member.name, "Train Hacking")
    }
    else if (member.str_exp < wantedStats.str_exp) {
        ns.gang.setMemberTask(member.name, "Train Combat")
    }
    else if (gang.wantedLevelGainRate > 0) {
        // gang.wantedPenalty < 0.95
        if (gang.isHacking && (member.hack > member.str)) {
            ns.gang.setMemberTask(member.name, "Ethical Hacking");
        }
        else {
            ns.gang.setMemberTask(member.name, "Vigilante Justice");
        }
    }
    else if (gang.territory < 0.99 && member.str > 50000) {
        ns.gang.setMemberTask(member.name, "Territory Warfare");
    }
    else {
        // TODO: check if task.isHacking matches our gang
        // TODO: check if effective wanted level change < gang.wantedLevelGainRate
        if (gang.isHacking) {
            ns.gang.setMemberTask(member.name, "Cyberterrorism");
        }
        else {
            ns.gang.setMemberTask(member.name, "Strongarm Civilians");
        }
    }
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
