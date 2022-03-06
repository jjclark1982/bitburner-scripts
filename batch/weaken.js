/** @param {NS} ns **/
export async function main(ns) {
    const target = ns.args[0];
    await ns.weaken(target);
    //ns.tprint("Finished weaken "+JSON.stringify(ns.args));
}

export function autocomplete(data, args) {
    return data.servers;
}
