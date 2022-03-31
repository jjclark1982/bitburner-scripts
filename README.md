# bitburner-scripts

Collection of scripts for [Bitburner](https://danielyxie.github.io/bitburner/)

### Directory

[augmentations/](augmentations/) -  Buy, unlock, and graft augmentations based on various priorities.

[bladeburner/](bladeburner/) - Manage bladeburner actions and skill points.

[contracts/](contracts/) - Find and solve coding contracts.

[corporation/](corporation/) - 

[gang/](gang/) - Manage gang member activities and equipment.

[hacknet/](hacknet/) - Buy hacknet nodes or servers that will pay for themselves in a specified amount of time.

[inspect/](inspect/) - Show info about various objects.

[player/](player/) - Singularity actions.

[stanek/](stanek/) - Configure and charge Stanek's Gift.

[stocks/](stocks/) - Buy and sell stocks based on their expected performance.

[init.js](init.js) - Entry point to start programs.


### TODO: Reorganize hacking scripts

Would like to move most of these into `net/` or `hacking/`.

(Don't want to have a `servers/` folder because autocomplete gets `ServerProfiler.exe`)

- misc net scripts (don't really fit in this section)  
    `/net/backdoor-servers.js` -> move to `/player/`  
    `/net/tunnel.js` -> move to `/player/`  
    `/net/share.js` -> move to `/share/`  
    `/net/spawn-share.js` -> move to `/share/`  

- libraries / utilities  
    `/hive/table.js` -> move to `/lib/`  
    `/inspect/server.js`  
- memory management -> move most of these to `/net/`  
    `/hive/server-pool.js`  
    `/net/lib.js` -> merge into `server-pool`  
    `/batch/pool.js` -> merge into `server-pool`  
    `/net/crack-servers.js`  
    `/net/buy-server.js`  
- thread management / function delegation / botnet control -> maybe rename to `/botnet/`  
    `/hive/thread-pool.js`  
    `/hive/worker.js` (class definition)  
- hack planning  
    `/batch/analyze.js`  
- unmanaged hacking  
    `/batch/early-hacking.js`  
    `/batch/spawn-early-hacking.js`  
- managed hacking (single-run process)  
    `/batch/prep.js`  
    `/batch/manage.js`  
    `/batch/{hack,grow,weaken}.js`  
- managed hacking (persistent process)  
    `/hive/manage.js`  
    `/hive/worker.js` (main function)  
