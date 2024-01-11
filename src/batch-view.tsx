/*

Usage
-----

Start the batch viewer script from the command line:

    run batch-view.js --port 10

Then send messages to it from other scripts.

Example: Display action timing (hack / grow / weaken)

    ns.writePort(10, JSON.stringify({
        type: 'hack',
        jobID: 1,
        startTime: performance.now(),
        duration: ns.getHackTime(target),
    }));

Example: Update an action that has already been displayed

    ns.writePort(10, JSON.stringify({
        jobID: 1,
        startTimeActual: performance.now(),
    }));
    await ns.hack(target);
    ns.writePort(10, JSON.stringify({
        jobID: 1,
        endTimeActual: performance.now(),
    }));

Example: Display a blank row between actions (to visually separate batches)

    ns.writePort(10, JSON.stringify({
        type: 'spacer',
    }));

Example: Display observed security / money level

    ns.writePort(10, JSON.stringify({
        type: 'observed',
        time: performance.now(),
        minDifficulty: ns.getServerMinSecurityLevel(target),
        hackDifficulty: ns.getServerSecurityLevel(target),
        moneyMax: ns.getServerMaxMoney(target),
        moneyAvailable: ns.getServerMoneyAvailable(target),
    }));

Example: Display expected security / money level (varies by action type and your strategy)

    ns.writePort(10, JSON.stringify({
        type: 'expected',
        time: job.startTime + job.duration,
        minDifficulty: ns.getServerMinSecurityLevel(target),
        hackDifficulty: ns.getServerSecurityLevel(target) + ns.hackAnalyzeSecurity(job.threads),
        moneyMax: ns.getServerMaxMoney(target),
        moneyAvailable: Math.max(0, ns.getServerMaxMoney(target) - ns.hackAnalyze(target) * job.threads * ns.hackAnalyzeChance(target)),
    }));

*/

import type { NS, NetscriptPort, Server } from '@ns';
import type ReactNamespace from 'react/index';
const React = globalThis.React as typeof ReactNamespace;

// ----- constants ----- 

type TimeMs = ReturnType<typeof performance.now> & { __dimension: "time", __units: "milliseconds" };
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
// TODO: use a context for these scale factors. support setting them by args and scroll-gestures.
// const ScreenContext = React.createContext({WIDTH_PIXELS, WIDTH_SECONDS, HEIGHT_PIXELS, FOOTER_PIXELS});
// TODO: review use of 600000, 60000, and WIDTH_SECONDS as clipping limits.


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
    ns.resizeTail(810, 640);

    const flags = ns.flags(FLAGS);
    if (flags.help) {
        ns.tprint([
            `USAGE`,
            `> run ${ns.getScriptName()} --port 10`,
            ' '
        ].join("\n"));
        return;
    }

    const portNum = flags.port as number || ns.pid;
    const port = ns.getPortHandle(portNum);
    // port.clear();
    ns.print(`Listening on Port ${portNum}`);

    const batchView = <BatchView ns={ns} portNum={portNum} />;
    ns.printRaw(batchView);

    while (true) {
        await port.nextWrite();
    }
}

// ----- BatchView -----

type JobID = number | string;
interface ActionMessage {
    type: "hack" | "grow" | "weaken";
    jobID?: JobID;
    duration: TimeMs;
    startTime: TimeMs;
    startTimeActual?: TimeMs;
    endTime?: TimeMs;
    endTimeActual?: TimeMs;
    cancelled?: boolean;
    result?: number;
}
interface SpacerMessage {
    type: "spacer"
}
interface ServerMessage {
    type: "expected" | "observed";
    time: TimeMs;
    hackDifficulty: number;
    minDifficulty: number;
    moneyAvailable: number;
    moneyMax: number;
}
type ExpectedServerMessage = ServerMessage & {
    type: "expected"
}
type ObservedServerMessage = ServerMessage & {
    type: "observed"
}
type BatchViewMessage = ActionMessage | SpacerMessage | ServerMessage;

type Job = ActionMessage & {
    rowID: number
}

interface BatchViewProps {
    ns: NS;
    portNum: number;
}
interface BatchViewState {
    running: boolean;
    now: TimeMs;
}
export class BatchView extends React.Component<BatchViewProps, BatchViewState> {
    port: NetscriptPort;
    jobs: Map<string | number, Job>;
    sequentialRowID: number = 0;
    sequentialJobID: number = 0;
    expectedServers: ExpectedServerMessage[];
    observedServers: ObservedServerMessage[];

    constructor(props: BatchViewProps){
        super(props);
        const { ns, portNum } = props;
        this.state = {
            running: true,
            now: performance.now() as TimeMs
        };
        this.port = ns.getPortHandle(portNum);
        this.jobs = new Map();
        this.expectedServers = [];
        this.observedServers = [];
    }

    componentDidMount() {
        const { ns } = this.props;
        this.setState({running: true});
        ns.atExit(()=>{
            this.setState({running: false});
        });
        this.readPort();
        this.animate();
        // Object.assign(globalThis, {batchView: this});
    }

    componentWillUnmount() {
        this.setState({running: false});
    }

