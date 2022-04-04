import { deleteServerIfNeeded } from "net/delete-server.js";

export async function main(ns) {
    const fundsFraction = ns.args[0] || 0.8;
    buyServer(ns, fundsFraction);
}

export function buyServer(ns, fundsFraction=0.8) {
    const funds = fundsFraction * ns.getServerMoneyAvailable('home');

    // let costMult = 1;
    // costMult = ns.getBitNodeMultipliers().PurchasedServerCost;
    // const power = Math.floor(Math.log2(funds/(50000*costMult)));
    // const size = Math.min(ns.getPurchasedServerMaxRam(), Math.pow(2, power));

    const size = largestServerSize(ns, funds);
    const cost = ns.getPurchasedServerCost(size);

    let servers = ns.getPurchasedServers();

    deleteServerIfNeeded(ns);

    let hostname = `pserv-${servers.length}`;
    hostname = ns.purchaseServer(hostname, size);
    if (hostname) {
        ns.tprint(`Purchased server '${hostname}' with ${ns.nFormat(size*1e9, "0.0 b")} RAM for ${ns.nFormat(cost, "$0,0a")}`);
    }
    else {
        ns.tprint("Failed to purchase server");
    }
    return hostname;
}

export function largestServerSize(ns, funds) {
    let size = 1;
    let cost;
    while (size < ns.getPurchasedServerMaxRam()) {
        size *= 2;
        cost = ns.getPurchasedServerCost(size);
        if (cost > funds) {
            break;
        }
    }
    return size / 2;
}
