export async function main(ns) {
    await retireSmallestServer(ns);
}

export function retireServerIfNeeded(ns) {
    const servers = ns.getPurchasedServers().map((hostname)=>ns.getServer(hostname));
    if (servers.length >= ns.getPurchasedServerLimit()) {
        retireSmallestServer(ns);
    }    
}

export function retireSmallestServer(ns, servers) {
    servers ||= ns.getPurchasedServers().map((hostname)=>ns.getServer(hostname));
    const smallestServer = servers.sort((a,b)=>a.maxRam-b.maxRam)[0];
    ns.killall(smallestServer.hostname);
    // await ns.sleep(100);
    const success = ns.deleteServer(smallestServer.hostname);
    if (success) {
        ns.tprint(`Retired server ${smallestServer.hostname}`);
    }
    else {
        ns.tprint(`Failed to retire server ${smallestServer.hostname}`);
    }
}
