const React = globalThis.React;
const ReactDOM = globalThis.ReactDOM;
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
        const { ns } = this.props;
        const displayJobs = [...this.jobs.values()];
        return (React.createElement(GraphFrame, { now: this.state.now },
            React.createElement(SafetyLayer, { jobs: displayJobs }),
            React.createElement(JobLayer, { jobs: displayJobs }),
            React.createElement(SecLayer, { jobs: displayJobs }),
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
function SafetyLayer({ jobs }) {
    return React.createElement("g", { id: "safetyLayer" });
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
function SecLayer({ jobs }) {
    return React.createElement("g", { id: "secLayer" });
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
function renderSecurityLayer(eventSnapshots = [], serverSnapshots = [], now) {
    let minSec = 0;
    let maxSec = 1;
    for (const snapshots of [eventSnapshots, serverSnapshots]) {
        for (const [time, server] of snapshots) {
            minSec = Math.min(minSec, server.hackDifficulty);
            maxSec = Math.max(maxSec, server.hackDifficulty);
        }
    }
    const observedLayer = svgEl("g", {
        id: "observedSec",
        transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxSec - minSec)})`,
        fill: "dark" + GRAPH_COLORS.security,
        // "fill-opacity": 0.5,
        "clip-path": `url(#hide-future-${initTime})`
    }, [
        renderObservedPath("hackDifficulty", serverSnapshots, minSec, now)
    ]);
    const projectedLayer = svgEl("g", {
        id: "projectedSec",
        transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxSec - minSec)})`,
        stroke: GRAPH_COLORS.security,
        fill: "none",
        "stroke-width": 2,
        "stroke-linejoin": "bevel"
    }, [
        renderProjectedPath("hackDifficulty", eventSnapshots, now)
    ]);
    const secLayer = svgEl("g", {
        id: "secLayer",
        transform: `translate(0 ${HEIGHT_PIXELS - 2 * FOOTER_PIXELS})`
    }, [
        observedLayer,
        projectedLayer
    ]);
    return secLayer;
}
function renderObservedPath(property = "hackDifficulty", serverSnapshots = [], minValue = 0, now, scale = 1) {
    const pathData = [];
    let prevServer;
    let prevTime;
    for (const [time, server] of serverSnapshots) {
        if (time < now - (WIDTH_SECONDS * 2 * 1000)) {
            continue;
        }
        // fill area under actual security
        if (!prevServer) {
            // start at bottom left
            pathData.push(`M ${convertTime(time).toFixed(3)},${(minValue * scale).toFixed(2)}`);
        }
        if (prevServer) {
            // vertical line to previous level
            // horizontal line to current time
            pathData.push(`V ${(prevServer[property] * scale).toFixed(2)}`, `H ${convertTime(time).toFixed(3)}`);
        }
        prevServer = server;
        prevTime = time;
    }
    // fill in area between last snapshot and "now" cursor
    if (prevServer) {
        // vertical line to previous level
        // horizontal line to current time
        pathData.push(`V ${(prevServer[property] * scale).toFixed(2)}`, `H ${convertTime(now + 60000).toFixed(3)}`);
    }
    pathData.push(`V ${minValue} Z`);
    return svgEl('path', {
        d: pathData.join(' ')
    });
}
function renderProjectedPath(property = "hackDifficulty", eventSnapshots = [], now, scale = 1) {
    const pathData = [];
    let prevTime;
    let prevServer;
    for (const [time, server] of eventSnapshots) {
        if (time < now - (WIDTH_SECONDS * 2 * 1000)) {
            continue;
        }
        if (!prevServer) {
            // start line at first projected time and value
            pathData.push(`M ${convertTime(time).toFixed(3)},${(server[property] * scale).toFixed(2)}`);
        }
        if (prevServer && time > prevTime) {
            // vertical line to previous value
            // horizontal line from previous time to current time
            pathData.push(`V ${(prevServer[property] * scale).toFixed(2)}`, `H ${convertTime(time).toFixed(3)}`);
        }
        prevTime = time;
        prevServer = server;
    }
    if (prevServer) {
        // vertical line to previous value
        // horizontal line from previous time to future
        pathData.push(`V ${(prevServer[property] * scale).toFixed(2)}`, `H ${convertTime(now + 60000).toFixed(3)}`);
    }
    return svgEl('path', {
        d: pathData.join(' '),
        "vector-effect": "non-scaling-stroke"
    });
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
        renderProjectedPath("moneyAvailable", eventSnapshots, now, scale)
    ]);
    moneyLayer.append(projectedLayer);
    return moneyLayer;
}
function renderSafetyLayer(batches = [], now) {
    const safetyLayer = svgEl('g', { id: "safetyLayer" });
    let prevJob;
    for (const batch of batches) {
        for (const job of batch) {
            if ((job.endTimeActual || job.endTime) < now - (WIDTH_SECONDS * 2 * 1000)) {
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
function renderJobLayer(batches = [], now) {
    const jobLayer = svgEl('g', { id: "jobLayer" });
    let i = 0;
    for (const batch of batches) {
        for (const job of batch) {
            i = (i + 1) % ((HEIGHT_PIXELS - FOOTER_PIXELS * 2) / 4);
            if ((job.endTimeActual || job.endTime) < now - (WIDTH_SECONDS * 2 * 1000)) {
                continue;
            }
            // draw the job bars
            let color = GRAPH_COLORS[job.task];
            if (job.cancelled) {
                color = GRAPH_COLORS.cancelled;
            }
            jobLayer.appendChild(svgEl('rect', {
                x: convertTime(job.startTime), width: convertTime(job.duration, 0),
                y: i * 4, height: 2,
                fill: color
            }));
            // draw the error bars
            if (job.startTimeActual) {
                const [t1, t2] = [job.startTime, job.startTimeActual].sort((a, b) => a - b);
                jobLayer.appendChild(svgEl('rect', {
                    x: convertTime(t1), width: convertTime(t2 - t1, 0),
                    y: i * 4, height: 1,
                    fill: GRAPH_COLORS.desync
                }));
            }
            if (job.endTimeActual) {
                const [t1, t2] = [job.endTime, job.endTimeActual].sort((a, b) => a - b);
                jobLayer.appendChild(svgEl('rect', {
                    x: convertTime(t1), width: convertTime(t2 - t1, 0),
                    y: i * 4, height: 1,
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
    const legendEl = svgEl('g', { id: "Legend", transform: "translate(-480, 10), scale(.5, .5)" }, [['rect', { x: 1, y: 1, width: 275, height: 392, fill: "black", stroke: "#979797" }]]);
    let y = 13;
    for (const [label, color] of Object.entries(GRAPH_COLORS)) {
        legendEl.appendChild(svgEl('g', { transform: `translate(22, ${y})` }, [
            ['rect', { x: 0, y: 10, width: 22, height: 22, fill: color }],
            ['text', { "font-family": "Courier New", "font-size": 36, fill: "#888" }, [
                    ['tspan', { x: 42.5, y: 30 }, [label.substring(0, 1).toUpperCase() + label.substring(1)]]
                ]]
        ]));
        y += 41;
    }
    return legendEl;
}
/* ---------- library functions ---------- */
/** Create an SVG Element that can be displayed in the DOM. */
function svgEl(tagName, attributes = {}, children = []) {
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
        else if (typeof (child) == 'string') {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFHQSxNQUFNLEtBQUssR0FBRyxVQUFVLENBQUMsS0FBOEIsQ0FBQztBQUN4RCxNQUFNLFFBQVEsR0FBRyxVQUFVLENBQUMsUUFBb0MsQ0FBQztBQVNqRSxJQUFJLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFZLENBQUM7QUFDM0M7Ozs7R0FJRztBQUNILFNBQVMsV0FBVyxDQUFDLENBQVMsRUFBRSxFQUFFLEdBQUMsUUFBUTtJQUN2QyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFnQixDQUFDO0FBQzVDLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxDQUFjO0lBQ2xDLE9BQU8sQ0FBQyxHQUFHLFlBQVksR0FBRyxhQUEyQixDQUFDO0FBQzFELENBQUM7QUFFRCxNQUFNLFlBQVksR0FBRztJQUNqQixNQUFNLEVBQUUsTUFBTTtJQUNkLE1BQU0sRUFBRSxZQUFZO0lBQ3BCLFFBQVEsRUFBRSxRQUFRO0lBQ2xCLFdBQVcsRUFBRSxLQUFLO0lBQ2xCLFFBQVEsRUFBRSxTQUFTO0lBQ25CLE1BQU0sRUFBRSxNQUFNO0lBQ2QsUUFBUSxFQUFFLE1BQU07SUFDaEIsVUFBVSxFQUFFLEtBQUs7SUFDakIsT0FBTyxFQUFFLE1BQU07Q0FDbEIsQ0FBQztBQUVGLE1BQU0sWUFBWSxHQUFHLEdBQWlCLENBQUM7QUFDdkMsTUFBTSxhQUFhLEdBQUcsRUFBaUIsQ0FBQztBQUN4QyxNQUFNLGFBQWEsR0FBRyxHQUFhLENBQUM7QUFDcEMsTUFBTSxhQUFhLEdBQUcsRUFBWSxDQUFDO0FBNEJuQyxtQkFBbUI7QUFFbkIsTUFBTSxLQUFLLEdBQXFEO0lBQzVELENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQztJQUNmLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztDQUNkLENBQUM7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QyxHQUFHLENBQUMsQ0FBQztJQUM3RCxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsYUFBYSxDQUFDLFdBQVcsT0FBTyxJQUFJLENBQUMsQ0FBQyxhQUFhLENBQUMsa0JBQWtCLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQy9HLEtBQUssQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDMUIsQ0FBQztBQUVELFdBQVciLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IE5TLCBOZXRzY3JpcHRQb3J0IH0gZnJvbSAnQG5zJztcbmltcG9ydCB0eXBlIFJlYWN0TmFtZXNwYWNlIGZyb20gJ3JlYWN0L2luZGV4JztcbmltcG9ydCB0eXBlIFJlYWN0RG9tTmFtZXNwYWNlIGZyb20gJ3JlYWN0LWRvbSc7XG5jb25zdCBSZWFjdCA9IGdsb2JhbFRoaXMuUmVhY3QgYXMgdHlwZW9mIFJlYWN0TmFtZXNwYWNlO1xuY29uc3QgUmVhY3RET00gPSBnbG9iYWxUaGlzLlJlYWN0RE9NIGFzIHR5cGVvZiBSZWFjdERvbU5hbWVzcGFjZTtcblxuLy8gLS0tLS0gY29uc3RhbnRzIC0tLS0tIFxuXG50eXBlIFRpbWVNcyA9IFJldHVyblR5cGU8dHlwZW9mIHBlcmZvcm1hbmNlLm5vdz4gJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJtaWxsaXNlY29uZHNcIiB9O1xudHlwZSBUaW1lU2Vjb25kcyA9IG51bWJlciAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcInNlY29uZHNcIiB9O1xudHlwZSBUaW1lUGl4ZWxzID0gbnVtYmVyICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwicGl4ZWxzXCIgfTtcbnR5cGUgUGl4ZWxzID0gbnVtYmVyICYgeyBfX3VuaXRzOiBcInBpeGVsc1wiIH07XG5cbmxldCBpbml0VGltZSA9IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNcztcbi8qKlxuICogQ29udmVydCB0aW1lc3RhbXBzIHRvIHNlY29uZHMgc2luY2UgdGhlIGdyYXBoIHdhcyBzdGFydGVkLlxuICogVG8gcmVuZGVyIFNWR3MgdXNpbmcgbmF0aXZlIHRpbWUgdW5pdHMsIHRoZSB2YWx1ZXMgbXVzdCBiZSB2YWxpZCAzMi1iaXQgaW50cy5cbiAqIFNvIHdlIGNvbnZlcnQgdG8gYSByZWNlbnQgZXBvY2ggaW4gY2FzZSBEYXRlLm5vdygpIHZhbHVlcyBhcmUgdXNlZC5cbiAqL1xuZnVuY3Rpb24gY29udmVydFRpbWUodDogVGltZU1zLCB0MD1pbml0VGltZSk6IFRpbWVTZWNvbmRzIHtcbiAgICByZXR1cm4gKCh0IC0gdDApIC8gMTAwMCkgYXMgVGltZVNlY29uZHM7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRTZWNUb1B4KHQ6IFRpbWVTZWNvbmRzKTogVGltZVBpeGVscyB7XG4gICAgcmV0dXJuIHQgKiBXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTIGFzIFRpbWVQaXhlbHM7XG59XG5cbmNvbnN0IEdSQVBIX0NPTE9SUyA9IHtcbiAgICBcImhhY2tcIjogXCJjeWFuXCIsXG4gICAgXCJncm93XCI6IFwibGlnaHRncmVlblwiLFxuICAgIFwid2Vha2VuXCI6IFwieWVsbG93XCIsXG4gICAgXCJjYW5jZWxsZWRcIjogXCJyZWRcIixcbiAgICBcImRlc3luY1wiOiBcIm1hZ2VudGFcIixcbiAgICBcInNhZmVcIjogXCIjMTExXCIsXG4gICAgXCJ1bnNhZmVcIjogXCIjMzMzXCIsXG4gICAgXCJzZWN1cml0eVwiOiBcInJlZFwiLFxuICAgIFwibW9uZXlcIjogXCJibHVlXCJcbn07XG5cbmNvbnN0IFdJRFRIX1BJWEVMUyA9IDgwMCBhcyBUaW1lUGl4ZWxzO1xuY29uc3QgV0lEVEhfU0VDT05EUyA9IDE2IGFzIFRpbWVTZWNvbmRzO1xuY29uc3QgSEVJR0hUX1BJWEVMUyA9IDYwMCBhcyBQaXhlbHM7XG5jb25zdCBGT09URVJfUElYRUxTID0gNTAgYXMgUGl4ZWxzO1xuXG4vLyAtLS0tLSB0eXBlcyAtLS0tLVxuXG4vKipcbiAqIEpvYlxuICovXG5pbnRlcmZhY2UgSm9iIHtcbiAgICBqb2JJRDogc3RyaW5nIHwgbnVtYmVyO1xuICAgIHJvd0lEOiBudW1iZXI7XG4gICAgdGFzazogXCJoYWNrXCIgfCBcImdyb3dcIiB8IFwid2Vha2VuXCI7XG4gICAgZHVyYXRpb246IFRpbWVNcztcbiAgICBzdGFydFRpbWU6IFRpbWVNcztcbiAgICBzdGFydFRpbWVBY3R1YWw6IFRpbWVNcztcbiAgICBlbmRUaW1lOiBUaW1lTXM7XG4gICAgZW5kVGltZUFjdHVhbDogVGltZU1zO1xuICAgIGNhbmNlbGxlZDogYm9vbGVhbjtcbiAgICByZXN1bHQ6IHtcbiAgICAgICAgaGFja0RpZmZpY3VsdHk6IG51bWJlcjtcbiAgICAgICAgbWluRGlmZmljdWx0eTogbnVtYmVyO1xuICAgIH07XG4gICAgcmVzdWx0QWN0dWFsOiBudW1iZXI7XG4gICAgY2hhbmdlOiB7XG4gICAgICAgIHBsYXllck1vbmV5OiBudW1iZXI7XG4gICAgfTtcbn1cblxuXG4vLyAtLS0tLSBtYWluIC0tLS0tXG5cbmNvbnN0IEZMQUdTOiBbc3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgc3RyaW5nW11dW10gPSBbXG4gICAgW1wiaGVscFwiLCBmYWxzZV0sXG4gICAgW1wicG9ydFwiLCAwXVxuXTtcblxuZXhwb3J0IGZ1bmN0aW9uIGF1dG9jb21wbGV0ZShkYXRhOiBhbnksIGFyZ3M6IHN0cmluZ1tdKSB7XG4gICAgZGF0YS5mbGFncyhGTEFHUyk7XG4gICAgcmV0dXJuIFtdO1xufVxuXG4vKiogQHBhcmFtIHtOU30gbnMgKiovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWFpbihuczogTlMpIHtcbiAgICBucy5kaXNhYmxlTG9nKCdzbGVlcCcpO1xuICAgIG5zLmNsZWFyTG9nKCk7XG4gICAgbnMudGFpbCgpO1xuICAgIG5zLnJlc2l6ZVRhaWwoODEwLCA2NDApO1xuXG4gICAgY29uc3QgZmxhZ3MgPSBucy5mbGFncyhGTEFHUyk7XG4gICAgaWYgKGZsYWdzLmhlbHApIHtcbiAgICAgICAgbnMudHByaW50KFtcbiAgICAgICAgICAgIGBVU0FHRWAsXG4gICAgICAgICAgICBgPiBydW4gJHtucy5nZXRTY3JpcHROYW1lKCl9IC0tcG9ydCAxYCxcbiAgICAgICAgICAgICcgJ1xuICAgICAgICBdLmpvaW4oXCJcXG5cIikpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcG9ydE51bSA9IGZsYWdzLnBvcnQgYXMgbnVtYmVyIHx8IG5zLnBpZDtcbiAgICBjb25zdCBwb3J0ID0gbnMuZ2V0UG9ydEhhbmRsZShwb3J0TnVtKTtcbiAgICAvLyBwb3J0LmNsZWFyKCk7XG4gICAgbnMucHJpbnQoYExpc3RlbmluZyBvbiBQb3J0ICR7cG9ydE51bX1gKTtcblxuICAgIGNvbnN0IGJhdGNoVmlldyA9IDxCYXRjaFZpZXcgbnM9e25zfSBwb3J0TnVtPXtwb3J0TnVtfSAvPjtcbiAgICBucy5wcmludFJhdyhiYXRjaFZpZXcpO1xuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgYXdhaXQgcG9ydC5uZXh0V3JpdGUoKTtcbiAgICB9XG59XG5cbmludGVyZmFjZSBCYXRjaFZpZXdQcm9wcyB7XG4gICAgbnM6IE5TO1xuICAgIHBvcnROdW06IG51bWJlcjtcbn1cbmludGVyZmFjZSBCYXRjaFZpZXdTdGF0ZSB7XG4gICAgcnVubmluZzogYm9vbGVhbjtcbiAgICBub3c6IFRpbWVNcztcbn1cbmV4cG9ydCBjbGFzcyBCYXRjaFZpZXcgZXh0ZW5kcyBSZWFjdC5Db21wb25lbnQ8QmF0Y2hWaWV3UHJvcHMsIEJhdGNoVmlld1N0YXRlPiB7XG4gICAgcG9ydDogTmV0c2NyaXB0UG9ydDtcbiAgICBqb2JzOiBNYXA8c3RyaW5nIHwgbnVtYmVyLCBKb2I+O1xuICAgIG5Sb3dzOiBudW1iZXI7XG5cbiAgICBjb25zdHJ1Y3Rvcihwcm9wczogQmF0Y2hWaWV3UHJvcHMpe1xuICAgICAgICBzdXBlcihwcm9wcyk7XG4gICAgICAgIGNvbnN0IHsgbnMsIHBvcnROdW0gfSA9IHByb3BzO1xuICAgICAgICB0aGlzLnN0YXRlID0ge1xuICAgICAgICAgICAgcnVubmluZzogdHJ1ZSxcbiAgICAgICAgICAgIG5vdzogcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMucG9ydCA9IG5zLmdldFBvcnRIYW5kbGUocG9ydE51bSk7XG4gICAgICAgIHRoaXMuam9icyA9IG5ldyBNYXAoKTtcbiAgICAgICAgdGhpcy5uUm93cyA9IDA7XG4gICAgfVxuXG4gICAgY29tcG9uZW50RGlkTW91bnQoKSB7XG4gICAgICAgIGNvbnN0IHsgbnMgfSA9IHRoaXMucHJvcHM7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IHRydWV9KTtcbiAgICAgICAgbnMuYXRFeGl0KCgpPT57XG4gICAgICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiBmYWxzZX0pO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5yZWFkUG9ydCgpO1xuICAgICAgICB0aGlzLmFuaW1hdGUoKTtcbiAgICAgICAgLy8gT2JqZWN0LmFzc2lnbihnbG9iYWxUaGlzLCB7YmF0Y2hWaWV3OiB0aGlzfSk7XG4gICAgfVxuXG4gICAgY29tcG9uZW50V2lsbFVubW91bnQoKSB7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IGZhbHNlfSk7XG4gICAgfVxuXG4gICAgYWRkSm9iKGpvYjogSm9iKSB7XG4gICAgICAgIGlmIChqb2Iuam9iSUQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgd2hpbGUgKHRoaXMuam9icy5oYXModGhpcy5uUm93cykpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm5Sb3dzICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBqb2Iuam9iSUQgPSB0aGlzLm5Sb3dzO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmpvYnMuaGFzKGpvYi5qb2JJRCkpIHtcbiAgICAgICAgICAgIGpvYiA9IE9iamVjdC5hc3NpZ24odGhpcy5qb2JzLmdldChqb2Iuam9iSUQpIGFzIEpvYiwgam9iKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGpvYi5yb3dJRCA9IHRoaXMublJvd3M7XG4gICAgICAgICAgICB0aGlzLm5Sb3dzICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5qb2JzLnNldChqb2Iuam9iSUQsIGpvYik7XG4gICAgICAgIHRoaXMuY2xlYW5Kb2JzKCk7XG4gICAgfVxuXG4gICAgY2xlYW5Kb2JzKCkge1xuICAgICAgICAvLyBmaWx0ZXIgb3V0IGpvYnMgd2l0aCBlbmR0aW1lIGluIHBhc3RcbiAgICAgICAgaWYgKHRoaXMuam9icy5zaXplID4gMjAwKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGpvYklEIG9mIHRoaXMuam9icy5rZXlzKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBqb2IgPSB0aGlzLmpvYnMuZ2V0KGpvYklEKSBhcyBKb2I7XG4gICAgICAgICAgICAgICAgaWYgKChqb2IuZW5kVGltZUFjdHVhbCA/PyBqb2IuZW5kVGltZSkgPCB0aGlzLnN0YXRlLm5vdy0oV0lEVEhfU0VDT05EUyoyKjEwMDApKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuam9icy5kZWxldGUoam9iSUQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJlYWRQb3J0ID0gKCk9PntcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlLnJ1bm5pbmcpIHJldHVybjtcbiAgICAgICAgd2hpbGUoIXRoaXMucG9ydC5lbXB0eSgpKSB7XG4gICAgICAgICAgICBjb25zdCBqb2IgPSBKU09OLnBhcnNlKHRoaXMucG9ydC5yZWFkKCkgYXMgc3RyaW5nKTtcbiAgICAgICAgICAgIHRoaXMuYWRkSm9iKGpvYik7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5wb3J0Lm5leHRXcml0ZSgpLnRoZW4odGhpcy5yZWFkUG9ydCk7XG4gICAgfVxuXG4gICAgYW5pbWF0ZSA9ICgpPT57XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5ydW5uaW5nKSByZXR1cm47XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe25vdzogcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zfSk7XG4gICAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGUpO1xuICAgIH1cblxuICAgIHJlbmRlcigpIHtcbiAgICAgICAgY29uc3QgeyBucyB9ID0gdGhpcy5wcm9wcztcblxuICAgICAgICBjb25zdCBkaXNwbGF5Sm9icyA9IFsuLi50aGlzLmpvYnMudmFsdWVzKCldXG5cbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIDxHcmFwaEZyYW1lIG5vdz17dGhpcy5zdGF0ZS5ub3d9PlxuICAgICAgICAgICAgICAgIDxTYWZldHlMYXllciBqb2JzPXtkaXNwbGF5Sm9ic30gLz5cbiAgICAgICAgICAgICAgICA8Sm9iTGF5ZXIgam9icz17ZGlzcGxheUpvYnN9IC8+XG4gICAgICAgICAgICAgICAgPFNlY0xheWVyIGpvYnM9e2Rpc3BsYXlKb2JzfSAvPlxuICAgICAgICAgICAgICAgIDxNb25leUxheWVyIGpvYnM9e2Rpc3BsYXlKb2JzfSAvPlxuICAgICAgICAgICAgPC9HcmFwaEZyYW1lPlxuICAgICAgICApXG4gICAgfVxufVxuXG5cbmZ1bmN0aW9uIEdyYXBoRnJhbWUoe25vdywgY2hpbGRyZW59Ontub3c6VGltZU1zLCBjaGlsZHJlbjogUmVhY3QuUmVhY3ROb2RlfSk6IFJlYWN0LlJlYWN0RWxlbWVudCB7XG4gICAgLy8gVE9ETzogaW5pdFRpbWUgaXMgdXNlZCBhcyB1bmlxdWUgRE9NIElEIGFuZCBhcyByZW5kZXJpbmcgb3JpZ2luIGJ1dCBpdCBpcyBwb29ybHkgc3VpdGVkIGZvciBib3RoXG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8c3ZnIHZlcnNpb249XCIxLjFcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCJcbiAgICAgICAgICAgIHdpZHRoPXtXSURUSF9QSVhFTFN9XG4gICAgICAgICAgICBoZWlnaHQ9e0hFSUdIVF9QSVhFTFN9IFxuICAgICAgICAgICAgLy8gU2V0IHRoZSB2aWV3Qm94IGZvciAxMCBzZWNvbmRzIG9mIGhpc3RvcnksIDYgc2Vjb25kcyBvZiBmdXR1cmUuXG4gICAgICAgICAgICB2aWV3Qm94PXtgJHtjb252ZXJ0U2VjVG9QeCgtMTAgYXMgVGltZVNlY29uZHMpfSAwICR7V0lEVEhfUElYRUxTfSAke0hFSUdIVF9QSVhFTFN9YH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGRlZnM+XG4gICAgICAgICAgICAgICAgPGNsaXBQYXRoIGlkPXtgaGlkZS1mdXR1cmUtJHtpbml0VGltZX1gfSBjbGlwUGF0aFVuaXRzPVwidXNlclNwYWNlT25Vc2VcIj5cbiAgICAgICAgICAgICAgICAgICAgPHJlY3QgaWQ9XCJoaWRlLWZ1dHVyZS1yZWN0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKG5vdy02MDAwMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg9e2NvbnZlcnRUaW1lKDYwMDAwIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgICAgICAgICAgICAgeT17MH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGhlaWdodD17NTB9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9jbGlwUGF0aD5cbiAgICAgICAgICAgIDwvZGVmcz5cbiAgICAgICAgICAgIDxyZWN0IGlkPVwiYmFja2dyb3VuZFwiIHg9e2NvbnZlcnRTZWNUb1B4KC0xMCBhcyBUaW1lU2Vjb25kcyl9IHdpZHRoPVwiMTAwJVwiIGhlaWdodD1cIjEwMCVcIiBmaWxsPXtHUkFQSF9DT0xPUlMuc2FmZX0gLz5cbiAgICAgICAgICAgIDxnIGlkPVwidGltZUNvb3JkaW5hdGVzXCIgdHJhbnNmb3JtPXtgc2NhbGUoJHtXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTfSAxKSB0cmFuc2xhdGUoJHtjb252ZXJ0VGltZShpbml0VGltZS1ub3cgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9IDApYH0+XG4gICAgICAgICAgICAgICAge2NoaWxkcmVufVxuICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0xXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy1GT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTJcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLTIqRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgPHJlY3QgaWQ9XCJjdXJzb3JcIiB4PXswfSB3aWR0aD17MX0geT17MH0gaGVpZ2h0PVwiMTAwJVwiIGZpbGw9XCJ3aGl0ZVwiIC8+XG4gICAgICAgICAgICA8R3JhcGhMZWdlbmQgLz5cbiAgICAgICAgPC9zdmc+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gR3JhcGhMZWdlbmQoKTogUmVhY3QuUmVhY3RFbGVtZW50IHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cIkxlZ2VuZFwiIHRyYW5zZm9ybT1cInRyYW5zbGF0ZSgtNDkwLCAxMCksIHNjYWxlKC41LCAuNSlcIj5cbiAgICAgICAgICAgIDxyZWN0IHg9ezF9IHk9ezF9IHdpZHRoPXsyNzV9IGhlaWdodD17MzkyfSBmaWxsPVwiYmxhY2tcIiBzdHJva2U9XCIjOTc5Nzk3XCIgLz5cbiAgICAgICAgICAgIHtPYmplY3QuZW50cmllcyhHUkFQSF9DT0xPUlMpLm1hcCgoW2xhYmVsLCBjb2xvcl0sIGkpPT4oXG4gICAgICAgICAgICAgICAgPGcga2V5PXtsYWJlbH0gdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDIyLCAkezEzICsgNDEqaX0pYH0+XG4gICAgICAgICAgICAgICAgICAgIDxyZWN0IHg9ezB9IHk9ezB9IHdpZHRoPXsyMn0gaGVpZ2h0PXsyMn0gZmlsbD17Y29sb3J9IC8+XG4gICAgICAgICAgICAgICAgICAgIDx0ZXh0IGZvbnRGYW1pbHk9XCJDb3VyaWVyIE5ld1wiIGZvbnRTaXplPXszNn0gZmlsbD1cIiM4ODhcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDx0c3BhbiB4PXs0Mi41fSB5PXszMH0+e2xhYmVsLnN1YnN0cmluZygwLDEpLnRvVXBwZXJDYXNlKCkrbGFiZWwuc3Vic3RyaW5nKDEpfTwvdHNwYW4+XG4gICAgICAgICAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cblxuZnVuY3Rpb24gU2FmZXR5TGF5ZXIoe2pvYnN9OiB7am9iczogSm9iW119KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICByZXR1cm4gPGcgaWQ9XCJzYWZldHlMYXllclwiIC8+O1xufVxuXG5mdW5jdGlvbiBKb2JMYXllcih7am9ic306IHtqb2JzOiBKb2JbXX0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cImpvYkxheWVyXCI+XG4gICAgICAgICAgICB7am9icy5tYXAoKGpvYjogSm9iKT0+KDxKb2JCYXIgam9iPXtqb2J9IGtleT17am9iLmpvYklEfSAvPikpfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gSm9iQmFyKHtqb2J9OiB7am9iOiBKb2J9KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBjb25zdCB5ID0gKChqb2Iucm93SUQgKyAxKSAlICgoSEVJR0hUX1BJWEVMUyAtIEZPT1RFUl9QSVhFTFMqMikgLyA0KSkgKiA0O1xuICAgIGxldCBqb2JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lICYmIGpvYi5kdXJhdGlvbikge1xuICAgICAgICBqb2JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKGpvYi5zdGFydFRpbWUpfSB3aWR0aD17Y29udmVydFRpbWUoam9iLmR1cmF0aW9uLCAwKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17Mn1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SU1tqb2IuY2FuY2VsbGVkID8gJ2NhbmNlbGxlZCcgOiBqb2IudGFza119XG4gICAgICAgIC8+KVxuICAgIH07XG4gICAgbGV0IHN0YXJ0RXJyb3JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5zdGFydFRpbWUsIGpvYi5zdGFydFRpbWVBY3R1YWxdLnNvcnQoKGEsYik9PmEtYik7XG4gICAgICAgIHN0YXJ0RXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxLCAwKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17MX1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SUy5kZXN5bmN9XG4gICAgICAgICAvPik7XG4gICAgfVxuICAgIGxldCBlbmRFcnJvckJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5lbmRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5lbmRUaW1lLCBqb2IuZW5kVGltZUFjdHVhbF0uc29ydCgoYSxiKT0+YS1iKTtcbiAgICAgICAgZW5kRXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxLCAwKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17MX1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SUy5kZXN5bmN9XG4gICAgICAgICAvPik7XG4gICAgfVxuICAgIHJldHVybiAoXG4gICAgICAgIDxnIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7eX0pYH0+XG4gICAgICAgICAgICB7am9iQmFyfVxuICAgICAgICAgICAge3N0YXJ0RXJyb3JCYXJ9XG4gICAgICAgICAgICB7ZW5kRXJyb3JCYXJ9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBTZWNMYXllcih7am9ic306IHtqb2JzOiBKb2JbXX0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIHJldHVybiA8ZyBpZD1cInNlY0xheWVyXCIgLz5cbn1cblxuZnVuY3Rpb24gTW9uZXlMYXllcih7am9ic306IHtqb2JzOiBKb2JbXX0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIHJldHVybiA8ZyBpZD1cIm1vbmV5TGF5ZXJcIiAvPlxufVxuXG4vLyAtLS0tLSBwcmUtUmVhY3QgdmVyc2lvbiAtLS0tLVxuXG4vKipcbiAqIHJlbmRlckJhdGNoZXMgLSBjcmVhdGUgYW4gU1ZHIGVsZW1lbnQgd2l0aCBhIGdyYXBoIG9mIGpvYnNcbiAqIEBwYXJhbSB7U1ZHU1ZHRWxlbWVudH0gW2VsXSAtIFNWRyBlbGVtZW50IHRvIHJldXNlLiBXaWxsIGJlIGNyZWF0ZWQgaWYgaXQgZG9lcyBub3QgZXhpc3QgeWV0LlxuICogQHBhcmFtIHtKb2JbXVtdfSBiYXRjaGVzIC0gYXJyYXkgb2YgYXJyYXlzIG9mIGpvYnNcbiAqIEBwYXJhbSB7bnVtYmVyfSBbbm93XSAtIGN1cnJlbnQgdGltZSAob3B0aW9uYWwpXG4gKiBAcmV0dXJucyB7U1ZHU1ZHRWxlbWVudH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckJhdGNoZXMoZWw6IEhUTUxFbGVtZW50LCBiYXRjaGVzPVtdLCBzZXJ2ZXJTbmFwc2hvdHM9W10sIG5vdzogVGltZU1zKSB7XG4gICAgbm93IHx8PSBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXM7XG5cbiAgICAvLyBSZW5kZXIgdGhlIG1haW4gU1ZHIGVsZW1lbnQgaWYgbmVlZGVkXG4gICAgZWwgfHw9IHN2Z0VsKFxuICAgICAgICBcInN2Z1wiLFxuICAgICAgICB7XG4gICAgICAgICAgICB2ZXJzaW9uOiBcIjEuMVwiLCB3aWR0aDpXSURUSF9QSVhFTFMsIGhlaWdodDogSEVJR0hUX1BJWEVMUyxcbiAgICAgICAgICAgIC8vIFNldCB0aGUgdmlld0JveCBmb3IgMTAgc2Vjb25kcyBvZiBoaXN0b3J5LCA2IHNlY29uZHMgb2YgZnV0dXJlLlxuICAgICAgICAgICAgdmlld0JveDogYCR7Y29udmVydFNlY1RvUHgoLTEwKX0gMCAke1dJRFRIX1BJWEVMU30gJHtIRUlHSFRfUElYRUxTfWBcbiAgICAgICAgfSxcbiAgICAgICAgW1xuICAgICAgICAgICAgW1wiZGVmc1wiLCB7fSwgW1xuICAgICAgICAgICAgICAgIFtcImNsaXBQYXRoXCIsIHtpZDpgaGlkZS1mdXR1cmUtJHtpbml0VGltZX1gLCBjbGlwUGF0aFVuaXRzOiBcInVzZXJTcGFjZU9uVXNlXCJ9LCBbXG4gICAgICAgICAgICAgICAgICAgIFtcInJlY3RcIiwge2lkOlwiaGlkZS1mdXR1cmUtcmVjdFwiLCB4OmNvbnZlcnRUaW1lKG5vdy02MDAwMCksIHdpZHRoOmNvbnZlcnRUaW1lKDYwMDAwLDApLCB5OjAsIGhlaWdodDogNTB9XVxuICAgICAgICAgICAgICAgIF1dXG4gICAgICAgICAgICBdXSxcbiAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiYmFja2dyb3VuZFwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCBoZWlnaHQ6XCIxMDAlXCIsIGZpbGw6R1JBUEhfQ09MT1JTLnNhZmV9XSxcbiAgICAgICAgICAgIFtcImdcIiwge2lkOlwidGltZUNvb3JkaW5hdGVzXCJ9LCBbXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJzYWZldHlMYXllclwifV0sXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJqb2JMYXllclwifV0sXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJzZWNMYXllclwifV0sXG4gICAgICAgICAgICAgICAgW1wiZ1wiLCB7aWQ6XCJtb25leUxheWVyXCJ9XVxuICAgICAgICAgICAgXV0sXG4gICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMVwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTJcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLTIqRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgW1wicmVjdFwiLCB7aWQ6XCJjdXJzb3JcIiwgeDowLCB3aWR0aDoxLCB5OjAsIGhlaWdodDogXCIxMDAlXCIsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgcmVuZGVyTGVnZW5kKClcbiAgICAgICAgXVxuICAgICk7XG5cbiAgICAvLyBVcGRhdGUgdGhlIHRpbWUgY29vcmRpbmF0ZXMgZXZlcnkgZnJhbWVcbiAgICBjb25zdCBkYXRhRWwgPSBlbC5nZXRFbGVtZW50QnlJZChcInRpbWVDb29yZGluYXRlc1wiKTtcbiAgICBkYXRhRWwuc2V0QXR0cmlidXRlKCd0cmFuc2Zvcm0nLFxuICAgICAgICBgc2NhbGUoJHtXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTfSAxKSB0cmFuc2xhdGUoJHtjb252ZXJ0VGltZShpbml0VGltZS1ub3csIDApfSAwKWBcbiAgICApO1xuICAgIGVsLmdldEVsZW1lbnRCeUlkKFwiaGlkZS1mdXR1cmUtcmVjdFwiKS5zZXRBdHRyaWJ1dGUoJ3gnLCBjb252ZXJ0VGltZShub3ctNjAwMDApKTtcbiAgICBcbiAgICAvLyBPbmx5IHVwZGF0ZSB0aGUgbWFpbiBkYXRhIGV2ZXJ5IDI1MCBtc1xuICAgIGNvbnN0IGxhc3RVcGRhdGUgPSBkYXRhRWwuZ2V0QXR0cmlidXRlKCdkYXRhLWxhc3QtdXBkYXRlJykgfHwgMDtcbiAgICBpZiAobm93IC0gbGFzdFVwZGF0ZSA8IDI1MCkge1xuICAgICAgICByZXR1cm4gZWw7XG4gICAgfVxuICAgIGRhdGFFbC5zZXRBdHRyaWJ1dGUoJ2RhdGEtbGFzdC11cGRhdGUnLCBub3cpO1xuXG4gICAgY29uc3QgZXZlbnRTbmFwc2hvdHMgPSBiYXRjaGVzLmZsYXQoKS5tYXAoKGpvYik9PihcbiAgICAgICAgW2pvYi5lbmRUaW1lLCBqb2IucmVzdWx0XVxuICAgICkpO1xuICAgIFxuICAgIC8vIFJlbmRlciBlYWNoIGpvYiBiYWNrZ3JvdW5kIGFuZCBmb3JlZ3JvdW5kXG4gICAgd2hpbGUoZGF0YUVsLmZpcnN0Q2hpbGQpIHtcbiAgICAgICAgZGF0YUVsLnJlbW92ZUNoaWxkKGRhdGFFbC5maXJzdENoaWxkKTtcbiAgICB9XG4gICAgZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlclNhZmV0eUxheWVyKGJhdGNoZXMsIG5vdykpO1xuICAgIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJKb2JMYXllcihiYXRjaGVzLCBub3cpKTtcbiAgICBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyU2VjdXJpdHlMYXllcihldmVudFNuYXBzaG90cywgc2VydmVyU25hcHNob3RzLCBub3cpKTtcbiAgICAvLyBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyTW9uZXlMYXllcihldmVudFNuYXBzaG90cywgc2VydmVyU25hcHNob3RzLCBub3cpKTtcbiAgICBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVyUHJvZml0TGF5ZXIoYmF0Y2hlcywgbm93KSk7XG5cbiAgICByZXR1cm4gZWw7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNlY3VyaXR5TGF5ZXIoZXZlbnRTbmFwc2hvdHM9W10sIHNlcnZlclNuYXBzaG90cz1bXSwgbm93KSB7XG4gICAgbGV0IG1pblNlYyA9IDA7XG4gICAgbGV0IG1heFNlYyA9IDE7XG4gICAgZm9yIChjb25zdCBzbmFwc2hvdHMgb2YgW2V2ZW50U25hcHNob3RzLCBzZXJ2ZXJTbmFwc2hvdHNdKSB7XG4gICAgICAgIGZvciAoY29uc3QgW3RpbWUsIHNlcnZlcl0gb2Ygc25hcHNob3RzKSB7XG4gICAgICAgICAgICBtaW5TZWMgPSBNYXRoLm1pbihtaW5TZWMsIHNlcnZlci5oYWNrRGlmZmljdWx0eSk7XG4gICAgICAgICAgICBtYXhTZWMgPSBNYXRoLm1heChtYXhTZWMsIHNlcnZlci5oYWNrRGlmZmljdWx0eSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBvYnNlcnZlZExheWVyID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJvYnNlcnZlZFNlY1wiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heFNlYyAtIG1pblNlYyl9KWAsXG4gICAgICAgICAgICBmaWxsOiBcImRhcmtcIitHUkFQSF9DT0xPUlMuc2VjdXJpdHksXG4gICAgICAgICAgICAvLyBcImZpbGwtb3BhY2l0eVwiOiAwLjUsXG4gICAgICAgICAgICBcImNsaXAtcGF0aFwiOiBgdXJsKCNoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfSlgXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIHJlbmRlck9ic2VydmVkUGF0aChcImhhY2tEaWZmaWN1bHR5XCIsIHNlcnZlclNuYXBzaG90cywgbWluU2VjLCBub3cpXG4gICAgICAgIF1cbiAgICApO1xuXG4gICAgY29uc3QgcHJvamVjdGVkTGF5ZXIgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInByb2plY3RlZFNlY1wiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heFNlYyAtIG1pblNlYyl9KWAsXG4gICAgICAgICAgICBzdHJva2U6IEdSQVBIX0NPTE9SUy5zZWN1cml0eSxcbiAgICAgICAgICAgIGZpbGw6IFwibm9uZVwiLFxuICAgICAgICAgICAgXCJzdHJva2Utd2lkdGhcIjogMixcbiAgICAgICAgICAgIFwic3Ryb2tlLWxpbmVqb2luXCI6XCJiZXZlbFwiXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIHJlbmRlclByb2plY3RlZFBhdGgoXCJoYWNrRGlmZmljdWx0eVwiLCBldmVudFNuYXBzaG90cywgbm93KVxuICAgICAgICBdXG4gICAgKTtcblxuICAgIGNvbnN0IHNlY0xheWVyID0gc3ZnRWwoXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInNlY0xheWVyXCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSAyKkZPT1RFUl9QSVhFTFN9KWBcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgb2JzZXJ2ZWRMYXllcixcbiAgICAgICAgICAgIHByb2plY3RlZExheWVyXG4gICAgICAgIF1cbiAgICApO1xuXG4gICAgcmV0dXJuIHNlY0xheWVyO1xufVxuXG5mdW5jdGlvbiByZW5kZXJPYnNlcnZlZFBhdGgocHJvcGVydHk9XCJoYWNrRGlmZmljdWx0eVwiLCBzZXJ2ZXJTbmFwc2hvdHM9W10sIG1pblZhbHVlPTAsIG5vdywgc2NhbGU9MSkge1xuICAgIGNvbnN0IHBhdGhEYXRhID0gW107XG4gICAgbGV0IHByZXZTZXJ2ZXI7XG4gICAgbGV0IHByZXZUaW1lO1xuICAgIGZvciAoY29uc3QgW3RpbWUsIHNlcnZlcl0gb2Ygc2VydmVyU25hcHNob3RzKSB7XG4gICAgICAgIGlmICh0aW1lIDwgbm93LShXSURUSF9TRUNPTkRTKjIqMTAwMCkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIC8vIGZpbGwgYXJlYSB1bmRlciBhY3R1YWwgc2VjdXJpdHlcbiAgICAgICAgaWYgKCFwcmV2U2VydmVyKSB7XG4gICAgICAgICAgICAvLyBzdGFydCBhdCBib3R0b20gbGVmdFxuICAgICAgICAgICAgcGF0aERhdGEucHVzaChgTSAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KG1pblZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwcmV2U2VydmVyKSB7XG4gICAgICAgICAgICAvLyB2ZXJ0aWNhbCBsaW5lIHRvIHByZXZpb3VzIGxldmVsXG4gICAgICAgICAgICAvLyBob3Jpem9udGFsIGxpbmUgdG8gY3VycmVudCB0aW1lXG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KHByZXZTZXJ2ZXJbcHJvcGVydHldKnNjYWxlKS50b0ZpeGVkKDIpfWAsIGBIICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgfVxuICAgICAgICBwcmV2U2VydmVyID0gc2VydmVyO1xuICAgICAgICBwcmV2VGltZSA9IHRpbWU7XG4gICAgfVxuICAgIC8vIGZpbGwgaW4gYXJlYSBiZXR3ZWVuIGxhc3Qgc25hcHNob3QgYW5kIFwibm93XCIgY3Vyc29yXG4gICAgaWYgKHByZXZTZXJ2ZXIpIHtcbiAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBwcmV2aW91cyBsZXZlbFxuICAgICAgICAvLyBob3Jpem9udGFsIGxpbmUgdG8gY3VycmVudCB0aW1lXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYFYgJHsocHJldlNlcnZlcltwcm9wZXJ0eV0qc2NhbGUpLnRvRml4ZWQoMil9YCwgYEggJHtjb252ZXJ0VGltZShub3cgKyA2MDAwMCkudG9GaXhlZCgzKX1gKTtcbiAgICB9XG4gICAgcGF0aERhdGEucHVzaChgViAke21pblZhbHVlfSBaYCk7XG4gICAgcmV0dXJuIHN2Z0VsKCdwYXRoJywge1xuICAgICAgICBkOiBwYXRoRGF0YS5qb2luKCcgJylcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyUHJvamVjdGVkUGF0aChwcm9wZXJ0eT1cImhhY2tEaWZmaWN1bHR5XCIsIGV2ZW50U25hcHNob3RzPVtdLCBub3csIHNjYWxlPTEpIHtcbiAgICBjb25zdCBwYXRoRGF0YSA9IFtdO1xuICAgIGxldCBwcmV2VGltZTtcbiAgICBsZXQgcHJldlNlcnZlcjtcbiAgICBmb3IgKGNvbnN0IFt0aW1lLCBzZXJ2ZXJdIG9mIGV2ZW50U25hcHNob3RzKSB7XG4gICAgICAgIGlmICh0aW1lIDwgbm93LShXSURUSF9TRUNPTkRTKjIqMTAwMCkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghcHJldlNlcnZlcikge1xuICAgICAgICAgICAgLy8gc3RhcnQgbGluZSBhdCBmaXJzdCBwcm9qZWN0ZWQgdGltZSBhbmQgdmFsdWVcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYE0gJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfSwkeyhzZXJ2ZXJbcHJvcGVydHldKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwcmV2U2VydmVyICYmIHRpbWUgPiBwcmV2VGltZSkge1xuICAgICAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBwcmV2aW91cyB2YWx1ZVxuICAgICAgICAgICAgLy8gaG9yaXpvbnRhbCBsaW5lIGZyb20gcHJldmlvdXMgdGltZSB0byBjdXJyZW50IHRpbWVcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYFYgJHsocHJldlNlcnZlcltwcm9wZXJ0eV0qc2NhbGUpLnRvRml4ZWQoMil9YCwgYEggJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfWApO1xuICAgICAgICB9XG4gICAgICAgIHByZXZUaW1lID0gdGltZTtcbiAgICAgICAgcHJldlNlcnZlciA9IHNlcnZlcjtcbiAgICB9XG4gICAgaWYgKHByZXZTZXJ2ZXIpIHtcbiAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBwcmV2aW91cyB2YWx1ZVxuICAgICAgICAvLyBob3Jpem9udGFsIGxpbmUgZnJvbSBwcmV2aW91cyB0aW1lIHRvIGZ1dHVyZVxuICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KHByZXZTZXJ2ZXJbcHJvcGVydHldKnNjYWxlKS50b0ZpeGVkKDIpfWAsIGBIICR7Y29udmVydFRpbWUobm93ICsgNjAwMDApLnRvRml4ZWQoMyl9YCk7XG4gICAgfVxuICAgIHJldHVybiBzdmdFbCgncGF0aCcsIHtcbiAgICAgICAgZDogcGF0aERhdGEuam9pbignICcpLFxuICAgICAgICBcInZlY3Rvci1lZmZlY3RcIjogXCJub24tc2NhbGluZy1zdHJva2VcIlxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJQcm9maXRQYXRoKGJhdGNoZXM9W10sIG5vdywgc2NhbGU9MSkge1xuICAgIC8vIHdvdWxkIGxpa2UgdG8gZ3JhcGggbW9uZXkgcGVyIHNlY29uZCBvdmVyIHRpbWVcbiAgICAvLyBjb25zdCBtb25leVRha2VuID0gW107XG4gICAgY29uc3QgdG90YWxNb25leVRha2VuID0gW107XG4gICAgbGV0IHJ1bm5pbmdUb3RhbCA9IDA7XG4gICAgZm9yIChjb25zdCBiYXRjaCBvZiBiYXRjaGVzKSB7XG4gICAgICAgIGZvciAoY29uc3Qgam9iIG9mIGJhdGNoKSB7XG4gICAgICAgICAgICBpZiAoam9iLnRhc2sgPT0gJ2hhY2snICYmIGpvYi5lbmRUaW1lQWN0dWFsKSB7XG4gICAgICAgICAgICAgICAgLy8gbW9uZXlUYWtlbi5wdXNoKFtqb2IuZW5kVGltZUFjdHVhbCwgam9iLnJlc3VsdEFjdHVhbF0pO1xuICAgICAgICAgICAgICAgIHJ1bm5pbmdUb3RhbCArPSBqb2IucmVzdWx0QWN0dWFsO1xuICAgICAgICAgICAgICAgIHRvdGFsTW9uZXlUYWtlbi5wdXNoKFtqb2IuZW5kVGltZUFjdHVhbCwgcnVubmluZ1RvdGFsXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChqb2IudGFzayA9PSAnaGFjaycgJiYgIWpvYi5jYW5jZWxsZWQpIHtcbiAgICAgICAgICAgICAgICBydW5uaW5nVG90YWwgKz0gam9iLmNoYW5nZS5wbGF5ZXJNb25leTtcbiAgICAgICAgICAgICAgICB0b3RhbE1vbmV5VGFrZW4ucHVzaChbam9iLmVuZFRpbWUsIHJ1bm5pbmdUb3RhbF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHRvdGFsTW9uZXlUYWtlbi5wdXNoKFtub3cgKyAzMDAwMCwgcnVubmluZ1RvdGFsXSk7XG4gICAgLy8gbW9uZXkgdGFrZW4gaW4gdGhlIGxhc3QgWCBzZWNvbmRzIGNvdWxkIGJlIGNvdW50ZWQgd2l0aCBhIHNsaWRpbmcgd2luZG93LlxuICAgIC8vIGJ1dCB0aGUgcmVjb3JkZWQgZXZlbnRzIGFyZSBub3QgZXZlbmx5IHNwYWNlZC5cbiAgICBjb25zdCBtb3ZpbmdBdmVyYWdlID0gW107XG4gICAgbGV0IG1heFByb2ZpdCA9IDA7XG4gICAgbGV0IGogPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdG90YWxNb25leVRha2VuLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IFt0aW1lLCBtb25leV0gPSB0b3RhbE1vbmV5VGFrZW5baV07XG4gICAgICAgIHdoaWxlICh0b3RhbE1vbmV5VGFrZW5bal1bMF0gPD0gdGltZSAtIDIwMDApIHtcbiAgICAgICAgICAgIGorKztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwcm9maXQgPSB0b3RhbE1vbmV5VGFrZW5baV1bMV0gLSB0b3RhbE1vbmV5VGFrZW5bal1bMV07XG4gICAgICAgIG1vdmluZ0F2ZXJhZ2UucHVzaChbdGltZSwgcHJvZml0XSk7XG4gICAgICAgIG1heFByb2ZpdCA9IE1hdGgubWF4KG1heFByb2ZpdCwgcHJvZml0KTtcbiAgICB9XG4gICAgZXZhbChcIndpbmRvd1wiKS5wcm9maXREYXRhID0gW3RvdGFsTW9uZXlUYWtlbiwgcnVubmluZ1RvdGFsLCBtb3ZpbmdBdmVyYWdlXTtcbiAgICBjb25zdCBwYXRoRGF0YSA9IFtcIk0gMCwwXCJdO1xuICAgIGxldCBwcmV2VGltZTtcbiAgICBsZXQgcHJldlByb2ZpdDtcbiAgICBmb3IgKGNvbnN0IFt0aW1lLCBwcm9maXRdIG9mIG1vdmluZ0F2ZXJhZ2UpIHtcbiAgICAgICAgLy8gcGF0aERhdGEucHVzaChgTCAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJvZml0L21heFByb2ZpdCkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgaWYgKHByZXZQcm9maXQpIHtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYEMgJHtjb252ZXJ0VGltZSgocHJldlRpbWUqMyArIHRpbWUpLzQpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJldlByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9ICR7Y29udmVydFRpbWUoKHByZXZUaW1lICsgMyp0aW1lKS80KS50b0ZpeGVkKDMpfSwkeyhzY2FsZSAqIHByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9ICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX0sJHsoc2NhbGUgKiBwcm9maXQvbWF4UHJvZml0KS50b0ZpeGVkKDMpfWApXG4gICAgICAgIH1cbiAgICAgICAgcHJldlRpbWUgPSB0aW1lO1xuICAgICAgICBwcmV2UHJvZml0ID0gcHJvZml0O1xuICAgIH1cbiAgICBwYXRoRGF0YS5wdXNoKGBIICR7Y29udmVydFRpbWUobm93KzYwMDAwKS50b0ZpeGVkKDMpfSBWIDAgWmApO1xuICAgIHJldHVybiBzdmdFbCgncGF0aCcsIHtcbiAgICAgICAgZDogcGF0aERhdGEuam9pbignICcpLFxuICAgICAgICBcInZlY3Rvci1lZmZlY3RcIjogXCJub24tc2NhbGluZy1zdHJva2VcIlxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJQcm9maXRMYXllcihiYXRjaGVzPVtdLCBub3cpIHtcbiAgICBjb25zdCBwcm9maXRQYXRoID0gcmVuZGVyUHJvZml0UGF0aChiYXRjaGVzLCBub3cpO1xuICAgIGNvbnN0IG9ic2VydmVkUHJvZml0ID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJvYnNlcnZlZFByb2ZpdFwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTfSlgLFxuICAgICAgICAgICAgZmlsbDogXCJkYXJrXCIrR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgXCJjbGlwLXBhdGhcIjogYHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYFxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBwcm9maXRQYXRoXG4gICAgICAgIF1cbiAgICApO1xuICAgIGNvbnN0IHByb2plY3RlZFByb2ZpdCA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwicHJvamVjdGVkUHJvZml0XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFN9KWAsXG4gICAgICAgICAgICBmaWxsOiBcIm5vbmVcIixcbiAgICAgICAgICAgIHN0cm9rZTogR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgXCJzdHJva2Utd2lkdGhcIjogMixcbiAgICAgICAgICAgIFwic3Ryb2tlLWxpbmVqb2luXCI6XCJyb3VuZFwiXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIHByb2ZpdFBhdGguY2xvbmVOb2RlKClcbiAgICAgICAgXVxuICAgICk7XG4gICAgY29uc3QgcHJvZml0TGF5ZXIgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInByb2ZpdExheWVyXCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTfSlgXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIG9ic2VydmVkUHJvZml0LFxuICAgICAgICAgICAgcHJvamVjdGVkUHJvZml0XG4gICAgICAgIF1cbiAgICApO1xuICAgIHJldHVybiBwcm9maXRMYXllcjtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTW9uZXlMYXllcihldmVudFNuYXBzaG90cz1bXSwgc2VydmVyU25hcHNob3RzPVtdLCBub3cpIHtcbiAgICBjb25zdCBtb25leUxheWVyID0gc3ZnRWwoXCJnXCIsIHtcbiAgICAgICAgaWQ6IFwibW9uZXlMYXllclwiLFxuICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTfSlgXG4gICAgfSk7XG5cbiAgICBpZiAoc2VydmVyU25hcHNob3RzLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgIHJldHVybiBtb25leUxheWVyO1xuICAgIH1cbiAgICBsZXQgbWluTW9uZXkgPSAwO1xuICAgIGxldCBtYXhNb25leSA9IHNlcnZlclNuYXBzaG90c1swXVsxXS5tb25leU1heDtcbiAgICBjb25zdCBzY2FsZSA9IDEvbWF4TW9uZXk7XG4gICAgbWF4TW9uZXkgKj0gMS4xXG5cbiAgICBjb25zdCBvYnNlcnZlZExheWVyID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJvYnNlcnZlZE1vbmV5XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4TW9uZXkgLSBtaW5Nb25leSkgLyBzY2FsZX0pYCxcbiAgICAgICAgICAgIGZpbGw6IFwiZGFya1wiK0dSQVBIX0NPTE9SUy5tb25leSxcbiAgICAgICAgICAgIC8vIFwiZmlsbC1vcGFjaXR5XCI6IDAuNSxcbiAgICAgICAgICAgIFwiY2xpcC1wYXRoXCI6IGB1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWBcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgcmVuZGVyT2JzZXJ2ZWRQYXRoKFwibW9uZXlBdmFpbGFibGVcIiwgc2VydmVyU25hcHNob3RzLCBtaW5Nb25leSwgbm93LCBzY2FsZSlcbiAgICAgICAgXVxuICAgICk7XG4gICAgbW9uZXlMYXllci5hcHBlbmQob2JzZXJ2ZWRMYXllcik7XG5cbiAgICBjb25zdCBwcm9qZWN0ZWRMYXllciA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwicHJvamVjdGVkTW9uZXlcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhNb25leSAtIG1pbk1vbmV5KSAvIHNjYWxlfSlgLFxuICAgICAgICAgICAgc3Ryb2tlOiBHUkFQSF9DT0xPUlMubW9uZXksXG4gICAgICAgICAgICBmaWxsOiBcIm5vbmVcIixcbiAgICAgICAgICAgIFwic3Ryb2tlLXdpZHRoXCI6IDIsXG4gICAgICAgICAgICBcInN0cm9rZS1saW5lam9pblwiOlwiYmV2ZWxcIlxuICAgICAgICB9LCBbXG4gICAgICAgICAgICByZW5kZXJQcm9qZWN0ZWRQYXRoKFwibW9uZXlBdmFpbGFibGVcIiwgZXZlbnRTbmFwc2hvdHMsIG5vdywgc2NhbGUpXG4gICAgICAgIF1cbiAgICApO1xuICAgIG1vbmV5TGF5ZXIuYXBwZW5kKHByb2plY3RlZExheWVyKTtcblxuICAgIHJldHVybiBtb25leUxheWVyO1xufVxuXG5mdW5jdGlvbiByZW5kZXJTYWZldHlMYXllcihiYXRjaGVzPVtdLCBub3cpIHtcbiAgICBjb25zdCBzYWZldHlMYXllciA9IHN2Z0VsKCdnJywge2lkOlwic2FmZXR5TGF5ZXJcIn0pO1xuXG4gICAgbGV0IHByZXZKb2I7ICAgIFxuICAgIGZvciAoY29uc3QgYmF0Y2ggb2YgYmF0Y2hlcykge1xuICAgICAgICBmb3IgKGNvbnN0IGpvYiBvZiBiYXRjaCkge1xuICAgICAgICAgICAgaWYgKChqb2IuZW5kVGltZUFjdHVhbCB8fCBqb2IuZW5kVGltZSkgPCBub3ctKFdJRFRIX1NFQ09ORFMqMioxMDAwKSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBzaGFkZSB0aGUgYmFja2dyb3VuZCBiYXNlZCBvbiBzZWNMZXZlbFxuICAgICAgICAgICAgaWYgKHByZXZKb2IgJiYgam9iLmVuZFRpbWUgPiBwcmV2Sm9iLmVuZFRpbWUpIHtcbiAgICAgICAgICAgICAgICBzYWZldHlMYXllci5hcHBlbmRDaGlsZChzdmdFbCgncmVjdCcsIHtcbiAgICAgICAgICAgICAgICAgICAgeDogY29udmVydFRpbWUocHJldkpvYi5lbmRUaW1lKSwgd2lkdGg6IGNvbnZlcnRUaW1lKGpvYi5lbmRUaW1lIC0gcHJldkpvYi5lbmRUaW1lLCAwKSxcbiAgICAgICAgICAgICAgICAgICAgeTogMCwgaGVpZ2h0OiBcIjEwMCVcIixcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogKHByZXZKb2IucmVzdWx0LmhhY2tEaWZmaWN1bHR5ID4gcHJldkpvYi5yZXN1bHQubWluRGlmZmljdWx0eSkgPyBHUkFQSF9DT0xPUlMudW5zYWZlIDogR1JBUEhfQ09MT1JTLnNhZmVcbiAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwcmV2Sm9iID0gam9iO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChwcmV2Sm9iKSB7XG4gICAgICAgIHNhZmV0eUxheWVyLmFwcGVuZENoaWxkKHN2Z0VsKCdyZWN0Jywge1xuICAgICAgICAgICAgeDogY29udmVydFRpbWUocHJldkpvYi5lbmRUaW1lKSwgd2lkdGg6IGNvbnZlcnRUaW1lKDEwMDAwLCAwKSxcbiAgICAgICAgICAgIHk6IDAsIGhlaWdodDogXCIxMDAlXCIsXG4gICAgICAgICAgICBmaWxsOiAocHJldkpvYi5yZXN1bHQuaGFja0RpZmZpY3VsdHkgPiBwcmV2Sm9iLnJlc3VsdC5taW5EaWZmaWN1bHR5KSA/IEdSQVBIX0NPTE9SUy51bnNhZmUgOiBHUkFQSF9DT0xPUlMuc2FmZVxuICAgICAgICB9KSk7XG4gICAgfVxuICAgIHJldHVybiBzYWZldHlMYXllcjtcbn1cblxuZnVuY3Rpb24gcmVuZGVySm9iTGF5ZXIoYmF0Y2hlcz1bXSwgbm93KSB7XG4gICAgY29uc3Qgam9iTGF5ZXIgPSBzdmdFbCgnZycsIHtpZDpcImpvYkxheWVyXCJ9KTtcblxuICAgIGxldCBpID0gMDtcbiAgICBmb3IgKGNvbnN0IGJhdGNoIG9mIGJhdGNoZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBqb2Igb2YgYmF0Y2gpIHtcbiAgICAgICAgICAgIGkgPSAoaSArIDEpICUgKChIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMUyoyKSAvIDQpO1xuICAgICAgICAgICAgaWYgKChqb2IuZW5kVGltZUFjdHVhbCB8fCBqb2IuZW5kVGltZSkgPCBub3ctKFdJRFRIX1NFQ09ORFMqMioxMDAwKSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gZHJhdyB0aGUgam9iIGJhcnNcbiAgICAgICAgICAgIGxldCBjb2xvciA9IEdSQVBIX0NPTE9SU1tqb2IudGFza107XG4gICAgICAgICAgICBpZiAoam9iLmNhbmNlbGxlZCkge1xuICAgICAgICAgICAgICAgIGNvbG9yID0gR1JBUEhfQ09MT1JTLmNhbmNlbGxlZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGpvYkxheWVyLmFwcGVuZENoaWxkKHN2Z0VsKCdyZWN0Jywge1xuICAgICAgICAgICAgICAgIHg6IGNvbnZlcnRUaW1lKGpvYi5zdGFydFRpbWUpLCB3aWR0aDogY29udmVydFRpbWUoam9iLmR1cmF0aW9uLCAwKSxcbiAgICAgICAgICAgICAgICB5OiBpKjQsIGhlaWdodDogMixcbiAgICAgICAgICAgICAgICBmaWxsOiBjb2xvclxuICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgLy8gZHJhdyB0aGUgZXJyb3IgYmFyc1xuICAgICAgICAgICAgaWYgKGpvYi5zdGFydFRpbWVBY3R1YWwpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBbdDEsIHQyXSA9IFtqb2Iuc3RhcnRUaW1lLCBqb2Iuc3RhcnRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICAgICAgICAgIGpvYkxheWVyLmFwcGVuZENoaWxkKHN2Z0VsKCdyZWN0Jywge1xuICAgICAgICAgICAgICAgICAgICB4OiBjb252ZXJ0VGltZSh0MSksIHdpZHRoOiBjb252ZXJ0VGltZSh0Mi10MSwgMCksXG4gICAgICAgICAgICAgICAgICAgIHk6IGkqNCwgaGVpZ2h0OiAxLFxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBHUkFQSF9DT0xPUlMuZGVzeW5jXG4gICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGpvYi5lbmRUaW1lQWN0dWFsKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgW3QxLCB0Ml0gPSBbam9iLmVuZFRpbWUsIGpvYi5lbmRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICAgICAgICAgIGpvYkxheWVyLmFwcGVuZENoaWxkKHN2Z0VsKCdyZWN0Jywge1xuICAgICAgICAgICAgICAgICAgICB4OiBjb252ZXJ0VGltZSh0MSksIHdpZHRoOiBjb252ZXJ0VGltZSh0Mi10MSwgMCksXG4gICAgICAgICAgICAgICAgICAgIHk6IGkqNCwgaGVpZ2h0OiAxLFxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBHUkFQSF9DT0xPUlMuZGVzeW5jXG4gICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIHNwYWNlIGJldHdlZW4gYmF0Y2hlc1xuICAgICAgICBpKys7XG4gICAgfVxuICAgIHJldHVybiBqb2JMYXllcjtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTGVnZW5kKCkge1xuICAgIGNvbnN0IGxlZ2VuZEVsID0gc3ZnRWwoJ2cnLFxuICAgICAgICB7aWQ6IFwiTGVnZW5kXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGUoLTQ4MCwgMTApLCBzY2FsZSguNSwgLjUpXCJ9LFxuICAgICAgICBbWydyZWN0Jywge3g6IDEsIHk6IDEsIHdpZHRoOiAyNzUsIGhlaWdodDogMzkyLCBmaWxsOiBcImJsYWNrXCIsIHN0cm9rZTogXCIjOTc5Nzk3XCJ9XV1cbiAgICApO1xuICAgIGxldCB5ID0gMTM7XG4gICAgZm9yIChjb25zdCBbbGFiZWwsIGNvbG9yXSBvZiBPYmplY3QuZW50cmllcyhHUkFQSF9DT0xPUlMpKSB7XG4gICAgICAgIGxlZ2VuZEVsLmFwcGVuZENoaWxkKHN2Z0VsKCdnJywge3RyYW5zZm9ybTogYHRyYW5zbGF0ZSgyMiwgJHt5fSlgfSwgW1xuICAgICAgICAgICAgWydyZWN0Jywge3g6MCwgeToxMCwgd2lkdGg6IDIyLCBoZWlnaHQ6IDIyLCBmaWxsOiBjb2xvcn1dLFxuICAgICAgICAgICAgWyd0ZXh0Jywge1wiZm9udC1mYW1pbHlcIjpcIkNvdXJpZXIgTmV3XCIsIFwiZm9udC1zaXplXCI6MzYsIGZpbGw6IFwiIzg4OFwifSwgW1xuICAgICAgICAgICAgICAgIFsndHNwYW4nLCB7eDo0Mi41LCB5OjMwfSwgW2xhYmVsLnN1YnN0cmluZygwLDEpLnRvVXBwZXJDYXNlKCkrbGFiZWwuc3Vic3RyaW5nKDEpXV1cbiAgICAgICAgICAgIF1dXG4gICAgICAgIF0pKTtcbiAgICAgICAgeSArPSA0MTtcbiAgICB9XG4gICAgcmV0dXJuIGxlZ2VuZEVsO1xufVxuXG4vKiAtLS0tLS0tLS0tIGxpYnJhcnkgZnVuY3Rpb25zIC0tLS0tLS0tLS0gKi9cblxuLyoqIENyZWF0ZSBhbiBTVkcgRWxlbWVudCB0aGF0IGNhbiBiZSBkaXNwbGF5ZWQgaW4gdGhlIERPTS4gKi9cbmZ1bmN0aW9uIHN2Z0VsKHRhZ05hbWUsIGF0dHJpYnV0ZXM9e30sIGNoaWxkcmVuPVtdKSB7XG4gICAgY29uc3QgZG9jID0gZXZhbChcImRvY3VtZW50XCIpO1xuICAgIGNvbnN0IHhtbG5zID0gJ2h0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnJztcbiAgICBjb25zdCBlbCA9IGRvYy5jcmVhdGVFbGVtZW50TlMoeG1sbnMsIHRhZ05hbWUpO1xuICAgIC8vIHN1cHBvcnQgZXhwb3J0aW5nIG91dGVySFRNTFxuICAgIGlmICh0YWdOYW1lLnRvTG93ZXJDYXNlKCkgPT0gJ3N2ZycpIHtcbiAgICAgICAgYXR0cmlidXRlc1sneG1sbnMnXSA9IHhtbG5zO1xuICAgIH1cbiAgICAvLyBzZXQgYWxsIGF0dHJpYnV0ZXNcbiAgICBmb3IgKGNvbnN0IFtuYW1lLCB2YWxdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICAgIGVsLnNldEF0dHJpYnV0ZShuYW1lLCB2YWwpO1xuICAgIH1cbiAgICAvLyBhcHBlbmQgYWxsIGNoaWxkcmVuXG4gICAgZm9yIChsZXQgY2hpbGQgb2YgY2hpbGRyZW4pIHtcbiAgICAgICAgLy8gcmVjdXJzaXZlbHkgY29uc3RydWN0IGNoaWxkIGVsZW1lbnRzXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNoaWxkKSkge1xuICAgICAgICAgICAgY2hpbGQgPSBzdmdFbCguLi5jaGlsZCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAodHlwZW9mKGNoaWxkKSA9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgY2hpbGQgPSBkb2MuY3JlYXRlVGV4dE5vZGUoY2hpbGQpO1xuICAgICAgICB9XG4gICAgICAgIGVsLmFwcGVuZENoaWxkKGNoaWxkKTtcbiAgICB9XG4gICAgcmV0dXJuIGVsO1xufVxuXG4vKiogSW5zZXJ0IGFuIGVsZW1lbnQgaW50byB0aGUgbmV0c2NyaXB0IHByb2Nlc3MncyB0YWlsIHdpbmRvdy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2dIVE1MKG5zLCBlbCkge1xuICAgIG5zLnRhaWwoKTtcbiAgICBjb25zdCBkb2MgPSBldmFsKCdkb2N1bWVudCcpO1xuICAgIGNvbnN0IGNvbW1hbmQgPSBucy5nZXRTY3JpcHROYW1lKCkgKyAnICcgKyBucy5hcmdzLmpvaW4oJyAnKTtcbiAgICBjb25zdCBsb2dFbCA9IGRvYy5xdWVyeVNlbGVjdG9yKGBbdGl0bGU9XCIke2NvbW1hbmR9XCJdYCkucGFyZW50RWxlbWVudC5uZXh0RWxlbWVudFNpYmxpbmcucXVlcnlTZWxlY3Rvcignc3BhbicpO1xuICAgIGxvZ0VsLmFwcGVuZENoaWxkKGVsKTtcbn1cblxuLyogLS0tLS0gKi9cblxuIl19