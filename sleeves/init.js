export async function main(ns) {
    for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
        const stats = ns.sleeve.getSleeveStats(i);
        if (stats.shock > 20) {
            ns.sleeve.setToShockRecovery(i);
        }
        else if (stats.sync < 100) {
            ns.sleeve.setToSynchronize(i);
        }
        else if (i == 0) {ns.sleeve.setToUniversityCourse(0, "Rothman University", "Algorithms");}
        else if (i == 1) {ns.sleeve.setToGymWorkout(1, "Powerhouse Gym", "Strength");}
        else if (i == 2) {ns.sleeve.setToGymWorkout(2, "Powerhouse Gym", "Defense");}
        else if (i == 3) {ns.sleeve.setToGymWorkout(3, "Powerhouse Gym", "Dexterity");}
        else if (i == 4) {ns.sleeve.setToGymWorkout(4, "Powerhouse Gym", "Agility");}
        else if (i == 5) {ns.sleeve.setToUniversityCourse(5, "Rothman University", "Leadership");}
        else {ns.sleeve.setToCommitCrime(6, "Mug");  }
    }
}
