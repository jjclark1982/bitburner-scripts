// crack-all-servers.js

export async function main(ns) {
    ns.disableLog("sleep");
    ns.disableLog("scan");
    ns.disableLog("getServerNumPortsRequired");
    ns.clearLog();
    await openAllServers(ns);
}

export async function openAllServers(ns) {
    // Repeatedly try to open all reachable servers
    let closedServers = getClosedServers(ns);
    while (closedServers.length > 0) {
        for (const server of closedServers) {
            const result = openServer(ns, server);
            if (result == false) {
                // Reached the end of servers openable with current programs
                ns.print("Waiting for more programs...");
                await ns.sleep(30*1000);
                break;
            }
        }
        closedServers = getClosedServers(ns);
    }
    ns.tprint("Admin rights available on all servers.");
}

export function openServer(ns, server) {
    // Attempt to enable admin rights on a server.
    // Returns true for success and false for failure (not enough programs).
    if (server.hasAdminRights || server.purchasedByPlayer) {
        return true;
    }
    const portOpeners = {
        'BruteSSH.exe': ns.brutessh,
        'FTPCrack.exe': ns.ftpcrack,
        'relaySMTP.exe': ns.relaysmtp,
        'HTTPWorm.exe': ns.httpworm,
        'SQLInject.exe': ns.sqlinject
    };
    let numOpenPorts = 0;
    for (const [file, program] of Object.entries(portOpeners)) {
        if (ns.fileExists(file, 'home')) {
            program(server.hostname);
            numOpenPorts += 1;
        }
    }
    if (numOpenPorts >= server.numOpenPortsRequired) {
        ns.nuke(server.hostname);
        ns.print(`Admin rights granted on ${server.hostname}.`);
        return true;
    }
    return false;
}

function getClosedServers(ns) {
    // Returns an array of server objects with hasAdminRights = false
    // sorted by numOpenPortsRequired (ascending)
    const closedServers = getAllHosts(ns).map(function(host){
        return {
            hostname: host,
            hasAdminRights: ns.hasRootAccess(host),
            numOpenPortsRequired: ns.getServerNumPortsRequired(host)
        };
    }).filter(function(server){
        return !server.hasAdminRights;
    }).sort(function(a,b){
        return a.numOpenPortsRequired - b.numOpenPortsRequired;
    });
    return closedServers;
}

export function getAllHosts(ns) {
    // Return an array of all hostnames.
    getAllHosts.cache ||= {};
    const scanned = getAllHosts.cache;
    const toScan = ['home'];
    while (toScan.length > 0) {
        const host = toScan.shift();
        scanned[host] = true;
        for (const nextHost of ns.scan(host)) {
            if (!(nextHost in scanned)) {
                toScan.push(nextHost);
            }
        }
    }
    const allHosts = Object.keys(scanned);
    return allHosts;
}
