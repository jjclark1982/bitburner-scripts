import type { NS, NetscriptPort } from '@ns';
import type ReactNamespace from 'react/index';
import type ReactDomNamespace from 'react-dom';
const React = globalThis.React as typeof ReactNamespace;
const ReactDOM = globalThis.ReactDOM as typeof ReactDomNamespace;

// ----- constants ----- 

type TimeMs = ReturnType<typeof performance.now> & { __dimension: "time" };
type TimeSeconds = number & { __dimension: "time", __units: "seconds" };
type TimePixels = number & { __dimension: "time", __units: "pixels" };
type Pixels = number & { __units: "pixels" };

let initTime = performance.now() as TimeMs;
/**
 * Convert timestamps to seconds since the graph was started.
 * To render SVGs using native time units, the values must be valid 32-bit ints.
 * So we convert to a recent epoch in case Date.now() values are used.
 */
function convertTime(t: TimeMs, t0=initTime): TimeSeconds {
    return ((t - t0) / 1000) as TimeSeconds;
}

function convertSecToPx(t: TimeSeconds): TimePixels {
    return t * WIDTH_PIXELS / WIDTH_SECONDS as TimePixels;
}

const GRAPH_COLORS = {
    "hack": "cyan",
    "grow": "lightgreen",
    "weaken": "yellow",
    "cancelled": "red",
    "desync": "magenta",
    "safe": "#111",
    "unsafe": "#333",
    "security": "red",
    "money": "blue"
};

const WIDTH_PIXELS = 800 as TimePixels;
const WIDTH_SECONDS = 16 as TimeSeconds;
const HEIGHT_PIXELS = 600 as Pixels;
const FOOTER_PIXELS = 50 as Pixels;

// ----- main -----

const FLAGS: [string, string | number | boolean | string[]][] = [
    ["help", false],
    ["port", 0]
];

export function autocomplete(data: any, args: string[]) {
    data.flags(FLAGS);
    return [];
}

/** @param {NS} ns **/
export async function main(ns: NS) {
    ns.disableLog('sleep');
    ns.clearLog();
    ns.tail();

    const flags = ns.flags(FLAGS);
    if (flags.help) {
        ns.tprint([
            `USAGE`,
            `> run ${ns.getScriptName()} --port 1`,
            ' '
        ].join("\n"));
        return;
    }

    const portNum = flags.port as number || ns.pid;
    const port = ns.getPortHandle(portNum);
    port.clear();

    const graphEl = <GraphFrame ns={ns}>
        <GraphData port={port} />
    </GraphFrame>;
    ns.printRaw(graphEl);

    ns.print(`Listening on Port ${portNum}`);
    while (true) {
        await port.nextWrite();
    }
}

function GraphFrame({ns, children}:{ns:NS, children: React.ReactNode}): React.ReactElement {
    const [now, setNow] = React.useState(performance.now());
    const requestRef = React.useRef<number>();
    React.useEffect(() => {
        ns.atExit(()=>cancelAnimationFrame(requestRef.current as number));
        const animate = ()=>{
            setNow(performance.now());
            requestRef.current = requestAnimationFrame(animate);
        };
        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current as number);
      }, []); // Make sure the effect runs only once
  

    return (
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg"
            width={WIDTH_PIXELS}
            height={HEIGHT_PIXELS} 
            // Set the viewBox for 10 seconds of history, 6 seconds of future.
            viewBox={`${convertSecToPx(-10 as TimeSeconds)} 0 ${WIDTH_PIXELS} ${HEIGHT_PIXELS}`}
        >
            <defs>
                <clipPath id={`hide-future-${ns.pid}`} clipPathUnits="userSpaceOnUse">
                    <rect id="hide-future-rect"
                        x={convertTime(now-60000 as TimeMs)}
                        width={convertTime(60000 as TimeMs, 0 as TimeMs)}
                        y={0}
                        height={50}
                    />
                </clipPath>
            </defs>
            <rect id="background" x={convertSecToPx(-10 as TimeSeconds)} width="100%" height="100%" fill={GRAPH_COLORS.safe} />
            <g id="timeCoordinates" transform={`scale(${WIDTH_PIXELS / WIDTH_SECONDS} 1) translate(${convertTime(initTime-now as TimeMs, 0 as TimeMs)} 0)`}>
                {children}
            </g>
            {
                // ["rect", {id:"divider-1", x:convertSecToPx(-10), width:"100%", y:HEIGHT_PIXELS-FOOTER_PIXELS, height:1, fill: "white"}],
                // ["rect", {id:"divider-2", x:convertSecToPx(-10), width:"100%", y:HEIGHT_PIXELS-2*FOOTER_PIXELS, height:1, fill: "white"}],
            }
            <rect id="cursor" x={0} width={1} y={0} height="100%" fill="white" />
            <GraphLegend />
        </svg>
    );
}

