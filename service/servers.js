/*
Usage: copy this function into a client:

    function getServerService(ns, portNum=7) {
        const portHandle = ns.getPortHandle(portNum);
        if (!portHandle.empty()) {
            return portHandle.peek();
        }
    }

Then you can call these methods with no RAM cost:

	const serverService = getServerService(ns);
	const server = serverService.loadServer("foodnstuff");
    ns.tprint(server.getAvailableRam());

*/

const FLAGS = [
    ["help", false],
    ["port", 1]
]

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("asleep");
    ns.disableLog("scan");
    ns.clearLog();

    const flags = ns.flags(FLAGS);
    if (flags.help) {
        ns.tprint("Provide server information on a netscript port")
        return;
    }

    const serverService = new ServerService(ns);
    await serverService.work(flags.port);
}

export class ServerService {
    ServerClass = Server;

    constructor(ns) {
        this.ns = ns;
    }

    async work(portNum=1) {
        const {ns} = this;
        const name = this.constructor.name.substr(0,1).toLowerCase() + this.constructor.name.substr(1);
        eval('window')[name] = this;
        const portHandle = ns.getPortHandle(portNum);
        portHandle.clear();
        portHandle.write(this);
        ns.atExit(()=>{
            this.running = false;
            portHandle.clear();
            delete eval('window')[name];
        });
        ns.tprint(`Started ${this.constructor.name} on port ${portNum}`);
        this.running = true;
        while (this.running) {
            if (this.report) {
                ns.clearLog();
                ns.print(this.report());    
            }
            await ns.asleep(1000);
        }
        ns.tprint(`Stopping ${this.constructor.name} on port ${portNum}`);
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
        const {ns} = this;
        this.getAllHostnames.cache ||= new Set();
        const scanned = this.getAllHostnames.cache;
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

    getScriptableServers() {
        return Object.values(this.getAllServers()).filter((server)=>(
            server.canRunScripts()
        ));
    }

    getHackableServers(player) {
        return Object.values(this.getAllServers()).filter((server)=>(
            server.canBeHacked(player)
        ));
    }

    getSmallestServersWithThreads(scriptRam, threads, exclude={}) {
        const smallestServers = Object.values(this.getAllServers()).filter((server)=>(
            !(server.hostname in exclude) &&
            server.availableThreads(scriptRam) >= threads
        )).sort((a,b)=>(
            a.availableThreads(scriptRam) - b.availableThreads(scriptRam)
        ));
        return smallestServers;
    }

    getBiggestServers(scriptRam, exclude={}) {
        const biggestServers = Object.values(this.getAllServers()).filter((server)=>(
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

export class Server {
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
