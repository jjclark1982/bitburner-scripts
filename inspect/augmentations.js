/** @param {NS} ns **/
export async function main(ns) {
    const player = {};
    player.augmentations = ns.getOwnedAugmentations(false);
    //player.augmentations = {};
    //for (const name of ns.getOwnedAugmentations(false)) {
    //     player.augmentations[name] = ns.getAugmentationStats(name);
    //}
    player.sourceFiles = {};
    for (const sourceFile of ns.getOwnedSourceFiles().sort((a,b)=>a.n-b.n)) {
        player.sourceFiles[`SourceFile${sourceFile.n}`] = sourceFile.lvl;
    }
    ns.print(JSON.stringify(player, null, 2));
    ns.tail();
}