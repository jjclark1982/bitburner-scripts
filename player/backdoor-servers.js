import { connectToHost } from "/player/tunnel.js";

export async function main(ns) {
    await installBackdoors(ns);
}

const factionHosts = ['CSEC', 'avmnite-02h', 'I.I.I.I', 'run4theh111z', 'powerhouse-fitness', 'fulcrumassets'];

function getServersToBackdoor(ns) {
    return factionHosts.map(ns.getServer).filter((server)=>!server.backdoorInstalled);
}

export async function installBackdoors(ns) {
    ns.disableLog("sleep");
    let toBackdoor = getServersToBackdoor(ns);
    while (toBackdoor.length > 0) {
        const skipped = [];
        for (const server of toBackdoor) {
            await installBackdoorOnServer(ns, server);
        }
        toBackdoor = getServersToBackdoor(ns);
        if (toBackdoor.length > 0) {
            await ns.sleep(60*1000);
        }
    }
    ns.tprint("INFO: Installed backdoors on all faction servers.");
}

export async function installBackdoorOnServer(ns, server) {
    ns.print(`Checking ${server.hostname}...`);
    if (server.backdoorInstalled) {
        ns.print(`${server.hostname} already has backdoor installed`);
        return true;
    }
    if (!server.hasAdminRights) {
        ns.print(`Need admin rights for ${server.hostname}`);
        return false;
    }
    if (server.requiredHackingSkill > ns.getPlayer().hacking) {
        ns.print(`Need ${server.requiredHackingSkill} hacking skill for ${server.hostname}`);
        return false;
    }
    const prevHost = ns.getHostname();
    connectToHost(ns, server.hostname);
    await ns.installBackdoor();
    ns.tprint(`Installed backdoor on ${server.hostname}.`);
    connectToHost(ns, prevHost);
    return true;
}
