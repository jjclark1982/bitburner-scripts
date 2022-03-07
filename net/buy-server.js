export function buyServer(ns, fundsFraction=0.6, count=1) {
    const funds = fundsFraction * ns.getServerMoneyAvailable('home') / count;
    let costMult = 1;
    costMult = ns.getBitNodeMultipliers().PurchasedServerCost;
    const power = Math.floor(Math.log2(funds/(50000*costMult)));
    const size = Math.min(Math.pow(2, power), ns.getPurchasedServerMaxRam());

    ns.tprint(`Purchasing ${count}x servers with ${ns.nFormat(size*1e9, "0.0 b")} RAM`);

    let servers = ns.getPurchasedServers();

    let delCount = count + servers.length - 25;
    for (let i = 0; i < delCount; i++) {
        ns.killall(servers[i]);
    }
    for (let i = 0; i < delCount; i++) {
        ns.deleteServer(servers[i]);
    }

    let hostname = `pserv-${servers.length}`;
    hostname = ns.purchaseServer(hostname, size);
    if (hostname) {
        ns.tprint(`Purchased server ${hostname}`);
    }
    else {
        ns.tprint("Failed to purchase server");
    }
    return hostname;
}

export async function main(ns) {
    const fundsFraction = 0.6;
    const count = 1;
    buyServer(ns, fundsFraction, count);
}
