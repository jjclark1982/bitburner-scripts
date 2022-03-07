# Bitburner batch scripts

Scripts for running batches of hack/weaken/grow/weaken attacks against Bitburner servers.

### `manage.js`

Daemon which attacks the most profitable targets.

Can optionally specify individual targets on CLI.  

> TODO: exclude servers which are poorly suited to batching (all actions under 1 seconds)

#### CLI Usage:
```
run /batch/manage.js ecorp foodnstuff
```

### `pool.js`

Library for running scripts on any available host. 

#### API Usage:
```js
import { runBatchOnPool, copyToPool } from "batch/pool.js";

// Copy the script to all servers.
await copyToPool(ns, "script.js");

// Define a job.
const job = {
    script: "script.js",
    threads: 1, // Optional. Will split threads among servers if needed.
    args: ["foo"],
    startTime: Date.now() // Optional. Schedule the job to start at a certain time.
};

// Launch a batch of jobs.
// Will cancel if there is not enough RAM for the entire batch.
// Will adjust the `startTime` of the entire batch if any are in the past.
runBatchOnPool(ns, [job]);
```

#### CLI Usage:
Convenience interface to launch a single job on the pool.
```bash
run /batch/pool.js --threads 1000 /batch/grow.js ecorp
```

### `analyze.js`

Library of functions for planning batches and estimating profitability.

When run as an executable, prints the most profitable targets.

### `hack.js`, `grow.js`, `weaken.js`

Single-purpose scripts which run once and terminate. These are deployed automatically by other scripts.
