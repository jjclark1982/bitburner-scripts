## Netscript Port Services

### Server Service

Defines these data structures:

ServerService
- loadServer(hostname) -> Server
- getAllServers() -> Map[hostname: Server]

Server
- canRunScripts()
- canBeHacked(player)
- availableThreads(scriptRam)
- getStockInfo

**Usage:** Run the service (3.8 GB daemon):

```bash
> run /service/servers.js
```

Then you can read server info with no RAM cost for the client:

```javascript
function getServerService(ns, portNum=7) {
    const portHandle = ns.getPortHandle(portNum);
    if (!portHandle.empty()) {
        return portHandle.peek();
    }
}
const serverService = getServerService(ns);
const server = serverService.loadServer("foodnstuff");
if (server.canBeHacked(ns.getPlayer())) {
    if (server.hackDifficulty > server.minDifficulty) {
        await ns.weaken(server.hostname);
    }
    else if (server.moneyAvailable < server.moneyMax) {
        await ns.grow(server.hostname, {stock: server.getStockInfo()?.netShares >= 0});
    }
    else {
        await ns.hack(server.hostname, {stock: this.getStockInfo()?.netShares < 0})
    }
}
```
