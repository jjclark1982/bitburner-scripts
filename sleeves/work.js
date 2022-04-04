export async function main(ns) {
    clearSleeves(ns);
    for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
        workSleeve(ns, i);
    }
}

export function clearSleeves(ns) {
    for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
        ns.sleeve.setToSynchronize(i);
    }
}

export function workSleeve(ns, i) {
    const player = ns.getPlayer();
    const jobs = Object.keys(player.jobs);
    const specialFactions = ["Church of the Machine God", "Bladeburners"]
    if (ns.gang.inGang()) {
        specialFactions.push(ns.gang.getGangInformation().faction);
    }
    const factions = player.factions.filter(function(faction){
        return !specialFactions.includes(faction);
    });

    let j = i - jobs.length;
    if (i < jobs.length) {
        ns.sleeve.setToCompanyWork(i, jobs[i]);
    }
    else if (j < factions.length) {
        const faction = factions[j];
        // ns.tprint(`sleeve ${i} working for faction ${faction}`)
        ns.sleeve.setToFactionWork(i, faction, "Field Work");
        if (ns.sleeve.getTask(i).task == "Idle") {
            ns.sleeve.setToFactionWork(i, faction, "Hacking Contracts");
        }
    }
    else {
        // ns.sleeve.setToUniversityCourse(i, "Rothman University", "Algorithms");
        ns.sleeve.setToCommitCrime(i, "Mug");
    }
}
