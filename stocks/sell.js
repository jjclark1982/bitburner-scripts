import { StockTrader } from "/stocks/trader";

export async function main(ns) {
    const trader = new StockTrader(ns);
    trader.sellStocks(trader.getAllStocks());
}
