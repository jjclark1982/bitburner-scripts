import { drawTable } from "/lib/box-drawing";
import { PortService } from "/lib/port-service";
import { StockSymbols as CompanyStockSymbols } from "/stocks/companies";

export async function main(ns) {
    ns.disableLog("asleep");
    ns.disableLog("stock.buy");
    ns.disableLog("stock.sell");

    const stockInfo = new StockTrader(ns);
    const service = new PortService(ns, 5, stockInfo);
    await service.serve(stockInfo);
}

export class StockTrader {
    constructor(ns) {
        this.ns = ns;
        this.lastUpdateTime = 1;
        this.priceHistory = {};
        for (const symbol of ns.stock.getSymbols()) {
            this.priceHistory[symbol] = [];
        }
    }

    getStockInfo(symbol) {
        const {ns} = this;
        // look up organization name
        if (symbol in CompanyStockSymbols) {
            symbol = CompanyStockSymbols[symbol];
        }
        if (!ns.stock.getSymbols().includes(symbol)) {
            return null;
        }
        const pos = ns.stock.getPosition(symbol);
        const stock = {
            symbol: symbol,
            forecast: this.computeForecast(symbol),
            volatility: this.computeVolatility(symbol),
            askPrice: ns.stock.getAskPrice(symbol),
            bidPrice: ns.stock.getBidPrice(symbol),
            maxShares: ns.stock.getMaxShares(symbol),
            shares: pos[0],
            sharesAvgPrice: pos[1],
            sharesShort: pos[2],
            sharesAvgPriceShort: pos[3],
        };
        stock.price = (stock.askPrice + stock.bidPrice) / 2;
        stock.netShares = stock.shares - stock.sharesShort;
        stock.netValue = stock.bidPrice * stock.shares - stock.askPrice * stock.sharesShort;
        stock.summary = `${stock.symbol} (${(stock.forecast*100).toFixed(1)}% ± ${(stock.volatility*100).toFixed(1)}%)`;
        return stock;
    }
    
    [Symbol.iterator]() {
        return this.getAllStocks()[Symbol.iterator]();
    }

    getAllStocks() {
        const {ns} = this;
        return ns.stock.getSymbols().map((symbol)=>this.getStockInfo(symbol));
    }

    getPortfolioValue() {
        return [...this].reduce((total, stock)=>(
            total + stock.netValue
        ), 0);
    }

    /**
     * Select stocks with at least threshold % chance to increase each tick
     * @param {number} threshold 
     * @returns {Stock[]}
     */
    getBullStocks(threshold=0.55) {
        return [...this].filter((stock)=>(
            stock.forecast - stock.volatility > threshold
        ));
    }

    /**
     * Select stocks with at most threshold % chance to increase each tick
     * @param {number} threshold 
     * @returns {Stock[]}
     */
     getBearStocks(stocks, threshold=0.48) {
        return [...this].filter((stock)=>(
            stock.forecast - stock.volatility < threshold
        ));
    }

    computeForecast(symbol) {
        const {ns} = this;
        if (ns.getPlayer().has4SDataTixApi) {
            return this.ns.stock.getForecast(symbol);
        }
        const history = this.priceHistory[symbol];
        if (history.length < 2) {
            return 0.5;
        }
        let increases = 0;
        let decreases = 0;
        for (let i = 1; i < history.length; i++) {
            const change = (history[i] - history[i-1]) / history[i];
            if (change > 0) {
                increases += 1;
            }
            else {
                decreases += 1;
            }
        }
        const chanceToIncrease = increases / (increases + decreases);
        return chanceToIncrease;
        //const ratios = [];
        //for (let i = 1; i < history.length; i++) {
        //    const ratio = history[i] / history[i-1];
        //    ratios.push(ratio);
        //}
        //const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        //return avgRatio / 2;
    }

    computeVolatility(symbol) {
        const {ns} = this;
        if (ns.getPlayer().has4SDataTixApi) {
            return this.ns.stock.getVolatility(symbol);
        }
        const history = this.priceHistory[symbol];
        if (history.length < 2) {
            return 0;
        }
        const changes = [];
        for (let i = 1; i < history.length; i++) {
            const change = (history[i] - history[i-1]) / history[i];
            changes.push(Math.abs(change));
        }
        const maxChange = Math.max(...changes);
        return maxChange;
    }

    updatePriceHistory() {
        const {ns} = this;
        for (const symbol of ns.stock.getSymbols()) {
            const stock = this.getStockInfo(symbol);
            const price = (stock.askPrice + stock.bidPrice) / 2;

            this.priceHistory[symbol].push(price);
    
            // only track the last 16-32 events
            if (this.priceHistory[symbol].length > 32) {
                this.priceHistory[symbol] = this.priceHistory[symbol].slice(16);
            }
        }
    }

