/** @param {NS} ns **/
export async function main(ns) {
    const target = ns.args[0];
    await ns.grow(target, {stock: true});
}

export function autocomplete(data, args) {
    return data.servers;
}