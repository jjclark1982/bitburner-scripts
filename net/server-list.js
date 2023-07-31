/*

/net/server-list.js - get info about servers

Usage:

2.2 GB import
import { ServerList, ServerModel } from "/net/server-list";

3.8 GB daemon (Port 1)
> run /service/server-info.js

4.3 GB executable
> run /net/server-list.js

*/

/**
 * Display a simple report when run as an executable.
 *  
 * @param {NS} ns 
 * */
export function main(ns) {
    const serverList = new ServerList(ns);
    ns.clearLog();
    ns.tail();

    ns.print([
        `Total servers on network: ${serverList.getAllHostnames().size}`,
        `Player-owned servers: ${serverList.getPlayerOwnedServers().length}`,
        `Scriptable servers: ${serverList.getScriptableServers().length}`,
        `Hackable servers: ${serverList.getHackableServers(ns.getPlayer()).length}`,
        '',
        `Total RAM used: ${ns.nFormat(serverList.totalRamUsed()*1e9, "0.[0] b")} / ${ns.nFormat(serverList.totalRam()*1e9, "0.[0] b")}`,
        ' '
    ].join('\n'));
}

export class ServerList {
    ServerClass = ServerModel;

    constructor(ns, params={}) {
        ns.disableLog("scan");
        this.ns = ns;
        Object.assign(this, params);
        delete this._cachedServers;
    }

    [Symbol.iterator]() {
        return Object.values(this.getAllServers())[Symbol.iterator]();
    }

    loadServer(hostname) {
        return new this.ServerClass(this.ns, hostname);
    }

    getAllServers() {
        if (!this._cachedServers) {
            const allServers = {};
            for (const hostname of this.getAllHostnames()) {
                allServers[hostname] = this.loadServer(hostname);
            }
            this._cachedServers = allServers;
            setTimeout(() => {
                delete this._cachedServers;
            }, 1);
        }
        return this._cachedServers;
    }

    getAllHostnames() {
        return getAllHostnames(this.ns);
    }

    getScriptableServers() {
        return [...this].filter((server)=>(
            server.canRunScripts()
        ));
    }

    getHackableServers(player) {
        return [...this].filter((server)=>(
            server.canBeHacked(player)
        ));
    }

    getHacknetServers() {
        return [...this].filter((server)=>(
            server.hashCapacity
        ));
    }

    getPlayerOwnedServers() {
        // includes purchased servers but not 'home' or hacknet servers
        return [...this].filter((server)=>(
            server.purchasedByPlayer &&
            !(server.hostname == 'home') &&
            !(server.hashCapacity)
        ));
    }

    /**
     * List the smallest currently-available servers.
     * This is useful for finding the best-fitting RAM bank for a process.
     * @param {object} params 
     * @param {number} params.threads - minimum number of available threads to require
     * @param {number} params.scriptRam - RAM cost per thread
     * @param {object} params.exclude - list of hostnames to exclude
     * @returns [Array] list of suitable servers with the smallest current capacity first
     */
    getSmallestServers(params) {
        const defaults = {threads: 1, scriptRam: DEFAULT_SCRIPT_RAM, exclude: {}};
        const {threads, scriptRam, exclude} = Object.assign({}, defaults, params);
        const smallestServers = [...this].filter((server)=>(
            !(server.hostname in exclude) &&
            server.availableThreads(scriptRam) >= threads
        )).sort((a,b)=>(
            a.availableThreads(scriptRam) - b.availableThreads(scriptRam)
        ));
        return smallestServers;
    }