    readPort = ()=>{
        if (!this.state.running) return;
        while(!this.port.empty()) {
            const msg: BatchViewMessage = JSON.parse(this.port.read() as string);
            this.receiveMessage(msg);
        }
        this.port.nextWrite().then(this.readPort);
    }

    receiveMessage(msg: BatchViewMessage) {
        if (msg.type == "spacer") {
            this.sequentialRowID += 1;
        }
        else if (msg.type == "expected") {
            this.expectedServers.push(msg);
            // TODO: sort by time and remove very old items
        }
        else if (msg.type == "observed") {
            this.observedServers.push(msg);
            // TODO: sort by time and remove very old items
        }
        else if (msg.jobID !== undefined || msg.type == 'hack' || msg.type == 'grow' || msg.type == 'weaken') {
            this.addJob(msg);
        }
    }

    addJob(msg: ActionMessage) {
        // assign sequential ID if needed
        let jobID = msg.jobID;
        if (jobID === undefined) {
            while (this.jobs.has(this.sequentialJobID)) {
                this.sequentialJobID += 1;
            }
            jobID = this.sequentialJobID;
        }
        // load existing data if present
        let job = this.jobs.get(jobID);
        if (job === undefined) {
            job = {
                jobID: jobID,
                rowID: this.sequentialRowID++
            } as Job;
        }
        // merge updates from message
        job = Object.assign(job, msg);
        this.jobs.set(msg.jobID, job);
        this.cleanJobs();
    }

    cleanJobs() {
        // filter out jobs with endtime in past
        if (this.jobs.size > 200) {
            for (const jobID of this.jobs.keys()) {
                const job = this.jobs.get(jobID) as Job;
                if ((job.endTimeActual ?? job.endTime) < this.state.now-(WIDTH_SECONDS*2*1000)) {
                    this.jobs.delete(jobID);
                }
            }
        }
    }

    animate = ()=>{
        if (!this.state.running) return;
        this.setState({now: performance.now() as TimeMs});
        requestAnimationFrame(this.animate);
    }

    render() {
        const displayJobs = [...this.jobs.values()]

        // const serverPredictions = displayJobs.map((job)=>(
        //     [job.endTime as TimeMs, job.serverAfter as Server] as ServerSnapshot
        // )).filter(([t, s])=>!!s).sort((a,b)=>a[0]-b[0]);
        // const serverObservations = displayJobs.map((job)=>(
        //     [job.startTime as TimeMs, job.serverBefore as Server] as ServerSnapshot
        // )).filter(([t, s])=>!!s).sort((a,b)=>a[0]-b[0]);
    
        return (
            <GraphFrame now={this.state.now}>
                <SafetyLayer expectedServers={this.expectedServers} />
                <JobLayer jobs={displayJobs} />
                <SecurityLayer expectedServers={this.expectedServers} observedServers={this.observedServers} />
                <MoneyLayer expectedServers={this.expectedServers} observedServers={this.observedServers} />
            </GraphFrame>
        )
    }
}

function GraphFrame({now, children}:{now:TimeMs, children: React.ReactNode}): React.ReactElement {
    // TODO: initTime is used as unique DOM ID and as rendering origin but it is poorly suited for both
    return (
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg"
            width={WIDTH_PIXELS}
            height={HEIGHT_PIXELS} 
            // Set the viewBox for 10 seconds of history, 6 seconds of future.
            viewBox={`${convertSecToPx(-10 as TimeSeconds)} 0 ${WIDTH_PIXELS} ${HEIGHT_PIXELS}`}
        >
            <defs>
                <clipPath id={`hide-future-${initTime}`} clipPathUnits="userSpaceOnUse">
                    <rect id="hide-future-rect"
                        x={convertTime(now-60000 as TimeMs)} width={convertTime(60000 as TimeMs, 0 as TimeMs)}
                        y={0} height={50}
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
                <g key={label} transform={`translate(22, ${13 + 41*i})`}>
                    <rect x={0} y={0} width={22} height={22} fill={color} />
                    <text fontFamily="Courier New" fontSize={36} fill="#888">
                        <tspan x={42.5} y={30}>{label.substring(0,1).toUpperCase()+label.substring(1)}</tspan>
                    </text>
                </g>
            ))}
        </g>
    );
}

function SafetyLayer({expectedServers}: {expectedServers: ExpectedServerMessage[]}): React.ReactNode {
    let prevServer: ExpectedServerMessage | undefined;
    return (
        <g id="safetyLayer">
            {expectedServers.map((server, i)=>{
                let el = null;
                // shade the background based on secLevel
                if (prevServer && server.time > prevServer.time) {
                    el = (<rect key={i}
                        x={convertTime(prevServer.time)} width={convertTime(server.time - prevServer.time, 0)}
                        y={0} height="100%"
                        fill={(prevServer.hackDifficulty > prevServer.minDifficulty) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe}
                    />);
                }
                prevServer = server;
                return el;
            })}
            {prevServer && (
                <rect key="remainder"
                    x={convertTime(prevServer.time)} width={convertTime(600000, 0)}
                    y={0} height="100%"
                    fill={(prevServer.hackDifficulty > prevServer.minDifficulty) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe}
                />
            )}
        </g>
    );
}

