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
    cancelled: "red",
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
            // TODO: sort by time and remove expired items
        }
        else if (msg.type == "observed") {
            this.observedServers.push(msg);
            // TODO: sort by time and remove expired items
        }
        else if (msg.jobID !== undefined || msg.type == 'hack' || msg.type == 'grow' || msg.type == 'weaken') {
            this.addJob(msg);
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
        const job = this.jobs.get(jobID);
        if (job === undefined) {
            // Create new Job record with required fields
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
        // Filter out expired jobs (endTime more than 2 screens in the past)
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBNERFO0FBdUNGLE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxLQUE4QixDQUFDO0FBY3hELHlCQUF5QjtBQUV6QixvR0FBb0c7QUFDcEcsd0RBQXdEO0FBQ3hELDBGQUEwRjtBQUMxRixJQUFJLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFZLENBQUM7QUFDM0M7Ozs7R0FJRztBQUNILFNBQVMsV0FBVyxDQUFDLENBQVMsRUFBRSxFQUFFLEdBQUMsUUFBUTtJQUN2QyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFnQixDQUFDO0FBQzVDLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxDQUFjO0lBQ2xDLE9BQU8sQ0FBQyxHQUFHLFlBQVksR0FBRyxhQUEyQixDQUFDO0FBQzFELENBQUM7QUFFRCxNQUFNLFlBQVksR0FBRztJQUNqQixJQUFJLEVBQUUsTUFBTTtJQUNaLElBQUksRUFBRSxZQUFZO0lBQ2xCLE1BQU0sRUFBRSxRQUFRO0lBQ2hCLFNBQVMsRUFBRSxLQUFLO0lBQ2hCLE1BQU0sRUFBRSxTQUFTO0lBQ2pCLElBQUksRUFBRSxNQUFNO0lBQ1osTUFBTSxFQUFFLE1BQU07SUFDZCxRQUFRLEVBQUUsS0FBSztJQUNmLEtBQUssRUFBRSxNQUFNO0NBQ2hCLENBQUM7QUFFRixpR0FBaUc7QUFDakcsMEdBQTBHO0FBQzFHLHFGQUFxRjtBQUNyRixNQUFNLFlBQVksR0FBRyxHQUFpQixDQUFDO0FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEVBQWlCLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUcsR0FBYSxDQUFDO0FBQ3BDLE1BQU0sYUFBYSxHQUFH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SCwyQkFBRyxFQUFFLEVBQUMsWUFBWSxFQUFDLFNBQVMsRUFBRSxlQUFlLGFBQWEsR0FBRyxhQUFhLEdBQUc7UUFDeEUsYUFBYTtRQUNiLGFBQWEsQ0FDZCxDQUNQLENBQUM7QUFDTixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLypcblxuVXNhZ2Vcbi0tLS0tXG5cblN0YXJ0IHRoZSBiYXRjaCB2aWV3ZXIgc2NyaXB0IGZyb20gdGhlIGNvbW1hbmQgbGluZTpcblxuICAgIHJ1biBiYXRjaC12aWV3LmpzIC0tcG9ydCAxMFxuXG5UaGVuIHNlbmQgbWVzc2FnZXMgdG8gaXQgZnJvbSBvdGhlciBzY3JpcHRzLlxuXG5FeGFtcGxlOiBEaXNwbGF5IGFjdGlvbiB0aW1pbmcgKGhhY2sgLyBncm93IC8gd2Vha2VuKVxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdoYWNrJyxcbiAgICAgICAgam9iSUQ6IDEsXG4gICAgICAgIHN0YXJ0VGltZTogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgICAgIGR1cmF0aW9uOiBucy5nZXRIYWNrVGltZSh0YXJnZXQpLFxuICAgIH0pKTtcblxuRXhhbXBsZTogVXBkYXRlIGFuIGFjdGlvbiB0aGF0IGhhcyBhbHJlYWR5IGJlZW4gZGlzcGxheWVkXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgam9iSUQ6IDEsXG4gICAgICAgIHN0YXJ0VGltZUFjdHVhbDogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgfSkpO1xuICAgIGF3YWl0IG5zLmhhY2sodGFyZ2V0KTtcbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgam9iSUQ6IDEsXG4gICAgICAgIGVuZFRpbWVBY3R1YWw6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgIH0pKTtcblxuRXhhbXBsZTogRGlzcGxheSBhIGJsYW5rIHJvdyBiZXR3ZWVuIGFjdGlvbnMgKHRvIHZpc3VhbGx5IHNlcGFyYXRlIGJhdGNoZXMpXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ3NwYWNlcicsXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBEaXNwbGF5IG9ic2VydmVkIHNlY3VyaXR5IC8gbW9uZXkgbGV2ZWxcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnb2JzZXJ2ZWQnLFxuICAgICAgICB0aW1lOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICAgICAgbWluRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyTWluU2VjdXJpdHlMZXZlbCh0YXJnZXQpLFxuICAgICAgICBoYWNrRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyU2VjdXJpdHlMZXZlbCh0YXJnZXQpLFxuICAgICAgICBtb25leU1heDogbnMuZ2V0U2VydmVyTWF4TW9uZXkodGFyZ2V0KSxcbiAgICAgICAgbW9uZXlBdmFpbGFibGU6IG5zLmdldFNlcnZlck1vbmV5QXZhaWxhYmxlKHRhcmdldCksXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBEaXNwbGF5IGV4cGVjdGVkIHNlY3VyaXR5IC8gbW9uZXkgbGV2ZWwgKHZhcmllcyBieSBhY3Rpb24gdHlwZSBhbmQgeW91ciBzdHJhdGVneSlcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnZXhwZWN0ZWQnLFxuICAgICAgICB0aW1lOiBqb2Iuc3RhcnRUaW1lICsgam9iLmR1cmF0aW9uLFxuICAgICAgICBtaW5EaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJNaW5TZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIGhhY2tEaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJTZWN1cml0eUxldmVsKHRhcmdldCkgKyBucy5oYWNrQW5hbHl6ZVNlY3VyaXR5KGpvYi50aHJlYWRzKSxcbiAgICAgICAgbW9uZXlNYXg6IG5zLmdldFNlcnZlck1heE1vbmV5KHRhcmdldCksXG4gICAgICAgIG1vbmV5QXZhaWxhYmxlOiBNYXRoLm1heCgwLCBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpIC0gbnMuaGFja0FuYWx5emUodGFyZ2V0KSAqIGpvYi50aHJlYWRzICogbnMuaGFja0FuYWx5emVDaGFuY2UodGFyZ2V0KSksXG4gICAgfSkpO1xuXG4qL1xuXG4vLyAtLS0tLSBQdWJsaWMgQVBJIFR5cGVzIC0tLS0tXG5cbnR5cGUgSm9iSUQgPSBudW1iZXIgfCBzdHJpbmc7XG5pbnRlcmZhY2UgQWN0aW9uTWVzc2FnZSB7XG4gICAgdHlwZTogXCJoYWNrXCIgfCBcImdyb3dcIiB8IFwid2Vha2VuXCI7XG4gICAgam9iSUQ/OiBKb2JJRDtcbiAgICBkdXJhdGlvbjogVGltZU1zO1xuICAgIHN0YXJ0VGltZTogVGltZU1zO1xuICAgIHN0YXJ0VGltZUFjdHVhbD86IFRpbWVNcztcbiAgICBlbmRUaW1lPzogVGltZU1zO1xuICAgIGVuZFRpbWVBY3R1YWw/OiBUaW1lTXM7XG4gICAgY2FuY2VsbGVkPzogYm9vbGVhbjtcbiAgICByZXN1bHQ/OiBudW1iZXI7XG59XG5pbnRlcmZhY2UgU3BhY2VyTWVzc2FnZSB7XG4gICAgdHlwZTogXCJzcGFjZXJcIlxufVxuaW50ZXJmYWNlIFNlcnZlck1lc3NhZ2Uge1xuICAgIHR5cGU6IFwiZXhwZWN0ZWRcIiB8IFwib2JzZXJ2ZWRcIjtcbiAgICB0aW1lOiBUaW1lTXM7XG4gICAgaGFja0RpZmZpY3VsdHk6IG51bWJlcjtcbiAgICBtaW5EaWZmaWN1bHR5OiBudW1iZXI7XG4gICAgbW9uZXlBdmFpbGFibGU6IG51bWJlcjtcbiAgICBtb25leU1heDogbnVtYmVyO1xufVxudHlwZSBFeHBlY3RlZFNlcnZlck1lc3NhZ2UgPSBTZXJ2ZXJNZXNzYWdlICYge1xuICAgIHR5cGU6IFwiZXhwZWN0ZWRcIlxufVxudHlwZSBPYnNlcnZlZFNlcnZlck1lc3NhZ2UgPSBTZXJ2ZXJNZXNzYWdlICYge1xuICAgIHR5cGU6IFwib2JzZXJ2ZWRcIlxufVxudHlwZSBCYXRjaFZpZXdNZXNzYWdlID0gQWN0aW9uTWVzc2FnZSB8IFNwYWNlck1lc3NhZ2UgfCBFeHBlY3RlZFNlcnZlck1lc3NhZ2UgfCBPYnNlcnZlZFNlcnZlck1lc3NhZ2U7XG5cbi8vIC0tLS0tIEludGVybmFsIFR5cGVzIC0tLS0tXG5cbmltcG9ydCB0eXBlIHsgTlMsIE5ldHNjcmlwdFBvcnQsIFNlcnZlciB9IGZyb20gJ0Bucyc7XG5pbXBvcnQgdHlwZSBSZWFjdE5hbWVzcGFjZSBmcm9tICdyZWFjdC9pbmRleCc7XG5jb25zdCBSZWFjdCA9IGdsb2JhbFRoaXMuUmVhY3QgYXMgdHlwZW9mIFJlYWN0TmFtZXNwYWNlO1xuXG5pbnRlcmZhY2UgSm9iIGV4dGVuZHMgQWN0aW9uTWVzc2FnZSB7XG4gICAgam9iSUQ6IEpvYklEO1xuICAgIHJvd0lEOiBudW1iZXI7XG4gICAgZW5kVGltZTogVGltZU1zO1xufVxuXG50eXBlIFRpbWVNcyA9IFJldHVyblR5cGU8dHlwZW9mIHBlcmZvcm1hbmNlLm5vdz4gJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJtaWxsaXNlY29uZHNcIiB9O1xudHlwZSBUaW1lU2Vjb25kcyA9IG51bWJlciAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcInNlY29uZHNcIiB9O1xudHlwZSBUaW1lUGl4ZWxzID0gbnVtYmVyICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwicGl4ZWxzXCIgfTtcbnR5cGUgUGl4ZWxzID0gbnVtYmVyICYgeyBfX3VuaXRzOiBcInBpeGVsc1wiIH07XG50eXBlIFRpbWVWYWx1ZSA9IFtUaW1lTXMsIG51bWJlcl07XG5cbi8vIC0tLS0tIENvbnN0YW50cyAtLS0tLSBcblxuLy8gVE9ETzogaW5pdFRpbWUgaXMgdXNlZCBhcyB1bmlxdWUgRE9NIElEIGFuZCBhcyByZW5kZXJpbmcgb3JpZ2luIGJ1dCBpdCBpcyBwb29ybHkgc3VpdGVkIGZvciBib3RoLlxuLy8gIFRoZSBzY3JpcHQgUElEIHdvdWxkIHdvcmsgYmV0dGVyIGFzIGEgdW5pcXVlIERPTSBJRC5cbi8vICBUaGUgUHVibGljIEFQSSBjb3VsZCByZXF1aXJlIHBlcmZvcm1hbmNlLWVwb2NoIHRpbWVzLCB3aGljaCB3b24ndCBuZWVkIHRvIGJlIGFkanVzdGVkLlxubGV0IGluaXRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zO1xuLyoqXG4gKiBDb252ZXJ0IHRpbWVzdGFtcHMgdG8gc2Vjb25kcyBzaW5jZSB0aGUgZ3JhcGggd2FzIHN0YXJ0ZWQuXG4gKiBUbyByZW5kZXIgU1ZHcyB1c2luZyBuYXRpdmUgdGltZSB1bml0cywgdGhlIHZhbHVlcyBtdXN0IGJlIHZhbGlkIDMyLWJpdCBpbnRzLlxuICogU28gd2UgY29udmVydCB0byBhIHJlY2VudCBlcG9jaCBpbiBjYXNlIERhdGUubm93KCkgdmFsdWVzIGFyZSB1c2VkLlxuICovXG5mdW5jdGlvbiBjb252ZXJ0VGltZSh0OiBUaW1lTXMsIHQwPWluaXRUaW1lKTogVGltZVNlY29uZHMge1xuICAgIHJldHVybiAoKHQgLSB0MCkgLyAxMDAwKSBhcyBUaW1lU2Vjb25kcztcbn1cblxuZnVuY3Rpb24gY29udmVydFNlY1RvUHgodDogVGltZVNlY29uZHMpOiBUaW1lUGl4ZWxzIHtcbiAgICByZXR1cm4gdCAqIFdJRFRIX1BJWEVMUyAvIFdJRFRIX1NFQ09ORFMgYXMgVGltZVBpeGVscztcbn1cblxuY29uc3QgR1JBUEhfQ09MT1JTID0ge1xuICAgIGhhY2s6IFwiY3lhblwiLFxuICAgIGdyb3c6IFwibGlnaHRncmVlblwiLFxuICAgIHdlYWtlbjogXCJ5ZWxsb3dcIixcbiAgICBjYW5jZWxsZWQ6IFwicmVkXCIsXG4gICAgZGVzeW5jOiBcIm1hZ2VudGFcIixcbiAgICBzYWZlOiBcIiMxMTFcIixcbiAgICB1bnNhZmU6IFwiIzMzM1wiLFxuICAgIHNlY3VyaXR5OiBcInJlZFwiLFxuICAgIG1vbmV5OiBcImJsdWVcIlxufTtcblxuLy8gVE9ETzogdXNlIGEgY29udGV4dCBmb3IgdGhlc2Ugc2NhbGUgZmFjdG9ycy4gc3VwcG9ydCBzZXR0aW5nIHRoZW0gYnkgYXJncyBhbmQgc2Nyb2xsLWdlc3R1cmVzLlxuLy8gY29uc3QgU2NyZWVuQ29udGV4dCA9IFJlYWN0LmNyZWF0ZUNvbnRleHQoe1dJRFRIX1BJWEVMUywgV0lEVEhfU0VDT05EUywgSEVJR0hUX1BJWEVMUywgRk9PVEVSX1BJWEVMU30pO1xuLy8gVE9ETzogcmV2aWV3IHVzZSBvZiA2MDAwMDAsIDYwMDAwLCAxMDAwLCAxMCwgYW5kIFdJRFRIX1NFQ09ORFMgYXMgY2xpcHBpbmcgbGltaXRzLlxuY29uc3QgV0lEVEhfUElYRUxTID0gODAwIGFzIFRpbWVQaXhlbHM7XG5jb25zdCBXSURUSF9TRUNPTkRTID0gMTYgYXMgVGltZVNlY29uZHM7XG5jb25zdCBIRUlHSFRfUElYRUxTID0gNjAwIGFzIFBpeGVscztcbmNvbnN0IEZPT1RFUl9QSVhFTFMgPSA1MCBhcyBQaXhlbHM7XG5cblxuLy8gLS0tLS0gTWFpbiBQcm9ncmFtIC0tLS0tXG5cbmNvbnN0IEZMQUdTOiBbc3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgc3RyaW5nW11dW10gPSBbXG4gICAgW1wiaGVscFwiLCBmYWxzZV0sXG4gICAgW1wicG9ydFwiLCAwXSxcbiAgICBbXCJkZWJ1Z1wiLCBmYWxzZV0sXG5dO1xuXG5leHBvcnQgZnVuY3Rpb24gYXV0b2NvbXBsZXRlKGRhdGE6IGFueSwgYXJnczogc3RyaW5nW10pIHtcbiAgICBkYXRhLmZsYWdzKEZMQUdTKTtcbiAgICByZXR1cm4gW107XG59XG5cbi8qKiBAcGFyYW0ge05TfSBucyAqKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYWluKG5zOiBOUykge1xuICAgIG5zLmRpc2FibGVMb2coJ3NsZWVwJyk7XG4gICAgbnMuZGlzYWJsZUxvZygnYXNsZWVwJyk7XG4gICAgbnMuY2xlYXJMb2coKTtcbiAgICBucy50YWlsKCk7XG4gICAgbnMucmVzaXplVGFpbCg4MTAsIDY0MCk7XG5cbiAgICBjb25zdCBmbGFncyA9IG5zLmZsYWdzKEZMQUdTKTtcbiAgICBpZiAoZmxhZ3MuaGVscCkge1xuICAgICAgICBucy50cHJpbnQoW1xuICAgICAgICAgICAgYFVTQUdFYCxcbiAgICAgICAgICAgIGA+IHJ1biAke25zLmdldFNjcmlwdE5hbWUoKX0gLS1wb3J0IDEwYCxcbiAgICAgICAgICAgICcgJ1xuICAgICAgICBdLmpvaW4oXCJcXG5cIikpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHBvcnROdW0gPSBmbGFncy5wb3J0IGFzIG51bWJlciB8fCBucy5waWQ7XG4gICAgY29uc3QgZGVidWcgPSBmbGFncy5kZWJ1ZyBhcyBib29sZWFuO1xuXG4gICAgY29uc3QgYmF0Y2hWaWV3ID0gPEJhdGNoVmlldyBucz17bnN9IHBvcnROdW09e3BvcnROdW19IGRlYnVnPXtkZWJ1Z30gLz47XG4gICAgbnMucHJpbnQoYExpc3RlbmluZyBvbiBQb3J0ICR7cG9ydE51bX1gKTtcbiAgICBucy5wcmludFJhdyhiYXRjaFZpZXcpO1xuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgYXdhaXQgbnMuYXNsZWVwKDYwKjEwMDApO1xuICAgIH1cbn1cblxuLy8gLS0tLS0gQmF0Y2hWaWV3IENvbXBvbmVudCAtLS0tLVxuXG5pbnRlcmZhY2UgQmF0Y2hWaWV3UHJvcHMge1xuICAgIG5zOiBOUztcbiAgICBwb3J0TnVtOiBudW1iZXI7XG4gICAgZGVidWc/OiBib29sZWFuO1xufVxuaW50ZXJmYWNlIEJhdGNoVmlld1N0YXRlIHtcbiAgICBydW5uaW5nOiBib29sZWFuO1xuICAgIG5vdzogVGltZU1zO1xuICAgIGRhdGFVcGRhdGVzOiBudW1iZXI7XG59XG5leHBvcnQgY2xhc3MgQmF0Y2hWaWV3IGV4dGVuZHMgUmVhY3QuQ29tcG9uZW50PEJhdGNoVmlld1Byb3BzLCBCYXRjaFZpZXdTdGF0ZT4ge1xuICAgIHBvcnQ6IE5ldHNjcmlwdFBvcnQ7XG4gICAgam9iczogTWFwPEpvYklELCBKb2I+O1xuICAgIHNlcXVlbnRpYWxSb3dJRDogbnVtYmVyID0gMDtcbiAgICBzZXF1ZW50aWFsSm9iSUQ6IG51bWJlciA9IDA7XG4gICAgZXhwZWN0ZWRTZXJ2ZXJzOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2VbXTtcbiAgICBvYnNlcnZlZFNlcnZlcnM6IE9ic2VydmVkU2VydmVyTWVzc2FnZVtdO1xuXG4gICAgY29uc3RydWN0b3IocHJvcHM6IEJhdGNoVmlld1Byb3BzKXtcbiAgICAgICAgc3VwZXIocHJvcHMpO1xuICAgICAgICBjb25zdCB7IG5zLCBwb3J0TnVtLCBkZWJ1ZyB9ID0gcHJvcHM7XG4gICAgICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICAgICAgICBydW5uaW5nOiB0cnVlLFxuICAgICAgICAgICAgbm93OiBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXMsXG4gICAgICAgICAgICBkYXRhVXBkYXRlczogMCxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5wb3J0ID0gbnMuZ2V0UG9ydEhhbmRsZShwb3J0TnVtKTtcbiAgICAgICAgdGhpcy5qb2JzID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLmV4cGVjdGVkU2VydmVycyA9IFtdO1xuICAgICAgICB0aGlzLm9ic2VydmVkU2VydmVycyA9IFtdO1xuICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oZ2xvYmFsVGhpcywge2JhdGNoVmlldzogdGhpc30pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29tcG9uZW50RGlkTW91bnQoKSB7XG4gICAgICAgIGNvbnN0IHsgbnMsIHBvcnROdW0gfSA9IHRoaXMucHJvcHM7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IHRydWV9KTtcbiAgICAgICAgbnMuYXRFeGl0KCgpPT57XG4gICAgICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiBmYWxzZX0pO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5hbmltYXRlKCk7XG4gICAgICAgIHRoaXMucmVhZFBvcnQoKTtcbiAgICB9XG5cbiAgICBjb21wb25lbnRXaWxsVW5tb3VudCgpIHtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogZmFsc2V9KTtcbiAgICB9XG5cbiAgICBhbmltYXRlID0gKCk9PntcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlLnJ1bm5pbmcpIHJldHVybjtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7bm93OiBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXN9KTtcbiAgICAgICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0ZSk7XG4gICAgfVxuXG4gICAgcmVhZFBvcnQgPSAoKT0+e1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUucnVubmluZykgcmV0dXJuO1xuICAgICAgICB3aGlsZSghdGhpcy5wb3J0LmVtcHR5KCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZzogQmF0Y2hWaWV3TWVzc2FnZSA9IEpTT04ucGFyc2UodGhpcy5wb3J0LnJlYWQoKSBhcyBzdHJpbmcpO1xuICAgICAgICAgICAgdGhpcy5yZWNlaXZlTWVzc2FnZShtc2cpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMucG9ydC5uZXh0V3JpdGUoKS50aGVuKHRoaXMucmVhZFBvcnQpO1xuICAgIH1cblxuICAgIHJlY2VpdmVNZXNzYWdlKG1zZzogQmF0Y2hWaWV3TWVzc2FnZSkge1xuICAgICAgICBpZiAobXNnLnR5cGUgPT0gXCJzcGFjZXJcIikge1xuICAgICAgICAgICAgdGhpcy5zZXF1ZW50aWFsUm93SUQgKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cudHlwZSA9PSBcImV4cGVjdGVkXCIpIHtcbiAgICAgICAgICAgIHRoaXMuZXhwZWN0ZWRTZXJ2ZXJzLnB1c2gobXNnKTtcbiAgICAgICAgICAgIC8vIFRPRE86IHNvcnQgYnkgdGltZSBhbmQgcmVtb3ZlIGV4cGlyZWQgaXRlbXNcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cudHlwZSA9PSBcIm9ic2VydmVkXCIpIHtcbiAgICAgICAgICAgIHRoaXMub2JzZXJ2ZWRTZXJ2ZXJzLnB1c2gobXNnKTtcbiAgICAgICAgICAgIC8vIFRPRE86IHNvcnQgYnkgdGltZSBhbmQgcmVtb3ZlIGV4cGlyZWQgaXRlbXNcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cuam9iSUQgIT09IHVuZGVmaW5lZCB8fCBtc2cudHlwZSA9PSAnaGFjaycgfHwgbXNnLnR5cGUgPT0gJ2dyb3cnIHx8IG1zZy50eXBlID09ICd3ZWFrZW4nKSB7XG4gICAgICAgICAgICB0aGlzLmFkZEpvYihtc2cpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe2RhdGFVcGRhdGVzOiB0aGlzLnN0YXRlLmRhdGFVcGRhdGVzICsgMX0pO1xuICAgIH1cblxuICAgIGFkZEpvYihtc2c6IEFjdGlvbk1lc3NhZ2UpIHtcbiAgICAgICAgLy8gQXNzaWduIHNlcXVlbnRpYWwgSUQgaWYgbmVlZGVkXG4gICAgICAgIGxldCBqb2JJRCA9IG1zZy5qb2JJRDtcbiAgICAgICAgaWYgKGpvYklEID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHdoaWxlICh0aGlzLmpvYnMuaGFzKHRoaXMuc2VxdWVudGlhbEpvYklEKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuc2VxdWVudGlhbEpvYklEICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBqb2JJRCA9IHRoaXMuc2VxdWVudGlhbEpvYklEO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuam9icy5nZXQoam9iSUQpO1xuICAgICAgICBpZiAoam9iID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIC8vIENyZWF0ZSBuZXcgSm9iIHJlY29yZCB3aXRoIHJlcXVpcmVkIGZpZWxkc1xuICAgICAgICAgICAgdGhpcy5qb2JzLnNldChqb2JJRCwge1xuICAgICAgICAgICAgICAgIGpvYklEOiBqb2JJRCxcbiAgICAgICAgICAgICAgICByb3dJRDogdGhpcy5zZXF1ZW50aWFsUm93SUQrKyxcbiAgICAgICAgICAgICAgICBlbmRUaW1lOiBtc2cuc3RhcnRUaW1lICsgbXNnLmR1cmF0aW9uIGFzIFRpbWVNcyxcbiAgICAgICAgICAgICAgICAuLi5tc2dcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gTWVyZ2UgdXBkYXRlcyBpbnRvIGV4aXN0aW5nIGpvYiByZWNvcmRcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oam9iLCBtc2cpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY2xlYW5Kb2JzKCk7XG4gICAgfVxuXG4gICAgY2xlYW5Kb2JzKCkge1xuICAgICAgICAvLyBGaWx0ZXIgb3V0IGV4cGlyZWQgam9icyAoZW5kVGltZSBtb3JlIHRoYW4gMiBzY3JlZW5zIGluIHRoZSBwYXN0KVxuICAgICAgICBpZiAodGhpcy5qb2JzLnNpemUgPiAyMDApIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qgam9iSUQgb2YgdGhpcy5qb2JzLmtleXMoKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuam9icy5nZXQoam9iSUQpIGFzIEpvYjtcbiAgICAgICAgICAgICAgICBpZiAoKGpvYi5lbmRUaW1lQWN0dWFsID8/IGpvYi5lbmRUaW1lKSA8IHRoaXMuc3RhdGUubm93LShXSURUSF9TRUNPTkRTKjIqMTAwMCkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5qb2JzLmRlbGV0ZShqb2JJRCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmVuZGVyKCkge1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgPEdyYXBoRnJhbWUgbm93PXt0aGlzLnN0YXRlLm5vd30+XG4gICAgICAgICAgICAgICAgPFNhZmV0eUxheWVyIGV4cGVjdGVkU2VydmVycz17dGhpcy5leHBlY3RlZFNlcnZlcnN9IC8+XG4gICAgICAgICAgICAgICAgPEpvYkxheWVyIGpvYnM9e1suLi50aGlzLmpvYnMudmFsdWVzKCldfSAvPlxuICAgICAgICAgICAgICAgIDxTZWN1cml0eUxheWVyIGV4cGVjdGVkU2VydmVycz17dGhpcy5leHBlY3RlZFNlcnZlcnN9IG9ic2VydmVkU2VydmVycz17dGhpcy5vYnNlcnZlZFNlcnZlcnN9IC8+XG4gICAgICAgICAgICAgICAgPE1vbmV5TGF5ZXIgZXhwZWN0ZWRTZXJ2ZXJzPXt0aGlzLmV4cGVjdGVkU2VydmVyc30gb2JzZXJ2ZWRTZXJ2ZXJzPXt0aGlzLm9ic2VydmVkU2VydmVyc30gLz5cbiAgICAgICAgICAgIDwvR3JhcGhGcmFtZT5cbiAgICAgICAgKVxuICAgIH1cbn1cblxuZnVuY3Rpb24gR3JhcGhGcmFtZSh7bm93LCBjaGlsZHJlbn06e25vdzpUaW1lTXMsIGNoaWxkcmVuOiBSZWFjdC5SZWFjdE5vZGV9KTogUmVhY3QuUmVhY3RFbGVtZW50IHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8c3ZnIHZlcnNpb249XCIxLjFcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCJcbiAgICAgICAgICAgIHdpZHRoPXtXSURUSF9QSVhFTFN9XG4gICAgICAgICAgICBoZWlnaHQ9e0hFSUdIVF9QSVhFTFN9IFxuICAgICAgICAgICAgLy8gU2V0IHRoZSB2aWV3Qm94IGZvciAxMCBzZWNvbmRzIG9mIGhpc3RvcnksIDYgc2Vjb25kcyBvZiBmdXR1cmUuXG4gICAgICAgICAgICB2aWV3Qm94PXtgJHtjb252ZXJ0U2VjVG9QeCgtMTAgYXMgVGltZVNlY29uZHMpfSAwICR7V0lEVEhfUElYRUxTfSAke0hFSUdIVF9QSVhFTFN9YH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGRlZnM+XG4gICAgICAgICAgICAgICAgPGNsaXBQYXRoIGlkPXtgaGlkZS1mdXR1cmUtJHtpbml0VGltZX1gfSBjbGlwUGF0aFVuaXRzPVwidXNlclNwYWNlT25Vc2VcIj5cbiAgICAgICAgICAgICAgICAgICAgPHJlY3QgaWQ9XCJoaWRlLWZ1dHVyZS1yZWN0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKG5vdy02MDAwMCBhcyBUaW1lTXMpfSB3aWR0aD17Y29udmVydFRpbWUoNjAwMDAgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICAgICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezUwfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvY2xpcFBhdGg+XG4gICAgICAgICAgICA8L2RlZnM+XG4gICAgICAgICAgICA8cmVjdCBpZD1cImJhY2tncm91bmRcIiB4PXtjb252ZXJ0U2VjVG9QeCgtMTAgYXMgVGltZVNlY29uZHMpfSB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCIgZmlsbD17R1JBUEhfQ09MT1JTLnNhZmV9IC8+XG4gICAgICAgICAgICA8ZyBpZD1cInRpbWVDb29yZGluYXRlc1wiIHRyYW5zZm9ybT17YHNjYWxlKCR7V0lEVEhfUElYRUxTIC8gV0lEVEhfU0VDT05EU30gMSkgdHJhbnNsYXRlKCR7Y29udmVydFRpbWUoaW5pdFRpbWUtbm93IGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfSAwKWB9PlxuICAgICAgICAgICAgICAgIHtjaGlsZHJlbn1cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMVwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0yXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy0yKkZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIDxyZWN0IGlkPVwiY3Vyc29yXCIgeD17MH0gd2lkdGg9ezF9IHk9ezB9IGhlaWdodD1cIjEwMCVcIiBmaWxsPVwid2hpdGVcIiAvPlxuICAgICAgICAgICAgPEdyYXBoTGVnZW5kIC8+XG4gICAgICAgIDwvc3ZnPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEdyYXBoTGVnZW5kKCk6IFJlYWN0LlJlYWN0RWxlbWVudCB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJMZWdlbmRcIiB0cmFuc2Zvcm09XCJ0cmFuc2xhdGUoLTQ5MCwgMTApLCBzY2FsZSguNSwgLjUpXCI+XG4gICAgICAgICAgICA8cmVjdCB4PXsxfSB5PXsxfSB3aWR0aD17Mjc1fSBoZWlnaHQ9ezM5Mn0gZmlsbD1cImJsYWNrXCIgc3Ryb2tlPVwiIzk3OTc5N1wiIC8+XG4gICAgICAgICAgICB7T2JqZWN0LmVudHJpZXMoR1JBUEhfQ09MT1JTKS5tYXAoKFtsYWJlbCwgY29sb3JdLCBpKT0+KFxuICAgICAgICAgICAgICAgIDxnIGtleT17bGFiZWx9IHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgyMiwgJHsxMyArIDQxKml9KWB9PlxuICAgICAgICAgICAgICAgICAgICA8cmVjdCB4PXswfSB5PXswfSB3aWR0aD17MjJ9IGhlaWdodD17MjJ9IGZpbGw9e2NvbG9yfSAvPlxuICAgICAgICAgICAgICAgICAgICA8dGV4dCBmb250RmFtaWx5PVwiQ291cmllciBOZXdcIiBmb250U2l6ZT17MzZ9IGZpbGw9XCIjODg4XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dHNwYW4geD17NDIuNX0geT17MzB9PntsYWJlbC5zdWJzdHJpbmcoMCwxKS50b1VwcGVyQ2FzZSgpK2xhYmVsLnN1YnN0cmluZygxKX08L3RzcGFuPlxuICAgICAgICAgICAgICAgICAgICA8L3RleHQ+XG4gICAgICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBTYWZldHlMYXllcih7ZXhwZWN0ZWRTZXJ2ZXJzfToge2V4cGVjdGVkU2VydmVyczogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlW119KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBsZXQgcHJldlNlcnZlcjogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlIHwgdW5kZWZpbmVkO1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwic2FmZXR5TGF5ZXJcIj5cbiAgICAgICAgICAgIHtleHBlY3RlZFNlcnZlcnMubWFwKChzZXJ2ZXIsIGkpPT57XG4gICAgICAgICAgICAgICAgbGV0IGVsID0gbnVsbDtcbiAgICAgICAgICAgICAgICAvLyBzaGFkZSB0aGUgYmFja2dyb3VuZCBiYXNlZCBvbiBzZWNMZXZlbFxuICAgICAgICAgICAgICAgIGlmIChwcmV2U2VydmVyICYmIHNlcnZlci50aW1lID4gcHJldlNlcnZlci50aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGVsID0gKDxyZWN0IGtleT17aX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHByZXZTZXJ2ZXIudGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZShzZXJ2ZXIudGltZSAtIHByZXZTZXJ2ZXIudGltZSBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD1cIjEwMCVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsbD17KHByZXZTZXJ2ZXIuaGFja0RpZmZpY3VsdHkgPiBwcmV2U2VydmVyLm1pbkRpZmZpY3VsdHkpID8gR1JBUEhfQ09MT1JTLnVuc2FmZSA6IEdSQVBIX0NPTE9SUy5zYWZlfVxuICAgICAgICAgICAgICAgICAgICAvPik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHByZXZTZXJ2ZXIgPSBzZXJ2ZXI7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGVsO1xuICAgICAgICAgICAgfSl9XG4gICAgICAgICAgICB7cHJldlNlcnZlciAmJiAoXG4gICAgICAgICAgICAgICAgPHJlY3Qga2V5PVwicmVtYWluZGVyXCJcbiAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUocHJldlNlcnZlci50aW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKDYwMDAwMCBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgeT17MH0gaGVpZ2h0PVwiMTAwJVwiXG4gICAgICAgICAgICAgICAgICAgIGZpbGw9eyhwcmV2U2VydmVyLmhhY2tEaWZmaWN1bHR5ID4gcHJldlNlcnZlci5taW5EaWZmaWN1bHR5KSA/IEdSQVBIX0NPTE9SUy51bnNhZmUgOiBHUkFQSF9DT0xPUlMuc2FmZX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEpvYkxheWVyKHtqb2JzfToge2pvYnM6IEpvYltdfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwiam9iTGF5ZXJcIj5cbiAgICAgICAgICAgIHtqb2JzLm1hcCgoam9iOiBKb2IpPT4oPEpvYkJhciBqb2I9e2pvYn0ga2V5PXtqb2Iuam9iSUR9IC8+KSl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBKb2JCYXIoe2pvYn06IHtqb2I6IEpvYn0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGNvbnN0IHkgPSAoKGpvYi5yb3dJRCArIDEpICUgKChIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMUyoyKSAvIDQpKSAqIDQ7XG4gICAgbGV0IGpvYkJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5zdGFydFRpbWUgJiYgam9iLmR1cmF0aW9uKSB7XG4gICAgICAgIGpvYkJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUoam9iLnN0YXJ0VGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZShqb2IuZHVyYXRpb24sIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17Mn1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SU1tqb2IuY2FuY2VsbGVkID8gJ2NhbmNlbGxlZCcgOiBqb2IudHlwZV19XG4gICAgICAgIC8+KVxuICAgIH07XG4gICAgbGV0IHN0YXJ0RXJyb3JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5zdGFydFRpbWUsIGpvYi5zdGFydFRpbWVBY3R1YWxdLnNvcnQoKGEsYik9PmEtYik7XG4gICAgICAgIHN0YXJ0RXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgZmlsbD17R1JBUEhfQ09MT1JTLmRlc3luY31cbiAgICAgICAgIC8+KTtcbiAgICB9XG4gICAgbGV0IGVuZEVycm9yQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLmVuZFRpbWVBY3R1YWwpIHtcbiAgICAgICAgY29uc3QgW3QxLCB0Ml0gPSBbam9iLmVuZFRpbWUsIGpvYi5lbmRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICBlbmRFcnJvckJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUodDEpfSB3aWR0aD17Y29udmVydFRpbWUodDItdDEgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBmaWxsPXtHUkFQSF9DT0xPUlMuZGVzeW5jfVxuICAgICAgICAgLz4pO1xuICAgIH1cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke3l9KWB9PlxuICAgICAgICAgICAge2pvYkJhcn1cbiAgICAgICAgICAgIHtzdGFydEVycm9yQmFyfVxuICAgICAgICAgICAge2VuZEVycm9yQmFyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuaW50ZXJmYWNlIFNlY3VyaXR5TGF5ZXJQcm9wcyB7XG4gICAgZXhwZWN0ZWRTZXJ2ZXJzOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2VbXTtcbiAgICBvYnNlcnZlZFNlcnZlcnM6IE9ic2VydmVkU2VydmVyTWVzc2FnZVtdXG59XG5mdW5jdGlvbiBTZWN1cml0eUxheWVyKHtleHBlY3RlZFNlcnZlcnMsIG9ic2VydmVkU2VydmVyc306U2VjdXJpdHlMYXllclByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBleHBlY3RlZFNlcnZlcnMgPz89IFtdO1xuICAgIG9ic2VydmVkU2VydmVycyA/Pz0gW107XG4gICAgbGV0IG1pblNlYyA9IDA7XG4gICAgbGV0IG1heFNlYyA9IDE7XG4gICAgZm9yIChjb25zdCBzbmFwc2hvdHMgb2YgW2V4cGVjdGVkU2VydmVycywgb2JzZXJ2ZWRTZXJ2ZXJzXSkge1xuICAgICAgICBmb3IgKGNvbnN0IHNlcnZlciBvZiBzbmFwc2hvdHMpIHtcbiAgICAgICAgICAgIG1pblNlYyA9IE1hdGgubWluKG1pblNlYywgc2VydmVyLmhhY2tEaWZmaWN1bHR5KTtcbiAgICAgICAgICAgIG1heFNlYyA9IE1hdGgubWF4KG1heFNlYywgc2VydmVyLmhhY2tEaWZmaWN1bHR5KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG9ic2VydmVkRXZlbnRzID0gb2JzZXJ2ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyKT0+W3NlcnZlci50aW1lLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHldKSBhcyBUaW1lVmFsdWVbXTtcbiAgICBjb25zdCBzaG91bGRDbG9zZVBhdGggPSB0cnVlO1xuICAgIGNvbnN0IG9ic2VydmVkUGF0aCA9IGNvbXB1dGVQYXRoRGF0YShvYnNlcnZlZEV2ZW50cywgbWluU2VjLCBzaG91bGRDbG9zZVBhdGgpO1xuICAgIGNvbnN0IG9ic2VydmVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwib2JzZXJ2ZWRTZWNcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heFNlYyAtIG1pblNlYyl9KWB9XG4gICAgICAgICAgICBmaWxsPXtcImRhcmtcIitHUkFQSF9DT0xPUlMuc2VjdXJpdHl9XG4gICAgICAgICAgICAvLyBmaWxsT3BhY2l0eTogMC41LFxuICAgICAgICAgICAgY2xpcFBhdGg9e2B1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWB9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxwYXRoIGQ9e29ic2VydmVkUGF0aC5qb2luKFwiIFwiKX0gLz5cbiAgICAgICAgPC9nPlxuICAgICk7XG5cbiAgICBjb25zdCBleHBlY3RlZEV2ZW50cyA9IGV4cGVjdGVkU2VydmVycy5tYXAoKHNlcnZlcik9PltzZXJ2ZXIudGltZSwgc2VydmVyLmhhY2tEaWZmaWN1bHR5XSkgYXMgVGltZVZhbHVlW107XG4gICAgY29uc3QgZXhwZWN0ZWRQYXRoID0gY29tcHV0ZVBhdGhEYXRhKGV4cGVjdGVkRXZlbnRzKTtcbiAgICBjb25zdCBleHBlY3RlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cImV4cGVjdGVkU2VjXCJcbiAgICAgICAgICAgIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhTZWMgLSBtaW5TZWMpfSlgfVxuICAgICAgICAgICAgc3Ryb2tlPXtHUkFQSF9DT0xPUlMuc2VjdXJpdHl9XG4gICAgICAgICAgICBmaWxsPVwibm9uZVwiXG4gICAgICAgICAgICBzdHJva2VXaWR0aD17Mn1cbiAgICAgICAgICAgIHN0cm9rZUxpbmVqb2luPVwiYmV2ZWxcIlxuICAgICAgICA+XG4gICAgICAgICAgICA8cGF0aCBkPXtleHBlY3RlZFBhdGguam9pbihcIiBcIil9IHZlY3RvckVmZmVjdD1cIm5vbi1zY2FsaW5nLXN0cm9rZVwiIC8+XG4gICAgICAgIDwvZz5cbiAgICApO1xuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJzZWNMYXllclwiIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7SEVJR0hUX1BJWEVMUyAtIDIqRk9PVEVSX1BJWEVMU30pYH0+XG4gICAgICAgICAgICB7b2JzZXJ2ZWRMYXllcn1cbiAgICAgICAgICAgIHtleHBlY3RlZExheWVyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gY29tcHV0ZVBhdGhEYXRhKGV2ZW50czogVGltZVZhbHVlW10sIG1pblZhbHVlPTAsIHNob3VsZENsb3NlPWZhbHNlLCBzY2FsZT0xKSB7XG4gICAgY29uc3QgcGF0aERhdGEgPSBbXTtcbiAgICBpZiAoZXZlbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgW3RpbWUsIHZhbHVlXSA9IGV2ZW50c1swXTtcbiAgICAgICAgLy8gc3RhcnQgbGluZSBhdCBmaXJzdCBwcm9qZWN0ZWQgdGltZSBhbmQgdmFsdWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgTSAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IFt0aW1lLCB2YWx1ZV0gb2YgZXZlbnRzKSB7XG4gICAgICAgIC8vIGhvcml6b250YWwgbGluZSB0byBjdXJyZW50IHRpbWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9YClcbiAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBuZXcgbGV2ZWxcbiAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyh2YWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICB9XG4gICAgLy8gZmlsbCBpbiBhcmVhIGJldHdlZW4gbGFzdCBzbmFwc2hvdCBhbmQgcmlnaHQgc2lkZSAoYXJlYSBhZnRlciBcIm5vd1wiIGN1cnNvciB3aWxsIGJlIGNsaXBwZWQgbGF0ZXIpXG4gICAgaWYgKGV2ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IFt0aW1lLCB2YWx1ZV0gPSBldmVudHNbZXZlbnRzLmxlbmd0aC0xXTtcbiAgICAgICAgLy8gaG9yaXpvbnRhbCBsaW5lIHRvIGZ1dHVyZSB0aW1lXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYEggJHtjb252ZXJ0VGltZSh0aW1lICsgNjAwMDAwIGFzIFRpbWVNcykudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgaWYgKHNob3VsZENsb3NlKSB7XG4gICAgICAgICAgICAvLyBmaWxsIGFyZWEgdW5kZXIgYWN0dWFsIHNlY3VyaXR5XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KG1pblZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgICAgICAgICAgY29uc3QgbWluVGltZSA9IGV2ZW50c1swXVswXTtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYEggJHtjb252ZXJ0VGltZShtaW5UaW1lKS50b0ZpeGVkKDMpfWApO1xuICAgICAgICAgICAgcGF0aERhdGEucHVzaCgnWicpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBwYXRoRGF0YTtcbn1cblxuZnVuY3Rpb24gTW9uZXlMYXllcih7ZXhwZWN0ZWRTZXJ2ZXJzLCBvYnNlcnZlZFNlcnZlcnN9OiBTZWN1cml0eUxheWVyUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGV4cGVjdGVkU2VydmVycyA/Pz0gW107XG4gICAgb2JzZXJ2ZWRTZXJ2ZXJzID8/PSBbXTtcbiAgICBpZiAoZXhwZWN0ZWRTZXJ2ZXJzLmxlbmd0aCA9PSAwICYmIG9ic2VydmVkU2VydmVycy5sZW5ndGggPT0gMCkgcmV0dXJuIG51bGw7XG4gICAgbGV0IG1pbk1vbmV5ID0gMDtcbiAgICBsZXQgbWF4TW9uZXkgPSAoZXhwZWN0ZWRTZXJ2ZXJzWzBdIHx8IG9ic2VydmVkU2VydmVyc1swXSkubW9uZXlNYXg7XG4gICAgY29uc3Qgc2NhbGUgPSAxL21heE1vbmV5O1xuICAgIG1heE1vbmV5ICo9IDEuMVxuXG4gICAgY29uc3Qgb2JzZXJ2ZWRFdmVudHMgPSBvYnNlcnZlZFNlcnZlcnMubWFwKChzZXJ2ZXIpPT5bc2VydmVyLnRpbWUsIHNlcnZlci5tb25leUF2YWlsYWJsZV0pIGFzIFRpbWVWYWx1ZVtdO1xuICAgIGxldCBzaG91bGRDbG9zZVBhdGggPSB0cnVlO1xuICAgIGNvbnN0IG9ic2VydmVkUGF0aCA9IGNvbXB1dGVQYXRoRGF0YShvYnNlcnZlZEV2ZW50cywgbWluTW9uZXksIHNob3VsZENsb3NlUGF0aCwgc2NhbGUpO1xuICAgIGNvbnN0IG9ic2VydmVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwib2JzZXJ2ZWRNb25leVwiXG4gICAgICAgICAgICB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4TW9uZXkgLSBtaW5Nb25leSkgLyBzY2FsZX0pYH1cbiAgICAgICAgICAgIGZpbGw9e1wiZGFya1wiK0dSQVBIX0NPTE9SUy5tb25leX1cbiAgICAgICAgICAgIC8vIGZpbGxPcGFjaXR5OiAwLjUsXG4gICAgICAgICAgICBjbGlwUGF0aD17YHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHBhdGggZD17b2JzZXJ2ZWRQYXRoLmpvaW4oXCIgXCIpfSAvPlxuICAgICAgICA8L2c+XG4gICAgKTtcblxuICAgIGNvbnN0IGV4cGVjdGVkRXZlbnRzID0gZXhwZWN0ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyKT0+W3NlcnZlci50aW1lLCBzZXJ2ZXIubW9uZXlBdmFpbGFibGVdKSBhcyBUaW1lVmFsdWVbXTtcbiAgICBzaG91bGRDbG9zZVBhdGggPSBmYWxzZTtcbiAgICBjb25zdCBleHBlY3RlZFBhdGggPSBjb21wdXRlUGF0aERhdGEoZXhwZWN0ZWRFdmVudHMsIG1pbk1vbmV5LCBzaG91bGRDbG9zZVBhdGgsIHNjYWxlKTtcbiAgICBjb25zdCBleHBlY3RlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cImV4cGVjdGVkTW9uZXlcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heE1vbmV5IC0gbWluTW9uZXkpIC8gc2NhbGV9KWB9XG4gICAgICAgICAgICBzdHJva2U9e0dSQVBIX0NPTE9SUy5tb25leX1cbiAgICAgICAgICAgIGZpbGw9XCJub25lXCJcbiAgICAgICAgICAgIHN0cm9rZVdpZHRoPXsyfVxuICAgICAgICAgICAgc3Ryb2tlTGluZWpvaW49XCJiZXZlbFwiXG4gICAgICAgID5cbiAgICAgICAgICAgIDxwYXRoIGQ9e2V4cGVjdGVkUGF0aC5qb2luKFwiIFwiKX0gdmVjdG9yRWZmZWN0PVwibm9uLXNjYWxpbmctc3Ryb2tlXCIgLz5cbiAgICAgICAgPC9nPlxuICAgICk7XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cIm1vbmV5TGF5ZXJcIiB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTfSlgfT5cbiAgICAgICAgICAgIHtvYnNlcnZlZExheWVyfVxuICAgICAgICAgICAge2V4cGVjdGVkTGF5ZXJ9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuIl19