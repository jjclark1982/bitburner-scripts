import { ALL_AUGMENTATIONS } from "augmentations/info.js";

const FLAGS = [
    ["help", false],
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return ["player", "bitnode", "gang", "augmentations", ...ALL_AUGMENTATIONS, ...data.servers];
}

/** @param {NS} ns **/
export async function main(ns) {
    const args = ns.flags(FLAGS);
    if (args.help) {
        ns.tprint([
            "Show info about a game object.",
            "",
            `Usage: run ${ns.getScriptName()} [object]`,
            "",
            "Example: see player info",
            `> run ${ns.getScriptName()} player`,
            "",
            "Example: see some server info",
            `> run ${ns.getScriptName()} CSEC`,
            "",
            "Example: see some augmentation info",
            `> run ${ns.getScriptName()} NeuroFlux Governor`,
            " "
        ].join("\n"))
        return;
    }

    if (ALL_AUGMENTATIONS.includes(args._.join(' '))) {
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
