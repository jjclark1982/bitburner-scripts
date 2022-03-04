import {StockSymbols} from "stocks/companies.js";

const FLAGS = [
    ["help", false],
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return ["player", "bitnode", ...data.servers];
}

/** @param {NS} ns **/
export async function main(ns) {
    const args = ns.flags(FLAGS);
    if (args.help) {
        ns.print("Show info about a game object.");
        ns.print(`Usage: run ${ns.getScriptName()} target [--host host]`);
        ns.print("Example:");
        ns.print(`> run ${ns.getScriptName()} n00dles --host pserv-1`);
        return;
    }

    for (const arg of args._) {
        if (arg == "player") {
            getPlayerInfo(ns);
        }
        else if (arg == "bitnode") {
            getBitnodeInfo(ns);
        }
        else if (ns.serverExists(arg)) {
            getServerInfo(ns, arg);
        }
    }

    ns.tail();
}

export function getPlayerInfo(ns) {
    let player = ns.getPlayer();
    player.karma = ns.heart.break();
    const factions = player.factions;
    player.factions = {};
    for (const f of factions) {
        player.factions[f] = `${ns.getFactionFavor(f)} favor, ${parseInt(ns.getFactionRep(f))} rep`;
    }
    player.augmentations = ns.getOwnedAugmentations(false);
    //player.augmentations = {};
    //for (const name of ns.getOwnedAugmentations(false)) {
    //     player.augmentations[name] = ns.getAugmentationStats(name);
    //}
    //player.sourceFiles = ns.getOwnedSourceFiles();
    ns.print("player = ", JSON.stringify(player, null, 2));
}

export function getBitnodeInfo(ns) {
    ns.print(JSON.stringify(ns.getBitNodeMultipliers(), null, 2));
    //ns.print(JSON.stringify(ns.formulas.hacknetServers.constants(), null, 2));
}

export function getServerInfo(ns, hostname) {
    const server = ns.getServer(hostname);
    if (server.organizationName) {
        server.stockSymbol = StockSymbols[server.organizationName];
    }
    ns.print(JSON.stringify(server, null, 2));
    ns.print(ns.getServerSecurityLevel(hostname));
}
