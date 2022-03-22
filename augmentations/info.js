/** @param {NS} ns **/
export async function main(ns) {
    ns.clearLog();
    ns.tail();

    if (ns.args.length > 0) {
        for (const aug of ns.args) {
            const stats = ns.getAugmentationStats(aug);
            ns.print(aug, ": ", JSON.stringify(stats, null, 2), "\n");
            return
        }
    }

    const sourceFiles = {};
    for (const sourceFile of ns.getOwnedSourceFiles().sort((a,b)=>a.n-b.n)) {
        sourceFiles[`SourceFile${sourceFile.n}`] = sourceFile.lvl;
    }
    ns.print("Source Files: ", JSON.stringify(sourceFiles, null, 2), "\n");

    const installedAugs = ns.getOwnedAugmentations(false);
    ns.print("Installed Augmentations: ", JSON.stringify(installedAugs, null, 2), "\n");

    const purchasedAugs = ns.getOwnedAugmentations(true).filter(function(aug){
        return !installedAugs.includes(aug);
    });
    ns.print("Purchased Augmentations: ", JSON.stringify(purchasedAugs, null, 2), "\n");
}
