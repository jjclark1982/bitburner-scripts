import { sellHashesForMoney } from "hacknet/spend-hashes.js";

export let MAX_BREAKEVEN_TIME = 1 * 60 * 60 * 1.000; // 1 hours in seconds
export let MAX_CACHE_TIME = 15 * 60 * 1.000; // 15 minutes in seconds

export async function main(ns) {
    ns.disableLog("asleep");
    ns.clearLog();
    if (ns.args.length > 0) {
        MAX_BREAKEVEN_TIME = 60 * 60 * ns.args[0];
    }
    if (ns.args.length > 1) {
        MAX_CACHE_TIME = 60 * 60 * ns.args[1];
    }
    else {
        MAX_CACHE_TIME = MAX_BREAKEVEN_TIME / 8;
    }
    const sellInterval = setInterval(function(){
        sellOverflowHashes(ns);
    }, MAX_CACHE_TIME * 1000 * 0.09);
    ns.atExit(()=>clearInterval(sellInterval));
    sellOverflowHashes(ns);
    await buyAllUpgrades(ns, MAX_BREAKEVEN_TIME);
    while (true) {
        await ns.asleep(60*60*1000);
    }
}

export function sellOverflowHashes(ns, hashFraction=0.9) {
    const reservedHashes = ns.hacknet.hashCapacity() * hashFraction;
    sellHashesForMoney(ns, reservedHashes);
}

export async function waitForMoney(ns, moneyTarget, moneyFraction=0.9) {
    let moneyAvailable = moneyFraction * ns.getPlayer().money;
    if (moneyAvailable < moneyTarget) {
        ns.print(`Waiting for ${ns.nFormat(moneyTarget, "$0.0a")}`);
    }
    while (moneyAvailable < moneyTarget) {
        await ns.asleep(5*1000);
        moneyAvailable = moneyFraction * ns.getPlayer().money;
    }
}

export async function buyAllUpgrades(ns, maxBreakevenTime, moneyFraction=0.9) {
    //ns.print(`maxBreakevenTime = ${ns.tFormat(maxBreakevenTime * 1000)}.`);
    let upgrades = selectUpgrades(ns, maxBreakevenTime);
    while (upgrades.length > 0) {
        const selection = upgrades[0];
        ns.print(`Next upgrade: ${selection.type} for node ${selection.i}. Cost: ${ns.nFormat(selection.cost, "$0.0a")}. Breakeven time: ${ns.tFormat(selection.breakeven * 1000)}.`);
        await waitForMoney(ns, selection.cost, moneyFraction);
        buyUpgrade(ns, selection);
        await ns.asleep(30);
        upgrades = selectUpgrades(ns, maxBreakevenTime);
    }
    ns.print("Done upgrading Hacknet servers.");
    await upgradeCaches(ns, maxBreakevenTime, moneyFraction);
}

export async function upgradeCaches(ns, maxBreakevenTime, moneyFraction=0.9) {
    let cacheTime = ns.hacknet.hashCapacity() / totalHashGainRate(ns); // seconds
    while (cacheTime < MAX_CACHE_TIME) {
        ns.print(`Hash capacity: ${ns.hacknet.hashCapacity()} (${ns.tFormat(cacheTime * 1000)})`);
        const servers = [];
        for (let i = 0; i < ns.hacknet.numNodes(); i++) {
            const server = ns.hacknet.getNodeStats(i);
            server.i = i;
            server.cost = ns.hacknet.getCacheUpgradeCost(i, 1);
            servers.push(server);
        }
        const toUpgrade = servers.sort((a,b)=>{
            return a.cost - b.cost;
        });
        if (toUpgrade.length > 0) {
            const server = toUpgrade[0];
            await waitForMoney(ns, server.cost, moneyFraction); 
            ns.hacknet.upgradeCache(server.i, 1);
        }
        await ns.asleep(30);
        cacheTime = ns.hacknet.hashCapacity() / totalHashGainRate(ns); // seconds
    }
    ns.print("Done upgrading Hacknet cache.");
}

