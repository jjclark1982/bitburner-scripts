export async function main(ns) {
    let crimeName = ns.args[0];
    for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
        const stats = ns.sleeve.getSleeveStats(i);
        let defaultCrime = "mug";
        if (stats.strength > 200) {
            defaultCrime = "homicide";
        }
        ns.sleeve.setToCommitCrime(i, crimeName || defaultCrime);
    }
}
