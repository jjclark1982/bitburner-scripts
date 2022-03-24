const UPGRADES = [
    "Sell for Money",
    "Sell for Corporation Funds",
    "Reduce Minimum Security",
    "Increase Maximum Money",
    "Improve Studying",
    "Improve Gym Training",
    "Exchange for Corporation Research",
    "Bladeburner",
    "Generate Coding Contract",
];

const FLAGS = [
    ["target"],
    ["verbose", true]
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
    let flags = ns.flags(FLAGS);
    if (flags._.length == 0) {
        flags._.push("Sell for Money");
    }
    if (flags.verbose) {
        ns.print = ns.tprint;
    }

    const startingHashes = ns.hacknet.numHashes();

    const upgrades = flags._;
    for (const upgrade of upgrades) {
        if (upgrade == "Sell for Money") {
            continue;
        }
        else if (upgrade == "Bladeburner") {
            buyBladeburnerUpgrades(ns);
        }
        buyMaxUpgrades(ns, upgrade, flags.target);
    }
    if (upgrades.includes("Sell for Money")) {
        sellHashesForMoney(ns);
    }
    if (flags._.length > 1) {
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
    let rankCost = ns.hacknet.hashCost("Exchange for Bladeburner Rank");
    let spCost = ns.hacknet.hashCost("Exchange for Bladeburner SP");
    let numHashes = ns.hacknet.numHashes();
    while (numHashes >= spCost) {
        if (rankCost < 3 * spCost && numHashes >= rankCost) {
            const success = ns.hacknet.spendHashes(upgrade);
            if (success) {
                ns.print(`Spent ${rankCost} hashes on Bladeburner Rank.`)
            }
        }
        else {
            const success = ns.hacknet.spendHashes(upgrade);
            if (success) {
                ns.print(`Spent ${spCost} hashes on Bladeburner SP.`)
            }
        }
        rankCost = ns.hacknet.hashCost("Exchange for Bladeburner Rank");
        spCost = ns.hacknet.hashCost("Exchange for Bladeburner SP");
        numHashes = ns.hacknet.numHashes();
    }
}

export function sellHashesForMoney(ns) {
    let moneyCost = 0;
    const cost = ns.hacknet.hashCost("Sell for Money");
    while (ns.hacknet.numHashes() >= cost) {
        ns.hacknet.spendHashes("Sell for Money");
        moneyCost += cost;
    }
    if (moneyCost > 0) {
        ns.print(`Spent ${moneyCost} hashes for money.`)
    }

}