function GraphLegend(): React.ReactElement {
    return (
        <g id="Legend" transform="translate(-490, 10), scale(.5, .5)">
            <rect x={1} y={1} width={275} height={392} fill="black" stroke="#979797" />
            {Object.entries(GRAPH_COLORS).map(([label, color], i)=>(
                <g transform={`translate(22, ${13 + 41*i})`}>
                    <rect x={0} y={0} width={22} height={22} fill={color} />
                    <text fontFamily="Courier New" fontSize={36} fill="#888">
                        <tspan x={42.5} y={30}>{label.substring(0,1).toUpperCase()+label.substring(1)}</tspan>
                    </text>
                </g>
            ))}
        </g>
    );
}

function GraphData({port}:{port:NetscriptPort}) {
    const jobIDs = React.useRef<Array<string | number>>([]);
    const jobs = React.useRef<Map<string | number, Job>>(new Map());
    const [lastUpdate, setLastUpdate] = React.useState(performance.now())
    const [reRender, setReRender] = React.useState(false);
    React.useEffect(()=>{
        let isMounted = true;
        const readPort = ()=>{
            if (!isMounted) return;
            port.nextWrite().then(readPort);
            if (port.empty()) return;
            let job = JSON.parse(port.read() as string);
            if (jobs.current.has(job.id)) {
                job = Object.assign(jobs.current.get(job.id) as Partial<Job>, job);
            }
            else {
                jobIDs.current.push(job.id);
                jobs.current.set(job.id, job);
            }
            setLastUpdate(performance.now());
        };
        port.nextWrite().then(readPort);
        return ()=>{isMounted = false};
    }, []);
    const displayJobs = [...jobs.current.values()];
    if (displayJobs.length > 125) {
        displayJobs.splice(0, -100);
    }

    return (
        <>
            <g id="safetyLayer" />
            <JobLayer jobs={displayJobs} />
            {/* <g id="jobLayer"><rect x={0} y={200} width={5} height={10} fill="cyan" /></g> */}
            <g id="secLayer" />
            <g id="moneyLayer" />
        </>
    );
}


/**
 * Job
 */
interface Job {
    id: string | number;
    task: "hack" | "grow" | "weaken";
    duration: number;
    startTime: number;
    startTimeActual: number;
    endTime: number;
    endTimeActual: number;
    cancelled: boolean;
    result: {
        hackDifficulty: number;
        minDifficulty: number;
    };
    resultActual: number;
    change: {
        playerMoney: number;
    };
}

/**
 * renderBatches - create an SVG element with a graph of jobs
 * @param {SVGSVGElement} [el] - SVG element to reuse. Will be created if it does not exist yet.
 * @param {Job[][]} batches - array of arrays of jobs
 * @param {number} [now] - current time (optional)
 * @returns {SVGSVGElement}
 */
