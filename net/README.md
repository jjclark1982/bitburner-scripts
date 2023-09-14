## Bitburner Net Scripts

Scripts for managing servers and RAM.

---

### deploy-script.js

Library for running scripts on any available host. 

#### API Usage:
```javascript
import { deploy } from "net/deploy-script.js";

// Define a job.
const job = {
    script: "script.js",
    args: ["foo"],
    threads: 100,         // Optional (default 1)
    startTime: performance.now() // Optional. Schedule the job to start at a certain time.
};
const options = {
    allowSplit: true,     // Whether to allow splitting threads among different servers.
}

// Launch a batch of jobs.
// Will cancel if there is not enough RAM for the entire batch.
// Will adjust the `startTime` of the entire batch if any are in the past.
const batch = [job];
await deploy(ns, batch, options);
```

#### CLI Usage:
Convenience interface to launch a single job in the cloud.
```bash
> run /net/deploy-script.js --threads 1000 /batch/grow.js ecorp

/net/deploy-script.js: Running on omnitek: 292x /batch/grow.js ecorp
/net/deploy-script.js: Running on helios: 146x /batch/grow.js ecorp
/net/deploy-script.js: Running on fulcrumtech: 73x /batch/grow.js ecorp
...
```
