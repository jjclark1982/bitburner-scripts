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

    constructor(ns) {
        this.ns = ns;
        ns.disableLog("scan");
    }

    [Symbol.iterator]() {
        return Object.values(this.getAllServers())[Symbol.iterator]();
    }

    loadServer(hostname) {
        return new this.ServerClass(this.ns, hostname);
    }

    getAllServers() {
        if (!this.getAllServers.cache) {
            const allServers = {};
            for (const hostname of this.getAllHostnames()) {
                allServers[hostname] = this.loadServer(hostname);
            }
            this.getAllServers.cache = allServers;
            setTimeout(() => {
                delete this.getAllServers.cache;
            }, 1);
        }
        return this.getAllServers.cache;
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

    getPlayerOwnedServers() {
        // includes home, hacknet servers, and purchased servers
        return [...this].filter((server)=>(
            server.purchasedByPlayer
        ));
    }

    getSmallestServersWithThreads(scriptRam, threads, exclude={}) {
        const smallestServers = [...this].filter((server)=>(
            !(server.hostname in exclude) &&
            server.availableThreads(scriptRam) >= threads
        )).sort((a,b)=>(
            a.availableThreads(scriptRam) - b.availableThreads(scriptRam)
        ));
        return smallestServers;
    }

    getBiggestServers(scriptRam, exclude={}) {
        const biggestServers = [...this].filter((server)=>(
            !(server.hostname in exclude) &&
            server.availableThreads(scriptRam) >= 1
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

    totalThreadsAvailable(scriptRam=1.75) {
        return this.getScriptableServers().reduce((total, server)=>(
            total + server.availableThreads(scriptRam)
        ), 0);
    }

    maxThreadsAvailable(scriptRam=1.75) {
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
            this.requiredHackingSkill <= player.hacking
        )
    }

    availableRam(reservedRam=0) {
        // by default, reserve up to 1TB of RAM on special servers
        if ((this.hostname === "home") || this.hashCapacity) {
            reservedRam ||= Math.min(1024, this.maxRam * 3 / 4);
        }
        return Math.max(0, this.maxRam - this.ramUsed - reservedRam);
    }

    availableThreads(scriptRam=1.75) {
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
