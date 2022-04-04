## HVMind Distributed Computing System

This is a [grid computing](https://en.wikipedia.org/wiki/Grid_computing) system
that dispatches tasks to long-lived worker processes running in the cloud.

The system is controlled through a `ThreadPool` process which launches `Worker` processes on-demand and communicates with them through a [Netscript Port](https://bitburner.readthedocs.io/en/latest/netscript/netscriptmisc.html#netscript-ports). The processes should be able to connect to each other after being launched in any order, including reloading from save.

Users can run tasks by calling `threadPool.dispatchJob(job)`,
where a job is an object with fields: `{ task, args, threads, duration, startTime, endTime }`. For example:

```JavaScript
{
    task: 'hack',
    args: ['foodnstuff']
    threads: 100,
    duration: 1000,
    startTime: 1649093514728, // starts immediately if omitted
    endTime:   1649093515728
}
```
When the task runs, this object will be updated with `actualStartTime` and `actualEndTime`. Other fields (such as expected results) will be preserved, so a user can measure 

---

### Installation

Copy these scripts:
```
/lib/box-drawing.js
/net/server-pool.js
/hvmind/thread-pool.js
/hvmind/worker.js
/hvmind/manager.js
```

> TODO: remove dependency on `/batch/analyze.js`

### Usage

Start the thread pool:
```
> run /hvmind/thread-pool.js --tail
```

Run an application on the pool:
```
> run /hvmind/manager.js foodnstuff
```

---

### Design notes

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