    /**
     * List the biggest servers that are currently available.
     * This uses a stable sort to help fill large servers first.
     * @param {object} params 
     * @param {number} params.threads - minimum number of available threads to require
     * @param {number} params.scriptRam - RAM cost per thread
     * @param {object} params.exclude - list of hostnames to exclude
     * @returns [Array] list of suitable servers with the largest max capacity first
     */
     getBiggestServers(params) {
        const defaults = {threads: 1, scriptRam: DEFAULT_SCRIPT_RAM, exclude: {}};
        const {threads, scriptRam, exclude} = Object.assign({}, defaults, params);
        const biggestServers = [...this].filter((server)=>(
            !(server.hostname in exclude) &&
            server.availableThreads(scriptRam) >= threads
        )).sort((a,b)=>(
            b.maxRam - a.maxRam
        ));
        return biggestServers;
    }

    totalRamUsed() {
        return this.getScriptableServers().reduce((total, server)=>(
            total + server.ramUsed
        ), 0);
    }

    totalRam() {
        return this.getScriptableServers().reduce((total, server)=>(
            total + server.maxRam
        ), 0);
    }

    totalThreadsAvailable(scriptRam=DEFAULT_SCRIPT_RAM) {
        return this.getScriptableServers().reduce((total, server)=>(
            total + server.availableThreads(scriptRam)
        ), 0);
    }

    maxThreadsAvailable(scriptRam=DEFAULT_SCRIPT_RAM) {
        return this.getScriptableServers().reduce((total, server)=>(
            Math.max(total, server.availableThreads(scriptRam))
        ), 0);
    }
}

export class ServerModel {
    constructor(ns, server) {
        this.__proto__.ns = ns;
        if (typeof(server) === 'string') {
            this.hostname = server;
            server = undefined;
        }
        this.reload(server);
    }

    reload(data) {
        data ||= this.ns.getServer(this.hostname);
        Object.assign(this, data);
        return this;
    }

    copy() {
        return new this.constructor(this.ns, this);
    }

    canRunScripts() {
        return (
            this.hasAdminRights &&
            this.maxRam > 0
        )
    }

    canBeHacked(player) {
        // player ||= this.ns.getPlayer();
        return (
            this.hasAdminRights &&
            this.moneyMax > 0 &&
            this.requiredHackingSkill <= player.skills.hacking
        )
    }

    availableRam(reservedRam=0) {
        // by default, reserve up to 1TB of RAM on special servers
        if ((this.hostname === "home") || this.hashCapacity) {
            reservedRam ||= Math.min(1024, this.maxRam * 3 / 4);
        }
        return Math.max(0, this.maxRam - this.ramUsed - reservedRam);
    }

    availableThreads(scriptRam=DEFAULT_SCRIPT_RAM) {
        if (!this.canRunScripts()) {
            return 0;
        }
        return Math.floor(this.availableRam() / scriptRam) || 0;
    }

    /**
     * getStockInfo - Load stock info from a stock service
     * @param {number} portNum - netscript port with a stock service
     * @returns {object} stockInfo {symbol, netShares, netValue, [forecast], [volatility]}
     */
    getStockInfo(portNum=5) {
        const {ns} = this;
        if ("stockInfo" in this) {
            return this.stockInfo;
        }
        this.stockInfo = null;
        if (this.organizationName) {
            const port = ns.getPortHandle(portNum);
            if (!port.empty()) {
                const stockService = port.peek();
                if (typeof(stockService.getStockInfo) == 'function') {
                    this.stockInfo = stockService.getStockInfo(this.organizationName);
                }
            }
        }
        // cache this info for 1 ms, so many calls can be made in the same tick
        setTimeout(()=>{
            delete this.stockInfo;
        }, 1);
        return this.stockInfo;
    }
}

export function getAllHostnames(ns) {
    getAllHostnames.cache ||= new Set();
    const scanned = getAllHostnames.cache;
    const toScan = ['home'];
    while (toScan.length > 0) {
        const hostname = toScan.shift();
        scanned.add(hostname);
        for (const nextHost of ns.scan(hostname)) {
            if (!scanned.has(nextHost)) {
                toScan.push(nextHost);
            }
        }
    }
    return scanned;
}

const DEFAULT_SCRIPT_RAM = 1.75;
