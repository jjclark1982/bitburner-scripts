export async function main(ns) {
    let crimeName = "Mug";
    if (ns.args.length > 0) {
        crimeName = ns.args[0];
    }
    for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
        ns.sleeve.setToCommitCrime(i, crimeName);   
    }
}
