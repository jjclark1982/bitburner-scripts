/*

/augmentations/buy.js

Automatically buy the best augmentations available now, most expensive first.

run /augmentations/buy.js [ hacking | combat | cha | faction | blade | hacknet | neuro | all ... ]

*/

import { buyAugs, FILTERS } from "augmentations/plan.js";

const FLAGS = [
    ["help", false],
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return Object.keys(FILTERS);
}

/** @param {NS} ns **/
export async function main(ns) {
    const args = ns.flags(FLAGS);
    const filters = args._;
    if (args.help || filters.length == 0) {
        ns.tprint([
            `Automatically buy augmentations.`,
            '',
            'Usage: ',
            `${ns.getScriptName()} [ ${Object.keys(FILTERS).join(' | ')} ... ] [ --buy ]`,
            '',
            `Example: Buy all augs that increase hacking, including NeuroFlux Governor repeatedly`,
            `> run ${ns.getScriptName()} hacking neuroflux`,
            ' '
        ].join("\n"));
        return;
    }
    for (const filter of filters) {
        if (!(filter in FILTERS)) {
            ns.tprint(`Unknown augmentation type: '${filter}'`);
            return;
        }
    }

    await buyAugs(ns, filters);
}
