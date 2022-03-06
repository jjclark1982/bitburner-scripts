/** @param {NS} ns **/
export async function main(ns) {
    const target = ns.args[0];
    await ns.hack(target);
    //ns.tprint("  Finished hack   "+JSON.stringify(ns.args));
}

export function autocomplete(data, args) {
    return data.servers;
}
