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
    await ns.sleep( 0*1000); ns.run("/contracts/find-and-solve.js");
    await ns.sleep( 0*1000); ns.run("/sleeves/init.js");
    await ns.sleep( 0*1000); ns.run("/corporation/init.js");
    // await ns.sleep( 0*1000); ns.run("/gang/manage.js");
    await ns.sleep( 1*1000); ns.run("/stanek/spawn.js");
    await ns.sleep( 1*1000); ns.run("/net/spawn-share.js");
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
    await ns.sleep( 0*1000); ns.run("/crime/commit.js");
    await ns.sleep( 1*1000); ns.run("/progress/programs.ns");
    await ns.sleep( 1*1000); ns.run("/net/backdoor-servers.js");
    await ns.sleep( 1*1000); ns.run("/progress/factions.ns");
    await ns.sleep( 1*1000); ns.run("/bladeburner/progress.ns");

    // await ns.sleep( 5*1000); ns.run("/net/buy-server.js");
    // await ns.sleep( 5*1000); ns.run("/batch/manage.js", 1, "phantasy", "--moneyPercent", "0.01");

    await ns.sleep( 5*1000); ns.run("/hacknet/servers.js"); //, 1, 4, 1);
    await ns.sleep( 5*1000); ns.run("/stocks/init.ns");

    // await ns.sleep(30*1000); ns.run("/batch/manage.js", 1, "--moneyPercent", "0.01");
}