export function buyUpgrade(ns, selection, moneyFraction=0.9) {
    switch (selection.type) {
        case "server":
            return ns.hacknet.purchaseNode();
        case "level":
            return ns.hacknet.upgradeLevel(selection.i, 1);
        case "ram":
            return ns.hacknet.upgradeRam(selection.i, 1);
        case "cores":
            return ns.hacknet.upgradeCore(selection.i, 1);
    }
    return false;
}

export function getBreakevenTime(selection) {
    const hashRate = selection.diff;
    const moneyRate = hashRate * 1000000 / 4; // per second
    const breakevenTime = selection.cost / moneyRate; // seconds
    return breakevenTime;
}

export function totalHashGainRate(ns) {
    let totalRate = 0;
    for (let i = 0; i < ns.hacknet.numNodes(); i++) {
        const server = ns.hacknet.getNodeStats(i);
        const currentRate = ns.formulas.hacknetServers.hashGainRate(server.level, 0, server.ram, server.cores, ns.getPlayer().hacknet_node_money_mult);
        totalRate += currentRate;
    }
    return totalRate;
}

export function selectUpgrades(ns, maxBreakevenTime) {
    const upgrades = getPossibleUpgrades(ns);
    const bestValues = upgrades.map((selection)=>{
        selection.value = selection.diff / selection.cost;
        selection.breakeven = getBreakevenTime(selection);
        //ns.print(`${selection.type} for node ${selection.i}: Payback time: ${ns.tFormat(selection.breakeven * 1000)}`);
        return selection;
    }).filter((selection)=>{
        return selection.breakeven < maxBreakevenTime;
    }).sort((a,b)=>{
        return a.breakeven - b.breakeven;
    });
    return bestValues;
}

export function getPossibleUpgrades(ns) {
    const player = ns.getPlayer();
    const upgrades = [];
    const newServerCost = ns.formulas.hacknetServers.hacknetServerCost(ns.hacknet.numNodes()+1, player.hacknet_node_purchase_cost_mult);
    if (ns.hacknet.numNodes() === 0) {
        return [{i: 0, type: "server", cost: newServerCost, diff: ns.formulas.hacknetServers.hashGainRate(1, 0, 1, 1, player.hacknet_node_money_mult)}];
    }
    let worstRate = Infinity;
    for (let i = 0; i < ns.hacknet.numNodes(); i++) {
        const server = ns.hacknet.getNodeStats(i);
        const currentRate = ns.formulas.hacknetServers.hashGainRate(server.level, 0, server.ram, server.cores, player.hacknet_node_money_mult);
        if (currentRate < worstRate) {
            worstRate = currentRate;
        }
        const levelRate = ns.formulas.hacknetServers.hashGainRate(server.level+1, 0, server.ram, server.cores, player.hacknet_node_money_mult);
        const levelCost = ns.formulas.hacknetServers.levelUpgradeCost(server.level, 1, player.hacknet_node_level_cost_mult);
        upgrades.push({i: i, type: "level", cost: levelCost, diff: levelRate-currentRate});
        const ramRate = ns.formulas.hacknetServers.hashGainRate(server.level, 0, server.ram*2, server.cores, player.hacknet_node_money_mult);
        const ramCost = ns.formulas.hacknetServers.ramUpgradeCost(server.ram, 1, player.hacknet_node_ram_cost_mult);
        upgrades.push({i: i, type: "ram", cost: ramCost, diff: ramRate-currentRate});
        const coresRate = ns.formulas.hacknetServers.hashGainRate(server.level, 0, server.ram, server.cores+1, player.hacknet_node_money_mult);
        const coresCost = ns.formulas.hacknetServers.coreUpgradeCost(server.cores, 1, player.hacknet_node_core_cost_mult);
        upgrades.push({i: i, type: "cores", cost: coresCost, diff: coresRate-currentRate});
    }
    if (ns.hacknet.numNodes() < ns.hacknet.maxNumNodes()) {
        upgrades.push({i: ns.hacknet.numNodes(), type: "server", diff: worstRate, cost: newServerCost}); // ignore upgrade costs
    }
    return upgrades;
}
