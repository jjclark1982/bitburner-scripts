export async function main(ns) {
    sellAllStocks(ns);
}

export function sellAllStocks(ns, short=false) {
    let netMoney = 0;
    for (const symbol of ns.stock.getSymbols()) {
        const [shares, avgPrice, sharesShort, avgPriceShort] = ns.stock.getPosition(symbol);
        const salePrice = ns.stock.sell(symbol, shares);
        netMoney += shares * salePrice;
        if (short) {
            const saleCost = ns.stock.sellShort(symbol, sharesShort);
            netMoney -= sharesShort * saleCost;
        }
    }
    ns.tprint(`INFO: Sold all stocks for ${ns.nFormat(netMoney, "$0.0a")}`);
}
