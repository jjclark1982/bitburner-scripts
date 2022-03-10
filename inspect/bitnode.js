export async function main(ns) {
    ns.clearLog();
    ns.tail();

    ns.print(JSON.stringify(ns.getBitNodeMultipliers(), null, 2));
    ns.print(JSON.stringify(ns.formulas.hacknetServers.constants(), null, 2));
}
