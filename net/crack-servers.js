// crack-all-servers.ns

import {getAllHosts, playerPortLevel, crack, mostProfitableTarget} from "lib.ns";

export async function main(ns) {
    ns.disableLog("sleep");
    await crackAllServers(ns);
}

export async function crackAllServers(ns) {
    let serversToCrack = getAllHosts(ns).map(function(host){
        return {
            hostname: host,
            ports: ns.getServerNumPortsRequired(host),
            level: ns.getServerRequiredHackingLevel(host),
            maxMoney: ns.getServerMaxMoney(host)
        };
    }).sort(function(a,b){
        return a.level - b.level;
    });
    while (serversToCrack.length > 0) {
        let skippedServers = [];
        const playerPorts = playerPortLevel(ns);
        const playerLevel = ns.getHackingLevel();
        for (const server of serversToCrack) {
            const playerOwned = /^home$|^hacknet-node/;
            if (playerOwned.test(server.hostname)) {
                continue;
            }
            //ns.tprint("Initializing host " + server.hostname);
            if (server.ports > playerPortLevel(ns)) {
                skippedServers.push(server);
            }
            else {
                crack(ns, server.hostname);
                // let targets = [mostProfitableTarget(ns, getAllHosts(ns))];
                // if (server.maxMoney > 0 && server.level <= playerLevel) {
                //     targets = [server.hostname];
                // }
                // spawnFarms(ns, server.hostname, targets);
            }
            await ns.sleep(100);
        }
        serversToCrack = skippedServers;
        if (skippedServers.length > 0) {
            await ns.sleep(30*1000);
        }
    }
    ns.tprint("Cracked all servers.");
}