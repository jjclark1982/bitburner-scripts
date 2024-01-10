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
    nRows;
    constructor(props) {
        super(props);
        const { ns, portNum } = props;
        this.state = {
            running: true,
            now: performance.now()
        };
        this.port = ns.getPortHandle(portNum);
        this.jobs = new Map();
        this.nRows = 0;
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
    addJob(job) {
        if (job.jobID === undefined) {
            while (this.jobs.has(this.nRows)) {
                this.nRows += 1;
            }
            job.jobID = this.nRows;
        }
        if (this.jobs.has(job.jobID)) {
            job = Object.assign(this.jobs.get(job.jobID), job);
        }
        else {
            job.rowID = this.nRows;
            this.nRows += 1;
        }
        this.jobs.set(job.jobID, job);
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
    readPort = () => {
        if (!this.state.running)
            return;
        while (!this.port.empty()) {
            const job = JSON.parse(this.port.read());
            this.addJob(job);
        }
        this.port.nextWrite().then(this.readPort);
    };
    animate = () => {
        if (!this.state.running)
            return;
        this.setState({ now: performance.now() });
        requestAnimationFrame(this.animate);
    };
    render() {
        const displayJobs = [...this.jobs.values()];
        const serverPredictions = displayJobs.map((job) => [job.endTime, job.serverAfter]).filter(([t, s]) => !!s).sort((a, b) => a[0] - b[0]);
        // TODO: create example of user providing actual [time, server] observations
        const serverObservations = displayJobs.map((job) => [job.startTime, job.serverBefore]).filter(([t, s]) => !!s).sort((a, b) => a[0] - b[0]);
        return (React.createElement(GraphFrame, { now: this.state.now },
            React.createElement(SafetyLayer, { serverPredictions: serverPredictions }),
            React.createElement(JobLayer, { jobs: displayJobs }),
            React.createElement(SecurityLayer, { serverPredictions: serverPredictions, serverObservations: serverObservations }),
            React.createElement(MoneyLayer, { jobs: displayJobs })));
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
function SafetyLayer({ serverPredictions }) {
    let prevTime;
    let prevServer;
    return (React.createElement("g", { id: "safetyLayer" },
        serverPredictions.map(([time, server], i) => {
            let el = null;
            // shade the background based on secLevel
            if (prevTime && time > prevTime) {
                el = (React.createElement("rect", { key: i, x: convertTime(prevTime), width: convertTime(time - prevTime, 0), y: 0, height: "100%", fill: (prevServer.hackDifficulty > prevServer.minDifficulty) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe }));
            }
            prevTime = time;
            prevServer = server;
            return el;
        }),
        prevServer && (React.createElement("rect", { key: "remainder", x: convertTime(prevTime), width: convertTime(10000, 0), y: 0, height: "100%", fill: (prevServer.hackDifficulty > prevServer.minDifficulty) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe }))));
}
function JobLayer({ jobs }) {
    return (React.createElement("g", { id: "jobLayer" }, jobs.map((job) => (React.createElement(JobBar, { job: job, key: job.jobID })))));
}
function JobBar({ job }) {
    const y = ((job.rowID + 1) % ((HEIGHT_PIXELS - FOOTER_PIXELS * 2) / 4)) * 4;
    let jobBar = null;
    if (job.startTime && job.duration) {
        jobBar = (React.createElement("rect", { x: convertTime(job.startTime), width: convertTime(job.duration, 0), y: 0, height: 2, fill: GRAPH_COLORS[job.cancelled ? 'cancelled' : job.task] }));
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
function SecurityLayer({ serverPredictions, serverObservations }) {
    serverPredictions ??= [];
    serverObservations ??= [];
    let minSec = 0;
    let maxSec = 1;
    for (const snapshots of [serverPredictions, serverObservations]) {
        for (const [time, server] of snapshots) {
            minSec = Math.min(minSec, server.hackDifficulty);
            maxSec = Math.max(maxSec, server.hackDifficulty);
        }
    }
    const observedPath = computePathData("hackDifficulty", serverObservations, minSec, true);
    const observedLayer = (React.createElement("g", { id: "observedSec", transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxSec - minSec)})`, fill: "dark" + GRAPH_COLORS.security, 
        // "fill-opacity": 0.5,
        clipPath: `url(#hide-future-${initTime})` },
        React.createElement("path", { d: observedPath.join(" ") })));
    const predictedPath = computePathData("hackDifficulty", serverPredictions);
    const predictedLayer = (React.createElement("g", { id: "predictedSec", transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxSec - minSec)})`, stroke: GRAPH_COLORS.security, fill: "none", strokeWidth: 2, strokeLinejoin: "bevel" },
        React.createElement("path", { d: predictedPath.join(" "), vectorEffect: "non-scaling-stroke" })));
    return (React.createElement("g", { id: "secLayer", transform: `translate(0 ${HEIGHT_PIXELS - 2 * FOOTER_PIXELS})` },
        observedLayer,
        predictedLayer));
}
function computePathData(field = "hackDifficulty", serverSnapshots = [], minValue = 0, shouldClose = false, scale = 1) {
    const pathData = [];
    let prevTime;
    let prevServer;
    for (const [time, server] of serverSnapshots) {
        if (!prevServer) {
            // start line at first projected time and value
            pathData.push(`M ${convertTime(time).toFixed(3)},${(server[field] * scale).toFixed(2)}`);
        }
        if (prevServer) {
            // vertical line to previous level
            // horizontal line to current time
            pathData.push(`V ${(prevServer[field] * scale).toFixed(2)}`, `H ${convertTime(time).toFixed(3)}`);
        }
        prevServer = server;
        prevTime = time;
    }
    // fill in area between last snapshot and "now" cursor
    if (prevServer) {
        // vertical line to previous level
        // horizontal line to current time
        pathData.push(`V ${(prevServer[field] * scale).toFixed(2)}`, `H ${convertTime(prevTime + 600000).toFixed(3)}`);
        if (shouldClose) {
            // fill area under actual security
            pathData.push(`V ${(minValue * scale).toFixed(2)}`);
            const minTime = serverSnapshots[0][0];
            pathData.push(`H ${convertTime(minTime).toFixed(3)}`);
            pathData.push('Z');
        }
    }
    return pathData;
}
function MoneyLayer({ jobs }) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBNERFO0FBSUYsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLEtBQThCLENBQUM7QUFTeEQsSUFBSSxRQUFRLEdBQUcsV0FBVyxDQUFDLEdBQUcsRUFBWSxDQUFDO0FBQzNDOzs7O0dBSUc7QUFDSCxTQUFTLFdBQVcsQ0FBQyxDQUFTLEVBQUUsRUFBRSxHQUFDLFFBQVE7SUFDdkMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBZ0IsQ0FBQztBQUM1QyxDQUFDO0FBRUQsU0FBUyxjQUFjLENBQUMsQ0FBYztJQUNsQyxPQUFPLENBQUMsR0FBRyxZQUFZLEdBQUcsYUFBMkIsQ0FBQztBQUMxRCxDQUFDO0FBRUQsTUFBTSxZQUFZLEdBQUc7SUFDakIsTUFBTSxFQUFFLE1BQU07SUFDZCxNQUFNLEVBQUUsWUFBWTtJQUNwQixRQUFRLEVBQUUsUUFBUTtJQUNsQixXQUFXLEVBQUUsS0FBSztJQUNsQixRQUFRLEVBQUUsU0FBUztJQUNuQixNQUFNLEVBQUUsTUFBTTtJQUNkLFFBQVEsRUFBRSxNQUFNO0lBQ2hCLFVBQVUsRUFBRSxLQUFLO0lBQ2pCLE9BQU8sRUFBRSxNQUFNO0NBQ2xCLENBQUM7QUFFRixNQUFNLFlBQVksR0FBRyxHQUFpQixDQUFDO0FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEVBQWlCLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUcsR0FBYSxDQUFDO0FBQ3BDLE1BQU0sYUFBYSxHQUFHLEVBQVksQ0FBQztBQWdDbkMsbUJBQW1CO0FBRW5CLE1BQU0sS0FBSyxHQUFxRDtJQUM1RCxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUM7SUFDZixDQUFDLE1B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XG5cblVzYWdlXG4tLS0tLVxuXG5TdGFydCB0aGUgYmF0Y2ggdmlld2VyIHNjcmlwdCBmcm9tIHRoZSBjb21tYW5kIGxpbmU6XG5cbiAgICBydW4gYmF0Y2gtdmlldy5qcyAtLXBvcnQgMTBcblxuVGhlbiBzZW5kIG1lc3NhZ2VzIHRvIGl0IGZyb20gb3RoZXIgc2NyaXB0cy5cblxuRXhhbXBsZTogRGlzcGxheSBhY3Rpb24gdGltaW5nIChoYWNrIC8gZ3JvdyAvIHdlYWtlbilcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnaGFjaycsXG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBzdGFydFRpbWU6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgICAgICBkdXJhdGlvbjogbnMuZ2V0SGFja1RpbWUodGFyZ2V0KSxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IFVwZGF0ZSBhbiBhY3Rpb24gdGhhdCBoYXMgYWxyZWFkeSBiZWVuIGRpc3BsYXllZFxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBzdGFydFRpbWVBY3R1YWw6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgIH0pKTtcbiAgICBhd2FpdCBucy5oYWNrKHRhcmdldCk7XG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBlbmRUaW1lQWN0dWFsOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IERpc3BsYXkgYSBibGFuayByb3cgYmV0d2VlbiBhY3Rpb25zICh0byB2aXN1YWxseSBzZXBhcmF0ZSBiYXRjaGVzKVxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdzcGFjZXInLFxuICAgIH0pKTtcblxuRXhhbXBsZTogRGlzcGxheSBvYnNlcnZlZCBzZWN1cml0eSAvIG1vbmV5IGxldmVsXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ29ic2VydmVkJyxcbiAgICAgICAgdGltZTogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgICAgIG1pbkRpZmZpY3VsdHk6IG5zLmdldFNlcnZlck1pblNlY3VyaXR5TGV2ZWwodGFyZ2V0KSxcbiAgICAgICAgaGFja0RpZmZpY3VsdHk6IG5zLmdldFNlcnZlclNlY3VyaXR5TGV2ZWwodGFyZ2V0KSxcbiAgICAgICAgbW9uZXlNYXg6IG5zLmdldFNlcnZlck1heE1vbmV5KHRhcmdldCksXG4gICAgICAgIG1vbmV5QXZhaWxhYmxlOiBucy5nZXRTZXJ2ZXJNb25leUF2YWlsYWJsZSh0YXJnZXQpLFxuICAgIH0pKTtcblxuRXhhbXBsZTogRGlzcGxheSBleHBlY3RlZCBzZWN1cml0eSAvIG1vbmV5IGxldmVsICh2YXJpZXMgYnkgYWN0aW9uIHR5cGUgYW5kIHlvdXIgc3RyYXRlZ3kpXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ2V4cGVjdGVkJyxcbiAgICAgICAgdGltZTogam9iLnN0YXJ0VGltZSArIGpvYi5kdXJhdGlvbixcbiAgICAgICAgbWluRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyTWluU2VjdXJpdHlMZXZlbCh0YXJnZXQpLFxuICAgICAgICBoYWNrRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyU2VjdXJpdHlMZXZlbCh0YXJnZXQpICsgbnMuaGFja0FuYWx5emVTZWN1cml0eShqb2IudGhyZWFkcyksXG4gICAgICAgIG1vbmV5TWF4OiBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpLFxuICAgICAgICBtb25leUF2YWlsYWJsZTogTWF0aC5tYXgoMCwgbnMuZ2V0U2VydmVyTWF4TW9uZXkodGFyZ2V0KSAtIG5zLmhhY2tBbmFseXplKHRhcmdldCkgKiBqb2IudGhyZWFkcyAqIG5zLmhhY2tBbmFseXplQ2hhbmNlKHRhcmdldCkpLFxuICAgIH0pKTtcblxuKi9cblxuaW1wb3J0IHR5cGUgeyBOUywgTmV0c2NyaXB0UG9ydCwgU2VydmVyIH0gZnJvbSAnQG5zJztcbmltcG9ydCB0eXBlIFJlYWN0TmFtZXNwYWNlIGZyb20gJ3JlYWN0L2luZGV4JztcbmNvbnN0IFJlYWN0ID0gZ2xvYmFsVGhpcy5SZWFjdCBhcyB0eXBlb2YgUmVhY3ROYW1lc3BhY2U7XG5cbi8vIC0tLS0tIGNvbnN0YW50cyAtLS0tLSBcblxudHlwZSBUaW1lTXMgPSBSZXR1cm5UeXBlPHR5cGVvZiBwZXJmb3JtYW5jZS5ub3c+ICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwibWlsbGlzZWNvbmRzXCIgfTtcbnR5cGUgVGltZVNlY29uZHMgPSBudW1iZXIgJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJzZWNvbmRzXCIgfTtcbnR5cGUgVGltZVBpeGVscyA9IG51bWJlciAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcInBpeGVsc1wiIH07XG50eXBlIFBpeGVscyA9IG51bWJlciAmIHsgX191bml0czogXCJwaXhlbHNcIiB9O1xuXG5sZXQgaW5pdFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXM7XG4vKipcbiAqIENvbnZlcnQgdGltZXN0YW1wcyB0byBzZWNvbmRzIHNpbmNlIHRoZSBncmFwaCB3YXMgc3RhcnRlZC5cbiAqIFRvIHJlbmRlciBTVkdzIHVzaW5nIG5hdGl2ZSB0aW1lIHVuaXRzLCB0aGUgdmFsdWVzIG11c3QgYmUgdmFsaWQgMzItYml0IGludHMuXG4gKiBTbyB3ZSBjb252ZXJ0IHRvIGEgcmVjZW50IGVwb2NoIGluIGNhc2UgRGF0ZS5ub3coKSB2YWx1ZXMgYXJlIHVzZWQuXG4gKi9cbmZ1bmN0aW9uIGNvbnZlcnRUaW1lKHQ6IFRpbWVNcywgdDA9aW5pdFRpbWUpOiBUaW1lU2Vjb25kcyB7XG4gICAgcmV0dXJuICgodCAtIHQwKSAvIDEwMDApIGFzIFRpbWVTZWNvbmRzO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0U2VjVG9QeCh0OiBUaW1lU2Vjb25kcyk6IFRpbWVQaXhlbHMge1xuICAgIHJldHVybiB0ICogV0lEVEhfUElYRUxTIC8gV0lEVEhfU0VDT05EUyBhcyBUaW1lUGl4ZWxzO1xufVxuXG5jb25zdCBHUkFQSF9DT0xPUlMgPSB7XG4gICAgXCJoYWNrXCI6IFwiY3lhblwiLFxuICAgIFwiZ3Jvd1wiOiBcImxpZ2h0Z3JlZW5cIixcbiAgICBcIndlYWtlblwiOiBcInllbGxvd1wiLFxuICAgIFwiY2FuY2VsbGVkXCI6IFwicmVkXCIsXG4gICAgXCJkZXN5bmNcIjogXCJtYWdlbnRhXCIsXG4gICAgXCJzYWZlXCI6IFwiIzExMVwiLFxuICAgIFwidW5zYWZlXCI6IFwiIzMzM1wiLFxuICAgIFwic2VjdXJpdHlcIjogXCJyZWRcIixcbiAgICBcIm1vbmV5XCI6IFwiYmx1ZVwiXG59O1xuXG5jb25zdCBXSURUSF9QSVhFTFMgPSA4MDAgYXMgVGltZVBpeGVscztcbmNvbnN0IFdJRFRIX1NFQ09ORFMgPSAxNiBhcyBUaW1lU2Vjb25kcztcbmNvbnN0IEhFSUdIVF9QSVhFTFMgPSA2MDAgYXMgUGl4ZWxzO1xuY29uc3QgRk9PVEVSX1BJWEVMUyA9IDUwIGFzIFBpeGVscztcblxuLy8gLS0tLS0gdHlwZXMgLS0tLS1cblxuXG5pbnRlcmZhY2UgSm9iIHtcbiAgICBqb2JJRDogc3RyaW5nIHwgbnVtYmVyO1xuICAgIHJvd0lEOiBudW1iZXI7XG4gICAgdGFzazogXCJoYWNrXCIgfCBcImdyb3dcIiB8IFwid2Vha2VuXCI7XG4gICAgZHVyYXRpb246IFRpbWVNcztcbiAgICBzdGFydFRpbWU6IFRpbWVNcztcbiAgICBzdGFydFRpbWVBY3R1YWw6IFRpbWVNcztcbiAgICBlbmRUaW1lOiBUaW1lTXM7XG4gICAgZW5kVGltZUFjdHVhbDogVGltZU1zO1xuICAgIGNhbmNlbGxlZDogYm9vbGVhbjtcbiAgICBzZXJ2ZXJCZWZvcmU6IFNlcnZlckluZm87XG4gICAgc2VydmVyQWZ0ZXI6IFNlcnZlckluZm87XG4gICAgcmVzdWx0QWN0dWFsOiBudW1iZXI7XG4gICAgY2hhbmdlOiB7XG4gICAgICAgIHBsYXllck1vbmV5OiBudW1iZXI7XG4gICAgfTtcbn1cblxuaW50ZXJmYWNlIFNlcnZlckluZm8ge1xuICAgIG1vbmV5QXZhaWxhYmxlOiBudW1iZXI7XG4gICAgbW9uZXlNYXg6IG51bWJlcjtcbiAgICBoYWNrRGlmZmljdWx0eTogbnVtYmVyO1xuICAgIG1pbkRpZmZpY3VsdHk6IG51bWJlcjtcbn1cblxudHlwZSBTZXJ2ZXJTbmFwc2hvdCA9IFtUaW1lTXMsIFNlcnZlckluZm9dO1xuXG4vLyAtLS0tLSBtYWluIC0tLS0tXG5cbmNvbnN0IEZMQUdTOiBbc3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgc3RyaW5nW11dW10gPSBbXG4gICAgW1wiaGVscFwiLCBmYWxzZV0sXG4gICAgW1wicG9ydFwiLCAwXVxuXTtcblxuZXhwb3J0IGZ1bmN0aW9uIGF1dG9jb21wbGV0ZShkYXRhOiBhbnksIGFyZ3M6IHN0cmluZ1tdKSB7XG4gICAgZGF0YS5mbGFncyhGTEFHUyk7XG4gICAgcmV0dXJuIFtdO1xufVxuXG4vKiogQHBhcmFtIHtOU30gbnMgKiovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWFpbihuczogTlMpIHtcbiAgICBucy5kaXNhYmxlTG9nKCdzbGVlcCcpO1xuICAgIG5zLmNsZWFyTG9nKCk7XG4gICAgbnMudGFpbCgpO1xuICAgIG5zLnJlc2l6ZVRhaWwoODEwLCA2NDApO1xuXG4gICAgY29uc3QgZmxhZ3MgPSBucy5mbGFncyhGTEFHUyk7XG4gICAgaWYgKGZsYWdzLmhlbHApIHtcbiAgICAgICAgbnMudHByaW50KFtcbiAgICAgICAgICAgIGBVU0FHRWAsXG4gICAgICAgICAgICBgPiBydW4gJHtucy5nZXRTY3JpcHROYW1lKCl9IC0tcG9ydCAxYCxcbiAgICAgICAgICAgICcgJ1xuICAgICAgICBdLmpvaW4oXCJcXG5cIikpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcG9ydE51bSA9IGZsYWdzLnBvcnQgYXMgbnVtYmVyIHx8IG5zLnBpZDtcbiAgICBjb25zdCBwb3J0ID0gbnMuZ2V0UG9ydEhhbmRsZShwb3J0TnVtKTtcbiAgICAvLyBwb3J0LmNsZWFyKCk7XG4gICAgbnMucHJpbnQoYExpc3RlbmluZyBvbiBQb3J0ICR7cG9ydE51bX1gKTtcblxuICAgIGNvbnN0IGJhdGNoVmlldyA9IDxCYXRjaFZpZXcgbnM9e25zfSBwb3J0TnVtPXtwb3J0TnVtfSAvPjtcbiAgICBucy5wcmludFJhdyhiYXRjaFZpZXcpO1xuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgYXdhaXQgcG9ydC5uZXh0V3JpdGUoKTtcbiAgICB9XG59XG5cbi8vIC0tLS0tIEJhdGNoVmlldyAtLS0tLVxuXG5pbnRlcmZhY2UgQmF0Y2hWaWV3UHJvcHMge1xuICAgIG5zOiBOUztcbiAgICBwb3J0TnVtOiBudW1iZXI7XG59XG5pbnRlcmZhY2UgQmF0Y2hWaWV3U3RhdGUge1xuICAgIHJ1bm5pbmc6IGJvb2xlYW47XG4gICAgbm93OiBUaW1lTXM7XG59XG5leHBvcnQgY2xhc3MgQmF0Y2hWaWV3IGV4dGVuZHMgUmVhY3QuQ29tcG9uZW50PEJhdGNoVmlld1Byb3BzLCBCYXRjaFZpZXdTdGF0ZT4ge1xuICAgIHBvcnQ6IE5ldHNjcmlwdFBvcnQ7XG4gICAgam9iczogTWFwPHN0cmluZyB8IG51bWJlciwgSm9iPjtcbiAgICBuUm93czogbnVtYmVyO1xuXG4gICAgY29uc3RydWN0b3IocHJvcHM6IEJhdGNoVmlld1Byb3BzKXtcbiAgICAgICAgc3VwZXIocHJvcHMpO1xuICAgICAgICBjb25zdCB7IG5zLCBwb3J0TnVtIH0gPSBwcm9wcztcbiAgICAgICAgdGhpcy5zdGF0ZSA9IHtcbiAgICAgICAgICAgIHJ1bm5pbmc6IHRydWUsXG4gICAgICAgICAgICBub3c6IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNc1xuICAgICAgICB9O1xuICAgICAgICB0aGlzLnBvcnQgPSBucy5nZXRQb3J0SGFuZGxlKHBvcnROdW0pO1xuICAgICAgICB0aGlzLmpvYnMgPSBuZXcgTWFwKCk7XG4gICAgICAgIHRoaXMublJvd3MgPSAwO1xuICAgIH1cblxuICAgIGNvbXBvbmVudERpZE1vdW50KCkge1xuICAgICAgICBjb25zdCB7IG5zIH0gPSB0aGlzLnByb3BzO1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiB0cnVlfSk7XG4gICAgICAgIG5zLmF0RXhpdCgoKT0+e1xuICAgICAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogZmFsc2V9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMucmVhZFBvcnQoKTtcbiAgICAgICAgdGhpcy5hbmltYXRlKCk7XG4gICAgICAgIC8vIE9iamVjdC5hc3NpZ24oZ2xvYmFsVGhpcywge2JhdGNoVmlldzogdGhpc30pO1xuICAgIH1cblxuICAgIGNvbXBvbmVudFdpbGxVbm1vdW50KCkge1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiBmYWxzZX0pO1xuICAgIH1cblxuICAgIGFkZEpvYihqb2I6IEpvYikge1xuICAgICAgICBpZiAoam9iLmpvYklEID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHdoaWxlICh0aGlzLmpvYnMuaGFzKHRoaXMublJvd3MpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5uUm93cyArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgam9iLmpvYklEID0gdGhpcy5uUm93cztcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5qb2JzLmhhcyhqb2Iuam9iSUQpKSB7XG4gICAgICAgICAgICBqb2IgPSBPYmplY3QuYXNzaWduKHRoaXMuam9icy5nZXQoam9iLmpvYklEKSBhcyBKb2IsIGpvYik7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBqb2Iucm93SUQgPSB0aGlzLm5Sb3dzO1xuICAgICAgICAgICAgdGhpcy5uUm93cyArPSAxO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuam9icy5zZXQoam9iLmpvYklELCBqb2IpO1xuICAgICAgICB0aGlzLmNsZWFuSm9icygpO1xuICAgIH1cblxuICAgIGNsZWFuSm9icygpIHtcbiAgICAgICAgLy8gZmlsdGVyIG91dCBqb2JzIHdpdGggZW5kdGltZSBpbiBwYXN0XG4gICAgICAgIGlmICh0aGlzLmpvYnMuc2l6ZSA+IDIwMCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBqb2JJRCBvZiB0aGlzLmpvYnMua2V5cygpKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgam9iID0gdGhpcy5qb2JzLmdldChqb2JJRCkgYXMgSm9iO1xuICAgICAgICAgICAgICAgIGlmICgoam9iLmVuZFRpbWVBY3R1YWwgPz8gam9iLmVuZFRpbWUpIDwgdGhpcy5zdGF0ZS5ub3ctKFdJRFRIX1NFQ09ORFMqMioxMDAwKSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmpvYnMuZGVsZXRlKGpvYklEKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZWFkUG9ydCA9ICgpPT57XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5ydW5uaW5nKSByZXR1cm47XG4gICAgICAgIHdoaWxlKCF0aGlzLnBvcnQuZW1wdHkoKSkge1xuICAgICAgICAgICAgY29uc3Qgam9iID0gSlNPTi5wYXJzZSh0aGlzLnBvcnQucmVhZCgpIGFzIHN0cmluZyk7XG4gICAgICAgICAgICB0aGlzLmFkZEpvYihqb2IpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMucG9ydC5uZXh0V3JpdGUoKS50aGVuKHRoaXMucmVhZFBvcnQpO1xuICAgIH1cblxuICAgIGFuaW1hdGUgPSAoKT0+e1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUucnVubmluZykgcmV0dXJuO1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtub3c6IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNc30pO1xuICAgICAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRlKTtcbiAgICB9XG5cbiAgICByZW5kZXIoKSB7XG4gICAgICAgIGNvbnN0IGRpc3BsYXlKb2JzID0gWy4uLnRoaXMuam9icy52YWx1ZXMoKV1cbiAgICAgICAgY29uc3Qgc2VydmVyUHJlZGljdGlvbnMgPSBkaXNwbGF5Sm9icy5tYXAoKGpvYik9PihcbiAgICAgICAgICAgIFtqb2IuZW5kVGltZSBhcyBUaW1lTXMsIGpvYi5zZXJ2ZXJBZnRlciBhcyBTZXJ2ZXJdIGFzIFNlcnZlclNuYXBzaG90XG4gICAgICAgICkpLmZpbHRlcigoW3QsIHNdKT0+ISFzKS5zb3J0KChhLGIpPT5hWzBdLWJbMF0pO1xuICAgICAgICAvLyBUT0RPOiBjcmVhdGUgZXhhbXBsZSBvZiB1c2VyIHByb3ZpZGluZyBhY3R1YWwgW3RpbWUsIHNlcnZlcl0gb2JzZXJ2YXRpb25zXG4gICAgICAgIGNvbnN0IHNlcnZlck9ic2VydmF0aW9ucyA9IGRpc3BsYXlKb2JzLm1hcCgoam9iKT0+KFxuICAgICAgICAgICAgW2pvYi5zdGFydFRpbWUgYXMgVGltZU1zLCBqb2Iuc2VydmVyQmVmb3JlIGFzIFNlcnZlcl0gYXMgU2VydmVyU25hcHNob3RcbiAgICAgICAgKSkuZmlsdGVyKChbdCwgc10pPT4hIXMpLnNvcnQoKGEsYik9PmFbMF0tYlswXSk7XG4gICAgXG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8R3JhcGhGcmFtZSBub3c9e3RoaXMuc3RhdGUubm93fT5cbiAgICAgICAgICAgICAgICA8U2FmZXR5TGF5ZXIgc2VydmVyUHJlZGljdGlvbnM9e3NlcnZlclByZWRpY3Rpb25zfSAvPlxuICAgICAgICAgICAgICAgIDxKb2JMYXllciBqb2JzPXtkaXNwbGF5Sm9ic30gLz5cbiAgICAgICAgICAgICAgICA8U2VjdXJpdHlMYXllciBzZXJ2ZXJQcmVkaWN0aW9ucz17c2VydmVyUHJlZGljdGlvbnN9IHNlcnZlck9ic2VydmF0aW9ucz17c2VydmVyT2JzZXJ2YXRpb25zfSAvPlxuICAgICAgICAgICAgICAgIDxNb25leUxheWVyIGpvYnM9e2Rpc3BsYXlKb2JzfSAvPlxuICAgICAgICAgICAgPC9HcmFwaEZyYW1lPlxuICAgICAgICApXG4gICAgfVxufVxuXG5mdW5jdGlvbiBHcmFwaEZyYW1lKHtub3csIGNoaWxkcmVufTp7bm93OlRpbWVNcywgY2hpbGRyZW46IFJlYWN0LlJlYWN0Tm9kZX0pOiBSZWFjdC5SZWFjdEVsZW1lbnQge1xuICAgIC8vIFRPRE86IGluaXRUaW1lIGlzIHVzZWQgYXMgdW5pcXVlIERPTSBJRCBhbmQgYXMgcmVuZGVyaW5nIG9yaWdpbiBidXQgaXQgaXMgcG9vcmx5IHN1aXRlZCBmb3IgYm90aFxuICAgIHJldHVybiAoXG4gICAgICAgIDxzdmcgdmVyc2lvbj1cIjEuMVwiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIlxuICAgICAgICAgICAgd2lkdGg9e1dJRFRIX1BJWEVMU31cbiAgICAgICAgICAgIGhlaWdodD17SEVJR0hUX1BJWEVMU30gXG4gICAgICAgICAgICAvLyBTZXQgdGhlIHZpZXdCb3ggZm9yIDEwIHNlY29uZHMgb2YgaGlzdG9yeSwgNiBzZWNvbmRzIG9mIGZ1dHVyZS5cbiAgICAgICAgICAgIHZpZXdCb3g9e2Ake2NvbnZlcnRTZWNUb1B4KC0xMCBhcyBUaW1lU2Vjb25kcyl9IDAgJHtXSURUSF9QSVhFTFN9ICR7SEVJR0hUX1BJWEVMU31gfVxuICAgICAgICA+XG4gICAgICAgICAgICA8ZGVmcz5cbiAgICAgICAgICAgICAgICA8Y2xpcFBhdGggaWQ9e2BoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfWB9IGNsaXBQYXRoVW5pdHM9XCJ1c2VyU3BhY2VPblVzZVwiPlxuICAgICAgICAgICAgICAgICAgICA8cmVjdCBpZD1cImhpZGUtZnV0dXJlLXJlY3RcIlxuICAgICAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUobm93LTYwMDAwIGFzIFRpbWVNcyl9IHdpZHRoPXtjb252ZXJ0VGltZSg2MDAwMCBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD17NTB9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9jbGlwUGF0aD5cbiAgICAgICAgICAgIDwvZGVmcz5cbiAgICAgICAgICAgIDxyZWN0IGlkPVwiYmFja2dyb3VuZFwiIHg9e2NvbnZlcnRTZWNUb1B4KC0xMCBhcyBUaW1lU2Vjb25kcyl9IHdpZHRoPVwiMTAwJVwiIGhlaWdodD1cIjEwMCVcIiBmaWxsPXtHUkFQSF9DT0xPUlMuc2FmZX0gLz5cbiAgICAgICAgICAgIDxnIGlkPVwidGltZUNvb3JkaW5hdGVzXCIgdHJhbnNmb3JtPXtgc2NhbGUoJHtXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTfSAxKSB0cmFuc2xhdGUoJHtjb252ZXJ0VGltZShpbml0VGltZS1ub3cgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9IDApYH0+XG4gICAgICAgICAgICAgICAge2NoaWxkcmVufVxuICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0xXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy1GT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTJcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLTIqRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgPHJlY3QgaWQ9XCJjdXJzb3JcIiB4PXswfSB3aWR0aD17MX0geT17MH0gaGVpZ2h0PVwiMTAwJVwiIGZpbGw9XCJ3aGl0ZVwiIC8+XG4gICAgICAgICAgICA8R3JhcGhMZWdlbmQgLz5cbiAgICAgICAgPC9zdmc+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gR3JhcGhMZWdlbmQoKTogUmVhY3QuUmVhY3RFbGVtZW50IHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cIkxlZ2VuZFwiIHRyYW5zZm9ybT1cInRyYW5zbGF0ZSgtNDkwLCAxMCksIHNjYWxlKC41LCAuNSlcIj5cbiAgICAgICAgICAgIDxyZWN0IHg9ezF9IHk9ezF9IHdpZHRoPXsyNzV9IGhlaWdodD17MzkyfSBmaWxsPVwiYmxhY2tcIiBzdHJva2U9XCIjOTc5Nzk3XCIgLz5cbiAgICAgICAgICAgIHtPYmplY3QuZW50cmllcyhHUkFQSF9DT0xPUlMpLm1hcCgoW2xhYmVsLCBjb2xvcl0sIGkpPT4oXG4gICAgICAgICAgICAgICAgPGcga2V5PXtsYWJlbH0gdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDIyLCAkezEzICsgNDEqaX0pYH0+XG4gICAgICAgICAgICAgICAgICAgIDxyZWN0IHg9ezB9IHk9ezB9IHdpZHRoPXsyMn0gaGVpZ2h0PXsyMn0gZmlsbD17Y29sb3J9IC8+XG4gICAgICAgICAgICAgICAgICAgIDx0ZXh0IGZvbnRGYW1pbHk9XCJDb3VyaWVyIE5ld1wiIGZvbnRTaXplPXszNn0gZmlsbD1cIiM4ODhcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDx0c3BhbiB4PXs0Mi41fSB5PXszMH0+e2xhYmVsLnN1YnN0cmluZygwLDEpLnRvVXBwZXJDYXNlKCkrbGFiZWwuc3Vic3RyaW5nKDEpfTwvdHNwYW4+XG4gICAgICAgICAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIFNhZmV0eUxheWVyKHtzZXJ2ZXJQcmVkaWN0aW9uc306IHtzZXJ2ZXJQcmVkaWN0aW9uczogU2VydmVyU25hcHNob3RbXX0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGxldCBwcmV2VGltZTogVGltZU1zIHwgdW5kZWZpbmVkO1xuICAgIGxldCBwcmV2U2VydmVyOiBTZXJ2ZXJJbmZvIHwgdW5kZWZpbmVkO1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwic2FmZXR5TGF5ZXJcIj5cbiAgICAgICAgICAgIHtzZXJ2ZXJQcmVkaWN0aW9ucy5tYXAoKFt0aW1lLCBzZXJ2ZXJdLCBpKT0+e1xuICAgICAgICAgICAgICAgIGxldCBlbCA9IG51bGw7XG4gICAgICAgICAgICAgICAgLy8gc2hhZGUgdGhlIGJhY2tncm91bmQgYmFzZWQgb24gc2VjTGV2ZWxcbiAgICAgICAgICAgICAgICBpZiAocHJldlRpbWUgJiYgdGltZSA+IHByZXZUaW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGVsID0gKDxyZWN0IGtleT17aX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHByZXZUaW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHRpbWUgLSBwcmV2VGltZSwgMCl9XG4gICAgICAgICAgICAgICAgICAgICAgICB5PXswfSBoZWlnaHQ9XCIxMDAlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGw9eyhwcmV2U2VydmVyLmhhY2tEaWZmaWN1bHR5ID4gcHJldlNlcnZlci5taW5EaWZmaWN1bHR5KSA/IEdSQVBIX0NPTE9SUy51bnNhZmUgOiBHUkFQSF9DT0xPUlMuc2FmZX1cbiAgICAgICAgICAgICAgICAgICAgLz4pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBwcmV2VGltZSA9IHRpbWU7XG4gICAgICAgICAgICAgICAgcHJldlNlcnZlciA9IHNlcnZlcjtcbiAgICAgICAgICAgICAgICByZXR1cm4gZWw7XG4gICAgICAgICAgICB9KX1cbiAgICAgICAgICAgIHtwcmV2U2VydmVyICYmIChcbiAgICAgICAgICAgICAgICA8cmVjdCBrZXk9XCJyZW1haW5kZXJcIlxuICAgICAgICAgICAgICAgICAgICB4PXtjb252ZXJ0VGltZShwcmV2VGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZSgxMDAwMCwgMCl9XG4gICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD1cIjEwMCVcIlxuICAgICAgICAgICAgICAgICAgICBmaWxsPXsocHJldlNlcnZlci5oYWNrRGlmZmljdWx0eSA+IHByZXZTZXJ2ZXIubWluRGlmZmljdWx0eSkgPyBHUkFQSF9DT0xPUlMudW5zYWZlIDogR1JBUEhfQ09MT1JTLnNhZmV9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBKb2JMYXllcih7am9ic306IHtqb2JzOiBKb2JbXX0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cImpvYkxheWVyXCI+XG4gICAgICAgICAgICB7am9icy5tYXAoKGpvYjogSm9iKT0+KDxKb2JCYXIgam9iPXtqb2J9IGtleT17am9iLmpvYklEfSAvPikpfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gSm9iQmFyKHtqb2J9OiB7am9iOiBKb2J9KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBjb25zdCB5ID0gKChqb2Iucm93SUQgKyAxKSAlICgoSEVJR0hUX1BJWEVMUyAtIEZPT1RFUl9QSVhFTFMqMikgLyA0KSkgKiA0O1xuICAgIGxldCBqb2JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lICYmIGpvYi5kdXJhdGlvbikge1xuICAgICAgICBqb2JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKGpvYi5zdGFydFRpbWUpfSB3aWR0aD17Y29udmVydFRpbWUoam9iLmR1cmF0aW9uLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezJ9XG4gICAgICAgICAgICBmaWxsPXtHUkFQSF9DT0xPUlNbam9iLmNhbmNlbGxlZCA/ICdjYW5jZWxsZWQnIDogam9iLnRhc2tdfVxuICAgICAgICAvPilcbiAgICB9O1xuICAgIGxldCBzdGFydEVycm9yQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLnN0YXJ0VGltZUFjdHVhbCkge1xuICAgICAgICBjb25zdCBbdDEsIHQyXSA9IFtqb2Iuc3RhcnRUaW1lLCBqb2Iuc3RhcnRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICBzdGFydEVycm9yQmFyID0gKDxyZWN0XG4gICAgICAgICAgICB4PXtjb252ZXJ0VGltZSh0MSl9IHdpZHRoPXtjb252ZXJ0VGltZSh0Mi10MSBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17MX1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SUy5kZXN5bmN9XG4gICAgICAgICAvPik7XG4gICAgfVxuICAgIGxldCBlbmRFcnJvckJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5lbmRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5lbmRUaW1lLCBqb2IuZW5kVGltZUFjdHVhbF0uc29ydCgoYSxiKT0+YS1iKTtcbiAgICAgICAgZW5kRXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgZmlsbD17R1JBUEhfQ09MT1JTLmRlc3luY31cbiAgICAgICAgIC8+KTtcbiAgICB9XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHt5fSlgfT5cbiAgICAgICAgICAgIHtqb2JCYXJ9XG4gICAgICAgICAgICB7c3RhcnRFcnJvckJhcn1cbiAgICAgICAgICAgIHtlbmRFcnJvckJhcn1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmludGVyZmFjZSBTZWN1cml0eUxheWVyUHJvcHMge1xuICAgIHNlcnZlclByZWRpY3Rpb25zPzogU2VydmVyU25hcHNob3RbXTtcbiAgICBzZXJ2ZXJPYnNlcnZhdGlvbnM/OiBTZXJ2ZXJTbmFwc2hvdFtdXG59XG5mdW5jdGlvbiBTZWN1cml0eUxheWVyKHtzZXJ2ZXJQcmVkaWN0aW9ucywgc2VydmVyT2JzZXJ2YXRpb25zfTpTZWN1cml0eUxheWVyUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIHNlcnZlclByZWRpY3Rpb25zID8/PSBbXTtcbiAgICBzZXJ2ZXJPYnNlcnZhdGlvbnMgPz89IFtdO1xuICAgIGxldCBtaW5TZWMgPSAwO1xuICAgIGxldCBtYXhTZWMgPSAxO1xuICAgIGZvciAoY29uc3Qgc25hcHNob3RzIG9mIFtzZXJ2ZXJQcmVkaWN0aW9ucywgc2VydmVyT2JzZXJ2YXRpb25zXSkge1xuICAgICAgICBmb3IgKGNvbnN0IFt0aW1lLCBzZXJ2ZXJdIG9mIHNuYXBzaG90cykge1xuICAgICAgICAgICAgbWluU2VjID0gTWF0aC5taW4obWluU2VjLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHkpO1xuICAgICAgICAgICAgbWF4U2VjID0gTWF0aC5tYXgobWF4U2VjLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgb2JzZXJ2ZWRQYXRoID0gY29tcHV0ZVBhdGhEYXRhKFwiaGFja0RpZmZpY3VsdHlcIiwgc2VydmVyT2JzZXJ2YXRpb25zLCBtaW5TZWMsIHRydWUpO1xuICAgIGNvbnN0IG9ic2VydmVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwib2JzZXJ2ZWRTZWNcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heFNlYyAtIG1pblNlYyl9KWB9XG4gICAgICAgICAgICBmaWxsPXtcImRhcmtcIitHUkFQSF9DT0xPUlMuc2VjdXJpdHl9XG4gICAgICAgICAgICAvLyBcImZpbGwtb3BhY2l0eVwiOiAwLjUsXG4gICAgICAgICAgICBjbGlwUGF0aD17YHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHBhdGggZD17b2JzZXJ2ZWRQYXRoLmpvaW4oXCIgXCIpfSAvPlxuICAgICAgICA8L2c+XG4gICAgKTtcblxuICAgIGNvbnN0IHByZWRpY3RlZFBhdGggPSBjb21wdXRlUGF0aERhdGEoXCJoYWNrRGlmZmljdWx0eVwiLCBzZXJ2ZXJQcmVkaWN0aW9ucyk7XG4gICAgY29uc3QgcHJlZGljdGVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwicHJlZGljdGVkU2VjXCJcbiAgICAgICAgICAgIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhTZWMgLSBtaW5TZWMpfSlgfVxuICAgICAgICAgICAgc3Ryb2tlPXtHUkFQSF9DT0xPUlMuc2VjdXJpdHl9XG4gICAgICAgICAgICBmaWxsPVwibm9uZVwiXG4gICAgICAgICAgICBzdHJva2VXaWR0aD17Mn1cbiAgICAgICAgICAgIHN0cm9rZUxpbmVqb2luPVwiYmV2ZWxcIlxuICAgICAgICA+XG4gICAgICAgICAgICA8cGF0aCBkPXtwcmVkaWN0ZWRQYXRoLmpvaW4oXCIgXCIpfSB2ZWN0b3JFZmZlY3Q9XCJub24tc2NhbGluZy1zdHJva2VcIiAvPlxuICAgICAgICA8L2c+XG4gICAgKTtcblxuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwic2VjTGF5ZXJcIiB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSAyKkZPT1RFUl9QSVhFTFN9KWB9PlxuICAgICAgICAgICAge29ic2VydmVkTGF5ZXJ9XG4gICAgICAgICAgICB7cHJlZGljdGVkTGF5ZXJ9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBjb21wdXRlUGF0aERhdGEoZmllbGQ6a2V5b2YoU2VydmVySW5mbyk9XCJoYWNrRGlmZmljdWx0eVwiLCBzZXJ2ZXJTbmFwc2hvdHM6U2VydmVyU25hcHNob3RbXT1bXSwgbWluVmFsdWU9MCwgc2hvdWxkQ2xvc2U9ZmFsc2UsIHNjYWxlPTEpIHtcbiAgICBjb25zdCBwYXRoRGF0YSA9IFtdO1xuICAgIGxldCBwcmV2VGltZTogVGltZU1zIHwgdW5kZWZpbmVkO1xuICAgIGxldCBwcmV2U2VydmVyOiBTZXJ2ZXJJbmZvIHwgdW5kZWZpbmVkO1xuICAgIGZvciAoY29uc3QgW3RpbWUsIHNlcnZlcl0gb2Ygc2VydmVyU25hcHNob3RzKSB7XG4gICAgICAgIGlmICghcHJldlNlcnZlcikge1xuICAgICAgICAgICAgLy8gc3RhcnQgbGluZSBhdCBmaXJzdCBwcm9qZWN0ZWQgdGltZSBhbmQgdmFsdWVcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYE0gJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfSwkeyhzZXJ2ZXJbZmllbGRdKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwcmV2U2VydmVyKSB7XG4gICAgICAgICAgICAvLyB2ZXJ0aWNhbCBsaW5lIHRvIHByZXZpb3VzIGxldmVsXG4gICAgICAgICAgICAvLyBob3Jpem9udGFsIGxpbmUgdG8gY3VycmVudCB0aW1lXG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KHByZXZTZXJ2ZXJbZmllbGRdKnNjYWxlKS50b0ZpeGVkKDIpfWAsIGBIICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgfVxuICAgICAgICBwcmV2U2VydmVyID0gc2VydmVyO1xuICAgICAgICBwcmV2VGltZSA9IHRpbWU7XG4gICAgfVxuICAgIC8vIGZpbGwgaW4gYXJlYSBiZXR3ZWVuIGxhc3Qgc25hcHNob3QgYW5kIFwibm93XCIgY3Vyc29yXG4gICAgaWYgKHByZXZTZXJ2ZXIpIHtcbiAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBwcmV2aW91cyBsZXZlbFxuICAgICAgICAvLyBob3Jpem9udGFsIGxpbmUgdG8gY3VycmVudCB0aW1lXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYFYgJHsocHJldlNlcnZlcltmaWVsZF0qc2NhbGUpLnRvRml4ZWQoMil9YCwgYEggJHtjb252ZXJ0VGltZShwcmV2VGltZSArIDYwMDAwMCkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgaWYgKHNob3VsZENsb3NlKSB7XG4gICAgICAgICAgICAvLyBmaWxsIGFyZWEgdW5kZXIgYWN0dWFsIHNlY3VyaXR5XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KG1pblZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgICAgICAgICAgY29uc3QgbWluVGltZSA9IHNlcnZlclNuYXBzaG90c1swXVswXTtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYEggJHtjb252ZXJ0VGltZShtaW5UaW1lKS50b0ZpeGVkKDMpfWApO1xuICAgICAgICAgICAgcGF0aERhdGEucHVzaCgnWicpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBwYXRoRGF0YTtcbn1cblxuZnVuY3Rpb24gTW9uZXlMYXllcih7am9ic306IHtqb2JzOiBKb2JbXX0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIHJldHVybiA8ZyBpZD1cIm1vbmV5TGF5ZXJcIiAvPlxufVxuXG4vLyAtLS0tLSBwcmUtUmVhY3QgdmVyc2lvbiAtLS0tLVxuXG4vKipcbiAqIHJlbmRlckJhdGNoZXMgLSBjcmVhdGUgYW4gU1ZHIGVsZW1lbnQgd2l0aCBhIGdyYXBoIG9mIGpvYnNcbiAqIEBwYXJhbSB7U1ZHU1ZHRWxlbWVudH0gW2VsXSAtIFNWRyBlbGVtZW50IHRvIHJldXNlLiBXaWxsIGJlIGNyZWF0ZWQgaWYgaXQgZG9lcyBub3QgZXhpc3QgeWV0LlxuICogQHBhcmFtIHtKb2JbXVtdfSBiYXRjaGVzIC0gYXJyYXkgb2YgYXJyYXlzIG9mIGpvYnNcbiAqIEBwYXJhbSB7bnVtYmVyfSBbbm93XSAtIGN1cnJlbnQgdGltZSAob3B0aW9uYWwpXG4gKiBAcmV0dXJucyB7U1ZHU1ZHRWxlbWVudH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckJhdGNoZXMoZWw6IEhUTUxFbGVtZW50LCBiYXRjaGVzPVtdLCBzZXJ2ZXJTbmFwc2hvdHM9W10sIG5vdzogVGltZU1zKSB7XG4gICAgbm93IHx8PSBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXM7XG5cbiAgICAvLyBSZW5kZXIgdGhlIG1haW4gU1ZHIGVsZW1lbnQgaWYgbmVlZGVkXG4gICAgZWwgfHw9IHN2Z0VsKFxuICAgICAgICBcInN2Z1wiLFxuICAgICAgICB7XG4gICAgICAgICAgICB2ZXJzaW9uOiBcIjEuMVwiLCB3aWR0aDpXSURUSF9QSVhFTFMsIGhlaWdodDogSEVJR0hUX1BJWEVMUyxcbiAgICAgICAgICAgIC8vIFNldCB0aGUgdmlld0JveCBmb3IgMTAgc2Vjb25kcyBvZiBoaXN0b3J5LCA2IHNlY29uZHMgb2YgZnV0dXJlLlxuICAgICAgICAgICAgdmlld0JveDogYCR7Y29udmVydFNlY1RvUHgoLTEwKX0gMCAke1dJRFRIX1BJWEVMU30gJHtIRUlHSFRfUElYRUxTfWBcbiAgICAgICAgfSxcbiAgICAgICAgW1xuICAgICAgICAgICAgW1wiZGVmc1wiLCB7fSwgW1xuICAgICAgICAgICAgICAgIFtcImNsaXBQYXRoXCIsIHtpZDpgaGlkZS1mdXR1cmUtJHtpbml0VGltZX1gLCBjbGlwUGF0aFVuaXRzOiBcInVzZXJTcGFjZU9uVXNlXCJ9LCBbXG4gICAgICAgICAgICAgICAgICAgIFtcInJlY3RcIiwge2lkOlwiaGlkZS1mdXR1cmUtcmVjdFwiLCB4OmNvbnZlcnRUaW1lKG5vdy02MDAwMCksIHdpZHRoOmNvbnZlcnRUaW1lKDYwMDAwLDApLCB5OjAsIGhlaWdodDogNTB9XVxuICAgICAgICAgICAgICAgIF1dXG4gICAgICAgICAgICBdXSxcbiAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiYmFja2dyb3VuZFwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCBoZWlnaHQ6XCIxMDAlXCIsIGZpbGw6R1JBUEhfQ09MT1JTLnNhZmV9XSxcbiAgICAgICAgICAgIFtcImdcIiwge2lkOlwidGltZUNvb3JkaW5hdGVzXCJ9LCBbXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJzYWZldHlMYXllclwifV0sXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJqb2JMYXllclwifV0sXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJzZWNMYXllclwifV0sXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJtb25leUxheWVyXCJ9XVxuICAgICAgICAgICAgXV0sXG4gICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMVwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTJcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLTIqRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgW1wicmVjdFwiLCB7aWQ6XCJjdXJzb3JcIiwgeDowLCB3aWR0aDoxLCB5OjAsIGhlaWdodDogXCIxMDAlXCIsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgcmVuZGVyTGVnZW5kKClcbiAgICAgICAgXVxuICAgICk7XG5cbiAgICAvLyBVcGRhdGUgdGhlIHRpbWUgY29vcmRpbmF0ZXMgZXZlcnkgZnJhbWVcbiAgICBjb25zdCBkYXRhRWwgPSBlbC5nZXRFbGVtZW50QnlJZChcInRpbWVDb29yZGluYXRlc1wiKTtcbiAgICBkYXRhRWwuc2V0QXR0cmlidXRlKCd0cmFuc2Zvcm0nLFxuICAgICAgICBgc2NhbGUoJHtXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTfSAxKSB0cmFuc2xhdGUoJHtjb252ZXJ0VGltZShpbml0VGltZS1ub3csIDApfSAwKWBcbiAgICApO1xuICAgIGVsLmdldEVsZW1lbnRCeUlkKFwiaGlkZS1mdXR1cmUtcmVjdFwiKS5zZXRBdHRyaWJ1dGUoJ3gnLCBjb252ZXJ0VGltZShub3ctNjAwMDApKTtcbiAgICBcbiAgICAvLyBPbmx5IHVwZGF0ZSB0aGUgbWFpbiBkYXRhIGV2ZXJ5IDI1MCBtc1xuICAgIGNvbnN0IGxhc3RVcGRhdGUgPSBkYXRhRWwuZ2V0QXR0cmlidXRlKCdkYXRhLWxhc3QtdXBkYXRlJykgfHwgMDtcbiAgICBpZiAobm93IC0gbGFzdFVwZGF0ZSA8IDI1MCkge1xuICAgICAgICByZXR1cm4gZWw7XG4gICAgfVxuICAgIGRhdGFFbC5zZXRBdHRyaWJ1dGUoJ2RhdGEtbGFzdC11cGRhdGUnLCBub3cpO1xuXG4gICAgY29uc3QgZXZlbnRTbmFwc2hvdHMgPSBiYXRjaGVzLmZsYXQoKS5tYXAoKGpvYik9PihcbiAgICAgICAgW2pvYi5lbmRUaW1lLCBqb2IucmVzdWx0XVxuICAgICkpO1xuICAgIFxuICAgIC8vIFJlbmRlciBlYWNoIGpvYiBiYWNrZ3JvdW5kIGFuZCBmb3JlZ3JvdW5kXG4gICAgd2hpbGUoZGF0YUVsLmZpcnN0Q2hpbGQpIHtcbiAgICAgICAgZGF0YUVsLnJlbW92ZUNoaWxkKGRhdGFFbC5maXJzdENoaWxkKTtcbiAgICB9XG4gICAgZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlclNhZmV0eUxheWVyKGJhdGNoZXMsIG5vdykpO1xuICAgIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJKb2JMYXllcihiYXRjaGVzLCBub3cpKTtcbiAgICBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyU2VjdXJpdHlMYXllcihldmVudFNuYXBzaG90cywgc2VydmVyU25hcHNob3RzLCBub3cpKTtcbiAgICAvLyBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyTW9uZXlMYXllcihldmVudFNuYXBzaG90cywgc2VydmVyU25hcHNob3RzLCBub3cpKTtcbiAgICBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyUHJvZml0TGF5ZXIoYmF0Y2hlcywgbm93KSk7XG5cbiAgICByZXR1cm4gZWw7XG59XG5cblxuZnVuY3Rpb24gcmVuZGVyUHJvZml0UGF0aChiYXRjaGVzPVtdLCBub3csIHNjYWxlPTEpIHtcbiAgICAvLyB3b3VsZCBsaWtlIHRvIGdyYXBoIG1vbmV5IHBlciBzZWNvbmQgb3ZlciB0aW1lXG4gICAgLy8gY29uc3QgbW9uZXlUYWtlbiA9IFtdO1xuICAgIGNvbnN0IHRvdGFsTW9uZXlUYWtlbiA9IFtdO1xuICAgIGxldCBydW5uaW5nVG90YWwgPSAwO1xuICAgIGZvciAoY29uc3QgYmF0Y2ggb2YgYmF0Y2hlcykge1xuICAgICAgICBmb3IgKGNvbnN0IGpvYiBvZiBiYXRjaCkge1xuICAgICAgICAgICAgaWYgKGpvYi50YXNrID09ICdoYWNrJyAmJiBqb2IuZW5kVGltZUFjdHVhbCkge1xuICAgICAgICAgICAgICAgIC8vIG1vbmV5VGFrZW4ucHVzaChbam9iLmVuZFRpbWVBY3R1YWwsIGpvYi5yZXN1bHRBY3R1YWxdKTtcbiAgICAgICAgICAgICAgICBydW5uaW5nVG90YWwgKz0gam9iLnJlc3VsdEFjdHVhbDtcbiAgICAgICAgICAgICAgICB0b3RhbE1vbmV5VGFrZW4ucHVzaChbam9iLmVuZFRpbWVBY3R1YWwsIHJ1bm5pbmdUb3RhbF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoam9iLnRhc2sgPT0gJ2hhY2snICYmICFqb2IuY2FuY2VsbGVkKSB7XG4gICAgICAgICAgICAgICAgcnVubmluZ1RvdGFsICs9IGpvYi5jaGFuZ2UucGxheWVyTW9uZXk7XG4gICAgICAgICAgICAgICAgdG90YWxNb25leVRha2VuLnB1c2goW2pvYi5lbmRUaW1lLCBydW5uaW5nVG90YWxdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICB0b3RhbE1vbmV5VGFrZW4ucHVzaChbbm93ICsgMzAwMDAsIHJ1bm5pbmdUb3RhbF0pO1xuICAgIC8vIG1vbmV5IHRha2VuIGluIHRoZSBsYXN0IFggc2Vjb25kcyBjb3VsZCBiZSBjb3VudGVkIHdpdGggYSBzbGlkaW5nIHdpbmRvdy5cbiAgICAvLyBidXQgdGhlIHJlY29yZGVkIGV2ZW50cyBhcmUgbm90IGV2ZW5seSBzcGFjZWQuXG4gICAgY29uc3QgbW92aW5nQXZlcmFnZSA9IFtdO1xuICAgIGxldCBtYXhQcm9maXQgPSAwO1xuICAgIGxldCBqID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRvdGFsTW9uZXlUYWtlbi5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBbdGltZSwgbW9uZXldID0gdG90YWxNb25leVRha2VuW2ldO1xuICAgICAgICB3aGlsZSAodG90YWxNb25leVRha2VuW2pdWzBdIDw9IHRpbWUgLSAyMDAwKSB7XG4gICAgICAgICAgICBqKys7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcHJvZml0ID0gdG90YWxNb25leVRha2VuW2ldWzFdIC0gdG90YWxNb25leVRha2VuW2pdWzFdO1xuICAgICAgICBtb3ZpbmdBdmVyYWdlLnB1c2goW3RpbWUsIHByb2ZpdF0pO1xuICAgICAgICBtYXhQcm9maXQgPSBNYXRoLm1heChtYXhQcm9maXQsIHByb2ZpdCk7XG4gICAgfVxuICAgIGV2YWwoXCJ3aW5kb3dcIikucHJvZml0RGF0YSA9IFt0b3RhbE1vbmV5VGFrZW4sIHJ1bm5pbmdUb3RhbCwgbW92aW5nQXZlcmFnZV07XG4gICAgY29uc3QgcGF0aERhdGEgPSBbXCJNIDAsMFwiXTtcbiAgICBsZXQgcHJldlRpbWU7XG4gICAgbGV0IHByZXZQcm9maXQ7XG4gICAgZm9yIChjb25zdCBbdGltZSwgcHJvZml0XSBvZiBtb3ZpbmdBdmVyYWdlKSB7XG4gICAgICAgIC8vIHBhdGhEYXRhLnB1c2goYEwgJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfSwkeyhzY2FsZSAqIHByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9YCk7XG4gICAgICAgIGlmIChwcmV2UHJvZml0KSB7XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBDICR7Y29udmVydFRpbWUoKHByZXZUaW1lKjMgKyB0aW1lKS80KS50b0ZpeGVkKDMpfSwkeyhzY2FsZSAqIHByZXZQcm9maXQvbWF4UHJvZml0KS50b0ZpeGVkKDMpfSAke2NvbnZlcnRUaW1lKChwcmV2VGltZSArIDMqdGltZSkvNCkudG9GaXhlZCgzKX0sJHsoc2NhbGUgKiBwcm9maXQvbWF4UHJvZml0KS50b0ZpeGVkKDMpfSAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJvZml0L21heFByb2ZpdCkudG9GaXhlZCgzKX1gKVxuICAgICAgICB9XG4gICAgICAgIHByZXZUaW1lID0gdGltZTtcbiAgICAgICAgcHJldlByb2ZpdCA9IHByb2ZpdDtcbiAgICB9XG4gICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKG5vdys2MDAwMCkudG9GaXhlZCgzKX0gViAwIFpgKTtcbiAgICByZXR1cm4gc3ZnRWwoJ3BhdGgnLCB7XG4gICAgICAgIGQ6IHBhdGhEYXRhLmpvaW4oJyAnKSxcbiAgICAgICAgXCJ2ZWN0b3ItZWZmZWN0XCI6IFwibm9uLXNjYWxpbmctc3Ryb2tlXCJcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyUHJvZml0TGF5ZXIoYmF0Y2hlcz1bXSwgbm93KSB7XG4gICAgY29uc3QgcHJvZml0UGF0aCA9IHJlbmRlclByb2ZpdFBhdGgoYmF0Y2hlcywgbm93KTtcbiAgICBjb25zdCBvYnNlcnZlZFByb2ZpdCA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwib2JzZXJ2ZWRQcm9maXRcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMU30pYCxcbiAgICAgICAgICAgIGZpbGw6IFwiZGFya1wiK0dSQVBIX0NPTE9SUy5tb25leSxcbiAgICAgICAgICAgIFwiY2xpcC1wYXRoXCI6IGB1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWBcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgcHJvZml0UGF0aFxuICAgICAgICBdXG4gICAgKTtcbiAgICBjb25zdCBwcm9qZWN0ZWRQcm9maXQgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInByb2plY3RlZFByb2ZpdFwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTfSlgLFxuICAgICAgICAgICAgZmlsbDogXCJub25lXCIsXG4gICAgICAgICAgICBzdHJva2U6IEdSQVBIX0NPTE9SUy5tb25leSxcbiAgICAgICAgICAgIFwic3Ryb2tlLXdpZHRoXCI6IDIsXG4gICAgICAgICAgICBcInN0cm9rZS1saW5lam9pblwiOlwicm91bmRcIlxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBwcm9maXRQYXRoLmNsb25lTm9kZSgpXG4gICAgICAgIF1cbiAgICApO1xuICAgIGNvbnN0IHByb2ZpdExheWVyID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJwcm9maXRMYXllclwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMU30pYFxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBvYnNlcnZlZFByb2ZpdCxcbiAgICAgICAgICAgIHByb2plY3RlZFByb2ZpdFxuICAgICAgICBdXG4gICAgKTtcbiAgICByZXR1cm4gcHJvZml0TGF5ZXI7XG59XG5cbmZ1bmN0aW9uIHJlbmRlck1vbmV5TGF5ZXIoZXZlbnRTbmFwc2hvdHM9W10sIHNlcnZlclNuYXBzaG90cz1bXSwgbm93KSB7XG4gICAgY29uc3QgbW9uZXlMYXllciA9IHN2Z0VsKFwiZ1wiLCB7XG4gICAgICAgIGlkOiBcIm1vbmV5TGF5ZXJcIixcbiAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMU30pYFxuICAgIH0pO1xuXG4gICAgaWYgKHNlcnZlclNuYXBzaG90cy5sZW5ndGggPT0gMCkge1xuICAgICAgICByZXR1cm4gbW9uZXlMYXllcjtcbiAgICB9XG4gICAgbGV0IG1pbk1vbmV5ID0gMDtcbiAgICBsZXQgbWF4TW9uZXkgPSBzZXJ2ZXJTbmFwc2hvdHNbMF1bMV0ubW9uZXlNYXg7XG4gICAgY29uc3Qgc2NhbGUgPSAxL21heE1vbmV5O1xuICAgIG1heE1vbmV5ICo9IDEuMVxuXG4gICAgY29uc3Qgb2JzZXJ2ZWRMYXllciA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwib2JzZXJ2ZWRNb25leVwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heE1vbmV5IC0gbWluTW9uZXkpIC8gc2NhbGV9KWAsXG4gICAgICAgICAgICBmaWxsOiBcImRhcmtcIitHUkFQSF9DT0xPUlMubW9uZXksXG4gICAgICAgICAgICAvLyBcImZpbGwtb3BhY2l0eVwiOiAwLjUsXG4gICAgICAgICAgICBcImNsaXAtcGF0aFwiOiBgdXJsKCNoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfSlgXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIHJlbmRlck9ic2VydmVkUGF0aChcIm1vbmV5QXZhaWxhYmxlXCIsIHNlcnZlclNuYXBzaG90cywgbWluTW9uZXksIG5vdywgc2NhbGUpXG4gICAgICAgIF1cbiAgICApO1xuICAgIG1vbmV5TGF5ZXIuYXBwZW5kKG9ic2VydmVkTGF5ZXIpO1xuXG4gICAgY29uc3QgcHJvamVjdGVkTGF5ZXIgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInByb2plY3RlZE1vbmV5XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4TW9uZXkgLSBtaW5Nb25leSkgLyBzY2FsZX0pYCxcbiAgICAgICAgICAgIHN0cm9rZTogR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgZmlsbDogXCJub25lXCIsXG4gICAgICAgICAgICBcInN0cm9rZS13aWR0aFwiOiAyLFxuICAgICAgICAgICAgXCJzdHJva2UtbGluZWpvaW5cIjpcImJldmVsXCJcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgY29tcHV0ZVByb2plY3RlZFBhdGgoXCJtb25leUF2YWlsYWJsZVwiLCBldmVudFNuYXBzaG90cywgbm93LCBzY2FsZSlcbiAgICAgICAgXVxuICAgICk7XG4gICAgbW9uZXlMYXllci5hcHBlbmQocHJvamVjdGVkTGF5ZXIpO1xuXG4gICAgcmV0dXJuIG1vbmV5TGF5ZXI7XG59XG5cbiJdfQ==