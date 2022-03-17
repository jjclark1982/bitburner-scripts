export async function main(ns) {
    for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
        trainSleeve(ns, i);
    }
}

export function trainSleeve(ns, i) {
    if (i == 0) {
        ns.sleeve.setToUniversityCourse(i, "Rothman University", "Algorithms");
    }
    else if (i == 1) {
        ns.sleeve.setToGymWorkout(i, "Powerhouse Gym", "Strength");
    }
    else if (i == 2) {
        ns.sleeve.setToGymWorkout(i, "Powerhouse Gym", "Defense");
    }
    else if (i == 3) {
        ns.sleeve.setToGymWorkout(i, "Powerhouse Gym", "Dexterity");
    }
    else if (i == 4) {
        ns.sleeve.setToGymWorkout(i, "Powerhouse Gym", "Agility");
    }
    else if (i == 5) {
        ns.sleeve.setToUniversityCourse(i, "Rothman University", "Leadership");
    }
    else {
        // ns.sleeve.setToCommitCrime(i, "Mug");
        ns.sleeve.setToUniversityCourse(i, "Rothman University", "Algorithms");
    }
}
