/** @param {NS} ns **/
export async function main(ns) {
    const target = ns.args[0];
    await ns.grow(target, {stock: true});
    //ns.tprint("  Finished grow   "+JSON.stringify(ns.args));
}

export function autocomplete(data, args) {
    return data.servers;
}
