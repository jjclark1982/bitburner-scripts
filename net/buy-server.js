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
    while (size <= ns.getPurchasedServerMaxRam()) {
        size *= 2;
        cost = ns.getPurchasedServerCost(size);
        if (cost > funds) {
            break;
        }
    }
    return size / 2;
}

export function deleteServerIfNeeded(ns) {
    const servers = ns.getPurchasedServers().map((hostname)=>ns.getServer(hostname));
    if (servers.length >= ns.getPurchasedServerLimit()) {
        deleteSmallestServer(ns);
    }    
}

export function deleteSmallestServer(ns, servers) {
    servers ||= ns.getPurchasedServers().map((hostname)=>ns.getServer(hostname));
    const smallestServer = servers.sort((a,b)=>a.maxRam-b.maxRam)[0];
    ns.killall(smallestServer.hostname);
    // await ns.sleep(100);
    const success = ns.deleteServer(smallestServer.hostname);
    if (success) {
        ns.tprint(`Decomissioned server ${smallestServer.hostname}`);
    }
    else {
        ns.tprint(`Failed to delete server ${smallestServer.hostname}`);
    }
}
