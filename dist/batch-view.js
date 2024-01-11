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
        this.animate();
        this.readPort();
        // Object.assign(globalThis, {batchView: this});
    }
    componentWillUnmount() {
        this.setState({ running: false });
    }
    animate = () => {
        if (!this.state.running)
            return;
        this.setState({ now: performance.now() });
        requestAnimationFrame(this.animate);
    };
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
    render() {
        const displayJobs = [...this.jobs.values()];
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBNERFO0FBSUYsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLEtBQThCLENBQUM7QUFTeEQsSUFBSSxRQUFRLEdBQUcsV0FBVyxDQUFDLEdBQUcsRUFBWSxDQUFDO0FBQzNDOzs7O0dBSUc7QUFDSCxTQUFTLFdBQVcsQ0FBQyxDQUFTLEVBQUUsRUFBRSxHQUFDLFFBQVE7SUFDdkMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBZ0IsQ0FBQztBQUM1QyxDQUFDO0FBRUQsU0FBUyxjQUFjLENBQUMsQ0FBYztJQUNsQyxPQUFPLENBQUMsR0FBRyxZQUFZLEdBQUcsYUFBMkIsQ0FBQztBQUMxRCxDQUFDO0FBRUQsTUFBTSxZQUFZLEdBQUc7SUFDakIsTUFBTSxFQUFFLE1BQU07SUFDZCxNQUFNLEVBQUUsWUFBWTtJQUNwQixRQUFRLEVBQUUsUUFBUTtJQUNsQixXQUFXLEVBQUUsS0FBSztJQUNsQixRQUFRLEVBQUUsU0FBUztJQUNuQixNQUFNLEVBQUUsTUFBTTtJQUNkLFFBQVEsRUFBRSxNQUFNO0lBQ2hCLFVBQVUsRUFBRSxLQUFLO0lBQ2pCLE9BQU8sRUFBRSxNQUFNO0NBQ2xCLENBQUM7QUFFRixNQUFNLFlBQVksR0FBRyxHQUFpQixDQUFDO0FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEVBQWlCLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUcsR0FBYSxDQUFDO0FBQ3BDLE1BQU0sYUFBYSxHQUFHLEVBQVksQ0FBQztBQUNuQyxpR0FBaUc7QUFDakcsMEdBQTBHO0FBQzFHLDJFQUEyRTtBQUczRSxtQkFBbUI7QUFFbkIsTUFBTSxLQUFLLEdBQXFEO0lBQzVE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RTtRQUNELEVBQUUsRUFBRSxnQkFBZ0I7UUFDcEIsU0FBUyxFQUFFLGVBQWUsYUFBYSxhQUFhLENBQUMsYUFBYSxHQUFHLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxHQUFHLEtBQUssR0FBRztRQUNyRyxNQUFNLEVBQUUsWUFBWSxDQUFDLEtBQUs7UUFDMUIsSUFBSSxFQUFFLE1BQU07UUFDWixjQUFjLEVBQUUsQ0FBQztRQUNqQixpQkFBaUIsRUFBQyxPQUFPO0tBQzVCLEVBQUU7UUFDQyxvQkFBb0IsQ0FBQyxnQkFBZ0IsRUFBRSxjQUFjLEVBQUUsR0FBRyxFQUFFLEtBQUssQ0FBQztLQUNyRSxDQUNKLENBQUM7SUFDRixVQUFVLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO0lBRWxDLE9BQU8sVUFBVSxDQUFDO0FBQ3RCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuXG5Vc2FnZVxuLS0tLS1cblxuU3RhcnQgdGhlIGJhdGNoIHZpZXdlciBzY3JpcHQgZnJvbSB0aGUgY29tbWFuZCBsaW5lOlxuXG4gICAgcnVuIGJhdGNoLXZpZXcuanMgLS1wb3J0IDEwXG5cblRoZW4gc2VuZCBtZXNzYWdlcyB0byBpdCBmcm9tIG90aGVyIHNjcmlwdHMuXG5cbkV4YW1wbGU6IERpc3BsYXkgYWN0aW9uIHRpbWluZyAoaGFjayAvIGdyb3cgLyB3ZWFrZW4pXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ2hhY2snLFxuICAgICAgICBqb2JJRDogMSxcbiAgICAgICAgc3RhcnRUaW1lOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICAgICAgZHVyYXRpb246IG5zLmdldEhhY2tUaW1lKHRhcmdldCksXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBVcGRhdGUgYW4gYWN0aW9uIHRoYXQgaGFzIGFscmVhZHkgYmVlbiBkaXNwbGF5ZWRcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBqb2JJRDogMSxcbiAgICAgICAgc3RhcnRUaW1lQWN0dWFsOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICB9KSk7XG4gICAgYXdhaXQgbnMuaGFjayh0YXJnZXQpO1xuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBqb2JJRDogMSxcbiAgICAgICAgZW5kVGltZUFjdHVhbDogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBEaXNwbGF5IGEgYmxhbmsgcm93IGJldHdlZW4gYWN0aW9ucyAodG8gdmlzdWFsbHkgc2VwYXJhdGUgYmF0Y2hlcylcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnc3BhY2VyJyxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IERpc3BsYXkgb2JzZXJ2ZWQgc2VjdXJpdHkgLyBtb25leSBsZXZlbFxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdvYnNlcnZlZCcsXG4gICAgICAgIHRpbWU6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgICAgICBtaW5EaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJNaW5TZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIGhhY2tEaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJTZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIG1vbmV5TWF4OiBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpLFxuICAgICAgICBtb25leUF2YWlsYWJsZTogbnMuZ2V0U2VydmVyTW9uZXlBdmFpbGFibGUodGFyZ2V0KSxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IERpc3BsYXkgZXhwZWN0ZWQgc2VjdXJpdHkgLyBtb25leSBsZXZlbCAodmFyaWVzIGJ5IGFjdGlvbiB0eXBlIGFuZCB5b3VyIHN0cmF0ZWd5KVxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdleHBlY3RlZCcsXG4gICAgICAgIHRpbWU6IGpvYi5zdGFydFRpbWUgKyBqb2IuZHVyYXRpb24sXG4gICAgICAgIG1pbkRpZmZpY3VsdHk6IG5zLmdldFNlcnZlck1pblNlY3VyaXR5TGV2ZWwodGFyZ2V0KSxcbiAgICAgICAgaGFja0RpZmZpY3VsdHk6IG5zLmdldFNlcnZlclNlY3VyaXR5TGV2ZWwodGFyZ2V0KSArIG5zLmhhY2tBbmFseXplU2VjdXJpdHkoam9iLnRocmVhZHMpLFxuICAgICAgICBtb25leU1heDogbnMuZ2V0U2VydmVyTWF4TW9uZXkodGFyZ2V0KSxcbiAgICAgICAgbW9uZXlBdmFpbGFibGU6IE1hdGgubWF4KDAsIG5zLmdldFNlcnZlck1heE1vbmV5KHRhcmdldCkgLSBucy5oYWNrQW5hbHl6ZSh0YXJnZXQpICogam9iLnRocmVhZHMgKiBucy5oYWNrQW5hbHl6ZUNoYW5jZSh0YXJnZXQpKSxcbiAgICB9KSk7XG5cbiovXG5cbmltcG9ydCB0eXBlIHsgTlMsIE5ldHNjcmlwdFBvcnQsIFNlcnZlciB9IGZyb20gJ0Bucyc7XG5pbXBvcnQgdHlwZSBSZWFjdE5hbWVzcGFjZSBmcm9tICdyZWFjdC9pbmRleCc7XG5jb25zdCBSZWFjdCA9IGdsb2JhbFRoaXMuUmVhY3QgYXMgdHlwZW9mIFJlYWN0TmFtZXNwYWNlO1xuXG4vLyAtLS0tLSBjb25zdGFudHMgLS0tLS0gXG5cbnR5cGUgVGltZU1zID0gUmV0dXJuVHlwZTx0eXBlb2YgcGVyZm9ybWFuY2Uubm93PiAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcIm1pbGxpc2Vjb25kc1wiIH07XG50eXBlIFRpbWVTZWNvbmRzID0gbnVtYmVyICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwic2Vjb25kc1wiIH07XG50eXBlIFRpbWVQaXhlbHMgPSBudW1iZXIgJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJwaXhlbHNcIiB9O1xudHlwZSBQaXhlbHMgPSBudW1iZXIgJiB7IF9fdW5pdHM6IFwicGl4ZWxzXCIgfTtcblxubGV0IGluaXRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zO1xuLyoqXG4gKiBDb252ZXJ0IHRpbWVzdGFtcHMgdG8gc2Vjb25kcyBzaW5jZSB0aGUgZ3JhcGggd2FzIHN0YXJ0ZWQuXG4gKiBUbyByZW5kZXIgU1ZHcyB1c2luZyBuYXRpdmUgdGltZSB1bml0cywgdGhlIHZhbHVlcyBtdXN0IGJlIHZhbGlkIDMyLWJpdCBpbnRzLlxuICogU28gd2UgY29udmVydCB0byBhIHJlY2VudCBlcG9jaCBpbiBjYXNlIERhdGUubm93KCkgdmFsdWVzIGFyZSB1c2VkLlxuICovXG5mdW5jdGlvbiBjb252ZXJ0VGltZSh0OiBUaW1lTXMsIHQwPWluaXRUaW1lKTogVGltZVNlY29uZHMge1xuICAgIHJldHVybiAoKHQgLSB0MCkgLyAxMDAwKSBhcyBUaW1lU2Vjb25kcztcbn1cblxuZnVuY3Rpb24gY29udmVydFNlY1RvUHgodDogVGltZVNlY29uZHMpOiBUaW1lUGl4ZWxzIHtcbiAgICByZXR1cm4gdCAqIFdJRFRIX1BJWEVMUyAvIFdJRFRIX1NFQ09ORFMgYXMgVGltZVBpeGVscztcbn1cblxuY29uc3QgR1JBUEhfQ09MT1JTID0ge1xuICAgIFwiaGFja1wiOiBcImN5YW5cIixcbiAgICBcImdyb3dcIjogXCJsaWdodGdyZWVuXCIsXG4gICAgXCJ3ZWFrZW5cIjogXCJ5ZWxsb3dcIixcbiAgICBcImNhbmNlbGxlZFwiOiBcInJlZFwiLFxuICAgIFwiZGVzeW5jXCI6IFwibWFnZW50YVwiLFxuICAgIFwic2FmZVwiOiBcIiMxMTFcIixcbiAgICBcInVuc2FmZVwiOiBcIiMzMzNcIixcbiAgICBcInNlY3VyaXR5XCI6IFwicmVkXCIsXG4gICAgXCJtb25leVwiOiBcImJsdWVcIlxufTtcblxuY29uc3QgV0lEVEhfUElYRUxTID0gODAwIGFzIFRpbWVQaXhlbHM7XG5jb25zdCBXSURUSF9TRUNPTkRTID0gMTYgYXMgVGltZVNlY29uZHM7XG5jb25zdCBIRUlHSFRfUElYRUxTID0gNjAwIGFzIFBpeGVscztcbmNvbnN0IEZPT1RFUl9QSVhFTFMgPSA1MCBhcyBQaXhlbHM7XG4vLyBUT0RPOiB1c2UgYSBjb250ZXh0IGZvciB0aGVzZSBzY2FsZSBmYWN0b3JzLiBzdXBwb3J0IHNldHRpbmcgdGhlbSBieSBhcmdzIGFuZCBzY3JvbGwtZ2VzdHVyZXMuXG4vLyBjb25zdCBTY3JlZW5Db250ZXh0ID0gUmVhY3QuY3JlYXRlQ29udGV4dCh7V0lEVEhfUElYRUxTLCBXSURUSF9TRUNPTkRTLCBIRUlHSFRfUElYRUxTLCBGT09URVJfUElYRUxTfSk7XG4vLyBUT0RPOiByZXZpZXcgdXNlIG9mIDYwMDAwMCwgNjAwMDAsIGFuZCBXSURUSF9TRUNPTkRTIGFzIGNsaXBwaW5nIGxpbWl0cy5cblxuXG4vLyAtLS0tLSBtYWluIC0tLS0tXG5cbmNvbnN0IEZMQUdTOiBbc3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgc3RyaW5nW11dW10gPSBbXG4gICAgW1wiaGVscFwiLCBmYWxzZV0sXG4gICAgW1wicG9ydFwiLCAwXVxuXTtcblxuZXhwb3J0IGZ1bmN0aW9uIGF1dG9jb21wbGV0ZShkYXRhOiBhbnksIGFyZ3M6IHN0cmluZ1tdKSB7XG4gICAgZGF0YS5mbGFncyhGTEFHUyk7XG4gICAgcmV0dXJuIFtdO1xufVxuXG4vKiogQHBhcmFtIHtOU30gbnMgKiovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWFpbihuczogTlMpIHtcbiAgICBucy5kaXNhYmxlTG9nKCdzbGVlcCcpO1xuICAgIG5zLmNsZWFyTG9nKCk7XG4gICAgbnMudGFpbCgpO1xuICAgIG5zLnJlc2l6ZVRhaWwoODEwLCA2NDApO1xuXG4gICAgY29uc3QgZmxhZ3MgPSBucy5mbGFncyhGTEFHUyk7XG4gICAgaWYgKGZsYWdzLmhlbHApIHtcbiAgICAgICAgbnMudHByaW50KFtcbiAgICAgICAgICAgIGBVU0FHRWAsXG4gICAgICAgICAgICBgPiBydW4gJHtucy5nZXRTY3JpcHROYW1lKCl9IC0tcG9ydCAxMGAsXG4gICAgICAgICAgICAnICdcbiAgICAgICAgXS5qb2luKFwiXFxuXCIpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBvcnROdW0gPSBmbGFncy5wb3J0IGFzIG51bWJlciB8fCBucy5waWQ7XG4gICAgY29uc3QgcG9ydCA9IG5zLmdldFBvcnRIYW5kbGUocG9ydE51bSk7XG4gICAgLy8gcG9ydC5jbGVhcigpO1xuICAgIG5zLnByaW50KGBMaXN0ZW5pbmcgb24gUG9ydCAke3BvcnROdW19YCk7XG5cbiAgICBjb25zdCBiYXRjaFZpZXcgPSA8QmF0Y2hWaWV3IG5zPXtuc30gcG9ydE51bT17cG9ydE51bX0gLz47XG4gICAgbnMucHJpbnRSYXcoYmF0Y2hWaWV3KTtcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGF3YWl0IHBvcnQubmV4dFdyaXRlKCk7XG4gICAgfVxufVxuXG4vLyAtLS0tLSBCYXRjaFZpZXcgLS0tLS1cblxudHlwZSBKb2JJRCA9IG51bWJlciB8IHN0cmluZztcbmludGVyZmFjZSBBY3Rpb25NZXNzYWdlIHtcbiAgICB0eXBlOiBcImhhY2tcIiB8IFwiZ3Jvd1wiIHwgXCJ3ZWFrZW5cIjtcbiAgICBqb2JJRD86IEpvYklEO1xuICAgIGR1cmF0aW9uOiBUaW1lTXM7XG4gICAgc3RhcnRUaW1lOiBUaW1lTXM7XG4gICAgc3RhcnRUaW1lQWN0dWFsPzogVGltZU1zO1xuICAgIGVuZFRpbWU/OiBUaW1lTXM7XG4gICAgZW5kVGltZUFjdHVhbD86IFRpbWVNcztcbiAgICBjYW5jZWxsZWQ/OiBib29sZWFuO1xuICAgIHJlc3VsdD86IG51bWJlcjtcbn1cbmludGVyZmFjZSBTcGFjZXJNZXNzYWdlIHtcbiAgICB0eXBlOiBcInNwYWNlclwiXG59XG5pbnRlcmZhY2UgU2VydmVyTWVzc2FnZSB7XG4gICAgdHlwZTogXCJleHBlY3RlZFwiIHwgXCJvYnNlcnZlZFwiO1xuICAgIHRpbWU6IFRpbWVNcztcbiAgICBoYWNrRGlmZmljdWx0eTogbnVtYmVyO1xuICAgIG1pbkRpZmZpY3VsdHk6IG51bWJlcjtcbiAgICBtb25leUF2YWlsYWJsZTogbnVtYmVyO1xuICAgIG1vbmV5TWF4OiBudW1iZXI7XG59XG50eXBlIEV4cGVjdGVkU2VydmVyTWVzc2FnZSA9IFNlcnZlck1lc3NhZ2UgJiB7XG4gICAgdHlwZTogXCJleHBlY3RlZFwiXG59XG50eXBlIE9ic2VydmVkU2VydmVyTWVzc2FnZSA9IFNlcnZlck1lc3NhZ2UgJiB7XG4gICAgdHlwZTogXCJvYnNlcnZlZFwiXG59XG50eXBlIEJhdGNoVmlld01lc3NhZ2UgPSBBY3Rpb25NZXNzYWdlIHwgU3BhY2VyTWVzc2FnZSB8IEV4cGVjdGVkU2VydmVyTWVzc2FnZSB8IE9ic2VydmVkU2VydmVyTWVzc2FnZTtcblxuaW50ZXJmYWNlIEpvYiBleHRlbmRzIEFjdGlvbk1lc3NhZ2Uge1xuICAgIGpvYklEOiBKb2JJRDtcbiAgICByb3dJRDogbnVtYmVyO1xuICAgIGVuZFRpbWU6IFRpbWVNcztcbn1cblxuaW50ZXJmYWNlIEJhdGNoVmlld1Byb3BzIHtcbiAgICBuczogTlM7XG4gICAgcG9ydE51bTogbnVtYmVyO1xufVxuaW50ZXJmYWNlIEJhdGNoVmlld1N0YXRlIHtcbiAgICBydW5uaW5nOiBib29sZWFuO1xuICAgIG5vdzogVGltZU1zO1xufVxuZXhwb3J0IGNsYXNzIEJhdGNoVmlldyBleHRlbmRzIFJlYWN0LkNvbXBvbmVudDxCYXRjaFZpZXdQcm9wcywgQmF0Y2hWaWV3U3RhdGU+IHtcbiAgICBwb3J0OiBOZXRzY3JpcHRQb3J0O1xuICAgIGpvYnM6IE1hcDxKb2JJRCwgSm9iPjtcbiAgICBzZXF1ZW50aWFsUm93SUQ6IG51bWJlciA9IDA7XG4gICAgc2VxdWVudGlhbEpvYklEOiBudW1iZXIgPSAwO1xuICAgIGV4cGVjdGVkU2VydmVyczogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlW107XG4gICAgb2JzZXJ2ZWRTZXJ2ZXJzOiBPYnNlcnZlZFNlcnZlck1lc3NhZ2VbXTtcblxuICAgIGNvbnN0cnVjdG9yKHByb3BzOiBCYXRjaFZpZXdQcm9wcyl7XG4gICAgICAgIHN1cGVyKHByb3BzKTtcbiAgICAgICAgY29uc3QgeyBucywgcG9ydE51bSB9ID0gcHJvcHM7XG4gICAgICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICAgICAgICBydW5uaW5nOiB0cnVlLFxuICAgICAgICAgICAgbm93OiBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXNcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5wb3J0ID0gbnMuZ2V0UG9ydEhhbmRsZShwb3J0TnVtKTtcbiAgICAgICAgdGhpcy5qb2JzID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLmV4cGVjdGVkU2VydmVycyA9IFtdO1xuICAgICAgICB0aGlzLm9ic2VydmVkU2VydmVycyA9IFtdO1xuICAgIH1cblxuICAgIGNvbXBvbmVudERpZE1vdW50KCkge1xuICAgICAgICBjb25zdCB7IG5zIH0gPSB0aGlzLnByb3BzO1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiB0cnVlfSk7XG4gICAgICAgIG5zLmF0RXhpdCgoKT0+e1xuICAgICAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogZmFsc2V9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZSgpO1xuICAgICAgICB0aGlzLnJlYWRQb3J0KCk7XG4gICAgICAgIC8vIE9iamVjdC5hc3NpZ24oZ2xvYmFsVGhpcywge2JhdGNoVmlldzogdGhpc30pO1xuICAgIH1cblxuICAgIGNvbXBvbmVudFdpbGxVbm1vdW50KCkge1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiBmYWxzZX0pO1xuICAgIH1cblxuICAgIGFuaW1hdGUgPSAoKT0+e1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUucnVubmluZykgcmV0dXJuO1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtub3c6IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNc30pO1xuICAgICAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRlKTtcbiAgICB9XG5cbiAgICByZWFkUG9ydCA9ICgpPT57XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5ydW5uaW5nKSByZXR1cm47XG4gICAgICAgIHdoaWxlKCF0aGlzLnBvcnQuZW1wdHkoKSkge1xuICAgICAgICAgICAgY29uc3QgbXNnOiBCYXRjaFZpZXdNZXNzYWdlID0gSlNPTi5wYXJzZSh0aGlzLnBvcnQucmVhZCgpIGFzIHN0cmluZyk7XG4gICAgICAgICAgICB0aGlzLnJlY2VpdmVNZXNzYWdlKG1zZyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5wb3J0Lm5leHRXcml0ZSgpLnRoZW4odGhpcy5yZWFkUG9ydCk7XG4gICAgfVxuXG4gICAgcmVjZWl2ZU1lc3NhZ2UobXNnOiBCYXRjaFZpZXdNZXNzYWdlKSB7XG4gICAgICAgIGlmIChtc2cudHlwZSA9PSBcInNwYWNlclwiKSB7XG4gICAgICAgICAgICB0aGlzLnNlcXVlbnRpYWxSb3dJRCArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKG1zZy50eXBlID09IFwiZXhwZWN0ZWRcIikge1xuICAgICAgICAgICAgdGhpcy5leHBlY3RlZFNlcnZlcnMucHVzaChtc2cpO1xuICAgICAgICAgICAgLy8gVE9ETzogc29ydCBieSB0aW1lIGFuZCByZW1vdmUgdmVyeSBvbGQgaXRlbXNcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cudHlwZSA9PSBcIm9ic2VydmVkXCIpIHtcbiAgICAgICAgICAgIHRoaXMub2JzZXJ2ZWRTZXJ2ZXJzLnB1c2gobXNnKTtcbiAgICAgICAgICAgIC8vIFRPRE86IHNvcnQgYnkgdGltZSBhbmQgcmVtb3ZlIHZlcnkgb2xkIGl0ZW1zXG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAobXNnLmpvYklEICE9PSB1bmRlZmluZWQgfHwgbXNnLnR5cGUgPT0gJ2hhY2snIHx8IG1zZy50eXBlID09ICdncm93JyB8fCBtc2cudHlwZSA9PSAnd2Vha2VuJykge1xuICAgICAgICAgICAgdGhpcy5hZGRKb2IobXNnKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZEpvYihtc2c6IEFjdGlvbk1lc3NhZ2UpIHtcbiAgICAgICAgLy8gQXNzaWduIHNlcXVlbnRpYWwgSUQgaWYgbmVlZGVkXG4gICAgICAgIGxldCBqb2JJRCA9IG1zZy5qb2JJRDtcbiAgICAgICAgaWYgKGpvYklEID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHdoaWxlICh0aGlzLmpvYnMuaGFzKHRoaXMuc2VxdWVudGlhbEpvYklEKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuc2VxdWVudGlhbEpvYklEICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBqb2JJRCA9IHRoaXMuc2VxdWVudGlhbEpvYklEO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuam9icy5nZXQoam9iSUQpO1xuICAgICAgICBpZiAoam9iID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIC8vIENyZWF0ZSBuZXcgam9iIHJlY29yZCB3aXRoIHJlcXVpcmVkIGZpZWxkc1xuICAgICAgICAgICAgdGhpcy5qb2JzLnNldChqb2JJRCwge1xuICAgICAgICAgICAgICAgIGpvYklEOiBqb2JJRCxcbiAgICAgICAgICAgICAgICByb3dJRDogdGhpcy5zZXF1ZW50aWFsUm93SUQrKyxcbiAgICAgICAgICAgICAgICBlbmRUaW1lOiBtc2cuc3RhcnRUaW1lICsgbXNnLmR1cmF0aW9uIGFzIFRpbWVNcyxcbiAgICAgICAgICAgICAgICAuLi5tc2dcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gTWVyZ2UgdXBkYXRlcyBpbnRvIGV4aXN0aW5nIGpvYiByZWNvcmRcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oam9iLCBtc2cpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY2xlYW5Kb2JzKCk7XG4gICAgfVxuXG4gICAgY2xlYW5Kb2JzKCkge1xuICAgICAgICAvLyBGaWx0ZXIgb3V0IGpvYnMgd2l0aCBlbmR0aW1lIGluIHBhc3RcbiAgICAgICAgaWYgKHRoaXMuam9icy5zaXplID4gMjAwKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGpvYklEIG9mIHRoaXMuam9icy5rZXlzKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBqb2IgPSB0aGlzLmpvYnMuZ2V0KGpvYklEKSBhcyBKb2I7XG4gICAgICAgICAgICAgICAgaWYgKChqb2IuZW5kVGltZUFjdHVhbCA/PyBqb2IuZW5kVGltZSkgPCB0aGlzLnN0YXRlLm5vdy0oV0lEVEhfU0VDT05EUyoyKjEwMDApKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuam9icy5kZWxldGUoam9iSUQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJlbmRlcigpIHtcbiAgICAgICAgY29uc3QgZGlzcGxheUpvYnMgPSBbLi4udGhpcy5qb2JzLnZhbHVlcygpXVxuXG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8R3JhcGhGcmFtZSBub3c9e3RoaXMuc3RhdGUubm93fT5cbiAgICAgICAgICAgICAgICA8U2FmZXR5TGF5ZXIgZXhwZWN0ZWRTZXJ2ZXJzPXt0aGlzLmV4cGVjdGVkU2VydmVyc30gLz5cbiAgICAgICAgICAgICAgICA8Sm9iTGF5ZXIgam9icz17ZGlzcGxheUpvYnN9IC8+XG4gICAgICAgICAgICAgICAgPFNlY3VyaXR5TGF5ZXIgZXhwZWN0ZWRTZXJ2ZXJzPXt0aGlzLmV4cGVjdGVkU2VydmVyc30gb2JzZXJ2ZWRTZXJ2ZXJzPXt0aGlzLm9ic2VydmVkU2VydmVyc30gLz5cbiAgICAgICAgICAgICAgICA8TW9uZXlMYXllciBleHBlY3RlZFNlcnZlcnM9e3RoaXMuZXhwZWN0ZWRTZXJ2ZXJzfSBvYnNlcnZlZFNlcnZlcnM9e3RoaXMub2JzZXJ2ZWRTZXJ2ZXJzfSAvPlxuICAgICAgICAgICAgPC9HcmFwaEZyYW1lPlxuICAgICAgICApXG4gICAgfVxufVxuXG5mdW5jdGlvbiBHcmFwaEZyYW1lKHtub3csIGNoaWxkcmVufTp7bm93OlRpbWVNcywgY2hpbGRyZW46IFJlYWN0LlJlYWN0Tm9kZX0pOiBSZWFjdC5SZWFjdEVsZW1lbnQge1xuICAgIC8vIFRPRE86IGluaXRUaW1lIGlzIHVzZWQgYXMgdW5pcXVlIERPTSBJRCBhbmQgYXMgcmVuZGVyaW5nIG9yaWdpbiBidXQgaXQgaXMgcG9vcmx5IHN1aXRlZCBmb3IgYm90aFxuICAgIHJldHVybiAoXG4gICAgICAgIDxzdmcgdmVyc2lvbj1cIjEuMVwiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIlxuICAgICAgICAgICAgd2lkdGg9e1dJRFRIX1BJWEVMU31cbiAgICAgICAgICAgIGhlaWdodD17SEVJR0hUX1BJWEVMU30gXG4gICAgICAgICAgICAvLyBTZXQgdGhlIHZpZXdCb3ggZm9yIDEwIHNlY29uZHMgb2YgaGlzdG9yeSwgNiBzZWNvbmRzIG9mIGZ1dHVyZS5cbiAgICAgICAgICAgIHZpZXdCb3g9e2Ake2NvbnZlcnRTZWNUb1B4KC0xMCBhcyBUaW1lU2Vjb25kcyl9IDAgJHtXSURUSF9QSVhFTFN9ICR7SEVJR0hUX1BJWEVMU31gfVxuICAgICAgICA+XG4gICAgICAgICAgICA8ZGVmcz5cbiAgICAgICAgICAgICAgICA8Y2xpcFBhdGggaWQ9e2BoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfWB9IGNsaXBQYXRoVW5pdHM9XCJ1c2VyU3BhY2VPblVzZVwiPlxuICAgICAgICAgICAgICAgICAgICA8cmVjdCBpZD1cImhpZGUtZnV0dXJlLXJlY3RcIlxuICAgICAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUobm93LTYwMDAwIGFzIFRpbWVNcyl9IHdpZHRoPXtjb252ZXJ0VGltZSg2MDAwMCBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD17NTB9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9jbGlwUGF0aD5cbiAgICAgICAgICAgIDwvZGVmcz5cbiAgICAgICAgICAgIDxyZWN0IGlkPVwiYmFja2dyb3VuZFwiIHg9e2NvbnZlcnRTZWNUb1B4KC0xMCBhcyBUaW1lU2Vjb25kcyl9IHdpZHRoPVwiMTAwJVwiIGhlaWdodD1cIjEwMCVcIiBmaWxsPXtHUkFQSF9DT0xPUlMuc2FmZX0gLz5cbiAgICAgICAgICAgIDxnIGlkPVwidGltZUNvb3JkaW5hdGVzXCIgdHJhbnNmb3JtPXtgc2NhbGUoJHtXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTfSAxKSB0cmFuc2xhdGUoJHtjb252ZXJ0VGltZShpbml0VGltZS1ub3cgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9IDApYH0+XG4gICAgICAgICAgICAgICAge2NoaWxkcmVufVxuICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0xXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy1GT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTJcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLTIqRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgPHJlY3QgaWQ9XCJjdXJzb3JcIiB4PXswfSB3aWR0aD17MX0geT17MH0gaGVpZ2h0PVwiMTAwJVwiIGZpbGw9XCJ3aGl0ZVwiIC8+XG4gICAgICAgICAgICA8R3JhcGhMZWdlbmQgLz5cbiAgICAgICAgPC9zdmc+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gR3JhcGhMZWdlbmQoKTogUmVhY3QuUmVhY3RFbGVtZW50IHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cIkxlZ2VuZFwiIHRyYW5zZm9ybT1cInRyYW5zbGF0ZSgtNDkwLCAxMCksIHNjYWxlKC41LCAuNSlcIj5cbiAgICAgICAgICAgIDxyZWN0IHg9ezF9IHk9ezF9IHdpZHRoPXsyNzV9IGhlaWdodD17MzkyfSBmaWxsPVwiYmxhY2tcIiBzdHJva2U9XCIjOTc5Nzk3XCIgLz5cbiAgICAgICAgICAgIHtPYmplY3QuZW50cmllcyhHUkFQSF9DT0xPUlMpLm1hcCgoW2xhYmVsLCBjb2xvcl0sIGkpPT4oXG4gICAgICAgICAgICAgICAgPGcga2V5PXtsYWJlbH0gdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDIyLCAkezEzICsgNDEqaX0pYH0+XG4gICAgICAgICAgICAgICAgICAgIDxyZWN0IHg9ezB9IHk9ezB9IHdpZHRoPXsyMn0gaGVpZ2h0PXsyMn0gZmlsbD17Y29sb3J9IC8+XG4gICAgICAgICAgICAgICAgICAgIDx0ZXh0IGZvbnRGYW1pbHk9XCJDb3VyaWVyIE5ld1wiIGZvbnRTaXplPXszNn0gZmlsbD1cIiM4ODhcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDx0c3BhbiB4PXs0Mi41fSB5PXszMH0+e2xhYmVsLnN1YnN0cmluZygwLDEpLnRvVXBwZXJDYXNlKCkrbGFiZWwuc3Vic3RyaW5nKDEpfTwvdHNwYW4+XG4gICAgICAgICAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIFNhZmV0eUxheWVyKHtleHBlY3RlZFNlcnZlcnN9OiB7ZXhwZWN0ZWRTZXJ2ZXJzOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2VbXX0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGxldCBwcmV2U2VydmVyOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2UgfCB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJzYWZldHlMYXllclwiPlxuICAgICAgICAgICAge2V4cGVjdGVkU2VydmVycy5tYXAoKHNlcnZlciwgaSk9PntcbiAgICAgICAgICAgICAgICBsZXQgZWwgPSBudWxsO1xuICAgICAgICAgICAgICAgIC8vIHNoYWRlIHRoZSBiYWNrZ3JvdW5kIGJhc2VkIG9uIHNlY0xldmVsXG4gICAgICAgICAgICAgICAgaWYgKHByZXZTZXJ2ZXIgJiYgc2VydmVyLnRpbWUgPiBwcmV2U2VydmVyLnRpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgZWwgPSAoPHJlY3Qga2V5PXtpfVxuICAgICAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUocHJldlNlcnZlci50aW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHNlcnZlci50aW1lIC0gcHJldlNlcnZlci50aW1lLCAwKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD1cIjEwMCVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsbD17KHByZXZTZXJ2ZXIuaGFja0RpZmZpY3VsdHkgPiBwcmV2U2VydmVyLm1pbkRpZmZpY3VsdHkpID8gR1JBUEhfQ09MT1JTLnVuc2FmZSA6IEdSQVBIX0NPTE9SUy5zYWZlfVxuICAgICAgICAgICAgICAgICAgICAvPik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHByZXZTZXJ2ZXIgPSBzZXJ2ZXI7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGVsO1xuICAgICAgICAgICAgfSl9XG4gICAgICAgICAgICB7cHJldlNlcnZlciAmJiAoXG4gICAgICAgICAgICAgICAgPHJlY3Qga2V5PVwicmVtYWluZGVyXCJcbiAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUocHJldlNlcnZlci50aW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKDYwMDAwMCwgMCl9XG4gICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD1cIjEwMCVcIlxuICAgICAgICAgICAgICAgICAgICBmaWxsPXsocHJldlNlcnZlci5oYWNrRGlmZmljdWx0eSA+IHByZXZTZXJ2ZXIubWluRGlmZmljdWx0eSkgPyBHUkFQSF9DT0xPUlMudW5zYWZlIDogR1JBUEhfQ09MT1JTLnNhZmV9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBKb2JMYXllcih7am9ic306IHtqb2JzOiBKb2JbXX0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cImpvYkxheWVyXCI+XG4gICAgICAgICAgICB7am9icy5tYXAoKGpvYjogSm9iKT0+KDxKb2JCYXIgam9iPXtqb2J9IGtleT17am9iLmpvYklEfSAvPikpfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gSm9iQmFyKHtqb2J9OiB7am9iOiBKb2J9KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBjb25zdCB5ID0gKChqb2Iucm93SUQgKyAxKSAlICgoSEVJR0hUX1BJWEVMUyAtIEZPT1RFUl9QSVhFTFMqMikgLyA0KSkgKiA0O1xuICAgIGxldCBqb2JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lICYmIGpvYi5kdXJhdGlvbikge1xuICAgICAgICBqb2JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKGpvYi5zdGFydFRpbWUpfSB3aWR0aD17Y29udmVydFRpbWUoam9iLmR1cmF0aW9uLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezJ9XG4gICAgICAgICAgICBmaWxsPXtHUkFQSF9DT0xPUlNbam9iLmNhbmNlbGxlZCA/ICdjYW5jZWxsZWQnIDogam9iLnR5cGVdfVxuICAgICAgICAvPilcbiAgICB9O1xuICAgIGxldCBzdGFydEVycm9yQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLnN0YXJ0VGltZUFjdHVhbCkge1xuICAgICAgICBjb25zdCBbdDEsIHQyXSA9IFtqb2Iuc3RhcnRUaW1lLCBqb2Iuc3RhcnRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICBzdGFydEVycm9yQmFyID0gKDxyZWN0XG4gICAgICAgICAgICB4PXtjb252ZXJ0VGltZSh0MSl9IHdpZHRoPXtjb252ZXJ0VGltZSh0Mi10MSBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17MX1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SUy5kZXN5bmN9XG4gICAgICAgICAvPik7XG4gICAgfVxuICAgIGxldCBlbmRFcnJvckJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5lbmRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5lbmRUaW1lLCBqb2IuZW5kVGltZUFjdHVhbF0uc29ydCgoYSxiKT0+YS1iKTtcbiAgICAgICAgZW5kRXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgZmlsbD17R1JBUEhfQ09MT1JTLmRlc3luY31cbiAgICAgICAgIC8+KTtcbiAgICB9XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHt5fSlgfT5cbiAgICAgICAgICAgIHtqb2JCYXJ9XG4gICAgICAgICAgICB7c3RhcnRFcnJvckJhcn1cbiAgICAgICAgICAgIHtlbmRFcnJvckJhcn1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbnR5cGUgVGltZVZhbHVlID0gW1RpbWVNcywgbnVtYmVyXTtcbmludGVyZmFjZSBTZWN1cml0eUxheWVyUHJvcHMge1xuICAgIGV4cGVjdGVkU2VydmVyczogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlW107XG4gICAgb2JzZXJ2ZWRTZXJ2ZXJzOiBPYnNlcnZlZFNlcnZlck1lc3NhZ2VbXVxufVxuZnVuY3Rpb24gU2VjdXJpdHlMYXllcih7ZXhwZWN0ZWRTZXJ2ZXJzLCBvYnNlcnZlZFNlcnZlcnN9OlNlY3VyaXR5TGF5ZXJQcm9wcyk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgZXhwZWN0ZWRTZXJ2ZXJzID8/PSBbXTtcbiAgICBvYnNlcnZlZFNlcnZlcnMgPz89IFtdO1xuICAgIGxldCBtaW5TZWMgPSAwO1xuICAgIGxldCBtYXhTZWMgPSAxO1xuICAgIGZvciAoY29uc3Qgc25hcHNob3RzIG9mIFtleHBlY3RlZFNlcnZlcnMsIG9ic2VydmVkU2VydmVyc10pIHtcbiAgICAgICAgZm9yIChjb25zdCBzZXJ2ZXIgb2Ygc25hcHNob3RzKSB7XG4gICAgICAgICAgICBtaW5TZWMgPSBNYXRoLm1pbihtaW5TZWMsIHNlcnZlci5oYWNrRGlmZmljdWx0eSk7XG4gICAgICAgICAgICBtYXhTZWMgPSBNYXRoLm1heChtYXhTZWMsIHNlcnZlci5oYWNrRGlmZmljdWx0eSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBvYnNlcnZlZEV2ZW50cyA9IG9ic2VydmVkU2VydmVycy5tYXAoKHNlcnZlcik9PltzZXJ2ZXIudGltZSwgc2VydmVyLmhhY2tEaWZmaWN1bHR5XSkgYXMgVGltZVZhbHVlW107XG4gICAgY29uc3Qgc2hvdWxkQ2xvc2VQYXRoID0gdHJ1ZTtcbiAgICBjb25zdCBvYnNlcnZlZFBhdGggPSBjb21wdXRlUGF0aERhdGEob2JzZXJ2ZWRFdmVudHMsIG1pblNlYywgc2hvdWxkQ2xvc2VQYXRoKTtcbiAgICBjb25zdCBvYnNlcnZlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cIm9ic2VydmVkU2VjXCJcbiAgICAgICAgICAgIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhTZWMgLSBtaW5TZWMpfSlgfVxuICAgICAgICAgICAgZmlsbD17XCJkYXJrXCIrR1JBUEhfQ09MT1JTLnNlY3VyaXR5fVxuICAgICAgICAgICAgLy8gZmlsbE9wYWNpdHk6IDAuNSxcbiAgICAgICAgICAgIGNsaXBQYXRoPXtgdXJsKCNoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfSlgfVxuICAgICAgICA+XG4gICAgICAgICAgICA8cGF0aCBkPXtvYnNlcnZlZFBhdGguam9pbihcIiBcIil9IC8+XG4gICAgICAgIDwvZz5cbiAgICApO1xuXG4gICAgY29uc3QgZXhwZWN0ZWRFdmVudHMgPSBleHBlY3RlZFNlcnZlcnMubWFwKChzZXJ2ZXIpPT5bc2VydmVyLnRpbWUsIHNlcnZlci5oYWNrRGlmZmljdWx0eV0pIGFzIFRpbWVWYWx1ZVtdO1xuICAgIGNvbnN0IHByZWRpY3RlZFBhdGggPSBjb21wdXRlUGF0aERhdGEoZXhwZWN0ZWRFdmVudHMpO1xuICAgIGNvbnN0IHByZWRpY3RlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cInByZWRpY3RlZFNlY1wiXG4gICAgICAgICAgICB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4U2VjIC0gbWluU2VjKX0pYH1cbiAgICAgICAgICAgIHN0cm9rZT17R1JBUEhfQ09MT1JTLnNlY3VyaXR5fVxuICAgICAgICAgICAgZmlsbD1cIm5vbmVcIlxuICAgICAgICAgICAgc3Ryb2tlV2lkdGg9ezJ9XG4gICAgICAgICAgICBzdHJva2VMaW5lam9pbj1cImJldmVsXCJcbiAgICAgICAgPlxuICAgICAgICAgICAgPHBhdGggZD17cHJlZGljdGVkUGF0aC5qb2luKFwiIFwiKX0gdmVjdG9yRWZmZWN0PVwibm9uLXNjYWxpbmctc3Ryb2tlXCIgLz5cbiAgICAgICAgPC9nPlxuICAgICk7XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cInNlY0xheWVyXCIgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtIRUlHSFRfUElYRUxTIC0gMipGT09URVJfUElYRUxTfSlgfT5cbiAgICAgICAgICAgIHtvYnNlcnZlZExheWVyfVxuICAgICAgICAgICAge3ByZWRpY3RlZExheWVyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gY29tcHV0ZVBhdGhEYXRhKGV2ZW50czogVGltZVZhbHVlW10sIG1pblZhbHVlPTAsIHNob3VsZENsb3NlPWZhbHNlLCBzY2FsZT0xKSB7XG4gICAgY29uc3QgcGF0aERhdGEgPSBbXTtcbiAgICBpZiAoZXZlbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgW3RpbWUsIHZhbHVlXSA9IGV2ZW50c1swXTtcbiAgICAgICAgLy8gc3RhcnQgbGluZSBhdCBmaXJzdCBwcm9qZWN0ZWQgdGltZSBhbmQgdmFsdWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgTSAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IFt0aW1lLCB2YWx1ZV0gb2YgZXZlbnRzKSB7XG4gICAgICAgIC8vIGhvcml6b250YWwgbGluZSB0byBjdXJyZW50IHRpbWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9YClcbiAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBuZXcgbGV2ZWxcbiAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyh2YWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICB9XG4gICAgLy8gZmlsbCBpbiBhcmVhIGJldHdlZW4gbGFzdCBzbmFwc2hvdCBhbmQgcmlnaHQgc2lkZSAoYXJlYSBhZnRlciBcIm5vd1wiIGN1cnNvciB3aWxsIGJlIGNsaXBwZWQgbGF0ZXIpXG4gICAgaWYgKGV2ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IFt0aW1lLCB2YWx1ZV0gPSBldmVudHNbZXZlbnRzLmxlbmd0aC0xXTtcbiAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBwcmV2aW91cyBsZXZlbFxuICAgICAgICAvLyBob3Jpem9udGFsIGxpbmUgdG8gZnV0dXJlIHRpbWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyh2YWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gLCBgSCAke2NvbnZlcnRUaW1lKHRpbWUgKyA2MDAwMDApLnRvRml4ZWQoMyl9YCk7XG4gICAgICAgIGlmIChzaG91bGRDbG9zZSkge1xuICAgICAgICAgICAgLy8gZmlsbCBhcmVhIHVuZGVyIGFjdHVhbCBzZWN1cml0eVxuICAgICAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyhtaW5WYWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICAgICAgICAgIGNvbnN0IG1pblRpbWUgPSBldmVudHNbMF1bMF07XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBIICR7Y29udmVydFRpbWUobWluVGltZSkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goJ1onKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcGF0aERhdGE7XG59XG5cbmZ1bmN0aW9uIE1vbmV5TGF5ZXIocHJvcHM6IFNlY3VyaXR5TGF5ZXJQcm9wcyk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgcmV0dXJuIDxnIGlkPVwibW9uZXlMYXllclwiIC8+XG59XG5cbi8vIC0tLS0tIHByZS1SZWFjdCB2ZXJzaW9uIC0tLS0tXG5cbi8qKlxuICogcmVuZGVyQmF0Y2hlcyAtIGNyZWF0ZSBhbiBTVkcgZWxlbWVudCB3aXRoIGEgZ3JhcGggb2Ygam9ic1xuICogQHBhcmFtIHtTVkdTVkdFbGVtZW50fSBbZWxdIC0gU1ZHIGVsZW1lbnQgdG8gcmV1c2UuIFdpbGwgYmUgY3JlYXRlZCBpZiBpdCBkb2VzIG5vdCBleGlzdCB5ZXQuXG4gKiBAcGFyYW0ge0pvYltdW119IGJhdGNoZXMgLSBhcnJheSBvZiBhcnJheXMgb2Ygam9ic1xuICogQHBhcmFtIHtudW1iZXJ9IFtub3ddIC0gY3VycmVudCB0aW1lIChvcHRpb25hbClcbiAqIEByZXR1cm5zIHtTVkdTVkdFbGVtZW50fVxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQmF0Y2hlcyhlbDogSFRNTEVsZW1lbnQsIGJhdGNoZXM9W10sIHNlcnZlclNuYXBzaG90cz1bXSwgbm93OiBUaW1lTXMpIHtcbiAgICBub3cgfHw9IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNcztcblxuICAgIC8vIFJlbmRlciB0aGUgbWFpbiBTVkcgZWxlbWVudCBpZiBuZWVkZWRcbiAgICBlbCB8fD0gc3ZnRWwoXG4gICAgICAgIFwic3ZnXCIsXG4gICAgICAgIHtcbiAgICAgICAgICAgIHZlcnNpb246IFwiMS4xXCIsIHdpZHRoOldJRFRIX1BJWEVMUywgaGVpZ2h0OiBIRUlHSFRfUElYRUxTLFxuICAgICAgICAgICAgLy8gU2V0IHRoZSB2aWV3Qm94IGZvciAxMCBzZWNvbmRzIG9mIGhpc3RvcnksIDYgc2Vjb25kcyBvZiBmdXR1cmUuXG4gICAgICAgICAgICB2aWV3Qm94OiBgJHtjb252ZXJ0U2VjVG9QeCgtMTApfSAwICR7V0lEVEhfUElYRUxTfSAke0hFSUdIVF9QSVhFTFN9YFxuICAgICAgICB9LFxuICAgICAgICBbXG4gICAgICAgICAgICBbXCJkZWZzXCIsIHt9LCBbXG4gICAgICAgICAgICAgICAgW1wiY2xpcFBhdGhcIiwge2lkOmBoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfWAsIGNsaXBQYXRoVW5pdHM6IFwidXNlclNwYWNlT25Vc2VcIn0sIFtcbiAgICAgICAgICAgICAgICAgICAgW1wicmVjdFwiLCB7aWQ6XCJoaWRlLWZ1dHVyZS1yZWN0XCIsIHg6Y29udmVydFRpbWUobm93LTYwMDAwKSwgd2lkdGg6Y29udmVydFRpbWUoNjAwMDAsMCksIHk6MCwgaGVpZ2h0OiA1MH1dXG4gICAgICAgICAgICAgICAgXV1cbiAgICAgICAgICAgIF1dLFxuICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJiYWNrZ3JvdW5kXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIGhlaWdodDpcIjEwMCVcIiwgZmlsbDpHUkFQSF9DT0xPUlMuc2FmZX1dLFxuICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJ0aW1lQ29vcmRpbmF0ZXNcIn0sIFtcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcInNhZmV0eUxheWVyXCJ9XSxcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcImpvYkxheWVyXCJ9XSxcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcInNlY0xheWVyXCJ9XSxcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcIm1vbmV5TGF5ZXJcIn1dXG4gICAgICAgICAgICBdXSxcbiAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0xXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy1GT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMlwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtMipGT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICBbXCJyZWN0XCIsIHtpZDpcImN1cnNvclwiLCB4OjAsIHdpZHRoOjEsIHk6MCwgaGVpZ2h0OiBcIjEwMCVcIiwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICByZW5kZXJMZWdlbmQoKVxuICAgICAgICBdXG4gICAgKTtcblxuICAgIC8vIFVwZGF0ZSB0aGUgdGltZSBjb29yZGluYXRlcyBldmVyeSBmcmFtZVxuICAgIGNvbnN0IGRhdGFFbCA9IGVsLmdldEVsZW1lbnRCeUlkKFwidGltZUNvb3JkaW5hdGVzXCIpO1xuICAgIGRhdGFFbC5zZXRBdHRyaWJ1dGUoJ3RyYW5zZm9ybScsXG4gICAgICAgIGBzY2FsZSgke1dJRFRIX1BJWEVMUyAvIFdJRFRIX1NFQ09ORFN9IDEpIHRyYW5zbGF0ZSgke2NvbnZlcnRUaW1lKGluaXRUaW1lLW5vdywgMCl9IDApYFxuICAgICk7XG4gICAgZWwuZ2V0RWxlbWVudEJ5SWQoXCJoaWRlLWZ1dHVyZS1yZWN0XCIpLnNldEF0dHJpYnV0ZSgneCcsIGNvbnZlcnRUaW1lKG5vdy02MDAwMCkpO1xuICAgIFxuICAgIC8vIE9ubHkgdXBkYXRlIHRoZSBtYWluIGRhdGEgZXZlcnkgMjUwIG1zXG4gICAgY29uc3QgbGFzdFVwZGF0ZSA9IGRhdGFFbC5nZXRBdHRyaWJ1dGUoJ2RhdGEtbGFzdC11cGRhdGUnKSB8fCAwO1xuICAgIGlmIChub3cgLSBsYXN0VXBkYXRlIDwgMjUwKSB7XG4gICAgICAgIHJldHVybiBlbDtcbiAgICB9XG4gICAgZGF0YUVsLnNldEF0dHJpYnV0ZSgnZGF0YS1sYXN0LXVwZGF0ZScsIG5vdyk7XG5cbiAgICBjb25zdCBldmVudFNuYXBzaG90cyA9IGJhdGNoZXMuZmxhdCgpLm1hcCgoam9iKT0+KFxuICAgICAgICBbam9iLmVuZFRpbWUsIGpvYi5yZXN1bHRdXG4gICAgKSk7XG4gICAgXG4gICAgLy8gUmVuZGVyIGVhY2ggam9iIGJhY2tncm91bmQgYW5kIGZvcmVncm91bmRcbiAgICB3aGlsZShkYXRhRWwuZmlyc3RDaGlsZCkge1xuICAgICAgICBkYXRhRWwucmVtb3ZlQ2hpbGQoZGF0YUVsLmZpcnN0Q2hpbGQpO1xuICAgIH1cbiAgICBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyU2FmZXR5TGF5ZXIoYmF0Y2hlcywgbm93KSk7XG4gICAgZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlckpvYkxheWVyKGJhdGNoZXMsIG5vdykpO1xuICAgIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJTZWN1cml0eUxheWVyKGV2ZW50U25hcHNob3RzLCBzZXJ2ZXJTbmFwc2hvdHMsIG5vdykpO1xuICAgIC8vIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJNb25leUxheWVyKGV2ZW50U25hcHNob3RzLCBzZXJ2ZXJTbmFwc2hvdHMsIG5vdykpO1xuICAgIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJQcm9maXRMYXllcihiYXRjaGVzLCBub3cpKTtcblxuICAgIHJldHVybiBlbDtcbn1cblxuXG5mdW5jdGlvbiByZW5kZXJQcm9maXRQYXRoKGJhdGNoZXM9W10sIG5vdywgc2NhbGU9MSkge1xuICAgIC8vIHdvdWxkIGxpa2UgdG8gZ3JhcGggbW9uZXkgcGVyIHNlY29uZCBvdmVyIHRpbWVcbiAgICAvLyBjb25zdCBtb25leVRha2VuID0gW107XG4gICAgY29uc3QgdG90YWxNb25leVRha2VuID0gW107XG4gICAgbGV0IHJ1bm5pbmdUb3RhbCA9IDA7XG4gICAgZm9yIChjb25zdCBiYXRjaCBvZiBiYXRjaGVzKSB7XG4gICAgICAgIGZvciAoY29uc3Qgam9iIG9mIGJhdGNoKSB7XG4gICAgICAgICAgICBpZiAoam9iLnRhc2sgPT0gJ2hhY2snICYmIGpvYi5lbmRUaW1lQWN0dWFsKSB7XG4gICAgICAgICAgICAgICAgLy8gbW9uZXlUYWtlbi5wdXNoKFtqb2IuZW5kVGltZUFjdHVhbCwgam9iLnJlc3VsdEFjdHVhbF0pO1xuICAgICAgICAgICAgICAgIHJ1bm5pbmdUb3RhbCArPSBqb2IucmVzdWx0QWN0dWFsO1xuICAgICAgICAgICAgICAgIHRvdGFsTW9uZXlUYWtlbi5wdXNoKFtqb2IuZW5kVGltZUFjdHVhbCwgcnVubmluZ1RvdGFsXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChqb2IudGFzayA9PSAnaGFjaycgJiYgIWpvYi5jYW5jZWxsZWQpIHtcbiAgICAgICAgICAgICAgICBydW5uaW5nVG90YWwgKz0gam9iLmNoYW5nZS5wbGF5ZXJNb25leTtcbiAgICAgICAgICAgICAgICB0b3RhbE1vbmV5VGFrZW4ucHVzaChbam9iLmVuZFRpbWUsIHJ1bm5pbmdUb3RhbF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHRvdGFsTW9uZXlUYWtlbi5wdXNoKFtub3cgKyAzMDAwMCwgcnVubmluZ1RvdGFsXSk7XG4gICAgLy8gbW9uZXkgdGFrZW4gaW4gdGhlIGxhc3QgWCBzZWNvbmRzIGNvdWxkIGJlIGNvdW50ZWQgd2l0aCBhIHNsaWRpbmcgd2luZG93LlxuICAgIC8vIGJ1dCB0aGUgcmVjb3JkZWQgZXZlbnRzIGFyZSBub3QgZXZlbmx5IHNwYWNlZC5cbiAgICBjb25zdCBtb3ZpbmdBdmVyYWdlID0gW107XG4gICAgbGV0IG1heFByb2ZpdCA9IDA7XG4gICAgbGV0IGogPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdG90YWxNb25leVRha2VuLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IFt0aW1lLCBtb25leV0gPSB0b3RhbE1vbmV5VGFrZW5baV07XG4gICAgICAgIHdoaWxlICh0b3RhbE1vbmV5VGFrZW5bal1bMF0gPD0gdGltZSAtIDIwMDApIHtcbiAgICAgICAgICAgIGorKztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwcm9maXQgPSB0b3RhbE1vbmV5VGFrZW5baV1bMV0gLSB0b3RhbE1vbmV5VGFrZW5bal1bMV07XG4gICAgICAgIG1vdmluZ0F2ZXJhZ2UucHVzaChbdGltZSwgcHJvZml0XSk7XG4gICAgICAgIG1heFByb2ZpdCA9IE1hdGgubWF4KG1heFByb2ZpdCwgcHJvZml0KTtcbiAgICB9XG4gICAgZXZhbChcIndpbmRvd1wiKS5wcm9maXREYXRhID0gW3RvdGFsTW9uZXlUYWtlbiwgcnVubmluZ1RvdGFsLCBtb3ZpbmdBdmVyYWdlXTtcbiAgICBjb25zdCBwYXRoRGF0YSA9IFtcIk0gMCwwXCJdO1xuICAgIGxldCBwcmV2VGltZTtcbiAgICBsZXQgcHJldlByb2ZpdDtcbiAgICBmb3IgKGNvbnN0IFt0aW1lLCBwcm9maXRdIG9mIG1vdmluZ0F2ZXJhZ2UpIHtcbiAgICAgICAgLy8gcGF0aERhdGEucHVzaChgTCAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJvZml0L21heFByb2ZpdCkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgaWYgKHByZXZQcm9maXQpIHtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYEMgJHtjb252ZXJ0VGltZSgocHJldlRpbWUqMyArIHRpbWUpLzQpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJldlByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9ICR7Y29udmVydFRpbWUoKHByZXZUaW1lICsgMyp0aW1lKS80KS50b0ZpeGVkKDMpfSwkeyhzY2FsZSAqIHByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9ICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX0sJHsoc2NhbGUgKiBwcm9maXQvbWF4UHJvZml0KS50b0ZpeGVkKDMpfWApXG4gICAgICAgIH1cbiAgICAgICAgcHJldlRpbWUgPSB0aW1lO1xuICAgICAgICBwcmV2UHJvZml0ID0gcHJvZml0O1xuICAgIH1cbiAgICBwYXRoRGF0YS5wdXNoKGBIICR7Y29udmVydFRpbWUobm93KzYwMDAwKS50b0ZpeGVkKDMpfSBWIDAgWmApO1xuICAgIHJldHVybiBzdmdFbCgncGF0aCcsIHtcbiAgICAgICAgZDogcGF0aERhdGEuam9pbignICcpLFxuICAgICAgICBcInZlY3Rvci1lZmZlY3RcIjogXCJub24tc2NhbGluZy1zdHJva2VcIlxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJQcm9maXRMYXllcihiYXRjaGVzPVtdLCBub3cpIHtcbiAgICBjb25zdCBwcm9maXRQYXRoID0gcmVuZGVyUHJvZml0UGF0aChiYXRjaGVzLCBub3cpO1xuICAgIGNvbnN0IG9ic2VydmVkUHJvZml0ID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJvYnNlcnZlZFByb2ZpdFwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTfSlgLFxuICAgICAgICAgICAgZmlsbDogXCJkYXJrXCIrR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgXCJjbGlwLXBhdGhcIjogYHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYFxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBwcm9maXRQYXRoXG4gICAgICAgIF1cbiAgICApO1xuICAgIGNvbnN0IHByb2plY3RlZFByb2ZpdCA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwicHJvamVjdGVkUHJvZml0XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFN9KWAsXG4gICAgICAgICAgICBmaWxsOiBcIm5vbmVcIixcbiAgICAgICAgICAgIHN0cm9rZTogR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgXCJzdHJva2Utd2lkdGhcIjogMixcbiAgICAgICAgICAgIFwic3Ryb2tlLWxpbmVqb2luXCI6XCJyb3VuZFwiXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIHByb2ZpdFBhdGguY2xvbmVOb2RlKClcbiAgICAgICAgXVxuICAgICk7XG4gICAgY29uc3QgcHJvZml0TGF5ZXIgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInByb2ZpdExheWVyXCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTfSlgXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIG9ic2VydmVkUHJvZml0LFxuICAgICAgICAgICAgcHJvamVjdGVkUHJvZml0XG4gICAgICAgIF1cbiAgICApO1xuICAgIHJldHVybiBwcm9maXRMYXllcjtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTW9uZXlMYXllcihldmVudFNuYXBzaG90cz1bXSwgc2VydmVyU25hcHNob3RzPVtdLCBub3cpIHtcbiAgICBjb25zdCBtb25leUxheWVyID0gc3ZnRWwoXCJnXCIsIHtcbiAgICAgICAgaWQ6IFwibW9uZXlMYXllclwiLFxuICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTfSlgXG4gICAgfSk7XG5cbiAgICBpZiAoc2VydmVyU25hcHNob3RzLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgIHJldHVybiBtb25leUxheWVyO1xuICAgIH1cbiAgICBsZXQgbWluTW9uZXkgPSAwO1xuICAgIGxldCBtYXhNb25leSA9IHNlcnZlclNuYXBzaG90c1swXVsxXS5tb25leU1heDtcbiAgICBjb25zdCBzY2FsZSA9IDEvbWF4TW9uZXk7XG4gICAgbWF4TW9uZXkgKj0gMS4xXG5cbiAgICBjb25zdCBvYnNlcnZlZExheWVyID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJvYnNlcnZlZE1vbmV5XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4TW9uZXkgLSBtaW5Nb25leSkgLyBzY2FsZX0pYCxcbiAgICAgICAgICAgIGZpbGw6IFwiZGFya1wiK0dSQVBIX0NPTE9SUy5tb25leSxcbiAgICAgICAgICAgIC8vIFwiZmlsbC1vcGFjaXR5XCI6IDAuNSxcbiAgICAgICAgICAgIFwiY2xpcC1wYXRoXCI6IGB1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWBcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgcmVuZGVyT2JzZXJ2ZWRQYXRoKFwibW9uZXlBdmFpbGFibGVcIiwgc2VydmVyU25hcHNob3RzLCBtaW5Nb25leSwgbm93LCBzY2FsZSlcbiAgICAgICAgXVxuICAgICk7XG4gICAgbW9uZXlMYXllci5hcHBlbmQob2JzZXJ2ZWRMYXllcik7XG5cbiAgICBjb25zdCBwcm9qZWN0ZWRMYXllciA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwicHJvamVjdGVkTW9uZXlcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhNb25leSAtIG1pbk1vbmV5KSAvIHNjYWxlfSlgLFxuICAgICAgICAgICAgc3Ryb2tlOiBHUkFQSF9DT0xPUlMubW9uZXksXG4gICAgICAgICAgICBmaWxsOiBcIm5vbmVcIixcbiAgICAgICAgICAgIFwic3Ryb2tlLXdpZHRoXCI6IDIsXG4gICAgICAgICAgICBcInN0cm9rZS1saW5lam9pblwiOlwiYmV2ZWxcIlxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBjb21wdXRlUHJvamVjdGVkUGF0aChcIm1vbmV5QXZhaWxhYmxlXCIsIGV2ZW50U25hcHNob3RzLCBub3csIHNjYWxlKVxuICAgICAgICBdXG4gICAgKTtcbiAgICBtb25leUxheWVyLmFwcGVuZChwcm9qZWN0ZWRMYXllcik7XG5cbiAgICByZXR1cm4gbW9uZXlMYXllcjtcbn1cblxuIl19