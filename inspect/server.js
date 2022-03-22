import {StockSymbols} from "stocks/companies.js"

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
        if (server.organizationName) {
            server.stockSymbol = StockSymbols[server.organizationName];
        }

        const money = server.moneyAvailable;
        const maxMoney = server.moneyMax;
        const minSec = server.minDifficulty;
        const sec = server.hackDifficulty;

        ns.print("server = " + JSON.stringify(server, null, 2), "\n\n\n\n\n\n\n\n\n\n\n");
    
        ns.print(`${host}:`);
        if (server.organizationName) {
            let ticker = StockSymbols[server.organizationName];
            if (ticker) {
                ticker = ` (${ticker})`;
            }
            else {
                ticker = '';
            }
            ns.print(` Organization: ${server.organizationName}${ticker}`);
            server.stockSymbol = StockSymbols[server.organizationName];
        }
        ns.print(` Required Hacking Skill: ${server.requiredHackingSkill} ${ns.getPlayer().hacking >= server.requiredHackingSkill ? '✓' : '✗'}`);
        ns.print(` Ports Open: ${server.openPortCount} / ${server.numOpenPortsRequired} ${server.hasAdminRights ? '(admin ✓)' : ''} ${server.backdoorInstalled ? '(backdoor ✓)' : ''}\n`);
        // ns.print(` Admin Access: ${server.hasAdminRights ? '✓' : '✗'}, Backdoor: ${server.backdoorInstalled ? '✓' : '✗'}`);
        ns.print(` money:    ${ns.nFormat(money, "$0.000a")} / ${ns.nFormat(maxMoney, "$0.000a")} (${(money / maxMoney * 100).toFixed(2)}%)`);
        ns.print(` security: ${ns.nFormat(minSec, "0.[00]")} + ${(sec - minSec).toFixed(2)}`);
        if (!server.purchasedByPlayer) {
            ns.print(` hack:     ${ns.tFormat(ns.getHackTime(host))} (t=${Math.ceil(ns.hackAnalyzeThreads(host, money))})`);
            ns.print(` grow:     ${ns.tFormat(ns.getGrowTime(host))} (t=${Math.ceil(ns.growthAnalyze(host, maxMoney / Math.max(1,money)))})`);
            ns.print(` weaken:   ${ns.tFormat(ns.getWeakenTime(host))} (t=${Math.ceil((sec - minSec) * 20)})`);
        }
        
        await ns.sleep(flags.refreshrate);
    }
}
