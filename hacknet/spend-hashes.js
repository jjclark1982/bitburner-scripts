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
    const print = (flags.verbose ? ns.tprint : ns.print)

    const startingHashes = ns.hacknet.numHashes();

    const upgrades = flags._;
    for (const upgrade of upgrades) {
        if (upgrade == "Sell for Money") {
            continue;
        }
        while (ns.hacknet.numHashes() >= ns.hacknet.hashCost(upgrade)) {
            const cost = ns.hacknet.hashCost(upgrade);
            const success = ns.hacknet.spendHashes(upgrade, flags.target);
            if (success) {
                print(`Spent ${cost} hashes on ${upgrade}.`)
            }
        }
    }
    if (upgrades.includes("Sell for Money")) {
        let moneyCost = 0;
        const cost = ns.hacknet.hashCost("Sell for Money");
        while (ns.hacknet.numHashes() >= cost) {
            ns.hacknet.spendHashes("Sell for Money");
            moneyCost += cost;
        }
        if (moneyCost > 0) {
            print(`Spent ${moneyCost} hashes for money.`)
        }
    }
    if (flags._.length > 1) {
        print(`Spent ${startingHashes - ns.hacknet.numHashes()} hashes on upgrades.`);
    }
}
