## HVMind Distributed Computing System

This is a [grid computing](https://en.wikipedia.org/wiki/Grid_computing) system that dispatches tasks to long-lived worker processes running in the cloud.

The system is controlled through a `ThreadPool` process which launches `Worker` processes on-demand and communicates with them through a [Netscript Port](https://bitburner.readthedocs.io/en/latest/netscript/netscriptmisc.html#netscript-ports). The processes can connect to each other after being launched in any order, including reloading from save

<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xl="http://www.w3.org/1999/xlink" viewBox="124.828 206 760.672 342.5" width="760.672" height="342.5">
  <defs>
    <font-face font-family="Helvetica Neue" font-size="16" panose-1="2 0 5 3 0 0 0 2 0 4" units-per-em="1000" underline-position="-100" underline-thickness="50" slope="0" x-height="517" cap-height="714" ascent="951.9958" descent="-212.99744" font-weight="400">
      <font-face-src>
        <font-face-name name="HelveticaNeue"/>
      </font-face-src>
    </font-face>
  </defs>
  <metadata> Produced by OmniGraffle 7.19.2\n2022-04-06 04:46:43 +0000</metadata>
  <g id="Canvas_1" stroke="none" stroke-opacity="1" stroke-dasharray="none" fill="none" fill-opacity="1">
    <title>Canvas 1</title>
    <rect fill="white" x="124.828" y="206" width="760.672" height="342.5"/>
    <g id="Canvas_1_Layer_1">
      <title>Layer 1</title>
      <g id="Graphic_4">
        <text transform="translate(144.5 490.026)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="0" y="15">Server Pool</tspan>
        </text>
      </g>
      <g id="Graphic_5">
        <text transform="translate(142.708 408.526)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="0" y="15">Thread Pool</tspan>
        </text>
      </g>
      <g id="Graphic_6">
        <rect x="398.6" y="458.5" width="119.6" height="81.5" fill="white"/>
        <rect x="398.6" y="458.5" width="119.6" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(403.6 490.026)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="32.128" y="15">64 GB</tspan>
        </text>
      </g>
      <g id="Graphic_7">
        <rect x="518.2" y="458.5" width="119.6" height="81.5" fill="white"/>
        <rect x="518.2" y="458.5" width="119.6" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(523.2 490.026)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="32.128" y="15">64 GB</tspan>
        </text>
      </g>
      <g id="Graphic_8">
        <rect x="279" y="458.5" width="59.8" height="81.5" fill="white"/>
        <rect x="279" y="458.5" width="59.8" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(284 490.026)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="2.2279996" y="15">32 GB</tspan>
        </text>
      </g>
      <g id="Graphic_9">
        <rect x="338.8" y="458.5" width="59.8" height="81.5" fill="white"/>
        <rect x="338.8" y="458.5" width="59.8" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(343.8 490.026)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="2.2279996" y="15">32 GB</tspan>
        </text>
      </g>
      <g id="Graphic_10">
        <rect x="637.8" y="458.5" width="239.2" height="81.5" fill="white"/>
        <rect x="637.8" y="458.5" width="239.2" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(642.8 490.026)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="87.48" y="15">128 GB</tspan>
        </text>
      </g>
      <g id="Graphic_11">
        <rect x="279" y="377" width="59.8" height="81.5" fill="white"/>
        <rect x="279" y="377" width="59.8" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(284 408.526)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="16.004" y="15">16</tspan>
        </text>
      </g>
      <g id="Graphic_16">
        <rect x="338.8" y="377" width="59.8" height="81.5" fill="white"/>
        <rect x="338.8" y="377" width="59.8" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(343.8 408.526)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="16.004" y="15">16</tspan>
        </text>
      </g>
      <g id="Graphic_17">
        <rect x="398.6" y="377" width="119.6" height="81.5" fill="white"/>
        <rect x="398.6" y="377" width="119.6" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(403.6 408.526)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="45.904" y="15">32</tspan>
        </text>
      </g>
      <g id="Graphic_22">
        <text transform="translate(137.828 327.026)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="0" y="15">Task Manager</tspan>
        </text>
      </g>
      <g id="Graphic_23">
        <rect x="279" y="295.5" width="29.9" height="81.5" fill="white"/>
        <rect x="279" y="295.5" width="29.9" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(284 317.802)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="4.174" y="15">H</tspan>
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="5.502" y="33.448">8</tspan>
        </text>
      </g>
      <g id="Graphic_24">
        <rect x="398.6" y="295.5" width="104.9" height="81.5" fill="white"/>
        <rect x="398.6" y="295.5" width="104.9" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(403.6 317.802)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="40.042" y="15">W</tspan>
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="38.554" y="33.448">30</tspan>
        </text>
      </g>
      <g id="Graphic_25">
        <rect x="518.2" y="377" width="119.6" height="81.5" fill="white"/>
        <rect x="518.2" y="377" width="119.6" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(523.2 408.526)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="45.904" y="15">32</tspan>
        </text>
      </g>
      <g id="Graphic_26">
        <rect x="518.2" y="295.5" width="104.9" height="81.5" fill="white"/>
        <rect x="518.2" y="295.5" width="104.9" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(523.2 317.802)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="40.042" y="15">W</tspan>
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="38.554" y="33.448">30</tspan>
        </text>
      </g>
      <g id="Graphic_27">
        <rect x="338.8" y="295.5" width="29.9" height="81.5" fill="white"/>
        <rect x="338.8" y="295.5" width="29.9" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(343.8 317.802)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="3.878" y="15">G</tspan>
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="1.0539998" y="33.448">10</tspan>
        </text>
      </g>
      <g id="Graphic_34">
        <text transform="translate(160.652 245.526)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="0" y="15">Planner</tspan>
        </text>
      </g>
      <g id="Graphic_35">
        <text transform="translate(284 245.526)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="2.88" y="15">H(8) + W(30) + G(10) + W(30)</tspan>
        </text>
      </g>
      <g id="Graphic_37">
        <rect x="637.8" y="377" width="104.9" height="81.5" fill="white"/>
        <rect x="637.8" y="377" width="104.9" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(642.8 408.526)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="38.554" y="15">30</tspan>
        </text>
      </g>
      <g id="Graphic_38">
        <rect x="742.7" y="377" width="104.9" height="81.5" fill="white"/>
        <rect x="742.7" y="377" width="104.9" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(747.7 408.526)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="38.554" y="15">30</tspan>
        </text>
      </g>
      <g id="Graphic_39">
        <rect x="847.1" y="377" width="29.9" height="81.5" fill="white"/>
        <rect x="847.1" y="377" width="29.9" height="81.5" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
        <text transform="translate(852.1 408.526)" fill="black">
          <tspan font-family="Helvetica Neue" font-size="16" font-weight="400" fill="black" x="5.502" y="15">8</tspan>
        </text>
      </g>
    </g>
  </g>
</svg>

Users can run jobs by calling `threadPool.dispatchJob(job)`,
where a job is an object with fields: `{ task, args, threads, duration, startTime, endTime }`. For example:

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


