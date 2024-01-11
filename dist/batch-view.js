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
            };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBNERFO0FBSUYsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLEtBQThCLENBQUM7QUFTeEQsSUFBSSxRQUFRLEdBQUcsV0FBVyxDQUFDLEdBQUcsRUFBWSxDQUFDO0FBQzNDOzs7O0dBSUc7QUFDSCxTQUFTLFdBQVcsQ0FBQyxDQUFTLEVBQUUsRUFBRSxHQUFDLFFBQVE7SUFDdkMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBZ0IsQ0FBQztBQUM1QyxDQUFDO0FBRUQsU0FBUyxjQUFjLENBQUMsQ0FBYztJQUNsQyxPQUFPLENBQUMsR0FBRyxZQUFZLEdBQUcsYUFBMkIsQ0FBQztBQUMxRCxDQUFDO0FBRUQsTUFBTSxZQUFZLEdBQUc7SUFDakIsTUFBTSxFQUFFLE1BQU07SUFDZCxNQUFNLEVBQUUsWUFBWTtJQUNwQixRQUFRLEVBQUUsUUFBUTtJQUNsQixXQUFXLEVBQUUsS0FBSztJQUNsQixRQUFRLEVBQUUsU0FBUztJQUNuQixNQUFNLEVBQUUsTUFBTTtJQUNkLFFBQVEsRUFBRSxNQUFNO0lBQ2hCLFVBQVUsRUFBRSxLQUFLO0lBQ2pCLE9BQU8sRUFBRSxNQUFNO0NBQ2xCLENBQUM7QUFFRixNQUFNLFlBQVksR0FBRyxHQUFpQixDQUFDO0FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEVBQWlCLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUcsR0FBYSxDQUFDO0FBQ3BDLE1BQU0sYUFBYSxHQUFHLEVBQVksQ0FBQztBQUNuQyxpR0FBaUc7QUFDakcsMEdBQTBHO0FBQzFHLDJFQUEyRTtBQUczRSxtQkFBbUI7QUFFbkIsTUFBTSxLQUFLLEdBQXFEO0lBQzVE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QUFDO0lBRWpDLE1BQU0sY0FBYyxHQUFHLEtBQUssQ0FDeEIsR0FBRyxFQUFFO1FBQ0QsRUFBRSxFQUFFLGdCQUFnQjtRQUNwQixTQUFTLEVBQUUsZUFBZSxhQUFhLGFBQWEsQ0FBQyxhQUFhLEdBQUcsQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDLEdBQUcsS0FBSyxHQUFHO1FBQ3JHLE1BQU0sRUFBRSxZQUFZLENBQUMsS0FBSztRQUMxQixJQUFJLEVBQUUsTUFBTTtRQUNaLGNBQWMsRUFBRSxDQUFDO1FBQ2pCLGlCQUFpQixFQUFDLE9BQU87S0FDNUIsRUFBRTtRQUNDLG9CQUFvQixDQUFDLGdCQUFnQixFQUFFLGNBQWMsRUFBRSxHQUFHLEVBQUUsS0FBSyxDQUFDO0tBQ3JFLENBQ0osQ0FBQztJQUNGLFVBQVUsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUM7SUFFbEMsT0FBTyxVQUFVLENBQUM7QUFDdEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qXG5cblVzYWdlXG4tLS0tLVxuXG5TdGFydCB0aGUgYmF0Y2ggdmlld2VyIHNjcmlwdCBmcm9tIHRoZSBjb21tYW5kIGxpbmU6XG5cbiAgICBydW4gYmF0Y2gtdmlldy5qcyAtLXBvcnQgMTBcblxuVGhlbiBzZW5kIG1lc3NhZ2VzIHRvIGl0IGZyb20gb3RoZXIgc2NyaXB0cy5cblxuRXhhbXBsZTogRGlzcGxheSBhY3Rpb24gdGltaW5nIChoYWNrIC8gZ3JvdyAvIHdlYWtlbilcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnaGFjaycsXG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBzdGFydFRpbWU6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgICAgICBkdXJhdGlvbjogbnMuZ2V0SGFja1RpbWUodGFyZ2V0KSxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IFVwZGF0ZSBhbiBhY3Rpb24gdGhhdCBoYXMgYWxyZWFkeSBiZWVuIGRpc3BsYXllZFxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBzdGFydFRpbWVBY3R1YWw6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgIH0pKTtcbiAgICBhd2FpdCBucy5oYWNrKHRhcmdldCk7XG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBlbmRUaW1lQWN0dWFsOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IERpc3BsYXkgYSBibGFuayByb3cgYmV0d2VlbiBhY3Rpb25zICh0byB2aXN1YWxseSBzZXBhcmF0ZSBiYXRjaGVzKVxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdzcGFjZXInLFxuICAgIH0pKTtcblxuRXhhbXBsZTogRGlzcGxheSBvYnNlcnZlZCBzZWN1cml0eSAvIG1vbmV5IGxldmVsXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ29ic2VydmVkJyxcbiAgICAgICAgdGltZTogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgICAgIG1pbkRpZmZpY3VsdHk6IG5zLmdldFNlcnZlck1pblNlY3VyaXR5TGV2ZWwodGFyZ2V0KSxcbiAgICAgICAgaGFja0RpZmZpY3VsdHk6IG5zLmdldFNlcnZlclNlY3VyaXR5TGV2ZWwodGFyZ2V0KSxcbiAgICAgICAgbW9uZXlNYXg6IG5zLmdldFNlcnZlck1heE1vbmV5KHRhcmdldCksXG4gICAgICAgIG1vbmV5QXZhaWxhYmxlOiBucy5nZXRTZXJ2ZXJNb25leUF2YWlsYWJsZSh0YXJnZXQpLFxuICAgIH0pKTtcblxuRXhhbXBsZTogRGlzcGxheSBleHBlY3RlZCBzZWN1cml0eSAvIG1vbmV5IGxldmVsICh2YXJpZXMgYnkgYWN0aW9uIHR5cGUgYW5kIHlvdXIgc3RyYXRlZ3kpXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ2V4cGVjdGVkJyxcbiAgICAgICAgdGltZTogam9iLnN0YXJ0VGltZSArIGpvYi5kdXJhdGlvbixcbiAgICAgICAgbWluRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyTWluU2VjdXJpdHlMZXZlbCh0YXJnZXQpLFxuICAgICAgICBoYWNrRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyU2VjdXJpdHlMZXZlbCh0YXJnZXQpICsgbnMuaGFja0FuYWx5emVTZWN1cml0eShqb2IudGhyZWFkcyksXG4gICAgICAgIG1vbmV5TWF4OiBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpLFxuICAgICAgICBtb25leUF2YWlsYWJsZTogTWF0aC5tYXgoMCwgbnMuZ2V0U2VydmVyTWF4TW9uZXkodGFyZ2V0KSAtIG5zLmhhY2tBbmFseXplKHRhcmdldCkgKiBqb2IudGhyZWFkcyAqIG5zLmhhY2tBbmFseXplQ2hhbmNlKHRhcmdldCkpLFxuICAgIH0pKTtcblxuKi9cblxuaW1wb3J0IHR5cGUgeyBOUywgTmV0c2NyaXB0UG9ydCwgU2VydmVyIH0gZnJvbSAnQG5zJztcbmltcG9ydCB0eXBlIFJlYWN0TmFtZXNwYWNlIGZyb20gJ3JlYWN0L2luZGV4JztcbmNvbnN0IFJlYWN0ID0gZ2xvYmFsVGhpcy5SZWFjdCBhcyB0eXBlb2YgUmVhY3ROYW1lc3BhY2U7XG5cbi8vIC0tLS0tIGNvbnN0YW50cyAtLS0tLSBcblxudHlwZSBUaW1lTXMgPSBSZXR1cm5UeXBlPHR5cGVvZiBwZXJmb3JtYW5jZS5ub3c+ICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwibWlsbGlzZWNvbmRzXCIgfTtcbnR5cGUgVGltZVNlY29uZHMgPSBudW1iZXIgJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJzZWNvbmRzXCIgfTtcbnR5cGUgVGltZVBpeGVscyA9IG51bWJlciAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcInBpeGVsc1wiIH07XG50eXBlIFBpeGVscyA9IG51bWJlciAmIHsgX191bml0czogXCJwaXhlbHNcIiB9O1xuXG5sZXQgaW5pdFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXM7XG4vKipcbiAqIENvbnZlcnQgdGltZXN0YW1wcyB0byBzZWNvbmRzIHNpbmNlIHRoZSBncmFwaCB3YXMgc3RhcnRlZC5cbiAqIFRvIHJlbmRlciBTVkdzIHVzaW5nIG5hdGl2ZSB0aW1lIHVuaXRzLCB0aGUgdmFsdWVzIG11c3QgYmUgdmFsaWQgMzItYml0IGludHMuXG4gKiBTbyB3ZSBjb252ZXJ0IHRvIGEgcmVjZW50IGVwb2NoIGluIGNhc2UgRGF0ZS5ub3coKSB2YWx1ZXMgYXJlIHVzZWQuXG4gKi9cbmZ1bmN0aW9uIGNvbnZlcnRUaW1lKHQ6IFRpbWVNcywgdDA9aW5pdFRpbWUpOiBUaW1lU2Vjb25kcyB7XG4gICAgcmV0dXJuICgodCAtIHQwKSAvIDEwMDApIGFzIFRpbWVTZWNvbmRzO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0U2VjVG9QeCh0OiBUaW1lU2Vjb25kcyk6IFRpbWVQaXhlbHMge1xuICAgIHJldHVybiB0ICogV0lEVEhfUElYRUxTIC8gV0lEVEhfU0VDT05EUyBhcyBUaW1lUGl4ZWxzO1xufVxuXG5jb25zdCBHUkFQSF9DT0xPUlMgPSB7XG4gICAgXCJoYWNrXCI6IFwiY3lhblwiLFxuICAgIFwiZ3Jvd1wiOiBcImxpZ2h0Z3JlZW5cIixcbiAgICBcIndlYWtlblwiOiBcInllbGxvd1wiLFxuICAgIFwiY2FuY2VsbGVkXCI6IFwicmVkXCIsXG4gICAgXCJkZXN5bmNcIjogXCJtYWdlbnRhXCIsXG4gICAgXCJzYWZlXCI6IFwiIzExMVwiLFxuICAgIFwidW5zYWZlXCI6IFwiIzMzM1wiLFxuICAgIFwic2VjdXJpdHlcIjogXCJyZWRcIixcbiAgICBcIm1vbmV5XCI6IFwiYmx1ZVwiXG59O1xuXG5jb25zdCBXSURUSF9QSVhFTFMgPSA4MDAgYXMgVGltZVBpeGVscztcbmNvbnN0IFdJRFRIX1NFQ09ORFMgPSAxNiBhcyBUaW1lU2Vjb25kcztcbmNvbnN0IEhFSUdIVF9QSVhFTFMgPSA2MDAgYXMgUGl4ZWxzO1xuY29uc3QgRk9PVEVSX1BJWEVMUyA9IDUwIGFzIFBpeGVscztcbi8vIFRPRE86IHVzZSBhIGNvbnRleHQgZm9yIHRoZXNlIHNjYWxlIGZhY3RvcnMuIHN1cHBvcnQgc2V0dGluZyB0aGVtIGJ5IGFyZ3MgYW5kIHNjcm9sbC1nZXN0dXJlcy5cbi8vIGNvbnN0IFNjcmVlbkNvbnRleHQgPSBSZWFjdC5jcmVhdGVDb250ZXh0KHtXSURUSF9QSVhFTFMsIFdJRFRIX1NFQ09ORFMsIEhFSUdIVF9QSVhFTFMsIEZPT1RFUl9QSVhFTFN9KTtcbi8vIFRPRE86IHJldmlldyB1c2Ugb2YgNjAwMDAwLCA2MDAwMCwgYW5kIFdJRFRIX1NFQ09ORFMgYXMgY2xpcHBpbmcgbGltaXRzLlxuXG5cbi8vIC0tLS0tIG1haW4gLS0tLS1cblxuY29uc3QgRkxBR1M6IFtzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBzdHJpbmdbXV1bXSA9IFtcbiAgICBbXCJoZWxwXCIsIGZhbHNlXSxcbiAgICBbXCJwb3J0XCIsIDBdXG5dO1xuXG5leHBvcnQgZnVuY3Rpb24gYXV0b2NvbXBsZXRlKGRhdGE6IGFueSwgYXJnczogc3RyaW5nW10pIHtcbiAgICBkYXRhLmZsYWdzKEZMQUdTKTtcbiAgICByZXR1cm4gW107XG59XG5cbi8qKiBAcGFyYW0ge05TfSBucyAqKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYWluKG5zOiBOUykge1xuICAgIG5zLmRpc2FibGVMb2coJ3NsZWVwJyk7XG4gICAgbnMuY2xlYXJMb2coKTtcbiAgICBucy50YWlsKCk7XG4gICAgbnMucmVzaXplVGFpbCg4MTAsIDY0MCk7XG5cbiAgICBjb25zdCBmbGFncyA9IG5zLmZsYWdzKEZMQUdTKTtcbiAgICBpZiAoZmxhZ3MuaGVscCkge1xuICAgICAgICBucy50cHJpbnQoW1xuICAgICAgICAgICAgYFVTQUdFYCxcbiAgICAgICAgICAgIGA+IHJ1biAke25zLmdldFNjcmlwdE5hbWUoKX0gLS1wb3J0IDEwYCxcbiAgICAgICAgICAgICcgJ1xuICAgICAgICBdLmpvaW4oXCJcXG5cIikpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcG9ydE51bSA9IGZsYWdzLnBvcnQgYXMgbnVtYmVyIHx8IG5zLnBpZDtcbiAgICBjb25zdCBwb3J0ID0gbnMuZ2V0UG9ydEhhbmRsZShwb3J0TnVtKTtcbiAgICAvLyBwb3J0LmNsZWFyKCk7XG4gICAgbnMucHJpbnQoYExpc3RlbmluZyBvbiBQb3J0ICR7cG9ydE51bX1gKTtcblxuICAgIGNvbnN0IGJhdGNoVmlldyA9IDxCYXRjaFZpZXcgbnM9e25zfSBwb3J0TnVtPXtwb3J0TnVtfSAvPjtcbiAgICBucy5wcmludFJhdyhiYXRjaFZpZXcpO1xuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgYXdhaXQgcG9ydC5uZXh0V3JpdGUoKTtcbiAgICB9XG59XG5cbi8vIC0tLS0tIEJhdGNoVmlldyAtLS0tLVxuXG50eXBlIEpvYklEID0gbnVtYmVyIHwgc3RyaW5nO1xuaW50ZXJmYWNlIEFjdGlvbk1lc3NhZ2Uge1xuICAgIHR5cGU6IFwiaGFja1wiIHwgXCJncm93XCIgfCBcIndlYWtlblwiO1xuICAgIGpvYklEPzogSm9iSUQ7XG4gICAgZHVyYXRpb246IFRpbWVNcztcbiAgICBzdGFydFRpbWU6IFRpbWVNcztcbiAgICBzdGFydFRpbWVBY3R1YWw/OiBUaW1lTXM7XG4gICAgZW5kVGltZT86IFRpbWVNcztcbiAgICBlbmRUaW1lQWN0dWFsPzogVGltZU1zO1xuICAgIGNhbmNlbGxlZD86IGJvb2xlYW47XG4gICAgcmVzdWx0PzogbnVtYmVyO1xufVxuaW50ZXJmYWNlIFNwYWNlck1lc3NhZ2Uge1xuICAgIHR5cGU6IFwic3BhY2VyXCJcbn1cbmludGVyZmFjZSBTZXJ2ZXJNZXNzYWdlIHtcbiAgICB0eXBlOiBcImV4cGVjdGVkXCIgfCBcIm9ic2VydmVkXCI7XG4gICAgdGltZTogVGltZU1zO1xuICAgIGhhY2tEaWZmaWN1bHR5OiBudW1iZXI7XG4gICAgbWluRGlmZmljdWx0eTogbnVtYmVyO1xuICAgIG1vbmV5QXZhaWxhYmxlOiBudW1iZXI7XG4gICAgbW9uZXlNYXg6IG51bWJlcjtcbn1cbnR5cGUgRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlID0gU2VydmVyTWVzc2FnZSAmIHtcbiAgICB0eXBlOiBcImV4cGVjdGVkXCJcbn1cbnR5cGUgT2JzZXJ2ZWRTZXJ2ZXJNZXNzYWdlID0gU2VydmVyTWVzc2FnZSAmIHtcbiAgICB0eXBlOiBcIm9ic2VydmVkXCJcbn1cbnR5cGUgQmF0Y2hWaWV3TWVzc2FnZSA9IEFjdGlvbk1lc3NhZ2UgfCBTcGFjZXJNZXNzYWdlIHwgU2VydmVyTWVzc2FnZTtcblxudHlwZSBKb2IgPSBBY3Rpb25NZXNzYWdlICYge1xuICAgIHJvd0lEOiBudW1iZXJcbn1cblxuaW50ZXJmYWNlIEJhdGNoVmlld1Byb3BzIHtcbiAgICBuczogTlM7XG4gICAgcG9ydE51bTogbnVtYmVyO1xufVxuaW50ZXJmYWNlIEJhdGNoVmlld1N0YXRlIHtcbiAgICBydW5uaW5nOiBib29sZWFuO1xuICAgIG5vdzogVGltZU1zO1xufVxuZXhwb3J0IGNsYXNzIEJhdGNoVmlldyBleHRlbmRzIFJlYWN0LkNvbXBvbmVudDxCYXRjaFZpZXdQcm9wcywgQmF0Y2hWaWV3U3RhdGU+IHtcbiAgICBwb3J0OiBOZXRzY3JpcHRQb3J0O1xuICAgIGpvYnM6IE1hcDxzdHJpbmcgfCBudW1iZXIsIEpvYj47XG4gICAgc2VxdWVudGlhbFJvd0lEOiBudW1iZXIgPSAwO1xuICAgIHNlcXVlbnRpYWxKb2JJRDogbnVtYmVyID0gMDtcbiAgICBleHBlY3RlZFNlcnZlcnM6IEV4cGVjdGVkU2VydmVyTWVzc2FnZVtdO1xuICAgIG9ic2VydmVkU2VydmVyczogT2JzZXJ2ZWRTZXJ2ZXJNZXNzYWdlW107XG5cbiAgICBjb25zdHJ1Y3Rvcihwcm9wczogQmF0Y2hWaWV3UHJvcHMpe1xuICAgICAgICBzdXBlcihwcm9wcyk7XG4gICAgICAgIGNvbnN0IHsgbnMsIHBvcnROdW0gfSA9IHByb3BzO1xuICAgICAgICB0aGlzLnN0YXRlID0ge1xuICAgICAgICAgICAgcnVubmluZzogdHJ1ZSxcbiAgICAgICAgICAgIG5vdzogcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMucG9ydCA9IG5zLmdldFBvcnRIYW5kbGUocG9ydE51bSk7XG4gICAgICAgIHRoaXMuam9icyA9IG5ldyBNYXAoKTtcbiAgICAgICAgdGhpcy5leHBlY3RlZFNlcnZlcnMgPSBbXTtcbiAgICAgICAgdGhpcy5vYnNlcnZlZFNlcnZlcnMgPSBbXTtcbiAgICB9XG5cbiAgICBjb21wb25lbnREaWRNb3VudCgpIHtcbiAgICAgICAgY29uc3QgeyBucyB9ID0gdGhpcy5wcm9wcztcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogdHJ1ZX0pO1xuICAgICAgICBucy5hdEV4aXQoKCk9PntcbiAgICAgICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IGZhbHNlfSk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnJlYWRQb3J0KCk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZSgpO1xuICAgICAgICAvLyBPYmplY3QuYXNzaWduKGdsb2JhbFRoaXMsIHtiYXRjaFZpZXc6IHRoaXN9KTtcbiAgICB9XG5cbiAgICBjb21wb25lbnRXaWxsVW5tb3VudCgpIHtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogZmFsc2V9KTtcbiAgICB9XG5cbiAgICByZWFkUG9ydCA9ICgpPT57XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5ydW5uaW5nKSByZXR1cm47XG4gICAgICAgIHdoaWxlKCF0aGlzLnBvcnQuZW1wdHkoKSkge1xuICAgICAgICAgICAgY29uc3QgbXNnOiBCYXRjaFZpZXdNZXNzYWdlID0gSlNPTi5wYXJzZSh0aGlzLnBvcnQucmVhZCgpIGFzIHN0cmluZyk7XG4gICAgICAgICAgICB0aGlzLnJlY2VpdmVNZXNzYWdlKG1zZyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5wb3J0Lm5leHRXcml0ZSgpLnRoZW4odGhpcy5yZWFkUG9ydCk7XG4gICAgfVxuXG4gICAgcmVjZWl2ZU1lc3NhZ2UobXNnOiBCYXRjaFZpZXdNZXNzYWdlKSB7XG4gICAgICAgIGlmIChtc2cudHlwZSA9PSBcInNwYWNlclwiKSB7XG4gICAgICAgICAgICB0aGlzLnNlcXVlbnRpYWxSb3dJRCArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKG1zZy50eXBlID09IFwiZXhwZWN0ZWRcIikge1xuICAgICAgICAgICAgdGhpcy5leHBlY3RlZFNlcnZlcnMucHVzaChtc2cpO1xuICAgICAgICAgICAgLy8gVE9ETzogc29ydCBieSB0aW1lIGFuZCByZW1vdmUgdmVyeSBvbGQgaXRlbXNcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cudHlwZSA9PSBcIm9ic2VydmVkXCIpIHtcbiAgICAgICAgICAgIHRoaXMub2JzZXJ2ZWRTZXJ2ZXJzLnB1c2gobXNnKTtcbiAgICAgICAgICAgIC8vIFRPRE86IHNvcnQgYnkgdGltZSBhbmQgcmVtb3ZlIHZlcnkgb2xkIGl0ZW1zXG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAobXNnLmpvYklEICE9PSB1bmRlZmluZWQgfHwgbXNnLnR5cGUgPT0gJ2hhY2snIHx8IG1zZy50eXBlID09ICdncm93JyB8fCBtc2cudHlwZSA9PSAnd2Vha2VuJykge1xuICAgICAgICAgICAgdGhpcy5hZGRKb2IobXNnKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZEpvYihtc2c6IEFjdGlvbk1lc3NhZ2UpIHtcbiAgICAgICAgLy8gYXNzaWduIHNlcXVlbnRpYWwgSUQgaWYgbmVlZGVkXG4gICAgICAgIGxldCBqb2JJRCA9IG1zZy5qb2JJRDtcbiAgICAgICAgaWYgKGpvYklEID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHdoaWxlICh0aGlzLmpvYnMuaGFzKHRoaXMuc2VxdWVudGlhbEpvYklEKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuc2VxdWVudGlhbEpvYklEICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBqb2JJRCA9IHRoaXMuc2VxdWVudGlhbEpvYklEO1xuICAgICAgICB9XG4gICAgICAgIC8vIGxvYWQgZXhpc3RpbmcgZGF0YSBpZiBwcmVzZW50XG4gICAgICAgIGxldCBqb2IgPSB0aGlzLmpvYnMuZ2V0KGpvYklEKTtcbiAgICAgICAgaWYgKGpvYiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBqb2IgPSB7XG4gICAgICAgICAgICAgICAgam9iSUQ6IGpvYklELFxuICAgICAgICAgICAgICAgIHJvd0lEOiB0aGlzLnNlcXVlbnRpYWxSb3dJRCsrXG4gICAgICAgICAgICB9IGFzIEpvYjtcbiAgICAgICAgfVxuICAgICAgICAvLyBtZXJnZSB1cGRhdGVzIGZyb20gbWVzc2FnZVxuICAgICAgICBqb2IgPSBPYmplY3QuYXNzaWduKGpvYiwgbXNnKTtcbiAgICAgICAgdGhpcy5qb2JzLnNldChtc2cuam9iSUQsIGpvYik7XG4gICAgICAgIHRoaXMuY2xlYW5Kb2JzKCk7XG4gICAgfVxuXG4gICAgY2xlYW5Kb2JzKCkge1xuICAgICAgICAvLyBmaWx0ZXIgb3V0IGpvYnMgd2l0aCBlbmR0aW1lIGluIHBhc3RcbiAgICAgICAgaWYgKHRoaXMuam9icy5zaXplID4gMjAwKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGpvYklEIG9mIHRoaXMuam9icy5rZXlzKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBqb2IgPSB0aGlzLmpvYnMuZ2V0KGpvYklEKSBhcyBKb2I7XG4gICAgICAgICAgICAgICAgaWYgKChqb2IuZW5kVGltZUFjdHVhbCA/PyBqb2IuZW5kVGltZSkgPCB0aGlzLnN0YXRlLm5vdy0oV0lEVEhfU0VDT05EUyoyKjEwMDApKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuam9icy5kZWxldGUoam9iSUQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFuaW1hdGUgPSAoKT0+e1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUucnVubmluZykgcmV0dXJuO1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtub3c6IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNc30pO1xuICAgICAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRlKTtcbiAgICB9XG5cbiAgICByZW5kZXIoKSB7XG4gICAgICAgIGNvbnN0IGRpc3BsYXlKb2JzID0gWy4uLnRoaXMuam9icy52YWx1ZXMoKV1cblxuICAgICAgICAvLyBjb25zdCBzZXJ2ZXJQcmVkaWN0aW9ucyA9IGRpc3BsYXlKb2JzLm1hcCgoam9iKT0+KFxuICAgICAgICAvLyAgICAgW2pvYi5lbmRUaW1lIGFzIFRpbWVNcywgam9iLnNlcnZlckFmdGVyIGFzIFNlcnZlcl0gYXMgU2VydmVyU25hcHNob3RcbiAgICAgICAgLy8gKSkuZmlsdGVyKChbdCwgc10pPT4hIXMpLnNvcnQoKGEsYik9PmFbMF0tYlswXSk7XG4gICAgICAgIC8vIGNvbnN0IHNlcnZlck9ic2VydmF0aW9ucyA9IGRpc3BsYXlKb2JzLm1hcCgoam9iKT0+KFxuICAgICAgICAvLyAgICAgW2pvYi5zdGFydFRpbWUgYXMgVGltZU1zLCBqb2Iuc2VydmVyQmVmb3JlIGFzIFNlcnZlcl0gYXMgU2VydmVyU25hcHNob3RcbiAgICAgICAgLy8gKSkuZmlsdGVyKChbdCwgc10pPT4hIXMpLnNvcnQoKGEsYik9PmFbMF0tYlswXSk7XG4gICAgXG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8R3JhcGhGcmFtZSBub3c9e3RoaXMuc3RhdGUubm93fT5cbiAgICAgICAgICAgICAgICA8U2FmZXR5TGF5ZXIgZXhwZWN0ZWRTZXJ2ZXJzPXt0aGlzLmV4cGVjdGVkU2VydmVyc30gLz5cbiAgICAgICAgICAgICAgICA8Sm9iTGF5ZXIgam9icz17ZGlzcGxheUpvYnN9IC8+XG4gICAgICAgICAgICAgICAgPFNlY3VyaXR5TGF5ZXIgZXhwZWN0ZWRTZXJ2ZXJzPXt0aGlzLmV4cGVjdGVkU2VydmVyc30gb2JzZXJ2ZWRTZXJ2ZXJzPXt0aGlzLm9ic2VydmVkU2VydmVyc30gLz5cbiAgICAgICAgICAgICAgICA8TW9uZXlMYXllciBleHBlY3RlZFNlcnZlcnM9e3RoaXMuZXhwZWN0ZWRTZXJ2ZXJzfSBvYnNlcnZlZFNlcnZlcnM9e3RoaXMub2JzZXJ2ZWRTZXJ2ZXJzfSAvPlxuICAgICAgICAgICAgPC9HcmFwaEZyYW1lPlxuICAgICAgICApXG4gICAgfVxufVxuXG5mdW5jdGlvbiBHcmFwaEZyYW1lKHtub3csIGNoaWxkcmVufTp7bm93OlRpbWVNcywgY2hpbGRyZW46IFJlYWN0LlJlYWN0Tm9kZX0pOiBSZWFjdC5SZWFjdEVsZW1lbnQge1xuICAgIC8vIFRPRE86IGluaXRUaW1lIGlzIHVzZWQgYXMgdW5pcXVlIERPTSBJRCBhbmQgYXMgcmVuZGVyaW5nIG9yaWdpbiBidXQgaXQgaXMgcG9vcmx5IHN1aXRlZCBmb3IgYm90aFxuICAgIHJldHVybiAoXG4gICAgICAgIDxzdmcgdmVyc2lvbj1cIjEuMVwiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIlxuICAgICAgICAgICAgd2lkdGg9e1dJRFRIX1BJWEVMU31cbiAgICAgICAgICAgIGhlaWdodD17SEVJR0hUX1BJWEVMU30gXG4gICAgICAgICAgICAvLyBTZXQgdGhlIHZpZXdCb3ggZm9yIDEwIHNlY29uZHMgb2YgaGlzdG9yeSwgNiBzZWNvbmRzIG9mIGZ1dHVyZS5cbiAgICAgICAgICAgIHZpZXdCb3g9e2Ake2NvbnZlcnRTZWNUb1B4KC0xMCBhcyBUaW1lU2Vjb25kcyl9IDAgJHtXSURUSF9QSVhFTFN9ICR7SEVJR0hUX1BJWEVMU31gfVxuICAgICAgICA+XG4gICAgICAgICAgICA8ZGVmcz5cbiAgICAgICAgICAgICAgICA8Y2xpcFBhdGggaWQ9e2BoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfWB9IGNsaXBQYXRoVW5pdHM9XCJ1c2VyU3BhY2VPblVzZVwiPlxuICAgICAgICAgICAgICAgICAgICA8cmVjdCBpZD1cImhpZGUtZnV0dXJlLXJlY3RcIlxuICAgICAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUobm93LTYwMDAwIGFzIFRpbWVNcyl9IHdpZHRoPXtjb252ZXJ0VGltZSg2MDAwMCBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD17NTB9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9jbGlwUGF0aD5cbiAgICAgICAgICAgIDwvZGVmcz5cbiAgICAgICAgICAgIDxyZWN0IGlkPVwiYmFja2dyb3VuZFwiIHg9e2NvbnZlcnRTZWNUb1B4KC0xMCBhcyBUaW1lU2Vjb25kcyl9IHdpZHRoPVwiMTAwJVwiIGhlaWdodD1cIjEwMCVcIiBmaWxsPXtHUkFQSF9DT0xPUlMuc2FmZX0gLz5cbiAgICAgICAgICAgIDxnIGlkPVwidGltZUNvb3JkaW5hdGVzXCIgdHJhbnNmb3JtPXtgc2NhbGUoJHtXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTfSAxKSB0cmFuc2xhdGUoJHtjb252ZXJ0VGltZShpbml0VGltZS1ub3cgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9IDApYH0+XG4gICAgICAgICAgICAgICAge2NoaWxkcmVufVxuICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0xXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy1GT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTJcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLTIqRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgPHJlY3QgaWQ9XCJjdXJzb3JcIiB4PXswfSB3aWR0aD17MX0geT17MH0gaGVpZ2h0PVwiMTAwJVwiIGZpbGw9XCJ3aGl0ZVwiIC8+XG4gICAgICAgICAgICA8R3JhcGhMZWdlbmQgLz5cbiAgICAgICAgPC9zdmc+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gR3JhcGhMZWdlbmQoKTogUmVhY3QuUmVhY3RFbGVtZW50IHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cIkxlZ2VuZFwiIHRyYW5zZm9ybT1cInRyYW5zbGF0ZSgtNDkwLCAxMCksIHNjYWxlKC41LCAuNSlcIj5cbiAgICAgICAgICAgIDxyZWN0IHg9ezF9IHk9ezF9IHdpZHRoPXsyNzV9IGhlaWdodD17MzkyfSBmaWxsPVwiYmxhY2tcIiBzdHJva2U9XCIjOTc5Nzk3XCIgLz5cbiAgICAgICAgICAgIHtPYmplY3QuZW50cmllcyhHUkFQSF9DT0xPUlMpLm1hcCgoW2xhYmVsLCBjb2xvcl0sIGkpPT4oXG4gICAgICAgICAgICAgICAgPGcga2V5PXtsYWJlbH0gdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDIyLCAkezEzICsgNDEqaX0pYH0+XG4gICAgICAgICAgICAgICAgICAgIDxyZWN0IHg9ezB9IHk9ezB9IHdpZHRoPXsyMn0gaGVpZ2h0PXsyMn0gZmlsbD17Y29sb3J9IC8+XG4gICAgICAgICAgICAgICAgICAgIDx0ZXh0IGZvbnRGYW1pbHk9XCJDb3VyaWVyIE5ld1wiIGZvbnRTaXplPXszNn0gZmlsbD1cIiM4ODhcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDx0c3BhbiB4PXs0Mi41fSB5PXszMH0+e2xhYmVsLnN1YnN0cmluZygwLDEpLnRvVXBwZXJDYXNlKCkrbGFiZWwuc3Vic3RyaW5nKDEpfTwvdHNwYW4+XG4gICAgICAgICAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIFNhZmV0eUxheWVyKHtleHBlY3RlZFNlcnZlcnN9OiB7ZXhwZWN0ZWRTZXJ2ZXJzOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2VbXX0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGxldCBwcmV2U2VydmVyOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2UgfCB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJzYWZldHlMYXllclwiPlxuICAgICAgICAgICAge2V4cGVjdGVkU2VydmVycy5tYXAoKHNlcnZlciwgaSk9PntcbiAgICAgICAgICAgICAgICBsZXQgZWwgPSBudWxsO1xuICAgICAgICAgICAgICAgIC8vIHNoYWRlIHRoZSBiYWNrZ3JvdW5kIGJhc2VkIG9uIHNlY0xldmVsXG4gICAgICAgICAgICAgICAgaWYgKHByZXZTZXJ2ZXIgJiYgc2VydmVyLnRpbWUgPiBwcmV2U2VydmVyLnRpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgZWwgPSAoPHJlY3Qga2V5PXtpfVxuICAgICAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUocHJldlNlcnZlci50aW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHNlcnZlci50aW1lIC0gcHJldlNlcnZlci50aW1lLCAwKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD1cIjEwMCVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsbD17KHByZXZTZXJ2ZXIuaGFja0RpZmZpY3VsdHkgPiBwcmV2U2VydmVyLm1pbkRpZmZpY3VsdHkpID8gR1JBUEhfQ09MT1JTLnVuc2FmZSA6IEdSQVBIX0NPTE9SUy5zYWZlfVxuICAgICAgICAgICAgICAgICAgICAvPik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHByZXZTZXJ2ZXIgPSBzZXJ2ZXI7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGVsO1xuICAgICAgICAgICAgfSl9XG4gICAgICAgICAgICB7cHJldlNlcnZlciAmJiAoXG4gICAgICAgICAgICAgICAgPHJlY3Qga2V5PVwicmVtYWluZGVyXCJcbiAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUocHJldlNlcnZlci50aW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKDYwMDAwMCwgMCl9XG4gICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD1cIjEwMCVcIlxuICAgICAgICAgICAgICAgICAgICBmaWxsPXsocHJldlNlcnZlci5oYWNrRGlmZmljdWx0eSA+IHByZXZTZXJ2ZXIubWluRGlmZmljdWx0eSkgPyBHUkFQSF9DT0xPUlMudW5zYWZlIDogR1JBUEhfQ09MT1JTLnNhZmV9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBKb2JMYXllcih7am9ic306IHtqb2JzOiBKb2JbXX0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cImpvYkxheWVyXCI+XG4gICAgICAgICAgICB7am9icy5tYXAoKGpvYjogSm9iKT0+KDxKb2JCYXIgam9iPXtqb2J9IGtleT17am9iLmpvYklEfSAvPikpfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gSm9iQmFyKHtqb2J9OiB7am9iOiBKb2J9KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBjb25zdCB5ID0gKChqb2Iucm93SUQgKyAxKSAlICgoSEVJR0hUX1BJWEVMUyAtIEZPT1RFUl9QSVhFTFMqMikgLyA0KSkgKiA0O1xuICAgIGxldCBqb2JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lICYmIGpvYi5kdXJhdGlvbikge1xuICAgICAgICBqb2JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKGpvYi5zdGFydFRpbWUpfSB3aWR0aD17Y29udmVydFRpbWUoam9iLmR1cmF0aW9uLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezJ9XG4gICAgICAgICAgICBmaWxsPXtHUkFQSF9DT0xPUlNbam9iLmNhbmNlbGxlZCA/ICdjYW5jZWxsZWQnIDogam9iLnR5cGVdfVxuICAgICAgICAvPilcbiAgICB9O1xuICAgIGxldCBzdGFydEVycm9yQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLnN0YXJ0VGltZUFjdHVhbCkge1xuICAgICAgICBjb25zdCBbdDEsIHQyXSA9IFtqb2Iuc3RhcnRUaW1lLCBqb2Iuc3RhcnRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICBzdGFydEVycm9yQmFyID0gKDxyZWN0XG4gICAgICAgICAgICB4PXtjb252ZXJ0VGltZSh0MSl9IHdpZHRoPXtjb252ZXJ0VGltZSh0Mi10MSBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17MX1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SUy5kZXN5bmN9XG4gICAgICAgICAvPik7XG4gICAgfVxuICAgIGxldCBlbmRFcnJvckJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5lbmRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5lbmRUaW1lLCBqb2IuZW5kVGltZUFjdHVhbF0uc29ydCgoYSxiKT0+YS1iKTtcbiAgICAgICAgZW5kRXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgZmlsbD17R1JBUEhfQ09MT1JTLmRlc3luY31cbiAgICAgICAgIC8+KTtcbiAgICB9XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHt5fSlgfT5cbiAgICAgICAgICAgIHtqb2JCYXJ9XG4gICAgICAgICAgICB7c3RhcnRFcnJvckJhcn1cbiAgICAgICAgICAgIHtlbmRFcnJvckJhcn1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbnR5cGUgVGltZVZhbHVlID0gW1RpbWVNcywgbnVtYmVyXTtcbmludGVyZmFjZSBTZWN1cml0eUxheWVyUHJvcHMge1xuICAgIGV4cGVjdGVkU2VydmVyczogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlW107XG4gICAgb2JzZXJ2ZWRTZXJ2ZXJzOiBPYnNlcnZlZFNlcnZlck1lc3NhZ2VbXVxufVxuZnVuY3Rpb24gU2VjdXJpdHlMYXllcih7ZXhwZWN0ZWRTZXJ2ZXJzLCBvYnNlcnZlZFNlcnZlcnN9OlNlY3VyaXR5TGF5ZXJQcm9wcyk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgZXhwZWN0ZWRTZXJ2ZXJzID8/PSBbXTtcbiAgICBvYnNlcnZlZFNlcnZlcnMgPz89IFtdO1xuICAgIGxldCBtaW5TZWMgPSAwO1xuICAgIGxldCBtYXhTZWMgPSAxO1xuICAgIGZvciAoY29uc3Qgc25hcHNob3RzIG9mIFtleHBlY3RlZFNlcnZlcnMsIG9ic2VydmVkU2VydmVyc10pIHtcbiAgICAgICAgZm9yIChjb25zdCBzZXJ2ZXIgb2Ygc25hcHNob3RzKSB7XG4gICAgICAgICAgICBtaW5TZWMgPSBNYXRoLm1pbihtaW5TZWMsIHNlcnZlci5oYWNrRGlmZmljdWx0eSk7XG4gICAgICAgICAgICBtYXhTZWMgPSBNYXRoLm1heChtYXhTZWMsIHNlcnZlci5oYWNrRGlmZmljdWx0eSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBvYnNlcnZlZEV2ZW50cyA9IG9ic2VydmVkU2VydmVycy5tYXAoKHNlcnZlcik9PltzZXJ2ZXIudGltZSwgc2VydmVyLmhhY2tEaWZmaWN1bHR5XSkgYXMgVGltZVZhbHVlW107XG4gICAgY29uc3Qgc2hvdWxkQ2xvc2VQYXRoID0gdHJ1ZTtcbiAgICBjb25zdCBvYnNlcnZlZFBhdGggPSBjb21wdXRlUGF0aERhdGEob2JzZXJ2ZWRFdmVudHMsIG1pblNlYywgc2hvdWxkQ2xvc2VQYXRoKTtcbiAgICBjb25zdCBvYnNlcnZlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cIm9ic2VydmVkU2VjXCJcbiAgICAgICAgICAgIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhTZWMgLSBtaW5TZWMpfSlgfVxuICAgICAgICAgICAgZmlsbD17XCJkYXJrXCIrR1JBUEhfQ09MT1JTLnNlY3VyaXR5fVxuICAgICAgICAgICAgLy8gZmlsbE9wYWNpdHk6IDAuNSxcbiAgICAgICAgICAgIGNsaXBQYXRoPXtgdXJsKCNoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfSlgfVxuICAgICAgICA+XG4gICAgICAgICAgICA8cGF0aCBkPXtvYnNlcnZlZFBhdGguam9pbihcIiBcIil9IC8+XG4gICAgICAgIDwvZz5cbiAgICApO1xuXG4gICAgY29uc3QgZXhwZWN0ZWRFdmVudHMgPSBleHBlY3RlZFNlcnZlcnMubWFwKChzZXJ2ZXIpPT5bc2VydmVyLnRpbWUsIHNlcnZlci5oYWNrRGlmZmljdWx0eV0pIGFzIFRpbWVWYWx1ZVtdO1xuICAgIGNvbnN0IHByZWRpY3RlZFBhdGggPSBjb21wdXRlUGF0aERhdGEoZXhwZWN0ZWRFdmVudHMpO1xuICAgIGNvbnN0IHByZWRpY3RlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cInByZWRpY3RlZFNlY1wiXG4gICAgICAgICAgICB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4U2VjIC0gbWluU2VjKX0pYH1cbiAgICAgICAgICAgIHN0cm9rZT17R1JBUEhfQ09MT1JTLnNlY3VyaXR5fVxuICAgICAgICAgICAgZmlsbD1cIm5vbmVcIlxuICAgICAgICAgICAgc3Ryb2tlV2lkdGg9ezJ9XG4gICAgICAgICAgICBzdHJva2VMaW5lam9pbj1cImJldmVsXCJcbiAgICAgICAgPlxuICAgICAgICAgICAgPHBhdGggZD17cHJlZGljdGVkUGF0aC5qb2luKFwiIFwiKX0gdmVjdG9yRWZmZWN0PVwibm9uLXNjYWxpbmctc3Ryb2tlXCIgLz5cbiAgICAgICAgPC9nPlxuICAgICk7XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cInNlY0xheWVyXCIgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtIRUlHSFRfUElYRUxTIC0gMipGT09URVJfUElYRUxTfSlgfT5cbiAgICAgICAgICAgIHtvYnNlcnZlZExheWVyfVxuICAgICAgICAgICAge3ByZWRpY3RlZExheWVyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gY29tcHV0ZVBhdGhEYXRhKGV2ZW50czogVGltZVZhbHVlW10sIG1pblZhbHVlPTAsIHNob3VsZENsb3NlPWZhbHNlLCBzY2FsZT0xKSB7XG4gICAgY29uc3QgcGF0aERhdGEgPSBbXTtcbiAgICBpZiAoZXZlbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgW3RpbWUsIHZhbHVlXSA9IGV2ZW50c1swXTtcbiAgICAgICAgLy8gc3RhcnQgbGluZSBhdCBmaXJzdCBwcm9qZWN0ZWQgdGltZSBhbmQgdmFsdWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgTSAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IFt0aW1lLCB2YWx1ZV0gb2YgZXZlbnRzKSB7XG4gICAgICAgIC8vIGhvcml6b250YWwgbGluZSB0byBjdXJyZW50IHRpbWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9YClcbiAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBuZXcgbGV2ZWxcbiAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyh2YWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICB9XG4gICAgLy8gZmlsbCBpbiBhcmVhIGJldHdlZW4gbGFzdCBzbmFwc2hvdCBhbmQgcmlnaHQgc2lkZSAoYXJlYSBhZnRlciBcIm5vd1wiIGN1cnNvciB3aWxsIGJlIGNsaXBwZWQgbGF0ZXIpXG4gICAgaWYgKGV2ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IFt0aW1lLCB2YWx1ZV0gPSBldmVudHNbZXZlbnRzLmxlbmd0aC0xXTtcbiAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBwcmV2aW91cyBsZXZlbFxuICAgICAgICAvLyBob3Jpem9udGFsIGxpbmUgdG8gZnV0dXJlIHRpbWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyh2YWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gLCBgSCAke2NvbnZlcnRUaW1lKHRpbWUgKyA2MDAwMDApLnRvRml4ZWQoMyl9YCk7XG4gICAgICAgIGlmIChzaG91bGRDbG9zZSkge1xuICAgICAgICAgICAgLy8gZmlsbCBhcmVhIHVuZGVyIGFjdHVhbCBzZWN1cml0eVxuICAgICAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyhtaW5WYWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICAgICAgICAgIGNvbnN0IG1pblRpbWUgPSBldmVudHNbMF1bMF07XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBIICR7Y29udmVydFRpbWUobWluVGltZSkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goJ1onKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcGF0aERhdGE7XG59XG5cbmZ1bmN0aW9uIE1vbmV5TGF5ZXIocHJvcHM6IFNlY3VyaXR5TGF5ZXJQcm9wcyk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgcmV0dXJuIDxnIGlkPVwibW9uZXlMYXllclwiIC8+XG59XG5cbi8vIC0tLS0tIHByZS1SZWFjdCB2ZXJzaW9uIC0tLS0tXG5cbi8qKlxuICogcmVuZGVyQmF0Y2hlcyAtIGNyZWF0ZSBhbiBTVkcgZWxlbWVudCB3aXRoIGEgZ3JhcGggb2Ygam9ic1xuICogQHBhcmFtIHtTVkdTVkdFbGVtZW50fSBbZWxdIC0gU1ZHIGVsZW1lbnQgdG8gcmV1c2UuIFdpbGwgYmUgY3JlYXRlZCBpZiBpdCBkb2VzIG5vdCBleGlzdCB5ZXQuXG4gKiBAcGFyYW0ge0pvYltdW119IGJhdGNoZXMgLSBhcnJheSBvZiBhcnJheXMgb2Ygam9ic1xuICogQHBhcmFtIHtudW1iZXJ9IFtub3ddIC0gY3VycmVudCB0aW1lIChvcHRpb25hbClcbiAqIEByZXR1cm5zIHtTVkdTVkdFbGVtZW50fVxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQmF0Y2hlcyhlbDogSFRNTEVsZW1lbnQsIGJhdGNoZXM9W10sIHNlcnZlclNuYXBzaG90cz1bXSwgbm93OiBUaW1lTXMpIHtcbiAgICBub3cgfHw9IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNcztcblxuICAgIC8vIFJlbmRlciB0aGUgbWFpbiBTVkcgZWxlbWVudCBpZiBuZWVkZWRcbiAgICBlbCB8fD0gc3ZnRWwoXG4gICAgICAgIFwic3ZnXCIsXG4gICAgICAgIHtcbiAgICAgICAgICAgIHZlcnNpb246IFwiMS4xXCIsIHdpZHRoOldJRFRIX1BJWEVMUywgaGVpZ2h0OiBIRUlHSFRfUElYRUxTLFxuICAgICAgICAgICAgLy8gU2V0IHRoZSB2aWV3Qm94IGZvciAxMCBzZWNvbmRzIG9mIGhpc3RvcnksIDYgc2Vjb25kcyBvZiBmdXR1cmUuXG4gICAgICAgICAgICB2aWV3Qm94OiBgJHtjb252ZXJ0U2VjVG9QeCgtMTApfSAwICR7V0lEVEhfUElYRUxTfSAke0hFSUdIVF9QSVhFTFN9YFxuICAgICAgICB9LFxuICAgICAgICBbXG4gICAgICAgICAgICBbXCJkZWZzXCIsIHt9LCBbXG4gICAgICAgICAgICAgICAgW1wiY2xpcFBhdGhcIiwge2lkOmBoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfWAsIGNsaXBQYXRoVW5pdHM6IFwidXNlclNwYWNlT25Vc2VcIn0sIFtcbiAgICAgICAgICAgICAgICAgICAgW1wicmVjdFwiLCB7aWQ6XCJoaWRlLWZ1dHVyZS1yZWN0XCIsIHg6Y29udmVydFRpbWUobm93LTYwMDAwKSwgd2lkdGg6Y29udmVydFRpbWUoNjAwMDAsMCksIHk6MCwgaGVpZ2h0OiA1MH1dXG4gICAgICAgICAgICAgICAgXV1cbiAgICAgICAgICAgIF1dLFxuICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJiYWNrZ3JvdW5kXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIGhlaWdodDpcIjEwMCVcIiwgZmlsbDpHUkFQSF9DT0xPUlMuc2FmZX1dLFxuICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJ0aW1lQ29vcmRpbmF0ZXNcIn0sIFtcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcInNhZmV0eUxheWVyXCJ9XSxcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcImpvYkxheWVyXCJ9XSxcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcInNlY0xheWVyXCJ9XSxcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcIm1vbmV5TGF5ZXJcIn1dXG4gICAgICAgICAgICBdXSxcbiAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0xXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy1GT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMlwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtMipGT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICBbXCJyZWN0XCIsIHtpZDpcImN1cnNvclwiLCB4OjAsIHdpZHRoOjEsIHk6MCwgaGVpZ2h0OiBcIjEwMCVcIiwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICByZW5kZXJMZWdlbmQoKVxuICAgICAgICBdXG4gICAgKTtcblxuICAgIC8vIFVwZGF0ZSB0aGUgdGltZSBjb29yZGluYXRlcyBldmVyeSBmcmFtZVxuICAgIGNvbnN0IGRhdGFFbCA9IGVsLmdldEVsZW1lbnRCeUlkKFwidGltZUNvb3JkaW5hdGVzXCIpO1xuICAgIGRhdGFFbC5zZXRBdHRyaWJ1dGUoJ3RyYW5zZm9ybScsXG4gICAgICAgIGBzY2FsZSgke1dJRFRIX1BJWEVMUyAvIFdJRFRIX1NFQ09ORFN9IDEpIHRyYW5zbGF0ZSgke2NvbnZlcnRUaW1lKGluaXRUaW1lLW5vdywgMCl9IDApYFxuICAgICk7XG4gICAgZWwuZ2V0RWxlbWVudEJ5SWQoXCJoaWRlLWZ1dHVyZS1yZWN0XCIpLnNldEF0dHJpYnV0ZSgneCcsIGNvbnZlcnRUaW1lKG5vdy02MDAwMCkpO1xuICAgIFxuICAgIC8vIE9ubHkgdXBkYXRlIHRoZSBtYWluIGRhdGEgZXZlcnkgMjUwIG1zXG4gICAgY29uc3QgbGFzdFVwZGF0ZSA9IGRhdGFFbC5nZXRBdHRyaWJ1dGUoJ2RhdGEtbGFzdC11cGRhdGUnKSB8fCAwO1xuICAgIGlmIChub3cgLSBsYXN0VXBkYXRlIDwgMjUwKSB7XG4gICAgICAgIHJldHVybiBlbDtcbiAgICB9XG4gICAgZGF0YUVsLnNldEF0dHJpYnV0ZSgnZGF0YS1sYXN0LXVwZGF0ZScsIG5vdyk7XG5cbiAgICBjb25zdCBldmVudFNuYXBzaG90cyA9IGJhdGNoZXMuZmxhdCgpLm1hcCgoam9iKT0+KFxuICAgICAgICBbam9iLmVuZFRpbWUsIGpvYi5yZXN1bHRdXG4gICAgKSk7XG4gICAgXG4gICAgLy8gUmVuZGVyIGVhY2ggam9iIGJhY2tncm91bmQgYW5kIGZvcmVncm91bmRcbiAgICB3aGlsZShkYXRhRWwuZmlyc3RDaGlsZCkge1xuICAgICAgICBkYXRhRWwucmVtb3ZlQ2hpbGQoZGF0YUVsLmZpcnN0Q2hpbGQpO1xuICAgIH1cbiAgICBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyU2FmZXR5TGF5ZXIoYmF0Y2hlcywgbm93KSk7XG4gICAgZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlckpvYkxheWVyKGJhdGNoZXMsIG5vdykpO1xuICAgIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJTZWN1cml0eUxheWVyKGV2ZW50U25hcHNob3RzLCBzZXJ2ZXJTbmFwc2hvdHMsIG5vdykpO1xuICAgIC8vIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJNb25leUxheWVyKGV2ZW50U25hcHNob3RzLCBzZXJ2ZXJTbmFwc2hvdHMsIG5vdykpO1xuICAgIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJQcm9maXRMYXllcihiYXRjaGVzLCBub3cpKTtcblxuICAgIHJldHVybiBlbDtcbn1cblxuXG5mdW5jdGlvbiByZW5kZXJQcm9maXRQYXRoKGJhdGNoZXM9W10sIG5vdywgc2NhbGU9MSkge1xuICAgIC8vIHdvdWxkIGxpa2UgdG8gZ3JhcGggbW9uZXkgcGVyIHNlY29uZCBvdmVyIHRpbWVcbiAgICAvLyBjb25zdCBtb25leVRha2VuID0gW107XG4gICAgY29uc3QgdG90YWxNb25leVRha2VuID0gW107XG4gICAgbGV0IHJ1bm5pbmdUb3RhbCA9IDA7XG4gICAgZm9yIChjb25zdCBiYXRjaCBvZiBiYXRjaGVzKSB7XG4gICAgICAgIGZvciAoY29uc3Qgam9iIG9mIGJhdGNoKSB7XG4gICAgICAgICAgICBpZiAoam9iLnRhc2sgPT0gJ2hhY2snICYmIGpvYi5lbmRUaW1lQWN0dWFsKSB7XG4gICAgICAgICAgICAgICAgLy8gbW9uZXlUYWtlbi5wdXNoKFtqb2IuZW5kVGltZUFjdHVhbCwgam9iLnJlc3VsdEFjdHVhbF0pO1xuICAgICAgICAgICAgICAgIHJ1bm5pbmdUb3RhbCArPSBqb2IucmVzdWx0QWN0dWFsO1xuICAgICAgICAgICAgICAgIHRvdGFsTW9uZXlUYWtlbi5wdXNoKFtqb2IuZW5kVGltZUFjdHVhbCwgcnVubmluZ1RvdGFsXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChqb2IudGFzayA9PSAnaGFjaycgJiYgIWpvYi5jYW5jZWxsZWQpIHtcbiAgICAgICAgICAgICAgICBydW5uaW5nVG90YWwgKz0gam9iLmNoYW5nZS5wbGF5ZXJNb25leTtcbiAgICAgICAgICAgICAgICB0b3RhbE1vbmV5VGFrZW4ucHVzaChbam9iLmVuZFRpbWUsIHJ1bm5pbmdUb3RhbF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHRvdGFsTW9uZXlUYWtlbi5wdXNoKFtub3cgKyAzMDAwMCwgcnVubmluZ1RvdGFsXSk7XG4gICAgLy8gbW9uZXkgdGFrZW4gaW4gdGhlIGxhc3QgWCBzZWNvbmRzIGNvdWxkIGJlIGNvdW50ZWQgd2l0aCBhIHNsaWRpbmcgd2luZG93LlxuICAgIC8vIGJ1dCB0aGUgcmVjb3JkZWQgZXZlbnRzIGFyZSBub3QgZXZlbmx5IHNwYWNlZC5cbiAgICBjb25zdCBtb3ZpbmdBdmVyYWdlID0gW107XG4gICAgbGV0IG1heFByb2ZpdCA9IDA7XG4gICAgbGV0IGogPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdG90YWxNb25leVRha2VuLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IFt0aW1lLCBtb25leV0gPSB0b3RhbE1vbmV5VGFrZW5baV07XG4gICAgICAgIHdoaWxlICh0b3RhbE1vbmV5VGFrZW5bal1bMF0gPD0gdGltZSAtIDIwMDApIHtcbiAgICAgICAgICAgIGorKztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwcm9maXQgPSB0b3RhbE1vbmV5VGFrZW5baV1bMV0gLSB0b3RhbE1vbmV5VGFrZW5bal1bMV07XG4gICAgICAgIG1vdmluZ0F2ZXJhZ2UucHVzaChbdGltZSwgcHJvZml0XSk7XG4gICAgICAgIG1heFByb2ZpdCA9IE1hdGgubWF4KG1heFByb2ZpdCwgcHJvZml0KTtcbiAgICB9XG4gICAgZXZhbChcIndpbmRvd1wiKS5wcm9maXREYXRhID0gW3RvdGFsTW9uZXlUYWtlbiwgcnVubmluZ1RvdGFsLCBtb3ZpbmdBdmVyYWdlXTtcbiAgICBjb25zdCBwYXRoRGF0YSA9IFtcIk0gMCwwXCJdO1xuICAgIGxldCBwcmV2VGltZTtcbiAgICBsZXQgcHJldlByb2ZpdDtcbiAgICBmb3IgKGNvbnN0IFt0aW1lLCBwcm9maXRdIG9mIG1vdmluZ0F2ZXJhZ2UpIHtcbiAgICAgICAgLy8gcGF0aERhdGEucHVzaChgTCAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJvZml0L21heFByb2ZpdCkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgaWYgKHByZXZQcm9maXQpIHtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYEMgJHtjb252ZXJ0VGltZSgocHJldlRpbWUqMyArIHRpbWUpLzQpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJldlByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9ICR7Y29udmVydFRpbWUoKHByZXZUaW1lICsgMyp0aW1lKS80KS50b0ZpeGVkKDMpfSwkeyhzY2FsZSAqIHByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9ICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX0sJHsoc2NhbGUgKiBwcm9maXQvbWF4UHJvZml0KS50b0ZpeGVkKDMpfWApXG4gICAgICAgIH1cbiAgICAgICAgcHJldlRpbWUgPSB0aW1lO1xuICAgICAgICBwcmV2UHJvZml0ID0gcHJvZml0O1xuICAgIH1cbiAgICBwYXRoRGF0YS5wdXNoKGBIICR7Y29udmVydFRpbWUobm93KzYwMDAwKS50b0ZpeGVkKDMpfSBWIDAgWmApO1xuICAgIHJldHVybiBzdmdFbCgncGF0aCcsIHtcbiAgICAgICAgZDogcGF0aERhdGEuam9pbignICcpLFxuICAgICAgICBcInZlY3Rvci1lZmZlY3RcIjogXCJub24tc2NhbGluZy1zdHJva2VcIlxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJQcm9maXRMYXllcihiYXRjaGVzPVtdLCBub3cpIHtcbiAgICBjb25zdCBwcm9maXRQYXRoID0gcmVuZGVyUHJvZml0UGF0aChiYXRjaGVzLCBub3cpO1xuICAgIGNvbnN0IG9ic2VydmVkUHJvZml0ID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJvYnNlcnZlZFByb2ZpdFwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTfSlgLFxuICAgICAgICAgICAgZmlsbDogXCJkYXJrXCIrR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgXCJjbGlwLXBhdGhcIjogYHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYFxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBwcm9maXRQYXRoXG4gICAgICAgIF1cbiAgICApO1xuICAgIGNvbnN0IHByb2plY3RlZFByb2ZpdCA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwicHJvamVjdGVkUHJvZml0XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFN9KWAsXG4gICAgICAgICAgICBmaWxsOiBcIm5vbmVcIixcbiAgICAgICAgICAgIHN0cm9rZTogR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgXCJzdHJva2Utd2lkdGhcIjogMixcbiAgICAgICAgICAgIFwic3Ryb2tlLWxpbmVqb2luXCI6XCJyb3VuZFwiXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIHByb2ZpdFBhdGguY2xvbmVOb2RlKClcbiAgICAgICAgXVxuICAgICk7XG4gICAgY29uc3QgcHJvZml0TGF5ZXIgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInByb2ZpdExheWVyXCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTfSlgXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIG9ic2VydmVkUHJvZml0LFxuICAgICAgICAgICAgcHJvamVjdGVkUHJvZml0XG4gICAgICAgIF1cbiAgICApO1xuICAgIHJldHVybiBwcm9maXRMYXllcjtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTW9uZXlMYXllcihldmVudFNuYXBzaG90cz1bXSwgc2VydmVyU25hcHNob3RzPVtdLCBub3cpIHtcbiAgICBjb25zdCBtb25leUxheWVyID0gc3ZnRWwoXCJnXCIsIHtcbiAgICAgICAgaWQ6IFwibW9uZXlMYXllclwiLFxuICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTfSlgXG4gICAgfSk7XG5cbiAgICBpZiAoc2VydmVyU25hcHNob3RzLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgIHJldHVybiBtb25leUxheWVyO1xuICAgIH1cbiAgICBsZXQgbWluTW9uZXkgPSAwO1xuICAgIGxldCBtYXhNb25leSA9IHNlcnZlclNuYXBzaG90c1swXVsxXS5tb25leU1heDtcbiAgICBjb25zdCBzY2FsZSA9IDEvbWF4TW9uZXk7XG4gICAgbWF4TW9uZXkgKj0gMS4xXG5cbiAgICBjb25zdCBvYnNlcnZlZExheWVyID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJvYnNlcnZlZE1vbmV5XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4TW9uZXkgLSBtaW5Nb25leSkgLyBzY2FsZX0pYCxcbiAgICAgICAgICAgIGZpbGw6IFwiZGFya1wiK0dSQVBIX0NPTE9SUy5tb25leSxcbiAgICAgICAgICAgIC8vIFwiZmlsbC1vcGFjaXR5XCI6IDAuNSxcbiAgICAgICAgICAgIFwiY2xpcC1wYXRoXCI6IGB1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWBcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgcmVuZGVyT2JzZXJ2ZWRQYXRoKFwibW9uZXlBdmFpbGFibGVcIiwgc2VydmVyU25hcHNob3RzLCBtaW5Nb25leSwgbm93LCBzY2FsZSlcbiAgICAgICAgXVxuICAgICk7XG4gICAgbW9uZXlMYXllci5hcHBlbmQob2JzZXJ2ZWRMYXllcik7XG5cbiAgICBjb25zdCBwcm9qZWN0ZWRMYXllciA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwicHJvamVjdGVkTW9uZXlcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhNb25leSAtIG1pbk1vbmV5KSAvIHNjYWxlfSlgLFxuICAgICAgICAgICAgc3Ryb2tlOiBHUkFQSF9DT0xPUlMubW9uZXksXG4gICAgICAgICAgICBmaWxsOiBcIm5vbmVcIixcbiAgICAgICAgICAgIFwic3Ryb2tlLXdpZHRoXCI6IDIsXG4gICAgICAgICAgICBcInN0cm9rZS1saW5lam9pblwiOlwiYmV2ZWxcIlxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBjb21wdXRlUHJvamVjdGVkUGF0aChcIm1vbmV5QXZhaWxhYmxlXCIsIGV2ZW50U25hcHNob3RzLCBub3csIHNjYWxlKVxuICAgICAgICBdXG4gICAgKTtcbiAgICBtb25leUxheWVyLmFwcGVuZChwcm9qZWN0ZWRMYXllcik7XG5cbiAgICByZXR1cm4gbW9uZXlMYXllcjtcbn1cblxuIl19