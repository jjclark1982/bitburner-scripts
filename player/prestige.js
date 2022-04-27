/*
Finished buying augmentations. Don't forget:
  - Buy augmentations for sleeves
  - Buy equipment for gang members
  - Upgrade home server
  - Spend hacknet hashes on Bladeburner rank and SP
  - Spend hacknet hashes on corporation research and funds
  - TODO: create a gang if possible
  - TODO: create a corp if possible
  - Buyback corporation shares
*/

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog('sleep');
    ns.clearLog();
    ns.tail();
    await ns.sleep( 0*1000); ns.run("/botnet/stop.js", 1, "--force");
    await ns.sleep( 0*1000); ns.run("/hacknet/spend-hashes.js", 1, "Bladeburner", "Exchange for Corporation Research", "Sell for Corporation Funds", "Sell for Money");
    await ns.sleep( 1*1000); ns.run("/sleeves/buy-augs.js");
    await ns.sleep( 1*1000); ns.run("/sleeves/train.js");
    await ns.sleep( 1*1000); ns.run("/gang/buy-augs.js");
    await ns.sleep( 1*1000); ns.run("/net/upgrade-home-server.js");
    await ns.sleep( 3*1000); ns.run("/corporation/buyback-shares.js");
    for (let i = 3; i >= 0; i--) {
        ns.print(`Installing augmentations in ${i}...`);
        await ns.sleep(1000);
    }
    ns.installAugmentations(ns.args[0] || "init.js");
}
