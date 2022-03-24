"Finished buying augmentations. Don't forget:",
"  - Buy augmentations for sleeves",
"  - Buy equipment for gang members",
"  - Upgrade home server",
"  - Spend hacknet hashes on Bladeburner rank and SP",
"  - Spend hacknet hashes on corporation research and funds",
"  - Buyback corporation shares"


/** @param {NS} ns **/
export async function main(ns) {
    await ns.sleep( 0*1000); ns.run("/hacknet/spend-hashes.js", 1, "Exchange for Bladeburner Rank", "Exchange for Corporation Research", "Exchange for Bladeburner SP", "Sell for Corporation Funds", "Sell for Money");
    await ns.sleep( 1*1000); ns.run("/sleeves/buy-augs.js");
    await ns.sleep( 1*1000); ns.run("/sleeves/train.js");
    await ns.sleep( 1*1000); ns.run("/gang/buy-augs.js");
    await upgradeHomeComputer(ns);
    await ns.sleep( 1*1000); ns.run("/corporation/buyback-shares.js");
    await ns.sleep( 3*1000); ns.installAugmentations(ns.args[0] || "init.js");
}

export async function upgradeHomeComputer(ns) {
    while (ns.getPlayer().money > ns.getUpgradeHomeRamCost()) {
        ns.upgradeHomeRam();
        ns.tprint("Upgraded home computer RAM.")
        await ns.sleep(100);
    }
    while (ns.getPlayer().money > ns.getUpgradeHomeCoresCost()) {
        ns.upgradeHomeCores();
        ns.tprint("Upgraded home computer cores.")
        await ns.sleep(100);
    }
}