export function renderBatches(el: HTMLElement, batches=[], serverSnapshots=[], now: TimeMs) {
    now ||= performance.now() as TimeMs;

    // Render the main SVG element if needed
    el ||= svgEl(
        "svg",
        {
            version: "1.1", width:WIDTH_PIXELS, height: HEIGHT_PIXELS,
            // Set the viewBox for 10 seconds of history, 6 seconds of future.
            viewBox: `${convertSecToPx(-10)} 0 ${WIDTH_PIXELS} ${HEIGHT_PIXELS}`
        },
        [
            ["defs", {}, [
                ["clipPath", {id:`hide-future-${initTime}`, clipPathUnits: "userSpaceOnUse"}, [
                    ["rect", {id:"hide-future-rect", x:convertTime(now-60000), width:convertTime(60000,0), y:0, height: 50}]
                ]]
            ]],
            // ["rect", {id:"background", x:convertSecToPx(-10), width:"100%", height:"100%", fill:GRAPH_COLORS.safe}],
            ["g", {id:"timeCoordinates"}, [
                ["g", {id:"safetyLayer"}],
                ["g", {id:"jobLayer"}],
                ["g", {id:"secLayer"}],
                ["g", {id:"moneyLayer"}]
            ]],
            // ["rect", {id:"divider-1", x:convertSecToPx(-10), width:"100%", y:HEIGHT_PIXELS-FOOTER_PIXELS, height:1, fill: "white"}],
            // ["rect", {id:"divider-2", x:convertSecToPx(-10), width:"100%", y:HEIGHT_PIXELS-2*FOOTER_PIXELS, height:1, fill: "white"}],
            ["rect", {id:"cursor", x:0, width:1, y:0, height: "100%", fill: "white"}],
            renderLegend()
        ]
    );

    // Update the time coordinates every frame
    const dataEl = el.getElementById("timeCoordinates");
    dataEl.setAttribute('transform',
        `scale(${WIDTH_PIXELS / WIDTH_SECONDS} 1) translate(${convertTime(initTime-now, 0)} 0)`
    );
    el.getElementById("hide-future-rect").setAttribute('x', convertTime(now-60000));
    
    // Only update the main data every 250 ms
    const lastUpdate = dataEl.getAttribute('data-last-update') || 0;
    if (now - lastUpdate < 250) {
        return el;
    }
    dataEl.setAttribute('data-last-update', now);

    const eventSnapshots = batches.flat().map((job)=>(
        [job.endTime, job.result]
    ));
    
    // Render each job background and foreground
    while(dataEl.firstChild) {
        dataEl.removeChild(dataEl.firstChild);
    }
    dataEl.appendChild(renderSafetyLayer(batches, now));
    dataEl.appendChild(renderJobLayer(batches, now));
    dataEl.appendChild(renderSecurityLayer(eventSnapshots, serverSnapshots, now));
    // dataEl.appendChild(renderMoneyLayer(eventSnapshots, serverSnapshots, now));
    dataEl.appendChild(renderProfitLayer(batches, now));

    return el;
}

