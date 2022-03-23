import { getEquipments } from "gang/buy-augs.js";

export function autocomplete(data, args) {
    return ["gang", "members", "otherGangs", "tasks", "equipments"];
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.clearLog();
    ns.tail();

    const gang = ns.gang.getGangInformation();
    if (ns.args.includes("gang")) {
        ns.print(JSON.stringify(gang,null,2));
    }
    if (ns.args.includes("members")) {
        for (const memberName of ns.gang.getMemberNames()) {
            const member = ns.gang.getMemberInformation(memberName);
            ns.print(JSON.stringify(member, null, 2));
        }
    }
    if (ns.args.includes("otherGangs")) {
        ns.print(JSON.stringify(ns.gang.getOtherGangInformation(), null, 2));
    }
    if (ns.args.includes("tasks")) {
        for (const taskName of ns.gang.getTaskNames()) {
            const task = ns.gang.getTaskStats(taskName);
            ns.print(JSON.stringify(task, null, 2));
        }
    }
    if (ns.args.includes("equipments")) {
        for (const equipment of getEquipments(ns)) {
            ns.print(JSON.stringify(equipment, null, 2))
        }
    }
}
