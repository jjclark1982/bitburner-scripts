import {connectToHost} from "/net/tunnel.js";
import {crack, playerPortLevel} from "lib.ns";

const factionHosts = ['CSEC', 'avmnite-02h', 'I.I.I.I', 'run4theh111z', 'fulcrumassets'];

export async function installBackdoors(ns) {
    ns.disableLog("sleep");
    ns.disableLog("scan");
    for (const host of factionHosts) {
        ns.print(`Checking ${host}...`);
        const server = ns.getServer(host);
        if (server.backdoorInstalled) {
            ns.print(`${host} already has backdoor installed`);
            continue;
        }
        ns.print(`Need ${server.numOpenPortsRequired} open ports for ${host}`);
        while (server.numOpenPortsRequired > playerPortLevel(ns)) {
            await ns.sleep(60*1000);
        }
        crack(ns, host);
        ns.print(`Need ${server.requiredHackingSkill} hacking skill for ${host}`);
        while (server.requiredHackingSkill > ns.getPlayer().hacking) {
            await ns.sleep(60*1000);
        }
        const prevHost = ns.getHostname();
        connectToHost(ns, host, true);
        await ns.installBackdoor();
        ns.tprint(`Installed backdoor on ${host}`);
        //const backdoorPromise = new Promise(async (resolve, reject)=>{
        //    await ns.installBackdoor();
        //    resolve();
        //});
        connectToHost(ns, prevHost, true);
        //await backdoorPromise;
    }
}

export async function main(ns) {
    await installBackdoors(ns);
    ns.tprint("Backdoored all faction servers.");
}
