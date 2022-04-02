/** @param {NS} ns **/
export async function main(ns) {
    if (ns.args.length < 2) {
        ns.tprint("No fragments to charge. Exiting.");
        return;
    }
    while (true) {
        for (let i = 0; i < ns.args.length; i += 2) {
            const x = ns.args[i];
            const y = ns.args[i+1];
            await ns.stanek.chargeFragment(x, y);
        }
    }
}
