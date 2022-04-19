## Netscript Port Services

Netscript port numbers used in this repository:

- Port 1: [ServerList](#ServerList_Service) - Information about servers
- Port 2: [ServerPool](#ServerPool_Service) - Run scripts on any server
- Port 3: [ThreadPool](../botnet/) - Run netscript functions on a grid computing system
- Port 4: [HackPlanner](#Hack_Planning_Service) - Plan hack/grow/weaken operations
- Port 5: [StockTrader](../stocks/trader.js) - Information about stocks

---

### ServerList Service

[server-list.js](../net/server-list.js) defines these data structures:

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
> run /service/server-info.js
```

Then you can read server info with no RAM cost for the client:

```javascript
import { getService } from "/lib/port-service";
const serverList = getService(ns, 1);
const server = serverList.loadServer("foodnstuff");
server.hackDifficulty; // 10
await ns.hack(server.hostname);
server.reload();
server.hackDifficulty; // 12
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

### ServerPool Service

ServerPool is a subclass of ServerList, extended with script execution methods.

ServerPool
- deploy({script, threads, args, [dependencies]})
- deployLater({script, threads, args, [dependencies], [startTime]})
- deployBatch([jobs]) - will run all jobs or none of them

**Usage:** Run the service (5.8 GB daemon):

```bash
> run /service/compute.js
```

Then you can deploy scripts to any available server, with no RAM cost for the client:

```javascript
import { getService } from "/lib/port-service";
const serverPool = getService(ns, 2);
const job = {script: "/batch/weaken.js", args: ["foodnstuff"], threads: 100})
serverPool.deploy(job);
```

---

### Hack Planning Service

Service for [HackPlanner](../hacking/)

**Usage:** Run the service (7.3 GB daemon):

```bash
> run /service/hack-planning.js
```

Then you can plan hacking jobs based on various parameters.

```javascript
import { getService } from "/lib/port-service";
const hackPlanner = getService(ns, 4);
server = hackPlanner.loadServer("phantasy");
server.planBatchCycle(server.mostProfitableParamsSync()); // " 7.6% HWGW"
```
