# Bitburner batch scripts

Scripts for running batches of hack/weaken/grow/weaken attacks against Bitburner servers.

This is meant to be self-contained, but currenty has one dependency: a `listAllServers()` function.
TODO: integrate this and make it more efficient


`hack.js`, `grow.js`, `weaken.js` - Single-purpose scripts which run once and terminate. These are deployed automatically by other scripts.
TODO: rename `weaken.js` to `weak.js`?

`analyze.js` - Library of functions for planning batches and estimating profitability.
When run as an executable, prints the most profitable targets.

`pool.js` - Library of functions for running scripts on any available host.
When run as an executable, prints the servers currently available.
TODO: Use CLI to run an arbitrary script on the pool.

`all.js` - Daemon which attacks the most profitable targets.
TODO: specify targets on CLI

`manage.js` - Daemon which runs scripts on a single host to attack a single target. (deprecated)
