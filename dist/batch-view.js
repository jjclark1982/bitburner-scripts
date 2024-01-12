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

You can also send an array of such messages in a single port write. For example:

    ns.writePort(10, JSON.stringify([
        {jobID: '1.1', type: 'hack',   ...},
        {jobID: '1.2', type: 'weaken', ...},
        {jobID: '1.3', type: 'grow',   ...},
        {jobID: '1.4', type: 'weaken', ...},
    ]));

*/
const React = globalThis.React;
// ----- Constants ----- 
// TODO: initTime is used as unique DOM ID and as rendering origin but it is poorly suited for both.
//  The script PID would work better as a unique DOM ID.
//  The Public API could require performance-epoch times, which won't need to be adjusted.
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
    hack: "cyan",
    grow: "lightgreen",
    weaken: "yellow",
    desync: "magenta",
    safe: "#111",
    unsafe: "#333",
    security: "red",
    money: "blue"
};
// TODO: use a context for these scale factors. support setting them by args and scroll-gestures.
// const ScreenContext = React.createContext({WIDTH_PIXELS, WIDTH_SECONDS, HEIGHT_PIXELS, FOOTER_PIXELS});
// TODO: review use of 600000, 60000, 1000, 10, and WIDTH_SECONDS as clipping limits.
const WIDTH_PIXELS = 800;
const WIDTH_SECONDS = 16;
const HEIGHT_PIXELS = 600;
const FOOTER_PIXELS = 50;
// ----- Main Program -----
const FLAGS = [
    ["help", false],
    ["port", 0],
    ["debug", false],
];
export function autocomplete(data, args) {
    data.flags(FLAGS);
    return [];
}
/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog('sleep');
    ns.disableLog('asleep');
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
    const debug = flags.debug;
    const batchView = React.createElement(BatchView, { ns: ns, portNum: portNum, debug: debug });
    ns.print(`Listening on Port ${portNum}`);
    ns.printRaw(batchView);
    while (true) {
        await ns.asleep(60 * 1000);
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
        const { ns, portNum, debug } = props;
        this.state = {
            running: true,
            now: performance.now(),
            dataUpdates: 0,
        };
        this.port = ns.getPortHandle(portNum);
        this.jobs = new Map();
        this.expectedServers = [];
        this.observedServers = [];
        if (debug) {
            Object.assign(globalThis, { batchView: this });
        }
    }
    componentDidMount() {
        const { ns, portNum } = this.props;
        this.setState({ running: true });
        ns.atExit(() => {
            this.setState({ running: false });
        });
        this.animate();
        this.readPort();
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
    readPort = async () => {
        while (this.state.running) {
            while (!this.port.empty()) {
                let msgs = JSON.parse(this.port.read());
                if (!Array.isArray(msgs)) {
                    msgs = [msgs];
                }
                for (const msg of msgs) {
                    try {
                        this.receiveMessage(msg);
                    }
                    catch (e) {
                        console.error(`${this.props.ns.getScriptName()}: Error parsing message `, msg, e);
                    }
                }
            }
            await this.port.nextWrite();
        }
    };
    receiveMessage(msg) {
        if (msg.type == "spacer") {
            this.sequentialRowID += 1;
        }
        else if (msg.type == "expected") {
            this.expectedServers.push(msg);
            this.expectedServers = this.cleanServers(this.expectedServers);
        }
        else if (msg.type == "observed") {
            this.observedServers.push(msg);
            this.observedServers = this.cleanServers(this.observedServers);
        }
        else if (msg.jobID !== undefined || msg.type == 'hack' || msg.type == 'grow' || msg.type == 'weaken') {
            this.addJob(msg);
        }
        else {
            throw new Error(`Unrecognized message type: ${msg.type}:`);
        }
        this.setState({ dataUpdates: this.state.dataUpdates + 1 });
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
        let job = this.jobs.get(jobID);
        if (job === undefined) {
            // Create new Job record with required fields
            if (msg.jobID !== undefined) {
                for (const field of ['type', 'startTime', 'duration']) {
                    if (msg[field] === undefined) {
                        console.warn(`Tried to update a non-existing jobID`, msg);
                        return;
                    }
                }
            }
            job = {
                jobID: jobID,
                rowID: this.sequentialRowID++,
                endTime: (msg.startTime || 0) + (msg.duration || 0),
                ...msg
            };
        }
        else {
            // Merge updates into existing job record
            job = {
                ...job,
                ...msg
            };
        }
        for (const field of ['type', 'startTime', 'duration']) {
            if (job[field] === undefined) {
                throw new Error(`Missing required field '${field}'`);
            }
        }
        for (const field of ['startTime', 'duration', 'endTime', 'startTimeActual', 'endTimeActual']) {
            if (job[field] !== undefined && job[field] > this.validTimeRange()[1]) {
                throw new Error(`Invalid value for '${field}': ${job[field]}. Expected a value from performance.now().`);
            }
        }
        this.jobs.set(jobID, job);
        this.cleanJobs();
    }
    validTimeRange() {
        // up to 2 screens in the past
        // up to 30 days in the future
        return [this.state.now - (WIDTH_SECONDS * 2 * 1000), 1000 * 60 * 60 * 24 * 30];
    }
    cleanJobs() {
        const [earliestTime, latestTime] = this.validTimeRange();
        // Filter out expired jobs (endTime more than 2 screens in the past)
        if (this.jobs.size > 200) {
            for (const jobID of this.jobs.keys()) {
                const job = this.jobs.get(jobID);
                if (!(job.endTime > earliestTime)) {
                    this.jobs.delete(jobID);
                }
            }
        }
    }
    cleanServers(servers) {
        const [earliestTime, latestTime] = this.validTimeRange();
        // TODO: insert item into sorted list instead of re-sorting each time
        return servers.filter((s) => s.time > earliestTime).sort((a, b) => a.time - b.time);
    }
    render() {
        return (React.createElement(GraphFrame, { now: this.state.now },
            React.createElement(SafetyLayer, { expectedServers: this.expectedServers }),
            React.createElement(JobLayer, { jobs: [...this.jobs.values()] }),
            React.createElement(SecurityLayer, { expectedServers: this.expectedServers, observedServers: this.observedServers }),
            React.createElement(MoneyLayer, { expectedServers: this.expectedServers, observedServers: this.observedServers })));
    }
}
function GraphFrame({ now, children }) {
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
        jobBar = (React.createElement("rect", { x: convertTime(job.startTime), width: convertTime(job.duration, 0), y: 0, height: 2, fill: job.color ?? GRAPH_COLORS[job.type] }));
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
    const expectedPath = computePathData(expectedEvents);
    const expectedLayer = (React.createElement("g", { id: "expectedSec", transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxSec - minSec)})`, stroke: GRAPH_COLORS.security, fill: "none", strokeWidth: 2, strokeLinejoin: "bevel" },
        React.createElement("path", { d: expectedPath.join(" "), vectorEffect: "non-scaling-stroke" })));
    return (React.createElement("g", { id: "secLayer", transform: `translate(0 ${HEIGHT_PIXELS - 2 * FOOTER_PIXELS})` },
        observedLayer,
        expectedLayer));
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
        // horizontal line to future time
        pathData.push(`H ${convertTime(time + 600000).toFixed(3)}`);
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
function MoneyLayer({ expectedServers, observedServers }) {
    expectedServers ??= [];
    observedServers ??= [];
    if (expectedServers.length == 0 && observedServers.length == 0)
        return null;
    let minMoney = 0;
    let maxMoney = (expectedServers[0] || observedServers[0]).moneyMax;
    const scale = 1 / maxMoney;
    maxMoney *= 1.1;
    const observedEvents = observedServers.map((server) => [server.time, server.moneyAvailable]);
    let shouldClosePath = true;
    const observedPath = computePathData(observedEvents, minMoney, shouldClosePath, scale);
    const observedLayer = (React.createElement("g", { id: "observedMoney", transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxMoney - minMoney) / scale})`, fill: "dark" + GRAPH_COLORS.money, 
        // fillOpacity: 0.5,
        clipPath: `url(#hide-future-${initTime})` },
        React.createElement("path", { d: observedPath.join(" ") })));
    const expectedEvents = expectedServers.map((server) => [server.time, server.moneyAvailable]);
    shouldClosePath = false;
    const expectedPath = computePathData(expectedEvents, minMoney, shouldClosePath, scale);
    const expectedLayer = (React.createElement("g", { id: "expectedMoney", transform: `translate(0 ${FOOTER_PIXELS}) scale(1 ${-FOOTER_PIXELS / (maxMoney - minMoney) / scale})`, stroke: GRAPH_COLORS.money, fill: "none", strokeWidth: 2, strokeLinejoin: "bevel" },
        React.createElement("path", { d: expectedPath.join(" "), vectorEffect: "non-scaling-stroke" })));
    return (React.createElement("g", { id: "moneyLayer", transform: `translate(0 ${HEIGHT_PIXELS - FOOTER_PIXELS})` },
        observedLayer,
        expectedLayer));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBcUVFO0FBMENGLE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxLQUE4QixDQUFDO0FBY3hELHlCQUF5QjtBQUV6QixvR0FBb0c7QUFDcEcsd0RBQXdEO0FBQ3hELDBGQUEwRjtBQUMxRixJQUFJLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFZLENBQUM7QUFDM0M7Ozs7R0FJRztBQUNILFNBQVMsV0FBVyxDQUFDLENBQVMsRUFBRSxFQUFFLEdBQUMsUUFBUTtJQUN2QyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFnQixDQUFDO0FBQzVDLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxDQUFjO0lBQ2xDLE9BQU8sQ0FBQyxHQUFHLFlBQVksR0FBRyxhQUEyQixDQUFDO0FBQzFELENBQUM7QUFFRCxNQUFNLFlBQVksR0FBRztJQUNqQixJQUFJLEVBQUUsTUFBTTtJQUNaLElBQUksRUFBRSxZQUFZO0lBQ2xCLE1BQU0sRUFBRSxRQUFRO0lBQ2hCLE1BQU0sRUFBRSxTQUFTO0lBQ2pCLElBQUksRUFBRSxNQUFNO0lBQ1osTUFBTSxFQUFFLE1BQU07SUFDZCxRQUFRLEVBQUUsS0FBSztJQUNmLEtBQUssRUFBRSxNQUFNO0NBQ2hCLENBQUM7QUFFRixpR0FBaUc7QUFDakcsMEdBQTBHO0FBQzFHLHFGQUFxRjtBQUNyRixNQUFNLFlBQVksR0FBRyxHQUFpQixDQUFDO0FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEVBQWlCLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUcsR0FBYSxDQUFDO0FBQ3BDLE1BQU0sYUFBYSxHQUFHLEVBQVksQ0FBQztB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LS0tXG5cblN0YXJ0IHRoZSBiYXRjaCB2aWV3ZXIgc2NyaXB0IGZyb20gdGhlIGNvbW1hbmQgbGluZTpcblxuICAgIHJ1biBiYXRjaC12aWV3LmpzIC0tcG9ydCAxMFxuXG5UaGVuIHNlbmQgbWVzc2FnZXMgdG8gaXQgZnJvbSBvdGhlciBzY3JpcHRzLlxuXG5FeGFtcGxlOiBEaXNwbGF5IGFjdGlvbiB0aW1pbmcgKGhhY2sgLyBncm93IC8gd2Vha2VuKVxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdoYWNrJyxcbiAgICAgICAgam9iSUQ6IDEsXG4gICAgICAgIHN0YXJ0VGltZTogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgICAgIGR1cmF0aW9uOiBucy5nZXRIYWNrVGltZSh0YXJnZXQpLFxuICAgIH0pKTtcblxuRXhhbXBsZTogVXBkYXRlIGFuIGFjdGlvbiB0aGF0IGhhcyBhbHJlYWR5IGJlZW4gZGlzcGxheWVkXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgam9iSUQ6IDEsXG4gICAgICAgIHN0YXJ0VGltZUFjdHVhbDogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgfSkpO1xuICAgIGF3YWl0IG5zLmhhY2sodGFyZ2V0KTtcbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgam9iSUQ6IDEsXG4gICAgICAgIGVuZFRpbWVBY3R1YWw6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgIH0pKTtcblxuRXhhbXBsZTogRGlzcGxheSBhIGJsYW5rIHJvdyBiZXR3ZWVuIGFjdGlvbnMgKHRvIHZpc3VhbGx5IHNlcGFyYXRlIGJhdGNoZXMpXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ3NwYWNlcicsXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBEaXNwbGF5IG9ic2VydmVkIHNlY3VyaXR5IC8gbW9uZXkgbGV2ZWxcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnb2JzZXJ2ZWQnLFxuICAgICAgICB0aW1lOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICAgICAgbWluRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyTWluU2VjdXJpdHlMZXZlbCh0YXJnZXQpLFxuICAgICAgICBoYWNrRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyU2VjdXJpdHlMZXZlbCh0YXJnZXQpLFxuICAgICAgICBtb25leU1heDogbnMuZ2V0U2VydmVyTWF4TW9uZXkodGFyZ2V0KSxcbiAgICAgICAgbW9uZXlBdmFpbGFibGU6IG5zLmdldFNlcnZlck1vbmV5QXZhaWxhYmxlKHRhcmdldCksXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBEaXNwbGF5IGV4cGVjdGVkIHNlY3VyaXR5IC8gbW9uZXkgbGV2ZWwgKHZhcmllcyBieSBhY3Rpb24gdHlwZSBhbmQgeW91ciBzdHJhdGVneSlcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnZXhwZWN0ZWQnLFxuICAgICAgICB0aW1lOiBqb2Iuc3RhcnRUaW1lICsgam9iLmR1cmF0aW9uLFxuICAgICAgICBtaW5EaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJNaW5TZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIGhhY2tEaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJTZWN1cml0eUxldmVsKHRhcmdldCkgKyBucy5oYWNrQW5hbHl6ZVNlY3VyaXR5KGpvYi50aHJlYWRzKSxcbiAgICAgICAgbW9uZXlNYXg6IG5zLmdldFNlcnZlck1heE1vbmV5KHRhcmdldCksXG4gICAgICAgIG1vbmV5QXZhaWxhYmxlOiBNYXRoLm1heCgwLCBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpIC0gbnMuaGFja0FuYWx5emUodGFyZ2V0KSAqIGpvYi50aHJlYWRzICogbnMuaGFja0FuYWx5emVDaGFuY2UodGFyZ2V0KSksXG4gICAgfSkpO1xuXG5Zb3UgY2FuIGFsc28gc2VuZCBhbiBhcnJheSBvZiBzdWNoIG1lc3NhZ2VzIGluIGEgc2luZ2xlIHBvcnQgd3JpdGUuIEZvciBleGFtcGxlOlxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeShbXG4gICAgICAgIHtqb2JJRDogJzEuMScsIHR5cGU6ICdoYWNrJywgICAuLi59LFxuICAgICAgICB7am9iSUQ6ICcxLjInLCB0eXBlOiAnd2Vha2VuJywgLi4ufSxcbiAgICAgICAge2pvYklEOiAnMS4zJywgdHlwZTogJ2dyb3cnLCAgIC4uLn0sXG4gICAgICAgIHtqb2JJRDogJzEuNCcsIHR5cGU6ICd3ZWFrZW4nLCAuLi59LFxuICAgIF0pKTtcblxuKi9cblxuLy8gLS0tLS0gUHVibGljIEFQSSBUeXBlcyAtLS0tLVxuXG50eXBlIEpvYklEID0gYW55O1xuaW50ZXJmYWNlIEFjdGlvbk1lc3NhZ2Uge1xuICAgIHR5cGU6IFwiaGFja1wiIHwgXCJncm93XCIgfCBcIndlYWtlblwiO1xuICAgIGpvYklEPzogSm9iSUQ7XG4gICAgZHVyYXRpb246IFRpbWVNcztcbiAgICBzdGFydFRpbWU6IFRpbWVNcztcbiAgICBzdGFydFRpbWVBY3R1YWw/OiBUaW1lTXM7XG4gICAgZW5kVGltZT86IFRpbWVNcztcbiAgICBlbmRUaW1lQWN0dWFsPzogVGltZU1zO1xuICAgIGNvbG9yPzogc3RyaW5nO1xuICAgIHJlc3VsdD86IG51bWJlcjtcbn1cbnR5cGUgVXBkYXRlTWVzc2FnZSA9IFBhcnRpYWw8QWN0aW9uTWVzc2FnZT4gJiB7XG4gICAgam9iSUQ6IEpvYklEO1xufVxuaW50ZXJmYWNlIFNwYWNlck1lc3NhZ2Uge1xuICAgIHR5cGU6IFwic3BhY2VyXCJcbn1cbmludGVyZmFjZSBTZXJ2ZXJNZXNzYWdlIHtcbiAgICB0eXBlOiBcImV4cGVjdGVkXCIgfCBcIm9ic2VydmVkXCI7XG4gICAgdGltZTogVGltZU1zO1xuICAgIGhhY2tEaWZmaWN1bHR5OiBudW1iZXI7XG4gICAgbWluRGlmZmljdWx0eTogbnVtYmVyO1xuICAgIG1vbmV5QXZhaWxhYmxlOiBudW1iZXI7XG4gICAgbW9uZXlNYXg6IG51bWJlcjtcbn1cbnR5cGUgRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlID0gU2VydmVyTWVzc2FnZSAmIHtcbiAgICB0eXBlOiBcImV4cGVjdGVkXCJcbn1cbnR5cGUgT2JzZXJ2ZWRTZXJ2ZXJNZXNzYWdlID0gU2VydmVyTWVzc2FnZSAmIHtcbiAgICB0eXBlOiBcIm9ic2VydmVkXCJcbn1cbnR5cGUgQmF0Y2hWaWV3TWVzc2FnZSA9IEFjdGlvbk1lc3NhZ2UgfCBVcGRhdGVNZXNzYWdlIHwgU3BhY2VyTWVzc2FnZSB8IEV4cGVjdGVkU2VydmVyTWVzc2FnZSB8IE9ic2VydmVkU2VydmVyTWVzc2FnZTtcblxuLy8gLS0tLS0gSW50ZXJuYWwgVHlwZXMgLS0tLS1cblxuaW1wb3J0IHR5cGUgeyBOUywgTmV0c2NyaXB0UG9ydCwgU2VydmVyIH0gZnJvbSAnQG5zJztcbmltcG9ydCB0eXBlIFJlYWN0TmFtZXNwYWNlIGZyb20gJ3JlYWN0L2luZGV4JztcbmNvbnN0IFJlYWN0ID0gZ2xvYmFsVGhpcy5SZWFjdCBhcyB0eXBlb2YgUmVhY3ROYW1lc3BhY2U7XG5cbmludGVyZmFjZSBKb2IgZXh0ZW5kcyBBY3Rpb25NZXNzYWdlIHtcbiAgICBqb2JJRDogSm9iSUQ7XG4gICAgcm93SUQ6IG51bWJlcjtcbiAgICBlbmRUaW1lOiBUaW1lTXM7XG59XG5cbnR5cGUgVGltZU1zID0gUmV0dXJuVHlwZTx0eXBlb2YgcGVyZm9ybWFuY2Uubm93PiAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcIm1pbGxpc2Vjb25kc1wiIH07XG50eXBlIFRpbWVTZWNvbmRzID0gbnVtYmVyICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwic2Vjb25kc1wiIH07XG50eXBlIFRpbWVQaXhlbHMgPSBudW1iZXIgJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJwaXhlbHNcIiB9O1xudHlwZSBQaXhlbHMgPSBudW1iZXIgJiB7IF9fdW5pdHM6IFwicGl4ZWxzXCIgfTtcbnR5cGUgVGltZVZhbHVlID0gW1RpbWVNcywgbnVtYmVyXTtcblxuLy8gLS0tLS0gQ29uc3RhbnRzIC0tLS0tIFxuXG4vLyBUT0RPOiBpbml0VGltZSBpcyB1c2VkIGFzIHVuaXF1ZSBET00gSUQgYW5kIGFzIHJlbmRlcmluZyBvcmlnaW4gYnV0IGl0IGlzIHBvb3JseSBzdWl0ZWQgZm9yIGJvdGguXG4vLyAgVGhlIHNjcmlwdCBQSUQgd291bGQgd29yayBiZXR0ZXIgYXMgYSB1bmlxdWUgRE9NIElELlxuLy8gIFRoZSBQdWJsaWMgQVBJIGNvdWxkIHJlcXVpcmUgcGVyZm9ybWFuY2UtZXBvY2ggdGltZXMsIHdoaWNoIHdvbid0IG5lZWQgdG8gYmUgYWRqdXN0ZWQuXG5sZXQgaW5pdFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXM7XG4vKipcbiAqIENvbnZlcnQgdGltZXN0YW1wcyB0byBzZWNvbmRzIHNpbmNlIHRoZSBncmFwaCB3YXMgc3RhcnRlZC5cbiAqIFRvIHJlbmRlciBTVkdzIHVzaW5nIG5hdGl2ZSB0aW1lIHVuaXRzLCB0aGUgdmFsdWVzIG11c3QgYmUgdmFsaWQgMzItYml0IGludHMuXG4gKiBTbyB3ZSBjb252ZXJ0IHRvIGEgcmVjZW50IGVwb2NoIGluIGNhc2UgRGF0ZS5ub3coKSB2YWx1ZXMgYXJlIHVzZWQuXG4gKi9cbmZ1bmN0aW9uIGNvbnZlcnRUaW1lKHQ6IFRpbWVNcywgdDA9aW5pdFRpbWUpOiBUaW1lU2Vjb25kcyB7XG4gICAgcmV0dXJuICgodCAtIHQwKSAvIDEwMDApIGFzIFRpbWVTZWNvbmRzO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0U2VjVG9QeCh0OiBUaW1lU2Vjb25kcyk6IFRpbWVQaXhlbHMge1xuICAgIHJldHVybiB0ICogV0lEVEhfUElYRUxTIC8gV0lEVEhfU0VDT05EUyBhcyBUaW1lUGl4ZWxzO1xufVxuXG5jb25zdCBHUkFQSF9DT0xPUlMgPSB7XG4gICAgaGFjazogXCJjeWFuXCIsXG4gICAgZ3JvdzogXCJsaWdodGdyZWVuXCIsXG4gICAgd2Vha2VuOiBcInllbGxvd1wiLFxuICAgIGRlc3luYzogXCJtYWdlbnRhXCIsXG4gICAgc2FmZTogXCIjMTExXCIsXG4gICAgdW5zYWZlOiBcIiMzMzNcIixcbiAgICBzZWN1cml0eTogXCJyZWRcIixcbiAgICBtb25leTogXCJibHVlXCJcbn07XG5cbi8vIFRPRE86IHVzZSBhIGNvbnRleHQgZm9yIHRoZXNlIHNjYWxlIGZhY3RvcnMuIHN1cHBvcnQgc2V0dGluZyB0aGVtIGJ5IGFyZ3MgYW5kIHNjcm9sbC1nZXN0dXJlcy5cbi8vIGNvbnN0IFNjcmVlbkNvbnRleHQgPSBSZWFjdC5jcmVhdGVDb250ZXh0KHtXSURUSF9QSVhFTFMsIFdJRFRIX1NFQ09ORFMsIEhFSUdIVF9QSVhFTFMsIEZPT1RFUl9QSVhFTFN9KTtcbi8vIFRPRE86IHJldmlldyB1c2Ugb2YgNjAwMDAwLCA2MDAwMCwgMTAwMCwgMTAsIGFuZCBXSURUSF9TRUNPTkRTIGFzIGNsaXBwaW5nIGxpbWl0cy5cbmNvbnN0IFdJRFRIX1BJWEVMUyA9IDgwMCBhcyBUaW1lUGl4ZWxzO1xuY29uc3QgV0lEVEhfU0VDT05EUyA9IDE2IGFzIFRpbWVTZWNvbmRzO1xuY29uc3QgSEVJR0hUX1BJWEVMUyA9IDYwMCBhcyBQaXhlbHM7XG5jb25zdCBGT09URVJfUElYRUxTID0gNTAgYXMgUGl4ZWxzO1xuXG5cbi8vIC0tLS0tIE1haW4gUHJvZ3JhbSAtLS0tLVxuXG5jb25zdCBGTEFHUzogW3N0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IHN0cmluZ1tdXVtdID0gW1xuICAgIFtcImhlbHBcIiwgZmFsc2VdLFxuICAgIFtcInBvcnRcIiwgMF0sXG4gICAgW1wiZGVidWdcIiwgZmFsc2VdLFxuXTtcblxuZXhwb3J0IGZ1bmN0aW9uIGF1dG9jb21wbGV0ZShkYXRhOiBhbnksIGFyZ3M6IHN0cmluZ1tdKSB7XG4gICAgZGF0YS5mbGFncyhGTEFHUyk7XG4gICAgcmV0dXJuIFtdO1xufVxuXG4vKiogQHBhcmFtIHtOU30gbnMgKiovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWFpbihuczogTlMpIHtcbiAgICBucy5kaXNhYmxlTG9nKCdzbGVlcCcpO1xuICAgIG5zLmRpc2FibGVMb2coJ2FzbGVlcCcpO1xuICAgIG5zLmNsZWFyTG9nKCk7XG4gICAgbnMudGFpbCgpO1xuICAgIG5zLnJlc2l6ZVRhaWwoODEwLCA2NDApO1xuXG4gICAgY29uc3QgZmxhZ3MgPSBucy5mbGFncyhGTEFHUyk7XG4gICAgaWYgKGZsYWdzLmhlbHApIHtcbiAgICAgICAgbnMudHByaW50KFtcbiAgICAgICAgICAgIGBVU0FHRWAsXG4gICAgICAgICAgICBgPiBydW4gJHtucy5nZXRTY3JpcHROYW1lKCl9IC0tcG9ydCAxMGAsXG4gICAgICAgICAgICAnICdcbiAgICAgICAgXS5qb2luKFwiXFxuXCIpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBwb3J0TnVtID0gZmxhZ3MucG9ydCBhcyBudW1iZXIgfHwgbnMucGlkO1xuICAgIGNvbnN0IGRlYnVnID0gZmxhZ3MuZGVidWcgYXMgYm9vbGVhbjtcblxuICAgIGNvbnN0IGJhdGNoVmlldyA9IDxCYXRjaFZpZXcgbnM9e25zfSBwb3J0TnVtPXtwb3J0TnVtfSBkZWJ1Zz17ZGVidWd9IC8+O1xuICAgIG5zLnByaW50KGBMaXN0ZW5pbmcgb24gUG9ydCAke3BvcnROdW19YCk7XG4gICAgbnMucHJpbnRSYXcoYmF0Y2hWaWV3KTtcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGF3YWl0IG5zLmFzbGVlcCg2MCoxMDAwKTtcbiAgICB9XG59XG5cbi8vIC0tLS0tIEJhdGNoVmlldyBDb21wb25lbnQgLS0tLS1cblxuaW50ZXJmYWNlIEJhdGNoVmlld1Byb3BzIHtcbiAgICBuczogTlM7XG4gICAgcG9ydE51bTogbnVtYmVyO1xuICAgIGRlYnVnPzogYm9vbGVhbjtcbn1cbmludGVyZmFjZSBCYXRjaFZpZXdTdGF0ZSB7XG4gICAgcnVubmluZzogYm9vbGVhbjtcbiAgICBub3c6IFRpbWVNcztcbiAgICBkYXRhVXBkYXRlczogbnVtYmVyO1xufVxuZXhwb3J0IGNsYXNzIEJhdGNoVmlldyBleHRlbmRzIFJlYWN0LkNvbXBvbmVudDxCYXRjaFZpZXdQcm9wcywgQmF0Y2hWaWV3U3RhdGU+IHtcbiAgICBwb3J0OiBOZXRzY3JpcHRQb3J0O1xuICAgIGpvYnM6IE1hcDxKb2JJRCwgSm9iPjtcbiAgICBzZXF1ZW50aWFsUm93SUQ6IG51bWJlciA9IDA7XG4gICAgc2VxdWVudGlhbEpvYklEOiBudW1iZXIgPSAwO1xuICAgIGV4cGVjdGVkU2VydmVyczogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlW107XG4gICAgb2JzZXJ2ZWRTZXJ2ZXJzOiBPYnNlcnZlZFNlcnZlck1lc3NhZ2VbXTtcblxuICAgIGNvbnN0cnVjdG9yKHByb3BzOiBCYXRjaFZpZXdQcm9wcyl7XG4gICAgICAgIHN1cGVyKHByb3BzKTtcbiAgICAgICAgY29uc3QgeyBucywgcG9ydE51bSwgZGVidWcgfSA9IHByb3BzO1xuICAgICAgICB0aGlzLnN0YXRlID0ge1xuICAgICAgICAgICAgcnVubmluZzogdHJ1ZSxcbiAgICAgICAgICAgIG5vdzogcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zLFxuICAgICAgICAgICAgZGF0YVVwZGF0ZXM6IDAsXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMucG9ydCA9IG5zLmdldFBvcnRIYW5kbGUocG9ydE51bSk7XG4gICAgICAgIHRoaXMuam9icyA9IG5ldyBNYXAoKTtcbiAgICAgICAgdGhpcy5leHBlY3RlZFNlcnZlcnMgPSBbXTtcbiAgICAgICAgdGhpcy5vYnNlcnZlZFNlcnZlcnMgPSBbXTtcbiAgICAgICAgaWYgKGRlYnVnKSB7XG4gICAgICAgICAgICBPYmplY3QuYXNzaWduKGdsb2JhbFRoaXMsIHtiYXRjaFZpZXc6IHRoaXN9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbXBvbmVudERpZE1vdW50KCkge1xuICAgICAgICBjb25zdCB7IG5zLCBwb3J0TnVtIH0gPSB0aGlzLnByb3BzO1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiB0cnVlfSk7XG4gICAgICAgIG5zLmF0RXhpdCgoKT0+e1xuICAgICAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogZmFsc2V9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZSgpO1xuICAgICAgICB0aGlzLnJlYWRQb3J0KCk7XG4gICAgfVxuXG4gICAgY29tcG9uZW50V2lsbFVubW91bnQoKSB7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IGZhbHNlfSk7XG4gICAgfVxuXG4gICAgYW5pbWF0ZSA9ICgpPT57XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5ydW5uaW5nKSByZXR1cm47XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe25vdzogcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zfSk7XG4gICAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGUpO1xuICAgIH1cblxuICAgIHJlYWRQb3J0ID0gYXN5bmMgKCk9PntcbiAgICAgICAgd2hpbGUgKHRoaXMuc3RhdGUucnVubmluZykge1xuICAgICAgICAgICAgd2hpbGUoIXRoaXMucG9ydC5lbXB0eSgpKSB7XG4gICAgICAgICAgICAgICAgbGV0IG1zZ3M6IEJhdGNoVmlld01lc3NhZ2UgfCBCYXRjaFZpZXdNZXNzYWdlW10gPSBKU09OLnBhcnNlKHRoaXMucG9ydC5yZWFkKCkgYXMgc3RyaW5nKTtcbiAgICAgICAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkobXNncykpIHtcbiAgICAgICAgICAgICAgICAgICAgbXNncyA9IFttc2dzXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBtc2cgb2YgbXNncykge1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5yZWNlaXZlTWVzc2FnZShtc2cpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGAke3RoaXMucHJvcHMubnMuZ2V0U2NyaXB0TmFtZSgpfTogRXJyb3IgcGFyc2luZyBtZXNzYWdlIGAsIG1zZywgZSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBvcnQubmV4dFdyaXRlKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZWNlaXZlTWVzc2FnZShtc2c6IEJhdGNoVmlld01lc3NhZ2UpIHtcbiAgICAgICAgaWYgKG1zZy50eXBlID09IFwic3BhY2VyXCIpIHtcbiAgICAgICAgICAgIHRoaXMuc2VxdWVudGlhbFJvd0lEICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAobXNnLnR5cGUgPT0gXCJleHBlY3RlZFwiKSB7XG4gICAgICAgICAgICB0aGlzLmV4cGVjdGVkU2VydmVycy5wdXNoKG1zZyk7XG4gICAgICAgICAgICB0aGlzLmV4cGVjdGVkU2VydmVycyA9IHRoaXMuY2xlYW5TZXJ2ZXJzKHRoaXMuZXhwZWN0ZWRTZXJ2ZXJzKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cudHlwZSA9PSBcIm9ic2VydmVkXCIpIHtcbiAgICAgICAgICAgIHRoaXMub2JzZXJ2ZWRTZXJ2ZXJzLnB1c2gobXNnKTtcbiAgICAgICAgICAgIHRoaXMub2JzZXJ2ZWRTZXJ2ZXJzID0gdGhpcy5jbGVhblNlcnZlcnModGhpcy5vYnNlcnZlZFNlcnZlcnMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKG1zZy5qb2JJRCAhPT0gdW5kZWZpbmVkIHx8IG1zZy50eXBlID09ICdoYWNrJyB8fCBtc2cudHlwZSA9PSAnZ3JvdycgfHwgbXNnLnR5cGUgPT0gJ3dlYWtlbicpIHtcbiAgICAgICAgICAgIHRoaXMuYWRkSm9iKG1zZyk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVucmVjb2duaXplZCBtZXNzYWdlIHR5cGU6ICR7bXNnLnR5cGV9OmApO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe2RhdGFVcGRhdGVzOiB0aGlzLnN0YXRlLmRhdGFVcGRhdGVzICsgMX0pO1xuICAgIH1cblxuICAgIGFkZEpvYihtc2c6IEFjdGlvbk1lc3NhZ2UgfCBVcGRhdGVNZXNzYWdlKSB7XG4gICAgICAgIC8vIEFzc2lnbiBzZXF1ZW50aWFsIElEIGlmIG5lZWRlZFxuICAgICAgICBsZXQgam9iSUQgPSBtc2cuam9iSUQ7XG4gICAgICAgIGlmIChqb2JJRCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB3aGlsZSAodGhpcy5qb2JzLmhhcyh0aGlzLnNlcXVlbnRpYWxKb2JJRCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNlcXVlbnRpYWxKb2JJRCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgam9iSUQgPSB0aGlzLnNlcXVlbnRpYWxKb2JJRDtcbiAgICAgICAgfVxuICAgICAgICBsZXQgam9iID0gdGhpcy5qb2JzLmdldChqb2JJRCk7XG4gICAgICAgIGlmIChqb2IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgLy8gQ3JlYXRlIG5ldyBKb2IgcmVjb3JkIHdpdGggcmVxdWlyZWQgZmllbGRzXG4gICAgICAgICAgICBpZiAobXNnLmpvYklEICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGZpZWxkIG9mIFsndHlwZScsICdzdGFydFRpbWUnLCAnZHVyYXRpb24nXSBhcyBjb25zdCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobXNnW2ZpZWxkXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFRyaWVkIHRvIHVwZGF0ZSBhIG5vbi1leGlzdGluZyBqb2JJRGAsIG1zZyk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBqb2IgPSB7XG4gICAgICAgICAgICAgICAgam9iSUQ6IGpvYklELFxuICAgICAgICAgICAgICAgIHJvd0lEOiB0aGlzLnNlcXVlbnRpYWxSb3dJRCsrLFxuICAgICAgICAgICAgICAgIGVuZFRpbWU6IChtc2cuc3RhcnRUaW1lfHwwKSArIChtc2cuZHVyYXRpb258fDApIGFzIFRpbWVNcyxcbiAgICAgICAgICAgICAgICAuLi4obXNnIGFzIEFjdGlvbk1lc3NhZ2UpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gTWVyZ2UgdXBkYXRlcyBpbnRvIGV4aXN0aW5nIGpvYiByZWNvcmRcbiAgICAgICAgICAgIGpvYiA9IHtcbiAgICAgICAgICAgICAgICAuLi5qb2IsXG4gICAgICAgICAgICAgICAgLi4ubXNnXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZmllbGQgb2YgWyd0eXBlJywgJ3N0YXJ0VGltZScsICdkdXJhdGlvbiddIGFzIGNvbnN0KSB7XG4gICAgICAgICAgICBpZiAoam9iW2ZpZWxkXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHJlcXVpcmVkIGZpZWxkICcke2ZpZWxkfSdgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IGZpZWxkIG9mIFsnc3RhcnRUaW1lJywgJ2R1cmF0aW9uJywgJ2VuZFRpbWUnLCAnc3RhcnRUaW1lQWN0dWFsJywgJ2VuZFRpbWVBY3R1YWwnXSBhcyBjb25zdCkge1xuICAgICAgICAgICAgaWYgKGpvYltmaWVsZF0gIT09IHVuZGVmaW5lZCAmJiBqb2JbZmllbGRdIGFzIG51bWJlciA+IHRoaXMudmFsaWRUaW1lUmFuZ2UoKVsxXSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCB2YWx1ZSBmb3IgJyR7ZmllbGR9JzogJHtqb2JbZmllbGRdfS4gRXhwZWN0ZWQgYSB2YWx1ZSBmcm9tIHBlcmZvcm1hbmNlLm5vdygpLmApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuam9icy5zZXQoam9iSUQsIGpvYik7XG4gICAgICAgIHRoaXMuY2xlYW5Kb2JzKCk7XG4gICAgfVxuXG4gICAgdmFsaWRUaW1lUmFuZ2UoKSB7XG4gICAgICAgIC8vIHVwIHRvIDIgc2NyZWVucyBpbiB0aGUgcGFzdFxuICAgICAgICAvLyB1cCB0byAzMCBkYXlzIGluIHRoZSBmdXR1cmVcbiAgICAgICAgcmV0dXJuIFt0aGlzLnN0YXRlLm5vdy0oV0lEVEhfU0VDT05EUyoyKjEwMDApLCAxMDAwKjYwKjYwKjI0KjMwXTtcbiAgICB9XG5cbiAgICBjbGVhbkpvYnMoKSB7XG4gICAgICAgIGNvbnN0IFtlYXJsaWVzdFRpbWUsIGxhdGVzdFRpbWVdID0gdGhpcy52YWxpZFRpbWVSYW5nZSgpO1xuICAgICAgICAvLyBGaWx0ZXIgb3V0IGV4cGlyZWQgam9icyAoZW5kVGltZSBtb3JlIHRoYW4gMiBzY3JlZW5zIGluIHRoZSBwYXN0KVxuICAgICAgICBpZiAodGhpcy5qb2JzLnNpemUgPiAyMDApIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qgam9iSUQgb2YgdGhpcy5qb2JzLmtleXMoKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuam9icy5nZXQoam9iSUQpIGFzIEpvYjtcbiAgICAgICAgICAgICAgICBpZiAoIShqb2IuZW5kVGltZSA+IGVhcmxpZXN0VGltZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5qb2JzLmRlbGV0ZShqb2JJRCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY2xlYW5TZXJ2ZXJzPFQgZXh0ZW5kcyBTZXJ2ZXJNZXNzYWdlPihzZXJ2ZXJzOiBUW10pOiBUW10ge1xuICAgICAgICBjb25zdCBbZWFybGllc3RUaW1lLCBsYXRlc3RUaW1lXSA9IHRoaXMudmFsaWRUaW1lUmFuZ2UoKTtcbiAgICAgICAgLy8gVE9ETzogaW5zZXJ0IGl0ZW0gaW50byBzb3J0ZWQgbGlzdCBpbnN0ZWFkIG9mIHJlLXNvcnRpbmcgZWFjaCB0aW1lXG4gICAgICAgIHJldHVybiBzZXJ2ZXJzLmZpbHRlcigocyk9PnMudGltZSA+IGVhcmxpZXN0VGltZSkuc29ydCgoYSxiKT0+YS50aW1lIC0gYi50aW1lKTtcbiAgICB9XG5cbiAgICByZW5kZXIoKSB7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8R3JhcGhGcmFtZSBub3c9e3RoaXMuc3RhdGUubm93fT5cbiAgICAgICAgICAgICAgICA8U2FmZXR5TGF5ZXIgZXhwZWN0ZWRTZXJ2ZXJzPXt0aGlzLmV4cGVjdGVkU2VydmVyc30gLz5cbiAgICAgICAgICAgICAgICA8Sm9iTGF5ZXIgam9icz17Wy4uLnRoaXMuam9icy52YWx1ZXMoKV19IC8+XG4gICAgICAgICAgICAgICAgPFNlY3VyaXR5TGF5ZXIgZXhwZWN0ZWRTZXJ2ZXJzPXt0aGlzLmV4cGVjdGVkU2VydmVyc30gb2JzZXJ2ZWRTZXJ2ZXJzPXt0aGlzLm9ic2VydmVkU2VydmVyc30gLz5cbiAgICAgICAgICAgICAgICA8TW9uZXlMYXllciBleHBlY3RlZFNlcnZlcnM9e3RoaXMuZXhwZWN0ZWRTZXJ2ZXJzfSBvYnNlcnZlZFNlcnZlcnM9e3RoaXMub2JzZXJ2ZWRTZXJ2ZXJzfSAvPlxuICAgICAgICAgICAgPC9HcmFwaEZyYW1lPlxuICAgICAgICApXG4gICAgfVxufVxuXG5mdW5jdGlvbiBHcmFwaEZyYW1lKHtub3csIGNoaWxkcmVufTp7bm93OlRpbWVNcywgY2hpbGRyZW46IFJlYWN0LlJlYWN0Tm9kZX0pOiBSZWFjdC5SZWFjdEVsZW1lbnQge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxzdmcgdmVyc2lvbj1cIjEuMVwiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIlxuICAgICAgICAgICAgd2lkdGg9e1dJRFRIX1BJWEVMU31cbiAgICAgICAgICAgIGhlaWdodD17SEVJR0hUX1BJWEVMU30gXG4gICAgICAgICAgICAvLyBTZXQgdGhlIHZpZXdCb3ggZm9yIDEwIHNlY29uZHMgb2YgaGlzdG9yeSwgNiBzZWNvbmRzIG9mIGZ1dHVyZS5cbiAgICAgICAgICAgIHZpZXdCb3g9e2Ake2NvbnZlcnRTZWNUb1B4KC0xMCBhcyBUaW1lU2Vjb25kcyl9IDAgJHtXSURUSF9QSVhFTFN9ICR7SEVJR0hUX1BJWEVMU31gfVxuICAgICAgICA+XG4gICAgICAgICAgICA8ZGVmcz5cbiAgICAgICAgICAgICAgICA8Y2xpcFBhdGggaWQ9e2BoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfWB9IGNsaXBQYXRoVW5pdHM9XCJ1c2VyU3BhY2VPblVzZVwiPlxuICAgICAgICAgICAgICAgICAgICA8cmVjdCBpZD1cImhpZGUtZnV0dXJlLXJlY3RcIlxuICAgICAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUobm93LTYwMDAwIGFzIFRpbWVNcyl9IHdpZHRoPXtjb252ZXJ0VGltZSg2MDAwMCBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD17NTB9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9jbGlwUGF0aD5cbiAgICAgICAgICAgIDwvZGVmcz5cbiAgICAgICAgICAgIDxyZWN0IGlkPVwiYmFja2dyb3VuZFwiIHg9e2NvbnZlcnRTZWNUb1B4KC0xMCBhcyBUaW1lU2Vjb25kcyl9IHdpZHRoPVwiMTAwJVwiIGhlaWdodD1cIjEwMCVcIiBmaWxsPXtHUkFQSF9DT0xPUlMuc2FmZX0gLz5cbiAgICAgICAgICAgIDxnIGlkPVwidGltZUNvb3JkaW5hdGVzXCIgdHJhbnNmb3JtPXtgc2NhbGUoJHtXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTfSAxKSB0cmFuc2xhdGUoJHtjb252ZXJ0VGltZShpbml0VGltZS1ub3cgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9IDApYH0+XG4gICAgICAgICAgICAgICAge2NoaWxkcmVufVxuICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0xXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy1GT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTJcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLTIqRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgPHJlY3QgaWQ9XCJjdXJzb3JcIiB4PXswfSB3aWR0aD17MX0geT17MH0gaGVpZ2h0PVwiMTAwJVwiIGZpbGw9XCJ3aGl0ZVwiIC8+XG4gICAgICAgICAgICA8R3JhcGhMZWdlbmQgLz5cbiAgICAgICAgPC9zdmc+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gR3JhcGhMZWdlbmQoKTogUmVhY3QuUmVhY3RFbGVtZW50IHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cIkxlZ2VuZFwiIHRyYW5zZm9ybT1cInRyYW5zbGF0ZSgtNDkwLCAxMCksIHNjYWxlKC41LCAuNSlcIj5cbiAgICAgICAgICAgIDxyZWN0IHg9ezF9IHk9ezF9IHdpZHRoPXsyNzV9IGhlaWdodD17MzkyfSBmaWxsPVwiYmxhY2tcIiBzdHJva2U9XCIjOTc5Nzk3XCIgLz5cbiAgICAgICAgICAgIHtPYmplY3QuZW50cmllcyhHUkFQSF9DT0xPUlMpLm1hcCgoW2xhYmVsLCBjb2xvcl0sIGkpPT4oXG4gICAgICAgICAgICAgICAgPGcga2V5PXtsYWJlbH0gdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDIyLCAkezEzICsgNDEqaX0pYH0+XG4gICAgICAgICAgICAgICAgICAgIDxyZWN0IHg9ezB9IHk9ezB9IHdpZHRoPXsyMn0gaGVpZ2h0PXsyMn0gZmlsbD17Y29sb3J9IC8+XG4gICAgICAgICAgICAgICAgICAgIDx0ZXh0IGZvbnRGYW1pbHk9XCJDb3VyaWVyIE5ld1wiIGZvbnRTaXplPXszNn0gZmlsbD1cIiM4ODhcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDx0c3BhbiB4PXs0Mi41fSB5PXszMH0+e2xhYmVsLnN1YnN0cmluZygwLDEpLnRvVXBwZXJDYXNlKCkrbGFiZWwuc3Vic3RyaW5nKDEpfTwvdHNwYW4+XG4gICAgICAgICAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIFNhZmV0eUxheWVyKHtleHBlY3RlZFNlcnZlcnN9OiB7ZXhwZWN0ZWRTZXJ2ZXJzOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2VbXX0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGxldCBwcmV2U2VydmVyOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2UgfCB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJzYWZldHlMYXllclwiPlxuICAgICAgICAgICAge2V4cGVjdGVkU2VydmVycy5tYXAoKHNlcnZlciwgaSk9PntcbiAgICAgICAgICAgICAgICBsZXQgZWwgPSBudWxsO1xuICAgICAgICAgICAgICAgIC8vIHNoYWRlIHRoZSBiYWNrZ3JvdW5kIGJhc2VkIG9uIHNlY0xldmVsXG4gICAgICAgICAgICAgICAgaWYgKHByZXZTZXJ2ZXIgJiYgc2VydmVyLnRpbWUgPiBwcmV2U2VydmVyLnRpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgZWwgPSAoPHJlY3Qga2V5PXtpfVxuICAgICAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUocHJldlNlcnZlci50aW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHNlcnZlci50aW1lIC0gcHJldlNlcnZlci50aW1lIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgICAgICAgICAgICAgeT17MH0gaGVpZ2h0PVwiMTAwJVwiXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxsPXsocHJldlNlcnZlci5oYWNrRGlmZmljdWx0eSA+IHByZXZTZXJ2ZXIubWluRGlmZmljdWx0eSkgPyBHUkFQSF9DT0xPUlMudW5zYWZlIDogR1JBUEhfQ09MT1JTLnNhZmV9XG4gICAgICAgICAgICAgICAgICAgIC8+KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcHJldlNlcnZlciA9IHNlcnZlcjtcbiAgICAgICAgICAgICAgICByZXR1cm4gZWw7XG4gICAgICAgICAgICB9KX1cbiAgICAgICAgICAgIHtwcmV2U2VydmVyICYmIChcbiAgICAgICAgICAgICAgICA8cmVjdCBrZXk9XCJyZW1haW5kZXJcIlxuICAgICAgICAgICAgICAgICAgICB4PXtjb252ZXJ0VGltZShwcmV2U2VydmVyLnRpbWUpfSB3aWR0aD17Y29udmVydFRpbWUoNjAwMDAwIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgICAgICAgICB5PXswfSBoZWlnaHQ9XCIxMDAlXCJcbiAgICAgICAgICAgICAgICAgICAgZmlsbD17KHByZXZTZXJ2ZXIuaGFja0RpZmZpY3VsdHkgPiBwcmV2U2VydmVyLm1pbkRpZmZpY3VsdHkpID8gR1JBUEhfQ09MT1JTLnVuc2FmZSA6IEdSQVBIX0NPTE9SUy5zYWZlfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICApfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gSm9iTGF5ZXIoe2pvYnN9OiB7am9iczogSm9iW119KSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJqb2JMYXllclwiPlxuICAgICAgICAgICAge2pvYnMubWFwKChqb2I6IEpvYik9Pig8Sm9iQmFyIGpvYj17am9ifSBrZXk9e2pvYi5qb2JJRH0gLz4pKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEpvYkJhcih7am9ifToge2pvYjogSm9ifSk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgY29uc3QgeSA9ICgoam9iLnJvd0lEICsgMSkgJSAoKEhFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTKjIpIC8gNCkpICogNDtcbiAgICBsZXQgam9iQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLnN0YXJ0VGltZSAmJiBqb2IuZHVyYXRpb24pIHtcbiAgICAgICAgam9iQmFyID0gKDxyZWN0XG4gICAgICAgICAgICB4PXtjb252ZXJ0VGltZShqb2Iuc3RhcnRUaW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKGpvYi5kdXJhdGlvbiwgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsyfVxuICAgICAgICAgICAgZmlsbD17am9iLmNvbG9yID8/IEdSQVBIX0NPTE9SU1tqb2IudHlwZV19XG4gICAgICAgIC8+KVxuICAgIH07XG4gICAgbGV0IHN0YXJ0RXJyb3JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5zdGFydFRpbWUsIGpvYi5zdGFydFRpbWVBY3R1YWxdLnNvcnQoKGEsYik9PmEtYik7XG4gICAgICAgIHN0YXJ0RXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgZmlsbD17R1JBUEhfQ09MT1JTLmRlc3luY31cbiAgICAgICAgIC8+KTtcbiAgICB9XG4gICAgbGV0IGVuZEVycm9yQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLmVuZFRpbWVBY3R1YWwpIHtcbiAgICAgICAgY29uc3QgW3QxLCB0Ml0gPSBbam9iLmVuZFRpbWUsIGpvYi5lbmRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICBlbmRFcnJvckJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUodDEpfSB3aWR0aD17Y29udmVydFRpbWUodDItdDEgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBmaWxsPXtHUkFQSF9DT0xPUlMuZGVzeW5jfVxuICAgICAgICAgLz4pO1xuICAgIH1cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke3l9KWB9PlxuICAgICAgICAgICAge2pvYkJhcn1cbiAgICAgICAgICAgIHtzdGFydEVycm9yQmFyfVxuICAgICAgICAgICAge2VuZEVycm9yQmFyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuaW50ZXJmYWNlIFNlY3VyaXR5TGF5ZXJQcm9wcyB7XG4gICAgZXhwZWN0ZWRTZXJ2ZXJzOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2VbXTtcbiAgICBvYnNlcnZlZFNlcnZlcnM6IE9ic2VydmVkU2VydmVyTWVzc2FnZVtdXG59XG5mdW5jdGlvbiBTZWN1cml0eUxheWVyKHtleHBlY3RlZFNlcnZlcnMsIG9ic2VydmVkU2VydmVyc306U2VjdXJpdHlMYXllclByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBleHBlY3RlZFNlcnZlcnMgPz89IFtdO1xuICAgIG9ic2VydmVkU2VydmVycyA/Pz0gW107XG4gICAgbGV0IG1pblNlYyA9IDA7XG4gICAgbGV0IG1heFNlYyA9IDE7XG4gICAgZm9yIChjb25zdCBzbmFwc2hvdHMgb2YgW2V4cGVjdGVkU2VydmVycywgb2JzZXJ2ZWRTZXJ2ZXJzXSkge1xuICAgICAgICBmb3IgKGNvbnN0IHNlcnZlciBvZiBzbmFwc2hvdHMpIHtcbiAgICAgICAgICAgIG1pblNlYyA9IE1hdGgubWluKG1pblNlYywgc2VydmVyLmhhY2tEaWZmaWN1bHR5KTtcbiAgICAgICAgICAgIG1heFNlYyA9IE1hdGgubWF4KG1heFNlYywgc2VydmVyLmhhY2tEaWZmaWN1bHR5KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG9ic2VydmVkRXZlbnRzID0gb2JzZXJ2ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyKT0+W3NlcnZlci50aW1lLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHldKSBhcyBUaW1lVmFsdWVbXTtcbiAgICBjb25zdCBzaG91bGRDbG9zZVBhdGggPSB0cnVlO1xuICAgIGNvbnN0IG9ic2VydmVkUGF0aCA9IGNvbXB1dGVQYXRoRGF0YShvYnNlcnZlZEV2ZW50cywgbWluU2VjLCBzaG91bGRDbG9zZVBhdGgpO1xuICAgIGNvbnN0IG9ic2VydmVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwib2JzZXJ2ZWRTZWNcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heFNlYyAtIG1pblNlYyl9KWB9XG4gICAgICAgICAgICBmaWxsPXtcImRhcmtcIitHUkFQSF9DT0xPUlMuc2VjdXJpdHl9XG4gICAgICAgICAgICAvLyBmaWxsT3BhY2l0eTogMC41LFxuICAgICAgICAgICAgY2xpcFBhdGg9e2B1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWB9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxwYXRoIGQ9e29ic2VydmVkUGF0aC5qb2luKFwiIFwiKX0gLz5cbiAgICAgICAgPC9nPlxuICAgICk7XG5cbiAgICBjb25zdCBleHBlY3RlZEV2ZW50cyA9IGV4cGVjdGVkU2VydmVycy5tYXAoKHNlcnZlcik9PltzZXJ2ZXIudGltZSwgc2VydmVyLmhhY2tEaWZmaWN1bHR5XSkgYXMgVGltZVZhbHVlW107XG4gICAgY29uc3QgZXhwZWN0ZWRQYXRoID0gY29tcHV0ZVBhdGhEYXRhKGV4cGVjdGVkRXZlbnRzKTtcbiAgICBjb25zdCBleHBlY3RlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cImV4cGVjdGVkU2VjXCJcbiAgICAgICAgICAgIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhTZWMgLSBtaW5TZWMpfSlgfVxuICAgICAgICAgICAgc3Ryb2tlPXtHUkFQSF9DT0xPUlMuc2VjdXJpdHl9XG4gICAgICAgICAgICBmaWxsPVwibm9uZVwiXG4gICAgICAgICAgICBzdHJva2VXaWR0aD17Mn1cbiAgICAgICAgICAgIHN0cm9rZUxpbmVqb2luPVwiYmV2ZWxcIlxuICAgICAgICA+XG4gICAgICAgICAgICA8cGF0aCBkPXtleHBlY3RlZFBhdGguam9pbihcIiBcIil9IHZlY3RvckVmZmVjdD1cIm5vbi1zY2FsaW5nLXN0cm9rZVwiIC8+XG4gICAgICAgIDwvZz5cbiAgICApO1xuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJzZWNMYXllclwiIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7SEVJR0hUX1BJWEVMUyAtIDIqRk9PVEVSX1BJWEVMU30pYH0+XG4gICAgICAgICAgICB7b2JzZXJ2ZWRMYXllcn1cbiAgICAgICAgICAgIHtleHBlY3RlZExheWVyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gY29tcHV0ZVBhdGhEYXRhKGV2ZW50czogVGltZVZhbHVlW10sIG1pblZhbHVlPTAsIHNob3VsZENsb3NlPWZhbHNlLCBzY2FsZT0xKSB7XG4gICAgY29uc3QgcGF0aERhdGEgPSBbXTtcbiAgICBpZiAoZXZlbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgW3RpbWUsIHZhbHVlXSA9IGV2ZW50c1swXTtcbiAgICAgICAgLy8gc3RhcnQgbGluZSBhdCBmaXJzdCBwcm9qZWN0ZWQgdGltZSBhbmQgdmFsdWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgTSAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IFt0aW1lLCB2YWx1ZV0gb2YgZXZlbnRzKSB7XG4gICAgICAgIC8vIGhvcml6b250YWwgbGluZSB0byBjdXJyZW50IHRpbWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9YClcbiAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBuZXcgbGV2ZWxcbiAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyh2YWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICB9XG4gICAgLy8gZmlsbCBpbiBhcmVhIGJldHdlZW4gbGFzdCBzbmFwc2hvdCBhbmQgcmlnaHQgc2lkZSAoYXJlYSBhZnRlciBcIm5vd1wiIGN1cnNvciB3aWxsIGJlIGNsaXBwZWQgbGF0ZXIpXG4gICAgaWYgKGV2ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IFt0aW1lLCB2YWx1ZV0gPSBldmVudHNbZXZlbnRzLmxlbmd0aC0xXTtcbiAgICAgICAgLy8gaG9yaXpvbnRhbCBsaW5lIHRvIGZ1dHVyZSB0aW1lXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYEggJHtjb252ZXJ0VGltZSh0aW1lICsgNjAwMDAwIGFzIFRpbWVNcykudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgaWYgKHNob3VsZENsb3NlKSB7XG4gICAgICAgICAgICAvLyBmaWxsIGFyZWEgdW5kZXIgYWN0dWFsIHNlY3VyaXR5XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KG1pblZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgICAgICAgICAgY29uc3QgbWluVGltZSA9IGV2ZW50c1swXVswXTtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYEggJHtjb252ZXJ0VGltZShtaW5UaW1lKS50b0ZpeGVkKDMpfWApO1xuICAgICAgICAgICAgcGF0aERhdGEucHVzaCgnWicpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBwYXRoRGF0YTtcbn1cblxuZnVuY3Rpb24gTW9uZXlMYXllcih7ZXhwZWN0ZWRTZXJ2ZXJzLCBvYnNlcnZlZFNlcnZlcnN9OiBTZWN1cml0eUxheWVyUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGV4cGVjdGVkU2VydmVycyA/Pz0gW107XG4gICAgb2JzZXJ2ZWRTZXJ2ZXJzID8/PSBbXTtcbiAgICBpZiAoZXhwZWN0ZWRTZXJ2ZXJzLmxlbmd0aCA9PSAwICYmIG9ic2VydmVkU2VydmVycy5sZW5ndGggPT0gMCkgcmV0dXJuIG51bGw7XG4gICAgbGV0IG1pbk1vbmV5ID0gMDtcbiAgICBsZXQgbWF4TW9uZXkgPSAoZXhwZWN0ZWRTZXJ2ZXJzWzBdIHx8IG9ic2VydmVkU2VydmVyc1swXSkubW9uZXlNYXg7XG4gICAgY29uc3Qgc2NhbGUgPSAxL21heE1vbmV5O1xuICAgIG1heE1vbmV5ICo9IDEuMVxuXG4gICAgY29uc3Qgb2JzZXJ2ZWRFdmVudHMgPSBvYnNlcnZlZFNlcnZlcnMubWFwKChzZXJ2ZXIpPT5bc2VydmVyLnRpbWUsIHNlcnZlci5tb25leUF2YWlsYWJsZV0pIGFzIFRpbWVWYWx1ZVtdO1xuICAgIGxldCBzaG91bGRDbG9zZVBhdGggPSB0cnVlO1xuICAgIGNvbnN0IG9ic2VydmVkUGF0aCA9IGNvbXB1dGVQYXRoRGF0YShvYnNlcnZlZEV2ZW50cywgbWluTW9uZXksIHNob3VsZENsb3NlUGF0aCwgc2NhbGUpO1xuICAgIGNvbnN0IG9ic2VydmVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwib2JzZXJ2ZWRNb25leVwiXG4gICAgICAgICAgICB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4TW9uZXkgLSBtaW5Nb25leSkgLyBzY2FsZX0pYH1cbiAgICAgICAgICAgIGZpbGw9e1wiZGFya1wiK0dSQVBIX0NPTE9SUy5tb25leX1cbiAgICAgICAgICAgIC8vIGZpbGxPcGFjaXR5OiAwLjUsXG4gICAgICAgICAgICBjbGlwUGF0aD17YHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHBhdGggZD17b2JzZXJ2ZWRQYXRoLmpvaW4oXCIgXCIpfSAvPlxuICAgICAgICA8L2c+XG4gICAgKTtcblxuICAgIGNvbnN0IGV4cGVjdGVkRXZlbnRzID0gZXhwZWN0ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyKT0+W3NlcnZlci50aW1lLCBzZXJ2ZXIubW9uZXlBdmFpbGFibGVdKSBhcyBUaW1lVmFsdWVbXTtcbiAgICBzaG91bGRDbG9zZVBhdGggPSBmYWxzZTtcbiAgICBjb25zdCBleHBlY3RlZFBhdGggPSBjb21wdXRlUGF0aERhdGEoZXhwZWN0ZWRFdmVudHMsIG1pbk1vbmV5LCBzaG91bGRDbG9zZVBhdGgsIHNjYWxlKTtcbiAgICBjb25zdCBleHBlY3RlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cImV4cGVjdGVkTW9uZXlcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heE1vbmV5IC0gbWluTW9uZXkpIC8gc2NhbGV9KWB9XG4gICAgICAgICAgICBzdHJva2U9e0dSQVBIX0NPTE9SUy5tb25leX1cbiAgICAgICAgICAgIGZpbGw9XCJub25lXCJcbiAgICAgICAgICAgIHN0cm9rZVdpZHRoPXsyfVxuICAgICAgICAgICAgc3Ryb2tlTGluZWpvaW49XCJiZXZlbFwiXG4gICAgICAgID5cbiAgICAgICAgICAgIDxwYXRoIGQ9e2V4cGVjdGVkUGF0aC5qb2luKFwiIFwiKX0gdmVjdG9yRWZmZWN0PVwibm9uLXNjYWxpbmctc3Ryb2tlXCIgLz5cbiAgICAgICAgPC9nPlxuICAgICk7XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cIm1vbmV5TGF5ZXJcIiB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTfSlgfT5cbiAgICAgICAgICAgIHtvYnNlcnZlZExheWVyfVxuICAgICAgICAgICAge2V4cGVjdGVkTGF5ZXJ9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuIl19