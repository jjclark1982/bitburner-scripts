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
    - ~~`/inspect/server.js` -> move to `/net/info.js`?  ~~

- server / memory management -> move to `/net/` (maybe rename to `/cloud/`)  
    - [x] `/hive/server-pool.js` -> move to `/net/server-pool.js`  
    - [x] `/net/lib.js` -> merge into `server-pool`  
    - [ ] `/batch/pool.js` -> merge into `server-pool`, rename the rest to `scheduler`  
    - [x] `/net/crack-servers.js` -> `/net/register-servers.js`  
    - [x] `/net/buy-server.js` -> split out 'retire' function  
    - [x] `/net/retire-server.js` -> rename to `delete-server`

- thread management / function delegation / botnet control -> maybe rename to `/botnet/`  
    - [ ] `/hive/thread-pool.js`  
    - [ ] `/hive/worker.js` (class definition)  

- hack planning  
    - [ ] `/batch/analyze.js` -> merge into `/hacking/planner.js`
    - [x] `/hive/planner.js` -> move to `/hacking/planner.js`

- unmanaged hacking -> move to `/unmanaged-hacking/`
    - [x] `/batch/early-hacking.js`  
    - [x] `/batch/spawn-early-hacking.js`  

- batched hacking (single-function process)
    - [ ] `/batch/prep.js`  
    - [ ] `/batch/manage.js`  
    - [ ] `/batch/{hack,grow,weaken}.js`  

- remote-controlled hacking (persistent process)
    - [x] `/hive/manage.js` -> move to `/hacking/manager.js`
    - [ ] `/hive/worker.js` (main function)  


- [x] rename all `spawn` scripts to `deploy`

- [ ] remove `.js` from import statements

- [x] refactor `server-pool` to have a unified interface for different deployment types
