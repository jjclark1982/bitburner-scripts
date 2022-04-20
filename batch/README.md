## Bitburner batch scripts

Scripts for running batches of hack/weaken/grow/weaken attacks against Bitburner servers.

-----

### `manage.js`

Daemon which attacks the most profitable targets.

Can optionally specify individual targets on CLI.  

#### CLI Usage:
```bash
# automatically select targets
> run /batch/manage.js

# specify any number of targets
> run /batch/manage.js ecorp foodnstuff
```

-----

### `analyze.js`

Library of functions for planning batches and estimating profitability.

When run as an executable, prints the most profitable targets.

-----

### `hack.js`, `grow.js`, `weaken.js`

Single-purpose scripts which run once and terminate. These are deployed automatically by other scripts.
