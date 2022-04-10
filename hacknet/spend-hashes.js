const UPGRADES = [
    "Sell for Money",
    "Sell for Corporation Funds",
    "Reduce Minimum Security",
    "Increase Maximum Money",
    "Improve Studying",
    "Improve Gym Training",
    "Exchange for Corporation Research",
    "Exchange for Bladeburner Rank",
    "Exchange for Bladeburner SP",
    "Bladeburner",
    "Generate Coding Contract",
];

const FLAGS = [
    ["help", false],
    ["target"],
    ["verbose", true],
    ["ongoing", false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    if (args[args.length-2] == "--target") {
        return data.servers;
    }
    const escapedUpgrades = UPGRADES.map((s)=>`"${s}"`);
    return escapedUpgrades;
}

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("sleep");

    let flags = ns.flags(FLAGS);
    if (flags._.length == 0) {
        flags._.push("Sell for Money");
    }
    if (flags.verbose && !flags.ongoing) {
        ns.print = ns.tprint;
    }
    const upgrades = flags._;

    if (flags.help) {
        ns.tprint([
            "Spend hashes on a named upgrade",
            "",
            "Example: Sell all hashes for bladeburner rank and money, then terminate",
            `run ${ns.getScriptName()} "Bladeburner" "Sell for Money"`,
            "",
            "Example: Continually spend all hashes on increasing server money",
            `run ${ns.getScriptName()} --ongoing --tail --target the-hub "Increase Maximum Money"`,
            " "
        ].join("\n"));
        return;
    }

    buyUpgrades(ns, upgrades, flags.target);
    while (flags.ongoing) {
        await ns.sleep(60*1000);
        buyUpgrades(ns, upgrades, flags.target);
    }
}

export function buyUpgrades(ns, upgrades, target) {
    const startingHashes = ns.hacknet.numHashes();
    for (const upgrade of upgrades) {
        if (upgrade == "Sell for Money") {
            continue;
        }
        else if (upgrade.match(/Corporation/) && !ns.getPlayer().hasCorporation) {
            continue;
        }
        else if (upgrade == "Bladeburner") {
            buyBladeburnerUpgrades(ns);
        }
        else {
            buyMaxUpgrades(ns, upgrade, target);
        }
    }
    if (upgrades.includes("Sell for Money")) {
        sellHashesForMoney(ns);
    }
    if (upgrades.length > 1) {
        ns.print(`Spent ${startingHashes - ns.hacknet.numHashes()} hashes on upgrades.`);
    }
}

export function buyMaxUpgrades(ns, upgrade, target) {
    while (ns.hacknet.numHashes() >= ns.hacknet.hashCost(upgrade)) {
        const cost = ns.hacknet.hashCost(upgrade);
        const success = ns.hacknet.spendHashes(upgrade, target);
        if (success) {
            ns.print(`Spent ${cost} hashes on ${upgrade}.`)
        }
    }
}

export function buyBladeburnerUpgrades(ns) {
    const rankUG = "Exchange for Bladeburner Rank";
    const spUG = "Exchange for Bladeburner SP";
    let rankCost = ns.hacknet.hashCost(rankUG);
    let spCost = ns.hacknet.hashCost(spUG);
    let numHashes = ns.hacknet.numHashes();
    let upgrade;
    while (numHashes >= spCost) {
        if (rankCost < 3 * spCost) {
            upgrade = rankUG;
        }
        else {
            upgrade = spUG;
        }
        const cost = ns.hacknet.hashCost(upgrade);
        const success = ns.hacknet.spendHashes(upgrade);
        if (success) {
            ns.print(`Spent ${cost} hashes on ${upgrade}.`)
        }
        else {
            break;
        }
        rankCost = ns.hacknet.hashCost(rankUG);
        spCost = ns.hacknet.hashCost(spUG);
        numHashes = ns.hacknet.numHashes();
    }
}

export function sellHashesForMoney(ns, reservedHashes=0) {
    let moneyCost = 0;
    const cost = ns.hacknet.hashCost("Sell for Money");
    while (ns.hacknet.numHashes() >= cost + reservedHashes) {
        ns.hacknet.spendHashes("Sell for Money");
        moneyCost += cost;
    }
    if (moneyCost > 0) {
        ns.print(`Spent ${moneyCost} hashes for money.`)
    }
}