    update() {
        // Run at most once per minute.
        // TODO: match this to actual stock tick time. Does it have readable bonusTime like other mechanics?
        const now = performance.now();
        if (now < this.lastUpdateTime + 1*60*1000) {
            return;
        }
        this.lastUpdateTime = now;

        this.updatePriceHistory();
        this.tendStocks();
    }

    tendStocks(ns) {
        // select stocks with <51% chance to increase price
        const stocksToSell = this.getBearStocks(0.51);
        // sell all those stocks
        this.sellStocks(stocksToSell);
        
        // select stocks with >55% chance to increase price
        const stocksToBuy = this.getBullStocks(0.55);
        // buy the highest-rated stocks available
        this.buyStocks(stocksToBuy);
    }    

    /**
     * Sell all shares of the given stocks.
     * @param {Stock[]} stocksToSell - lowest rated stocks
     */
    sellStocks(stocksToSell) {
        const {ns} = this;
        for (const stock of stocksToSell) {
            if (stock.shares > 0) {
                const salePrice = ns.stock.sell(stock.symbol, stock.shares);
                if (salePrice != 0) {
                    const saleTotal = salePrice * stock.shares;
                    const saleCost = stock.sharesAvgPrice * stock.shares;
                    const saleProfit = saleTotal - saleCost;
                    stock.shares = 0;
                    //ns.print(`Sold ${ns.nFormat(saleTotal, "$0.0a")} of ${stock.summary}`);
                    ns.print(`Sold ${stock.summary} stock for ${ns.nFormat(saleProfit, "$0.0a")} profit`);
                }
            }
        }
    }
    
    /**
     * Buy stocks, spending more money on higher rated stocks
     * @param {Stock[]} stocksToBuy - highest rated stocks
     * @param {number} [maxTransactions=4]
     * @returns 
     */
    buyStocks(stocksToBuy, maxTransactions=4) {
        const {ns} = this;
        const bestStocks = stocksToBuy.sort((a,b)=>{
            return b.forecast - a.forecast; // descending
        });
    
        let transactions = 0;
        for (const stock of bestStocks) {
            const moneyRemaining = ns.getPlayer().money;
            // don't spend the last 5 million bux
            if (moneyRemaining < 5000000 || transactions >= maxTransactions) {
                return;
            }
            // spend up to half the money available on the highest rated stock
            // (the next stock will buy half as much)
            const moneyThisStock = moneyRemaining/2 - 100000;
            let numShares = moneyThisStock / stock.askPrice;
            
            numShares = Math.min(numShares, stock.maxShares - stock.shares - stock.sharesShort);
            const boughtPrice = ns.stock.buy(stock.symbol, numShares);
            if (boughtPrice != 0) {
                const boughtTotal = boughtPrice * numShares;
                transactions += 1;
                stock.shares += numShares;
                ns.print(`Bought ${ns.nFormat(boughtTotal, "$0.0a")} of ${stock.summary}`);
            }
        }
    }

    report() {
        const {ns} = this;

        const portfolioValue = this.getPortfolioValue();
        const cashValue = ns.getPlayer().money;
        const totalValue = portfolioValue + cashValue;

        function formatPct(n) {
            if (!n) { return ''; }
            return `${(n*100).toFixed(1)}%`;
        }
        function formatPrice(n) {
            if (!n) { return ''; }
            return ns.nFormat(n, "$0,0.0a");
        }

        const columns1 = [
            {header: ' Stock', field: 'symbol', width: 7, align:'left'},
            {header: 'Forecast', field: ['forecast', 'volatility'], format: [formatPct], width: 14, align: 'center'},
            {header: 'Price ', field: 'price', width: 7, align:'right', format:formatPrice},
            {header: ' Held ', field: 'netValue', width: 7, align:'right', format:formatPrice},
        ];
        columns1.title = "Stock Portfolio";
        const stockRows = [...this].filter((stock)=>(
            stock.netValue != 0
        )).sort((a,b)=>(
            b.netValue - a.netValue
        ));
        const portfolioRow = {symbol: "Total", price: 0, netValue: portfolioValue};

        const table1 = drawTable(columns1, stockRows, [portfolioRow]);

        const columns2 = [
            {header: 'Cash', field: 'label', width:24, align:'left'},
            {header: formatPrice(cashValue), field: 'value', align:'right', width:17, format:formatPrice}
        ];

        const cashRow = {label: "Cash", value: cashValue};
        const netWorthRow = {label: "Net Worth", value: totalValue};

        const table2 = drawTable(columns2, [netWorthRow])

        return (table1 + '\n' + table2);
    }
}
