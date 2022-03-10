import {getAllStocks, sellStocks} from "stocks/trader.ns"

export async function main(ns) {
    const allStocks = getAllStocks(ns);
    sellStocks(ns, Object.values(allStocks));
}
