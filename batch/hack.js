/** @param {NS} ns **/
export async function main(ns) {
    const target = ns.args[0];
    await ns.hack(target);
}

export function autocomplete(data, args) {
    return data.servers;
}