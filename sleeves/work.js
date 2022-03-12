export async function main(ns) {
    const player = ns.getPlayer();
    const jobs = Object.keys(player.jobs);
    const specialFactions = ["Church of the Machine God", "Bladeburners"]
    const factions = player.factions.reverse().filter(function(faction){
        return !specialFactions.includes(faction);
    });

    for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
        ns.sleeve.setToSynchronize(i);
    }
    for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
        let j = i - jobs.length;
        if (i < jobs.length) {
            ns.sleeve.setToCompanyWork(i, jobs[i]);
        }
        else if (j < factions.length) {
            const faction = factions[j];
            // ns.tprint(`sleeve ${i} working for faction ${faction}`)
            ns.sleeve.setToFactionWork(i, faction, "Hacking Contracts");
            if (ns.sleeve.getTask(i).task == "Idle") {
                ns.sleeve.setToFactionWork(i, faction, "Field Work");
            }
        }
        else {
            // ns.sleeve.setToUniversityCourse(i, "Rothman University", "Algorithms");
            ns.sleeve.setToCommitCrime(i, "Mug");
        }
    }
}
