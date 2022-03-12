import {getAllStocks, sellStocks} from "stocks/naive-trader.js"

export async function main(ns) {
    const allStocks = getAllStocks(ns);
    sellStocks(ns, Object.values(allStocks));
}