function JobLayer({jobs}: {jobs: Job[]}) {
    return (
        <g id="jobLayer">
            {jobs.map((job: Job)=>(<JobBar job={job} key={job.jobID} />))}
        </g>
    );
}

function JobBar({job}: {job: Job}): React.ReactNode {
    const y = ((job.rowID + 1) % ((HEIGHT_PIXELS - FOOTER_PIXELS*2) / 4)) * 4;
    let jobBar = null;
    if (job.startTime && job.duration) {
        jobBar = (<rect
            x={convertTime(job.startTime)} width={convertTime(job.duration, 0 as TimeMs)}
            y={0} height={2}
            fill={GRAPH_COLORS[job.cancelled ? 'cancelled' : job.type]}
        />)
    };
    let startErrorBar = null;
    if (job.startTimeActual) {
        const [t1, t2] = [job.startTime, job.startTimeActual].sort((a,b)=>a-b);
        startErrorBar = (<rect
            x={convertTime(t1)} width={convertTime(t2-t1 as TimeMs, 0 as TimeMs)}
            y={0} height={1}
            fill={GRAPH_COLORS.desync}
         />);
    }
    let endErrorBar = null;
    if (job.endTimeActual) {
        const [t1, t2] = [job.endTime, job.endTimeActual].sort((a,b)=>a-b);
        endErrorBar = (<rect
            x={convertTime(t1)} width={convertTime(t2-t1 as TimeMs, 0 as TimeMs)}
            y={0} height={1}
            fill={GRAPH_COLORS.desync}
         />);
    }
    return (
        <g transform={`translate(0 ${y})`}>
            {jobBar}
            {startErrorBar}
            {endErrorBar}
        </g>
    );
}

type TimeValue = [TimeMs, number];
interface SecurityLayerProps {
    expectedServers: ExpectedServerMessage[];
    observedServers: ObservedServerMessage[]
}
function SecurityLayer({expectedServers, observedServers}:SecurityLayerProps): React.ReactNode {
    expectedServers ??= [];
    observedServers ??= [];
    let minSec = 0;
    let maxSec = 1;
    for (const snapshots of [expectedServers, observedServers]) {
        for (const server of snapshots) {
            minSec = Math.min(minSec, server.hackDifficulty);
            maxSec = Math.max(maxSec, server.hackDifficulty);
        }
    }

    const observedEvents = observedServers.map((server)=>[server.time, server.hackDifficulty]) as TimeValue[];
    const shouldClosePath = true;
    const observedPath = computePathData(observedEvents, minSec, shouldClosePath);
    const observedLayer = (
        <g id="observedSec"
            transform={`translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxSec - minSec)})`}
            fill={"dark"+GRAPH_COLORS.security}
            // fillOpacity: 0.5,
            clipPath={`url(#hide-future-${initTime})`}
        >
            <path d={observedPath.join(" ")} />
        </g>
    );

    const expectedEvents = expectedServers.map((server)=>[server.time, server.hackDifficulty]) as TimeValue[];
    const predictedPath = computePathData(expectedEvents);
    const predictedLayer = (
        <g id="predictedSec"
            transform={`translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxSec - minSec)})`}
            stroke={GRAPH_COLORS.security}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="bevel"
        >
            <path d={predictedPath.join(" ")} vectorEffect="non-scaling-stroke" />
        </g>
    );

    return (
        <g id="secLayer" transform={`translate(0 ${HEIGHT_PIXELS - 2*FOOTER_PIXELS})`}>
            {observedLayer}
            {predictedLayer}
        </g>
    );
}

function computePathData(events: TimeValue[], minValue=0, shouldClose=false, scale=1) {
    const pathData = [];
    if (events.length > 0) {
        const [time, value] = events[0];
        // start line at first projected time and value
        pathData.push(`M ${convertTime(time).toFixed(3)},${(value*scale).toFixed(2)}`);
    }
    for (const [time, value] of events) {
        // horizontal line to current time
        pathData.push(`H ${convertTime(time).toFixed(3)}`)
        // vertical line to new level
        pathData.push(`V ${(value*scale).toFixed(2)}`);
    }
    // fill in area between last snapshot and right side (area after "now" cursor will be clipped later)
    if (events.length > 0) {
        const [time, value] = events[events.length-1];
        // vertical line to previous level
        // horizontal line to future time
        pathData.push(`V ${(value*scale).toFixed(2)}`, `H ${convertTime(time + 600000).toFixed(3)}`);
        if (shouldClose) {
            // fill area under actual security
            pathData.push(`V ${(minValue*scale).toFixed(2)}`);
            const minTime = events[0][0];
            pathData.push(`H ${convertTime(minTime).toFixed(3)}`);
            pathData.push('Z');
        }
    }
    return pathData;
}

function MoneyLayer(props: SecurityLayerProps): React.ReactNode {
    return <g id="moneyLayer" />
}

// ----- pre-React version -----

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
            computeProjectedPath("moneyAvailable", eventSnapshots, now, scale)
        ]
    );
    moneyLayer.append(projectedLayer);

    return moneyLayer;
}

