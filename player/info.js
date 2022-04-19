import { getService } from "/lib/port-service";

/** @param {NS} ns **/
export async function main(ns) {
    let player = ns.getPlayer();
    player.karma = ns.heart.break();

    player.stocksValue = getService(ns, 5)?.getPortfolioValue() || 0;

    const factions = player.factions;
    player.factions = {};
    for (const f of factions) {
        player.factions[f] = `${ns.getFactionFavor(f)} favor, ${parseInt(ns.getFactionRep(f))} rep`;
    }

    ns.clearLog();
    ns.tail();
    ns.print("player = ", JSON.stringify(player, null, 2), "\n\n\n\n\n");

    const dashboard = [
        `Player`,
        `------`,
        // `  HP:              ${player.hp} / ${player.max_hp}`,
    ];
    if (player.stocksValue) {
        dashboard.push(
            `  Net Worth:       ${ns.nFormat(player.money + player.stocksValue, '$0.0a')}`,
            `  Stocks:          ${ns.nFormat(player.stocksValue, '$0.0a')}`,    
        );
    }
    dashboard.push(
        `  Cash:            ${ns.nFormat(player.money, '$0.0a')}`,
        // `  Hacking Skill:   ${player.hacking}`,
        // `  Intelligence:    ${player.intelligence}`,
        // `  Strength:        ${player.strength}`,
        `  City:            ${player.city}`,
        `  Kills:           ${player.numPeopleKilled}`,
        `  Karma:           ${player.karma}`,
        `  Jobs:            ${Object.keys(player.jobs).length}`,
        `  Factions:        ${Object.keys(player.factions).length}`,
        `  In Bladeburner:  ${player.inBladeburner}`,
        `  Has Corporation: ${player.hasCorporation}`,
        `  In Gang:         ${ns.gang.inGang()}`,
        `  Time Since Aug:  ${ns.tFormat(player.playtimeSinceLastAug)}`,
        ``
    );
    ns.print(dashboard.join("\n"));
}