function renderSecurityLayer(eventSnapshots=[], serverSnapshots=[], now) {
    let minSec = 0;
    let maxSec = 1;
    for (const snapshots of [eventSnapshots, serverSnapshots]) {
        for (const [time, server] of snapshots) {
            minSec = Math.min(minSec, server.hackDifficulty);
            maxSec = Math.max(maxSec, server.hackDifficulty);
        }
    }

    const observedLayer = svgEl(
        "g", {
            id: "observedSec",
            transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxSec - minSec)})`,
            fill: "dark"+GRAPH_COLORS.security,
            // "fill-opacity": 0.5,
            "clip-path": `url(#hide-future-${initTime})`
        }, [
            renderObservedPath("hackDifficulty", serverSnapshots, minSec, now)
        ]
    );

    const projectedLayer = svgEl(
        "g", {
            id: "projectedSec",
            transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxSec - minSec)})`,
            stroke: GRAPH_COLORS.security,
            fill: "none",
            "stroke-width": 2,
            "stroke-linejoin":"bevel"
        }, [
            renderProjectedPath("hackDifficulty", eventSnapshots, now)
        ]
    );

    const secLayer = svgEl("g", {
            id: "secLayer",
            transform: `translate(0 ${HEIGHT_PIXELS - 2*FOOTER_PIXELS})`
        }, [
            observedLayer,
            projectedLayer
        ]
    );

    return secLayer;
}

function renderObservedPath(property="hackDifficulty", serverSnapshots=[], minValue=0, now, scale=1) {
    const pathData = [];
    let prevServer;
    let prevTime;
    for (const [time, server] of serverSnapshots) {
        if (time < now-(WIDTH_SECONDS*2*1000)) {
            continue;
        }
        // fill area under actual security
        if (!prevServer) {
            // start at bottom left
            pathData.push(`M ${convertTime(time).toFixed(3)},${(minValue*scale).toFixed(2)}`);
        }
        if (prevServer) {
            // vertical line to previous level
            // horizontal line to current time
            pathData.push(`V ${(prevServer[property]*scale).toFixed(2)}`, `H ${convertTime(time).toFixed(3)}`);
        }
        prevServer = server;
        prevTime = time;
    }
    // fill in area between last snapshot and "now" cursor
    if (prevServer) {
        // vertical line to previous level
        // horizontal line to current time
        pathData.push(`V ${(prevServer[property]*scale).toFixed(2)}`, `H ${convertTime(now + 60000).toFixed(3)}`);
    }
    pathData.push(`V ${minValue} Z`);
    return svgEl('path', {
        d: pathData.join(' ')
    });
}

function renderProjectedPath(property="hackDifficulty", eventSnapshots=[], now, scale=1) {
    const pathData = [];
    let prevTime;
    let prevServer;
    for (const [time, server] of eventSnapshots) {
        if (time < now-(WIDTH_SECONDS*2*1000)) {
            continue;
        }
        if (!prevServer) {
            // start line at first projected time and value
            pathData.push(`M ${convertTime(time).toFixed(3)},${(server[property]*scale).toFixed(2)}`);
        }
        if (prevServer && time > prevTime) {
            // vertical line to previous value
            // horizontal line from previous time to current time
            pathData.push(`V ${(prevServer[property]*scale).toFixed(2)}`, `H ${convertTime(time).toFixed(3)}`);
        }
        prevTime = time;
        prevServer = server;
    }
    if (prevServer) {
        // vertical line to previous value
        // horizontal line from previous time to future
        pathData.push(`V ${(prevServer[property]*scale).toFixed(2)}`, `H ${convertTime(now + 60000).toFixed(3)}`);
    }
    return svgEl('path', {
        d: pathData.join(' '),
        "vector-effect": "non-scaling-stroke"
    });
}

function renderProfitPath(batches=[], now, scale=1) {
    // would like to graph money per second over time
    // const moneyTaken = [];
    const totalMoneyTaken = [];
    let runningTotal = 0;
    for (const batch of batches) {
        for (const job of batch) {
            if (job.task == 'hack' && job.endTimeActual) {
                // moneyTaken.push([job.endTimeActual, job.resultActual]);
                runningTotal += job.resultActual;
                totalMoneyTaken.push([job.endTimeActual, runningTotal]);
            }
            else if (job.task == 'hack' && !job.cancelled) {
                runningTotal += job.change.playerMoney;
                totalMoneyTaken.push([job.endTime, runningTotal]);
            }
        }
    }
    totalMoneyTaken.push([now + 30000, runningTotal]);
    // money taken in the last X seconds could be counted with a sliding window.
    // but the recorded events are not evenly spaced.
    const movingAverage = [];
    let maxProfit = 0;
    let j = 0;
    for (let i = 0; i < totalMoneyTaken.length; i++) {
        const [time, money] = totalMoneyTaken[i];
        while (totalMoneyTaken[j][0] <= time - 2000) {
            j++;
        }
        const profit = totalMoneyTaken[i][1] - totalMoneyTaken[j][1];
        movingAverage.push([time, profit]);
        maxProfit = Math.max(maxProfit, profit);
    }
    eval("window").profitData = [totalMoneyTaken, runningTotal, movingAverage];
    const pathData = ["M 0,0"];
    let prevTime;
    let prevProfit;
    for (const [time, profit] of movingAverage) {
        // pathData.push(`L ${convertTime(time).toFixed(3)},${(scale * profit/maxProfit).toFixed(3)}`);
        if (prevProfit) {
            pathData.push(`C ${convertTime((prevTime*3 + time)/4).toFixed(3)},${(scale * prevProfit/maxProfit).toFixed(3)} ${convertTime((prevTime + 3*time)/4).toFixed(3)},${(scale * profit/maxProfit).toFixed(3)} ${convertTime(time).toFixed(3)},${(scale * profit/maxProfit).toFixed(3)}`)
        }
        prevTime = time;
        prevProfit = profit;
    }
    pathData.push(`H ${convertTime(now+60000).toFixed(3)} V 0 Z`);
    return svgEl('path', {
        d: pathData.join(' '),
        "vector-effect": "non-scaling-stroke"
    });
}

function renderProfitLayer(batches=[], now) {
    const profitPath = renderProfitPath(batches, now);
    const observedProfit = svgEl(
        "g", {
            id: "observedProfit",
            transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS})`,
            fill: "dark"+GRAPH_COLORS.money,
            "clip-path": `url(#hide-future-${initTime})`
        }, [
            profitPath
        ]
    );
    const projectedProfit = svgEl(
        "g", {
            id: "projectedProfit",
            transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS})`,
            fill: "none",
            stroke: GRAPH_COLORS.money,
            "stroke-width": 2,
            "stroke-linejoin":"round"
        }, [
            profitPath.cloneNode()
        ]
    );
    const profitLayer = svgEl(
        "g", {
            id: "profitLayer",
            transform: `translate(0 ${HEIGHT_PIXELS - FOOTER_PIXELS})`
        }, [
            observedProfit,
            projectedProfit
        ]
    );
    return profitLayer;
}

function renderMoneyLayer(eventSnapshots=[], serverSnapshots=[], now) {
    const moneyLayer = svgEl("g", {
        id: "moneyLayer",
        transform: `translate(0 ${HEIGHT_PIXELS - FOOTER_PIXELS})`
    });

    if (serverSnapshots.length == 0) {
        return moneyLayer;
    }
    let minMoney = 0;
    let maxMoney = serverSnapshots[0][1].moneyMax;
    const scale = 1/maxMoney;
    maxMoney *= 1.1

    const observedLayer = svgEl(
        "g", {
            id: "observedMoney",
            transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxMoney - minMoney) / scale})`,
            fill: "dark"+GRAPH_COLORS.money,
            // "fill-opacity": 0.5,
            "clip-path": `url(#hide-future-${initTime})`
        }, [
            renderObservedPath("moneyAvailable", serverSnapshots, minMoney, now, scale)
        ]
    );
    moneyLayer.append(observedLayer);

    const projectedLayer = svgEl(
        "g", {
            id: "projectedMoney",
            transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxMoney - minMoney) / scale})`,
            stroke: GRAPH_COLORS.money,
            fill: "none",
            "stroke-width": 2,
            "stroke-linejoin":"bevel"
        }, [
            renderProjectedPath("moneyAvailable", eventSnapshots, now, scale)
        ]
    );
    moneyLayer.append(projectedLayer);

    return moneyLayer;
}

function renderSafetyLayer(batches=[], now) {
    const safetyLayer = svgEl('g', {id:"safetyLayer"});

    let prevJob;    
    for (const batch of batches) {
        for (const job of batch) {
            if ((job.endTimeActual || job.endTime) < now-(WIDTH_SECONDS*2*1000)) {
                continue;
            }

            // shade the background based on secLevel
            if (prevJob && job.endTime > prevJob.endTime) {
                safetyLayer.appendChild(svgEl('rect', {
                    x: convertTime(prevJob.endTime), width: convertTime(job.endTime - prevJob.endTime, 0),
                    y: 0, height: "100%",
                    fill: (prevJob.result.hackDifficulty > prevJob.result.minDifficulty) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe
                }));
            }
            prevJob = job;
        }
    }
    if (prevJob) {
        safetyLayer.appendChild(svgEl('rect', {
            x: convertTime(prevJob.endTime), width: convertTime(10000, 0),
            y: 0, height: "100%",
            fill: (prevJob.result.hackDifficulty > prevJob.result.minDifficulty) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe
        }));
    }
    return safetyLayer;
}

function JobLayer({jobs}: {jobs: Job[]}) {
    const now = performance.now() as TimeMs;
    return (
        <g id="jobLayer">
            {jobs.map((job: Job, i)=>{
                i = (i + 1) % ((HEIGHT_PIXELS - FOOTER_PIXELS*2) / 4);
                if ((job.endTimeActual ?? job.endTime) < now-(WIDTH_SECONDS*2*1000) || !job.task) {
                    return null;
                }
                // draw the job bars
                const color = job.cancelled ? GRAPH_COLORS.cancelled : GRAPH_COLORS[job.task];
                return (<rect
                    x={convertTime(job.startTime)} width={convertTime(job.duration, 0)}
                    y={i*4} height={2}
                    fill={color}
                />);
                // draw the error bars
                if (job.startTimeActual) {
                    const [t1, t2] = [job.startTime, job.startTimeActual].sort((a,b)=>a-b);
                    jobLayer.appendChild(svgEl('rect', {
                        x: convertTime(t1), width: convertTime(t2-t1, 0),
                        y: i*4, height: 1,
                        fill: GRAPH_COLORS.desync
                    }));
                }
                if (job.endTimeActual) {
                    const [t1, t2] = [job.endTime, job.endTimeActual].sort((a,b)=>a-b);
                    jobLayer.appendChild(svgEl('rect', {
                        x: convertTime(t1), width: convertTime(t2-t1, 0),
                        y: i*4, height: 1,
                        fill: GRAPH_COLORS.desync
                    }));
                }
            })}
        </g>
    );
}

function renderJobLayer(batches=[], now) {
    const jobLayer = svgEl('g', {id:"jobLayer"});

    let i = 0;
    for (const batch of batches) {
        for (const job of batch) {
            i = (i + 1) % ((HEIGHT_PIXELS - FOOTER_PIXELS*2) / 4);
            if ((job.endTimeActual || job.endTime) < now-(WIDTH_SECONDS*2*1000)) {
                continue;
            }
            // draw the job bars
            let color = GRAPH_COLORS[job.task];
            if (job.cancelled) {
                color = GRAPH_COLORS.cancelled;
            }
            jobLayer.appendChild(svgEl('rect', {
                x: convertTime(job.startTime), width: convertTime(job.duration, 0),
                y: i*4, height: 2,
                fill: color
            }));
            // draw the error bars
            if (job.startTimeActual) {
                const [t1, t2] = [job.startTime, job.startTimeActual].sort((a,b)=>a-b);
                jobLayer.appendChild(svgEl('rect', {
                    x: convertTime(t1), width: convertTime(t2-t1, 0),
                    y: i*4, height: 1,
                    fill: GRAPH_COLORS.desync
                }));
            }
            if (job.endTimeActual) {
                const [t1, t2] = [job.endTime, job.endTimeActual].sort((a,b)=>a-b);
                jobLayer.appendChild(svgEl('rect', {
                    x: convertTime(t1), width: convertTime(t2-t1, 0),
                    y: i*4, height: 1,
                    fill: GRAPH_COLORS.desync
                }));
            }
        }
        // space between batches
        i++;
    }
    return jobLayer;
}

function renderLegend() {
    const legendEl = svgEl('g',
        {id: "Legend", transform: "translate(-480, 10), scale(.5, .5)"},
        [['rect', {x: 1, y: 1, width: 275, height: 392, fill: "black", stroke: "#979797"}]]
    );
    let y = 13;
    for (const [label, color] of Object.entries(GRAPH_COLORS)) {
        legendEl.appendChild(svgEl('g', {transform: `translate(22, ${y})`}, [
            ['rect', {x:0, y:10, width: 22, height: 22, fill: color}],
            ['text', {"font-family":"Courier New", "font-size":36, fill: "#888"}, [
                ['tspan', {x:42.5, y:30}, [label.substring(0,1).toUpperCase()+label.substring(1)]]
            ]]
        ]));
        y += 41;
    }
    return legendEl;
}

/* ---------- library functions ---------- */

/** Create an SVG Element that can be displayed in the DOM. */
function svgEl(tagName, attributes={}, children=[]) {
    const doc = eval("document");
    const xmlns = 'http://www.w3.org/2000/svg';
    const el = doc.createElementNS(xmlns, tagName);
    // support exporting outerHTML
    if (tagName.toLowerCase() == 'svg') {
        attributes['xmlns'] = xmlns;
    }
    // set all attributes
    for (const [name, val] of Object.entries(attributes)) {
        el.setAttribute(name, val);
    }
    // append all children
    for (let child of children) {
        // recursively construct child elements
        if (Array.isArray(child)) {
            child = svgEl(...child);
        }
        else if (typeof(child) == 'string') {
            child = doc.createTextNode(child);
        }
        el.appendChild(child);
    }
    return el;
}

/** Insert an element into the netscript process's tail window. */
export function logHTML(ns, el) {
    ns.tail();
    const doc = eval('document');
    const command = ns.getScriptName() + ' ' + ns.args.join(' ');
    const logEl = doc.querySelector(`[title="${command}"]`).parentElement.nextElementSibling.querySelector('span');
    logEl.appendChild(el);
}

/* ----- */

