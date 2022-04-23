## Bitburner batch scripts

Scripts for running batches of hack/weaken/grow/weaken attacks against Bitburner servers.

This has mostly been supplanted by the [hacking](../hacking/) folder.

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
