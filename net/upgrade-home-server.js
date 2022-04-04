export async function main(ns) {
    await upgradeHomeComputer(ns, ns.args[0]);
}

export async function upgradeHomeComputer(ns, moneyFraction=0.75) {
    while (ns.getPlayer().money * moneyFraction > ns.getUpgradeHomeRamCost()) {
        const cost = ns.nFormat(ns.getUpgradeHomeRamCost(), "$0.0 a");
        ns.upgradeHomeRam();
        ns.tprint(`Upgraded home computer RAM for ${cost}`);
        await ns.sleep(100);
    }
    while (ns.getPlayer().money * moneyFraction > ns.getUpgradeHomeCoresCost()) {
        const cost = ns.nFormat(ns.getUpgradeHomeCoresCost(), "$0.0 a");
        ns.upgradeHomeCores();
        ns.tprint(`Upgraded home computer cores for ${cost}`);
        await ns.sleep(100);
    }
}
