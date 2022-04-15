## Netscript Port Services

Netscript port numbers used in this repository:

- Port 1: [ServerService](#Server_Service) - Information about servers
- Port 2: [ComputeService](#Compute_Service) - Run scripts on any server
- Port 3: [ThreadPool](../hive/) - Run netscript functions on a grid computing system
- Port 5: [StockTrader](../stocks/trader.js) - Information about stocks

---

### Server Service

Defines these data structures:

ServerList
- loadServer(hostname) -> Server
- getAllServers() -> Map[hostname: Server]
- getScriptableServers() -> Array[Server]
- getHackableServers(player) -> Array[Server]

Server
- canRunScripts()
- canBeHacked(player)
- availableThreads(scriptRam)
- getStockInfo()

**Usage:** Run the service (3.8 GB daemon):

```bash
> run /service/servers.js
```

Then you can read server info with no RAM cost for the client:

```javascript
import { getService } from "/service/lib";
const serverList = getService(ns, 1);
const server = serverList.loadServer("foodnstuff");
while (true) {
    server.reload();
    if (server.hackDifficulty > server.minDifficulty) {
        await ns.weaken(server.hostname);
    }
    else if (server.moneyAvailable < server.moneyMax) {
        await ns.grow(server.hostname);
    }
    else {
        await ns.hack(server.hostname)
    }
}
```

The service is also available in the browser console:
```javascript
> serverList.getAllHosts().size
72
> serverList.getScriptableServers().length
46
> serverList.getHackableServers({hacking:166}).length
13
```

---

### Compute Service

This is a subclass of ServerService, extended with script execution methods.

ComputeService
- deploy({script, threads, args, [dependencies]})
- deployLater({script, threads, args, [dependencies], [startTime]})
- deployBatch([jobs]) - will run all jobs or none of them

**Usage:** Run the service (5.8 GB daemon):

```bash
> run /service/compute.js
```

Then you can deploy scripts to any available server, with no RAM cost for the client:

```javascript
function getService(ns, portNum=2) {
    const portHandle = ns.getPortHandle(portNum);
    if (!portHandle.empty()) {
        return portHandle.peek();
    }
}
const computeService = getService(ns, 2);
const job = {script: "/batch/weaken.js", args: ["foodnstuff"], threads: 100})
computeService.deploy(job);
```
