export async function main(ns) {
    await deleteSmallestServer(ns);
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
