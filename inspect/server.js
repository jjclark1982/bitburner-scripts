const FLAGS = [
    ['refreshrate', 200],
    ['help', false],
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return data.servers;
}

/** @param {NS} ns **/
export async function main(ns) {
    const flags = ns.flags(FLAGS);
    if (flags._.length === 0 || flags.help) {
        ns.tprint("This script helps visualize the money and security of a server.");
        ns.tprint(`USAGE: run ${ns.getScriptName()} SERVER_NAME`);
        ns.tprint("Example:");
        ns.tprint(`> run ${ns.getScriptName()} n00dles`)
        return;
    }
    const host = flags._.shift();

    ns.tail();
    ns.disableLog('ALL');
    while (true) {
        ns.clearLog();

        const server = ns.getServer(host);

        const money = server.moneyAvailable;
        const maxMoney = server.moneyMax;
        const minSec = server.minDifficulty;
        const sec = server.hackDifficulty;

        ns.print("server = " + JSON.stringify(server, null, 2), "\n\n\n\n\n\n\n\n\n\n\n");
    
        ns.print(`${host}:`);
        if (server.organizationName) {
            ns.print(` Organization: ${server.organizationName}`);
        }
        const stockInfo = getStockInfo(ns, server);
        if (stockInfo) {
            ns.print(` ${stockInfo.symbol} stock: ${ns.nFormat(stockInfo.netShares || 0, "0.[0]a")} shares held (${ns.nFormat(stockInfo.netValue || 0, "$0.[0]a")})`);
        }
        ns.print(`\n Required Hacking Skill: ${server.requiredHackingSkill} ${ns.getPlayer().hacking >= server.requiredHackingSkill ? '✓' : '✗'}`);
        ns.print(` Ports Open: ${server.openPortCount} / ${server.numOpenPortsRequired} ${server.hasAdminRights ? '(admin ✓)' : ''} ${server.backdoorInstalled ? '(backdoor ✓)' : ''}`);
        ns.print(` RAM: ${ns.nFormat(server.ramUsed * 1e9, "0.[0] b")} / ${ns.nFormat(server.maxRam * 1e9, "0.[0] b")}\n`)
        // ns.print(` Admin Access: ${server.hasAdminRights ? '✓' : '✗'}, Backdoor: ${server.backdoorInstalled ? '✓' : '✗'}`);
        ns.print(` money:    ${ns.nFormat(money, "$0.[000]a")} / ${ns.nFormat(maxMoney, "$0.[000]a")} (${((money / maxMoney * 100) || 0).toFixed(2)}%)`);
        const secString = (sec == 0) ? '0' : `${ns.nFormat(minSec, "0.[00]")} + ${(sec - minSec).toFixed(2)}`;
        ns.print(` security: ${secString}`);
        if (!server.purchasedByPlayer) {
            ns.print(` hack:     ${ns.tFormat(ns.getHackTime(host))} (t=${Math.ceil(ns.hackAnalyzeThreads(host, money))})`);
            ns.print(` grow:     ${ns.tFormat(ns.getGrowTime(host))} (t=${Math.ceil(ns.growthAnalyze(host, Math.max(1, maxMoney) / Math.max(1,money))) || 0})`);
            ns.print(` weaken:   ${ns.tFormat(ns.getWeakenTime(host))} (t=${Math.ceil((sec - minSec) * 20)})`);
        }
        
        await ns.sleep(flags.refreshrate);
    }
}

function getStockInfo(ns, server={}, portNum=5) {
    if (!server.organizationName) {
        return null;
    }
    const port = ns.getPortHandle(portNum);
    if (port.empty()) {
        return null;
    }
    const stockService = port.peek();
    const stockInfo = stockService.getStockInfo(server.organizationName);
    return stockInfo;
}
