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

### `pool.js`

Library for running scripts on any available host. 

#### API Usage:
```js
import { runBatchOnPool } from "batch/pool.js";

// Define a job.
const job = {
    script: "script.js",
    args: ["foo"],
    threads: 1, // Optional. Will split threads among servers if needed.
    startTime: Date.now() // Optional. Schedule the job to start at a certain time.
};

// Launch a batch of jobs.
// Will cancel if there is not enough RAM for the entire batch.
// Will adjust the `startTime` of the entire batch if any are in the past.
const batch = [job];
await runBatchOnPool({ns}, batch);
```

#### CLI Usage:
Convenience interface to launch a single job on the pool.
```bash
> run /batch/pool.js --threads 1000 /batch/grow.js ecorp

/batch/pool.js: Running on omnitek: 292x /batch/grow.js ecorp
/batch/pool.js: Running on helios: 146x /batch/grow.js ecorp
/batch/pool.js: Running on fulcrumtech: 73x /batch/grow.js ecorp
...
```

-----

### `analyze.js`

Library of functions for planning batches and estimating profitability.

When run as an executable, prints the most profitable targets.

-----

### `hack.js`, `grow.js`, `weaken.js`

Single-purpose scripts which run once and terminate. These are deployed automatically by other scripts.
