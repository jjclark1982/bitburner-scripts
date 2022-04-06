## HVMind Distributed Computing System

This is a [grid computing](https://en.wikipedia.org/wiki/Grid_computing) system that dispatches tasks to long-lived worker processes running in the cloud.

The system is controlled through a `ThreadPool` which communicates with `Worker` processes through a [Netscript Port](https://bitburner.readthedocs.io/en/latest/netscript/netscriptmisc.html#netscript-ports). The processes can connect to each other after being launched in any order, including reloading from save.

An application can dispatch tasks to the `ThreadPool` and it will launch an appropriate size `Worker` on any available server, or assign the task to an already running `Worker`.

![hvmind](system-diagram.svg)



---

### Installation

Copy these scripts:
```
/lib/box-drawing.js
/net/server-pool.js
/hive/thread-pool.js
/hive/worker.js
/hive/manager.js
/hive/planner.js
```

### CLI Usage

Start the thread pool:
```
> run /hive/thread-pool.js --tail
```

Run an application on the pool:
```
> run /hive/manager.js foodnstuff
```

### API Usage

Applications can run jobs by calling `threadPool.dispatchJob(job)`, where a job is an object defining the `task`. For example:

```JavaScript
{
    task: 'hack',             // a key in worker.capabilities
    args: ['foodnstuff'],
    threads: 5,
    duration:  1000,          // optional
    startTime: 1649093514728, // optional (will start immediately if omitted)
    endTime:   1649093515728  // optional
}
```

When the job runs, this object will be updated with `startTimeActual` and `endTimeActual`. Other fields will be preserved, so a user can record expectations here and compare them against results.

> TODO: support running a callback as soon as the task finishes





---

#### Design notes

Is it possible to spawn a large number of persistent workers, then control them from a central manager?

```
netlink
    hack-worker.js -t 18
vitalife
    grow-worker.js -t 18
phantasy
    weak-worker.js -t 18

home
    manager.js
        workers: [
            {
                type: hack,
                threads: 18,
                nextFreeTime: 16039234038
                addJob: ({target, threads, startTime, endTime})=>()
            },
            ...
        ]
```
- always assign a job to the smallest worker that can handle it
- if there is no worker of the right type, spawn one
    (use max threads for host, or only the number needed?)
- warn user if we weren't able to start one

Then when we want to schedule a batch:

for each job in the batch:
    - find an existing worker that can schedule the job
    - or spawn a new worker of the right size
    - or split the job over multiple workers (this can change the batch timing)
    - or cancel the batch

----

Class structure:

```
HackPlanner(ns, target)
    planPrep()
    planBatch() (needs ThreadPool to plan thread-splitting, or to embed a delegate function)
        planHack()
        planGrow()
        planWeaken()
    estimateProfit()

HackManager(ns, portNum, targets)
    planners
    threadPool
    runBatchOnPool()

ThreadPool(ns, portNum)
    dispatchJobs()
    dispatchJob()
    largestThreadSizeAtTime()

Worker(ns, portNum, id)
    addJob()

ServerPool(ns, scriptRam)
    smallestServersWithThreads()
    largestServer()
    deploy()
```


