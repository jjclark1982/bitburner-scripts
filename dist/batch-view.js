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
const React = globalThis.React;
let initTime = performance.now();
/**
 * Convert timestamps to seconds since the graph was started.
 * To render SVGs using native time units, the values must be valid 32-bit ints.
 * So we convert to a recent epoch in case Date.now() values are used.
 */
function convertTime(t, t0 = initTime) {
    return ((t - t0) / 1000);
}
function convertSecToPx(t) {
    return t * WIDTH_PIXELS / WIDTH_SECONDS;
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
const WIDTH_PIXELS = 800;
const WIDTH_SECONDS = 16;
const HEIGHT_PIXELS = 600;
const FOOTER_PIXELS = 50;
// TODO: use a context for these scale factors. support setting them by args and scroll-gestures.
// const ScreenContext = React.createContext({WIDTH_PIXELS, WIDTH_SECONDS, HEIGHT_PIXELS, FOOTER_PIXELS});
// TODO: review use of 600000, 60000, and WIDTH_SECONDS as clipping limits.
// ----- main -----
const FLAGS = [
    ["help", false],
    ["port", 0]
];
export function autocomplete(data, args) {
    data.flags(FLAGS);
    return [];
}
/** @param {NS} ns **/
export async function main(ns) {
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
    const portNum = flags.port || ns.pid;
    const port = ns.getPortHandle(portNum);
    // port.clear();
    ns.print(`Listening on Port ${portNum}`);
    const batchView = React.createElement(BatchView, { ns: ns, portNum: portNum });
    ns.printRaw(batchView);
    while (true) {
        await port.nextWrite();
    }
}
export class BatchView extends React.Component {
    port;
    jobs;
    sequentialRowID = 0;
    sequentialJobID = 0;
    expectedServers;
    observedServers;
    constructor(props) {
        super(props);
        const { ns, portNum } = props;
        this.state = {
            running: true,
            now: performance.now()
        };
        this.port = ns.getPortHandle(portNum);
        this.jobs = new Map();
        this.expectedServers = [];
        this.observedServers = [];
    }
    componentDidMount() {
        const { ns } = this.props;
        this.setState({ running: true });
        ns.atExit(() => {
            this.setState({ running: false });
        });
        this.readPort();
        this.animate();
        // Object.assign(globalThis, {batchView: this});
    }
    componentWillUnmount() {
        this.setState({ running: false });
    }
    readPort = () => {
        if (!this.state.running)
            return;
        while (!this.port.empty()) {
            const msg = JSON.parse(this.port.read());
            this.receiveMessage(msg);
        }
        this.port.nextWrite().then(this.readPort);
    };
    receiveMessage(msg) {
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
    addJob(msg) {
        // Assign sequential ID if needed
        let jobID = msg.jobID;
        if (jobID === undefined) {
            while (this.jobs.has(this.sequentialJobID)) {
                this.sequentialJobID += 1;
            }
            jobID = this.sequentialJobID;
        }
        const job = this.jobs.get(jobID);
        if (job === undefined) {
            // Create new job record with required fields
            this.jobs.set(jobID, {
                jobID: jobID,
                rowID: this.sequentialRowID++,
                endTime: msg.startTime + msg.duration,
                ...msg
            });
        }
        else {
            // Merge updates into existing job record
            Object.assign(job, msg);
        }
        this.cleanJobs();
    }
    cleanJobs() {
        // Filter out jobs with endtime in past
        if (this.jobs.size > 200) {
            for (const jobID of this.jobs.keys()) {
                const job = this.jobs.get(jobID);
                if ((job.endTimeActual ?? job.endTime) < this.state.now - (WIDTH_SECONDS * 2 * 1000)) {
                    this.jobs.delete(jobID);
                }
            }
        }
    }
    animate = () => {
        if (!this.state.running)
            return;
        this.setState({ now: performance.now() });
        requestAnimationFrame(this.animate);
    };
    render() {
        const displayJobs = [...this.jobs.values()];
        // const serverPredictions = displayJobs.map((job)=>(
        //     [job.endTime as TimeMs, job.serverAfter as Server] as ServerSnapshot
        // )).filter(([t, s])=>!!s).sort((a,b)=>a[0]-b[0]);
        // const serverObservations = displayJobs.map((job)=>(
        //     [job.startTime as TimeMs, job.serverBefore as Server] as ServerSnapshot
        // )).filter(([t, s])=>!!s).sort((a,b)=>a[0]-b[0]);
        return (React.createElement(GraphFrame, { now: this.state.now },
            React.createElement(SafetyLayer, { expectedServers: this.expectedServers }),
            React.createElement(JobLayer, { jobs: displayJobs }),
            React.createElement(SecurityLayer, { expectedServers: this.expectedServers, observedServers: this.observedServers }),
            React.createElement(MoneyLayer, { expectedServers: this.expectedServers, observedServers: this.observedServers })));
    }
}
function GraphFrame({ now, children }) {
    // TODO: initTime is used as unique DOM ID and as rendering origin but it is poorly suited for both
    return (React.createElement("svg", { version: "1.1", xmlns: "http://www.w3.org/2000/svg", width: WIDTH_PIXELS, height: HEIGHT_PIXELS, 
        // Set the viewBox for 10 seconds of history, 6 seconds of future.
        viewBox: `${convertSecToPx(-10)} 0 ${WIDTH_PIXELS} ${HEIGHT_PIXELS}` },
        React.createElement("defs", null,
            React.createElement("clipPath", { id: `hide-future-${initTime}`, clipPathUnits: "userSpaceOnUse" },
                React.createElement("rect", { id: "hide-future-rect", x: convertTime(now - 60000), width: convertTime(60000, 0), y: 0, height: 50 }))),
        React.createElement("rect", { id: "background", x: convertSecToPx(-10), width: "100%", height: "100%", fill: GRAPH_COLORS.safe }),
        React.createElement("g", { id: "timeCoordinates", transform: `scale(${WIDTH_PIXELS / WIDTH_SECONDS} 1) translate(${convertTime(initTime - now, 0)} 0)` }, children),
        React.createElement("rect", { id: "cursor", x: 0, width: 1, y: 0, height: "100%", fill: "white" }),
        React.createElement(GraphLegend, null)));
}
function GraphLegend() {
    return (React.createElement("g", { id: "Legend", transform: "translate(-490, 10), scale(.5, .5)" },
        React.createElement("rect", { x: 1, y: 1, width: 275, height: 392, fill: "black", stroke: "#979797" }),
        Object.entries(GRAPH_COLORS).map(([label, color], i) => (React.createElement("g", { key: label, transform: `translate(22, ${13 + 41 * i})` },
            React.createElement("rect", { x: 0, y: 0, width: 22, height: 22, fill: color }),
            React.createElement("text", { fontFamily: "Courier New", fontSize: 36, fill: "#888" },
                React.createElement("tspan", { x: 42.5, y: 30 }, label.substring(0, 1).toUpperCase() + label.substring(1))))))));
}
function SafetyLayer({ expectedServers }) {
    let prevServer;
    return (React.createElement("g", { id: "safetyLayer" },
        expectedServers.map((server, i) => {
            let el = null;
            // shade the background based on secLevel
            if (prevServer && server.time > prevServer.time) {
                el = (React.createElement("rect", { key: i, x: convertTime(prevServer.time), width: convertTime(server.time - prevServer.time, 0), y: 0, height: "100%", fill: (prevServer.hackDifficulty > prevServer.minDifficulty) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe }));
            }
            prevServer = server;
            return el;
        }),
        prevServer && (React.createElement("rect", { key: "remainder", x: convertTime(prevServer.time), width: convertTime(600000, 0), y: 0, height: "100%", fill: (prevServer.hackDifficulty > prevServer.minDifficulty) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe }))));
}
function JobLayer({ jobs }) {
    return (React.createElement("g", { id: "jobLayer" }, jobs.map((job) => (React.createElement(JobBar, { job: job, key: job.jobID })))));
}
function JobBar({ job }) {
    const y = ((job.rowID + 1) % ((HEIGHT_PIXELS - FOOTER_PIXELS * 2) / 4)) * 4;
    let jobBar = null;
    if (job.startTime && job.duration) {
        jobBar = (React.createElement("rect", { x: convertTime(job.startTime), width: convertTime(job.duration, 0), y: 0, height: 2, fill: GRAPH_COLORS[job.cancelled ? 'cancelled' : job.type] }));
    }
    ;
    let startErrorBar = null;
    if (job.startTimeActual) {
        const [t1, t2] = [job.startTime, job.startTimeActual].sort((a, b) => a - b);
        startErrorBar = (React.createElement("rect", { x: convertTime(t1), width: convertTime(t2 - t1, 0), y: 0, height: 1, fill: GRAPH_COLORS.desync }));
    }
    let endErrorBar = null;
    if (job.endTimeActual) {
        const [t1, t2] = [job.endTime, job.endTimeActual].sort((a, b) => a - b);
        endErrorBar = (React.createElement("rect", { x: convertTime(t1), width: convertTime(t2 - t1, 0), y: 0, height: 1, fill: GRAPH_COLORS.desync }));
    }
    return (React.createElement("g", { transform: `translate(0 ${y})` },
        jobBar,
        startErrorBar,
        endErrorBar));
}
function SecurityLayer({ expectedServers, observedServers }) {
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
    const observedEvents = observedServers.map((server) => [server.time, server.hackDifficulty]);
    const shouldClosePath = true;
    const observedPath = computePathData(observedEvents, minSec, shouldClosePath);
    const observedLayer = (React.createElement("g", { id: "observedSec", transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxSec - minSec)})`, fill: "dark" + GRAPH_COLORS.security, 
        // fillOpacity: 0.5,
        clipPath: `url(#hide-future-${initTime})` },
        React.createElement("path", { d: observedPath.join(" ") })));
    const expectedEvents = expectedServers.map((server) => [server.time, server.hackDifficulty]);
    const predictedPath = computePathData(expectedEvents);
    const predictedLayer = (React.createElement("g", { id: "predictedSec", transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxSec - minSec)})`, stroke: GRAPH_COLORS.security, fill: "none", strokeWidth: 2, strokeLinejoin: "bevel" },
        React.createElement("path", { d: predictedPath.join(" "), vectorEffect: "non-scaling-stroke" })));
    return (React.createElement("g", { id: "secLayer", transform: `translate(0 ${HEIGHT_PIXELS - 2 * FOOTER_PIXELS})` },
        observedLayer,
        predictedLayer));
}
function computePathData(events, minValue = 0, shouldClose = false, scale = 1) {
    const pathData = [];
    if (events.length > 0) {
        const [time, value] = events[0];
        // start line at first projected time and value
        pathData.push(`M ${convertTime(time).toFixed(3)},${(value * scale).toFixed(2)}`);
    }
    for (const [time, value] of events) {
        // horizontal line to current time
        pathData.push(`H ${convertTime(time).toFixed(3)}`);
        // vertical line to new level
        pathData.push(`V ${(value * scale).toFixed(2)}`);
    }
    // fill in area between last snapshot and right side (area after "now" cursor will be clipped later)
    if (events.length > 0) {
        const [time, value] = events[events.length - 1];
        // vertical line to previous level
        // horizontal line to future time
        pathData.push(`V ${(value * scale).toFixed(2)}`, `H ${convertTime(time + 600000).toFixed(3)}`);
        if (shouldClose) {
            // fill area under actual security
            pathData.push(`V ${(minValue * scale).toFixed(2)}`);
            const minTime = events[0][0];
            pathData.push(`H ${convertTime(minTime).toFixed(3)}`);
            pathData.push('Z');
        }
    }
    return pathData;
}
function MoneyLayer(props) {
    return React.createElement("g", { id: "moneyLayer" });
}
// ----- pre-React version -----
/**
 * renderBatches - create an SVG element with a graph of jobs
 * @param {SVGSVGElement} [el] - SVG element to reuse. Will be created if it does not exist yet.
 * @param {Job[][]} batches - array of arrays of jobs
 * @param {number} [now] - current time (optional)
 * @returns {SVGSVGElement}
 */
export function renderBatches(el, batches = [], serverSnapshots = [], now) {
    now ||= performance.now();
    // Render the main SVG element if needed
    el ||= svgEl("svg", {
        version: "1.1", width: WIDTH_PIXELS, height: HEIGHT_PIXELS,
        // Set the viewBox for 10 seconds of history, 6 seconds of future.
        viewBox: `${convertSecToPx(-10)} 0 ${WIDTH_PIXELS} ${HEIGHT_PIXELS}`
    }, [
        ["defs", {}, [
                ["clipPath", { id: `hide-future-${initTime}`, clipPathUnits: "userSpaceOnUse" }, [
                        ["rect", { id: "hide-future-rect", x: convertTime(now - 60000), width: convertTime(60000, 0), y: 0, height: 50 }]
                    ]]
            ]],
        // ["rect", {id:"background", x:convertSecToPx(-10), width:"100%", height:"100%", fill:GRAPH_COLORS.safe}],
        ["g", { id: "timeCoordinates" }, [
                ["g", { id: "safetyLayer" }],
                ["g", { id: "jobLayer" }],
                ["g", { id: "secLayer" }],
                ["g", { id: "moneyLayer" }]
            ]],
        // ["rect", {id:"divider-1", x:convertSecToPx(-10), width:"100%", y:HEIGHT_PIXELS-FOOTER_PIXELS, height:1, fill: "white"}],
        // ["rect", {id:"divider-2", x:convertSecToPx(-10), width:"100%", y:HEIGHT_PIXELS-2*FOOTER_PIXELS, height:1, fill: "white"}],
        ["rect", { id: "cursor", x: 0, width: 1, y: 0, height: "100%", fill: "white" }],
        renderLegend()
    ]);
    // Update the time coordinates every frame
    const dataEl = el.getElementById("timeCoordinates");
    dataEl.setAttribute('transform', `scale(${WIDTH_PIXELS / WIDTH_SECONDS} 1) translate(${convertTime(initTime - now, 0)} 0)`);
    el.getElementById("hide-future-rect").setAttribute('x', convertTime(now - 60000));
    // Only update the main data every 250 ms
    const lastUpdate = dataEl.getAttribute('data-last-update') || 0;
    if (now - lastUpdate < 250) {
        return el;
    }
    dataEl.setAttribute('data-last-update', now);
    const eventSnapshots = batches.flat().map((job) => ([job.endTime, job.result]));
    // Render each job background and foreground
    while (dataEl.firstChild) {
        dataEl.removeChild(dataEl.firstChild);
    }
    dataEl.appendChild(renderSafetyLayer(batches, now));
    dataEl.appendChild(renderJobLayer(batches, now));
    dataEl.appendChild(renderSecurityLayer(eventSnapshots, serverSnapshots, now));
    // dataEl.appendChild(renderMoneyLayer(eventSnapshots, serverSnapshots, now));
    dataEl.appendChild(renderProfitLayer(batches, now));
    return el;
}
function renderProfitPath(batches = [], now, scale = 1) {
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
            pathData.push(`C ${convertTime((prevTime * 3 + time) / 4).toFixed(3)},${(scale * prevProfit / maxProfit).toFixed(3)} ${convertTime((prevTime + 3 * time) / 4).toFixed(3)},${(scale * profit / maxProfit).toFixed(3)} ${convertTime(time).toFixed(3)},${(scale * profit / maxProfit).toFixed(3)}`);
        }
        prevTime = time;
        prevProfit = profit;
    }
    pathData.push(`H ${convertTime(now + 60000).toFixed(3)} V 0 Z`);
    return svgEl('path', {
        d: pathData.join(' '),
        "vector-effect": "non-scaling-stroke"
    });
}
function renderProfitLayer(batches = [], now) {
    const profitPath = renderProfitPath(batches, now);
    const observedProfit = svgEl("g", {
        id: "observedProfit",
        transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS})`,
        fill: "dark" + GRAPH_COLORS.money,
        "clip-path": `url(#hide-future-${initTime})`
    }, [
        profitPath
    ]);
    const projectedProfit = svgEl("g", {
        id: "projectedProfit",
        transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS})`,
        fill: "none",
        stroke: GRAPH_COLORS.money,
        "stroke-width": 2,
        "stroke-linejoin": "round"
    }, [
        profitPath.cloneNode()
    ]);
    const profitLayer = svgEl("g", {
        id: "profitLayer",
        transform: `translate(0 ${HEIGHT_PIXELS - FOOTER_PIXELS})`
    }, [
        observedProfit,
        projectedProfit
    ]);
    return profitLayer;
}
function renderMoneyLayer(eventSnapshots = [], serverSnapshots = [], now) {
    const moneyLayer = svgEl("g", {
        id: "moneyLayer",
        transform: `translate(0 ${HEIGHT_PIXELS - FOOTER_PIXELS})`
    });
    if (serverSnapshots.length == 0) {
        return moneyLayer;
    }
    let minMoney = 0;
    let maxMoney = serverSnapshots[0][1].moneyMax;
    const scale = 1 / maxMoney;
    maxMoney *= 1.1;
    const observedLayer = svgEl("g", {
        id: "observedMoney",
        transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxMoney - minMoney) / scale})`,
        fill: "dark" + GRAPH_COLORS.money,
        // "fill-opacity": 0.5,
        "clip-path": `url(#hide-future-${initTime})`
    }, [
        renderObservedPath("moneyAvailable", serverSnapshots, minMoney, now, scale)
    ]);
    moneyLayer.append(observedLayer);
    const projectedLayer = svgEl("g", {
        id: "projectedMoney",
        transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxMoney - minMoney) / scale})`,
        stroke: GRAPH_COLORS.money,
        fill: "none",
        "stroke-width": 2,
        "stroke-linejoin": "bevel"
    }, [
        computeProjectedPath("moneyAvailable", eventSnapshots, now, scale)
    ]);
    moneyLayer.append(projectedLayer);
    return moneyLayer;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBNERFO0FBSUYsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLEtBQThCLENBQUM7QUFTeEQsSUFBSSxRQUFRLEdBQUcsV0FBVyxDQUFDLEdBQUcsRUFBWSxDQUFDO0FBQzNDOzs7O0dBSUc7QUFDSCxTQUFTLFdBQVcsQ0FBQyxDQUFTLEVBQUUsRUFBRSxHQUFDLFFBQVE7SUFDdkMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBZ0IsQ0FBQztBQUM1QyxDQUFDO0FBRUQsU0FBUyxjQUFjLENBQUMsQ0FBYztJQUNsQyxPQUFPLENBQUMsR0FBRyxZQUFZLEdBQUcsYUFBMkIsQ0FBQztBQUMxRCxDQUFDO0FBRUQsTUFBTSxZQUFZLEdBQUc7SUFDakIsTUFBTSxFQUFFLE1BQU07SUFDZCxNQUFNLEVBQUUsWUFBWTtJQUNwQixRQUFRLEVBQUUsUUFBUTtJQUNsQixXQUFXLEVBQUUsS0FBSztJQUNsQixRQUFRLEVBQUUsU0FBUztJQUNuQixNQUFNLEVBQUUsTUFBTTtJQUNkLFFBQVEsRUFBRSxNQUFNO0lBQ2hCLFVBQVUsRUFBRSxLQUFLO0lBQ2pCLE9BQU8sRUFBRSxNQUFNO0NBQ2xCLENBQUM7QUFFRixNQUFNLFlBQVksR0FBRyxHQUFpQixDQUFDO0FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEVBQWlCLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUcsR0FBYSxDQUFDO0FBQ3BDLE1BQU0sYUFBYSxHQUFHLEVBQVksQ0FBQztBQUNuQyxpR0FBaUc7QUFDakcsMEdBQTBHO0FBQzFHLDJFQUEyRTtBQUczRSxtQkFBbUI7QUFFbkIsTUFBTSxLQUFLLEdBQXFEO0lBQzVE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Q0YsVUFBVSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUVqQyxNQUFNLGNBQWMsR0FBRyxLQUFLLENBQ3hCLEdBQUcsRUFBRTtRQUNELEVBQUUsRUFBRSxnQkFBZ0I7UUFDcEIsU0FBUyxFQUFFLGVBQWUsYUFBYSxhQUFhLENBQUMsYUFBYSxHQUFHLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxHQUFHLEtBQUssR0FBRztRQUNyRyxNQUFNLEVBQUUsWUFBWSxDQUFDLEtBQUs7UUFDMUIsSUFBSSxFQUFFLE1BQU07UUFDWixjQUFjLEVBQUUsQ0FBQztRQUNqQixpQkFBaUIsRUFBQyxPQUFPO0tBQzVCLEVBQUU7UUFDQyxvQkFBb0IsQ0FBQyxnQkFBZ0IsRUFBRSxjQUFjLEVBQUUsR0FBRyxFQUFFLEtBQUssQ0FBQztLQUNyRSxDQUNKLENBQUM7SUFDRixVQUFVLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO0lBRWxDLE9BQU8sVUFBVSxDQUFDO0FBQ3RCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuXG5Vc2FnZVxuLS0tLS1cblxuU3RhcnQgdGhlIGJhdGNoIHZpZXdlciBzY3JpcHQgZnJvbSB0aGUgY29tbWFuZCBsaW5lOlxuXG4gICAgcnVuIGJhdGNoLXZpZXcuanMgLS1wb3J0IDEwXG5cblRoZW4gc2VuZCBtZXNzYWdlcyB0byBpdCBmcm9tIG90aGVyIHNjcmlwdHMuXG5cbkV4YW1wbGU6IERpc3BsYXkgYWN0aW9uIHRpbWluZyAoaGFjayAvIGdyb3cgLyB3ZWFrZW4pXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ2hhY2snLFxuICAgICAgICBqb2JJRDogMSxcbiAgICAgICAgc3RhcnRUaW1lOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICAgICAgZHVyYXRpb246IG5zLmdldEhhY2tUaW1lKHRhcmdldCksXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBVcGRhdGUgYW4gYWN0aW9uIHRoYXQgaGFzIGFscmVhZHkgYmVlbiBkaXNwbGF5ZWRcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBqb2JJRDogMSxcbiAgICAgICAgc3RhcnRUaW1lQWN0dWFsOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICB9KSk7XG4gICAgYXdhaXQgbnMuaGFjayh0YXJnZXQpO1xuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBqb2JJRDogMSxcbiAgICAgICAgZW5kVGltZUFjdHVhbDogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBEaXNwbGF5IGEgYmxhbmsgcm93IGJldHdlZW4gYWN0aW9ucyAodG8gdmlzdWFsbHkgc2VwYXJhdGUgYmF0Y2hlcylcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnc3BhY2VyJyxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IERpc3BsYXkgb2JzZXJ2ZWQgc2VjdXJpdHkgLyBtb25leSBsZXZlbFxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdvYnNlcnZlZCcsXG4gICAgICAgIHRpbWU6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgICAgICBtaW5EaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJNaW5TZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIGhhY2tEaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJTZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIG1vbmV5TWF4OiBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpLFxuICAgICAgICBtb25leUF2YWlsYWJsZTogbnMuZ2V0U2VydmVyTW9uZXlBdmFpbGFibGUodGFyZ2V0KSxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IERpc3BsYXkgZXhwZWN0ZWQgc2VjdXJpdHkgLyBtb25leSBsZXZlbCAodmFyaWVzIGJ5IGFjdGlvbiB0eXBlIGFuZCB5b3VyIHN0cmF0ZWd5KVxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdleHBlY3RlZCcsXG4gICAgICAgIHRpbWU6IGpvYi5zdGFydFRpbWUgKyBqb2IuZHVyYXRpb24sXG4gICAgICAgIG1pbkRpZmZpY3VsdHk6IG5zLmdldFNlcnZlck1pblNlY3VyaXR5TGV2ZWwodGFyZ2V0KSxcbiAgICAgICAgaGFja0RpZmZpY3VsdHk6IG5zLmdldFNlcnZlclNlY3VyaXR5TGV2ZWwodGFyZ2V0KSArIG5zLmhhY2tBbmFseXplU2VjdXJpdHkoam9iLnRocmVhZHMpLFxuICAgICAgICBtb25leU1heDogbnMuZ2V0U2VydmVyTWF4TW9uZXkodGFyZ2V0KSxcbiAgICAgICAgbW9uZXlBdmFpbGFibGU6IE1hdGgubWF4KDAsIG5zLmdldFNlcnZlck1heE1vbmV5KHRhcmdldCkgLSBucy5oYWNrQW5hbHl6ZSh0YXJnZXQpICogam9iLnRocmVhZHMgKiBucy5oYWNrQW5hbHl6ZUNoYW5jZSh0YXJnZXQpKSxcbiAgICB9KSk7XG5cbiovXG5cbmltcG9ydCB0eXBlIHsgTlMsIE5ldHNjcmlwdFBvcnQsIFNlcnZlciB9IGZyb20gJ0Bucyc7XG5pbXBvcnQgdHlwZSBSZWFjdE5hbWVzcGFjZSBmcm9tICdyZWFjdC9pbmRleCc7XG5jb25zdCBSZWFjdCA9IGdsb2JhbFRoaXMuUmVhY3QgYXMgdHlwZW9mIFJlYWN0TmFtZXNwYWNlO1xuXG4vLyAtLS0tLSBjb25zdGFudHMgLS0tLS0gXG5cbnR5cGUgVGltZU1zID0gUmV0dXJuVHlwZTx0eXBlb2YgcGVyZm9ybWFuY2Uubm93PiAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcIm1pbGxpc2Vjb25kc1wiIH07XG50eXBlIFRpbWVTZWNvbmRzID0gbnVtYmVyICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwic2Vjb25kc1wiIH07XG50eXBlIFRpbWVQaXhlbHMgPSBudW1iZXIgJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJwaXhlbHNcIiB9O1xudHlwZSBQaXhlbHMgPSBudW1iZXIgJiB7IF9fdW5pdHM6IFwicGl4ZWxzXCIgfTtcblxubGV0IGluaXRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zO1xuLyoqXG4gKiBDb252ZXJ0IHRpbWVzdGFtcHMgdG8gc2Vjb25kcyBzaW5jZSB0aGUgZ3JhcGggd2FzIHN0YXJ0ZWQuXG4gKiBUbyByZW5kZXIgU1ZHcyB1c2luZyBuYXRpdmUgdGltZSB1bml0cywgdGhlIHZhbHVlcyBtdXN0IGJlIHZhbGlkIDMyLWJpdCBpbnRzLlxuICogU28gd2UgY29udmVydCB0byBhIHJlY2VudCBlcG9jaCBpbiBjYXNlIERhdGUubm93KCkgdmFsdWVzIGFyZSB1c2VkLlxuICovXG5mdW5jdGlvbiBjb252ZXJ0VGltZSh0OiBUaW1lTXMsIHQwPWluaXRUaW1lKTogVGltZVNlY29uZHMge1xuICAgIHJldHVybiAoKHQgLSB0MCkgLyAxMDAwKSBhcyBUaW1lU2Vjb25kcztcbn1cblxuZnVuY3Rpb24gY29udmVydFNlY1RvUHgodDogVGltZVNlY29uZHMpOiBUaW1lUGl4ZWxzIHtcbiAgICByZXR1cm4gdCAqIFdJRFRIX1BJWEVMUyAvIFdJRFRIX1NFQ09ORFMgYXMgVGltZVBpeGVscztcbn1cblxuY29uc3QgR1JBUEhfQ09MT1JTID0ge1xuICAgIFwiaGFja1wiOiBcImN5YW5cIixcbiAgICBcImdyb3dcIjogXCJsaWdodGdyZWVuXCIsXG4gICAgXCJ3ZWFrZW5cIjogXCJ5ZWxsb3dcIixcbiAgICBcImNhbmNlbGxlZFwiOiBcInJlZFwiLFxuICAgIFwiZGVzeW5jXCI6IFwibWFnZW50YVwiLFxuICAgIFwic2FmZVwiOiBcIiMxMTFcIixcbiAgICBcInVuc2FmZVwiOiBcIiMzMzNcIixcbiAgICBcInNlY3VyaXR5XCI6IFwicmVkXCIsXG4gICAgXCJtb25leVwiOiBcImJsdWVcIlxufTtcblxuY29uc3QgV0lEVEhfUElYRUxTID0gODAwIGFzIFRpbWVQaXhlbHM7XG5jb25zdCBXSURUSF9TRUNPTkRTID0gMTYgYXMgVGltZVNlY29uZHM7XG5jb25zdCBIRUlHSFRfUElYRUxTID0gNjAwIGFzIFBpeGVscztcbmNvbnN0IEZPT1RFUl9QSVhFTFMgPSA1MCBhcyBQaXhlbHM7XG4vLyBUT0RPOiB1c2UgYSBjb250ZXh0IGZvciB0aGVzZSBzY2FsZSBmYWN0b3JzLiBzdXBwb3J0IHNldHRpbmcgdGhlbSBieSBhcmdzIGFuZCBzY3JvbGwtZ2VzdHVyZXMuXG4vLyBjb25zdCBTY3JlZW5Db250ZXh0ID0gUmVhY3QuY3JlYXRlQ29udGV4dCh7V0lEVEhfUElYRUxTLCBXSURUSF9TRUNPTkRTLCBIRUlHSFRfUElYRUxTLCBGT09URVJfUElYRUxTfSk7XG4vLyBUT0RPOiByZXZpZXcgdXNlIG9mIDYwMDAwMCwgNjAwMDAsIGFuZCBXSURUSF9TRUNPTkRTIGFzIGNsaXBwaW5nIGxpbWl0cy5cblxuXG4vLyAtLS0tLSBtYWluIC0tLS0tXG5cbmNvbnN0IEZMQUdTOiBbc3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgc3RyaW5nW11dW10gPSBbXG4gICAgW1wiaGVscFwiLCBmYWxzZV0sXG4gICAgW1wicG9ydFwiLCAwXVxuXTtcblxuZXhwb3J0IGZ1bmN0aW9uIGF1dG9jb21wbGV0ZShkYXRhOiBhbnksIGFyZ3M6IHN0cmluZ1tdKSB7XG4gICAgZGF0YS5mbGFncyhGTEFHUyk7XG4gICAgcmV0dXJuIFtdO1xufVxuXG4vKiogQHBhcmFtIHtOU30gbnMgKiovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWFpbihuczogTlMpIHtcbiAgICBucy5kaXNhYmxlTG9nKCdzbGVlcCcpO1xuICAgIG5zLmNsZWFyTG9nKCk7XG4gICAgbnMudGFpbCgpO1xuICAgIG5zLnJlc2l6ZVRhaWwoODEwLCA2NDApO1xuXG4gICAgY29uc3QgZmxhZ3MgPSBucy5mbGFncyhGTEFHUyk7XG4gICAgaWYgKGZsYWdzLmhlbHApIHtcbiAgICAgICAgbnMudHByaW50KFtcbiAgICAgICAgICAgIGBVU0FHRWAsXG4gICAgICAgICAgICBgPiBydW4gJHtucy5nZXRTY3JpcHROYW1lKCl9IC0tcG9ydCAxMGAsXG4gICAgICAgICAgICAnICdcbiAgICAgICAgXS5qb2luKFwiXFxuXCIpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBvcnROdW0gPSBmbGFncy5wb3J0IGFzIG51bWJlciB8fCBucy5waWQ7XG4gICAgY29uc3QgcG9ydCA9IG5zLmdldFBvcnRIYW5kbGUocG9ydE51bSk7XG4gICAgLy8gcG9ydC5jbGVhcigpO1xuICAgIG5zLnByaW50KGBMaXN0ZW5pbmcgb24gUG9ydCAke3BvcnROdW19YCk7XG5cbiAgICBjb25zdCBiYXRjaFZpZXcgPSA8QmF0Y2hWaWV3IG5zPXtuc30gcG9ydE51bT17cG9ydE51bX0gLz47XG4gICAgbnMucHJpbnRSYXcoYmF0Y2hWaWV3KTtcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGF3YWl0IHBvcnQubmV4dFdyaXRlKCk7XG4gICAgfVxufVxuXG4vLyAtLS0tLSBCYXRjaFZpZXcgLS0tLS1cblxudHlwZSBKb2JJRCA9IG51bWJlciB8IHN0cmluZztcbmludGVyZmFjZSBBY3Rpb25NZXNzYWdlIHtcbiAgICB0eXBlOiBcImhhY2tcIiB8IFwiZ3Jvd1wiIHwgXCJ3ZWFrZW5cIjtcbiAgICBqb2JJRD86IEpvYklEO1xuICAgIGR1cmF0aW9uOiBUaW1lTXM7XG4gICAgc3RhcnRUaW1lOiBUaW1lTXM7XG4gICAgc3RhcnRUaW1lQWN0dWFsPzogVGltZU1zO1xuICAgIGVuZFRpbWU/OiBUaW1lTXM7XG4gICAgZW5kVGltZUFjdHVhbD86IFRpbWVNcztcbiAgICBjYW5jZWxsZWQ/OiBib29sZWFuO1xuICAgIHJlc3VsdD86IG51bWJlcjtcbn1cbmludGVyZmFjZSBTcGFjZXJNZXNzYWdlIHtcbiAgICB0eXBlOiBcInNwYWNlclwiXG59XG5pbnRlcmZhY2UgU2VydmVyTWVzc2FnZSB7XG4gICAgdHlwZTogXCJleHBlY3RlZFwiIHwgXCJvYnNlcnZlZFwiO1xuICAgIHRpbWU6IFRpbWVNcztcbiAgICBoYWNrRGlmZmljdWx0eTogbnVtYmVyO1xuICAgIG1pbkRpZmZpY3VsdHk6IG51bWJlcjtcbiAgICBtb25leUF2YWlsYWJsZTogbnVtYmVyO1xuICAgIG1vbmV5TWF4OiBudW1iZXI7XG59XG50eXBlIEV4cGVjdGVkU2VydmVyTWVzc2FnZSA9IFNlcnZlck1lc3NhZ2UgJiB7XG4gICAgdHlwZTogXCJleHBlY3RlZFwiXG59XG50eXBlIE9ic2VydmVkU2VydmVyTWVzc2FnZSA9IFNlcnZlck1lc3NhZ2UgJiB7XG4gICAgdHlwZTogXCJvYnNlcnZlZFwiXG59XG50eXBlIEJhdGNoVmlld01lc3NhZ2UgPSBBY3Rpb25NZXNzYWdlIHwgU3BhY2VyTWVzc2FnZSB8IEV4cGVjdGVkU2VydmVyTWVzc2FnZSB8IE9ic2VydmVkU2VydmVyTWVzc2FnZTtcblxuaW50ZXJmYWNlIEpvYiBleHRlbmRzIEFjdGlvbk1lc3NhZ2Uge1xuICAgIGpvYklEOiBKb2JJRDtcbiAgICByb3dJRDogbnVtYmVyO1xuICAgIGVuZFRpbWU6IFRpbWVNcztcbn1cblxuaW50ZXJmYWNlIEJhdGNoVmlld1Byb3BzIHtcbiAgICBuczogTlM7XG4gICAgcG9ydE51bTogbnVtYmVyO1xufVxuaW50ZXJmYWNlIEJhdGNoVmlld1N0YXRlIHtcbiAgICBydW5uaW5nOiBib29sZWFuO1xuICAgIG5vdzogVGltZU1zO1xufVxuZXhwb3J0IGNsYXNzIEJhdGNoVmlldyBleHRlbmRzIFJlYWN0LkNvbXBvbmVudDxCYXRjaFZpZXdQcm9wcywgQmF0Y2hWaWV3U3RhdGU+IHtcbiAgICBwb3J0OiBOZXRzY3JpcHRQb3J0O1xuICAgIGpvYnM6IE1hcDxKb2JJRCwgSm9iPjtcbiAgICBzZXF1ZW50aWFsUm93SUQ6IG51bWJlciA9IDA7XG4gICAgc2VxdWVudGlhbEpvYklEOiBudW1iZXIgPSAwO1xuICAgIGV4cGVjdGVkU2VydmVyczogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlW107XG4gICAgb2JzZXJ2ZWRTZXJ2ZXJzOiBPYnNlcnZlZFNlcnZlck1lc3NhZ2VbXTtcblxuICAgIGNvbnN0cnVjdG9yKHByb3BzOiBCYXRjaFZpZXdQcm9wcyl7XG4gICAgICAgIHN1cGVyKHByb3BzKTtcbiAgICAgICAgY29uc3QgeyBucywgcG9ydE51bSB9ID0gcHJvcHM7XG4gICAgICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICAgICAgICBydW5uaW5nOiB0cnVlLFxuICAgICAgICAgICAgbm93OiBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXNcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5wb3J0ID0gbnMuZ2V0UG9ydEhhbmRsZShwb3J0TnVtKTtcbiAgICAgICAgdGhpcy5qb2JzID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLmV4cGVjdGVkU2VydmVycyA9IFtdO1xuICAgICAgICB0aGlzLm9ic2VydmVkU2VydmVycyA9IFtdO1xuICAgIH1cblxuICAgIGNvbXBvbmVudERpZE1vdW50KCkge1xuICAgICAgICBjb25zdCB7IG5zIH0gPSB0aGlzLnByb3BzO1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiB0cnVlfSk7XG4gICAgICAgIG5zLmF0RXhpdCgoKT0+e1xuICAgICAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogZmFsc2V9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMucmVhZFBvcnQoKTtcbiAgICAgICAgdGhpcy5hbmltYXRlKCk7XG4gICAgICAgIC8vIE9iamVjdC5hc3NpZ24oZ2xvYmFsVGhpcywge2JhdGNoVmlldzogdGhpc30pO1xuICAgIH1cblxuICAgIGNvbXBvbmVudFdpbGxVbm1vdW50KCkge1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiBmYWxzZX0pO1xuICAgIH1cblxuICAgIHJlYWRQb3J0ID0gKCk9PntcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlLnJ1bm5pbmcpIHJldHVybjtcbiAgICAgICAgd2hpbGUoIXRoaXMucG9ydC5lbXB0eSgpKSB7XG4gICAgICAgICAgICBjb25zdCBtc2c6IEJhdGNoVmlld01lc3NhZ2UgPSBKU09OLnBhcnNlKHRoaXMucG9ydC5yZWFkKCkgYXMgc3RyaW5nKTtcbiAgICAgICAgICAgIHRoaXMucmVjZWl2ZU1lc3NhZ2UobXNnKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnBvcnQubmV4dFdyaXRlKCkudGhlbih0aGlzLnJlYWRQb3J0KTtcbiAgICB9XG5cbiAgICByZWNlaXZlTWVzc2FnZShtc2c6IEJhdGNoVmlld01lc3NhZ2UpIHtcbiAgICAgICAgaWYgKG1zZy50eXBlID09IFwic3BhY2VyXCIpIHtcbiAgICAgICAgICAgIHRoaXMuc2VxdWVudGlhbFJvd0lEICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAobXNnLnR5cGUgPT0gXCJleHBlY3RlZFwiKSB7XG4gICAgICAgICAgICB0aGlzLmV4cGVjdGVkU2VydmVycy5wdXNoKG1zZyk7XG4gICAgICAgICAgICAvLyBUT0RPOiBzb3J0IGJ5IHRpbWUgYW5kIHJlbW92ZSB2ZXJ5IG9sZCBpdGVtc1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKG1zZy50eXBlID09IFwib2JzZXJ2ZWRcIikge1xuICAgICAgICAgICAgdGhpcy5vYnNlcnZlZFNlcnZlcnMucHVzaChtc2cpO1xuICAgICAgICAgICAgLy8gVE9ETzogc29ydCBieSB0aW1lIGFuZCByZW1vdmUgdmVyeSBvbGQgaXRlbXNcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cuam9iSUQgIT09IHVuZGVmaW5lZCB8fCBtc2cudHlwZSA9PSAnaGFjaycgfHwgbXNnLnR5cGUgPT0gJ2dyb3cnIHx8IG1zZy50eXBlID09ICd3ZWFrZW4nKSB7XG4gICAgICAgICAgICB0aGlzLmFkZEpvYihtc2cpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkSm9iKG1zZzogQWN0aW9uTWVzc2FnZSkge1xuICAgICAgICAvLyBBc3NpZ24gc2VxdWVudGlhbCBJRCBpZiBuZWVkZWRcbiAgICAgICAgbGV0IGpvYklEID0gbXNnLmpvYklEO1xuICAgICAgICBpZiAoam9iSUQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgd2hpbGUgKHRoaXMuam9icy5oYXModGhpcy5zZXF1ZW50aWFsSm9iSUQpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXF1ZW50aWFsSm9iSUQgKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGpvYklEID0gdGhpcy5zZXF1ZW50aWFsSm9iSUQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgam9iID0gdGhpcy5qb2JzLmdldChqb2JJRCk7XG4gICAgICAgIGlmIChqb2IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgLy8gQ3JlYXRlIG5ldyBqb2IgcmVjb3JkIHdpdGggcmVxdWlyZWQgZmllbGRzXG4gICAgICAgICAgICB0aGlzLmpvYnMuc2V0KGpvYklELCB7XG4gICAgICAgICAgICAgICAgam9iSUQ6IGpvYklELFxuICAgICAgICAgICAgICAgIHJvd0lEOiB0aGlzLnNlcXVlbnRpYWxSb3dJRCsrLFxuICAgICAgICAgICAgICAgIGVuZFRpbWU6IG1zZy5zdGFydFRpbWUgKyBtc2cuZHVyYXRpb24gYXMgVGltZU1zLFxuICAgICAgICAgICAgICAgIC4uLm1zZ1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAvLyBNZXJnZSB1cGRhdGVzIGludG8gZXhpc3Rpbmcgam9iIHJlY29yZFxuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihqb2IsIG1zZyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5jbGVhbkpvYnMoKTtcbiAgICB9XG5cbiAgICBjbGVhbkpvYnMoKSB7XG4gICAgICAgIC8vIEZpbHRlciBvdXQgam9icyB3aXRoIGVuZHRpbWUgaW4gcGFzdFxuICAgICAgICBpZiAodGhpcy5qb2JzLnNpemUgPiAyMDApIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qgam9iSUQgb2YgdGhpcy5qb2JzLmtleXMoKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuam9icy5nZXQoam9iSUQpIGFzIEpvYjtcbiAgICAgICAgICAgICAgICBpZiAoKGpvYi5lbmRUaW1lQWN0dWFsID8/IGpvYi5lbmRUaW1lKSA8IHRoaXMuc3RhdGUubm93LShXSURUSF9TRUNPTkRTKjIqMTAwMCkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5qb2JzLmRlbGV0ZShqb2JJRCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYW5pbWF0ZSA9ICgpPT57XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5ydW5uaW5nKSByZXR1cm47XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe25vdzogcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zfSk7XG4gICAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGUpO1xuICAgIH1cblxuICAgIHJlbmRlcigpIHtcbiAgICAgICAgY29uc3QgZGlzcGxheUpvYnMgPSBbLi4udGhpcy5qb2JzLnZhbHVlcygpXVxuXG4gICAgICAgIC8vIGNvbnN0IHNlcnZlclByZWRpY3Rpb25zID0gZGlzcGxheUpvYnMubWFwKChqb2IpPT4oXG4gICAgICAgIC8vICAgICBbam9iLmVuZFRpbWUgYXMgVGltZU1zLCBqb2Iuc2VydmVyQWZ0ZXIgYXMgU2VydmVyXSBhcyBTZXJ2ZXJTbmFwc2hvdFxuICAgICAgICAvLyApKS5maWx0ZXIoKFt0LCBzXSk9PiEhcykuc29ydCgoYSxiKT0+YVswXS1iWzBdKTtcbiAgICAgICAgLy8gY29uc3Qgc2VydmVyT2JzZXJ2YXRpb25zID0gZGlzcGxheUpvYnMubWFwKChqb2IpPT4oXG4gICAgICAgIC8vICAgICBbam9iLnN0YXJ0VGltZSBhcyBUaW1lTXMsIGpvYi5zZXJ2ZXJCZWZvcmUgYXMgU2VydmVyXSBhcyBTZXJ2ZXJTbmFwc2hvdFxuICAgICAgICAvLyApKS5maWx0ZXIoKFt0LCBzXSk9PiEhcykuc29ydCgoYSxiKT0+YVswXS1iWzBdKTtcbiAgICBcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIDxHcmFwaEZyYW1lIG5vdz17dGhpcy5zdGF0ZS5ub3d9PlxuICAgICAgICAgICAgICAgIDxTYWZldHlMYXllciBleHBlY3RlZFNlcnZlcnM9e3RoaXMuZXhwZWN0ZWRTZXJ2ZXJzfSAvPlxuICAgICAgICAgICAgICAgIDxKb2JMYXllciBqb2JzPXtkaXNwbGF5Sm9ic30gLz5cbiAgICAgICAgICAgICAgICA8U2VjdXJpdHlMYXllciBleHBlY3RlZFNlcnZlcnM9e3RoaXMuZXhwZWN0ZWRTZXJ2ZXJzfSBvYnNlcnZlZFNlcnZlcnM9e3RoaXMub2JzZXJ2ZWRTZXJ2ZXJzfSAvPlxuICAgICAgICAgICAgICAgIDxNb25leUxheWVyIGV4cGVjdGVkU2VydmVycz17dGhpcy5leHBlY3RlZFNlcnZlcnN9IG9ic2VydmVkU2VydmVycz17dGhpcy5vYnNlcnZlZFNlcnZlcnN9IC8+XG4gICAgICAgICAgICA8L0dyYXBoRnJhbWU+XG4gICAgICAgIClcbiAgICB9XG59XG5cbmZ1bmN0aW9uIEdyYXBoRnJhbWUoe25vdywgY2hpbGRyZW59Ontub3c6VGltZU1zLCBjaGlsZHJlbjogUmVhY3QuUmVhY3ROb2RlfSk6IFJlYWN0LlJlYWN0RWxlbWVudCB7XG4gICAgLy8gVE9ETzogaW5pdFRpbWUgaXMgdXNlZCBhcyB1bmlxdWUgRE9NIElEIGFuZCBhcyByZW5kZXJpbmcgb3JpZ2luIGJ1dCBpdCBpcyBwb29ybHkgc3VpdGVkIGZvciBib3RoXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHN2ZyB2ZXJzaW9uPVwiMS4xXCIgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiXG4gICAgICAgICAgICB3aWR0aD17V0lEVEhfUElYRUxTfVxuICAgICAgICAgICAgaGVpZ2h0PXtIRUlHSFRfUElYRUxTfSBcbiAgICAgICAgICAgIC8vIFNldCB0aGUgdmlld0JveCBmb3IgMTAgc2Vjb25kcyBvZiBoaXN0b3J5LCA2IHNlY29uZHMgb2YgZnV0dXJlLlxuICAgICAgICAgICAgdmlld0JveD17YCR7Y29udmVydFNlY1RvUHgoLTEwIGFzIFRpbWVTZWNvbmRzKX0gMCAke1dJRFRIX1BJWEVMU30gJHtIRUlHSFRfUElYRUxTfWB9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxkZWZzPlxuICAgICAgICAgICAgICAgIDxjbGlwUGF0aCBpZD17YGhpZGUtZnV0dXJlLSR7aW5pdFRpbWV9YH0gY2xpcFBhdGhVbml0cz1cInVzZXJTcGFjZU9uVXNlXCI+XG4gICAgICAgICAgICAgICAgICAgIDxyZWN0IGlkPVwiaGlkZS1mdXR1cmUtcmVjdFwiXG4gICAgICAgICAgICAgICAgICAgICAgICB4PXtjb252ZXJ0VGltZShub3ctNjAwMDAgYXMgVGltZU1zKX0gd2lkdGg9e2NvbnZlcnRUaW1lKDYwMDAwIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXs1MH1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2NsaXBQYXRoPlxuICAgICAgICAgICAgPC9kZWZzPlxuICAgICAgICAgICAgPHJlY3QgaWQ9XCJiYWNrZ3JvdW5kXCIgeD17Y29udmVydFNlY1RvUHgoLTEwIGFzIFRpbWVTZWNvbmRzKX0gd2lkdGg9XCIxMDAlXCIgaGVpZ2h0PVwiMTAwJVwiIGZpbGw9e0dSQVBIX0NPTE9SUy5zYWZlfSAvPlxuICAgICAgICAgICAgPGcgaWQ9XCJ0aW1lQ29vcmRpbmF0ZXNcIiB0cmFuc2Zvcm09e2BzY2FsZSgke1dJRFRIX1BJWEVMUyAvIFdJRFRIX1NFQ09ORFN9IDEpIHRyYW5zbGF0ZSgke2NvbnZlcnRUaW1lKGluaXRUaW1lLW5vdyBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX0gMClgfT5cbiAgICAgICAgICAgICAgICB7Y2hpbGRyZW59XG4gICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTFcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLUZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMlwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtMipGT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICA8cmVjdCBpZD1cImN1cnNvclwiIHg9ezB9IHdpZHRoPXsxfSB5PXswfSBoZWlnaHQ9XCIxMDAlXCIgZmlsbD1cIndoaXRlXCIgLz5cbiAgICAgICAgICAgIDxHcmFwaExlZ2VuZCAvPlxuICAgICAgICA8L3N2Zz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBHcmFwaExlZ2VuZCgpOiBSZWFjdC5SZWFjdEVsZW1lbnQge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwiTGVnZW5kXCIgdHJhbnNmb3JtPVwidHJhbnNsYXRlKC00OTAsIDEwKSwgc2NhbGUoLjUsIC41KVwiPlxuICAgICAgICAgICAgPHJlY3QgeD17MX0geT17MX0gd2lkdGg9ezI3NX0gaGVpZ2h0PXszOTJ9IGZpbGw9XCJibGFja1wiIHN0cm9rZT1cIiM5Nzk3OTdcIiAvPlxuICAgICAgICAgICAge09iamVjdC5lbnRyaWVzKEdSQVBIX0NPTE9SUykubWFwKChbbGFiZWwsIGNvbG9yXSwgaSk9PihcbiAgICAgICAgICAgICAgICA8ZyBrZXk9e2xhYmVsfSB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMjIsICR7MTMgKyA0MSppfSlgfT5cbiAgICAgICAgICAgICAgICAgICAgPHJlY3QgeD17MH0geT17MH0gd2lkdGg9ezIyfSBoZWlnaHQ9ezIyfSBmaWxsPXtjb2xvcn0gLz5cbiAgICAgICAgICAgICAgICAgICAgPHRleHQgZm9udEZhbWlseT1cIkNvdXJpZXIgTmV3XCIgZm9udFNpemU9ezM2fSBmaWxsPVwiIzg4OFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRzcGFuIHg9ezQyLjV9IHk9ezMwfT57bGFiZWwuc3Vic3RyaW5nKDAsMSkudG9VcHBlckNhc2UoKStsYWJlbC5zdWJzdHJpbmcoMSl9PC90c3Bhbj5cbiAgICAgICAgICAgICAgICAgICAgPC90ZXh0PlxuICAgICAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgICkpfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gU2FmZXR5TGF5ZXIoe2V4cGVjdGVkU2VydmVyc306IHtleHBlY3RlZFNlcnZlcnM6IEV4cGVjdGVkU2VydmVyTWVzc2FnZVtdfSk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgbGV0IHByZXZTZXJ2ZXI6IEV4cGVjdGVkU2VydmVyTWVzc2FnZSB8IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cInNhZmV0eUxheWVyXCI+XG4gICAgICAgICAgICB7ZXhwZWN0ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyLCBpKT0+e1xuICAgICAgICAgICAgICAgIGxldCBlbCA9IG51bGw7XG4gICAgICAgICAgICAgICAgLy8gc2hhZGUgdGhlIGJhY2tncm91bmQgYmFzZWQgb24gc2VjTGV2ZWxcbiAgICAgICAgICAgICAgICBpZiAocHJldlNlcnZlciAmJiBzZXJ2ZXIudGltZSA+IHByZXZTZXJ2ZXIudGltZSkge1xuICAgICAgICAgICAgICAgICAgICBlbCA9ICg8cmVjdCBrZXk9e2l9XG4gICAgICAgICAgICAgICAgICAgICAgICB4PXtjb252ZXJ0VGltZShwcmV2U2VydmVyLnRpbWUpfSB3aWR0aD17Y29udmVydFRpbWUoc2VydmVyLnRpbWUgLSBwcmV2U2VydmVyLnRpbWUsIDApfVxuICAgICAgICAgICAgICAgICAgICAgICAgeT17MH0gaGVpZ2h0PVwiMTAwJVwiXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxsPXsocHJldlNlcnZlci5oYWNrRGlmZmljdWx0eSA+IHByZXZTZXJ2ZXIubWluRGlmZmljdWx0eSkgPyBHUkFQSF9DT0xPUlMudW5zYWZlIDogR1JBUEhfQ09MT1JTLnNhZmV9XG4gICAgICAgICAgICAgICAgICAgIC8+KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcHJldlNlcnZlciA9IHNlcnZlcjtcbiAgICAgICAgICAgICAgICByZXR1cm4gZWw7XG4gICAgICAgICAgICB9KX1cbiAgICAgICAgICAgIHtwcmV2U2VydmVyICYmIChcbiAgICAgICAgICAgICAgICA8cmVjdCBrZXk9XCJyZW1haW5kZXJcIlxuICAgICAgICAgICAgICAgICAgICB4PXtjb252ZXJ0VGltZShwcmV2U2VydmVyLnRpbWUpfSB3aWR0aD17Y29udmVydFRpbWUoNjAwMDAwLCAwKX1cbiAgICAgICAgICAgICAgICAgICAgeT17MH0gaGVpZ2h0PVwiMTAwJVwiXG4gICAgICAgICAgICAgICAgICAgIGZpbGw9eyhwcmV2U2VydmVyLmhhY2tEaWZmaWN1bHR5ID4gcHJldlNlcnZlci5taW5EaWZmaWN1bHR5KSA/IEdSQVBIX0NPTE9SUy51bnNhZmUgOiBHUkFQSF9DT0xPUlMuc2FmZX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEpvYkxheWVyKHtqb2JzfToge2pvYnM6IEpvYltdfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwiam9iTGF5ZXJcIj5cbiAgICAgICAgICAgIHtqb2JzLm1hcCgoam9iOiBKb2IpPT4oPEpvYkJhciBqb2I9e2pvYn0ga2V5PXtqb2Iuam9iSUR9IC8+KSl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBKb2JCYXIoe2pvYn06IHtqb2I6IEpvYn0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGNvbnN0IHkgPSAoKGpvYi5yb3dJRCArIDEpICUgKChIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMUyoyKSAvIDQpKSAqIDQ7XG4gICAgbGV0IGpvYkJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5zdGFydFRpbWUgJiYgam9iLmR1cmF0aW9uKSB7XG4gICAgICAgIGpvYkJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUoam9iLnN0YXJ0VGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZShqb2IuZHVyYXRpb24sIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17Mn1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SU1tqb2IuY2FuY2VsbGVkID8gJ2NhbmNlbGxlZCcgOiBqb2IudHlwZV19XG4gICAgICAgIC8+KVxuICAgIH07XG4gICAgbGV0IHN0YXJ0RXJyb3JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5zdGFydFRpbWUsIGpvYi5zdGFydFRpbWVBY3R1YWxdLnNvcnQoKGEsYik9PmEtYik7XG4gICAgICAgIHN0YXJ0RXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgZmlsbD17R1JBUEhfQ09MT1JTLmRlc3luY31cbiAgICAgICAgIC8+KTtcbiAgICB9XG4gICAgbGV0IGVuZEVycm9yQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLmVuZFRpbWVBY3R1YWwpIHtcbiAgICAgICAgY29uc3QgW3QxLCB0Ml0gPSBbam9iLmVuZFRpbWUsIGpvYi5lbmRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICBlbmRFcnJvckJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUodDEpfSB3aWR0aD17Y29udmVydFRpbWUodDItdDEgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBmaWxsPXtHUkFQSF9DT0xPUlMuZGVzeW5jfVxuICAgICAgICAgLz4pO1xuICAgIH1cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke3l9KWB9PlxuICAgICAgICAgICAge2pvYkJhcn1cbiAgICAgICAgICAgIHtzdGFydEVycm9yQmFyfVxuICAgICAgICAgICAge2VuZEVycm9yQmFyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxudHlwZSBUaW1lVmFsdWUgPSBbVGltZU1zLCBudW1iZXJdO1xuaW50ZXJmYWNlIFNlY3VyaXR5TGF5ZXJQcm9wcyB7XG4gICAgZXhwZWN0ZWRTZXJ2ZXJzOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2VbXTtcbiAgICBvYnNlcnZlZFNlcnZlcnM6IE9ic2VydmVkU2VydmVyTWVzc2FnZVtdXG59XG5mdW5jdGlvbiBTZWN1cml0eUxheWVyKHtleHBlY3RlZFNlcnZlcnMsIG9ic2VydmVkU2VydmVyc306U2VjdXJpdHlMYXllclByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBleHBlY3RlZFNlcnZlcnMgPz89IFtdO1xuICAgIG9ic2VydmVkU2VydmVycyA/Pz0gW107XG4gICAgbGV0IG1pblNlYyA9IDA7XG4gICAgbGV0IG1heFNlYyA9IDE7XG4gICAgZm9yIChjb25zdCBzbmFwc2hvdHMgb2YgW2V4cGVjdGVkU2VydmVycywgb2JzZXJ2ZWRTZXJ2ZXJzXSkge1xuICAgICAgICBmb3IgKGNvbnN0IHNlcnZlciBvZiBzbmFwc2hvdHMpIHtcbiAgICAgICAgICAgIG1pblNlYyA9IE1hdGgubWluKG1pblNlYywgc2VydmVyLmhhY2tEaWZmaWN1bHR5KTtcbiAgICAgICAgICAgIG1heFNlYyA9IE1hdGgubWF4KG1heFNlYywgc2VydmVyLmhhY2tEaWZmaWN1bHR5KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG9ic2VydmVkRXZlbnRzID0gb2JzZXJ2ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyKT0+W3NlcnZlci50aW1lLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHldKSBhcyBUaW1lVmFsdWVbXTtcbiAgICBjb25zdCBzaG91bGRDbG9zZVBhdGggPSB0cnVlO1xuICAgIGNvbnN0IG9ic2VydmVkUGF0aCA9IGNvbXB1dGVQYXRoRGF0YShvYnNlcnZlZEV2ZW50cywgbWluU2VjLCBzaG91bGRDbG9zZVBhdGgpO1xuICAgIGNvbnN0IG9ic2VydmVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwib2JzZXJ2ZWRTZWNcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heFNlYyAtIG1pblNlYyl9KWB9XG4gICAgICAgICAgICBmaWxsPXtcImRhcmtcIitHUkFQSF9DT0xPUlMuc2VjdXJpdHl9XG4gICAgICAgICAgICAvLyBmaWxsT3BhY2l0eTogMC41LFxuICAgICAgICAgICAgY2xpcFBhdGg9e2B1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWB9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxwYXRoIGQ9e29ic2VydmVkUGF0aC5qb2luKFwiIFwiKX0gLz5cbiAgICAgICAgPC9nPlxuICAgICk7XG5cbiAgICBjb25zdCBleHBlY3RlZEV2ZW50cyA9IGV4cGVjdGVkU2VydmVycy5tYXAoKHNlcnZlcik9PltzZXJ2ZXIudGltZSwgc2VydmVyLmhhY2tEaWZmaWN1bHR5XSkgYXMgVGltZVZhbHVlW107XG4gICAgY29uc3QgcHJlZGljdGVkUGF0aCA9IGNvbXB1dGVQYXRoRGF0YShleHBlY3RlZEV2ZW50cyk7XG4gICAgY29uc3QgcHJlZGljdGVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwicHJlZGljdGVkU2VjXCJcbiAgICAgICAgICAgIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhTZWMgLSBtaW5TZWMpfSlgfVxuICAgICAgICAgICAgc3Ryb2tlPXtHUkFQSF9DT0xPUlMuc2VjdXJpdHl9XG4gICAgICAgICAgICBmaWxsPVwibm9uZVwiXG4gICAgICAgICAgICBzdHJva2VXaWR0aD17Mn1cbiAgICAgICAgICAgIHN0cm9rZUxpbmVqb2luPVwiYmV2ZWxcIlxuICAgICAgICA+XG4gICAgICAgICAgICA8cGF0aCBkPXtwcmVkaWN0ZWRQYXRoLmpvaW4oXCIgXCIpfSB2ZWN0b3JFZmZlY3Q9XCJub24tc2NhbGluZy1zdHJva2VcIiAvPlxuICAgICAgICA8L2c+XG4gICAgKTtcblxuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwic2VjTGF5ZXJcIiB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSAyKkZPT1RFUl9QSVhFTFN9KWB9PlxuICAgICAgICAgICAge29ic2VydmVkTGF5ZXJ9XG4gICAgICAgICAgICB7cHJlZGljdGVkTGF5ZXJ9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBjb21wdXRlUGF0aERhdGEoZXZlbnRzOiBUaW1lVmFsdWVbXSwgbWluVmFsdWU9MCwgc2hvdWxkQ2xvc2U9ZmFsc2UsIHNjYWxlPTEpIHtcbiAgICBjb25zdCBwYXRoRGF0YSA9IFtdO1xuICAgIGlmIChldmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBbdGltZSwgdmFsdWVdID0gZXZlbnRzWzBdO1xuICAgICAgICAvLyBzdGFydCBsaW5lIGF0IGZpcnN0IHByb2plY3RlZCB0aW1lIGFuZCB2YWx1ZVxuICAgICAgICBwYXRoRGF0YS5wdXNoKGBNICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX0sJHsodmFsdWUqc2NhbGUpLnRvRml4ZWQoMil9YCk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgW3RpbWUsIHZhbHVlXSBvZiBldmVudHMpIHtcbiAgICAgICAgLy8gaG9yaXpvbnRhbCBsaW5lIHRvIGN1cnJlbnQgdGltZVxuICAgICAgICBwYXRoRGF0YS5wdXNoKGBIICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX1gKVxuICAgICAgICAvLyB2ZXJ0aWNhbCBsaW5lIHRvIG5ldyBsZXZlbFxuICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KHZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgIH1cbiAgICAvLyBmaWxsIGluIGFyZWEgYmV0d2VlbiBsYXN0IHNuYXBzaG90IGFuZCByaWdodCBzaWRlIChhcmVhIGFmdGVyIFwibm93XCIgY3Vyc29yIHdpbGwgYmUgY2xpcHBlZCBsYXRlcilcbiAgICBpZiAoZXZlbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgW3RpbWUsIHZhbHVlXSA9IGV2ZW50c1tldmVudHMubGVuZ3RoLTFdO1xuICAgICAgICAvLyB2ZXJ0aWNhbCBsaW5lIHRvIHByZXZpb3VzIGxldmVsXG4gICAgICAgIC8vIGhvcml6b250YWwgbGluZSB0byBmdXR1cmUgdGltZVxuICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KHZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWAsIGBIICR7Y29udmVydFRpbWUodGltZSArIDYwMDAwMCkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgaWYgKHNob3VsZENsb3NlKSB7XG4gICAgICAgICAgICAvLyBmaWxsIGFyZWEgdW5kZXIgYWN0dWFsIHNlY3VyaXR5XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KG1pblZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgICAgICAgICAgY29uc3QgbWluVGltZSA9IGV2ZW50c1swXVswXTtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYEggJHtjb252ZXJ0VGltZShtaW5UaW1lKS50b0ZpeGVkKDMpfWApO1xuICAgICAgICAgICAgcGF0aERhdGEucHVzaCgnWicpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBwYXRoRGF0YTtcbn1cblxuZnVuY3Rpb24gTW9uZXlMYXllcihwcm9wczogU2VjdXJpdHlMYXllclByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICByZXR1cm4gPGcgaWQ9XCJtb25leUxheWVyXCIgLz5cbn1cblxuLy8gLS0tLS0gcHJlLVJlYWN0IHZlcnNpb24gLS0tLS1cblxuLyoqXG4gKiByZW5kZXJCYXRjaGVzIC0gY3JlYXRlIGFuIFNWRyBlbGVtZW50IHdpdGggYSBncmFwaCBvZiBqb2JzXG4gKiBAcGFyYW0ge1NWR1NWR0VsZW1lbnR9IFtlbF0gLSBTVkcgZWxlbWVudCB0byByZXVzZS4gV2lsbCBiZSBjcmVhdGVkIGlmIGl0IGRvZXMgbm90IGV4aXN0IHlldC5cbiAqIEBwYXJhbSB7Sm9iW11bXX0gYmF0Y2hlcyAtIGFycmF5IG9mIGFycmF5cyBvZiBqb2JzXG4gKiBAcGFyYW0ge251bWJlcn0gW25vd10gLSBjdXJyZW50IHRpbWUgKG9wdGlvbmFsKVxuICogQHJldHVybnMge1NWR1NWR0VsZW1lbnR9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJCYXRjaGVzKGVsOiBIVE1MRWxlbWVudCwgYmF0Y2hlcz1bXSwgc2VydmVyU25hcHNob3RzPVtdLCBub3c6IFRpbWVNcykge1xuICAgIG5vdyB8fD0gcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zO1xuXG4gICAgLy8gUmVuZGVyIHRoZSBtYWluIFNWRyBlbGVtZW50IGlmIG5lZWRlZFxuICAgIGVsIHx8PSBzdmdFbChcbiAgICAgICAgXCJzdmdcIixcbiAgICAgICAge1xuICAgICAgICAgICAgdmVyc2lvbjogXCIxLjFcIiwgd2lkdGg6V0lEVEhfUElYRUxTLCBoZWlnaHQ6IEhFSUdIVF9QSVhFTFMsXG4gICAgICAgICAgICAvLyBTZXQgdGhlIHZpZXdCb3ggZm9yIDEwIHNlY29uZHMgb2YgaGlzdG9yeSwgNiBzZWNvbmRzIG9mIGZ1dHVyZS5cbiAgICAgICAgICAgIHZpZXdCb3g6IGAke2NvbnZlcnRTZWNUb1B4KC0xMCl9IDAgJHtXSURUSF9QSVhFTFN9ICR7SEVJR0hUX1BJWEVMU31gXG4gICAgICAgIH0sXG4gICAgICAgIFtcbiAgICAgICAgICAgIFtcImRlZnNcIiwge30sIFtcbiAgICAgICAgICAgICAgICBbXCJjbGlwUGF0aFwiLCB7aWQ6YGhpZGUtZnV0dXJlLSR7aW5pdFRpbWV9YCwgY2xpcFBhdGhVbml0czogXCJ1c2VyU3BhY2VPblVzZVwifSwgW1xuICAgICAgICAgICAgICAgICAgICBbXCJyZWN0XCIsIHtpZDpcImhpZGUtZnV0dXJlLXJlY3RcIiwgeDpjb252ZXJ0VGltZShub3ctNjAwMDApLCB3aWR0aDpjb252ZXJ0VGltZSg2MDAwMCwwKSwgeTowLCBoZWlnaHQ6IDUwfV1cbiAgICAgICAgICAgICAgICBdXVxuICAgICAgICAgICAgXV0sXG4gICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImJhY2tncm91bmRcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgaGVpZ2h0OlwiMTAwJVwiLCBmaWxsOkdSQVBIX0NPTE9SUy5zYWZlfV0sXG4gICAgICAgICAgICBbXCJnXCIsIHtpZDpcInRpbWVDb29yZGluYXRlc1wifSwgW1xuICAgICAgICAgICAgICAgIFtcImdcIiwge2lkOlwic2FmZXR5TGF5ZXJcIn1dLFxuICAgICAgICAgICAgICAgIFtcImdcIiwge2lkOlwiam9iTGF5ZXJcIn1dLFxuICAgICAgICAgICAgICAgIFtcImdcIiwge2lkOlwic2VjTGF5ZXJcIn1dLFxuICAgICAgICAgICAgICAgIFtcImdcIiwge2lkOlwibW9uZXlMYXllclwifV1cbiAgICAgICAgICAgIF1dLFxuICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTFcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLUZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0yXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy0yKkZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgIFtcInJlY3RcIiwge2lkOlwiY3Vyc29yXCIsIHg6MCwgd2lkdGg6MSwgeTowLCBoZWlnaHQ6IFwiMTAwJVwiLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgIHJlbmRlckxlZ2VuZCgpXG4gICAgICAgIF1cbiAgICApO1xuXG4gICAgLy8gVXBkYXRlIHRoZSB0aW1lIGNvb3JkaW5hdGVzIGV2ZXJ5IGZyYW1lXG4gICAgY29uc3QgZGF0YUVsID0gZWwuZ2V0RWxlbWVudEJ5SWQoXCJ0aW1lQ29vcmRpbmF0ZXNcIik7XG4gICAgZGF0YUVsLnNldEF0dHJpYnV0ZSgndHJhbnNmb3JtJyxcbiAgICAgICAgYHNjYWxlKCR7V0lEVEhfUElYRUxTIC8gV0lEVEhfU0VDT05EU30gMSkgdHJhbnNsYXRlKCR7Y29udmVydFRpbWUoaW5pdFRpbWUtbm93LCAwKX0gMClgXG4gICAgKTtcbiAgICBlbC5nZXRFbGVtZW50QnlJZChcImhpZGUtZnV0dXJlLXJlY3RcIikuc2V0QXR0cmlidXRlKCd4JywgY29udmVydFRpbWUobm93LTYwMDAwKSk7XG4gICAgXG4gICAgLy8gT25seSB1cGRhdGUgdGhlIG1haW4gZGF0YSBldmVyeSAyNTAgbXNcbiAgICBjb25zdCBsYXN0VXBkYXRlID0gZGF0YUVsLmdldEF0dHJpYnV0ZSgnZGF0YS1sYXN0LXVwZGF0ZScpIHx8IDA7XG4gICAgaWYgKG5vdyAtIGxhc3RVcGRhdGUgPCAyNTApIHtcbiAgICAgICAgcmV0dXJuIGVsO1xuICAgIH1cbiAgICBkYXRhRWwuc2V0QXR0cmlidXRlKCdkYXRhLWxhc3QtdXBkYXRlJywgbm93KTtcblxuICAgIGNvbnN0IGV2ZW50U25hcHNob3RzID0gYmF0Y2hlcy5mbGF0KCkubWFwKChqb2IpPT4oXG4gICAgICAgIFtqb2IuZW5kVGltZSwgam9iLnJlc3VsdF1cbiAgICApKTtcbiAgICBcbiAgICAvLyBSZW5kZXIgZWFjaCBqb2IgYmFja2dyb3VuZCBhbmQgZm9yZWdyb3VuZFxuICAgIHdoaWxlKGRhdGFFbC5maXJzdENoaWxkKSB7XG4gICAgICAgIGRhdGFFbC5yZW1vdmVDaGlsZChkYXRhRWwuZmlyc3RDaGlsZCk7XG4gICAgfVxuICAgIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJTYWZldHlMYXllcihiYXRjaGVzLCBub3cpKTtcbiAgICBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVySm9iTGF5ZXIoYmF0Y2hlcywgbm93KSk7XG4gICAgZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlclNlY3VyaXR5TGF5ZXIoZXZlbnRTbmFwc2hvdHMsIHNlcnZlclNuYXBzaG90cywgbm93KSk7XG4gICAgLy8gZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlck1vbmV5TGF5ZXIoZXZlbnRTbmFwc2hvdHMsIHNlcnZlclNuYXBzaG90cywgbm93KSk7XG4gICAgZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlclByb2ZpdExheWVyKGJhdGNoZXMsIG5vdykpO1xuXG4gICAgcmV0dXJuIGVsO1xufVxuXG5cbmZ1bmN0aW9uIHJlbmRlclByb2ZpdFBhdGgoYmF0Y2hlcz1bXSwgbm93LCBzY2FsZT0xKSB7XG4gICAgLy8gd291bGQgbGlrZSB0byBncmFwaCBtb25leSBwZXIgc2Vjb25kIG92ZXIgdGltZVxuICAgIC8vIGNvbnN0IG1vbmV5VGFrZW4gPSBbXTtcbiAgICBjb25zdCB0b3RhbE1vbmV5VGFrZW4gPSBbXTtcbiAgICBsZXQgcnVubmluZ1RvdGFsID0gMDtcbiAgICBmb3IgKGNvbnN0IGJhdGNoIG9mIGJhdGNoZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBqb2Igb2YgYmF0Y2gpIHtcbiAgICAgICAgICAgIGlmIChqb2IudGFzayA9PSAnaGFjaycgJiYgam9iLmVuZFRpbWVBY3R1YWwpIHtcbiAgICAgICAgICAgICAgICAvLyBtb25leVRha2VuLnB1c2goW2pvYi5lbmRUaW1lQWN0dWFsLCBqb2IucmVzdWx0QWN0dWFsXSk7XG4gICAgICAgICAgICAgICAgcnVubmluZ1RvdGFsICs9IGpvYi5yZXN1bHRBY3R1YWw7XG4gICAgICAgICAgICAgICAgdG90YWxNb25leVRha2VuLnB1c2goW2pvYi5lbmRUaW1lQWN0dWFsLCBydW5uaW5nVG90YWxdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGpvYi50YXNrID09ICdoYWNrJyAmJiAham9iLmNhbmNlbGxlZCkge1xuICAgICAgICAgICAgICAgIHJ1bm5pbmdUb3RhbCArPSBqb2IuY2hhbmdlLnBsYXllck1vbmV5O1xuICAgICAgICAgICAgICAgIHRvdGFsTW9uZXlUYWtlbi5wdXNoKFtqb2IuZW5kVGltZSwgcnVubmluZ1RvdGFsXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgdG90YWxNb25leVRha2VuLnB1c2goW25vdyArIDMwMDAwLCBydW5uaW5nVG90YWxdKTtcbiAgICAvLyBtb25leSB0YWtlbiBpbiB0aGUgbGFzdCBYIHNlY29uZHMgY291bGQgYmUgY291bnRlZCB3aXRoIGEgc2xpZGluZyB3aW5kb3cuXG4gICAgLy8gYnV0IHRoZSByZWNvcmRlZCBldmVudHMgYXJlIG5vdCBldmVubHkgc3BhY2VkLlxuICAgIGNvbnN0IG1vdmluZ0F2ZXJhZ2UgPSBbXTtcbiAgICBsZXQgbWF4UHJvZml0ID0gMDtcbiAgICBsZXQgaiA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b3RhbE1vbmV5VGFrZW4ubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgW3RpbWUsIG1vbmV5XSA9IHRvdGFsTW9uZXlUYWtlbltpXTtcbiAgICAgICAgd2hpbGUgKHRvdGFsTW9uZXlUYWtlbltqXVswXSA8PSB0aW1lIC0gMjAwMCkge1xuICAgICAgICAgICAgaisrO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHByb2ZpdCA9IHRvdGFsTW9uZXlUYWtlbltpXVsxXSAtIHRvdGFsTW9uZXlUYWtlbltqXVsxXTtcbiAgICAgICAgbW92aW5nQXZlcmFnZS5wdXNoKFt0aW1lLCBwcm9maXRdKTtcbiAgICAgICAgbWF4UHJvZml0ID0gTWF0aC5tYXgobWF4UHJvZml0LCBwcm9maXQpO1xuICAgIH1cbiAgICBldmFsKFwid2luZG93XCIpLnByb2ZpdERhdGEgPSBbdG90YWxNb25leVRha2VuLCBydW5uaW5nVG90YWwsIG1vdmluZ0F2ZXJhZ2VdO1xuICAgIGNvbnN0IHBhdGhEYXRhID0gW1wiTSAwLDBcIl07XG4gICAgbGV0IHByZXZUaW1lO1xuICAgIGxldCBwcmV2UHJvZml0O1xuICAgIGZvciAoY29uc3QgW3RpbWUsIHByb2ZpdF0gb2YgbW92aW5nQXZlcmFnZSkge1xuICAgICAgICAvLyBwYXRoRGF0YS5wdXNoKGBMICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX0sJHsoc2NhbGUgKiBwcm9maXQvbWF4UHJvZml0KS50b0ZpeGVkKDMpfWApO1xuICAgICAgICBpZiAocHJldlByb2ZpdCkge1xuICAgICAgICAgICAgcGF0aERhdGEucHVzaChgQyAke2NvbnZlcnRUaW1lKChwcmV2VGltZSozICsgdGltZSkvNCkudG9GaXhlZCgzKX0sJHsoc2NhbGUgKiBwcmV2UHJvZml0L21heFByb2ZpdCkudG9GaXhlZCgzKX0gJHtjb252ZXJ0VGltZSgocHJldlRpbWUgKyAzKnRpbWUpLzQpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJvZml0L21heFByb2ZpdCkudG9GaXhlZCgzKX0gJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfSwkeyhzY2FsZSAqIHByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9YClcbiAgICAgICAgfVxuICAgICAgICBwcmV2VGltZSA9IHRpbWU7XG4gICAgICAgIHByZXZQcm9maXQgPSBwcm9maXQ7XG4gICAgfVxuICAgIHBhdGhEYXRhLnB1c2goYEggJHtjb252ZXJ0VGltZShub3crNjAwMDApLnRvRml4ZWQoMyl9IFYgMCBaYCk7XG4gICAgcmV0dXJuIHN2Z0VsKCdwYXRoJywge1xuICAgICAgICBkOiBwYXRoRGF0YS5qb2luKCcgJyksXG4gICAgICAgIFwidmVjdG9yLWVmZmVjdFwiOiBcIm5vbi1zY2FsaW5nLXN0cm9rZVwiXG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclByb2ZpdExheWVyKGJhdGNoZXM9W10sIG5vdykge1xuICAgIGNvbnN0IHByb2ZpdFBhdGggPSByZW5kZXJQcm9maXRQYXRoKGJhdGNoZXMsIG5vdyk7XG4gICAgY29uc3Qgb2JzZXJ2ZWRQcm9maXQgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcIm9ic2VydmVkUHJvZml0XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFN9KWAsXG4gICAgICAgICAgICBmaWxsOiBcImRhcmtcIitHUkFQSF9DT0xPUlMubW9uZXksXG4gICAgICAgICAgICBcImNsaXAtcGF0aFwiOiBgdXJsKCNoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfSlgXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIHByb2ZpdFBhdGhcbiAgICAgICAgXVxuICAgICk7XG4gICAgY29uc3QgcHJvamVjdGVkUHJvZml0ID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJwcm9qZWN0ZWRQcm9maXRcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMU30pYCxcbiAgICAgICAgICAgIGZpbGw6IFwibm9uZVwiLFxuICAgICAgICAgICAgc3Ryb2tlOiBHUkFQSF9DT0xPUlMubW9uZXksXG4gICAgICAgICAgICBcInN0cm9rZS13aWR0aFwiOiAyLFxuICAgICAgICAgICAgXCJzdHJva2UtbGluZWpvaW5cIjpcInJvdW5kXCJcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgcHJvZml0UGF0aC5jbG9uZU5vZGUoKVxuICAgICAgICBdXG4gICAgKTtcbiAgICBjb25zdCBwcm9maXRMYXllciA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwicHJvZml0TGF5ZXJcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7SEVJR0hUX1BJWEVMUyAtIEZPT1RFUl9QSVhFTFN9KWBcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgb2JzZXJ2ZWRQcm9maXQsXG4gICAgICAgICAgICBwcm9qZWN0ZWRQcm9maXRcbiAgICAgICAgXVxuICAgICk7XG4gICAgcmV0dXJuIHByb2ZpdExheWVyO1xufVxuXG5mdW5jdGlvbiByZW5kZXJNb25leUxheWVyKGV2ZW50U25hcHNob3RzPVtdLCBzZXJ2ZXJTbmFwc2hvdHM9W10sIG5vdykge1xuICAgIGNvbnN0IG1vbmV5TGF5ZXIgPSBzdmdFbChcImdcIiwge1xuICAgICAgICBpZDogXCJtb25leUxheWVyXCIsXG4gICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7SEVJR0hUX1BJWEVMUyAtIEZPT1RFUl9QSVhFTFN9KWBcbiAgICB9KTtcblxuICAgIGlmIChzZXJ2ZXJTbmFwc2hvdHMubGVuZ3RoID09IDApIHtcbiAgICAgICAgcmV0dXJuIG1vbmV5TGF5ZXI7XG4gICAgfVxuICAgIGxldCBtaW5Nb25leSA9IDA7XG4gICAgbGV0IG1heE1vbmV5ID0gc2VydmVyU25hcHNob3RzWzBdWzFdLm1vbmV5TWF4O1xuICAgIGNvbnN0IHNjYWxlID0gMS9tYXhNb25leTtcbiAgICBtYXhNb25leSAqPSAxLjFcblxuICAgIGNvbnN0IG9ic2VydmVkTGF5ZXIgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcIm9ic2VydmVkTW9uZXlcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhNb25leSAtIG1pbk1vbmV5KSAvIHNjYWxlfSlgLFxuICAgICAgICAgICAgZmlsbDogXCJkYXJrXCIrR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgLy8gXCJmaWxsLW9wYWNpdHlcIjogMC41LFxuICAgICAgICAgICAgXCJjbGlwLXBhdGhcIjogYHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYFxuICAgICAgICB9LCBbXG4gICAgICAgICAgICByZW5kZXJPYnNlcnZlZFBhdGgoXCJtb25leUF2YWlsYWJsZVwiLCBzZXJ2ZXJTbmFwc2hvdHMsIG1pbk1vbmV5LCBub3csIHNjYWxlKVxuICAgICAgICBdXG4gICAgKTtcbiAgICBtb25leUxheWVyLmFwcGVuZChvYnNlcnZlZExheWVyKTtcblxuICAgIGNvbnN0IHByb2plY3RlZExheWVyID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJwcm9qZWN0ZWRNb25leVwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heE1vbmV5IC0gbWluTW9uZXkpIC8gc2NhbGV9KWAsXG4gICAgICAgICAgICBzdHJva2U6IEdSQVBIX0NPTE9SUy5tb25leSxcbiAgICAgICAgICAgIGZpbGw6IFwibm9uZVwiLFxuICAgICAgICAgICAgXCJzdHJva2Utd2lkdGhcIjogMixcbiAgICAgICAgICAgIFwic3Ryb2tlLWxpbmVqb2luXCI6XCJiZXZlbFwiXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIGNvbXB1dGVQcm9qZWN0ZWRQYXRoKFwibW9uZXlBdmFpbGFibGVcIiwgZXZlbnRTbmFwc2hvdHMsIG5vdywgc2NhbGUpXG4gICAgICAgIF1cbiAgICApO1xuICAgIG1vbmV5TGF5ZXIuYXBwZW5kKHByb2plY3RlZExheWVyKTtcblxuICAgIHJldHVybiBtb25leUxheWVyO1xufVxuXG4iXX0=