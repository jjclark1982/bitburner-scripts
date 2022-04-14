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
    ["port", 7]
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
    const portHandle = ns.getPortHandle(flags.port);
    portHandle.clear();
    portHandle.write(serverService);
    ns.atExit(()=>{
        portHandle.clear();
    });
    ns.print(`Started Server Service on port ${flags.port}`);
    while (true) {
        await ns.asleep(60*60*1000);
    }
}

class ServerService {
    constructor(ns) {
        this.ns = ns;
        this.knownHosts = {};
    }

    loadServer(hostname) {
        return new Server(this.ns, hostname);
    }

    getAllServers() {
        const allServers = {};
        for (const hostname of this.getAllHosts()) {
            allServers[hostname] = this.loadServer(hostname);
        }
        return allServers;
    }

    getAllHosts() {
        const toScan = ['home'];
        while (toScan.length > 0) {
            const hostname = toScan.shift();
            this.knownHosts[hostname] = true;
            for (const nextHost of ns.scan(hostname)) {
                if (!(nextHost in this.knownHosts)) {
                    toScan.push(nextHost);
                }
            }
        }
        const allHosts = Object.keys(this.knownHosts);
        return allHosts;
    }
}

class Server {
    constructor(ns, data) {
        this.ns = ns;
        if (typeof(data) === 'string') {
            this.hostname = data;
            data = undefined;
        }
        this.reload(data);
    }

    reload(data) {
        data ||= this.ns.getServer(this.hostname);
        Object.assign(this, data);
        return this;
    }

    copy() {
        return new Server(ns, this);
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
        let stockInfo = null;
        if (this.organizationName) {
            const port = ns.getPortHandle(portNum);
            if (!port.empty()) {
                const stockService = port.peek();
                if (typeof(stockService.getStockInfo) == 'function') {
                    stockInfo = stockService.getStockInfo(this.organizationName);
                }
            }
        }
        this.stockInfo = stockInfo;
        // cache this info for 1 ms, so many calls can be made in the same tick
        setTimeout(()=>{
            delete this.stockInfo;
        }, 1);
        return this.stockInfo;
    }
}
