# bitburner-scripts

Collection of scripts for [Bitburner](https://danielyxie.github.io/bitburner/)

### Directory

[augmentations/](augmentations/) -  Buy, unlock, and graft augmentations based on various priorities.

[bladeburner/](bladeburner/) - Manage bladeburner actions and skill points.

[botnet/](botnet/) - System for remote control of long-running processes.

[contracts/](contracts/) - Find and solve coding contracts.

[corporation/](corporation/) - 

[gang/](gang/) - Manage gang member activities and equipment.

[hacking/](hacking/) and [batch/](batch/) - Scripts for planning and carrying out hack/grow/weaken operations.

[hacknet/](hacknet/) - Buy hacknet nodes or servers that will pay for themselves in a specified amount of time.

[inspect/](inspect/) - Show info about various objects.

[net/](net/) - Utilities for working with servers and RAM.

[player/](player/) - Singularity actions.

[service/](service/) - System for publishing library code on Netscript ports.

[stanek/](stanek/) - Configure and charge Stanek's Gift.

[stocks/](stocks/) - Buy and sell stocks based on their expected performance.

[init.js](init.js) - Entry point to start programs.


### TODO: Reorganize hacking scripts

Would like to move most of these into `net/` or `hacking/`.

(Don't want to have a `servers/` folder because autocomplete gets `ServerProfiler.exe`)

- misc net scripts (don't really fit in this section)  
    - [x] `/net/backdoor-servers.js` -> move to `/player/`  
    - [x] `/net/tunnel.js` -> move to `/player/`  
    - [x] `/net/share.js` -> move to `/share/`  
    - [x] `/net/spawn-share.js` -> move to `/share/`  

- libraries / utilities  
    - [x] `/hive/table.js` -> move to `/lib/box-drawing.js`  
    - ~~`/inspect/server.js` -> move to `/net/info.js`?  ~~

- server / memory management -> move to `/net/` (maybe rename to `/cloud/`)  
    - [x] `/hive/server-pool.js` -> move to `/net/server-pool.js`  
    - [x] `/net/lib.js` -> merge into `server-pool`  
    - [x] `/batch/pool.js` -> merge into `/net/deploy-script.js`
    - [x] `/net/crack-servers.js` -> `/net/register-servers.js`  
    - [x] `/net/buy-server.js` -> split out 'retire' function  
    - [x] `/net/retire-server.js` -> rename to `delete-server`
    - [x] `/net/server-model.js` -> rename to `/net/list-servers.js` or maybe `/net/server-list.js`
    - [x] `/net/deploy.js` -> rename to `/net/deploy-script.js`
    - [x] `/net/server-pool.js` -> merge into `/net/deploy-script.js`

- thread management / function delegation / botnet control
    - [x] rename to `/botnet/`  
    - [ ] `/botnet/thread-pool.js`  
    - [ ] `/botnet/worker.js` (class definition)  

- hack planning  
    - [ ] `/batch/analyze.js` -> merge into `/hacking/planner.js`
    - [x] `/hive/planner.js` -> move to `/hacking/planner.js`

- unmanaged hacking -> move to `/unmanaged-hacking/` or `/self-contained-hacking/`
    - [x] `/batch/early-hacking.js`  
    - [x] `/batch/spawn-early-hacking.js`  

- batched hacking (single-function process)
    - [ ] `/batch/analyze.js` -> replace with `/hacking/planner.js`
    - [ ] `/batch/prep.js`  
    - [ ] `/batch/manage.js`  
    - [ ] `/batch/{hack,grow,weaken}.js`  

- remote-controlled hacking (persistent process)
    - [x] `/hive/manage.js` -> move to `/hacking/manager.js`
    - [ ] `/botnet/worker.js` (main function)  


- [x] rename all `spawn` scripts to `deploy`

- [ ] remove `.js` from import statements

- [x] refactor `server-pool` to have a unified interface for different deployment types


- [x] replace most usage of `Date.now()` with `performance.now()`


Would like to define netscript port interfaces for loosely-coupled services:


Port 1: RAM Service (ComputeService interface)
Port 2: Thread Service (ComputeService interface)
Port 5: Stock Service

```
ComputeService
    dispatchJobs() a la ThreadPool
    maxThreadsAvailable() a la ServerPool

StockService
    getStockInfo
```

Then some redundant ram costs could be eliminated. For example measuring threads available without including `ns.exec` or `ns.getScriptRam`:

```
    ServerModel(ns)
        - get ram info
        - canRunScripts()
        - isHackable(player)
        - getStockInfo()

    HackableServer(ServerModel)
        - plan hack, etc

    CloudServer(ServerModel, scriptRam)
        - count thread size
        - deploy job, etc

```
then ServerPool could just be an Array subclass, like Batch


---


#### Class Hierarchy

```
PortService
    ServerService
        ComputeService
    ThreadPool
    StockService

ServerModel
    ScriptableServer
    HackableServer
```

---

Would like to make reusable modules that are available as either commands, libraries, or services.

```
/net/server-list.js: show info about a named server
    ServerModel
    ServerList

/net/deploy-script.js: run a script on any cloud server
    ScriptableServer extends ServerModel
    ServerPool extends ServerList

/hacking/planner.js
    HackableServer extends ServerModel

/botnet/thread-pool.js
    ThreadPool extends ServerPool ?
/botnet/worker.js
    Worker

/lib/port-service.js
    PortService
    getService()

/service/server-info.js
    import PortService
    import ServerList
    await (new PortService(ns, 1, ServerList)).serve()

/service/compute.js
    import PortService
    import ServerPool
    await (new PortService(ns, 2, ServerPool)).serve()
```

(nothing should depend on a Service subclass)

---

Now the whole system architecture looks like;

```
Services
    ServerPool
    ThreadPool
    HackingPlanner
    StockInfo

Applications
    HackingManager
```
