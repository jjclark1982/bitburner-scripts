import { StockTrader } from "stocks/trader.js"

export async function main(ns) {
    const trader = new StockTrader(ns);
    trader.sellStocks(trader.getAllStocks());
}
