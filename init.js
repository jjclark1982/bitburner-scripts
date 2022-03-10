import {prepareStats} from "lib.ns";

// init.js
// main script to run when starting game.


/*

if home server ram is sufficient:

sell a small amount of corp shares, if possible

manage coding contracts
manage hacknet servers (default to 1-hour payback time)
manage sleeves
manage bladeburner
manage stock market

crack all servers (can terminate)
create or buy all programs (can terminate)

backdoor faction servers (can terminate)
join factions

farm servers

*/

export async function main(ns) {
    await ns.sleep( 0*1000); ns.run("/progress/contracts.ns");
    await ns.sleep( 0*1000); ns.run("/hacknet/servers.js");
    await ns.sleep( 0*1000); ns.run("/sleeves/init.js");
    await ns.sleep( 0*1000); ns.run("/corporation/init.js");
    await prepareStats(ns, {
        "hacking": 10
    });
    await ns.sleep( 0*1000); ns.run("/net/crack-servers.js");
    await prepareStats(ns, {
        "strength": 5,
        "defense": 5,
        "dexterity": 10,
        "agility": 10
    });
    await ns.sleep( 0*1000); ns.run("/progress/crime.js");
    await ns.sleep( 1*1000); ns.run("/progress/programs.ns");
    await ns.sleep( 1*1000); ns.run("/net/backdoor-servers.js");
    await ns.sleep( 1*1000); ns.run("/progress/factions.ns");
    await ns.sleep( 1*1000); ns.run("/bladeburner/progress.ns");
    await ns.sleep( 1*1000); ns.run("/stocks/init.ns");

    await ns.sleep( 5*1000); ns.run("/batch/manage.js");
}

