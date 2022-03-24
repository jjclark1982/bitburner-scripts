/** @param {NS} ns **/
export async function main(ns) {
    const fragments = ns.stanek.activeFragments();
    ns.print("[");
    for (const fragment of fragments) {
        ns.print('  ', JSON.stringify(fragment), ',');
    }
    ns.print("]");
    ns.tail();
}
