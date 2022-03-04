import {StockSymbols} from "stocks/companies.js"

export async function main(ns) {
    let hostname;
    if (ns.args.length > 0) {
        hostname = ns.args[0];
    }
    const server = ns.getServer(hostname);
    if (server.organizationName) {
        server.stockSymbol = StockSymbols[server.organizationName];
    }
    ns.tprint(JSON.stringify(server, null, 2));
    ns.tprint(ns.getServerSecurityLevel(hostname));
}

export function autocomplete(data, args) {
    return data.servers;
}