export const allStocks = {};

export function getAllStocks(ns) {
    if (Object.keys(allStocks) == 0) {
        for (const symbol of ns.stock.getSymbols()) {
            allStocks[symbol] = {
                symbol: symbol,
                history: []
            };
        }
    }
    for (const symbol of Object.keys(allStocks)) {
        const stock = allStocks[symbol];
        const pos = ns.stock.getPosition(symbol);
        stock.shares = pos[0];
        stock.sharesAvgPrice = pos[1];
        stock.sharesShort = pos[2];
        stock.sharesAvgPriceShort = pos[3];
        stock.maxShares = ns.stock.getMaxShares(symbol);
        stock.askPrice = ns.stock.getAskPrice(symbol);
        stock.bidPrice = ns.stock.getBidPrice(symbol);
        stock.price = (stock.askPrice + stock.bidPrice) / 2;
        stock.summary = `${stock.symbol}`;
        stock.history.push(stock.price);
        stock.forecast = computeForecast(stock.history);
        stock.volatility = computeVolatility(stock.history);
        if (stock.history.length > 32) {
            stock.history = stock.history.slice(16);
        }
    }
    return allStocks;
}

function computeForecast(history) {
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

function computeVolatility(history) {
    if (history.length < 2) {
        return 0;
    }
    const changes = [];
    const increases = 0;
    const decreases = 0;
    for (let i = 1; i < history.length; i++) {
        const change = (history[i] - history[i-1]) / history[i];
        changes.push(Math.abs(change));
    }
    const maxChange = Math.max(...changes);
    return maxChange;
}

export function getPortfolioValue(stocks) {
    let value = 0;
    for (const stock of Object.values(stocks)) {
        value += stock.bidPrice * stock.shares - stock.askPrice * stock.sharesShort;
    }
    return value;
}

export function getBullStocks(stocks, threshold=0.6) {
    const bullStocks = [];
    for (const stock of Object.values(stocks)) {
        if (stock.forecast - stock.volatility > threshold) {
            bullStocks.push(stock);
        }
    }
    return bullStocks;
}

export function getBearStocks(stocks, threshold=0.47) {
    const bearStocks = [];
    for (const stock of Object.values(stocks)) {
        if (stock.forecast - stock.volatility < threshold) {
            bearStocks.push(stock);
        }
    }
    return bearStocks;
}


export function sellStocks(ns, stocksToSell) {
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

export function buyStocks(ns, stocksToBuy, moneyToSpend, maxTransactions=4) {
    //let moneyRemaining = moneyToSpend;
    //const moneyPerStock = (moneyToSpend / stocksToBuy.length) - 100000;
    const bestStocks = stocksToBuy.sort((a,b)=>{
        return b.forecast - a.forecast; // descending
    });

    let transactions = 0;
    for (const stock of bestStocks) {
        const moneyRemaining = ns.getPlayer().money;
        if (moneyRemaining < 25000000 || transactions >= maxTransactions) {
            return;
        }
        const moneyThisStock = moneyRemaining/2 - 100000;
        let numShares = moneyThisStock / stock.askPrice;
        
        numShares = Math.min(numShares, stock.maxShares - stock.shares - stock.sharesShort);
        const boughtPrice = ns.stock.buy(stock.symbol, numShares);
        if (boughtPrice != 0) {
            const boughtTotal = boughtPrice * numShares;
            //moneyRemaining -= boughtTotal - 100000;
            transactions += 1;
            stock.shares += numShares;
            ns.print(`Bought ${ns.nFormat(boughtTotal, "$0.0a")} of ${stock.summary}`);
        }
    }
}

export function tendStocks(ns) {
    const allStocks = getAllStocks(ns);

    const historyLength = Object.values(allStocks)[0].history.length;
    if (historyLength < 10) {
        return;
    }
    const stocksByForecast = Object.values(allStocks).sort(function(a,b){
        return b.forecast - a.forecast;
    });
    
    const stocksToSell = getBearStocks(allStocks);
    sellStocks(ns, stocksToSell);
    
    const stocksToBuy = getBullStocks(allStocks);
    const moneyToSpend = ns.getServerMoneyAvailable('home') - (ns.args.length > 0 && ns.args[0] || 1000000);
    buyStocks(ns, stocksToBuy, moneyToSpend);    

    const portfolioValue = getPortfolioValue(allStocks);
    const cashValue = ns.getServerMoneyAvailable('home');
    const totalValue = portfolioValue + cashValue;
    ns.print(`Net worth: ${ns.nFormat(totalValue, "$0.0a")} = ${ns.nFormat(portfolioValue, "$0.0a")} stocks + ${ns.nFormat(cashValue, "$0.0a")} cash`);
}

export async function main(ns) {
    ns.disableLog("sleep");
    ns.disableLog("getServerMoneyAvailable");
    while (true) {
        for (let i = 0; i < 20; i++) {
            getAllStocks(ns);
            await ns.sleep(6*1000);
        }
        tendStocks(ns);
        await ns.sleep(6*1000);
    }
}
