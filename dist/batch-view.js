/*

Usage:

    run batch-view.js --port 10

API: Display action timing

    const msg = {
        type: 'action',
        jobID: 1,
        action: 'hack',
        startTime: performance.now(),
        duration: ns.getHackTime(target),
    };
    ns.tryWritePort(10, JSON.stringify(msg));

API: Display observed security/money level

    const msg = {
        type: 'observed',
        time: performance.now(),
        minDifficulty: ns.getServerMinSecurityLevel(target),
        hackDifficulty: ns.getServerSecurityLevel(target),
        moneyMax: ns.getServerMaxMoney(target),
        moneyAvailable: ns.getServerMoneyAvailable(target),
    };
    ns.tryWritePort(10, JSON.stringify(msg));

API: Display expected security/money level (varies by action type and your strategy)

    const msg = {
        type: 'expected',
        time: job.startTime + job.duration,
        minDifficulty: ns.getServerMinSecurityLevel(target),
        hackDifficulty: ns.getServerSecurityLevel(target) + ns.hackAnalyzeSecurity(job.threads),
        moneyMax: ns.getServerMaxMoney(target),
        moneyAvailable: Math.max(0, ns.getServerMaxMoney(target) - ns.hackAnalyze(target) * job.threads * ns.hackAnalyzeChance(target)),
    };
    ns.tryWritePort(10, JSON.stringify(msg));

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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7RUF5Q0U7QUFJRixNQUFNLEtBQUssR0FBRyxVQUFVLENBQUMsS0FBOEIsQ0FBQztBQVN4RCxJQUFJLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFZLENBQUM7QUFDM0M7Ozs7R0FJRztBQUNILFNBQVMsV0FBVyxDQUFDLENBQVMsRUFBRSxFQUFFLEdBQUMsUUFBUTtJQUN2QyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFnQixDQUFDO0FBQzVDLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxDQUFjO0lBQ2xDLE9BQU8sQ0FBQyxHQUFHLFlBQVksR0FBRyxhQUEyQixDQUFDO0FBQzFELENBQUM7QUFFRCxNQUFNLFlBQVksR0FBRztJQUNqQixNQUFNLEVBQUUsTUFBTTtJQUNkLE1BQU0sRUFBRSxZQUFZO0lBQ3BCLFFBQVEsRUFBRSxRQUFRO0lBQ2xCLFdBQVcsRUFBRSxLQUFLO0lBQ2xCLFFBQVEsRUFBRSxTQUFTO0lBQ25CLE1BQU0sRUFBRSxNQUFNO0lBQ2QsUUFBUSxFQUFFLE1BQU07SUFDaEIsVUFBVSxFQUFFLEtBQUs7SUFDakIsT0FBTyxFQUFFLE1BQU07Q0FDbEIsQ0FBQztBQUVGLE1BQU0sWUFBWSxHQUFHLEdBQWlCLENBQUM7QUFDdkMsTUFBTSxhQUFhLEdBQUcsRUFBaUIsQ0FBQztBQUN4QyxNQUFNLGFBQWEsR0FBRyxHQUFhLENBQUM7QUFDcEMsTUFBTSxhQUFhLEdBQUcsRUFBWSxDQUFDO0FBZ0NuQyxtQkFBbUI7QUFFbkIsTUFBTSxLQUFLLEdBQXFEO0lBQzVELENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQztJQUNmLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztDQUNkLENBQUM7QUFFRixNQUFNLFVBQVUsWUFBWSxDQUFDLElBQVMsRUFBRSxJQUFjO0lBQ2xELElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDbEIsT0FBTyxFQUFFLENBQUM7QUFDZCxDQUFDO0FBRUQsc0JBQXNCO0FBQ3RCLE1BQU0sQ0FBQyxLQUFLLFVBQVUsSUFBSSxDQUFDLEVBQU07SUFDN0IsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUN2QixFQUFFLENBQUMsUUFBUSxFQUFFLENBQUM7SUFDZCxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDVixFQUFFLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUV4QixNQUFNLEtBQUssR0FBRyxFQUFFLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzlCLElBQUksS0FBSyxDQUFDLElBQUksRUFBRTtRQUNaLEVBQUUsQ0FBQyxNQUFNLENBQUM7WUFDTixPQUFPO1lBQ1AsU0FBUyxFQUFFLENBQUMsYUFBYSxFQUFFLFdBQVc7WUFDdEMsR0FBRztTQUNOLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDZCxPQUFPO0tBQ1Y7SUFFRCxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMsSUFBYyxJQUFJLEVBQUUsQ0FBQyxHQUFHLENBQUM7SUFDL0MsTUFBTSxJQUFJLEdBQUcsRUFBRSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUN2QyxnQkFBZ0I7SUFDaEIsRUFBRSxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsT0FBTyxFQUFFLENBQUMsQ0FBQztJQUV6QyxNQUFNLFNBQVMsR0FBRyxvQkFBQyxTQUFTLElBQUMsRUFBRSxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsT0FBTyxHQUFJLENBQUM7SUFDMUQsRUFBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUV2QixPQUFPLElBQUksRUFBRTtRQUNULE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO0tBQzFCO0FBQ0wsQ0FBQztBQVlELE1BQU0sT0FBTyxTQUFVLFNBQVEsS0FBSyxDQUFDLFNBQXlDO0lBQzFFLElBQUksQ0FBZ0I7SUFDcEIsSUFBSSxDQUE0QjtJQUNoQyxLQUFLLENBQVM7SUFFZCxZQUFZLEtBQXFCO1FBQzdCLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNiLE1BQU0sRUFBRSxFQUFFLEVBQUUsT0FBTyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBQzlCLElBQUksQ0FBQyxLQUFLLEdBQUc7WUFDVCxPQUFPLEVBQUUsSUFBSTtZQUNiLEdBQUcsRUFBRSxXQUFXLENBQUMsR0FBRyxFQUFZO1NBQ25DLENBQUM7UUFDRixJQUFJLENBQUMsSUFBSSxHQUFHLEVBQUUsQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDdEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQ3RCLElBQUksQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDO0lBQ25CLENBQUM7SUFFRCxpQkFBaUI7UUFDYixNQUFNLEVBQUUsRUFBRSxFQUFFLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUMxQixJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUM7UUFDL0IsRUFBRSxDQUFDLE1BQU0sQ0FBQyxHQUFFLEVBQUU7WUFDVixJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsT0FBTyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUM7UUFDcEMsQ0FBQyxDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDaEIsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ2YsZ0RBQWdEO0lBQ3BELENBQUM7SUFFRCxvQkFBb0I7UUFDaEIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDO0lBQ3BDLENBQUM7SUFFRCxNQUFNLENBQUMsR0FBUTtRQUNYLElBQUksR0FBRyxDQUFDLEtBQUssS0FBSyxTQUFTLEVBQUU7WUFDekIsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUU7Z0JBQzlCLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxDQUFDO2FBQ25CO1lBQ0QsR0FBRyxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDO1NBQzFCO1FBQ0QsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUU7WUFDMUIsR0FBRyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1NBQzdEO2FBQ0k7WUFDRCxHQUFHLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7WUFDdkIsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUM7U0FDbkI7UUFDRCxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQzlCLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztJQUNyQixDQUFDO0lBRUQsU0FBUztRQUNMLHVDQUF1QztRQUN2QyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLEdBQUcsRUFBRTtZQUN0QixLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLEVBQUU7Z0JBQ2xDLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBUSxDQUFDO2dCQUN4QyxJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWEsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEdBQUMsQ0FBQyxhQUFhLEdBQUMsQ0FBQyxHQUFDLElBQUksQ0FBQyxFQUFFO29CQUM1RSxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztpQkFDM0I7YUFDSjtTQUNKO0lBQ0wsQ0FBQztJQUVELFFBQVEsR0FBRyxHQUFFLEVBQUU7UUFDWCxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPO1lBQUUsT0FBTztRQUNoQyxPQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsRUFBRTtZQUN0QixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFZLENBQUMsQ0FBQztZQUNuRCxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1NBQ3BCO1FBQ0QsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQzlDLENBQUMsQ0FBQTtJQUVELE9BQU8sR0FBRyxHQUFFLEVBQUU7UUFDVixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPO1lBQUUsT0FBTztRQUNoQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsR0FBRyxFQUFFLFdBQVcsQ0FBQyxHQUFHLEVBQVksRUFBQyxDQUFDLENBQUM7UUFDbEQscUJBQXFCLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ3hDLENBQUMsQ0FBQTtJQUVELE1BQU07UUFDRixNQUFNLFdBQVcsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFBO1FBQzNDLE1BQU0saUJBQWlCLEdBQUcsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBQyxFQUFFLENBQzdDLENBQUMsR0FBRyxDQUFDLE9BQWlCLEVBQUUsR0FBRyxDQUFDLFdBQXFCLENBQ3BELENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBQyxFQUFFLENBQUEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBQyxDQUFDLEVBQUMsRUFBRSxDQUFBLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNoRCw0RUFBNEU7UUFDNUUsTUFBTSxrQkFBa0IsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFDLEVBQUUsQ0FDOUMsQ0FBQyxHQUFHLENBQUMsU0FBbUIsRUFBRSxHQUFHLENBQUMsWUFBc0IsQ0FDdkQsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFDLEVBQUUsQ0FBQSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFDLENBQUMsRUFBQyxFQUFFLENBQUEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBRWhELE9BQU8sQ0FDSCxvQkFBQyxVQUFVLElBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRztZQUMzQixvQkFBQyxXQUFXLElBQUMsaUJBQWlCLEVBQUUsaUJBQWlCLEdBQUk7WUFDckQsb0JBQUMsUUFBUSxJQUFDLElBQUksRUFBRSxXQUFXLEdBQUk7WUFDL0Isb0JBQUMsYUFBYSxJQUFDLGlCQUFpQixFQUFFLGlCQUFpQixFQUFFLGtCQUFrQixFQUFFLGtCQUFrQixHQUFJO1lBQy9GLG9CQUFDLFVBQVUsSUFBQyxJQUFJLEVBQUUsV0FBVyxHQUFJLENBQ3hCLENBQ2hCLENBQUE7SUFDTCxDQUFDO0NBQ0o7QUFFRCxTQUFTLFVBQVUsQ0FBQyxFQUFDLEdBQUcsRUFBRSxRQUFRLEVBQXlDO0lBQ3ZFLG1HQUFtRztJQUNuRyxPQUFPLENBQ0gsNkJBQUssT0FBTyxFQUFDLEtBQUssRUFBQyxLQUFLLEVBQUMsNEJBQTRCLEVBQ2pELEtBQUssRUFBRSxZQUFZLEVBQ25CLE1BQU0sRUFBRSxhQUFhO1FBQ3JCLGtFQUFrRTtRQUNsRSxPQUFPLEVBQUUsR0FBRyxjQUFjLENBQUMsQ0FBQyxFQUFpQixDQUFDLE1BQU0sWUFBWSxJQUFJLGFBQWEsRUFBRTtRQUVuRjtZQUNJLGtDQUFVLEVBQUUsRUFBRSxlQUFlLFFBQVEsRUFBRSxFQUFFLGFBQWEsRUFBQyxnQkFBZ0I7Z0JBQ25FLDhCQUFNLEVBQUUsRUFBQyxrQkFBa0IsRUFDdkIsQ0FBQyxFQUFFLFdBQVcsQ0FBQyxHQUFHLEdBQUMsS0FBZSxDQUFDLEVBQUUsS0FBSyxFQUFFLFdBQVcsQ0FBQyxLQUFlLEVBQUUsQ0FBVyxDQUFDLEVBQ3JGLENBQUMsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLEVBQUUsR0FDbEIsQ0FDSyxDQUNSO1FBQ1AsOEJBQU0sRUFBRSxFQUFDLFlBQVksRUFBQyxDQUFDLEVBQUUsY0FBYyxDQUFDLENBQUMsRUFBaUIsQ0FBQyxFQUFFLEtBQUssRUFBQyxNQUFNLEVBQUMsTUFBTSxFQUFDLE1BQU0sRUFBQyxJQUFJLEVBQUUsWUFBWSxDQUFDLElBQUksR0FBSTtRQUNuSCwyQkFBRyxFQUFFLEVBQUMsaUJBQWlCLEVBQUMsU0FBUyxFQUFFLFNBQVMsWUFBWSxHQUFHLGFBQWEsaUJBQWlCLFdBQVcsQ0FBQyxRQUFRLEdBQUMsR0FBYSxFQUFFLENBQVcsQ0FBQyxLQUFLLElBQ3pJLFFBQVEsQ0FDVDtRQUtKLDhCQUFNLEVBQUUsRUFBQyxRQUFRLEVBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFDLE1BQU0sRUFBQyxJQUFJLEVBQUMsT0FBTyxHQUFHO1FBQ3JFLG9CQUFDLFdBQVcsT0FBRyxDQUNiLENBQ1QsQ0FBQztBQUNOLENBQUM7QUFFRCxTQUFTLFdBQVc7SUFDaEIsT0FBTyxDQUNILDJCQUFHLEVBQUUsRUFBQyxRQUFRLEVBQUMsU0FBUyxFQUFDLG9DQUFvQztRQUN6RCw4QkFBTSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLEdBQUcsRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBQyxPQUFPLEVBQUMsTUFBTSxFQUFDLFNBQVMsR0FBRztRQUMxRSxNQUFNLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxFQUFFLENBQUMsRUFBQyxFQUFFLENBQUEsQ0FDbkQsMkJBQUcsR0FBRyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUUsR0FBRyxFQUFFLEdBQUMsQ0FBQyxHQUFHO1lBQ25ELDhCQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsRUFBRSxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLEtBQUssR0FBSTtZQUN4RCw4QkFBTSxVQUFVLEVBQUMsYUFBYSxFQUFDLFFBQVEsRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFDLE1BQU07Z0JBQ3BELCtCQUFPLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsSUFBRyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsR0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFTLENBQ25GLENBQ1AsQ0FDUCxDQUFDLENBQ0YsQ0FDUCxDQUFDO0FBQ04sQ0FBQztBQUVELFNBQVMsV0FBVyxDQUFDLEVBQUMsaUJBQWlCLEVBQXdDO0lBQzNFLElBQUksUUFBNEIsQ0FBQztJQUNqQyxJQUFJLFVBQWtDLENBQUM7SUFDdkMsT0FBTyxDQUNILDJCQUFHLEVBQUUsRUFBQyxhQUFhO1FBQ2QsaUJBQWlCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLEVBQUUsQ0FBQyxFQUFDLEVBQUU7WUFDeEMsSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDO1lBQ2QseUNBQXlDO1lBQ3pDLElBQUksUUFBUSxJQUFJLElBQUksR0FBRyxRQUFRLEVBQUU7Z0JBQzdCLEVBQUUsR0FBRyxDQUFDLDhCQUFNLEdBQUcsRUFBRSxDQUFDLEVBQ2QsQ0FBQyxFQUFFLFdBQVcsQ0FBQyxRQUFRLENBQUMsRUFBRSxLQUFLLEVBQUUsV0FBVyxDQUFDLElBQUksR0FBRyxRQUFRLEVBQUUsQ0FBQyxDQUFDLEVBQ2hFLENBQUMsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFDLE1BQU0sRUFDbkIsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLGNBQWMsR0FBRyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxJQUFJLEdBQ3hHLENBQUMsQ0FBQzthQUNQO1lBQ0QsUUFBUSxHQUFHLElBQUksQ0FBQztZQUNoQixVQUFVLEdBQUcsTUFBTSxDQUFDO1lBQ3BCLE9BQU8sRUFBRSxDQUFDO1FBQ2QsQ0FBQyxDQUFDO1FBQ0QsVUFBVSxJQUFJLENBQ1gsOEJBQU0sR0FBRyxFQUFDLFdBQVcsRUFDakIsQ0FBQyxFQUFFLFdBQVcsQ0FBQyxRQUFRLENBQUMsRUFBRSxLQUFLLEVBQUUsV0FBVyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsRUFDdEQsQ0FBQyxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUMsTUFBTSxFQUNuQixJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsY0FBYyxHQUFHLFVBQVUsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLElBQUksR0FDeEcsQ0FDTCxDQUNELENBQ1AsQ0FBQztBQUNOLENBQUM7QUFFRCxTQUFTLFFBQVEsQ0FBQyxFQUFDLElBQUksRUFBZ0I7SUFDbkMsT0FBTyxDQUNILDJCQUFHLEVBQUUsRUFBQyxVQUFVLElBQ1gsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQVEsRUFBQyxFQUFFLENBQUEsQ0FBQyxvQkFBQyxNQUFNLElBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEtBQUssR0FBSSxDQUFDLENBQUMsQ0FDN0QsQ0FDUCxDQUFDO0FBQ04sQ0FBQztBQUVELFNBQVMsTUFBTSxDQUFDLEVBQUMsR0FBRyxFQUFhO0lBQzdCLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxhQUFhLEdBQUcsYUFBYSxHQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQzFFLElBQUksTUFBTSxHQUFHLElBQUksQ0FBQztJQUNsQixJQUFJLEdBQUcsQ0FBQyxTQUFTLElBQUksR0FBRyxDQUFDLFFBQVEsRUFBRTtRQUMvQixNQUFNLEdBQUcsQ0FBQyw4QkFDTixDQUFDLEVBQUUsV0FBVyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsV0FBVyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBVyxDQUFDLEVBQzVFLENBQUMsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFDZixJQUFJLEVBQUUsWUFBWSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUM1RCxDQUFDLENBQUE7S0FDTjtJQUFBLENBQUM7SUFDRixJQUFJLGFBQWEsR0FBRyxJQUFJLENBQUM7SUFDekIsSUFBSSxHQUFHLENBQUMsZUFBZSxFQUFFO1FBQ3JCLE1BQU0sQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxFQUFDLEVBQUUsQ0FBQSxDQUFDLEdBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdkUsYUFBYSxHQUFHLENBQUMsOEJBQ2IsQ0FBQyxFQUFFLFdBQVcsQ0FBQyxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsV0FBVyxDQUFDLEVBQUUsR0FBQyxFQUFZLEVBQUUsQ0FBVyxDQUFDLEVBQ3BFLENBQUMsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFDZixJQUFJLEVBQUUsWUFBWSxDQUFDLE1BQU0sR0FDMUIsQ0FBQyxDQUFDO0tBQ1I7SUFDRCxJQUFJLFdBQVcsR0FBRyxJQUFJLENBQUM7SUFDdkIsSUFBSSxHQUFHLENBQUMsYUFBYSxFQUFFO1FBQ25CLE1BQU0sQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxFQUFDLEVBQUUsQ0FBQSxDQUFDLEdBQUMsQ0FBQyxDQUFDLENBQUM7UUFDbkUsV0FBVyxHQUFHLENBQUMsOEJBQ1gsQ0FBQyxFQUFFLFdBQVcsQ0FBQyxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsV0FBVyxDQUFDLEVBQUUsR0FBQyxFQUFZLEVBQUUsQ0FBVyxDQUFDLEVBQ3BFLENBQUMsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFDZixJQUFJLEVBQUUsWUFBWSxDQUFDLE1BQU0sR0FDMUIsQ0FBQyxDQUFDO0tBQ1I7SUFDRCxPQUFPLENBQ0gsMkJBQUcsU0FBUyxFQUFFLGVBQWUsQ0FBQyxHQUFHO1FBQzVCLE1BQU07UUFDTixhQUFhO1FBQ2IsV0FBVyxDQUNaLENBQ1AsQ0FBQztBQUNOLENBQUM7QUFNRCxTQUFTLGFBQWEsQ0FBQyxFQUFDLGlCQUFpQixFQUFFLGtCQUFrQixFQUFvQjtJQUM3RSxpQkFBaUIsS0FBSyxFQUFFLENBQUM7SUFDekIsa0JBQWtCLEtBQUssRUFBRSxDQUFDO0lBQzFCLElBQUksTUFBTSxHQUFHLENBQUMsQ0FBQztJQUNmLElBQUksTUFBTSxHQUFHLENBQUMsQ0FBQztJQUNmLEtBQUssTUFBTSxTQUFTLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxrQkFBa0IsQ0FBQyxFQUFFO1FBQzdELEtBQUssTUFBTSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxTQUFTLEVBQUU7WUFDcEMsTUFBTSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQztZQUNqRCxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1NBQ3BEO0tBQ0o7SUFFRCxNQUFNLFlBQVksR0FBRyxlQUFlLENBQUMsZ0JBQWdCLEVBQUUsa0JBQWtCLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQ3pGLE1BQU0sYUFBYSxHQUFHLENBQ2xCLDJCQUFHLEVBQUUsRUFBQyxhQUFhLEVBQ2YsU0FBUyxFQUFFLGVBQWUsYUFBYSxhQUFhLENBQUMsYUFBYSxHQUFHLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQyxHQUFHLEVBQ3pGLElBQUksRUFBRSxNQUFNLEdBQUMsWUFBWSxDQUFDLFFBQVE7UUFDbEMsdUJBQXVCO1FBQ3ZCLFFBQVEsRUFBRSxvQkFBb0IsUUFBUSxHQUFHO1FBRXpDLDhCQUFNLENBQUMsRUFBRSxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFJLENBQ25DLENBQ1AsQ0FBQztJQUVGLE1BQU0sYUFBYSxHQUFHLGVBQWUsQ0FBQyxnQkFBZ0IsRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO0lBQzNFLE1BQU0sY0FBYyxHQUFHLENBQ25CLDJCQUFHLEVBQUUsRUFBQyxjQUFjLEVBQ2hCLFNBQVMsRUFBRSxlQUFlLGFBQWEsYUFBYSxDQUFDLGFBQWEsR0FBRyxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsR0FBRyxFQUN6RixNQUFNLEVBQUUsWUFBWSxDQUFDLFFBQVEsRUFDN0IsSUFBSSxFQUFDLE1BQU0sRUFDWCxXQUFXLEVBQUUsQ0FBQyxFQUNkLGNBQWMsRUFBQyxPQUFPO1FBRXRCLDhCQUFNLENBQUMsRUFBRSxhQUFhLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLFlBQVksRUFBQyxvQkFBb0IsR0FBRyxDQUN0RSxDQUNQLENBQUM7SUFFRixPQUFPLENBQ0gsMkJBQUcsRUFBRSxFQUFDLFVBQVUsRUFBQyxTQUFTLEVBQUUsZUFBZSxhQUFhLEdBQUcsQ0FBQyxHQUFDLGFBQWEsR0FBRztRQUN4RSxhQUFhO1FBQ2IsY0FBYyxDQUNmLENBQ1AsQ0FBQztBQUNOLENBQUM7QUFFRCxTQUFTLGVBQWUsQ0FBQyxRQUF3QixnQkFBZ0IsRUFBRSxrQkFBaUMsRUFBRSxFQUFFLFFBQVEsR0FBQyxDQUFDLEVBQUUsV0FBVyxHQUFDLEtBQUssRUFBRSxLQUFLLEdBQUMsQ0FBQztJQUMxSSxNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUM7SUFDcEIsSUFBSSxRQUE0QixDQUFDO0lBQ2pDLElBQUksVUFBa0MsQ0FBQztJQUN2QyxLQUFLLE1BQU0sQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksZUFBZSxFQUFFO1FBQzFDLElBQUksQ0FBQyxVQUFVLEVBQUU7WUFDYiwrQ0FBK0M7WUFDL0MsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztTQUMxRjtRQUNELElBQUksVUFBVSxFQUFFO1lBQ1osa0NBQWtDO1lBQ2xDLGtDQUFrQztZQUNsQyxRQUFRLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLEdBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsS0FBSyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztTQUNuRztRQUNELFVBQVUsR0FBRyxNQUFNLENBQUM7UUFDcEIsUUFBUSxHQUFHLElBQUksQ0FBQztLQUNuQjtJQUNELHNEQUFzRDtJQUN0RCxJQUFJLFVBQVUsRUFBRTtRQUNaLGtDQUFrQztRQUNsQyxrQ0FBa0M7UUFDbEMsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxHQUFDLEtBQUssQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLEtBQUssV0FBVyxDQUFDLFFBQVEsR0FBRyxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQzdHLElBQUksV0FBVyxFQUFFO1lBQ2Isa0NBQWtDO1lBQ2xDLFFBQVEsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsR0FBQyxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ2xELE1BQU0sT0FBTyxHQUFHLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUN0QyxRQUFRLENBQUMsSUFBSSxDQUFDLEtBQUssV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDdEQsUUFBUSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztTQUN0QjtLQUNKO0lBQ0QsT0FBTyxRQUFRLENBQUM7QUFDcEIsQ0FBQztBQUVELFNBQVMsVUFBVSxDQUFDLEVBQUMsSUFBSSxFQUFnQjtJQUNyQyxPQUFPLDJCQUFHLEVBQUUsRUFBQyxZQUFZLEdBQUcsQ0FBQTtBQUNoQyxDQUFDO0FBRUQsZ0NBQWdDO0FBRWhDOzs7Ozs7R0FNRztBQUNILE1BQU0sVUFBVSxhQUFhLENBQUMsRUFBZSxFQUFFLE9BQU8sR0FBQyxFQUFFLEVBQUUsZUFBZSxHQUFDLEVBQUUsRUFBRSxHQUFXO0lBQ3RGLEdBQUcsS0FBSyxXQUFXLENBQUMsR0FBRyxFQUFZLENBQUM7SUFFcEMsd0NBQXdDO0lBQ3hDLEVBQUUsS0FBSyxLQUFLLENBQ1IsS0FBSyxFQUNMO1FBQ0ksT0FBTyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUMsWUFBWSxFQUFFLE1BQU0sRUFBRSxhQUFhO1FBQ3pELGtFQUFrRTtRQUNsRSxPQUFPLEVBQUUsR0FBRyxjQUFjLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxZQUFZLElBQUksYUFBYSxFQUFFO0tBQ3ZFLEVBQ0Q7UUFDSSxDQUFDLE1BQU0sRUFBRSxFQUFFLEVBQUU7Z0JBQ1QsQ0FBQyxVQUFVLEVBQUUsRUFBQyxFQUFFLEVBQUMsZUFBZSxRQUFRLEVBQUUsRUFBRSxhQUFhLEVBQUUsZ0JBQWdCLEVBQUMsRUFBRTt3QkFDMUUsQ0FBQyxNQUFNLEVBQUUsRUFBQyxFQUFFLEVBQUMsa0JBQWtCLEVBQUUsQ0FBQyxFQUFDLFdBQVcsQ0FBQyxHQUFHLEdBQUMsS0FBSyxDQUFDLEVBQUUsS0FBSyxFQUFDLFdBQVcsQ0FBQyxLQUFLLEVBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFDLENBQUMsRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFDLENBQUM7cUJBQzNHLENBQUM7YUFDTCxDQUFDO1FBQ0YsMkdBQTJHO1FBQzNHLENBQUMsR0FBRyxFQUFFLEVBQUMsRUFBRSxFQUFDLGlCQUFpQixFQUFDLEVBQUU7Z0JBQzFCLENBQUMsR0FBRyxFQUFFLEVBQUMsRUFBRSxFQUFDLGFBQWEsRUFBQyxDQUFDO2dCQUN6QixDQUFDLEdBQUcsRUFBRSxFQUFDLEVBQUUsRUFBQyxVQUFVLEVBQUMsQ0FBQztnQkFDdEIsQ0FBQyxHQUFHLEVBQUUsRUFBQyxFQUFFLEVBQUMsVUFBVSxFQUFDLENBQUM7Z0JBQ3RCLENBQUMsR0FBRyxFQUFFLEVBQUMsRUFBRSxFQUFDLFlBQVksRUFBQyxDQUFDO2FBQzNCLENBQUM7UUFDRiwySEFBMkg7UUFDM0gsNkhBQTZIO1FBQzdILENBQUMsTUFBTSxFQUFFLEVBQUMsRUFBRSxFQUFDLFFBQVEsRUFBRSxDQUFDLEVBQUMsQ0FBQyxFQUFFLEtBQUssRUFBQyxDQUFDLEVBQUUsQ0FBQyxFQUFDLENBQUMsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUMsQ0FBQztRQUN6RSxZQUFZLEVBQUU7S0FDakIsQ0FDSixDQUFDO0lBRUYsMENBQTBDO0lBQzFDLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQyxjQUFjLENBQUMsaUJBQWlCLENBQUMsQ0FBQztJQUNwRCxNQUFNLENBQUMsWUFBWSxDQUFDLFdBQVcsRUFDM0IsU0FBUyxZQUFZLEdBQUcsYUFBYSxpQkFBaUIsV0FBVyxDQUFDLFFBQVEsR0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FDMUYsQ0FBQztJQUNGLEVBQUUsQ0FBQyxjQUFjLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxZQUFZLENBQUMsR0FBRyxFQUFFLFdBQVcsQ0FBQyxHQUFHLEdBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztJQUVoRix5Q0FBeUM7SUFDekMsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNoRSxJQUFJLEdBQUcsR0FBRyxVQUFVLEdBQUcsR0FBRyxFQUFFO1FBQ3hCLE9BQU8sRUFBRSxDQUFDO0tBQ2I7SUFDRCxNQUFNLENBQUMsWUFBWSxDQUFDLGtCQUFrQixFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBRTdDLE1BQU0sY0FBYyxHQUFHLE9BQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUMsRUFBRSxDQUFBLENBQzdDLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQzVCLENBQUMsQ0FBQztJQUVILDRDQUE0QztJQUM1QyxPQUFNLE1BQU0sQ0FBQyxVQUFVLEVBQUU7UUFDckIsTUFBTSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUM7S0FDekM7SUFDRCxNQUFNLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBQ3BELE1BQU0sQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBQ2pELE1BQU0sQ0FBQyxXQUFXLENBQUMsbUJBQW1CLENBQUMsY0FBYyxFQUFFLGVBQWUsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBQzlFLDhFQUE4RTtJQUM5RSxNQUFNLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBRXBELE9BQU8sRUFBRSxDQUFDO0FBQ2QsQ0FBQztBQUdELFNBQVMsZ0JBQWdCLENBQUMsT0FBTyxHQUFDLEVBQUUsRUFBRSxHQUFHLEVBQUUsS0FBSyxHQUFDLENBQUM7SUFDOUMsaURBQWlEO0lBQ2pELHlCQUF5QjtJQUN6QixNQUFNLGVBQWUsR0FBRyxFQUFFLENBQUM7SUFDM0IsSUFBSSxZQUFZLEdBQUcsQ0FBQyxDQUFDO0lBQ3JCLEtBQUssTUFBTSxLQUFLLElBQUksT0FBTyxFQUFFO1FBQ3pCLEtBQUssTUFBTSxHQUFHLElBQUksS0FBSyxFQUFFO1lBQ3JCLElBQUksR0FBRyxDQUFDLElBQUksSUFBSSxNQUFNLElBQUksR0FBRyxDQUFDLGFBQWEsRUFBRTtnQkFDekMsMERBQTBEO2dCQUMxRCxZQUFZLElBQUksR0FBRyxDQUFDLFlBQVksQ0FBQztnQkFDakMsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsWUFBWSxDQUFDLENBQUMsQ0FBQzthQUMzRDtpQkFDSSxJQUFJLEdBQUcsQ0FBQyxJQUFJLElBQUksTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRTtnQkFDM0MsWUFBWSxJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDO2dCQUN2QyxlQUFlLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFDO2FBQ3JEO1NBQ0o7S0FDSjtJQUNELGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLEdBQUcsS0FBSyxFQUFFLFlBQVksQ0FBQyxDQUFDLENBQUM7SUFDbEQsNEVBQTRFO0lBQzVFLGlEQUFpRDtJQUNqRCxNQUFNLGFBQWEsR0FBRyxFQUFFLENBQUM7SUFDekIsSUFBSSxTQUFTLEdBQUcsQ0FBQyxDQUFDO0lBQ2xCLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNWLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxlQUFlLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO1FBQzdDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLEdBQUcsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3pDLE9BQU8sZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7WUFDekMsQ0FBQyxFQUFFLENBQUM7U0FDUDtRQUNELE1BQU0sTUFBTSxHQUFHLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDN0QsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO1FBQ25DLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxNQUFNLENBQUMsQ0FBQztLQUMzQztJQUNELElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxVQUFVLEdBQUcsQ0FBQyxlQUFlLEVBQUUsWUFBWSxFQUFFLGFBQWEsQ0FBQyxDQUFDO0lBQzNFLE1BQU0sUUFBUSxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDM0IsSUFBSSxRQUFRLENBQUM7SUFDYixJQUFJLFVBQVUsQ0FBQztJQUNmLEtBQUssTUFBTSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxhQUFhLEVBQUU7UUFDeEMsK0ZBQStGO1FBQy9GLElBQUksVUFBVSxFQUFFO1lBQ1osUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLFdBQVcsQ0FBQyxDQUFDLFFBQVEsR0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLEdBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxHQUFHLFVBQVUsR0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksV0FBVyxDQUFDLENBQUMsUUFBUSxHQUFHLENBQUMsR0FBQyxJQUFJLENBQUMsR0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLEdBQUcsTUFBTSxHQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsSUFBSSxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxHQUFHLE1BQU0sR0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1NBQ3RSO1FBQ0QsUUFBUSxHQUFHLElBQUksQ0FBQztRQUNoQixVQUFVLEdBQUcsTUFBTSxDQUFDO0tBQ3ZCO0lBQ0QsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLFdBQVcsQ0FBQyxHQUFHLEdBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUM5RCxPQUFPLEtBQUssQ0FBQyxNQUFNLEVBQUU7UUFDakIsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDO1FBQ3JCLGVBQWUsRUFBRSxvQkFBb0I7S0FDeEMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQztBQUVELFNBQVMsaUJBQWlCLENBQUMsT0FBTyxHQUFDLEVBQUUsRUFBRSxHQUFHO0lBQ3RDLE1BQU0sVUFBVSxHQUFHLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQztJQUNsRCxNQUFNLGNBQWMsR0FBRyxLQUFLLENBQ3hCLEdBQUcsRUFBRTtRQUNELEVBQUUsRUFBRSxnQkFBZ0I7UUFDcEIsU0FBUyxFQUFFLGVBQWUsYUFBYSxhQUFhLENBQUMsYUFBYSxHQUFHO1FBQ3JFLElBQUksRUFBRSxNQUFNLEdBQUMsWUFBWSxDQUFDLEtBQUs7UUFDL0IsV0FBVyxFQUFFLG9CQUFvQixRQUFRLEdBQUc7S0FDL0MsRUFBRTtRQUNDLFVBQVU7S0FDYixDQUNKLENBQUM7SUFDRixNQUFNLGVBQWUsR0FBRyxLQUFLLENBQ3pCLEdBQUcsRUFBRTtRQUNELEVBQUUsRUFBRSxpQkFBaUI7UUFDckIsU0FBUyxFQUFFLGVBQWUsYUFBYSxhQUFhLENBQUMsYUFBYSxHQUFHO1FBQ3JFLElBQUksRUFBRSxNQUFNO1FBQ1osTUFBTSxFQUFFLFlBQVksQ0FBQyxLQUFLO1FBQzFCLGNBQWMsRUFBRSxDQUFDO1FBQ2pCLGlCQUFpQixFQUFDLE9BQU87S0FDNUIsRUFBRTtRQUNDLFVBQVUsQ0FBQyxTQUFTLEVBQUU7S0FDekIsQ0FDSixDQUFDO0lBQ0YsTUFBTSxXQUFXLEdBQUcsS0FBSyxDQUNyQixHQUFHLEVBQUU7UUFDRCxFQUFFLEVBQUUsYUFBYTtRQUNqQixTQUFTLEVBQUUsZUFBZSxhQUFhLEdBQUcsYUFBYSxHQUFHO0tBQzdELEVBQUU7UUFDQyxjQUFjO1FBQ2QsZUFBZTtLQUNsQixDQUNKLENBQUM7SUFDRixPQUFPLFdBQVcsQ0FBQztBQUN2QixDQUFDO0FBRUQsU0FBUyxnQkFBZ0IsQ0FBQyxjQUFjLEdBQUMsRUFBRSxFQUFFLGVBQWUsR0FBQyxFQUFFLEVBQUUsR0FBRztJQUNoRSxNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsR0FBRyxFQUFFO1FBQzFCLEVBQUUsRUFBRSxZQUFZO1FBQ2hCLFNBQVMsRUFBRSxlQUFlLGFBQWEsR0FBRyxhQUFhLEdBQUc7S0FDN0QsQ0FBQyxDQUFDO0lBRUgsSUFBSSxlQUFlLENBQUMsTUFBTSxJQUFJLENBQUMsRUFBRTtRQUM3QixPQUFPLFVBQVUsQ0FBQztLQUNyQjtJQUNELElBQUksUUFBUSxHQUFHLENBQUMsQ0FBQztJQUNqQixJQUFJLFFBQVEsR0FBRyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDO0lBQzlDLE1BQU0sS0FBSyxHQUFHLENBQUMsR0FBQyxRQUFRLENBQUM7SUFDekIsUUFBUSxJQUFJLEdBQUcsQ0FBQTtJQUVmLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FDdkIsR0FBRyxFQUFFO1FBQ0QsRUFBRSxFQUFFLGVBQWU7UUFDbkIsU0FBUyxFQUFFLGVBQWUsYUFBYSxhQUFhLENBQUMsYUFBYSxHQUFHLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxHQUFHLEtBQUssR0FBRztRQUNyRyxJQUFJLEVBQUUsTUFBTSxHQUFDLFlBQVksQ0FBQyxLQUFLO1FBQy9CLHVCQUF1QjtRQUN2QixXQUFXLEVBQUUsb0JBQW9CLFFBQVEsR0FBRztLQUMvQyxFQUFFO1FBQ0Msa0JBQWtCLENBQUMsZ0JBQWdCLEVBQUUsZUFBZSxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsS0FBSyxDQUFDO0tBQzlFLENBQ0osQ0FBQztJQUNGLFVBQVUsQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUM7SUFFakMsTUFBTSxjQUFjLEdBQUcsS0FBSyxDQUN4QixHQUFHLEVBQUU7UUFDRCxFQUFFLEVBQUUsZ0JBQWdCO1FBQ3BCLFNBQVMsRUFBRSxlQUFlLGFBQWEsYUFBYSxDQUFDLGFBQWEsR0FBRyxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUMsR0FBRyxLQUFLLEdBQUc7UUFDckcsTUFBTSxFQUFFLFlBQVksQ0FBQyxLQUFLO1FBQzFCLElBQUksRUFBRSxNQUFNO1FBQ1osY0FBYyxFQUFFLENBQUM7UUFDakIsaUJBQWlCLEVBQUMsT0FBTztLQUM1QixFQUFFO1FBQ0Msb0JBQW9CLENBQUMsZ0JBQWdCLEVBQUUsY0FBYyxFQUFFLEdBQUcsRUFBRSxLQUFLLENBQUM7S0FDckUsQ0FDSixDQUFDO0lBQ0YsVUFBVSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQztJQUVsQyxPQUFPLFVBQVUsQ0FBQztBQUN0QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLypcblxuVXNhZ2U6IFxuXG4gICAgcnVuIGJhdGNoLXZpZXcuanMgLS1wb3J0IDEwXG5cbkFQSTogRGlzcGxheSBhY3Rpb24gdGltaW5nXG5cbiAgICBjb25zdCBtc2cgPSB7XG4gICAgICAgIHR5cGU6ICdhY3Rpb24nLFxuICAgICAgICBqb2JJRDogMSxcbiAgICAgICAgYWN0aW9uOiAnaGFjaycsXG4gICAgICAgIHN0YXJ0VGltZTogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgICAgIGR1cmF0aW9uOiBucy5nZXRIYWNrVGltZSh0YXJnZXQpLFxuICAgIH07XG4gICAgbnMudHJ5V3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeShtc2cpKTtcblxuQVBJOiBEaXNwbGF5IG9ic2VydmVkIHNlY3VyaXR5L21vbmV5IGxldmVsXG5cbiAgICBjb25zdCBtc2cgPSB7XG4gICAgICAgIHR5cGU6ICdvYnNlcnZlZCcsXG4gICAgICAgIHRpbWU6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgICAgICBtaW5EaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJNaW5TZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIGhhY2tEaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJTZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIG1vbmV5TWF4OiBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpLFxuICAgICAgICBtb25leUF2YWlsYWJsZTogbnMuZ2V0U2VydmVyTW9uZXlBdmFpbGFibGUodGFyZ2V0KSxcbiAgICB9O1xuICAgIG5zLnRyeVdyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkobXNnKSk7XG5cbkFQSTogRGlzcGxheSBleHBlY3RlZCBzZWN1cml0eS9tb25leSBsZXZlbCAodmFyaWVzIGJ5IGFjdGlvbiB0eXBlIGFuZCB5b3VyIHN0cmF0ZWd5KVxuXG4gICAgY29uc3QgbXNnID0ge1xuICAgICAgICB0eXBlOiAnZXhwZWN0ZWQnLFxuICAgICAgICB0aW1lOiBqb2Iuc3RhcnRUaW1lICsgam9iLmR1cmF0aW9uLFxuICAgICAgICBtaW5EaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJNaW5TZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIGhhY2tEaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJTZWN1cml0eUxldmVsKHRhcmdldCkgKyBucy5oYWNrQW5hbHl6ZVNlY3VyaXR5KGpvYi50aHJlYWRzKSxcbiAgICAgICAgbW9uZXlNYXg6IG5zLmdldFNlcnZlck1heE1vbmV5KHRhcmdldCksXG4gICAgICAgIG1vbmV5QXZhaWxhYmxlOiBNYXRoLm1heCgwLCBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpIC0gbnMuaGFja0FuYWx5emUodGFyZ2V0KSAqIGpvYi50aHJlYWRzICogbnMuaGFja0FuYWx5emVDaGFuY2UodGFyZ2V0KSksXG4gICAgfTtcbiAgICBucy50cnlXcml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KG1zZykpO1xuXG4qL1xuXG5pbXBvcnQgdHlwZSB7IE5TLCBOZXRzY3JpcHRQb3J0LCBTZXJ2ZXIgfSBmcm9tICdAbnMnO1xuaW1wb3J0IHR5cGUgUmVhY3ROYW1lc3BhY2UgZnJvbSAncmVhY3QvaW5kZXgnO1xuY29uc3QgUmVhY3QgPSBnbG9iYWxUaGlzLlJlYWN0IGFzIHR5cGVvZiBSZWFjdE5hbWVzcGFjZTtcblxuLy8gLS0tLS0gY29uc3RhbnRzIC0tLS0tIFxuXG50eXBlIFRpbWVNcyA9IFJldHVyblR5cGU8dHlwZW9mIHBlcmZvcm1hbmNlLm5vdz4gJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJtaWxsaXNlY29uZHNcIiB9O1xudHlwZSBUaW1lU2Vjb25kcyA9IG51bWJlciAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcInNlY29uZHNcIiB9O1xudHlwZSBUaW1lUGl4ZWxzID0gbnVtYmVyICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwicGl4ZWxzXCIgfTtcbnR5cGUgUGl4ZWxzID0gbnVtYmVyICYgeyBfX3VuaXRzOiBcInBpeGVsc1wiIH07XG5cbmxldCBpbml0VGltZSA9IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNcztcbi8qKlxuICogQ29udmVydCB0aW1lc3RhbXBzIHRvIHNlY29uZHMgc2luY2UgdGhlIGdyYXBoIHdhcyBzdGFydGVkLlxuICogVG8gcmVuZGVyIFNWR3MgdXNpbmcgbmF0aXZlIHRpbWUgdW5pdHMsIHRoZSB2YWx1ZXMgbXVzdCBiZSB2YWxpZCAzMi1iaXQgaW50cy5cbiAqIFNvIHdlIGNvbnZlcnQgdG8gYSByZWNlbnQgZXBvY2ggaW4gY2FzZSBEYXRlLm5vdygpIHZhbHVlcyBhcmUgdXNlZC5cbiAqL1xuZnVuY3Rpb24gY29udmVydFRpbWUodDogVGltZU1zLCB0MD1pbml0VGltZSk6IFRpbWVTZWNvbmRzIHtcbiAgICByZXR1cm4gKCh0IC0gdDApIC8gMTAwMCkgYXMgVGltZVNlY29uZHM7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRTZWNUb1B4KHQ6IFRpbWVTZWNvbmRzKTogVGltZVBpeGVscyB7XG4gICAgcmV0dXJuIHQgKiBXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTIGFzIFRpbWVQaXhlbHM7XG59XG5cbmNvbnN0IEdSQVBIX0NPTE9SUyA9IHtcbiAgICBcImhhY2tcIjogXCJjeWFuXCIsXG4gICAgXCJncm93XCI6IFwibGlnaHRncmVlblwiLFxuICAgIFwid2Vha2VuXCI6IFwieWVsbG93XCIsXG4gICAgXCJjYW5jZWxsZWRcIjogXCJyZWRcIixcbiAgICBcImRlc3luY1wiOiBcIm1hZ2VudGFcIixcbiAgICBcInNhZmVcIjogXCIjMTExXCIsXG4gICAgXCJ1bnNhZmVcIjogXCIjMzMzXCIsXG4gICAgXCJzZWN1cml0eVwiOiBcInJlZFwiLFxuICAgIFwibW9uZXlcIjogXCJibHVlXCJcbn07XG5cbmNvbnN0IFdJRFRIX1BJWEVMUyA9IDgwMCBhcyBUaW1lUGl4ZWxzO1xuY29uc3QgV0lEVEhfU0VDT05EUyA9IDE2IGFzIFRpbWVTZWNvbmRzO1xuY29uc3QgSEVJR0hUX1BJWEVMUyA9IDYwMCBhcyBQaXhlbHM7XG5jb25zdCBGT09URVJfUElYRUxTID0gNTAgYXMgUGl4ZWxzO1xuXG4vLyAtLS0tLSB0eXBlcyAtLS0tLVxuXG5cbmludGVyZmFjZSBKb2Ige1xuICAgIGpvYklEOiBzdHJpbmcgfCBudW1iZXI7XG4gICAgcm93SUQ6IG51bWJlcjtcbiAgICB0YXNrOiBcImhhY2tcIiB8IFwiZ3Jvd1wiIHwgXCJ3ZWFrZW5cIjtcbiAgICBkdXJhdGlvbjogVGltZU1zO1xuICAgIHN0YXJ0VGltZTogVGltZU1zO1xuICAgIHN0YXJ0VGltZUFjdHVhbDogVGltZU1zO1xuICAgIGVuZFRpbWU6IFRpbWVNcztcbiAgICBlbmRUaW1lQWN0dWFsOiBUaW1lTXM7XG4gICAgY2FuY2VsbGVkOiBib29sZWFuO1xuICAgIHNlcnZlckJlZm9yZTogU2VydmVySW5mbztcbiAgICBzZXJ2ZXJBZnRlcjogU2VydmVySW5mbztcbiAgICByZXN1bHRBY3R1YWw6IG51bWJlcjtcbiAgICBjaGFuZ2U6IHtcbiAgICAgICAgcGxheWVyTW9uZXk6IG51bWJlcjtcbiAgICB9O1xufVxuXG5pbnRlcmZhY2UgU2VydmVySW5mbyB7XG4gICAgbW9uZXlBdmFpbGFibGU6IG51bWJlcjtcbiAgICBtb25leU1heDogbnVtYmVyO1xuICAgIGhhY2tEaWZmaWN1bHR5OiBudW1iZXI7XG4gICAgbWluRGlmZmljdWx0eTogbnVtYmVyO1xufVxuXG50eXBlIFNlcnZlclNuYXBzaG90ID0gW1RpbWVNcywgU2VydmVySW5mb107XG5cbi8vIC0tLS0tIG1haW4gLS0tLS1cblxuY29uc3QgRkxBR1M6IFtzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBzdHJpbmdbXV1bXSA9IFtcbiAgICBbXCJoZWxwXCIsIGZhbHNlXSxcbiAgICBbXCJwb3J0XCIsIDBdXG5dO1xuXG5leHBvcnQgZnVuY3Rpb24gYXV0b2NvbXBsZXRlKGRhdGE6IGFueSwgYXJnczogc3RyaW5nW10pIHtcbiAgICBkYXRhLmZsYWdzKEZMQUdTKTtcbiAgICByZXR1cm4gW107XG59XG5cbi8qKiBAcGFyYW0ge05TfSBucyAqKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYWluKG5zOiBOUykge1xuICAgIG5zLmRpc2FibGVMb2coJ3NsZWVwJyk7XG4gICAgbnMuY2xlYXJMb2coKTtcbiAgICBucy50YWlsKCk7XG4gICAgbnMucmVzaXplVGFpbCg4MTAsIDY0MCk7XG5cbiAgICBjb25zdCBmbGFncyA9IG5zLmZsYWdzKEZMQUdTKTtcbiAgICBpZiAoZmxhZ3MuaGVscCkge1xuICAgICAgICBucy50cHJpbnQoW1xuICAgICAgICAgICAgYFVTQUdFYCxcbiAgICAgICAgICAgIGA+IHJ1biAke25zLmdldFNjcmlwdE5hbWUoKX0gLS1wb3J0IDFgLFxuICAgICAgICAgICAgJyAnXG4gICAgICAgIF0uam9pbihcIlxcblwiKSk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwb3J0TnVtID0gZmxhZ3MucG9ydCBhcyBudW1iZXIgfHwgbnMucGlkO1xuICAgIGNvbnN0IHBvcnQgPSBucy5nZXRQb3J0SGFuZGxlKHBvcnROdW0pO1xuICAgIC8vIHBvcnQuY2xlYXIoKTtcbiAgICBucy5wcmludChgTGlzdGVuaW5nIG9uIFBvcnQgJHtwb3J0TnVtfWApO1xuXG4gICAgY29uc3QgYmF0Y2hWaWV3ID0gPEJhdGNoVmlldyBucz17bnN9IHBvcnROdW09e3BvcnROdW19IC8+O1xuICAgIG5zLnByaW50UmF3KGJhdGNoVmlldyk7XG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBhd2FpdCBwb3J0Lm5leHRXcml0ZSgpO1xuICAgIH1cbn1cblxuLy8gLS0tLS0gQmF0Y2hWaWV3IC0tLS0tXG5cbmludGVyZmFjZSBCYXRjaFZpZXdQcm9wcyB7XG4gICAgbnM6IE5TO1xuICAgIHBvcnROdW06IG51bWJlcjtcbn1cbmludGVyZmFjZSBCYXRjaFZpZXdTdGF0ZSB7XG4gICAgcnVubmluZzogYm9vbGVhbjtcbiAgICBub3c6IFRpbWVNcztcbn1cbmV4cG9ydCBjbGFzcyBCYXRjaFZpZXcgZXh0ZW5kcyBSZWFjdC5Db21wb25lbnQ8QmF0Y2hWaWV3UHJvcHMsIEJhdGNoVmlld1N0YXRlPiB7XG4gICAgcG9ydDogTmV0c2NyaXB0UG9ydDtcbiAgICBqb2JzOiBNYXA8c3RyaW5nIHwgbnVtYmVyLCBKb2I+O1xuICAgIG5Sb3dzOiBudW1iZXI7XG5cbiAgICBjb25zdHJ1Y3Rvcihwcm9wczogQmF0Y2hWaWV3UHJvcHMpe1xuICAgICAgICBzdXBlcihwcm9wcyk7XG4gICAgICAgIGNvbnN0IHsgbnMsIHBvcnROdW0gfSA9IHByb3BzO1xuICAgICAgICB0aGlzLnN0YXRlID0ge1xuICAgICAgICAgICAgcnVubmluZzogdHJ1ZSxcbiAgICAgICAgICAgIG5vdzogcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMucG9ydCA9IG5zLmdldFBvcnRIYW5kbGUocG9ydE51bSk7XG4gICAgICAgIHRoaXMuam9icyA9IG5ldyBNYXAoKTtcbiAgICAgICAgdGhpcy5uUm93cyA9IDA7XG4gICAgfVxuXG4gICAgY29tcG9uZW50RGlkTW91bnQoKSB7XG4gICAgICAgIGNvbnN0IHsgbnMgfSA9IHRoaXMucHJvcHM7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IHRydWV9KTtcbiAgICAgICAgbnMuYXRFeGl0KCgpPT57XG4gICAgICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiBmYWxzZX0pO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5yZWFkUG9ydCgpO1xuICAgICAgICB0aGlzLmFuaW1hdGUoKTtcbiAgICAgICAgLy8gT2JqZWN0LmFzc2lnbihnbG9iYWxUaGlzLCB7YmF0Y2hWaWV3OiB0aGlzfSk7XG4gICAgfVxuXG4gICAgY29tcG9uZW50V2lsbFVubW91bnQoKSB7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IGZhbHNlfSk7XG4gICAgfVxuXG4gICAgYWRkSm9iKGpvYjogSm9iKSB7XG4gICAgICAgIGlmIChqb2Iuam9iSUQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgd2hpbGUgKHRoaXMuam9icy5oYXModGhpcy5uUm93cykpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm5Sb3dzICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBqb2Iuam9iSUQgPSB0aGlzLm5Sb3dzO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmpvYnMuaGFzKGpvYi5qb2JJRCkpIHtcbiAgICAgICAgICAgIGpvYiA9IE9iamVjdC5hc3NpZ24odGhpcy5qb2JzLmdldChqb2Iuam9iSUQpIGFzIEpvYiwgam9iKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGpvYi5yb3dJRCA9IHRoaXMublJvd3M7XG4gICAgICAgICAgICB0aGlzLm5Sb3dzICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5qb2JzLnNldChqb2Iuam9iSUQsIGpvYik7XG4gICAgICAgIHRoaXMuY2xlYW5Kb2JzKCk7XG4gICAgfVxuXG4gICAgY2xlYW5Kb2JzKCkge1xuICAgICAgICAvLyBmaWx0ZXIgb3V0IGpvYnMgd2l0aCBlbmR0aW1lIGluIHBhc3RcbiAgICAgICAgaWYgKHRoaXMuam9icy5zaXplID4gMjAwKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGpvYklEIG9mIHRoaXMuam9icy5rZXlzKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBqb2IgPSB0aGlzLmpvYnMuZ2V0KGpvYklEKSBhcyBKb2I7XG4gICAgICAgICAgICAgICAgaWYgKChqb2IuZW5kVGltZUFjdHVhbCA/PyBqb2IuZW5kVGltZSkgPCB0aGlzLnN0YXRlLm5vdy0oV0lEVEhfU0VDT05EUyoyKjEwMDApKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuam9icy5kZWxldGUoam9iSUQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJlYWRQb3J0ID0gKCk9PntcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlLnJ1bm5pbmcpIHJldHVybjtcbiAgICAgICAgd2hpbGUoIXRoaXMucG9ydC5lbXB0eSgpKSB7XG4gICAgICAgICAgICBjb25zdCBqb2IgPSBKU09OLnBhcnNlKHRoaXMucG9ydC5yZWFkKCkgYXMgc3RyaW5nKTtcbiAgICAgICAgICAgIHRoaXMuYWRkSm9iKGpvYik7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5wb3J0Lm5leHRXcml0ZSgpLnRoZW4odGhpcy5yZWFkUG9ydCk7XG4gICAgfVxuXG4gICAgYW5pbWF0ZSA9ICgpPT57XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5ydW5uaW5nKSByZXR1cm47XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe25vdzogcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zfSk7XG4gICAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGUpO1xuICAgIH1cblxuICAgIHJlbmRlcigpIHtcbiAgICAgICAgY29uc3QgZGlzcGxheUpvYnMgPSBbLi4udGhpcy5qb2JzLnZhbHVlcygpXVxuICAgICAgICBjb25zdCBzZXJ2ZXJQcmVkaWN0aW9ucyA9IGRpc3BsYXlKb2JzLm1hcCgoam9iKT0+KFxuICAgICAgICAgICAgW2pvYi5lbmRUaW1lIGFzIFRpbWVNcywgam9iLnNlcnZlckFmdGVyIGFzIFNlcnZlcl0gYXMgU2VydmVyU25hcHNob3RcbiAgICAgICAgKSkuZmlsdGVyKChbdCwgc10pPT4hIXMpLnNvcnQoKGEsYik9PmFbMF0tYlswXSk7XG4gICAgICAgIC8vIFRPRE86IGNyZWF0ZSBleGFtcGxlIG9mIHVzZXIgcHJvdmlkaW5nIGFjdHVhbCBbdGltZSwgc2VydmVyXSBvYnNlcnZhdGlvbnNcbiAgICAgICAgY29uc3Qgc2VydmVyT2JzZXJ2YXRpb25zID0gZGlzcGxheUpvYnMubWFwKChqb2IpPT4oXG4gICAgICAgICAgICBbam9iLnN0YXJ0VGltZSBhcyBUaW1lTXMsIGpvYi5zZXJ2ZXJCZWZvcmUgYXMgU2VydmVyXSBhcyBTZXJ2ZXJTbmFwc2hvdFxuICAgICAgICApKS5maWx0ZXIoKFt0LCBzXSk9PiEhcykuc29ydCgoYSxiKT0+YVswXS1iWzBdKTtcbiAgICBcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIDxHcmFwaEZyYW1lIG5vdz17dGhpcy5zdGF0ZS5ub3d9PlxuICAgICAgICAgICAgICAgIDxTYWZldHlMYXllciBzZXJ2ZXJQcmVkaWN0aW9ucz17c2VydmVyUHJlZGljdGlvbnN9IC8+XG4gICAgICAgICAgICAgICAgPEpvYkxheWVyIGpvYnM9e2Rpc3BsYXlKb2JzfSAvPlxuICAgICAgICAgICAgICAgIDxTZWN1cml0eUxheWVyIHNlcnZlclByZWRpY3Rpb25zPXtzZXJ2ZXJQcmVkaWN0aW9uc30gc2VydmVyT2JzZXJ2YXRpb25zPXtzZXJ2ZXJPYnNlcnZhdGlvbnN9IC8+XG4gICAgICAgICAgICAgICAgPE1vbmV5TGF5ZXIgam9icz17ZGlzcGxheUpvYnN9IC8+XG4gICAgICAgICAgICA8L0dyYXBoRnJhbWU+XG4gICAgICAgIClcbiAgICB9XG59XG5cbmZ1bmN0aW9uIEdyYXBoRnJhbWUoe25vdywgY2hpbGRyZW59Ontub3c6VGltZU1zLCBjaGlsZHJlbjogUmVhY3QuUmVhY3ROb2RlfSk6IFJlYWN0LlJlYWN0RWxlbWVudCB7XG4gICAgLy8gVE9ETzogaW5pdFRpbWUgaXMgdXNlZCBhcyB1bmlxdWUgRE9NIElEIGFuZCBhcyByZW5kZXJpbmcgb3JpZ2luIGJ1dCBpdCBpcyBwb29ybHkgc3VpdGVkIGZvciBib3RoXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHN2ZyB2ZXJzaW9uPVwiMS4xXCIgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiXG4gICAgICAgICAgICB3aWR0aD17V0lEVEhfUElYRUxTfVxuICAgICAgICAgICAgaGVpZ2h0PXtIRUlHSFRfUElYRUxTfSBcbiAgICAgICAgICAgIC8vIFNldCB0aGUgdmlld0JveCBmb3IgMTAgc2Vjb25kcyBvZiBoaXN0b3J5LCA2IHNlY29uZHMgb2YgZnV0dXJlLlxuICAgICAgICAgICAgdmlld0JveD17YCR7Y29udmVydFNlY1RvUHgoLTEwIGFzIFRpbWVTZWNvbmRzKX0gMCAke1dJRFRIX1BJWEVMU30gJHtIRUlHSFRfUElYRUxTfWB9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxkZWZzPlxuICAgICAgICAgICAgICAgIDxjbGlwUGF0aCBpZD17YGhpZGUtZnV0dXJlLSR7aW5pdFRpbWV9YH0gY2xpcFBhdGhVbml0cz1cInVzZXJTcGFjZU9uVXNlXCI+XG4gICAgICAgICAgICAgICAgICAgIDxyZWN0IGlkPVwiaGlkZS1mdXR1cmUtcmVjdFwiXG4gICAgICAgICAgICAgICAgICAgICAgICB4PXtjb252ZXJ0VGltZShub3ctNjAwMDAgYXMgVGltZU1zKX0gd2lkdGg9e2NvbnZlcnRUaW1lKDYwMDAwIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXs1MH1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2NsaXBQYXRoPlxuICAgICAgICAgICAgPC9kZWZzPlxuICAgICAgICAgICAgPHJlY3QgaWQ9XCJiYWNrZ3JvdW5kXCIgeD17Y29udmVydFNlY1RvUHgoLTEwIGFzIFRpbWVTZWNvbmRzKX0gd2lkdGg9XCIxMDAlXCIgaGVpZ2h0PVwiMTAwJVwiIGZpbGw9e0dSQVBIX0NPTE9SUy5zYWZlfSAvPlxuICAgICAgICAgICAgPGcgaWQ9XCJ0aW1lQ29vcmRpbmF0ZXNcIiB0cmFuc2Zvcm09e2BzY2FsZSgke1dJRFRIX1BJWEVMUyAvIFdJRFRIX1NFQ09ORFN9IDEpIHRyYW5zbGF0ZSgke2NvbnZlcnRUaW1lKGluaXRUaW1lLW5vdyBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX0gMClgfT5cbiAgICAgICAgICAgICAgICB7Y2hpbGRyZW59XG4gICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTFcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLUZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMlwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtMipGT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICA8cmVjdCBpZD1cImN1cnNvclwiIHg9ezB9IHdpZHRoPXsxfSB5PXswfSBoZWlnaHQ9XCIxMDAlXCIgZmlsbD1cIndoaXRlXCIgLz5cbiAgICAgICAgICAgIDxHcmFwaExlZ2VuZCAvPlxuICAgICAgICA8L3N2Zz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBHcmFwaExlZ2VuZCgpOiBSZWFjdC5SZWFjdEVsZW1lbnQge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwiTGVnZW5kXCIgdHJhbnNmb3JtPVwidHJhbnNsYXRlKC00OTAsIDEwKSwgc2NhbGUoLjUsIC41KVwiPlxuICAgICAgICAgICAgPHJlY3QgeD17MX0geT17MX0gd2lkdGg9ezI3NX0gaGVpZ2h0PXszOTJ9IGZpbGw9XCJibGFja1wiIHN0cm9rZT1cIiM5Nzk3OTdcIiAvPlxuICAgICAgICAgICAge09iamVjdC5lbnRyaWVzKEdSQVBIX0NPTE9SUykubWFwKChbbGFiZWwsIGNvbG9yXSwgaSk9PihcbiAgICAgICAgICAgICAgICA8ZyBrZXk9e2xhYmVsfSB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMjIsICR7MTMgKyA0MSppfSlgfT5cbiAgICAgICAgICAgICAgICAgICAgPHJlY3QgeD17MH0geT17MH0gd2lkdGg9ezIyfSBoZWlnaHQ9ezIyfSBmaWxsPXtjb2xvcn0gLz5cbiAgICAgICAgICAgICAgICAgICAgPHRleHQgZm9udEZhbWlseT1cIkNvdXJpZXIgTmV3XCIgZm9udFNpemU9ezM2fSBmaWxsPVwiIzg4OFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRzcGFuIHg9ezQyLjV9IHk9ezMwfT57bGFiZWwuc3Vic3RyaW5nKDAsMSkudG9VcHBlckNhc2UoKStsYWJlbC5zdWJzdHJpbmcoMSl9PC90c3Bhbj5cbiAgICAgICAgICAgICAgICAgICAgPC90ZXh0PlxuICAgICAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgICkpfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gU2FmZXR5TGF5ZXIoe3NlcnZlclByZWRpY3Rpb25zfToge3NlcnZlclByZWRpY3Rpb25zOiBTZXJ2ZXJTbmFwc2hvdFtdfSk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgbGV0IHByZXZUaW1lOiBUaW1lTXMgfCB1bmRlZmluZWQ7XG4gICAgbGV0IHByZXZTZXJ2ZXI6IFNlcnZlckluZm8gfCB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJzYWZldHlMYXllclwiPlxuICAgICAgICAgICAge3NlcnZlclByZWRpY3Rpb25zLm1hcCgoW3RpbWUsIHNlcnZlcl0sIGkpPT57XG4gICAgICAgICAgICAgICAgbGV0IGVsID0gbnVsbDtcbiAgICAgICAgICAgICAgICAvLyBzaGFkZSB0aGUgYmFja2dyb3VuZCBiYXNlZCBvbiBzZWNMZXZlbFxuICAgICAgICAgICAgICAgIGlmIChwcmV2VGltZSAmJiB0aW1lID4gcHJldlRpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgZWwgPSAoPHJlY3Qga2V5PXtpfVxuICAgICAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUocHJldlRpbWUpfSB3aWR0aD17Y29udmVydFRpbWUodGltZSAtIHByZXZUaW1lLCAwKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD1cIjEwMCVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsbD17KHByZXZTZXJ2ZXIuaGFja0RpZmZpY3VsdHkgPiBwcmV2U2VydmVyLm1pbkRpZmZpY3VsdHkpID8gR1JBUEhfQ09MT1JTLnVuc2FmZSA6IEdSQVBIX0NPTE9SUy5zYWZlfVxuICAgICAgICAgICAgICAgICAgICAvPik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHByZXZUaW1lID0gdGltZTtcbiAgICAgICAgICAgICAgICBwcmV2U2VydmVyID0gc2VydmVyO1xuICAgICAgICAgICAgICAgIHJldHVybiBlbDtcbiAgICAgICAgICAgIH0pfVxuICAgICAgICAgICAge3ByZXZTZXJ2ZXIgJiYgKFxuICAgICAgICAgICAgICAgIDxyZWN0IGtleT1cInJlbWFpbmRlclwiXG4gICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHByZXZUaW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKDEwMDAwLCAwKX1cbiAgICAgICAgICAgICAgICAgICAgeT17MH0gaGVpZ2h0PVwiMTAwJVwiXG4gICAgICAgICAgICAgICAgICAgIGZpbGw9eyhwcmV2U2VydmVyLmhhY2tEaWZmaWN1bHR5ID4gcHJldlNlcnZlci5taW5EaWZmaWN1bHR5KSA/IEdSQVBIX0NPTE9SUy51bnNhZmUgOiBHUkFQSF9DT0xPUlMuc2FmZX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEpvYkxheWVyKHtqb2JzfToge2pvYnM6IEpvYltdfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwiam9iTGF5ZXJcIj5cbiAgICAgICAgICAgIHtqb2JzLm1hcCgoam9iOiBKb2IpPT4oPEpvYkJhciBqb2I9e2pvYn0ga2V5PXtqb2Iuam9iSUR9IC8+KSl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBKb2JCYXIoe2pvYn06IHtqb2I6IEpvYn0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGNvbnN0IHkgPSAoKGpvYi5yb3dJRCArIDEpICUgKChIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMUyoyKSAvIDQpKSAqIDQ7XG4gICAgbGV0IGpvYkJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5zdGFydFRpbWUgJiYgam9iLmR1cmF0aW9uKSB7XG4gICAgICAgIGpvYkJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUoam9iLnN0YXJ0VGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZShqb2IuZHVyYXRpb24sIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17Mn1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SU1tqb2IuY2FuY2VsbGVkID8gJ2NhbmNlbGxlZCcgOiBqb2IudGFza119XG4gICAgICAgIC8+KVxuICAgIH07XG4gICAgbGV0IHN0YXJ0RXJyb3JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5zdGFydFRpbWUsIGpvYi5zdGFydFRpbWVBY3R1YWxdLnNvcnQoKGEsYik9PmEtYik7XG4gICAgICAgIHN0YXJ0RXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgZmlsbD17R1JBUEhfQ09MT1JTLmRlc3luY31cbiAgICAgICAgIC8+KTtcbiAgICB9XG4gICAgbGV0IGVuZEVycm9yQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLmVuZFRpbWVBY3R1YWwpIHtcbiAgICAgICAgY29uc3QgW3QxLCB0Ml0gPSBbam9iLmVuZFRpbWUsIGpvYi5lbmRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICBlbmRFcnJvckJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUodDEpfSB3aWR0aD17Y29udmVydFRpbWUodDItdDEgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBmaWxsPXtHUkFQSF9DT0xPUlMuZGVzeW5jfVxuICAgICAgICAgLz4pO1xuICAgIH1cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke3l9KWB9PlxuICAgICAgICAgICAge2pvYkJhcn1cbiAgICAgICAgICAgIHtzdGFydEVycm9yQmFyfVxuICAgICAgICAgICAge2VuZEVycm9yQmFyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuaW50ZXJmYWNlIFNlY3VyaXR5TGF5ZXJQcm9wcyB7XG4gICAgc2VydmVyUHJlZGljdGlvbnM/OiBTZXJ2ZXJTbmFwc2hvdFtdO1xuICAgIHNlcnZlck9ic2VydmF0aW9ucz86IFNlcnZlclNuYXBzaG90W11cbn1cbmZ1bmN0aW9uIFNlY3VyaXR5TGF5ZXIoe3NlcnZlclByZWRpY3Rpb25zLCBzZXJ2ZXJPYnNlcnZhdGlvbnN9OlNlY3VyaXR5TGF5ZXJQcm9wcyk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgc2VydmVyUHJlZGljdGlvbnMgPz89IFtdO1xuICAgIHNlcnZlck9ic2VydmF0aW9ucyA/Pz0gW107XG4gICAgbGV0IG1pblNlYyA9IDA7XG4gICAgbGV0IG1heFNlYyA9IDE7XG4gICAgZm9yIChjb25zdCBzbmFwc2hvdHMgb2YgW3NlcnZlclByZWRpY3Rpb25zLCBzZXJ2ZXJPYnNlcnZhdGlvbnNdKSB7XG4gICAgICAgIGZvciAoY29uc3QgW3RpbWUsIHNlcnZlcl0gb2Ygc25hcHNob3RzKSB7XG4gICAgICAgICAgICBtaW5TZWMgPSBNYXRoLm1pbihtaW5TZWMsIHNlcnZlci5oYWNrRGlmZmljdWx0eSk7XG4gICAgICAgICAgICBtYXhTZWMgPSBNYXRoLm1heChtYXhTZWMsIHNlcnZlci5oYWNrRGlmZmljdWx0eSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBvYnNlcnZlZFBhdGggPSBjb21wdXRlUGF0aERhdGEoXCJoYWNrRGlmZmljdWx0eVwiLCBzZXJ2ZXJPYnNlcnZhdGlvbnMsIG1pblNlYywgdHJ1ZSk7XG4gICAgY29uc3Qgb2JzZXJ2ZWRMYXllciA9IChcbiAgICAgICAgPGcgaWQ9XCJvYnNlcnZlZFNlY1wiXG4gICAgICAgICAgICB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4U2VjIC0gbWluU2VjKX0pYH1cbiAgICAgICAgICAgIGZpbGw9e1wiZGFya1wiK0dSQVBIX0NPTE9SUy5zZWN1cml0eX1cbiAgICAgICAgICAgIC8vIFwiZmlsbC1vcGFjaXR5XCI6IDAuNSxcbiAgICAgICAgICAgIGNsaXBQYXRoPXtgdXJsKCNoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfSlgfVxuICAgICAgICA+XG4gICAgICAgICAgICA8cGF0aCBkPXtvYnNlcnZlZFBhdGguam9pbihcIiBcIil9IC8+XG4gICAgICAgIDwvZz5cbiAgICApO1xuXG4gICAgY29uc3QgcHJlZGljdGVkUGF0aCA9IGNvbXB1dGVQYXRoRGF0YShcImhhY2tEaWZmaWN1bHR5XCIsIHNlcnZlclByZWRpY3Rpb25zKTtcbiAgICBjb25zdCBwcmVkaWN0ZWRMYXllciA9IChcbiAgICAgICAgPGcgaWQ9XCJwcmVkaWN0ZWRTZWNcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heFNlYyAtIG1pblNlYyl9KWB9XG4gICAgICAgICAgICBzdHJva2U9e0dSQVBIX0NPTE9SUy5zZWN1cml0eX1cbiAgICAgICAgICAgIGZpbGw9XCJub25lXCJcbiAgICAgICAgICAgIHN0cm9rZVdpZHRoPXsyfVxuICAgICAgICAgICAgc3Ryb2tlTGluZWpvaW49XCJiZXZlbFwiXG4gICAgICAgID5cbiAgICAgICAgICAgIDxwYXRoIGQ9e3ByZWRpY3RlZFBhdGguam9pbihcIiBcIil9IHZlY3RvckVmZmVjdD1cIm5vbi1zY2FsaW5nLXN0cm9rZVwiIC8+XG4gICAgICAgIDwvZz5cbiAgICApO1xuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJzZWNMYXllclwiIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7SEVJR0hUX1BJWEVMUyAtIDIqRk9PVEVSX1BJWEVMU30pYH0+XG4gICAgICAgICAgICB7b2JzZXJ2ZWRMYXllcn1cbiAgICAgICAgICAgIHtwcmVkaWN0ZWRMYXllcn1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIGNvbXB1dGVQYXRoRGF0YShmaWVsZDprZXlvZihTZXJ2ZXJJbmZvKT1cImhhY2tEaWZmaWN1bHR5XCIsIHNlcnZlclNuYXBzaG90czpTZXJ2ZXJTbmFwc2hvdFtdPVtdLCBtaW5WYWx1ZT0wLCBzaG91bGRDbG9zZT1mYWxzZSwgc2NhbGU9MSkge1xuICAgIGNvbnN0IHBhdGhEYXRhID0gW107XG4gICAgbGV0IHByZXZUaW1lOiBUaW1lTXMgfCB1bmRlZmluZWQ7XG4gICAgbGV0IHByZXZTZXJ2ZXI6IFNlcnZlckluZm8gfCB1bmRlZmluZWQ7XG4gICAgZm9yIChjb25zdCBbdGltZSwgc2VydmVyXSBvZiBzZXJ2ZXJTbmFwc2hvdHMpIHtcbiAgICAgICAgaWYgKCFwcmV2U2VydmVyKSB7XG4gICAgICAgICAgICAvLyBzdGFydCBsaW5lIGF0IGZpcnN0IHByb2plY3RlZCB0aW1lIGFuZCB2YWx1ZVxuICAgICAgICAgICAgcGF0aERhdGEucHVzaChgTSAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHNlcnZlcltmaWVsZF0qc2NhbGUpLnRvRml4ZWQoMil9YCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHByZXZTZXJ2ZXIpIHtcbiAgICAgICAgICAgIC8vIHZlcnRpY2FsIGxpbmUgdG8gcHJldmlvdXMgbGV2ZWxcbiAgICAgICAgICAgIC8vIGhvcml6b250YWwgbGluZSB0byBjdXJyZW50IHRpbWVcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYFYgJHsocHJldlNlcnZlcltmaWVsZF0qc2NhbGUpLnRvRml4ZWQoMil9YCwgYEggJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfWApO1xuICAgICAgICB9XG4gICAgICAgIHByZXZTZXJ2ZXIgPSBzZXJ2ZXI7XG4gICAgICAgIHByZXZUaW1lID0gdGltZTtcbiAgICB9XG4gICAgLy8gZmlsbCBpbiBhcmVhIGJldHdlZW4gbGFzdCBzbmFwc2hvdCBhbmQgXCJub3dcIiBjdXJzb3JcbiAgICBpZiAocHJldlNlcnZlcikge1xuICAgICAgICAvLyB2ZXJ0aWNhbCBsaW5lIHRvIHByZXZpb3VzIGxldmVsXG4gICAgICAgIC8vIGhvcml6b250YWwgbGluZSB0byBjdXJyZW50IHRpbWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyhwcmV2U2VydmVyW2ZpZWxkXSpzY2FsZSkudG9GaXhlZCgyKX1gLCBgSCAke2NvbnZlcnRUaW1lKHByZXZUaW1lICsgNjAwMDAwKS50b0ZpeGVkKDMpfWApO1xuICAgICAgICBpZiAoc2hvdWxkQ2xvc2UpIHtcbiAgICAgICAgICAgIC8vIGZpbGwgYXJlYSB1bmRlciBhY3R1YWwgc2VjdXJpdHlcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYFYgJHsobWluVmFsdWUqc2NhbGUpLnRvRml4ZWQoMil9YCk7XG4gICAgICAgICAgICBjb25zdCBtaW5UaW1lID0gc2VydmVyU25hcHNob3RzWzBdWzBdO1xuICAgICAgICAgICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKG1pblRpbWUpLnRvRml4ZWQoMyl9YCk7XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKCdaJyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHBhdGhEYXRhO1xufVxuXG5mdW5jdGlvbiBNb25leUxheWVyKHtqb2JzfToge2pvYnM6IEpvYltdfSk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgcmV0dXJuIDxnIGlkPVwibW9uZXlMYXllclwiIC8+XG59XG5cbi8vIC0tLS0tIHByZS1SZWFjdCB2ZXJzaW9uIC0tLS0tXG5cbi8qKlxuICogcmVuZGVyQmF0Y2hlcyAtIGNyZWF0ZSBhbiBTVkcgZWxlbWVudCB3aXRoIGEgZ3JhcGggb2Ygam9ic1xuICogQHBhcmFtIHtTVkdTVkdFbGVtZW50fSBbZWxdIC0gU1ZHIGVsZW1lbnQgdG8gcmV1c2UuIFdpbGwgYmUgY3JlYXRlZCBpZiBpdCBkb2VzIG5vdCBleGlzdCB5ZXQuXG4gKiBAcGFyYW0ge0pvYltdW119IGJhdGNoZXMgLSBhcnJheSBvZiBhcnJheXMgb2Ygam9ic1xuICogQHBhcmFtIHtudW1iZXJ9IFtub3ddIC0gY3VycmVudCB0aW1lIChvcHRpb25hbClcbiAqIEByZXR1cm5zIHtTVkdTVkdFbGVtZW50fVxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQmF0Y2hlcyhlbDogSFRNTEVsZW1lbnQsIGJhdGNoZXM9W10sIHNlcnZlclNuYXBzaG90cz1bXSwgbm93OiBUaW1lTXMpIHtcbiAgICBub3cgfHw9IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNcztcblxuICAgIC8vIFJlbmRlciB0aGUgbWFpbiBTVkcgZWxlbWVudCBpZiBuZWVkZWRcbiAgICBlbCB8fD0gc3ZnRWwoXG4gICAgICAgIFwic3ZnXCIsXG4gICAgICAgIHtcbiAgICAgICAgICAgIHZlcnNpb246IFwiMS4xXCIsIHdpZHRoOldJRFRIX1BJWEVMUywgaGVpZ2h0OiBIRUlHSFRfUElYRUxTLFxuICAgICAgICAgICAgLy8gU2V0IHRoZSB2aWV3Qm94IGZvciAxMCBzZWNvbmRzIG9mIGhpc3RvcnksIDYgc2Vjb25kcyBvZiBmdXR1cmUuXG4gICAgICAgICAgICB2aWV3Qm94OiBgJHtjb252ZXJ0U2VjVG9QeCgtMTApfSAwICR7V0lEVEhfUElYRUxTfSAke0hFSUdIVF9QSVhFTFN9YFxuICAgICAgICB9LFxuICAgICAgICBbXG4gICAgICAgICAgICBbXCJkZWZzXCIsIHt9LCBbXG4gICAgICAgICAgICAgICAgW1wiY2xpcFBhdGhcIiwge2lkOmBoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfWAsIGNsaXBQYXRoVW5pdHM6IFwidXNlclNwYWNlT25Vc2VcIn0sIFtcbiAgICAgICAgICAgICAgICAgICAgW1wicmVjdFwiLCB7aWQ6XCJoaWRlLWZ1dHVyZS1yZWN0XCIsIHg6Y29udmVydFRpbWUobm93LTYwMDAwKSwgd2lkdGg6Y29udmVydFRpbWUoNjAwMDAsMCksIHk6MCwgaGVpZ2h0OiA1MH1dXG4gICAgICAgICAgICAgICAgXV1cbiAgICAgICAgICAgIF1dLFxuICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJiYWNrZ3JvdW5kXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIGhlaWdodDpcIjEwMCVcIiwgZmlsbDpHUkFQSF9DT0xPUlMuc2FmZX1dLFxuICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJ0aW1lQ29vcmRpbmF0ZXNcIn0sIFtcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcInNhZmV0eUxheWVyXCJ9XSxcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcImpvYkxheWVyXCJ9XSxcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcInNlY0xheWVyXCJ9XSxcbiAgICAgICAgICAgICAgICBbXCJnXCIsIHtpZDpcIm1vbmV5TGF5ZXJcIn1dXG4gICAgICAgICAgICBdXSxcbiAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0xXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy1GT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMlwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtMipGT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICBbXCJyZWN0XCIsIHtpZDpcImN1cnNvclwiLCB4OjAsIHdpZHRoOjEsIHk6MCwgaGVpZ2h0OiBcIjEwMCVcIiwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICByZW5kZXJMZWdlbmQoKVxuICAgICAgICBdXG4gICAgKTtcblxuICAgIC8vIFVwZGF0ZSB0aGUgdGltZSBjb29yZGluYXRlcyBldmVyeSBmcmFtZVxuICAgIGNvbnN0IGRhdGFFbCA9IGVsLmdldEVsZW1lbnRCeUlkKFwidGltZUNvb3JkaW5hdGVzXCIpO1xuICAgIGRhdGFFbC5zZXRBdHRyaWJ1dGUoJ3RyYW5zZm9ybScsXG4gICAgICAgIGBzY2FsZSgke1dJRFRIX1BJWEVMUyAvIFdJRFRIX1NFQ09ORFN9IDEpIHRyYW5zbGF0ZSgke2NvbnZlcnRUaW1lKGluaXRUaW1lLW5vdywgMCl9IDApYFxuICAgICk7XG4gICAgZWwuZ2V0RWxlbWVudEJ5SWQoXCJoaWRlLWZ1dHVyZS1yZWN0XCIpLnNldEF0dHJpYnV0ZSgneCcsIGNvbnZlcnRUaW1lKG5vdy02MDAwMCkpO1xuICAgIFxuICAgIC8vIE9ubHkgdXBkYXRlIHRoZSBtYWluIGRhdGEgZXZlcnkgMjUwIG1zXG4gICAgY29uc3QgbGFzdFVwZGF0ZSA9IGRhdGFFbC5nZXRBdHRyaWJ1dGUoJ2RhdGEtbGFzdC11cGRhdGUnKSB8fCAwO1xuICAgIGlmIChub3cgLSBsYXN0VXBkYXRlIDwgMjUwKSB7XG4gICAgICAgIHJldHVybiBlbDtcbiAgICB9XG4gICAgZGF0YUVsLnNldEF0dHJpYnV0ZSgnZGF0YS1sYXN0LXVwZGF0ZScsIG5vdyk7XG5cbiAgICBjb25zdCBldmVudFNuYXBzaG90cyA9IGJhdGNoZXMuZmxhdCgpLm1hcCgoam9iKT0+KFxuICAgICAgICBbam9iLmVuZFRpbWUsIGpvYi5yZXN1bHRdXG4gICAgKSk7XG4gICAgXG4gICAgLy8gUmVuZGVyIGVhY2ggam9iIGJhY2tncm91bmQgYW5kIGZvcmVncm91bmRcbiAgICB3aGlsZShkYXRhRWwuZmlyc3RDaGlsZCkge1xuICAgICAgICBkYXRhRWwucmVtb3ZlQ2hpbGQoZGF0YUVsLmZpcnN0Q2hpbGQpO1xuICAgIH1cbiAgICBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyU2FmZXR5TGF5ZXIoYmF0Y2hlcywgbm93KSk7XG4gICAgZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlckpvYkxheWVyKGJhdGNoZXMsIG5vdykpO1xuICAgIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJTZWN1cml0eUxheWVyKGV2ZW50U25hcHNob3RzLCBzZXJ2ZXJTbmFwc2hvdHMsIG5vdykpO1xuICAgIC8vIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJNb25leUxheWVyKGV2ZW50U25hcHNob3RzLCBzZXJ2ZXJTbmFwc2hvdHMsIG5vdykpO1xuICAgIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJQcm9maXRMYXllcihiYXRjaGVzLCBub3cpKTtcblxuICAgIHJldHVybiBlbDtcbn1cblxuXG5mdW5jdGlvbiByZW5kZXJQcm9maXRQYXRoKGJhdGNoZXM9W10sIG5vdywgc2NhbGU9MSkge1xuICAgIC8vIHdvdWxkIGxpa2UgdG8gZ3JhcGggbW9uZXkgcGVyIHNlY29uZCBvdmVyIHRpbWVcbiAgICAvLyBjb25zdCBtb25leVRha2VuID0gW107XG4gICAgY29uc3QgdG90YWxNb25leVRha2VuID0gW107XG4gICAgbGV0IHJ1bm5pbmdUb3RhbCA9IDA7XG4gICAgZm9yIChjb25zdCBiYXRjaCBvZiBiYXRjaGVzKSB7XG4gICAgICAgIGZvciAoY29uc3Qgam9iIG9mIGJhdGNoKSB7XG4gICAgICAgICAgICBpZiAoam9iLnRhc2sgPT0gJ2hhY2snICYmIGpvYi5lbmRUaW1lQWN0dWFsKSB7XG4gICAgICAgICAgICAgICAgLy8gbW9uZXlUYWtlbi5wdXNoKFtqb2IuZW5kVGltZUFjdHVhbCwgam9iLnJlc3VsdEFjdHVhbF0pO1xuICAgICAgICAgICAgICAgIHJ1bm5pbmdUb3RhbCArPSBqb2IucmVzdWx0QWN0dWFsO1xuICAgICAgICAgICAgICAgIHRvdGFsTW9uZXlUYWtlbi5wdXNoKFtqb2IuZW5kVGltZUFjdHVhbCwgcnVubmluZ1RvdGFsXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChqb2IudGFzayA9PSAnaGFjaycgJiYgIWpvYi5jYW5jZWxsZWQpIHtcbiAgICAgICAgICAgICAgICBydW5uaW5nVG90YWwgKz0gam9iLmNoYW5nZS5wbGF5ZXJNb25leTtcbiAgICAgICAgICAgICAgICB0b3RhbE1vbmV5VGFrZW4ucHVzaChbam9iLmVuZFRpbWUsIHJ1bm5pbmdUb3RhbF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHRvdGFsTW9uZXlUYWtlbi5wdXNoKFtub3cgKyAzMDAwMCwgcnVubmluZ1RvdGFsXSk7XG4gICAgLy8gbW9uZXkgdGFrZW4gaW4gdGhlIGxhc3QgWCBzZWNvbmRzIGNvdWxkIGJlIGNvdW50ZWQgd2l0aCBhIHNsaWRpbmcgd2luZG93LlxuICAgIC8vIGJ1dCB0aGUgcmVjb3JkZWQgZXZlbnRzIGFyZSBub3QgZXZlbmx5IHNwYWNlZC5cbiAgICBjb25zdCBtb3ZpbmdBdmVyYWdlID0gW107XG4gICAgbGV0IG1heFByb2ZpdCA9IDA7XG4gICAgbGV0IGogPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdG90YWxNb25leVRha2VuLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IFt0aW1lLCBtb25leV0gPSB0b3RhbE1vbmV5VGFrZW5baV07XG4gICAgICAgIHdoaWxlICh0b3RhbE1vbmV5VGFrZW5bal1bMF0gPD0gdGltZSAtIDIwMDApIHtcbiAgICAgICAgICAgIGorKztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwcm9maXQgPSB0b3RhbE1vbmV5VGFrZW5baV1bMV0gLSB0b3RhbE1vbmV5VGFrZW5bal1bMV07XG4gICAgICAgIG1vdmluZ0F2ZXJhZ2UucHVzaChbdGltZSwgcHJvZml0XSk7XG4gICAgICAgIG1heFByb2ZpdCA9IE1hdGgubWF4KG1heFByb2ZpdCwgcHJvZml0KTtcbiAgICB9XG4gICAgZXZhbChcIndpbmRvd1wiKS5wcm9maXREYXRhID0gW3RvdGFsTW9uZXlUYWtlbiwgcnVubmluZ1RvdGFsLCBtb3ZpbmdBdmVyYWdlXTtcbiAgICBjb25zdCBwYXRoRGF0YSA9IFtcIk0gMCwwXCJdO1xuICAgIGxldCBwcmV2VGltZTtcbiAgICBsZXQgcHJldlByb2ZpdDtcbiAgICBmb3IgKGNvbnN0IFt0aW1lLCBwcm9maXRdIG9mIG1vdmluZ0F2ZXJhZ2UpIHtcbiAgICAgICAgLy8gcGF0aERhdGEucHVzaChgTCAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJvZml0L21heFByb2ZpdCkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgaWYgKHByZXZQcm9maXQpIHtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYEMgJHtjb252ZXJ0VGltZSgocHJldlRpbWUqMyArIHRpbWUpLzQpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJldlByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9ICR7Y29udmVydFRpbWUoKHByZXZUaW1lICsgMyp0aW1lKS80KS50b0ZpeGVkKDMpfSwkeyhzY2FsZSAqIHByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9ICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX0sJHsoc2NhbGUgKiBwcm9maXQvbWF4UHJvZml0KS50b0ZpeGVkKDMpfWApXG4gICAgICAgIH1cbiAgICAgICAgcHJldlRpbWUgPSB0aW1lO1xuICAgICAgICBwcmV2UHJvZml0ID0gcHJvZml0O1xuICAgIH1cbiAgICBwYXRoRGF0YS5wdXNoKGBIICR7Y29udmVydFRpbWUobm93KzYwMDAwKS50b0ZpeGVkKDMpfSBWIDAgWmApO1xuICAgIHJldHVybiBzdmdFbCgncGF0aCcsIHtcbiAgICAgICAgZDogcGF0aERhdGEuam9pbignICcpLFxuICAgICAgICBcInZlY3Rvci1lZmZlY3RcIjogXCJub24tc2NhbGluZy1zdHJva2VcIlxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJQcm9maXRMYXllcihiYXRjaGVzPVtdLCBub3cpIHtcbiAgICBjb25zdCBwcm9maXRQYXRoID0gcmVuZGVyUHJvZml0UGF0aChiYXRjaGVzLCBub3cpO1xuICAgIGNvbnN0IG9ic2VydmVkUHJvZml0ID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJvYnNlcnZlZFByb2ZpdFwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTfSlgLFxuICAgICAgICAgICAgZmlsbDogXCJkYXJrXCIrR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgXCJjbGlwLXBhdGhcIjogYHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYFxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBwcm9maXRQYXRoXG4gICAgICAgIF1cbiAgICApO1xuICAgIGNvbnN0IHByb2plY3RlZFByb2ZpdCA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwicHJvamVjdGVkUHJvZml0XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFN9KWAsXG4gICAgICAgICAgICBmaWxsOiBcIm5vbmVcIixcbiAgICAgICAgICAgIHN0cm9rZTogR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgXCJzdHJva2Utd2lkdGhcIjogMixcbiAgICAgICAgICAgIFwic3Ryb2tlLWxpbmVqb2luXCI6XCJyb3VuZFwiXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIHByb2ZpdFBhdGguY2xvbmVOb2RlKClcbiAgICAgICAgXVxuICAgICk7XG4gICAgY29uc3QgcHJvZml0TGF5ZXIgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInByb2ZpdExheWVyXCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTfSlgXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIG9ic2VydmVkUHJvZml0LFxuICAgICAgICAgICAgcHJvamVjdGVkUHJvZml0XG4gICAgICAgIF1cbiAgICApO1xuICAgIHJldHVybiBwcm9maXRMYXllcjtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTW9uZXlMYXllcihldmVudFNuYXBzaG90cz1bXSwgc2VydmVyU25hcHNob3RzPVtdLCBub3cpIHtcbiAgICBjb25zdCBtb25leUxheWVyID0gc3ZnRWwoXCJnXCIsIHtcbiAgICAgICAgaWQ6IFwibW9uZXlMYXllclwiLFxuICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTfSlgXG4gICAgfSk7XG5cbiAgICBpZiAoc2VydmVyU25hcHNob3RzLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgIHJldHVybiBtb25leUxheWVyO1xuICAgIH1cbiAgICBsZXQgbWluTW9uZXkgPSAwO1xuICAgIGxldCBtYXhNb25leSA9IHNlcnZlclNuYXBzaG90c1swXVsxXS5tb25leU1heDtcbiAgICBjb25zdCBzY2FsZSA9IDEvbWF4TW9uZXk7XG4gICAgbWF4TW9uZXkgKj0gMS4xXG5cbiAgICBjb25zdCBvYnNlcnZlZExheWVyID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJvYnNlcnZlZE1vbmV5XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4TW9uZXkgLSBtaW5Nb25leSkgLyBzY2FsZX0pYCxcbiAgICAgICAgICAgIGZpbGw6IFwiZGFya1wiK0dSQVBIX0NPTE9SUy5tb25leSxcbiAgICAgICAgICAgIC8vIFwiZmlsbC1vcGFjaXR5XCI6IDAuNSxcbiAgICAgICAgICAgIFwiY2xpcC1wYXRoXCI6IGB1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWBcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgcmVuZGVyT2JzZXJ2ZWRQYXRoKFwibW9uZXlBdmFpbGFibGVcIiwgc2VydmVyU25hcHNob3RzLCBtaW5Nb25leSwgbm93LCBzY2FsZSlcbiAgICAgICAgXVxuICAgICk7XG4gICAgbW9uZXlMYXllci5hcHBlbmQob2JzZXJ2ZWRMYXllcik7XG5cbiAgICBjb25zdCBwcm9qZWN0ZWRMYXllciA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwicHJvamVjdGVkTW9uZXlcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhNb25leSAtIG1pbk1vbmV5KSAvIHNjYWxlfSlgLFxuICAgICAgICAgICAgc3Ryb2tlOiBHUkFQSF9DT0xPUlMubW9uZXksXG4gICAgICAgICAgICBmaWxsOiBcIm5vbmVcIixcbiAgICAgICAgICAgIFwic3Ryb2tlLXdpZHRoXCI6IDIsXG4gICAgICAgICAgICBcInN0cm9rZS1saW5lam9pblwiOlwiYmV2ZWxcIlxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBjb21wdXRlUHJvamVjdGVkUGF0aChcIm1vbmV5QXZhaWxhYmxlXCIsIGV2ZW50U25hcHNob3RzLCBub3csIHNjYWxlKVxuICAgICAgICBdXG4gICAgKTtcbiAgICBtb25leUxheWVyLmFwcGVuZChwcm9qZWN0ZWRMYXllcik7XG5cbiAgICByZXR1cm4gbW9uZXlMYXllcjtcbn1cblxuIl19