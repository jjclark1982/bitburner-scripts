/** @param {NS} ns **/
export async function main(ns) {
    let player = ns.getPlayer();
    player.karma = ns.heart.break();
    player.stocksValue = getPortfolioValue(ns);

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
        `  Net Worth:       ${ns.nFormat(player.money + player.stocksValue, '$0.0a')}`,
        `  Stocks:          ${ns.nFormat(player.stocksValue, '$0.0a')}`,
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
    ].join("\n");
    ns.print(dashboard);
}


export function getAllStocks(ns) {
    const allStocks = {};
    for (const symbol of ns.stock.getSymbols()) {
        const stock = {};
        const pos = ns.stock.getPosition(symbol);
        stock.shares = pos[0];
        stock.sharesAvgPrice = pos[1];
        stock.sharesShort = pos[2];
        stock.sharesAvgPriceShort = pos[3];
        stock.askPrice = ns.stock.getAskPrice(symbol);
        stock.bidPrice = ns.stock.getBidPrice(symbol);
        stock.price = (stock.askPrice + stock.bidPrice) / 2;
        allStocks[symbol] = stock;
    }
    return allStocks;
}

export function getPortfolioValue(ns) {
    const stocks = getAllStocks(ns);
    let value = 0;
    for (const stock of Object.values(stocks)) {
        value += stock.bidPrice * stock.shares - stock.askPrice * stock.sharesShort;
    }
    return value;
}

