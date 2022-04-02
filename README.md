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
    - [x] `/net/backdoor-servers.js` -> move to `/player/`  
    - [x] `/net/tunnel.js` -> move to `/player/`  
    - [x] `/net/share.js` -> move to `/share/`  
    - [x] `/net/spawn-share.js` -> move to `/share/`  

- libraries / utilities  
    - [x] `/hive/table.js` -> move to `/lib/box-drawing.js`  
    - [ ] `/inspect/server.js` -> move to `/net/info.js`?  

- server / memory management -> move to `/net/` (maybe rename to `/cloud/`)  
    - [x] `/hive/server-pool.js` -> move to `/net/server-pool.js`  
    - [x] `/net/lib.js` -> merge into `server-pool`  
    - [ ] `/batch/pool.js` -> merge into `server-pool`  
    - [x] `/net/crack-servers.js` -> `/net/register-servers.js`  
    - [x] `/net/buy-server.js` -> split out 'retire' function  

- thread management / function delegation / botnet control -> maybe rename to `/botnet/`  
    - [ ] `/hive/thread-pool.js`  
    - [ ] `/hive/worker.js` (class definition)  

- hack planning  
    - [ ] `/batch/analyze.js`  

- unmanaged hacking  
    - [ ] `/batch/early-hacking.js`  
    - [ ] `/batch/spawn-early-hacking.js`  

- managed hacking (single-run process)  
    - [ ] `/batch/prep.js`  
    - [ ] `/batch/manage.js`  
    - [ ] `/batch/{hack,grow,weaken}.js`  

- managed hacking (persistent process)  
    - [ ] `/hive/manage.js`  
    - [ ] `/hive/worker.js` (main function)  
