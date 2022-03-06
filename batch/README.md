# Bitburner batch scripts

Scripts for running batches of hack/weaken/grow/weaken attacks against Bitburner servers.

`hack.js`, `grow.js`, `weaken.js` - Single-purpose scripts which run once and terminate. These are deployed automatically by other scripts.

`analyze.js` - Library of functions for planning batches and estimating profitability.
When run as an executable, prints the most profitable targets.

`pool.js` - Library of functions for running scripts on any available host.
When run as an executable, executes an arbitrary script on the pool.  
Example:
```
run /batch/pool.js --threads 1000 /batch/grow.js ecorp
```

`manage.js` - Daemon which attacks the most profitable targets.
Can specify individual targets on CLI.  
Example
```
run /batch/manage.js ecorp foodnstuff
```
