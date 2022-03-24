import {StockSymbols} from "stocks/companies.js";
import { AugmentationNames } from "augmentations/info.js";

const FLAGS = [
    ["help", false],
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return ["player", "bitnode", "gang", "augmentations", ...AugmentationNames, ...data.servers];
}

/** @param {NS} ns **/
export async function main(ns) {
    const args = ns.flags(FLAGS);
    if (args.help) {
        ns.print("Show info about a game object.");
        ns.print(`Usage: run ${ns.getScriptName()} target [--host host]`);
        ns.print("Example:");
        ns.print(`> run ${ns.getScriptName()} player`);
        return;
    }

    if (AugmentationNames.includes(args._.join(' '))) {
        ns.run("/augmentations/info.js", 1, ...args._);
        return;
    }
    const arg = args._[0];
    if (arg == "player") {
        ns.run("/player/info.js", 1, ...args._.slice(1));
    }
    else if (arg == "bitnode") {
        ns.run("/inspect/bitnode.js", 1, ...args._.slice(1));
    }
    else if (arg == "augmentations") {
        ns.run("/augmentations/info.js", 1, ...args._.slice(1));
    }
    else if (arg == "gang") {
        ns.run("/gang/info.js", 1, ...args._.slice(1));
    }
    else if (ns.serverExists(arg)) {
        ns.run("/inspect/server.js", 1, ...args._.slice(1));
    }
}
