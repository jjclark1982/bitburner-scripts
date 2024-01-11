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
// interface ServerInfo {
//     moneyAvailable: number;
//     moneyMax: number;
//     hackDifficulty: number;
//     minDifficulty: number;
// }
// type ServerSnapshot = [TimeMs, ServerInfo];
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
            `> run ${ns.getScriptName()} --port 1`,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBNERFO0FBSUYsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLEtBQThCLENBQUM7QUFTeEQsSUFBSSxRQUFRLEdBQUcsV0FBVyxDQUFDLEdBQUcsRUFBWSxDQUFDO0FBQzNDOzs7O0dBSUc7QUFDSCxTQUFTLFdBQVcsQ0FBQyxDQUFTLEVBQUUsRUFBRSxHQUFDLFFBQVE7SUFDdkMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBZ0IsQ0FBQztBQUM1QyxDQUFDO0FBRUQsU0FBUyxjQUFjLENBQUMsQ0FBYztJQUNsQyxPQUFPLENBQUMsR0FBRyxZQUFZLEdBQUcsYUFBMkIsQ0FBQztBQUMxRCxDQUFDO0FBRUQsTUFBTSxZQUFZLEdBQUc7SUFDakIsTUFBTSxFQUFFLE1BQU07SUFDZCxNQUFNLEVBQUUsWUFBWTtJQUNwQixRQUFRLEVBQUUsUUFBUTtJQUNsQixXQUFXLEVBQUUsS0FBSztJQUNsQixRQUFRLEVBQUUsU0FBUztJQUNuQixNQUFNLEVBQUUsTUFBTTtJQUNkLFFBQVEsRUFBRSxNQUFNO0lBQ2hCLFVBQVUsRUFBRSxLQUFLO0lBQ2pCLE9BQU8sRUFBRSxNQUFNO0NBQ2xCLENBQUM7QUFFRixNQUFNLFlBQVksR0FBRyxHQUFpQixDQUFDO0FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEVBQWlCLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUcsR0FBYSxDQUFDO0FBQ3BDLE1BQU0sYUFBYSxHQUFHLEVBQVksQ0FBQztBQTBCbkMseUJBQXlCO0FBQ3pCLDhCQUE4QjtBQUM5Qix3QkFBd0I7QUFDeEIsOEJBQThCO0FBQzlCLDZCQUE2QjtBQUM3QixJQUFJO0FB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QzlFLENBQ0osQ0FBQztJQUNGLFVBQVUsQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUM7SUFFakMsTUFBTSxjQUFjLEdBQUcsS0FBSyxDQUN4QixHQUFHLEVBQUU7UUFDRCxFQUFFLEVBQUUsZ0JBQWdCO1FBQ3BCLFNBQVMsRUFBRSxlQUFlLGFBQWEsYUFBYSxDQUFDLGFBQWEsR0FBRyxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUMsR0FBRyxLQUFLLEdBQUc7UUFDckcsTUFBTSxFQUFFLFlBQVksQ0FBQyxLQUFLO1FBQzFCLElBQUksRUFBRSxNQUFNO1FBQ1osY0FBYyxFQUFFLENBQUM7UUFDakIsaUJBQWlCLEVBQUMsT0FBTztLQUM1QixFQUFFO1FBQ0Msb0JBQW9CLENBQUMsZ0JBQWdCLEVBQUUsY0FBYyxFQUFFLEdBQUcsRUFBRSxLQUFLLENBQUM7S0FDckUsQ0FDSixDQUFDO0lBQ0YsVUFBVSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQztJQUVsQyxPQUFPLFVBQVUsQ0FBQztBQUN0QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLypcblxuVXNhZ2Vcbi0tLS0tXG5cblN0YXJ0IHRoZSBiYXRjaCB2aWV3ZXIgc2NyaXB0IGZyb20gdGhlIGNvbW1hbmQgbGluZTpcblxuICAgIHJ1biBiYXRjaC12aWV3LmpzIC0tcG9ydCAxMFxuXG5UaGVuIHNlbmQgbWVzc2FnZXMgdG8gaXQgZnJvbSBvdGhlciBzY3JpcHRzLlxuXG5FeGFtcGxlOiBEaXNwbGF5IGFjdGlvbiB0aW1pbmcgKGhhY2sgLyBncm93IC8gd2Vha2VuKVxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdoYWNrJyxcbiAgICAgICAgam9iSUQ6IDEsXG4gICAgICAgIHN0YXJ0VGltZTogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgICAgIGR1cmF0aW9uOiBucy5nZXRIYWNrVGltZSh0YXJnZXQpLFxuICAgIH0pKTtcblxuRXhhbXBsZTogVXBkYXRlIGFuIGFjdGlvbiB0aGF0IGhhcyBhbHJlYWR5IGJlZW4gZGlzcGxheWVkXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgam9iSUQ6IDEsXG4gICAgICAgIHN0YXJ0VGltZUFjdHVhbDogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgfSkpO1xuICAgIGF3YWl0IG5zLmhhY2sodGFyZ2V0KTtcbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgam9iSUQ6IDEsXG4gICAgICAgIGVuZFRpbWVBY3R1YWw6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgIH0pKTtcblxuRXhhbXBsZTogRGlzcGxheSBhIGJsYW5rIHJvdyBiZXR3ZWVuIGFjdGlvbnMgKHRvIHZpc3VhbGx5IHNlcGFyYXRlIGJhdGNoZXMpXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ3NwYWNlcicsXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBEaXNwbGF5IG9ic2VydmVkIHNlY3VyaXR5IC8gbW9uZXkgbGV2ZWxcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnb2JzZXJ2ZWQnLFxuICAgICAgICB0aW1lOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICAgICAgbWluRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyTWluU2VjdXJpdHlMZXZlbCh0YXJnZXQpLFxuICAgICAgICBoYWNrRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyU2VjdXJpdHlMZXZlbCh0YXJnZXQpLFxuICAgICAgICBtb25leU1heDogbnMuZ2V0U2VydmVyTWF4TW9uZXkodGFyZ2V0KSxcbiAgICAgICAgbW9uZXlBdmFpbGFibGU6IG5zLmdldFNlcnZlck1vbmV5QXZhaWxhYmxlKHRhcmdldCksXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBEaXNwbGF5IGV4cGVjdGVkIHNlY3VyaXR5IC8gbW9uZXkgbGV2ZWwgKHZhcmllcyBieSBhY3Rpb24gdHlwZSBhbmQgeW91ciBzdHJhdGVneSlcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnZXhwZWN0ZWQnLFxuICAgICAgICB0aW1lOiBqb2Iuc3RhcnRUaW1lICsgam9iLmR1cmF0aW9uLFxuICAgICAgICBtaW5EaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJNaW5TZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIGhhY2tEaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJTZWN1cml0eUxldmVsKHRhcmdldCkgKyBucy5oYWNrQW5hbHl6ZVNlY3VyaXR5KGpvYi50aHJlYWRzKSxcbiAgICAgICAgbW9uZXlNYXg6IG5zLmdldFNlcnZlck1heE1vbmV5KHRhcmdldCksXG4gICAgICAgIG1vbmV5QXZhaWxhYmxlOiBNYXRoLm1heCgwLCBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpIC0gbnMuaGFja0FuYWx5emUodGFyZ2V0KSAqIGpvYi50aHJlYWRzICogbnMuaGFja0FuYWx5emVDaGFuY2UodGFyZ2V0KSksXG4gICAgfSkpO1xuXG4qL1xuXG5pbXBvcnQgdHlwZSB7IE5TLCBOZXRzY3JpcHRQb3J0LCBTZXJ2ZXIgfSBmcm9tICdAbnMnO1xuaW1wb3J0IHR5cGUgUmVhY3ROYW1lc3BhY2UgZnJvbSAncmVhY3QvaW5kZXgnO1xuY29uc3QgUmVhY3QgPSBnbG9iYWxUaGlzLlJlYWN0IGFzIHR5cGVvZiBSZWFjdE5hbWVzcGFjZTtcblxuLy8gLS0tLS0gY29uc3RhbnRzIC0tLS0tIFxuXG50eXBlIFRpbWVNcyA9IFJldHVyblR5cGU8dHlwZW9mIHBlcmZvcm1hbmNlLm5vdz4gJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJtaWxsaXNlY29uZHNcIiB9O1xudHlwZSBUaW1lU2Vjb25kcyA9IG51bWJlciAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcInNlY29uZHNcIiB9O1xudHlwZSBUaW1lUGl4ZWxzID0gbnVtYmVyICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwicGl4ZWxzXCIgfTtcbnR5cGUgUGl4ZWxzID0gbnVtYmVyICYgeyBfX3VuaXRzOiBcInBpeGVsc1wiIH07XG5cbmxldCBpbml0VGltZSA9IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNcztcbi8qKlxuICogQ29udmVydCB0aW1lc3RhbXBzIHRvIHNlY29uZHMgc2luY2UgdGhlIGdyYXBoIHdhcyBzdGFydGVkLlxuICogVG8gcmVuZGVyIFNWR3MgdXNpbmcgbmF0aXZlIHRpbWUgdW5pdHMsIHRoZSB2YWx1ZXMgbXVzdCBiZSB2YWxpZCAzMi1iaXQgaW50cy5cbiAqIFNvIHdlIGNvbnZlcnQgdG8gYSByZWNlbnQgZXBvY2ggaW4gY2FzZSBEYXRlLm5vdygpIHZhbHVlcyBhcmUgdXNlZC5cbiAqL1xuZnVuY3Rpb24gY29udmVydFRpbWUodDogVGltZU1zLCB0MD1pbml0VGltZSk6IFRpbWVTZWNvbmRzIHtcbiAgICByZXR1cm4gKCh0IC0gdDApIC8gMTAwMCkgYXMgVGltZVNlY29uZHM7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRTZWNUb1B4KHQ6IFRpbWVTZWNvbmRzKTogVGltZVBpeGVscyB7XG4gICAgcmV0dXJuIHQgKiBXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTIGFzIFRpbWVQaXhlbHM7XG59XG5cbmNvbnN0IEdSQVBIX0NPTE9SUyA9IHtcbiAgICBcImhhY2tcIjogXCJjeWFuXCIsXG4gICAgXCJncm93XCI6IFwibGlnaHRncmVlblwiLFxuICAgIFwid2Vha2VuXCI6IFwieWVsbG93XCIsXG4gICAgXCJjYW5jZWxsZWRcIjogXCJyZWRcIixcbiAgICBcImRlc3luY1wiOiBcIm1hZ2VudGFcIixcbiAgICBcInNhZmVcIjogXCIjMTExXCIsXG4gICAgXCJ1bnNhZmVcIjogXCIjMzMzXCIsXG4gICAgXCJzZWN1cml0eVwiOiBcInJlZFwiLFxuICAgIFwibW9uZXlcIjogXCJibHVlXCJcbn07XG5cbmNvbnN0IFdJRFRIX1BJWEVMUyA9IDgwMCBhcyBUaW1lUGl4ZWxzO1xuY29uc3QgV0lEVEhfU0VDT05EUyA9IDE2IGFzIFRpbWVTZWNvbmRzO1xuY29uc3QgSEVJR0hUX1BJWEVMUyA9IDYwMCBhcyBQaXhlbHM7XG5jb25zdCBGT09URVJfUElYRUxTID0gNTAgYXMgUGl4ZWxzO1xuLy8gVE9ETzogdXNlIGEgY29udGV4dCBmb3IgdGhlc2Ugc2NhbGUgZmFjdG9ycy4gc3VwcG9ydCBzZXR0aW5nIHRoZW0gYnkgYXJncyBhbmQgc2Nyb2xsLWdlc3R1cmVzLlxuLy8gY29uc3QgU2NyZWVuQ29udGV4dCA9IFJlYWN0LmNyZWF0ZUNvbnRleHQoe1dJRFRIX1BJWEVMUywgV0lEVEhfU0VDT05EUywgSEVJR0hUX1BJWEVMUywgRk9PVEVSX1BJWEVMU30pO1xuLy8gVE9ETzogcmV2aWV3IHVzZSBvZiA2MDAwMDAsIDYwMDAwLCBhbmQgV0lEVEhfU0VDT05EUyBhcyBjbGlwcGluZyBsaW1pdHMuXG5cblxuLy8gLS0tLS0gdHlwZXMgLS0tLS1cblxuaW50ZXJmYWNlIEpvYiB7XG4gICAgam9iSUQ6IEpvYklEO1xuICAgIHJvd0lEOiBudW1iZXI7XG4gICAgdHlwZTogXCJoYWNrXCIgfCBcImdyb3dcIiB8IFwid2Vha2VuXCI7XG4gICAgZHVyYXRpb246IFRpbWVNcztcbiAgICBzdGFydFRpbWU6IFRpbWVNcztcbiAgICBzdGFydFRpbWVBY3R1YWw6IFRpbWVNcztcbiAgICBlbmRUaW1lOiBUaW1lTXM7XG4gICAgZW5kVGltZUFjdHVhbDogVGltZU1zO1xuICAgIGNhbmNlbGxlZDogYm9vbGVhbjtcbiAgICAvLyBzZXJ2ZXJCZWZvcmU6IFNlcnZlckluZm87XG4gICAgLy8gc2VydmVyQWZ0ZXI6IFNlcnZlckluZm87XG4gICAgcmVzdWx0QWN0dWFsOiBudW1iZXI7XG4gICAgLy8gY2hhbmdlOiB7XG4gICAgLy8gICAgIHBsYXllck1vbmV5OiBudW1iZXI7XG4gICAgLy8gfTtcbn1cblxuLy8gaW50ZXJmYWNlIFNlcnZlckluZm8ge1xuLy8gICAgIG1vbmV5QXZhaWxhYmxlOiBudW1iZXI7XG4vLyAgICAgbW9uZXlNYXg6IG51bWJlcjtcbi8vICAgICBoYWNrRGlmZmljdWx0eTogbnVtYmVyO1xuLy8gICAgIG1pbkRpZmZpY3VsdHk6IG51bWJlcjtcbi8vIH1cbi8vIHR5cGUgU2VydmVyU25hcHNob3QgPSBbVGltZU1zLCBTZXJ2ZXJJbmZvXTtcblxuLy8gLS0tLS0gbWFpbiAtLS0tLVxuXG5jb25zdCBGTEFHUzogW3N0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IHN0cmluZ1tdXVtdID0gW1xuICAgIFtcImhlbHBcIiwgZmFsc2VdLFxuICAgIFtcInBvcnRcIiwgMF1cbl07XG5cbmV4cG9ydCBmdW5jdGlvbiBhdXRvY29tcGxldGUoZGF0YTogYW55LCBhcmdzOiBzdHJpbmdbXSkge1xuICAgIGRhdGEuZmxhZ3MoRkxBR1MpO1xuICAgIHJldHVybiBbXTtcbn1cblxuLyoqIEBwYXJhbSB7TlN9IG5zICoqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1haW4obnM6IE5TKSB7XG4gICAgbnMuZGlzYWJsZUxvZygnc2xlZXAnKTtcbiAgICBucy5jbGVhckxvZygpO1xuICAgIG5zLnRhaWwoKTtcbiAgICBucy5yZXNpemVUYWlsKDgxMCwgNjQwKTtcblxuICAgIGNvbnN0IGZsYWdzID0gbnMuZmxhZ3MoRkxBR1MpO1xuICAgIGlmIChmbGFncy5oZWxwKSB7XG4gICAgICAgIG5zLnRwcmludChbXG4gICAgICAgICAgICBgVVNBR0VgLFxuICAgICAgICAgICAgYD4gcnVuICR7bnMuZ2V0U2NyaXB0TmFtZSgpfSAtLXBvcnQgMWAsXG4gICAgICAgICAgICAnICdcbiAgICAgICAgXS5qb2luKFwiXFxuXCIpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBvcnROdW0gPSBmbGFncy5wb3J0IGFzIG51bWJlciB8fCBucy5waWQ7XG4gICAgY29uc3QgcG9ydCA9IG5zLmdldFBvcnRIYW5kbGUocG9ydE51bSk7XG4gICAgLy8gcG9ydC5jbGVhcigpO1xuICAgIG5zLnByaW50KGBMaXN0ZW5pbmcgb24gUG9ydCAke3BvcnROdW19YCk7XG5cbiAgICBjb25zdCBiYXRjaFZpZXcgPSA8QmF0Y2hWaWV3IG5zPXtuc30gcG9ydE51bT17cG9ydE51bX0gLz47XG4gICAgbnMucHJpbnRSYXcoYmF0Y2hWaWV3KTtcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGF3YWl0IHBvcnQubmV4dFdyaXRlKCk7XG4gICAgfVxufVxuXG4vLyAtLS0tLSBCYXRjaFZpZXcgLS0tLS1cblxudHlwZSBKb2JJRCA9IG51bWJlciB8IHN0cmluZztcbmludGVyZmFjZSBBY3Rpb25NZXNzYWdlIHtcbiAgICBqb2JJRDogSm9iSUQ7XG4gICAgdHlwZTogXCJoYWNrXCIgfCBcImdyb3dcIiB8IFwid2Vha2VuXCI7XG4gICAgZHVyYXRpb246IFRpbWVNcztcbiAgICBzdGFydFRpbWU6IFRpbWVNcztcbiAgICBzdGFydFRpbWVBY3R1YWw/OiBUaW1lTXM7XG4gICAgZW5kVGltZT86IFRpbWVNcztcbiAgICBlbmRUaW1lQWN0dWFsPzogVGltZU1zO1xuICAgIGNhbmNlbGxlZD86IGJvb2xlYW47XG4gICAgcmVzdWx0PzogbnVtYmVyO1xufVxuaW50ZXJmYWNlIFNwYWNlck1lc3NhZ2Uge1xuICAgIHR5cGU6IFwic3BhY2VyXCJcbn1cbmludGVyZmFjZSBTZXJ2ZXJTZWN1cml0eU1lc3NhZ2Uge1xuICAgIHRpbWU6IFRpbWVNcztcbiAgICBoYWNrRGlmZmljdWx0eTogbnVtYmVyO1xuICAgIG1pbkRpZmZpY3VsdHk6IG51bWJlcjtcbn1cbmludGVyZmFjZSBTZXJ2ZXJNb25leU1lc3NhZ2Uge1xuICAgIHRpbWU6IFRpbWVNc1xuICAgIG1vbmV5QXZhaWxhYmxlOiBudW1iZXI7XG4gICAgbW9uZXlNYXg6IG51bWJlcjtcbn1cbnR5cGUgU2VydmVyTWVzc2FnZSA9IFNlcnZlclNlY3VyaXR5TWVzc2FnZSB8IFNlcnZlck1vbmV5TWVzc2FnZVxudHlwZSBFeHBlY3RlZFNlcnZlck1lc3NhZ2UgPSBTZXJ2ZXJNZXNzYWdlICYge1xuICAgIHR5cGU6IFwiZXhwZWN0ZWRcIlxufVxudHlwZSBPYnNlcnZlZFNlcnZlck1lc3NhZ2UgPSBTZXJ2ZXJNZXNzYWdlICYge1xuICAgIHR5cGU6IFwib2JzZXJ2ZWRcIlxufVxudHlwZSBCYXRjaFZpZXdNZXNzYWdlID0gQWN0aW9uTWVzc2FnZSB8IFNwYWNlck1lc3NhZ2UgfCBFeHBlY3RlZFNlcnZlck1lc3NhZ2UgfCBPYnNlcnZlZFNlcnZlck1lc3NhZ2U7XG5cbmludGVyZmFjZSBCYXRjaFZpZXdQcm9wcyB7XG4gICAgbnM6IE5TO1xuICAgIHBvcnROdW06IG51bWJlcjtcbn1cbmludGVyZmFjZSBCYXRjaFZpZXdTdGF0ZSB7XG4gICAgcnVubmluZzogYm9vbGVhbjtcbiAgICBub3c6IFRpbWVNcztcbn1cbmV4cG9ydCBjbGFzcyBCYXRjaFZpZXcgZXh0ZW5kcyBSZWFjdC5Db21wb25lbnQ8QmF0Y2hWaWV3UHJvcHMsIEJhdGNoVmlld1N0YXRlPiB7XG4gICAgcG9ydDogTmV0c2NyaXB0UG9ydDtcbiAgICBqb2JzOiBNYXA8c3RyaW5nIHwgbnVtYmVyLCBKb2I+O1xuICAgIHNlcXVlbnRpYWxSb3dJRDogbnVtYmVyID0gMDtcbiAgICBzZXF1ZW50aWFsSm9iSUQ6IG51bWJlciA9IDA7XG4gICAgZXhwZWN0ZWRTZXJ2ZXJzOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2VbXTtcbiAgICBvYnNlcnZlZFNlcnZlcnM6IE9ic2VydmVkU2VydmVyTWVzc2FnZVtdO1xuXG4gICAgY29uc3RydWN0b3IocHJvcHM6IEJhdGNoVmlld1Byb3BzKXtcbiAgICAgICAgc3VwZXIocHJvcHMpO1xuICAgICAgICBjb25zdCB7IG5zLCBwb3J0TnVtIH0gPSBwcm9wcztcbiAgICAgICAgdGhpcy5zdGF0ZSA9IHtcbiAgICAgICAgICAgIHJ1bm5pbmc6IHRydWUsXG4gICAgICAgICAgICBub3c6IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNc1xuICAgICAgICB9O1xuICAgICAgICB0aGlzLnBvcnQgPSBucy5nZXRQb3J0SGFuZGxlKHBvcnROdW0pO1xuICAgICAgICB0aGlzLmpvYnMgPSBuZXcgTWFwKCk7XG4gICAgICAgIHRoaXMuZXhwZWN0ZWRTZXJ2ZXJzID0gW107XG4gICAgICAgIHRoaXMub2JzZXJ2ZWRTZXJ2ZXJzID0gW107XG4gICAgfVxuXG4gICAgY29tcG9uZW50RGlkTW91bnQoKSB7XG4gICAgICAgIGNvbnN0IHsgbnMgfSA9IHRoaXMucHJvcHM7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IHRydWV9KTtcbiAgICAgICAgbnMuYXRFeGl0KCgpPT57XG4gICAgICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiBmYWxzZX0pO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5yZWFkUG9ydCgpO1xuICAgICAgICB0aGlzLmFuaW1hdGUoKTtcbiAgICAgICAgLy8gT2JqZWN0LmFzc2lnbihnbG9iYWxUaGlzLCB7YmF0Y2hWaWV3OiB0aGlzfSk7XG4gICAgfVxuXG4gICAgY29tcG9uZW50V2lsbFVubW91bnQoKSB7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IGZhbHNlfSk7XG4gICAgfVxuXG4gICAgcmVhZFBvcnQgPSAoKT0+e1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUucnVubmluZykgcmV0dXJuO1xuICAgICAgICB3aGlsZSghdGhpcy5wb3J0LmVtcHR5KCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZzogQmF0Y2hWaWV3TWVzc2FnZSA9IEpTT04ucGFyc2UodGhpcy5wb3J0LnJlYWQoKSBhcyBzdHJpbmcpO1xuICAgICAgICAgICAgdGhpcy5yZWNlaXZlTWVzc2FnZShtc2cpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMucG9ydC5uZXh0V3JpdGUoKS50aGVuKHRoaXMucmVhZFBvcnQpO1xuICAgIH1cblxuICAgIHJlY2VpdmVNZXNzYWdlKG1zZzogQmF0Y2hWaWV3TWVzc2FnZSkge1xuICAgICAgICBpZiAobXNnLnR5cGUgPT0gXCJzcGFjZXJcIikge1xuICAgICAgICAgICAgdGhpcy5zZXF1ZW50aWFsUm93SUQgKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cudHlwZSA9PSBcImV4cGVjdGVkXCIpIHtcbiAgICAgICAgICAgIHRoaXMuZXhwZWN0ZWRTZXJ2ZXJzLnB1c2gobXNnKTtcbiAgICAgICAgICAgIC8vIFRPRE86IHNvcnQgYnkgdGltZSBhbmQgcmVtb3ZlIHZlcnkgb2xkIGl0ZW1zXG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAobXNnLnR5cGUgPT0gXCJvYnNlcnZlZFwiKSB7XG4gICAgICAgICAgICB0aGlzLm9ic2VydmVkU2VydmVycy5wdXNoKG1zZyk7XG4gICAgICAgICAgICAvLyBUT0RPOiBzb3J0IGJ5IHRpbWUgYW5kIHJlbW92ZSB2ZXJ5IG9sZCBpdGVtc1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKG1zZy5qb2JJRCAhPT0gdW5kZWZpbmVkIHx8IG1zZy50eXBlID09ICdoYWNrJyB8fCBtc2cudHlwZSA9PSAnZ3JvdycgfHwgbXNnLnR5cGUgPT0gJ3dlYWtlbicpIHtcbiAgICAgICAgICAgIHRoaXMuYWRkSm9iKG1zZyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGRKb2IobXNnOiBBY3Rpb25NZXNzYWdlKSB7XG4gICAgICAgIC8vIGFzc2lnbiBzZXF1ZW50aWFsIElEIGlmIG5lZWRlZFxuICAgICAgICBsZXQgam9iSUQgPSBtc2cuam9iSUQ7XG4gICAgICAgIGlmIChqb2JJRCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB3aGlsZSAodGhpcy5qb2JzLmhhcyh0aGlzLnNlcXVlbnRpYWxKb2JJRCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNlcXVlbnRpYWxKb2JJRCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgam9iSUQgPSB0aGlzLnNlcXVlbnRpYWxKb2JJRDtcbiAgICAgICAgfVxuICAgICAgICAvLyBsb2FkIGV4aXN0aW5nIGRhdGEgaWYgcHJlc2VudFxuICAgICAgICBsZXQgam9iID0gdGhpcy5qb2JzLmdldChqb2JJRCk7XG4gICAgICAgIGlmIChqb2IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgam9iID0ge1xuICAgICAgICAgICAgICAgIGpvYklEOiBqb2JJRCxcbiAgICAgICAgICAgICAgICByb3dJRDogdGhpcy5zZXF1ZW50aWFsUm93SUQrK1xuICAgICAgICAgICAgfSBhcyBKb2I7XG4gICAgICAgIH1cbiAgICAgICAgLy8gbWVyZ2UgdXBkYXRlcyBmcm9tIG1lc3NhZ2VcbiAgICAgICAgam9iID0gT2JqZWN0LmFzc2lnbihqb2IsIG1zZyk7XG4gICAgICAgIHRoaXMuam9icy5zZXQobXNnLmpvYklELCBqb2IpO1xuICAgICAgICB0aGlzLmNsZWFuSm9icygpO1xuICAgIH1cblxuICAgIGNsZWFuSm9icygpIHtcbiAgICAgICAgLy8gZmlsdGVyIG91dCBqb2JzIHdpdGggZW5kdGltZSBpbiBwYXN0XG4gICAgICAgIGlmICh0aGlzLmpvYnMuc2l6ZSA+IDIwMCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBqb2JJRCBvZiB0aGlzLmpvYnMua2V5cygpKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgam9iID0gdGhpcy5qb2JzLmdldChqb2JJRCkgYXMgSm9iO1xuICAgICAgICAgICAgICAgIGlmICgoam9iLmVuZFRpbWVBY3R1YWwgPz8gam9iLmVuZFRpbWUpIDwgdGhpcy5zdGF0ZS5ub3ctKFdJRFRIX1NFQ09ORFMqMioxMDAwKSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmpvYnMuZGVsZXRlKGpvYklEKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhbmltYXRlID0gKCk9PntcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlLnJ1bm5pbmcpIHJldHVybjtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7bm93OiBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXN9KTtcbiAgICAgICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0ZSk7XG4gICAgfVxuXG4gICAgcmVuZGVyKCkge1xuICAgICAgICBjb25zdCBkaXNwbGF5Sm9icyA9IFsuLi50aGlzLmpvYnMudmFsdWVzKCldXG5cbiAgICAgICAgLy8gY29uc3Qgc2VydmVyUHJlZGljdGlvbnMgPSBkaXNwbGF5Sm9icy5tYXAoKGpvYik9PihcbiAgICAgICAgLy8gICAgIFtqb2IuZW5kVGltZSBhcyBUaW1lTXMsIGpvYi5zZXJ2ZXJBZnRlciBhcyBTZXJ2ZXJdIGFzIFNlcnZlclNuYXBzaG90XG4gICAgICAgIC8vICkpLmZpbHRlcigoW3QsIHNdKT0+ISFzKS5zb3J0KChhLGIpPT5hWzBdLWJbMF0pO1xuICAgICAgICAvLyBjb25zdCBzZXJ2ZXJPYnNlcnZhdGlvbnMgPSBkaXNwbGF5Sm9icy5tYXAoKGpvYik9PihcbiAgICAgICAgLy8gICAgIFtqb2Iuc3RhcnRUaW1lIGFzIFRpbWVNcywgam9iLnNlcnZlckJlZm9yZSBhcyBTZXJ2ZXJdIGFzIFNlcnZlclNuYXBzaG90XG4gICAgICAgIC8vICkpLmZpbHRlcigoW3QsIHNdKT0+ISFzKS5zb3J0KChhLGIpPT5hWzBdLWJbMF0pO1xuICAgIFxuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgPEdyYXBoRnJhbWUgbm93PXt0aGlzLnN0YXRlLm5vd30+XG4gICAgICAgICAgICAgICAgPFNhZmV0eUxheWVyIGV4cGVjdGVkU2VydmVycz17dGhpcy5leHBlY3RlZFNlcnZlcnN9IC8+XG4gICAgICAgICAgICAgICAgPEpvYkxheWVyIGpvYnM9e2Rpc3BsYXlKb2JzfSAvPlxuICAgICAgICAgICAgICAgIDxTZWN1cml0eUxheWVyIGV4cGVjdGVkU2VydmVycz17dGhpcy5leHBlY3RlZFNlcnZlcnN9IG9ic2VydmVkU2VydmVycz17dGhpcy5vYnNlcnZlZFNlcnZlcnN9IC8+XG4gICAgICAgICAgICAgICAgPE1vbmV5TGF5ZXIgZXhwZWN0ZWRTZXJ2ZXJzPXt0aGlzLmV4cGVjdGVkU2VydmVyc30gb2JzZXJ2ZWRTZXJ2ZXJzPXt0aGlzLm9ic2VydmVkU2VydmVyc30gLz5cbiAgICAgICAgICAgIDwvR3JhcGhGcmFtZT5cbiAgICAgICAgKVxuICAgIH1cbn1cblxuZnVuY3Rpb24gR3JhcGhGcmFtZSh7bm93LCBjaGlsZHJlbn06e25vdzpUaW1lTXMsIGNoaWxkcmVuOiBSZWFjdC5SZWFjdE5vZGV9KTogUmVhY3QuUmVhY3RFbGVtZW50IHtcbiAgICAvLyBUT0RPOiBpbml0VGltZSBpcyB1c2VkIGFzIHVuaXF1ZSBET00gSUQgYW5kIGFzIHJlbmRlcmluZyBvcmlnaW4gYnV0IGl0IGlzIHBvb3JseSBzdWl0ZWQgZm9yIGJvdGhcbiAgICByZXR1cm4gKFxuICAgICAgICA8c3ZnIHZlcnNpb249XCIxLjFcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCJcbiAgICAgICAgICAgIHdpZHRoPXtXSURUSF9QSVhFTFN9XG4gICAgICAgICAgICBoZWlnaHQ9e0hFSUdIVF9QSVhFTFN9IFxuICAgICAgICAgICAgLy8gU2V0IHRoZSB2aWV3Qm94IGZvciAxMCBzZWNvbmRzIG9mIGhpc3RvcnksIDYgc2Vjb25kcyBvZiBmdXR1cmUuXG4gICAgICAgICAgICB2aWV3Qm94PXtgJHtjb252ZXJ0U2VjVG9QeCgtMTAgYXMgVGltZVNlY29uZHMpfSAwICR7V0lEVEhfUElYRUxTfSAke0hFSUdIVF9QSVhFTFN9YH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGRlZnM+XG4gICAgICAgICAgICAgICAgPGNsaXBQYXRoIGlkPXtgaGlkZS1mdXR1cmUtJHtpbml0VGltZX1gfSBjbGlwUGF0aFVuaXRzPVwidXNlclNwYWNlT25Vc2VcIj5cbiAgICAgICAgICAgICAgICAgICAgPHJlY3QgaWQ9XCJoaWRlLWZ1dHVyZS1yZWN0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKG5vdy02MDAwMCBhcyBUaW1lTXMpfSB3aWR0aD17Y29udmVydFRpbWUoNjAwMDAgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICAgICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezUwfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvY2xpcFBhdGg+XG4gICAgICAgICAgICA8L2RlZnM+XG4gICAgICAgICAgICA8cmVjdCBpZD1cImJhY2tncm91bmRcIiB4PXtjb252ZXJ0U2VjVG9QeCgtMTAgYXMgVGltZVNlY29uZHMpfSB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCIgZmlsbD17R1JBUEhfQ09MT1JTLnNhZmV9IC8+XG4gICAgICAgICAgICA8ZyBpZD1cInRpbWVDb29yZGluYXRlc1wiIHRyYW5zZm9ybT17YHNjYWxlKCR7V0lEVEhfUElYRUxTIC8gV0lEVEhfU0VDT05EU30gMSkgdHJhbnNsYXRlKCR7Y29udmVydFRpbWUoaW5pdFRpbWUtbm93IGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfSAwKWB9PlxuICAgICAgICAgICAgICAgIHtjaGlsZHJlbn1cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMVwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0yXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy0yKkZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIDxyZWN0IGlkPVwiY3Vyc29yXCIgeD17MH0gd2lkdGg9ezF9IHk9ezB9IGhlaWdodD1cIjEwMCVcIiBmaWxsPVwid2hpdGVcIiAvPlxuICAgICAgICAgICAgPEdyYXBoTGVnZW5kIC8+XG4gICAgICAgIDwvc3ZnPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEdyYXBoTGVnZW5kKCk6IFJlYWN0LlJlYWN0RWxlbWVudCB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJMZWdlbmRcIiB0cmFuc2Zvcm09XCJ0cmFuc2xhdGUoLTQ5MCwgMTApLCBzY2FsZSguNSwgLjUpXCI+XG4gICAgICAgICAgICA8cmVjdCB4PXsxfSB5PXsxfSB3aWR0aD17Mjc1fSBoZWlnaHQ9ezM5Mn0gZmlsbD1cImJsYWNrXCIgc3Ryb2tlPVwiIzk3OTc5N1wiIC8+XG4gICAgICAgICAgICB7T2JqZWN0LmVudHJpZXMoR1JBUEhfQ09MT1JTKS5tYXAoKFtsYWJlbCwgY29sb3JdLCBpKT0+KFxuICAgICAgICAgICAgICAgIDxnIGtleT17bGFiZWx9IHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgyMiwgJHsxMyArIDQxKml9KWB9PlxuICAgICAgICAgICAgICAgICAgICA8cmVjdCB4PXswfSB5PXswfSB3aWR0aD17MjJ9IGhlaWdodD17MjJ9IGZpbGw9e2NvbG9yfSAvPlxuICAgICAgICAgICAgICAgICAgICA8dGV4dCBmb250RmFtaWx5PVwiQ291cmllciBOZXdcIiBmb250U2l6ZT17MzZ9IGZpbGw9XCIjODg4XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dHNwYW4geD17NDIuNX0geT17MzB9PntsYWJlbC5zdWJzdHJpbmcoMCwxKS50b1VwcGVyQ2FzZSgpK2xhYmVsLnN1YnN0cmluZygxKX08L3RzcGFuPlxuICAgICAgICAgICAgICAgICAgICA8L3RleHQ+XG4gICAgICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBTYWZldHlMYXllcih7ZXhwZWN0ZWRTZXJ2ZXJzfToge2V4cGVjdGVkU2VydmVyczogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlW119KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBsZXQgcHJldlNlcnZlcjogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlIHwgdW5kZWZpbmVkO1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwic2FmZXR5TGF5ZXJcIj5cbiAgICAgICAgICAgIHtleHBlY3RlZFNlcnZlcnMubWFwKChzZXJ2ZXIsIGkpPT57XG4gICAgICAgICAgICAgICAgbGV0IGVsID0gbnVsbDtcbiAgICAgICAgICAgICAgICAvLyBzaGFkZSB0aGUgYmFja2dyb3VuZCBiYXNlZCBvbiBzZWNMZXZlbFxuICAgICAgICAgICAgICAgIGlmIChwcmV2U2VydmVyICYmIHNlcnZlci50aW1lID4gcHJldlNlcnZlci50aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGVsID0gKDxyZWN0IGtleT17aX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHByZXZTZXJ2ZXIudGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZShzZXJ2ZXIudGltZSAtIHByZXZTZXJ2ZXIudGltZSwgMCl9XG4gICAgICAgICAgICAgICAgICAgICAgICB5PXswfSBoZWlnaHQ9XCIxMDAlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGw9eyhwcmV2U2VydmVyLmhhY2tEaWZmaWN1bHR5ID4gcHJldlNlcnZlci5taW5EaWZmaWN1bHR5KSA/IEdSQVBIX0NPTE9SUy51bnNhZmUgOiBHUkFQSF9DT0xPUlMuc2FmZX1cbiAgICAgICAgICAgICAgICAgICAgLz4pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBwcmV2U2VydmVyID0gc2VydmVyO1xuICAgICAgICAgICAgICAgIHJldHVybiBlbDtcbiAgICAgICAgICAgIH0pfVxuICAgICAgICAgICAge3ByZXZTZXJ2ZXIgJiYgKFxuICAgICAgICAgICAgICAgIDxyZWN0IGtleT1cInJlbWFpbmRlclwiXG4gICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHByZXZTZXJ2ZXIudGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZSg2MDAwMDAsIDApfVxuICAgICAgICAgICAgICAgICAgICB5PXswfSBoZWlnaHQ9XCIxMDAlXCJcbiAgICAgICAgICAgICAgICAgICAgZmlsbD17KHByZXZTZXJ2ZXIuaGFja0RpZmZpY3VsdHkgPiBwcmV2U2VydmVyLm1pbkRpZmZpY3VsdHkpID8gR1JBUEhfQ09MT1JTLnVuc2FmZSA6IEdSQVBIX0NPTE9SUy5zYWZlfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICApfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gSm9iTGF5ZXIoe2pvYnN9OiB7am9iczogSm9iW119KSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJqb2JMYXllclwiPlxuICAgICAgICAgICAge2pvYnMubWFwKChqb2I6IEpvYik9Pig8Sm9iQmFyIGpvYj17am9ifSBrZXk9e2pvYi5qb2JJRH0gLz4pKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEpvYkJhcih7am9ifToge2pvYjogSm9ifSk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgY29uc3QgeSA9ICgoam9iLnJvd0lEICsgMSkgJSAoKEhFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTKjIpIC8gNCkpICogNDtcbiAgICBsZXQgam9iQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLnN0YXJ0VGltZSAmJiBqb2IuZHVyYXRpb24pIHtcbiAgICAgICAgam9iQmFyID0gKDxyZWN0XG4gICAgICAgICAgICB4PXtjb252ZXJ0VGltZShqb2Iuc3RhcnRUaW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKGpvYi5kdXJhdGlvbiwgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsyfVxuICAgICAgICAgICAgZmlsbD17R1JBUEhfQ09MT1JTW2pvYi5jYW5jZWxsZWQgPyAnY2FuY2VsbGVkJyA6IGpvYi50eXBlXX1cbiAgICAgICAgLz4pXG4gICAgfTtcbiAgICBsZXQgc3RhcnRFcnJvckJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5zdGFydFRpbWVBY3R1YWwpIHtcbiAgICAgICAgY29uc3QgW3QxLCB0Ml0gPSBbam9iLnN0YXJ0VGltZSwgam9iLnN0YXJ0VGltZUFjdHVhbF0uc29ydCgoYSxiKT0+YS1iKTtcbiAgICAgICAgc3RhcnRFcnJvckJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUodDEpfSB3aWR0aD17Y29udmVydFRpbWUodDItdDEgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBmaWxsPXtHUkFQSF9DT0xPUlMuZGVzeW5jfVxuICAgICAgICAgLz4pO1xuICAgIH1cbiAgICBsZXQgZW5kRXJyb3JCYXIgPSBudWxsO1xuICAgIGlmIChqb2IuZW5kVGltZUFjdHVhbCkge1xuICAgICAgICBjb25zdCBbdDEsIHQyXSA9IFtqb2IuZW5kVGltZSwgam9iLmVuZFRpbWVBY3R1YWxdLnNvcnQoKGEsYik9PmEtYik7XG4gICAgICAgIGVuZEVycm9yQmFyID0gKDxyZWN0XG4gICAgICAgICAgICB4PXtjb252ZXJ0VGltZSh0MSl9IHdpZHRoPXtjb252ZXJ0VGltZSh0Mi10MSBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17MX1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SUy5kZXN5bmN9XG4gICAgICAgICAvPik7XG4gICAgfVxuICAgIHJldHVybiAoXG4gICAgICAgIDxnIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7eX0pYH0+XG4gICAgICAgICAgICB7am9iQmFyfVxuICAgICAgICAgICAge3N0YXJ0RXJyb3JCYXJ9XG4gICAgICAgICAgICB7ZW5kRXJyb3JCYXJ9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG50eXBlIFRpbWVWYWx1ZSA9IFtUaW1lTXMsIG51bWJlcl07XG5pbnRlcmZhY2UgU2VjdXJpdHlMYXllclByb3BzIHtcbiAgICBleHBlY3RlZFNlcnZlcnM6IEV4cGVjdGVkU2VydmVyTWVzc2FnZVtdO1xuICAgIG9ic2VydmVkU2VydmVyczogT2JzZXJ2ZWRTZXJ2ZXJNZXNzYWdlW11cbn1cbmZ1bmN0aW9uIFNlY3VyaXR5TGF5ZXIoe2V4cGVjdGVkU2VydmVycywgb2JzZXJ2ZWRTZXJ2ZXJzfTpTZWN1cml0eUxheWVyUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGV4cGVjdGVkU2VydmVycyA/Pz0gW107XG4gICAgb2JzZXJ2ZWRTZXJ2ZXJzID8/PSBbXTtcbiAgICBsZXQgbWluU2VjID0gMDtcbiAgICBsZXQgbWF4U2VjID0gMTtcbiAgICBmb3IgKGNvbnN0IHNuYXBzaG90cyBvZiBbZXhwZWN0ZWRTZXJ2ZXJzLCBvYnNlcnZlZFNlcnZlcnNdKSB7XG4gICAgICAgIGZvciAoY29uc3Qgc2VydmVyIG9mIHNuYXBzaG90cykge1xuICAgICAgICAgICAgbWluU2VjID0gTWF0aC5taW4obWluU2VjLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHkpO1xuICAgICAgICAgICAgbWF4U2VjID0gTWF0aC5tYXgobWF4U2VjLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgb2JzZXJ2ZWRFdmVudHMgPSBvYnNlcnZlZFNlcnZlcnMubWFwKChzZXJ2ZXIpPT5bc2VydmVyLnRpbWUsIHNlcnZlci5oYWNrRGlmZmljdWx0eV0pIGFzIFRpbWVWYWx1ZVtdO1xuICAgIGNvbnN0IHNob3VsZENsb3NlUGF0aCA9IHRydWU7XG4gICAgY29uc3Qgb2JzZXJ2ZWRQYXRoID0gY29tcHV0ZVBhdGhEYXRhKG9ic2VydmVkRXZlbnRzLCBtaW5TZWMsIHNob3VsZENsb3NlUGF0aCk7XG4gICAgY29uc3Qgb2JzZXJ2ZWRMYXllciA9IChcbiAgICAgICAgPGcgaWQ9XCJvYnNlcnZlZFNlY1wiXG4gICAgICAgICAgICB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4U2VjIC0gbWluU2VjKX0pYH1cbiAgICAgICAgICAgIGZpbGw9e1wiZGFya1wiK0dSQVBIX0NPTE9SUy5zZWN1cml0eX1cbiAgICAgICAgICAgIC8vIGZpbGxPcGFjaXR5OiAwLjUsXG4gICAgICAgICAgICBjbGlwUGF0aD17YHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHBhdGggZD17b2JzZXJ2ZWRQYXRoLmpvaW4oXCIgXCIpfSAvPlxuICAgICAgICA8L2c+XG4gICAgKTtcblxuICAgIGNvbnN0IGV4cGVjdGVkRXZlbnRzID0gZXhwZWN0ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyKT0+W3NlcnZlci50aW1lLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHldKSBhcyBUaW1lVmFsdWVbXTtcbiAgICBjb25zdCBwcmVkaWN0ZWRQYXRoID0gY29tcHV0ZVBhdGhEYXRhKGV4cGVjdGVkRXZlbnRzKTtcbiAgICBjb25zdCBwcmVkaWN0ZWRMYXllciA9IChcbiAgICAgICAgPGcgaWQ9XCJwcmVkaWN0ZWRTZWNcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heFNlYyAtIG1pblNlYyl9KWB9XG4gICAgICAgICAgICBzdHJva2U9e0dSQVBIX0NPTE9SUy5zZWN1cml0eX1cbiAgICAgICAgICAgIGZpbGw9XCJub25lXCJcbiAgICAgICAgICAgIHN0cm9rZVdpZHRoPXsyfVxuICAgICAgICAgICAgc3Ryb2tlTGluZWpvaW49XCJiZXZlbFwiXG4gICAgICAgID5cbiAgICAgICAgICAgIDxwYXRoIGQ9e3ByZWRpY3RlZFBhdGguam9pbihcIiBcIil9IHZlY3RvckVmZmVjdD1cIm5vbi1zY2FsaW5nLXN0cm9rZVwiIC8+XG4gICAgICAgIDwvZz5cbiAgICApO1xuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJzZWNMYXllclwiIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7SEVJR0hUX1BJWEVMUyAtIDIqRk9PVEVSX1BJWEVMU30pYH0+XG4gICAgICAgICAgICB7b2JzZXJ2ZWRMYXllcn1cbiAgICAgICAgICAgIHtwcmVkaWN0ZWRMYXllcn1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIGNvbXB1dGVQYXRoRGF0YShldmVudHM6IFRpbWVWYWx1ZVtdLCBtaW5WYWx1ZT0wLCBzaG91bGRDbG9zZT1mYWxzZSwgc2NhbGU9MSkge1xuICAgIGNvbnN0IHBhdGhEYXRhID0gW107XG4gICAgaWYgKGV2ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IFt0aW1lLCB2YWx1ZV0gPSBldmVudHNbMF07XG4gICAgICAgIC8vIHN0YXJ0IGxpbmUgYXQgZmlyc3QgcHJvamVjdGVkIHRpbWUgYW5kIHZhbHVlXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYE0gJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfSwkeyh2YWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBbdGltZSwgdmFsdWVdIG9mIGV2ZW50cykge1xuICAgICAgICAvLyBob3Jpem9udGFsIGxpbmUgdG8gY3VycmVudCB0aW1lXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYEggJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfWApXG4gICAgICAgIC8vIHZlcnRpY2FsIGxpbmUgdG8gbmV3IGxldmVsXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYFYgJHsodmFsdWUqc2NhbGUpLnRvRml4ZWQoMil9YCk7XG4gICAgfVxuICAgIC8vIGZpbGwgaW4gYXJlYSBiZXR3ZWVuIGxhc3Qgc25hcHNob3QgYW5kIHJpZ2h0IHNpZGUgKGFyZWEgYWZ0ZXIgXCJub3dcIiBjdXJzb3Igd2lsbCBiZSBjbGlwcGVkIGxhdGVyKVxuICAgIGlmIChldmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBbdGltZSwgdmFsdWVdID0gZXZlbnRzW2V2ZW50cy5sZW5ndGgtMV07XG4gICAgICAgIC8vIHZlcnRpY2FsIGxpbmUgdG8gcHJldmlvdXMgbGV2ZWxcbiAgICAgICAgLy8gaG9yaXpvbnRhbCBsaW5lIHRvIGZ1dHVyZSB0aW1lXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYFYgJHsodmFsdWUqc2NhbGUpLnRvRml4ZWQoMil9YCwgYEggJHtjb252ZXJ0VGltZSh0aW1lICsgNjAwMDAwKS50b0ZpeGVkKDMpfWApO1xuICAgICAgICBpZiAoc2hvdWxkQ2xvc2UpIHtcbiAgICAgICAgICAgIC8vIGZpbGwgYXJlYSB1bmRlciBhY3R1YWwgc2VjdXJpdHlcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYFYgJHsobWluVmFsdWUqc2NhbGUpLnRvRml4ZWQoMil9YCk7XG4gICAgICAgICAgICBjb25zdCBtaW5UaW1lID0gZXZlbnRzWzBdWzBdO1xuICAgICAgICAgICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKG1pblRpbWUpLnRvRml4ZWQoMyl9YCk7XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKCdaJyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHBhdGhEYXRhO1xufVxuXG5mdW5jdGlvbiBNb25leUxheWVyKHByb3BzOiBTZWN1cml0eUxheWVyUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIHJldHVybiA8ZyBpZD1cIm1vbmV5TGF5ZXJcIiAvPlxufVxuXG4vLyAtLS0tLSBwcmUtUmVhY3QgdmVyc2lvbiAtLS0tLVxuXG4vKipcbiAqIHJlbmRlckJhdGNoZXMgLSBjcmVhdGUgYW4gU1ZHIGVsZW1lbnQgd2l0aCBhIGdyYXBoIG9mIGpvYnNcbiAqIEBwYXJhbSB7U1ZHU1ZHRWxlbWVudH0gW2VsXSAtIFNWRyBlbGVtZW50IHRvIHJldXNlLiBXaWxsIGJlIGNyZWF0ZWQgaWYgaXQgZG9lcyBub3QgZXhpc3QgeWV0LlxuICogQHBhcmFtIHtKb2JbXVtdfSBiYXRjaGVzIC0gYXJyYXkgb2YgYXJyYXlzIG9mIGpvYnNcbiAqIEBwYXJhbSB7bnVtYmVyfSBbbm93XSAtIGN1cnJlbnQgdGltZSAob3B0aW9uYWwpXG4gKiBAcmV0dXJucyB7U1ZHU1ZHRWxlbWVudH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckJhdGNoZXMoZWw6IEhUTUxFbGVtZW50LCBiYXRjaGVzPVtdLCBzZXJ2ZXJTbmFwc2hvdHM9W10sIG5vdzogVGltZU1zKSB7XG4gICAgbm93IHx8PSBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXM7XG5cbiAgICAvLyBSZW5kZXIgdGhlIG1haW4gU1ZHIGVsZW1lbnQgaWYgbmVlZGVkXG4gICAgZWwgfHw9IHN2Z0VsKFxuICAgICAgICBcInN2Z1wiLFxuICAgICAgICB7XG4gICAgICAgICAgICB2ZXJzaW9uOiBcIjEuMVwiLCB3aWR0aDpXSURUSF9QSVhFTFMsIGhlaWdodDogSEVJR0hUX1BJWEVMUyxcbiAgICAgICAgICAgIC8vIFNldCB0aGUgdmlld0JveCBmb3IgMTAgc2Vjb25kcyBvZiBoaXN0b3J5LCA2IHNlY29uZHMgb2YgZnV0dXJlLlxuICAgICAgICAgICAgdmlld0JveDogYCR7Y29udmVydFNlY1RvUHgoLTEwKX0gMCAke1dJRFRIX1BJWEVMU30gJHtIRUlHSFRfUElYRUxTfWBcbiAgICAgICAgfSxcbiAgICAgICAgW1xuICAgICAgICAgICAgW1wiZGVmc1wiLCB7fSwgW1xuICAgICAgICAgICAgICAgIFtcImNsaXBQYXRoXCIsIHtpZDpgaGlkZS1mdXR1cmUtJHtpbml0VGltZX1gLCBjbGlwUGF0aFVuaXRzOiBcInVzZXJTcGFjZU9uVXNlXCJ9LCBbXG4gICAgICAgICAgICAgICAgICAgIFtcInJlY3RcIiwge2lkOlwiaGlkZS1mdXR1cmUtcmVjdFwiLCB4OmNvbnZlcnRUaW1lKG5vdy02MDAwMCksIHdpZHRoOmNvbnZlcnRUaW1lKDYwMDAwLDApLCB5OjAsIGhlaWdodDogNTB9XVxuICAgICAgICAgICAgICAgIF1dXG4gICAgICAgICAgICBdXSxcbiAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiYmFja2dyb3VuZFwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCBoZWlnaHQ6XCIxMDAlXCIsIGZpbGw6R1JBUEhfQ09MT1JTLnNhZmV9XSxcbiAgICAgICAgICAgIFtcImdcIiwge2lkOlwidGltZUNvb3JkaW5hdGVzXCJ9LCBbXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJzYWZldHlMYXllclwifV0sXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJqb2JMYXllclwifV0sXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJzZWNMYXllclwifV0sXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJtb25leUxheWVyXCJ9XVxuICAgICAgICAgICAgXV0sXG4gICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMVwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTJcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLTIqRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgW1wicmVjdFwiLCB7aWQ6XCJjdXJzb3JcIiwgeDowLCB3aWR0aDoxLCB5OjAsIGhlaWdodDogXCIxMDAlXCIsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgcmVuZGVyTGVnZW5kKClcbiAgICAgICAgXVxuICAgICk7XG5cbiAgICAvLyBVcGRhdGUgdGhlIHRpbWUgY29vcmRpbmF0ZXMgZXZlcnkgZnJhbWVcbiAgICBjb25zdCBkYXRhRWwgPSBlbC5nZXRFbGVtZW50QnlJZChcInRpbWVDb29yZGluYXRlc1wiKTtcbiAgICBkYXRhRWwuc2V0QXR0cmlidXRlKCd0cmFuc2Zvcm0nLFxuICAgICAgICBgc2NhbGUoJHtXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTfSAxKSB0cmFuc2xhdGUoJHtjb252ZXJ0VGltZShpbml0VGltZS1ub3csIDApfSAwKWBcbiAgICApO1xuICAgIGVsLmdldEVsZW1lbnRCeUlkKFwiaGlkZS1mdXR1cmUtcmVjdFwiKS5zZXRBdHRyaWJ1dGUoJ3gnLCBjb252ZXJ0VGltZShub3ctNjAwMDApKTtcbiAgICBcbiAgICAvLyBPbmx5IHVwZGF0ZSB0aGUgbWFpbiBkYXRhIGV2ZXJ5IDI1MCBtc1xuICAgIGNvbnN0IGxhc3RVcGRhdGUgPSBkYXRhRWwuZ2V0QXR0cmlidXRlKCdkYXRhLWxhc3QtdXBkYXRlJykgfHwgMDtcbiAgICBpZiAobm93IC0gbGFzdFVwZGF0ZSA8IDI1MCkge1xuICAgICAgICByZXR1cm4gZWw7XG4gICAgfVxuICAgIGRhdGFFbC5zZXRBdHRyaWJ1dGUoJ2RhdGEtbGFzdC11cGRhdGUnLCBub3cpO1xuXG4gICAgY29uc3QgZXZlbnRTbmFwc2hvdHMgPSBiYXRjaGVzLmZsYXQoKS5tYXAoKGpvYik9PihcbiAgICAgICAgW2pvYi5lbmRUaW1lLCBqb2IucmVzdWx0XVxuICAgICkpO1xuICAgIFxuICAgIC8vIFJlbmRlciBlYWNoIGpvYiBiYWNrZ3JvdW5kIGFuZCBmb3JlZ3JvdW5kXG4gICAgd2hpbGUoZGF0YUVsLmZpcnN0Q2hpbGQpIHtcbiAgICAgICAgZGF0YUVsLnJlbW92ZUNoaWxkKGRhdGFFbC5maXJzdENoaWxkKTtcbiAgICB9XG4gICAgZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlclNhZmV0eUxheWVyKGJhdGNoZXMsIG5vdykpO1xuICAgIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJKb2JMYXllcihiYXRjaGVzLCBub3cpKTtcbiAgICBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyU2VjdXJpdHlMYXllcihldmVudFNuYXBzaG90cywgc2VydmVyU25hcHNob3RzLCBub3cpKTtcbiAgICAvLyBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyTW9uZXlMYXllcihldmVudFNuYXBzaG90cywgc2VydmVyU25hcHNob3RzLCBub3cpKTtcbiAgICBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyUHJvZml0TGF5ZXIoYmF0Y2hlcywgbm93KSk7XG5cbiAgICByZXR1cm4gZWw7XG59XG5cblxuZnVuY3Rpb24gcmVuZGVyUHJvZml0UGF0aChiYXRjaGVzPVtdLCBub3csIHNjYWxlPTEpIHtcbiAgICAvLyB3b3VsZCBsaWtlIHRvIGdyYXBoIG1vbmV5IHBlciBzZWNvbmQgb3ZlciB0aW1lXG4gICAgLy8gY29uc3QgbW9uZXlUYWtlbiA9IFtdO1xuICAgIGNvbnN0IHRvdGFsTW9uZXlUYWtlbiA9IFtdO1xuICAgIGxldCBydW5uaW5nVG90YWwgPSAwO1xuICAgIGZvciAoY29uc3QgYmF0Y2ggb2YgYmF0Y2hlcykge1xuICAgICAgICBmb3IgKGNvbnN0IGpvYiBvZiBiYXRjaCkge1xuICAgICAgICAgICAgaWYgKGpvYi50YXNrID09ICdoYWNrJyAmJiBqb2IuZW5kVGltZUFjdHVhbCkge1xuICAgICAgICAgICAgICAgIC8vIG1vbmV5VGFrZW4ucHVzaChbam9iLmVuZFRpbWVBY3R1YWwsIGpvYi5yZXN1bHRBY3R1YWxdKTtcbiAgICAgICAgICAgICAgICBydW5uaW5nVG90YWwgKz0gam9iLnJlc3VsdEFjdHVhbDtcbiAgICAgICAgICAgICAgICB0b3RhbE1vbmV5VGFrZW4ucHVzaChbam9iLmVuZFRpbWVBY3R1YWwsIHJ1bm5pbmdUb3RhbF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoam9iLnRhc2sgPT0gJ2hhY2snICYmICFqb2IuY2FuY2VsbGVkKSB7XG4gICAgICAgICAgICAgICAgcnVubmluZ1RvdGFsICs9IGpvYi5jaGFuZ2UucGxheWVyTW9uZXk7XG4gICAgICAgICAgICAgICAgdG90YWxNb25leVRha2VuLnB1c2goW2pvYi5lbmRUaW1lLCBydW5uaW5nVG90YWxdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICB0b3RhbE1vbmV5VGFrZW4ucHVzaChbbm93ICsgMzAwMDAsIHJ1bm5pbmdUb3RhbF0pO1xuICAgIC8vIG1vbmV5IHRha2VuIGluIHRoZSBsYXN0IFggc2Vjb25kcyBjb3VsZCBiZSBjb3VudGVkIHdpdGggYSBzbGlkaW5nIHdpbmRvdy5cbiAgICAvLyBidXQgdGhlIHJlY29yZGVkIGV2ZW50cyBhcmUgbm90IGV2ZW5seSBzcGFjZWQuXG4gICAgY29uc3QgbW92aW5nQXZlcmFnZSA9IFtdO1xuICAgIGxldCBtYXhQcm9maXQgPSAwO1xuICAgIGxldCBqID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRvdGFsTW9uZXlUYWtlbi5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBbdGltZSwgbW9uZXldID0gdG90YWxNb25leVRha2VuW2ldO1xuICAgICAgICB3aGlsZSAodG90YWxNb25leVRha2VuW2pdWzBdIDw9IHRpbWUgLSAyMDAwKSB7XG4gICAgICAgICAgICBqKys7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcHJvZml0ID0gdG90YWxNb25leVRha2VuW2ldWzFdIC0gdG90YWxNb25leVRha2VuW2pdWzFdO1xuICAgICAgICBtb3ZpbmdBdmVyYWdlLnB1c2goW3RpbWUsIHByb2ZpdF0pO1xuICAgICAgICBtYXhQcm9maXQgPSBNYXRoLm1heChtYXhQcm9maXQsIHByb2ZpdCk7XG4gICAgfVxuICAgIGV2YWwoXCJ3aW5kb3dcIikucHJvZml0RGF0YSA9IFt0b3RhbE1vbmV5VGFrZW4sIHJ1bm5pbmdUb3RhbCwgbW92aW5nQXZlcmFnZV07XG4gICAgY29uc3QgcGF0aERhdGEgPSBbXCJNIDAsMFwiXTtcbiAgICBsZXQgcHJldlRpbWU7XG4gICAgbGV0IHByZXZQcm9maXQ7XG4gICAgZm9yIChjb25zdCBbdGltZSwgcHJvZml0XSBvZiBtb3ZpbmdBdmVyYWdlKSB7XG4gICAgICAgIC8vIHBhdGhEYXRhLnB1c2goYEwgJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfSwkeyhzY2FsZSAqIHByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9YCk7XG4gICAgICAgIGlmIChwcmV2UHJvZml0KSB7XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBDICR7Y29udmVydFRpbWUoKHByZXZUaW1lKjMgKyB0aW1lKS80KS50b0ZpeGVkKDMpfSwkeyhzY2FsZSAqIHByZXZQcm9maXQvbWF4UHJvZml0KS50b0ZpeGVkKDMpfSAke2NvbnZlcnRUaW1lKChwcmV2VGltZSArIDMqdGltZSkvNCkudG9GaXhlZCgzKX0sJHsoc2NhbGUgKiBwcm9maXQvbWF4UHJvZml0KS50b0ZpeGVkKDMpfSAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJvZml0L21heFByb2ZpdCkudG9GaXhlZCgzKX1gKVxuICAgICAgICB9XG4gICAgICAgIHByZXZUaW1lID0gdGltZTtcbiAgICAgICAgcHJldlByb2ZpdCA9IHByb2ZpdDtcbiAgICB9XG4gICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKG5vdys2MDAwMCkudG9GaXhlZCgzKX0gViAwIFpgKTtcbiAgICByZXR1cm4gc3ZnRWwoJ3BhdGgnLCB7XG4gICAgICAgIGQ6IHBhdGhEYXRhLmpvaW4oJyAnKSxcbiAgICAgICAgXCJ2ZWN0b3ItZWZmZWN0XCI6IFwibm9uLXNjYWxpbmctc3Ryb2tlXCJcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyUHJvZml0TGF5ZXIoYmF0Y2hlcz1bXSwgbm93KSB7XG4gICAgY29uc3QgcHJvZml0UGF0aCA9IHJlbmRlclByb2ZpdFBhdGgoYmF0Y2hlcywgbm93KTtcbiAgICBjb25zdCBvYnNlcnZlZFByb2ZpdCA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwib2JzZXJ2ZWRQcm9maXRcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMU30pYCxcbiAgICAgICAgICAgIGZpbGw6IFwiZGFya1wiK0dSQVBIX0NPTE9SUy5tb25leSxcbiAgICAgICAgICAgIFwiY2xpcC1wYXRoXCI6IGB1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWBcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgcHJvZml0UGF0aFxuICAgICAgICBdXG4gICAgKTtcbiAgICBjb25zdCBwcm9qZWN0ZWRQcm9maXQgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInByb2plY3RlZFByb2ZpdFwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTfSlgLFxuICAgICAgICAgICAgZmlsbDogXCJub25lXCIsXG4gICAgICAgICAgICBzdHJva2U6IEdSQVBIX0NPTE9SUy5tb25leSxcbiAgICAgICAgICAgIFwic3Ryb2tlLXdpZHRoXCI6IDIsXG4gICAgICAgICAgICBcInN0cm9rZS1saW5lam9pblwiOlwicm91bmRcIlxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBwcm9maXRQYXRoLmNsb25lTm9kZSgpXG4gICAgICAgIF1cbiAgICApO1xuICAgIGNvbnN0IHByb2ZpdExheWVyID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJwcm9maXRMYXllclwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMU30pYFxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBvYnNlcnZlZFByb2ZpdCxcbiAgICAgICAgICAgIHByb2plY3RlZFByb2ZpdFxuICAgICAgICBdXG4gICAgKTtcbiAgICByZXR1cm4gcHJvZml0TGF5ZXI7XG59XG5cbmZ1bmN0aW9uIHJlbmRlck1vbmV5TGF5ZXIoZXZlbnRTbmFwc2hvdHM9W10sIHNlcnZlclNuYXBzaG90cz1bXSwgbm93KSB7XG4gICAgY29uc3QgbW9uZXlMYXllciA9IHN2Z0VsKFwiZ1wiLCB7XG4gICAgICAgIGlkOiBcIm1vbmV5TGF5ZXJcIixcbiAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMU30pYFxuICAgIH0pO1xuXG4gICAgaWYgKHNlcnZlclNuYXBzaG90cy5sZW5ndGggPT0gMCkge1xuICAgICAgICByZXR1cm4gbW9uZXlMYXllcjtcbiAgICB9XG4gICAgbGV0IG1pbk1vbmV5ID0gMDtcbiAgICBsZXQgbWF4TW9uZXkgPSBzZXJ2ZXJTbmFwc2hvdHNbMF1bMV0ubW9uZXlNYXg7XG4gICAgY29uc3Qgc2NhbGUgPSAxL21heE1vbmV5O1xuICAgIG1heE1vbmV5ICo9IDEuMVxuXG4gICAgY29uc3Qgb2JzZXJ2ZWRMYXllciA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwib2JzZXJ2ZWRNb25leVwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heE1vbmV5IC0gbWluTW9uZXkpIC8gc2NhbGV9KWAsXG4gICAgICAgICAgICBmaWxsOiBcImRhcmtcIitHUkFQSF9DT0xPUlMubW9uZXksXG4gICAgICAgICAgICAvLyBcImZpbGwtb3BhY2l0eVwiOiAwLjUsXG4gICAgICAgICAgICBcImNsaXAtcGF0aFwiOiBgdXJsKCNoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfSlgXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIHJlbmRlck9ic2VydmVkUGF0aChcIm1vbmV5QXZhaWxhYmxlXCIsIHNlcnZlclNuYXBzaG90cywgbWluTW9uZXksIG5vdywgc2NhbGUpXG4gICAgICAgIF1cbiAgICApO1xuICAgIG1vbmV5TGF5ZXIuYXBwZW5kKG9ic2VydmVkTGF5ZXIpO1xuXG4gICAgY29uc3QgcHJvamVjdGVkTGF5ZXIgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInByb2plY3RlZE1vbmV5XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4TW9uZXkgLSBtaW5Nb25leSkgLyBzY2FsZX0pYCxcbiAgICAgICAgICAgIHN0cm9rZTogR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgZmlsbDogXCJub25lXCIsXG4gICAgICAgICAgICBcInN0cm9rZS13aWR0aFwiOiAyLFxuICAgICAgICAgICAgXCJzdHJva2UtbGluZWpvaW5cIjpcImJldmVsXCJcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgY29tcHV0ZVByb2plY3RlZFBhdGgoXCJtb25leUF2YWlsYWJsZVwiLCBldmVudFNuYXBzaG90cywgbm93LCBzY2FsZSlcbiAgICAgICAgXVxuICAgICk7XG4gICAgbW9uZXlMYXllci5hcHBlbmQocHJvamVjdGVkTGF5ZXIpO1xuXG4gICAgcmV0dXJuIG1vbmV5TGF5ZXI7XG59XG5cbiJdfQ==