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
    let prevJob;
    jobs = jobs.filter((job) => (job.result !== undefined));
    return (React.createElement("g", { id: "safetyLayer" },
        jobs.map((job) => {
            let el = null;
            // shade the background based on secLevel
            if (prevJob && job.endTime > prevJob.endTime) {
                el = (React.createElement("rect", { key: job.jobID, x: convertTime(prevJob.endTime), width: convertTime(job.endTime - prevJob.endTime, 0), y: 0, height: "100%", fill: (prevJob.result.hackDifficulty > prevJob.result.minDifficulty) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe }));
            }
            prevJob = job;
            return el;
        }),
        prevJob && (React.createElement("rect", { key: "remainder", x: convertTime(prevJob.endTime), width: convertTime(10000, 0), y: 0, height: "100%", fill: (prevJob.result.hackDifficulty > prevJob.result.minDifficulty) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe }))));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFHQSxNQUFNLEtBQUssR0FBRyxVQUFVLENBQUMsS0FBOEIsQ0FBQztBQUN4RCxNQUFNLFFBQVEsR0FBRyxVQUFVLENBQUMsUUFBb0MsQ0FBQztBQVNqRSxJQUFJLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFZLENBQUM7QUFDM0M7Ozs7R0FJRztBQUNILFNBQVMsV0FBVyxDQUFDLENBQVMsRUFBRSxFQUFFLEdBQUMsUUFBUTtJQUN2QyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFnQixDQUFDO0FBQzVDLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxDQUFjO0lBQ2xDLE9BQU8sQ0FBQyxHQUFHLFlBQVksR0FBRyxhQUEyQixDQUFDO0FBQzFELENBQUM7QUFFRCxNQUFNLFlBQVksR0FBRztJQUNqQixNQUFNLEVBQUUsTUFBTTtJQUNkLE1BQU0sRUFBRSxZQUFZO0lBQ3BCLFFBQVEsRUFBRSxRQUFRO0lBQ2xCLFdBQVcsRUFBRSxLQUFLO0lBQ2xCLFFBQVEsRUFBRSxTQUFTO0lBQ25CLE1BQU0sRUFBRSxNQUFNO0lBQ2QsUUFBUSxFQUFFLE1BQU07SUFDaEIsVUFBVSxFQUFFLEtBQUs7SUFDakIsT0FBTyxFQUFFLE1BQU07Q0FDbEIsQ0FBQztBQUVGLE1BQU0sWUFBWSxHQUFHLEdBQWlCLENBQUM7QUFDdkMsTUFBTSxhQUFhLEdBQUcsRUFBaUIsQ0FBQztBQUN4QyxNQUFNLGFBQWEsR0FBRyxHQUFhLENBQUM7QUFDcEMsTUFBTSxhQUFhLEdBQUcsRUFBWSxDQUFDO0FBNEJuQyxtQkFBbUI7QUFFbkIsTUFBTSxLQUFLLEdBQXFEO0lBQzVELENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQztJQUNmLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztDQUNkLENBQUM7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QUFDLElBQUksRUFBRSxDQUFDO0lBQ1YsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQzdCLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQyxhQUFhLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDN0QsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLGFBQWEsQ0FBQyxXQUFXLE9BQU8sSUFBSSxDQUFDLENBQUMsYUFBYSxDQUFDLGtCQUFrQixDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUMvRyxLQUFLLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQzFCLENBQUM7QUFFRCxXQUFXIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBOUywgTmV0c2NyaXB0UG9ydCB9IGZyb20gJ0Bucyc7XG5pbXBvcnQgdHlwZSBSZWFjdE5hbWVzcGFjZSBmcm9tICdyZWFjdC9pbmRleCc7XG5pbXBvcnQgdHlwZSBSZWFjdERvbU5hbWVzcGFjZSBmcm9tICdyZWFjdC1kb20nO1xuY29uc3QgUmVhY3QgPSBnbG9iYWxUaGlzLlJlYWN0IGFzIHR5cGVvZiBSZWFjdE5hbWVzcGFjZTtcbmNvbnN0IFJlYWN0RE9NID0gZ2xvYmFsVGhpcy5SZWFjdERPTSBhcyB0eXBlb2YgUmVhY3REb21OYW1lc3BhY2U7XG5cbi8vIC0tLS0tIGNvbnN0YW50cyAtLS0tLSBcblxudHlwZSBUaW1lTXMgPSBSZXR1cm5UeXBlPHR5cGVvZiBwZXJmb3JtYW5jZS5ub3c+ICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwibWlsbGlzZWNvbmRzXCIgfTtcbnR5cGUgVGltZVNlY29uZHMgPSBudW1iZXIgJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJzZWNvbmRzXCIgfTtcbnR5cGUgVGltZVBpeGVscyA9IG51bWJlciAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcInBpeGVsc1wiIH07XG50eXBlIFBpeGVscyA9IG51bWJlciAmIHsgX191bml0czogXCJwaXhlbHNcIiB9O1xuXG5sZXQgaW5pdFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXM7XG4vKipcbiAqIENvbnZlcnQgdGltZXN0YW1wcyB0byBzZWNvbmRzIHNpbmNlIHRoZSBncmFwaCB3YXMgc3RhcnRlZC5cbiAqIFRvIHJlbmRlciBTVkdzIHVzaW5nIG5hdGl2ZSB0aW1lIHVuaXRzLCB0aGUgdmFsdWVzIG11c3QgYmUgdmFsaWQgMzItYml0IGludHMuXG4gKiBTbyB3ZSBjb252ZXJ0IHRvIGEgcmVjZW50IGVwb2NoIGluIGNhc2UgRGF0ZS5ub3coKSB2YWx1ZXMgYXJlIHVzZWQuXG4gKi9cbmZ1bmN0aW9uIGNvbnZlcnRUaW1lKHQ6IFRpbWVNcywgdDA9aW5pdFRpbWUpOiBUaW1lU2Vjb25kcyB7XG4gICAgcmV0dXJuICgodCAtIHQwKSAvIDEwMDApIGFzIFRpbWVTZWNvbmRzO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0U2VjVG9QeCh0OiBUaW1lU2Vjb25kcyk6IFRpbWVQaXhlbHMge1xuICAgIHJldHVybiB0ICogV0lEVEhfUElYRUxTIC8gV0lEVEhfU0VDT05EUyBhcyBUaW1lUGl4ZWxzO1xufVxuXG5jb25zdCBHUkFQSF9DT0xPUlMgPSB7XG4gICAgXCJoYWNrXCI6IFwiY3lhblwiLFxuICAgIFwiZ3Jvd1wiOiBcImxpZ2h0Z3JlZW5cIixcbiAgICBcIndlYWtlblwiOiBcInllbGxvd1wiLFxuICAgIFwiY2FuY2VsbGVkXCI6IFwicmVkXCIsXG4gICAgXCJkZXN5bmNcIjogXCJtYWdlbnRhXCIsXG4gICAgXCJzYWZlXCI6IFwiIzExMVwiLFxuICAgIFwidW5zYWZlXCI6IFwiIzMzM1wiLFxuICAgIFwic2VjdXJpdHlcIjogXCJyZWRcIixcbiAgICBcIm1vbmV5XCI6IFwiYmx1ZVwiXG59O1xuXG5jb25zdCBXSURUSF9QSVhFTFMgPSA4MDAgYXMgVGltZVBpeGVscztcbmNvbnN0IFdJRFRIX1NFQ09ORFMgPSAxNiBhcyBUaW1lU2Vjb25kcztcbmNvbnN0IEhFSUdIVF9QSVhFTFMgPSA2MDAgYXMgUGl4ZWxzO1xuY29uc3QgRk9PVEVSX1BJWEVMUyA9IDUwIGFzIFBpeGVscztcblxuLy8gLS0tLS0gdHlwZXMgLS0tLS1cblxuLyoqXG4gKiBKb2JcbiAqL1xuaW50ZXJmYWNlIEpvYiB7XG4gICAgam9iSUQ6IHN0cmluZyB8IG51bWJlcjtcbiAgICByb3dJRDogbnVtYmVyO1xuICAgIHRhc2s6IFwiaGFja1wiIHwgXCJncm93XCIgfCBcIndlYWtlblwiO1xuICAgIGR1cmF0aW9uOiBUaW1lTXM7XG4gICAgc3RhcnRUaW1lOiBUaW1lTXM7XG4gICAgc3RhcnRUaW1lQWN0dWFsOiBUaW1lTXM7XG4gICAgZW5kVGltZTogVGltZU1zO1xuICAgIGVuZFRpbWVBY3R1YWw6IFRpbWVNcztcbiAgICBjYW5jZWxsZWQ6IGJvb2xlYW47XG4gICAgcmVzdWx0OiB7XG4gICAgICAgIGhhY2tEaWZmaWN1bHR5OiBudW1iZXI7XG4gICAgICAgIG1pbkRpZmZpY3VsdHk6IG51bWJlcjtcbiAgICB9O1xuICAgIHJlc3VsdEFjdHVhbDogbnVtYmVyO1xuICAgIGNoYW5nZToge1xuICAgICAgICBwbGF5ZXJNb25leTogbnVtYmVyO1xuICAgIH07XG59XG5cblxuLy8gLS0tLS0gbWFpbiAtLS0tLVxuXG5jb25zdCBGTEFHUzogW3N0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IHN0cmluZ1tdXVtdID0gW1xuICAgIFtcImhlbHBcIiwgZmFsc2VdLFxuICAgIFtcInBvcnRcIiwgMF1cbl07XG5cbmV4cG9ydCBmdW5jdGlvbiBhdXRvY29tcGxldGUoZGF0YTogYW55LCBhcmdzOiBzdHJpbmdbXSkge1xuICAgIGRhdGEuZmxhZ3MoRkxBR1MpO1xuICAgIHJldHVybiBbXTtcbn1cblxuLyoqIEBwYXJhbSB7TlN9IG5zICoqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1haW4obnM6IE5TKSB7XG4gICAgbnMuZGlzYWJsZUxvZygnc2xlZXAnKTtcbiAgICBucy5jbGVhckxvZygpO1xuICAgIG5zLnRhaWwoKTtcbiAgICBucy5yZXNpemVUYWlsKDgxMCwgNjQwKTtcblxuICAgIGNvbnN0IGZsYWdzID0gbnMuZmxhZ3MoRkxBR1MpO1xuICAgIGlmIChmbGFncy5oZWxwKSB7XG4gICAgICAgIG5zLnRwcmludChbXG4gICAgICAgICAgICBgVVNBR0VgLFxuICAgICAgICAgICAgYD4gcnVuICR7bnMuZ2V0U2NyaXB0TmFtZSgpfSAtLXBvcnQgMWAsXG4gICAgICAgICAgICAnICdcbiAgICAgICAgXS5qb2luKFwiXFxuXCIpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBvcnROdW0gPSBmbGFncy5wb3J0IGFzIG51bWJlciB8fCBucy5waWQ7XG4gICAgY29uc3QgcG9ydCA9IG5zLmdldFBvcnRIYW5kbGUocG9ydE51bSk7XG4gICAgLy8gcG9ydC5jbGVhcigpO1xuICAgIG5zLnByaW50KGBMaXN0ZW5pbmcgb24gUG9ydCAke3BvcnROdW19YCk7XG5cbiAgICBjb25zdCBiYXRjaFZpZXcgPSA8QmF0Y2hWaWV3IG5zPXtuc30gcG9ydE51bT17cG9ydE51bX0gLz47XG4gICAgbnMucHJpbnRSYXcoYmF0Y2hWaWV3KTtcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGF3YWl0IHBvcnQubmV4dFdyaXRlKCk7XG4gICAgfVxufVxuXG4vLyAtLS0tLSBCYXRjaFZpZXcgLS0tLS1cblxuaW50ZXJmYWNlIEJhdGNoVmlld1Byb3BzIHtcbiAgICBuczogTlM7XG4gICAgcG9ydE51bTogbnVtYmVyO1xufVxuaW50ZXJmYWNlIEJhdGNoVmlld1N0YXRlIHtcbiAgICBydW5uaW5nOiBib29sZWFuO1xuICAgIG5vdzogVGltZU1zO1xufVxuZXhwb3J0IGNsYXNzIEJhdGNoVmlldyBleHRlbmRzIFJlYWN0LkNvbXBvbmVudDxCYXRjaFZpZXdQcm9wcywgQmF0Y2hWaWV3U3RhdGU+IHtcbiAgICBwb3J0OiBOZXRzY3JpcHRQb3J0O1xuICAgIGpvYnM6IE1hcDxzdHJpbmcgfCBudW1iZXIsIEpvYj47XG4gICAgblJvd3M6IG51bWJlcjtcblxuICAgIGNvbnN0cnVjdG9yKHByb3BzOiBCYXRjaFZpZXdQcm9wcyl7XG4gICAgICAgIHN1cGVyKHByb3BzKTtcbiAgICAgICAgY29uc3QgeyBucywgcG9ydE51bSB9ID0gcHJvcHM7XG4gICAgICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICAgICAgICBydW5uaW5nOiB0cnVlLFxuICAgICAgICAgICAgbm93OiBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXNcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5wb3J0ID0gbnMuZ2V0UG9ydEhhbmRsZShwb3J0TnVtKTtcbiAgICAgICAgdGhpcy5qb2JzID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLm5Sb3dzID0gMDtcbiAgICB9XG5cbiAgICBjb21wb25lbnREaWRNb3VudCgpIHtcbiAgICAgICAgY29uc3QgeyBucyB9ID0gdGhpcy5wcm9wcztcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogdHJ1ZX0pO1xuICAgICAgICBucy5hdEV4aXQoKCk9PntcbiAgICAgICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IGZhbHNlfSk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnJlYWRQb3J0KCk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZSgpO1xuICAgICAgICAvLyBPYmplY3QuYXNzaWduKGdsb2JhbFRoaXMsIHtiYXRjaFZpZXc6IHRoaXN9KTtcbiAgICB9XG5cbiAgICBjb21wb25lbnRXaWxsVW5tb3VudCgpIHtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogZmFsc2V9KTtcbiAgICB9XG5cbiAgICBhZGRKb2Ioam9iOiBKb2IpIHtcbiAgICAgICAgaWYgKGpvYi5qb2JJRCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB3aGlsZSAodGhpcy5qb2JzLmhhcyh0aGlzLm5Sb3dzKSkge1xuICAgICAgICAgICAgICAgIHRoaXMublJvd3MgKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGpvYi5qb2JJRCA9IHRoaXMublJvd3M7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuam9icy5oYXMoam9iLmpvYklEKSkge1xuICAgICAgICAgICAgam9iID0gT2JqZWN0LmFzc2lnbih0aGlzLmpvYnMuZ2V0KGpvYi5qb2JJRCkgYXMgSm9iLCBqb2IpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgam9iLnJvd0lEID0gdGhpcy5uUm93cztcbiAgICAgICAgICAgIHRoaXMublJvd3MgKz0gMTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmpvYnMuc2V0KGpvYi5qb2JJRCwgam9iKTtcbiAgICAgICAgdGhpcy5jbGVhbkpvYnMoKTtcbiAgICB9XG5cbiAgICBjbGVhbkpvYnMoKSB7XG4gICAgICAgIC8vIGZpbHRlciBvdXQgam9icyB3aXRoIGVuZHRpbWUgaW4gcGFzdFxuICAgICAgICBpZiAodGhpcy5qb2JzLnNpemUgPiAyMDApIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qgam9iSUQgb2YgdGhpcy5qb2JzLmtleXMoKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuam9icy5nZXQoam9iSUQpIGFzIEpvYjtcbiAgICAgICAgICAgICAgICBpZiAoKGpvYi5lbmRUaW1lQWN0dWFsID8/IGpvYi5lbmRUaW1lKSA8IHRoaXMuc3RhdGUubm93LShXSURUSF9TRUNPTkRTKjIqMTAwMCkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5qb2JzLmRlbGV0ZShqb2JJRCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmVhZFBvcnQgPSAoKT0+e1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUucnVubmluZykgcmV0dXJuO1xuICAgICAgICB3aGlsZSghdGhpcy5wb3J0LmVtcHR5KCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGpvYiA9IEpTT04ucGFyc2UodGhpcy5wb3J0LnJlYWQoKSBhcyBzdHJpbmcpO1xuICAgICAgICAgICAgdGhpcy5hZGRKb2Ioam9iKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnBvcnQubmV4dFdyaXRlKCkudGhlbih0aGlzLnJlYWRQb3J0KTtcbiAgICB9XG5cbiAgICBhbmltYXRlID0gKCk9PntcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlLnJ1bm5pbmcpIHJldHVybjtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7bm93OiBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXN9KTtcbiAgICAgICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0ZSk7XG4gICAgfVxuXG4gICAgcmVuZGVyKCkge1xuICAgICAgICBjb25zdCB7IG5zIH0gPSB0aGlzLnByb3BzO1xuXG4gICAgICAgIGNvbnN0IGRpc3BsYXlKb2JzID0gWy4uLnRoaXMuam9icy52YWx1ZXMoKV1cblxuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgPEdyYXBoRnJhbWUgbm93PXt0aGlzLnN0YXRlLm5vd30+XG4gICAgICAgICAgICAgICAgPFNhZmV0eUxheWVyIGpvYnM9e2Rpc3BsYXlKb2JzfSAvPlxuICAgICAgICAgICAgICAgIDxKb2JMYXllciBqb2JzPXtkaXNwbGF5Sm9ic30gLz5cbiAgICAgICAgICAgICAgICA8U2VjTGF5ZXIgam9icz17ZGlzcGxheUpvYnN9IC8+XG4gICAgICAgICAgICAgICAgPE1vbmV5TGF5ZXIgam9icz17ZGlzcGxheUpvYnN9IC8+XG4gICAgICAgICAgICA8L0dyYXBoRnJhbWU+XG4gICAgICAgIClcbiAgICB9XG59XG5cbmZ1bmN0aW9uIEdyYXBoRnJhbWUoe25vdywgY2hpbGRyZW59Ontub3c6VGltZU1zLCBjaGlsZHJlbjogUmVhY3QuUmVhY3ROb2RlfSk6IFJlYWN0LlJlYWN0RWxlbWVudCB7XG4gICAgLy8gVE9ETzogaW5pdFRpbWUgaXMgdXNlZCBhcyB1bmlxdWUgRE9NIElEIGFuZCBhcyByZW5kZXJpbmcgb3JpZ2luIGJ1dCBpdCBpcyBwb29ybHkgc3VpdGVkIGZvciBib3RoXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHN2ZyB2ZXJzaW9uPVwiMS4xXCIgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiXG4gICAgICAgICAgICB3aWR0aD17V0lEVEhfUElYRUxTfVxuICAgICAgICAgICAgaGVpZ2h0PXtIRUlHSFRfUElYRUxTfSBcbiAgICAgICAgICAgIC8vIFNldCB0aGUgdmlld0JveCBmb3IgMTAgc2Vjb25kcyBvZiBoaXN0b3J5LCA2IHNlY29uZHMgb2YgZnV0dXJlLlxuICAgICAgICAgICAgdmlld0JveD17YCR7Y29udmVydFNlY1RvUHgoLTEwIGFzIFRpbWVTZWNvbmRzKX0gMCAke1dJRFRIX1BJWEVMU30gJHtIRUlHSFRfUElYRUxTfWB9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxkZWZzPlxuICAgICAgICAgICAgICAgIDxjbGlwUGF0aCBpZD17YGhpZGUtZnV0dXJlLSR7aW5pdFRpbWV9YH0gY2xpcFBhdGhVbml0cz1cInVzZXJTcGFjZU9uVXNlXCI+XG4gICAgICAgICAgICAgICAgICAgIDxyZWN0IGlkPVwiaGlkZS1mdXR1cmUtcmVjdFwiXG4gICAgICAgICAgICAgICAgICAgICAgICB4PXtjb252ZXJ0VGltZShub3ctNjAwMDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoPXtjb252ZXJ0VGltZSg2MDAwMCBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHk9ezB9XG4gICAgICAgICAgICAgICAgICAgICAgICBoZWlnaHQ9ezUwfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvY2xpcFBhdGg+XG4gICAgICAgICAgICA8L2RlZnM+XG4gICAgICAgICAgICA8cmVjdCBpZD1cImJhY2tncm91bmRcIiB4PXtjb252ZXJ0U2VjVG9QeCgtMTAgYXMgVGltZVNlY29uZHMpfSB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCIgZmlsbD17R1JBUEhfQ09MT1JTLnNhZmV9IC8+XG4gICAgICAgICAgICA8ZyBpZD1cInRpbWVDb29yZGluYXRlc1wiIHRyYW5zZm9ybT17YHNjYWxlKCR7V0lEVEhfUElYRUxTIC8gV0lEVEhfU0VDT05EU30gMSkgdHJhbnNsYXRlKCR7Y29udmVydFRpbWUoaW5pdFRpbWUtbm93IGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfSAwKWB9PlxuICAgICAgICAgICAgICAgIHtjaGlsZHJlbn1cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMVwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0yXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy0yKkZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIDxyZWN0IGlkPVwiY3Vyc29yXCIgeD17MH0gd2lkdGg9ezF9IHk9ezB9IGhlaWdodD1cIjEwMCVcIiBmaWxsPVwid2hpdGVcIiAvPlxuICAgICAgICAgICAgPEdyYXBoTGVnZW5kIC8+XG4gICAgICAgIDwvc3ZnPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEdyYXBoTGVnZW5kKCk6IFJlYWN0LlJlYWN0RWxlbWVudCB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJMZWdlbmRcIiB0cmFuc2Zvcm09XCJ0cmFuc2xhdGUoLTQ5MCwgMTApLCBzY2FsZSguNSwgLjUpXCI+XG4gICAgICAgICAgICA8cmVjdCB4PXsxfSB5PXsxfSB3aWR0aD17Mjc1fSBoZWlnaHQ9ezM5Mn0gZmlsbD1cImJsYWNrXCIgc3Ryb2tlPVwiIzk3OTc5N1wiIC8+XG4gICAgICAgICAgICB7T2JqZWN0LmVudHJpZXMoR1JBUEhfQ09MT1JTKS5tYXAoKFtsYWJlbCwgY29sb3JdLCBpKT0+KFxuICAgICAgICAgICAgICAgIDxnIGtleT17bGFiZWx9IHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgyMiwgJHsxMyArIDQxKml9KWB9PlxuICAgICAgICAgICAgICAgICAgICA8cmVjdCB4PXswfSB5PXswfSB3aWR0aD17MjJ9IGhlaWdodD17MjJ9IGZpbGw9e2NvbG9yfSAvPlxuICAgICAgICAgICAgICAgICAgICA8dGV4dCBmb250RmFtaWx5PVwiQ291cmllciBOZXdcIiBmb250U2l6ZT17MzZ9IGZpbGw9XCIjODg4XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dHNwYW4geD17NDIuNX0geT17MzB9PntsYWJlbC5zdWJzdHJpbmcoMCwxKS50b1VwcGVyQ2FzZSgpK2xhYmVsLnN1YnN0cmluZygxKX08L3RzcGFuPlxuICAgICAgICAgICAgICAgICAgICA8L3RleHQ+XG4gICAgICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBTYWZldHlMYXllcih7am9ic306IHtqb2JzOiBKb2JbXX0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGxldCBwcmV2Sm9iOiBKb2IgfCB1bmRlZmluZWQ7XG4gICAgam9icyA9IGpvYnMuZmlsdGVyKChqb2IpPT4oam9iLnJlc3VsdCAhPT0gdW5kZWZpbmVkKSk7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJzYWZldHlMYXllclwiPlxuICAgICAgICAgICAge2pvYnMubWFwKChqb2I6IEpvYik9PntcbiAgICAgICAgICAgICAgICBsZXQgZWwgPSBudWxsO1xuICAgICAgICAgICAgICAgIC8vIHNoYWRlIHRoZSBiYWNrZ3JvdW5kIGJhc2VkIG9uIHNlY0xldmVsXG4gICAgICAgICAgICAgICAgaWYgKHByZXZKb2IgJiYgam9iLmVuZFRpbWUgPiBwcmV2Sm9iLmVuZFRpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgZWwgPSAoPHJlY3Qga2V5PXtqb2Iuam9iSUR9XG4gICAgICAgICAgICAgICAgICAgICAgICB4PXtjb252ZXJ0VGltZShwcmV2Sm9iLmVuZFRpbWUpfSB3aWR0aD17Y29udmVydFRpbWUoam9iLmVuZFRpbWUgLSBwcmV2Sm9iLmVuZFRpbWUsIDApfVxuICAgICAgICAgICAgICAgICAgICAgICAgeT17MH0gaGVpZ2h0PVwiMTAwJVwiXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxsPXsocHJldkpvYi5yZXN1bHQuaGFja0RpZmZpY3VsdHkgPiBwcmV2Sm9iLnJlc3VsdC5taW5EaWZmaWN1bHR5KSA/IEdSQVBIX0NPTE9SUy51bnNhZmUgOiBHUkFQSF9DT0xPUlMuc2FmZX1cbiAgICAgICAgICAgICAgICAgICAgLz4pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBwcmV2Sm9iID0gam9iO1xuICAgICAgICAgICAgICAgIHJldHVybiBlbDtcbiAgICAgICAgICAgIH0pfVxuICAgICAgICAgICAge3ByZXZKb2IgJiYgKFxuICAgICAgICAgICAgICAgIDxyZWN0IGtleT1cInJlbWFpbmRlclwiXG4gICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHByZXZKb2IuZW5kVGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZSgxMDAwMCwgMCl9XG4gICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD1cIjEwMCVcIlxuICAgICAgICAgICAgICAgICAgICBmaWxsPXsocHJldkpvYi5yZXN1bHQuaGFja0RpZmZpY3VsdHkgPiBwcmV2Sm9iLnJlc3VsdC5taW5EaWZmaWN1bHR5KSA/IEdSQVBIX0NPTE9SUy51bnNhZmUgOiBHUkFQSF9DT0xPUlMuc2FmZX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEpvYkxheWVyKHtqb2JzfToge2pvYnM6IEpvYltdfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwiam9iTGF5ZXJcIj5cbiAgICAgICAgICAgIHtqb2JzLm1hcCgoam9iOiBKb2IpPT4oPEpvYkJhciBqb2I9e2pvYn0ga2V5PXtqb2Iuam9iSUR9IC8+KSl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBKb2JCYXIoe2pvYn06IHtqb2I6IEpvYn0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGNvbnN0IHkgPSAoKGpvYi5yb3dJRCArIDEpICUgKChIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMUyoyKSAvIDQpKSAqIDQ7XG4gICAgbGV0IGpvYkJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5zdGFydFRpbWUgJiYgam9iLmR1cmF0aW9uKSB7XG4gICAgICAgIGpvYkJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUoam9iLnN0YXJ0VGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZShqb2IuZHVyYXRpb24sIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17Mn1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SU1tqb2IuY2FuY2VsbGVkID8gJ2NhbmNlbGxlZCcgOiBqb2IudGFza119XG4gICAgICAgIC8+KVxuICAgIH07XG4gICAgbGV0IHN0YXJ0RXJyb3JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5zdGFydFRpbWUsIGpvYi5zdGFydFRpbWVBY3R1YWxdLnNvcnQoKGEsYik9PmEtYik7XG4gICAgICAgIHN0YXJ0RXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgZmlsbD17R1JBUEhfQ09MT1JTLmRlc3luY31cbiAgICAgICAgIC8+KTtcbiAgICB9XG4gICAgbGV0IGVuZEVycm9yQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLmVuZFRpbWVBY3R1YWwpIHtcbiAgICAgICAgY29uc3QgW3QxLCB0Ml0gPSBbam9iLmVuZFRpbWUsIGpvYi5lbmRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICBlbmRFcnJvckJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUodDEpfSB3aWR0aD17Y29udmVydFRpbWUodDItdDEgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBmaWxsPXtHUkFQSF9DT0xPUlMuZGVzeW5jfVxuICAgICAgICAgLz4pO1xuICAgIH1cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke3l9KWB9PlxuICAgICAgICAgICAge2pvYkJhcn1cbiAgICAgICAgICAgIHtzdGFydEVycm9yQmFyfVxuICAgICAgICAgICAge2VuZEVycm9yQmFyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gU2VjTGF5ZXIoe2pvYnN9OiB7am9iczogSm9iW119KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICByZXR1cm4gPGcgaWQ9XCJzZWNMYXllclwiIC8+XG59XG5cbmZ1bmN0aW9uIE1vbmV5TGF5ZXIoe2pvYnN9OiB7am9iczogSm9iW119KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICByZXR1cm4gPGcgaWQ9XCJtb25leUxheWVyXCIgLz5cbn1cblxuLy8gLS0tLS0gcHJlLVJlYWN0IHZlcnNpb24gLS0tLS1cblxuLyoqXG4gKiByZW5kZXJCYXRjaGVzIC0gY3JlYXRlIGFuIFNWRyBlbGVtZW50IHdpdGggYSBncmFwaCBvZiBqb2JzXG4gKiBAcGFyYW0ge1NWR1NWR0VsZW1lbnR9IFtlbF0gLSBTVkcgZWxlbWVudCB0byByZXVzZS4gV2lsbCBiZSBjcmVhdGVkIGlmIGl0IGRvZXMgbm90IGV4aXN0IHlldC5cbiAqIEBwYXJhbSB7Sm9iW11bXX0gYmF0Y2hlcyAtIGFycmF5IG9mIGFycmF5cyBvZiBqb2JzXG4gKiBAcGFyYW0ge251bWJlcn0gW25vd10gLSBjdXJyZW50IHRpbWUgKG9wdGlvbmFsKVxuICogQHJldHVybnMge1NWR1NWR0VsZW1lbnR9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJCYXRjaGVzKGVsOiBIVE1MRWxlbWVudCwgYmF0Y2hlcz1bXSwgc2VydmVyU25hcHNob3RzPVtdLCBub3c6IFRpbWVNcykge1xuICAgIG5vdyB8fD0gcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zO1xuXG4gICAgLy8gUmVuZGVyIHRoZSBtYWluIFNWRyBlbGVtZW50IGlmIG5lZWRlZFxuICAgIGVsIHx8PSBzdmdFbChcbiAgICAgICAgXCJzdmdcIixcbiAgICAgICAge1xuICAgICAgICAgICAgdmVyc2lvbjogXCIxLjFcIiwgd2lkdGg6V0lEVEhfUElYRUxTLCBoZWlnaHQ6IEhFSUdIVF9QSVhFTFMsXG4gICAgICAgICAgICAvLyBTZXQgdGhlIHZpZXdCb3ggZm9yIDEwIHNlY29uZHMgb2YgaGlzdG9yeSwgNiBzZWNvbmRzIG9mIGZ1dHVyZS5cbiAgICAgICAgICAgIHZpZXdCb3g6IGAke2NvbnZlcnRTZWNUb1B4KC0xMCl9IDAgJHtXSURUSF9QSVhFTFN9ICR7SEVJR0hUX1BJWEVMU31gXG4gICAgICAgIH0sXG4gICAgICAgIFtcbiAgICAgICAgICAgIFtcImRlZnNcIiwge30sIFtcbiAgICAgICAgICAgICAgICBbXCJjbGlwUGF0aFwiLCB7aWQ6YGhpZGUtZnV0dXJlLSR7aW5pdFRpbWV9YCwgY2xpcFBhdGhVbml0czogXCJ1c2VyU3BhY2VPblVzZVwifSwgW1xuICAgICAgICAgICAgICAgICAgICBbXCJyZWN0XCIsIHtpZDpcImhpZGUtZnV0dXJlLXJlY3RcIiwgeDpjb252ZXJ0VGltZShub3ctNjAwMDApLCB3aWR0aDpjb252ZXJ0VGltZSg2MDAwMCwwKSwgeTowLCBoZWlnaHQ6IDUwfV1cbiAgICAgICAgICAgICAgICBdXVxuICAgICAgICAgICAgXV0sXG4gICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImJhY2tncm91bmRcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgaGVpZ2h0OlwiMTAwJVwiLCBmaWxsOkdSQVBIX0NPTE9SUy5zYWZlfV0sXG4gICAgICAgICAgICBbXCJnXCIsIHtpZDpcInRpbWVDb29yZGluYXRlc1wifSwgW1xuICAgICAgICAgICAgICAgIFtcImdcIiwge2lkOlwic2FmZXR5TGF5ZXJcIn1dLFxuICAgICAgICAgICAgICAgIFtcImdcIiwge2lkOlwiam9iTGF5ZXJcIn1dLFxuICAgICAgICAgICAgICAgIFtcImdcIiwge2lkOlwic2VjTGF5ZXJcIn1dLFxuICAgICAgICAgICAgICAgIFtcImdcIiwge2lkOlwibW9uZXlMYXllclwifV1cbiAgICAgICAgICAgIF1dLFxuICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTFcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLUZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0yXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy0yKkZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgIFtcInJlY3RcIiwge2lkOlwiY3Vyc29yXCIsIHg6MCwgd2lkdGg6MSwgeTowLCBoZWlnaHQ6IFwiMTAwJVwiLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgIHJlbmRlckxlZ2VuZCgpXG4gICAgICAgIF1cbiAgICApO1xuXG4gICAgLy8gVXBkYXRlIHRoZSB0aW1lIGNvb3JkaW5hdGVzIGV2ZXJ5IGZyYW1lXG4gICAgY29uc3QgZGF0YUVsID0gZWwuZ2V0RWxlbWVudEJ5SWQoXCJ0aW1lQ29vcmRpbmF0ZXNcIik7XG4gICAgZGF0YUVsLnNldEF0dHJpYnV0ZSgndHJhbnNmb3JtJyxcbiAgICAgICAgYHNjYWxlKCR7V0lEVEhfUElYRUxTIC8gV0lEVEhfU0VDT05EU30gMSkgdHJhbnNsYXRlKCR7Y29udmVydFRpbWUoaW5pdFRpbWUtbm93LCAwKX0gMClgXG4gICAgKTtcbiAgICBlbC5nZXRFbGVtZW50QnlJZChcImhpZGUtZnV0dXJlLXJlY3RcIikuc2V0QXR0cmlidXRlKCd4JywgY29udmVydFRpbWUobm93LTYwMDAwKSk7XG4gICAgXG4gICAgLy8gT25seSB1cGRhdGUgdGhlIG1haW4gZGF0YSBldmVyeSAyNTAgbXNcbiAgICBjb25zdCBsYXN0VXBkYXRlID0gZGF0YUVsLmdldEF0dHJpYnV0ZSgnZGF0YS1sYXN0LXVwZGF0ZScpIHx8IDA7XG4gICAgaWYgKG5vdyAtIGxhc3RVcGRhdGUgPCAyNTApIHtcbiAgICAgICAgcmV0dXJuIGVsO1xuICAgIH1cbiAgICBkYXRhRWwuc2V0QXR0cmlidXRlKCdkYXRhLWxhc3QtdXBkYXRlJywgbm93KTtcblxuICAgIGNvbnN0IGV2ZW50U25hcHNob3RzID0gYmF0Y2hlcy5mbGF0KCkubWFwKChqb2IpPT4oXG4gICAgICAgIFtqb2IuZW5kVGltZSwgam9iLnJlc3VsdF1cbiAgICApKTtcbiAgICBcbiAgICAvLyBSZW5kZXIgZWFjaCBqb2IgYmFja2dyb3VuZCBhbmQgZm9yZWdyb3VuZFxuICAgIHdoaWxlKGRhdGFFbC5maXJzdENoaWxkKSB7XG4gICAgICAgIGRhdGFFbC5yZW1vdmVDaGlsZChkYXRhRWwuZmlyc3RDaGlsZCk7XG4gICAgfVxuICAgIGRhdGFFbC5hcHBlbmRDaGlsZChyZW5kZXJTYWZldHlMYXllcihiYXRjaGVzLCBub3cpKTtcbiAgICBkYXRhRWwuYXBwZW5kQ2hpbGQocmVuZGVySm9iTGF5ZXIoYmF0Y2hlcywgbm93KSk7XG4gICAgZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlclNlY3VyaXR5TGF5ZXIoZXZlbnRTbmFwc2hvdHMsIHNlcnZlclNuYXBzaG90cywgbm93KSk7XG4gICAgLy8gZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlck1vbmV5TGF5ZXIoZXZlbnRTbmFwc2hvdHMsIHNlcnZlclNuYXBzaG90cywgbm93KSk7XG4gICAgZGF0YUVsLmFwcGVuZENoaWxkKHJlbmRlclByb2ZpdExheWVyKGJhdGNoZXMsIG5vdykpO1xuXG4gICAgcmV0dXJuIGVsO1xufVxuXG5mdW5jdGlvbiByZW5kZXJTZWN1cml0eUxheWVyKGV2ZW50U25hcHNob3RzPVtdLCBzZXJ2ZXJTbmFwc2hvdHM9W10sIG5vdykge1xuICAgIGxldCBtaW5TZWMgPSAwO1xuICAgIGxldCBtYXhTZWMgPSAxO1xuICAgIGZvciAoY29uc3Qgc25hcHNob3RzIG9mIFtldmVudFNuYXBzaG90cywgc2VydmVyU25hcHNob3RzXSkge1xuICAgICAgICBmb3IgKGNvbnN0IFt0aW1lLCBzZXJ2ZXJdIG9mIHNuYXBzaG90cykge1xuICAgICAgICAgICAgbWluU2VjID0gTWF0aC5taW4obWluU2VjLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHkpO1xuICAgICAgICAgICAgbWF4U2VjID0gTWF0aC5tYXgobWF4U2VjLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgb2JzZXJ2ZWRMYXllciA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwib2JzZXJ2ZWRTZWNcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhTZWMgLSBtaW5TZWMpfSlgLFxuICAgICAgICAgICAgZmlsbDogXCJkYXJrXCIrR1JBUEhfQ09MT1JTLnNlY3VyaXR5LFxuICAgICAgICAgICAgLy8gXCJmaWxsLW9wYWNpdHlcIjogMC41LFxuICAgICAgICAgICAgXCJjbGlwLXBhdGhcIjogYHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYFxuICAgICAgICB9LCBbXG4gICAgICAgICAgICByZW5kZXJPYnNlcnZlZFBhdGgoXCJoYWNrRGlmZmljdWx0eVwiLCBzZXJ2ZXJTbmFwc2hvdHMsIG1pblNlYywgbm93KVxuICAgICAgICBdXG4gICAgKTtcblxuICAgIGNvbnN0IHByb2plY3RlZExheWVyID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJwcm9qZWN0ZWRTZWNcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhTZWMgLSBtaW5TZWMpfSlgLFxuICAgICAgICAgICAgc3Ryb2tlOiBHUkFQSF9DT0xPUlMuc2VjdXJpdHksXG4gICAgICAgICAgICBmaWxsOiBcIm5vbmVcIixcbiAgICAgICAgICAgIFwic3Ryb2tlLXdpZHRoXCI6IDIsXG4gICAgICAgICAgICBcInN0cm9rZS1saW5lam9pblwiOlwiYmV2ZWxcIlxuICAgICAgICB9LCBbXG4gICAgICAgICAgICByZW5kZXJQcm9qZWN0ZWRQYXRoKFwiaGFja0RpZmZpY3VsdHlcIiwgZXZlbnRTbmFwc2hvdHMsIG5vdylcbiAgICAgICAgXVxuICAgICk7XG5cbiAgICBjb25zdCBzZWNMYXllciA9IHN2Z0VsKFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJzZWNMYXllclwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtIRUlHSFRfUElYRUxTIC0gMipGT09URVJfUElYRUxTfSlgXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIG9ic2VydmVkTGF5ZXIsXG4gICAgICAgICAgICBwcm9qZWN0ZWRMYXllclxuICAgICAgICBdXG4gICAgKTtcblxuICAgIHJldHVybiBzZWNMYXllcjtcbn1cblxuZnVuY3Rpb24gcmVuZGVyT2JzZXJ2ZWRQYXRoKHByb3BlcnR5PVwiaGFja0RpZmZpY3VsdHlcIiwgc2VydmVyU25hcHNob3RzPVtdLCBtaW5WYWx1ZT0wLCBub3csIHNjYWxlPTEpIHtcbiAgICBjb25zdCBwYXRoRGF0YSA9IFtdO1xuICAgIGxldCBwcmV2U2VydmVyO1xuICAgIGxldCBwcmV2VGltZTtcbiAgICBmb3IgKGNvbnN0IFt0aW1lLCBzZXJ2ZXJdIG9mIHNlcnZlclNuYXBzaG90cykge1xuICAgICAgICBpZiAodGltZSA8IG5vdy0oV0lEVEhfU0VDT05EUyoyKjEwMDApKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICAvLyBmaWxsIGFyZWEgdW5kZXIgYWN0dWFsIHNlY3VyaXR5XG4gICAgICAgIGlmICghcHJldlNlcnZlcikge1xuICAgICAgICAgICAgLy8gc3RhcnQgYXQgYm90dG9tIGxlZnRcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYE0gJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfSwkeyhtaW5WYWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJldlNlcnZlcikge1xuICAgICAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBwcmV2aW91cyBsZXZlbFxuICAgICAgICAgICAgLy8gaG9yaXpvbnRhbCBsaW5lIHRvIGN1cnJlbnQgdGltZVxuICAgICAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyhwcmV2U2VydmVyW3Byb3BlcnR5XSpzY2FsZSkudG9GaXhlZCgyKX1gLCBgSCAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9YCk7XG4gICAgICAgIH1cbiAgICAgICAgcHJldlNlcnZlciA9IHNlcnZlcjtcbiAgICAgICAgcHJldlRpbWUgPSB0aW1lO1xuICAgIH1cbiAgICAvLyBmaWxsIGluIGFyZWEgYmV0d2VlbiBsYXN0IHNuYXBzaG90IGFuZCBcIm5vd1wiIGN1cnNvclxuICAgIGlmIChwcmV2U2VydmVyKSB7XG4gICAgICAgIC8vIHZlcnRpY2FsIGxpbmUgdG8gcHJldmlvdXMgbGV2ZWxcbiAgICAgICAgLy8gaG9yaXpvbnRhbCBsaW5lIHRvIGN1cnJlbnQgdGltZVxuICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KHByZXZTZXJ2ZXJbcHJvcGVydHldKnNjYWxlKS50b0ZpeGVkKDIpfWAsIGBIICR7Y29udmVydFRpbWUobm93ICsgNjAwMDApLnRvRml4ZWQoMyl9YCk7XG4gICAgfVxuICAgIHBhdGhEYXRhLnB1c2goYFYgJHttaW5WYWx1ZX0gWmApO1xuICAgIHJldHVybiBzdmdFbCgncGF0aCcsIHtcbiAgICAgICAgZDogcGF0aERhdGEuam9pbignICcpXG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclByb2plY3RlZFBhdGgocHJvcGVydHk9XCJoYWNrRGlmZmljdWx0eVwiLCBldmVudFNuYXBzaG90cz1bXSwgbm93LCBzY2FsZT0xKSB7XG4gICAgY29uc3QgcGF0aERhdGEgPSBbXTtcbiAgICBsZXQgcHJldlRpbWU7XG4gICAgbGV0IHByZXZTZXJ2ZXI7XG4gICAgZm9yIChjb25zdCBbdGltZSwgc2VydmVyXSBvZiBldmVudFNuYXBzaG90cykge1xuICAgICAgICBpZiAodGltZSA8IG5vdy0oV0lEVEhfU0VDT05EUyoyKjEwMDApKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXByZXZTZXJ2ZXIpIHtcbiAgICAgICAgICAgIC8vIHN0YXJ0IGxpbmUgYXQgZmlyc3QgcHJvamVjdGVkIHRpbWUgYW5kIHZhbHVlXG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBNICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX0sJHsoc2VydmVyW3Byb3BlcnR5XSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJldlNlcnZlciAmJiB0aW1lID4gcHJldlRpbWUpIHtcbiAgICAgICAgICAgIC8vIHZlcnRpY2FsIGxpbmUgdG8gcHJldmlvdXMgdmFsdWVcbiAgICAgICAgICAgIC8vIGhvcml6b250YWwgbGluZSBmcm9tIHByZXZpb3VzIHRpbWUgdG8gY3VycmVudCB0aW1lXG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KHByZXZTZXJ2ZXJbcHJvcGVydHldKnNjYWxlKS50b0ZpeGVkKDIpfWAsIGBIICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgfVxuICAgICAgICBwcmV2VGltZSA9IHRpbWU7XG4gICAgICAgIHByZXZTZXJ2ZXIgPSBzZXJ2ZXI7XG4gICAgfVxuICAgIGlmIChwcmV2U2VydmVyKSB7XG4gICAgICAgIC8vIHZlcnRpY2FsIGxpbmUgdG8gcHJldmlvdXMgdmFsdWVcbiAgICAgICAgLy8gaG9yaXpvbnRhbCBsaW5lIGZyb20gcHJldmlvdXMgdGltZSB0byBmdXR1cmVcbiAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyhwcmV2U2VydmVyW3Byb3BlcnR5XSpzY2FsZSkudG9GaXhlZCgyKX1gLCBgSCAke2NvbnZlcnRUaW1lKG5vdyArIDYwMDAwKS50b0ZpeGVkKDMpfWApO1xuICAgIH1cbiAgICByZXR1cm4gc3ZnRWwoJ3BhdGgnLCB7XG4gICAgICAgIGQ6IHBhdGhEYXRhLmpvaW4oJyAnKSxcbiAgICAgICAgXCJ2ZWN0b3ItZWZmZWN0XCI6IFwibm9uLXNjYWxpbmctc3Ryb2tlXCJcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyUHJvZml0UGF0aChiYXRjaGVzPVtdLCBub3csIHNjYWxlPTEpIHtcbiAgICAvLyB3b3VsZCBsaWtlIHRvIGdyYXBoIG1vbmV5IHBlciBzZWNvbmQgb3ZlciB0aW1lXG4gICAgLy8gY29uc3QgbW9uZXlUYWtlbiA9IFtdO1xuICAgIGNvbnN0IHRvdGFsTW9uZXlUYWtlbiA9IFtdO1xuICAgIGxldCBydW5uaW5nVG90YWwgPSAwO1xuICAgIGZvciAoY29uc3QgYmF0Y2ggb2YgYmF0Y2hlcykge1xuICAgICAgICBmb3IgKGNvbnN0IGpvYiBvZiBiYXRjaCkge1xuICAgICAgICAgICAgaWYgKGpvYi50YXNrID09ICdoYWNrJyAmJiBqb2IuZW5kVGltZUFjdHVhbCkge1xuICAgICAgICAgICAgICAgIC8vIG1vbmV5VGFrZW4ucHVzaChbam9iLmVuZFRpbWVBY3R1YWwsIGpvYi5yZXN1bHRBY3R1YWxdKTtcbiAgICAgICAgICAgICAgICBydW5uaW5nVG90YWwgKz0gam9iLnJlc3VsdEFjdHVhbDtcbiAgICAgICAgICAgICAgICB0b3RhbE1vbmV5VGFrZW4ucHVzaChbam9iLmVuZFRpbWVBY3R1YWwsIHJ1bm5pbmdUb3RhbF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoam9iLnRhc2sgPT0gJ2hhY2snICYmICFqb2IuY2FuY2VsbGVkKSB7XG4gICAgICAgICAgICAgICAgcnVubmluZ1RvdGFsICs9IGpvYi5jaGFuZ2UucGxheWVyTW9uZXk7XG4gICAgICAgICAgICAgICAgdG90YWxNb25leVRha2VuLnB1c2goW2pvYi5lbmRUaW1lLCBydW5uaW5nVG90YWxdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICB0b3RhbE1vbmV5VGFrZW4ucHVzaChbbm93ICsgMzAwMDAsIHJ1bm5pbmdUb3RhbF0pO1xuICAgIC8vIG1vbmV5IHRha2VuIGluIHRoZSBsYXN0IFggc2Vjb25kcyBjb3VsZCBiZSBjb3VudGVkIHdpdGggYSBzbGlkaW5nIHdpbmRvdy5cbiAgICAvLyBidXQgdGhlIHJlY29yZGVkIGV2ZW50cyBhcmUgbm90IGV2ZW5seSBzcGFjZWQuXG4gICAgY29uc3QgbW92aW5nQXZlcmFnZSA9IFtdO1xuICAgIGxldCBtYXhQcm9maXQgPSAwO1xuICAgIGxldCBqID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRvdGFsTW9uZXlUYWtlbi5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBbdGltZSwgbW9uZXldID0gdG90YWxNb25leVRha2VuW2ldO1xuICAgICAgICB3aGlsZSAodG90YWxNb25leVRha2VuW2pdWzBdIDw9IHRpbWUgLSAyMDAwKSB7XG4gICAgICAgICAgICBqKys7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcHJvZml0ID0gdG90YWxNb25leVRha2VuW2ldWzFdIC0gdG90YWxNb25leVRha2VuW2pdWzFdO1xuICAgICAgICBtb3ZpbmdBdmVyYWdlLnB1c2goW3RpbWUsIHByb2ZpdF0pO1xuICAgICAgICBtYXhQcm9maXQgPSBNYXRoLm1heChtYXhQcm9maXQsIHByb2ZpdCk7XG4gICAgfVxuICAgIGV2YWwoXCJ3aW5kb3dcIikucHJvZml0RGF0YSA9IFt0b3RhbE1vbmV5VGFrZW4sIHJ1bm5pbmdUb3RhbCwgbW92aW5nQXZlcmFnZV07XG4gICAgY29uc3QgcGF0aERhdGEgPSBbXCJNIDAsMFwiXTtcbiAgICBsZXQgcHJldlRpbWU7XG4gICAgbGV0IHByZXZQcm9maXQ7XG4gICAgZm9yIChjb25zdCBbdGltZSwgcHJvZml0XSBvZiBtb3ZpbmdBdmVyYWdlKSB7XG4gICAgICAgIC8vIHBhdGhEYXRhLnB1c2goYEwgJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfSwkeyhzY2FsZSAqIHByb2ZpdC9tYXhQcm9maXQpLnRvRml4ZWQoMyl9YCk7XG4gICAgICAgIGlmIChwcmV2UHJvZml0KSB7XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBDICR7Y29udmVydFRpbWUoKHByZXZUaW1lKjMgKyB0aW1lKS80KS50b0ZpeGVkKDMpfSwkeyhzY2FsZSAqIHByZXZQcm9maXQvbWF4UHJvZml0KS50b0ZpeGVkKDMpfSAke2NvbnZlcnRUaW1lKChwcmV2VGltZSArIDMqdGltZSkvNCkudG9GaXhlZCgzKX0sJHsoc2NhbGUgKiBwcm9maXQvbWF4UHJvZml0KS50b0ZpeGVkKDMpfSAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHNjYWxlICogcHJvZml0L21heFByb2ZpdCkudG9GaXhlZCgzKX1gKVxuICAgICAgICB9XG4gICAgICAgIHByZXZUaW1lID0gdGltZTtcbiAgICAgICAgcHJldlByb2ZpdCA9IHByb2ZpdDtcbiAgICB9XG4gICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKG5vdys2MDAwMCkudG9GaXhlZCgzKX0gViAwIFpgKTtcbiAgICByZXR1cm4gc3ZnRWwoJ3BhdGgnLCB7XG4gICAgICAgIGQ6IHBhdGhEYXRhLmpvaW4oJyAnKSxcbiAgICAgICAgXCJ2ZWN0b3ItZWZmZWN0XCI6IFwibm9uLXNjYWxpbmctc3Ryb2tlXCJcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyUHJvZml0TGF5ZXIoYmF0Y2hlcz1bXSwgbm93KSB7XG4gICAgY29uc3QgcHJvZml0UGF0aCA9IHJlbmRlclByb2ZpdFBhdGgoYmF0Y2hlcywgbm93KTtcbiAgICBjb25zdCBvYnNlcnZlZFByb2ZpdCA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwib2JzZXJ2ZWRQcm9maXRcIixcbiAgICAgICAgICAgIHRyYW5zZm9ybTogYHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMU30pYCxcbiAgICAgICAgICAgIGZpbGw6IFwiZGFya1wiK0dSQVBIX0NPTE9SUy5tb25leSxcbiAgICAgICAgICAgIFwiY2xpcC1wYXRoXCI6IGB1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWBcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgcHJvZml0UGF0aFxuICAgICAgICBdXG4gICAgKTtcbiAgICBjb25zdCBwcm9qZWN0ZWRQcm9maXQgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInByb2plY3RlZFByb2ZpdFwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTfSlgLFxuICAgICAgICAgICAgZmlsbDogXCJub25lXCIsXG4gICAgICAgICAgICBzdHJva2U6IEdSQVBIX0NPTE9SUy5tb25leSxcbiAgICAgICAgICAgIFwic3Ryb2tlLXdpZHRoXCI6IDIsXG4gICAgICAgICAgICBcInN0cm9rZS1saW5lam9pblwiOlwicm91bmRcIlxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBwcm9maXRQYXRoLmNsb25lTm9kZSgpXG4gICAgICAgIF1cbiAgICApO1xuICAgIGNvbnN0IHByb2ZpdExheWVyID0gc3ZnRWwoXG4gICAgICAgIFwiZ1wiLCB7XG4gICAgICAgICAgICBpZDogXCJwcm9maXRMYXllclwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMU30pYFxuICAgICAgICB9LCBbXG4gICAgICAgICAgICBvYnNlcnZlZFByb2ZpdCxcbiAgICAgICAgICAgIHByb2plY3RlZFByb2ZpdFxuICAgICAgICBdXG4gICAgKTtcbiAgICByZXR1cm4gcHJvZml0TGF5ZXI7XG59XG5cbmZ1bmN0aW9uIHJlbmRlck1vbmV5TGF5ZXIoZXZlbnRTbmFwc2hvdHM9W10sIHNlcnZlclNuYXBzaG90cz1bXSwgbm93KSB7XG4gICAgY29uc3QgbW9uZXlMYXllciA9IHN2Z0VsKFwiZ1wiLCB7XG4gICAgICAgIGlkOiBcIm1vbmV5TGF5ZXJcIixcbiAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMU30pYFxuICAgIH0pO1xuXG4gICAgaWYgKHNlcnZlclNuYXBzaG90cy5sZW5ndGggPT0gMCkge1xuICAgICAgICByZXR1cm4gbW9uZXlMYXllcjtcbiAgICB9XG4gICAgbGV0IG1pbk1vbmV5ID0gMDtcbiAgICBsZXQgbWF4TW9uZXkgPSBzZXJ2ZXJTbmFwc2hvdHNbMF1bMV0ubW9uZXlNYXg7XG4gICAgY29uc3Qgc2NhbGUgPSAxL21heE1vbmV5O1xuICAgIG1heE1vbmV5ICo9IDEuMVxuXG4gICAgY29uc3Qgb2JzZXJ2ZWRMYXllciA9IHN2Z0VsKFxuICAgICAgICBcImdcIiwge1xuICAgICAgICAgICAgaWQ6IFwib2JzZXJ2ZWRNb25leVwiLFxuICAgICAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heE1vbmV5IC0gbWluTW9uZXkpIC8gc2NhbGV9KWAsXG4gICAgICAgICAgICBmaWxsOiBcImRhcmtcIitHUkFQSF9DT0xPUlMubW9uZXksXG4gICAgICAgICAgICAvLyBcImZpbGwtb3BhY2l0eVwiOiAwLjUsXG4gICAgICAgICAgICBcImNsaXAtcGF0aFwiOiBgdXJsKCNoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfSlgXG4gICAgICAgIH0sIFtcbiAgICAgICAgICAgIHJlbmRlck9ic2VydmVkUGF0aChcIm1vbmV5QXZhaWxhYmxlXCIsIHNlcnZlclNuYXBzaG90cywgbWluTW9uZXksIG5vdywgc2NhbGUpXG4gICAgICAgIF1cbiAgICApO1xuICAgIG1vbmV5TGF5ZXIuYXBwZW5kKG9ic2VydmVkTGF5ZXIpO1xuXG4gICAgY29uc3QgcHJvamVjdGVkTGF5ZXIgPSBzdmdFbChcbiAgICAgICAgXCJnXCIsIHtcbiAgICAgICAgICAgIGlkOiBcInByb2plY3RlZE1vbmV5XCIsXG4gICAgICAgICAgICB0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4TW9uZXkgLSBtaW5Nb25leSkgLyBzY2FsZX0pYCxcbiAgICAgICAgICAgIHN0cm9rZTogR1JBUEhfQ09MT1JTLm1vbmV5LFxuICAgICAgICAgICAgZmlsbDogXCJub25lXCIsXG4gICAgICAgICAgICBcInN0cm9rZS13aWR0aFwiOiAyLFxuICAgICAgICAgICAgXCJzdHJva2UtbGluZWpvaW5cIjpcImJldmVsXCJcbiAgICAgICAgfSwgW1xuICAgICAgICAgICAgcmVuZGVyUHJvamVjdGVkUGF0aChcIm1vbmV5QXZhaWxhYmxlXCIsIGV2ZW50U25hcHNob3RzLCBub3csIHNjYWxlKVxuICAgICAgICBdXG4gICAgKTtcbiAgICBtb25leUxheWVyLmFwcGVuZChwcm9qZWN0ZWRMYXllcik7XG5cbiAgICByZXR1cm4gbW9uZXlMYXllcjtcbn1cblxuZnVuY3Rpb24gcmVuZGVyU2FmZXR5TGF5ZXIoYmF0Y2hlcz1bXSwgbm93KSB7XG4gICAgY29uc3Qgc2FmZXR5TGF5ZXIgPSBzdmdFbCgnZycsIHtpZDpcInNhZmV0eUxheWVyXCJ9KTtcblxuICAgIGxldCBwcmV2Sm9iOyAgICBcbiAgICBmb3IgKGNvbnN0IGJhdGNoIG9mIGJhdGNoZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBqb2Igb2YgYmF0Y2gpIHtcbiAgICAgICAgICAgIGlmICgoam9iLmVuZFRpbWVBY3R1YWwgfHwgam9iLmVuZFRpbWUpIDwgbm93LShXSURUSF9TRUNPTkRTKjIqMTAwMCkpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gc2hhZGUgdGhlIGJhY2tncm91bmQgYmFzZWQgb24gc2VjTGV2ZWxcbiAgICAgICAgICAgIGlmIChwcmV2Sm9iICYmIGpvYi5lbmRUaW1lID4gcHJldkpvYi5lbmRUaW1lKSB7XG4gICAgICAgICAgICAgICAgc2FmZXR5TGF5ZXIuYXBwZW5kQ2hpbGQoc3ZnRWwoJ3JlY3QnLCB7XG4gICAgICAgICAgICAgICAgICAgIHg6IGNvbnZlcnRUaW1lKHByZXZKb2IuZW5kVGltZSksIHdpZHRoOiBjb252ZXJ0VGltZShqb2IuZW5kVGltZSAtIHByZXZKb2IuZW5kVGltZSwgMCksXG4gICAgICAgICAgICAgICAgICAgIHk6IDAsIGhlaWdodDogXCIxMDAlXCIsXG4gICAgICAgICAgICAgICAgICAgIGZpbGw6IChwcmV2Sm9iLnJlc3VsdC5oYWNrRGlmZmljdWx0eSA+IHByZXZKb2IucmVzdWx0Lm1pbkRpZmZpY3VsdHkpID8gR1JBUEhfQ09MT1JTLnVuc2FmZSA6IEdSQVBIX0NPTE9SUy5zYWZlXG4gICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcHJldkpvYiA9IGpvYjtcbiAgICAgICAgfVxuICAgIH1cbiAgICBpZiAocHJldkpvYikge1xuICAgICAgICBzYWZldHlMYXllci5hcHBlbmRDaGlsZChzdmdFbCgncmVjdCcsIHtcbiAgICAgICAgICAgIHg6IGNvbnZlcnRUaW1lKHByZXZKb2IuZW5kVGltZSksIHdpZHRoOiBjb252ZXJ0VGltZSgxMDAwMCwgMCksXG4gICAgICAgICAgICB5OiAwLCBoZWlnaHQ6IFwiMTAwJVwiLFxuICAgICAgICAgICAgZmlsbDogKHByZXZKb2IucmVzdWx0LmhhY2tEaWZmaWN1bHR5ID4gcHJldkpvYi5yZXN1bHQubWluRGlmZmljdWx0eSkgPyBHUkFQSF9DT0xPUlMudW5zYWZlIDogR1JBUEhfQ09MT1JTLnNhZmVcbiAgICAgICAgfSkpO1xuICAgIH1cbiAgICByZXR1cm4gc2FmZXR5TGF5ZXI7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckpvYkxheWVyKGJhdGNoZXM9W10sIG5vdykge1xuICAgIGNvbnN0IGpvYkxheWVyID0gc3ZnRWwoJ2cnLCB7aWQ6XCJqb2JMYXllclwifSk7XG5cbiAgICBsZXQgaSA9IDA7XG4gICAgZm9yIChjb25zdCBiYXRjaCBvZiBiYXRjaGVzKSB7XG4gICAgICAgIGZvciAoY29uc3Qgam9iIG9mIGJhdGNoKSB7XG4gICAgICAgICAgICBpID0gKGkgKyAxKSAlICgoSEVJR0hUX1BJWEVMUyAtIEZPT1RFUl9QSVhFTFMqMikgLyA0KTtcbiAgICAgICAgICAgIGlmICgoam9iLmVuZFRpbWVBY3R1YWwgfHwgam9iLmVuZFRpbWUpIDwgbm93LShXSURUSF9TRUNPTkRTKjIqMTAwMCkpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGRyYXcgdGhlIGpvYiBiYXJzXG4gICAgICAgICAgICBsZXQgY29sb3IgPSBHUkFQSF9DT0xPUlNbam9iLnRhc2tdO1xuICAgICAgICAgICAgaWYgKGpvYi5jYW5jZWxsZWQpIHtcbiAgICAgICAgICAgICAgICBjb2xvciA9IEdSQVBIX0NPTE9SUy5jYW5jZWxsZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBqb2JMYXllci5hcHBlbmRDaGlsZChzdmdFbCgncmVjdCcsIHtcbiAgICAgICAgICAgICAgICB4OiBjb252ZXJ0VGltZShqb2Iuc3RhcnRUaW1lKSwgd2lkdGg6IGNvbnZlcnRUaW1lKGpvYi5kdXJhdGlvbiwgMCksXG4gICAgICAgICAgICAgICAgeTogaSo0LCBoZWlnaHQ6IDIsXG4gICAgICAgICAgICAgICAgZmlsbDogY29sb3JcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIC8vIGRyYXcgdGhlIGVycm9yIGJhcnNcbiAgICAgICAgICAgIGlmIChqb2Iuc3RhcnRUaW1lQWN0dWFsKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgW3QxLCB0Ml0gPSBbam9iLnN0YXJ0VGltZSwgam9iLnN0YXJ0VGltZUFjdHVhbF0uc29ydCgoYSxiKT0+YS1iKTtcbiAgICAgICAgICAgICAgICBqb2JMYXllci5hcHBlbmRDaGlsZChzdmdFbCgncmVjdCcsIHtcbiAgICAgICAgICAgICAgICAgICAgeDogY29udmVydFRpbWUodDEpLCB3aWR0aDogY29udmVydFRpbWUodDItdDEsIDApLFxuICAgICAgICAgICAgICAgICAgICB5OiBpKjQsIGhlaWdodDogMSxcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogR1JBUEhfQ09MT1JTLmRlc3luY1xuICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChqb2IuZW5kVGltZUFjdHVhbCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5lbmRUaW1lLCBqb2IuZW5kVGltZUFjdHVhbF0uc29ydCgoYSxiKT0+YS1iKTtcbiAgICAgICAgICAgICAgICBqb2JMYXllci5hcHBlbmRDaGlsZChzdmdFbCgncmVjdCcsIHtcbiAgICAgICAgICAgICAgICAgICAgeDogY29udmVydFRpbWUodDEpLCB3aWR0aDogY29udmVydFRpbWUodDItdDEsIDApLFxuICAgICAgICAgICAgICAgICAgICB5OiBpKjQsIGhlaWdodDogMSxcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogR1JBUEhfQ09MT1JTLmRlc3luY1xuICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAvLyBzcGFjZSBiZXR3ZWVuIGJhdGNoZXNcbiAgICAgICAgaSsrO1xuICAgIH1cbiAgICByZXR1cm4gam9iTGF5ZXI7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckxlZ2VuZCgpIHtcbiAgICBjb25zdCBsZWdlbmRFbCA9IHN2Z0VsKCdnJyxcbiAgICAgICAge2lkOiBcIkxlZ2VuZFwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlKC00ODAsIDEwKSwgc2NhbGUoLjUsIC41KVwifSxcbiAgICAgICAgW1sncmVjdCcsIHt4OiAxLCB5OiAxLCB3aWR0aDogMjc1LCBoZWlnaHQ6IDM5MiwgZmlsbDogXCJibGFja1wiLCBzdHJva2U6IFwiIzk3OTc5N1wifV1dXG4gICAgKTtcbiAgICBsZXQgeSA9IDEzO1xuICAgIGZvciAoY29uc3QgW2xhYmVsLCBjb2xvcl0gb2YgT2JqZWN0LmVudHJpZXMoR1JBUEhfQ09MT1JTKSkge1xuICAgICAgICBsZWdlbmRFbC5hcHBlbmRDaGlsZChzdmdFbCgnZycsIHt0cmFuc2Zvcm06IGB0cmFuc2xhdGUoMjIsICR7eX0pYH0sIFtcbiAgICAgICAgICAgIFsncmVjdCcsIHt4OjAsIHk6MTAsIHdpZHRoOiAyMiwgaGVpZ2h0OiAyMiwgZmlsbDogY29sb3J9XSxcbiAgICAgICAgICAgIFsndGV4dCcsIHtcImZvbnQtZmFtaWx5XCI6XCJDb3VyaWVyIE5ld1wiLCBcImZvbnQtc2l6ZVwiOjM2LCBmaWxsOiBcIiM4ODhcIn0sIFtcbiAgICAgICAgICAgICAgICBbJ3RzcGFuJywge3g6NDIuNSwgeTozMH0sIFtsYWJlbC5zdWJzdHJpbmcoMCwxKS50b1VwcGVyQ2FzZSgpK2xhYmVsLnN1YnN0cmluZygxKV1dXG4gICAgICAgICAgICBdXVxuICAgICAgICBdKSk7XG4gICAgICAgIHkgKz0gNDE7XG4gICAgfVxuICAgIHJldHVybiBsZWdlbmRFbDtcbn1cblxuLyogLS0tLS0tLS0tLSBsaWJyYXJ5IGZ1bmN0aW9ucyAtLS0tLS0tLS0tICovXG5cbi8qKiBDcmVhdGUgYW4gU1ZHIEVsZW1lbnQgdGhhdCBjYW4gYmUgZGlzcGxheWVkIGluIHRoZSBET00uICovXG5mdW5jdGlvbiBzdmdFbCh0YWdOYW1lLCBhdHRyaWJ1dGVzPXt9LCBjaGlsZHJlbj1bXSkge1xuICAgIGNvbnN0IGRvYyA9IGV2YWwoXCJkb2N1bWVudFwiKTtcbiAgICBjb25zdCB4bWxucyA9ICdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Zyc7XG4gICAgY29uc3QgZWwgPSBkb2MuY3JlYXRlRWxlbWVudE5TKHhtbG5zLCB0YWdOYW1lKTtcbiAgICAvLyBzdXBwb3J0IGV4cG9ydGluZyBvdXRlckhUTUxcbiAgICBpZiAodGFnTmFtZS50b0xvd2VyQ2FzZSgpID09ICdzdmcnKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ3htbG5zJ10gPSB4bWxucztcbiAgICB9XG4gICAgLy8gc2V0IGFsbCBhdHRyaWJ1dGVzXG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgICAgICBlbC5zZXRBdHRyaWJ1dGUobmFtZSwgdmFsKTtcbiAgICB9XG4gICAgLy8gYXBwZW5kIGFsbCBjaGlsZHJlblxuICAgIGZvciAobGV0IGNoaWxkIG9mIGNoaWxkcmVuKSB7XG4gICAgICAgIC8vIHJlY3Vyc2l2ZWx5IGNvbnN0cnVjdCBjaGlsZCBlbGVtZW50c1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjaGlsZCkpIHtcbiAgICAgICAgICAgIGNoaWxkID0gc3ZnRWwoLi4uY2hpbGQpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHR5cGVvZihjaGlsZCkgPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIGNoaWxkID0gZG9jLmNyZWF0ZVRleHROb2RlKGNoaWxkKTtcbiAgICAgICAgfVxuICAgICAgICBlbC5hcHBlbmRDaGlsZChjaGlsZCk7XG4gICAgfVxuICAgIHJldHVybiBlbDtcbn1cblxuLyoqIEluc2VydCBhbiBlbGVtZW50IGludG8gdGhlIG5ldHNjcmlwdCBwcm9jZXNzJ3MgdGFpbCB3aW5kb3cuICovXG5leHBvcnQgZnVuY3Rpb24gbG9nSFRNTChucywgZWwpIHtcbiAgICBucy50YWlsKCk7XG4gICAgY29uc3QgZG9jID0gZXZhbCgnZG9jdW1lbnQnKTtcbiAgICBjb25zdCBjb21tYW5kID0gbnMuZ2V0U2NyaXB0TmFtZSgpICsgJyAnICsgbnMuYXJncy5qb2luKCcgJyk7XG4gICAgY29uc3QgbG9nRWwgPSBkb2MucXVlcnlTZWxlY3RvcihgW3RpdGxlPVwiJHtjb21tYW5kfVwiXWApLnBhcmVudEVsZW1lbnQubmV4dEVsZW1lbnRTaWJsaW5nLnF1ZXJ5U2VsZWN0b3IoJ3NwYW4nKTtcbiAgICBsb2dFbC5hcHBlbmRDaGlsZChlbCk7XG59XG5cbi8qIC0tLS0tICovXG5cbiJdfQ==