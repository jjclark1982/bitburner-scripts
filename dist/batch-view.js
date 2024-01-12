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
            let msgs = JSON.parse(this.port.read());
            if (!Array.isArray(msgs)) {
                msgs = [msgs];
            }
            for (const msg of msgs) {
                try {
                    this.receiveMessage(msg);
                }
                catch (e) {
                    this.props.ns.print('Error parsing message ', msg, ': ', e);
                }
            }
        }
        this.port.nextWrite().then(this.readPort);
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
        for (const field of ['startTime', 'duration']) {
            if (!msg[field]) {
                throw new Error(`Missing required field '${field}': ${msg[field]}`);
            }
        }
        for (const field of ['startTime', 'duration', 'endTime', 'startTimeActual', 'endTimeActual']) {
            if (typeof msg[field] != 'number' || msg[field] > this.validTimeRange()[1]) {
                throw new Error(`Invalid value for '${field}': ${msg[field]}. Expected a value from performance.now().`);
            }
        }
        const job = this.jobs.get(jobID);
        if (job === undefined) {
            // Create new Job record with required fields
            this.jobs.set(jobID, {
                jobID: jobID,
                rowID: this.sequentialRowID++,
                endTime: (msg.startTime || 0) + (msg.duration || 0),
                ...msg
            });
        }
        else {
            // Merge updates into existing job record
            Object.assign(job, msg);
        }
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
            for (const jobID of this.jobs.values()) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBcUVFO0FBMENGLE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxLQUE4QixDQUFDO0FBY3hELHlCQUF5QjtBQUV6QixvR0FBb0c7QUFDcEcsd0RBQXdEO0FBQ3hELDBGQUEwRjtBQUMxRixJQUFJLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFZLENBQUM7QUFDM0M7Ozs7R0FJRztBQUNILFNBQVMsV0FBVyxDQUFDLENBQVMsRUFBRSxFQUFFLEdBQUMsUUFBUTtJQUN2QyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFnQixDQUFDO0FBQzVDLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxDQUFjO0lBQ2xDLE9BQU8sQ0FBQyxHQUFHLFlBQVksR0FBRyxhQUEyQixDQUFDO0FBQzFELENBQUM7QUFFRCxNQUFNLFlBQVksR0FBRztJQUNqQixJQUFJLEVBQUUsTUFBTTtJQUNaLElBQUksRUFBRSxZQUFZO0lBQ2xCLE1BQU0sRUFBRSxRQUFRO0lBQ2hCLE1BQU0sRUFBRSxTQUFTO0lBQ2pCLElBQUksRUFBRSxNQUFNO0lBQ1osTUFBTSxFQUFFLE1BQU07SUFDZCxRQUFRLEVBQUUsS0FBSztJQUNmLEtBQUssRUFBRSxNQUFNO0NBQ2hCLENBQUM7QUFFRixpR0FBaUc7QUFDakcsMEdBQTBHO0FBQzFHLHFGQUFxRjtBQUNyRixNQUFNLFlBQVksR0FBRyxHQUFpQixDQUFDO0FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEVBQWlCLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUcsR0FBYSxDQUFDO0FBQ3BDLE1BQU0sYUFBYSxHQUFHLEVBQVksQ0FBQztB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QUFNLEVBQUMsRUFBRSxDQUFBLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsY0FBYyxDQUFDLENBQWdCLENBQUM7SUFDMUcsZUFBZSxHQUFHLEtBQUssQ0FBQztJQUN4QixNQUFNLFlBQVksR0FBRyxlQUFlLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxlQUFlLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDdkYsTUFBTSxhQUFhLEdBQUcsQ0FDbEIsMkJBQUcsRUFBRSxFQUFDLGVBQWUsRUFDakIsU0FBUyxFQUFFLGVBQWUsYUFBYSxhQUFhLENBQUMsYUFBYSxHQUFHLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxHQUFHLEtBQUssR0FBRyxFQUNyRyxNQUFNLEVBQUUsWUFBWSxDQUFDLEtBQUssRUFDMUIsSUFBSSxFQUFDLE1BQU0sRUFDWCxXQUFXLEVBQUUsQ0FBQyxFQUNkLGNBQWMsRUFBQyxPQUFPO1FBRXRCLDhCQUFNLENBQUMsRUFBRSxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLFlBQVksRUFBQyxvQkFBb0IsR0FBRyxDQUNyRSxDQUNQLENBQUM7SUFFRixPQUFPLENBQ0gsMkJBQUcsRUFBRSxFQUFDLFlBQVksRUFBQyxTQUFTLEVBQUUsZUFBZSxhQUFhLEdBQUcsYUFBYSxHQUFHO1FBQ3hFLGFBQWE7UUFDYixhQUFhLENBQ2QsQ0FDUCxDQUFDO0FBQ04sQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qXG5cblVzYWdlXG4tLS0tLVxuXG5TdGFydCB0aGUgYmF0Y2ggdmlld2VyIHNjcmlwdCBmcm9tIHRoZSBjb21tYW5kIGxpbmU6XG5cbiAgICBydW4gYmF0Y2gtdmlldy5qcyAtLXBvcnQgMTBcblxuVGhlbiBzZW5kIG1lc3NhZ2VzIHRvIGl0IGZyb20gb3RoZXIgc2NyaXB0cy5cblxuRXhhbXBsZTogRGlzcGxheSBhY3Rpb24gdGltaW5nIChoYWNrIC8gZ3JvdyAvIHdlYWtlbilcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnaGFjaycsXG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBzdGFydFRpbWU6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgICAgICBkdXJhdGlvbjogbnMuZ2V0SGFja1RpbWUodGFyZ2V0KSxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IFVwZGF0ZSBhbiBhY3Rpb24gdGhhdCBoYXMgYWxyZWFkeSBiZWVuIGRpc3BsYXllZFxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBzdGFydFRpbWVBY3R1YWw6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgIH0pKTtcbiAgICBhd2FpdCBucy5oYWNrKHRhcmdldCk7XG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBlbmRUaW1lQWN0dWFsOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IERpc3BsYXkgYSBibGFuayByb3cgYmV0d2VlbiBhY3Rpb25zICh0byB2aXN1YWxseSBzZXBhcmF0ZSBiYXRjaGVzKVxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdzcGFjZXInLFxuICAgIH0pKTtcblxuRXhhbXBsZTogRGlzcGxheSBvYnNlcnZlZCBzZWN1cml0eSAvIG1vbmV5IGxldmVsXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ29ic2VydmVkJyxcbiAgICAgICAgdGltZTogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgICAgIG1pbkRpZmZpY3VsdHk6IG5zLmdldFNlcnZlck1pblNlY3VyaXR5TGV2ZWwodGFyZ2V0KSxcbiAgICAgICAgaGFja0RpZmZpY3VsdHk6IG5zLmdldFNlcnZlclNlY3VyaXR5TGV2ZWwodGFyZ2V0KSxcbiAgICAgICAgbW9uZXlNYXg6IG5zLmdldFNlcnZlck1heE1vbmV5KHRhcmdldCksXG4gICAgICAgIG1vbmV5QXZhaWxhYmxlOiBucy5nZXRTZXJ2ZXJNb25leUF2YWlsYWJsZSh0YXJnZXQpLFxuICAgIH0pKTtcblxuRXhhbXBsZTogRGlzcGxheSBleHBlY3RlZCBzZWN1cml0eSAvIG1vbmV5IGxldmVsICh2YXJpZXMgYnkgYWN0aW9uIHR5cGUgYW5kIHlvdXIgc3RyYXRlZ3kpXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ2V4cGVjdGVkJyxcbiAgICAgICAgdGltZTogam9iLnN0YXJ0VGltZSArIGpvYi5kdXJhdGlvbixcbiAgICAgICAgbWluRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyTWluU2VjdXJpdHlMZXZlbCh0YXJnZXQpLFxuICAgICAgICBoYWNrRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyU2VjdXJpdHlMZXZlbCh0YXJnZXQpICsgbnMuaGFja0FuYWx5emVTZWN1cml0eShqb2IudGhyZWFkcyksXG4gICAgICAgIG1vbmV5TWF4OiBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpLFxuICAgICAgICBtb25leUF2YWlsYWJsZTogTWF0aC5tYXgoMCwgbnMuZ2V0U2VydmVyTWF4TW9uZXkodGFyZ2V0KSAtIG5zLmhhY2tBbmFseXplKHRhcmdldCkgKiBqb2IudGhyZWFkcyAqIG5zLmhhY2tBbmFseXplQ2hhbmNlKHRhcmdldCkpLFxuICAgIH0pKTtcblxuWW91IGNhbiBhbHNvIHNlbmQgYW4gYXJyYXkgb2Ygc3VjaCBtZXNzYWdlcyBpbiBhIHNpbmdsZSBwb3J0IHdyaXRlLiBGb3IgZXhhbXBsZTpcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoW1xuICAgICAgICB7am9iSUQ6ICcxLjEnLCB0eXBlOiAnaGFjaycsICAgLi4ufSxcbiAgICAgICAge2pvYklEOiAnMS4yJywgdHlwZTogJ3dlYWtlbicsIC4uLn0sXG4gICAgICAgIHtqb2JJRDogJzEuMycsIHR5cGU6ICdncm93JywgICAuLi59LFxuICAgICAgICB7am9iSUQ6ICcxLjQnLCB0eXBlOiAnd2Vha2VuJywgLi4ufSxcbiAgICBdKSk7XG5cbiovXG5cbi8vIC0tLS0tIFB1YmxpYyBBUEkgVHlwZXMgLS0tLS1cblxudHlwZSBKb2JJRCA9IGFueTtcbmludGVyZmFjZSBBY3Rpb25NZXNzYWdlIHtcbiAgICB0eXBlOiBcImhhY2tcIiB8IFwiZ3Jvd1wiIHwgXCJ3ZWFrZW5cIjtcbiAgICBqb2JJRD86IEpvYklEO1xuICAgIGR1cmF0aW9uOiBUaW1lTXM7XG4gICAgc3RhcnRUaW1lOiBUaW1lTXM7XG4gICAgc3RhcnRUaW1lQWN0dWFsPzogVGltZU1zO1xuICAgIGVuZFRpbWU/OiBUaW1lTXM7XG4gICAgZW5kVGltZUFjdHVhbD86IFRpbWVNcztcbiAgICBjb2xvcj86IHN0cmluZztcbiAgICByZXN1bHQ/OiBudW1iZXI7XG59XG50eXBlIFVwZGF0ZU1lc3NhZ2UgPSBQYXJ0aWFsPEFjdGlvbk1lc3NhZ2U+ICYge1xuICAgIGpvYklEOiBKb2JJRDtcbn1cbmludGVyZmFjZSBTcGFjZXJNZXNzYWdlIHtcbiAgICB0eXBlOiBcInNwYWNlclwiXG59XG5pbnRlcmZhY2UgU2VydmVyTWVzc2FnZSB7XG4gICAgdHlwZTogXCJleHBlY3RlZFwiIHwgXCJvYnNlcnZlZFwiO1xuICAgIHRpbWU6IFRpbWVNcztcbiAgICBoYWNrRGlmZmljdWx0eTogbnVtYmVyO1xuICAgIG1pbkRpZmZpY3VsdHk6IG51bWJlcjtcbiAgICBtb25leUF2YWlsYWJsZTogbnVtYmVyO1xuICAgIG1vbmV5TWF4OiBudW1iZXI7XG59XG50eXBlIEV4cGVjdGVkU2VydmVyTWVzc2FnZSA9IFNlcnZlck1lc3NhZ2UgJiB7XG4gICAgdHlwZTogXCJleHBlY3RlZFwiXG59XG50eXBlIE9ic2VydmVkU2VydmVyTWVzc2FnZSA9IFNlcnZlck1lc3NhZ2UgJiB7XG4gICAgdHlwZTogXCJvYnNlcnZlZFwiXG59XG50eXBlIEJhdGNoVmlld01lc3NhZ2UgPSBBY3Rpb25NZXNzYWdlIHwgVXBkYXRlTWVzc2FnZSB8IFNwYWNlck1lc3NhZ2UgfCBFeHBlY3RlZFNlcnZlck1lc3NhZ2UgfCBPYnNlcnZlZFNlcnZlck1lc3NhZ2U7XG5cbi8vIC0tLS0tIEludGVybmFsIFR5cGVzIC0tLS0tXG5cbmltcG9ydCB0eXBlIHsgTlMsIE5ldHNjcmlwdFBvcnQsIFNlcnZlciB9IGZyb20gJ0Bucyc7XG5pbXBvcnQgdHlwZSBSZWFjdE5hbWVzcGFjZSBmcm9tICdyZWFjdC9pbmRleCc7XG5jb25zdCBSZWFjdCA9IGdsb2JhbFRoaXMuUmVhY3QgYXMgdHlwZW9mIFJlYWN0TmFtZXNwYWNlO1xuXG5pbnRlcmZhY2UgSm9iIGV4dGVuZHMgQWN0aW9uTWVzc2FnZSB7XG4gICAgam9iSUQ6IEpvYklEO1xuICAgIHJvd0lEOiBudW1iZXI7XG4gICAgZW5kVGltZTogVGltZU1zO1xufVxuXG50eXBlIFRpbWVNcyA9IFJldHVyblR5cGU8dHlwZW9mIHBlcmZvcm1hbmNlLm5vdz4gJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJtaWxsaXNlY29uZHNcIiB9O1xudHlwZSBUaW1lU2Vjb25kcyA9IG51bWJlciAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcInNlY29uZHNcIiB9O1xudHlwZSBUaW1lUGl4ZWxzID0gbnVtYmVyICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwicGl4ZWxzXCIgfTtcbnR5cGUgUGl4ZWxzID0gbnVtYmVyICYgeyBfX3VuaXRzOiBcInBpeGVsc1wiIH07XG50eXBlIFRpbWVWYWx1ZSA9IFtUaW1lTXMsIG51bWJlcl07XG5cbi8vIC0tLS0tIENvbnN0YW50cyAtLS0tLSBcblxuLy8gVE9ETzogaW5pdFRpbWUgaXMgdXNlZCBhcyB1bmlxdWUgRE9NIElEIGFuZCBhcyByZW5kZXJpbmcgb3JpZ2luIGJ1dCBpdCBpcyBwb29ybHkgc3VpdGVkIGZvciBib3RoLlxuLy8gIFRoZSBzY3JpcHQgUElEIHdvdWxkIHdvcmsgYmV0dGVyIGFzIGEgdW5pcXVlIERPTSBJRC5cbi8vICBUaGUgUHVibGljIEFQSSBjb3VsZCByZXF1aXJlIHBlcmZvcm1hbmNlLWVwb2NoIHRpbWVzLCB3aGljaCB3b24ndCBuZWVkIHRvIGJlIGFkanVzdGVkLlxubGV0IGluaXRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zO1xuLyoqXG4gKiBDb252ZXJ0IHRpbWVzdGFtcHMgdG8gc2Vjb25kcyBzaW5jZSB0aGUgZ3JhcGggd2FzIHN0YXJ0ZWQuXG4gKiBUbyByZW5kZXIgU1ZHcyB1c2luZyBuYXRpdmUgdGltZSB1bml0cywgdGhlIHZhbHVlcyBtdXN0IGJlIHZhbGlkIDMyLWJpdCBpbnRzLlxuICogU28gd2UgY29udmVydCB0byBhIHJlY2VudCBlcG9jaCBpbiBjYXNlIERhdGUubm93KCkgdmFsdWVzIGFyZSB1c2VkLlxuICovXG5mdW5jdGlvbiBjb252ZXJ0VGltZSh0OiBUaW1lTXMsIHQwPWluaXRUaW1lKTogVGltZVNlY29uZHMge1xuICAgIHJldHVybiAoKHQgLSB0MCkgLyAxMDAwKSBhcyBUaW1lU2Vjb25kcztcbn1cblxuZnVuY3Rpb24gY29udmVydFNlY1RvUHgodDogVGltZVNlY29uZHMpOiBUaW1lUGl4ZWxzIHtcbiAgICByZXR1cm4gdCAqIFdJRFRIX1BJWEVMUyAvIFdJRFRIX1NFQ09ORFMgYXMgVGltZVBpeGVscztcbn1cblxuY29uc3QgR1JBUEhfQ09MT1JTID0ge1xuICAgIGhhY2s6IFwiY3lhblwiLFxuICAgIGdyb3c6IFwibGlnaHRncmVlblwiLFxuICAgIHdlYWtlbjogXCJ5ZWxsb3dcIixcbiAgICBkZXN5bmM6IFwibWFnZW50YVwiLFxuICAgIHNhZmU6IFwiIzExMVwiLFxuICAgIHVuc2FmZTogXCIjMzMzXCIsXG4gICAgc2VjdXJpdHk6IFwicmVkXCIsXG4gICAgbW9uZXk6IFwiYmx1ZVwiXG59O1xuXG4vLyBUT0RPOiB1c2UgYSBjb250ZXh0IGZvciB0aGVzZSBzY2FsZSBmYWN0b3JzLiBzdXBwb3J0IHNldHRpbmcgdGhlbSBieSBhcmdzIGFuZCBzY3JvbGwtZ2VzdHVyZXMuXG4vLyBjb25zdCBTY3JlZW5Db250ZXh0ID0gUmVhY3QuY3JlYXRlQ29udGV4dCh7V0lEVEhfUElYRUxTLCBXSURUSF9TRUNPTkRTLCBIRUlHSFRfUElYRUxTLCBGT09URVJfUElYRUxTfSk7XG4vLyBUT0RPOiByZXZpZXcgdXNlIG9mIDYwMDAwMCwgNjAwMDAsIDEwMDAsIDEwLCBhbmQgV0lEVEhfU0VDT05EUyBhcyBjbGlwcGluZyBsaW1pdHMuXG5jb25zdCBXSURUSF9QSVhFTFMgPSA4MDAgYXMgVGltZVBpeGVscztcbmNvbnN0IFdJRFRIX1NFQ09ORFMgPSAxNiBhcyBUaW1lU2Vjb25kcztcbmNvbnN0IEhFSUdIVF9QSVhFTFMgPSA2MDAgYXMgUGl4ZWxzO1xuY29uc3QgRk9PVEVSX1BJWEVMUyA9IDUwIGFzIFBpeGVscztcblxuXG4vLyAtLS0tLSBNYWluIFByb2dyYW0gLS0tLS1cblxuY29uc3QgRkxBR1M6IFtzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBzdHJpbmdbXV1bXSA9IFtcbiAgICBbXCJoZWxwXCIsIGZhbHNlXSxcbiAgICBbXCJwb3J0XCIsIDBdLFxuICAgIFtcImRlYnVnXCIsIGZhbHNlXSxcbl07XG5cbmV4cG9ydCBmdW5jdGlvbiBhdXRvY29tcGxldGUoZGF0YTogYW55LCBhcmdzOiBzdHJpbmdbXSkge1xuICAgIGRhdGEuZmxhZ3MoRkxBR1MpO1xuICAgIHJldHVybiBbXTtcbn1cblxuLyoqIEBwYXJhbSB7TlN9IG5zICoqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1haW4obnM6IE5TKSB7XG4gICAgbnMuZGlzYWJsZUxvZygnc2xlZXAnKTtcbiAgICBucy5kaXNhYmxlTG9nKCdhc2xlZXAnKTtcbiAgICBucy5jbGVhckxvZygpO1xuICAgIG5zLnRhaWwoKTtcbiAgICBucy5yZXNpemVUYWlsKDgxMCwgNjQwKTtcblxuICAgIGNvbnN0IGZsYWdzID0gbnMuZmxhZ3MoRkxBR1MpO1xuICAgIGlmIChmbGFncy5oZWxwKSB7XG4gICAgICAgIG5zLnRwcmludChbXG4gICAgICAgICAgICBgVVNBR0VgLFxuICAgICAgICAgICAgYD4gcnVuICR7bnMuZ2V0U2NyaXB0TmFtZSgpfSAtLXBvcnQgMTBgLFxuICAgICAgICAgICAgJyAnXG4gICAgICAgIF0uam9pbihcIlxcblwiKSk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcG9ydE51bSA9IGZsYWdzLnBvcnQgYXMgbnVtYmVyIHx8IG5zLnBpZDtcbiAgICBjb25zdCBkZWJ1ZyA9IGZsYWdzLmRlYnVnIGFzIGJvb2xlYW47XG5cbiAgICBjb25zdCBiYXRjaFZpZXcgPSA8QmF0Y2hWaWV3IG5zPXtuc30gcG9ydE51bT17cG9ydE51bX0gZGVidWc9e2RlYnVnfSAvPjtcbiAgICBucy5wcmludChgTGlzdGVuaW5nIG9uIFBvcnQgJHtwb3J0TnVtfWApO1xuICAgIG5zLnByaW50UmF3KGJhdGNoVmlldyk7XG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBhd2FpdCBucy5hc2xlZXAoNjAqMTAwMCk7XG4gICAgfVxufVxuXG4vLyAtLS0tLSBCYXRjaFZpZXcgQ29tcG9uZW50IC0tLS0tXG5cbmludGVyZmFjZSBCYXRjaFZpZXdQcm9wcyB7XG4gICAgbnM6IE5TO1xuICAgIHBvcnROdW06IG51bWJlcjtcbiAgICBkZWJ1Zz86IGJvb2xlYW47XG59XG5pbnRlcmZhY2UgQmF0Y2hWaWV3U3RhdGUge1xuICAgIHJ1bm5pbmc6IGJvb2xlYW47XG4gICAgbm93OiBUaW1lTXM7XG4gICAgZGF0YVVwZGF0ZXM6IG51bWJlcjtcbn1cbmV4cG9ydCBjbGFzcyBCYXRjaFZpZXcgZXh0ZW5kcyBSZWFjdC5Db21wb25lbnQ8QmF0Y2hWaWV3UHJvcHMsIEJhdGNoVmlld1N0YXRlPiB7XG4gICAgcG9ydDogTmV0c2NyaXB0UG9ydDtcbiAgICBqb2JzOiBNYXA8Sm9iSUQsIEpvYj47XG4gICAgc2VxdWVudGlhbFJvd0lEOiBudW1iZXIgPSAwO1xuICAgIHNlcXVlbnRpYWxKb2JJRDogbnVtYmVyID0gMDtcbiAgICBleHBlY3RlZFNlcnZlcnM6IEV4cGVjdGVkU2VydmVyTWVzc2FnZVtdO1xuICAgIG9ic2VydmVkU2VydmVyczogT2JzZXJ2ZWRTZXJ2ZXJNZXNzYWdlW107XG5cbiAgICBjb25zdHJ1Y3Rvcihwcm9wczogQmF0Y2hWaWV3UHJvcHMpe1xuICAgICAgICBzdXBlcihwcm9wcyk7XG4gICAgICAgIGNvbnN0IHsgbnMsIHBvcnROdW0sIGRlYnVnIH0gPSBwcm9wcztcbiAgICAgICAgdGhpcy5zdGF0ZSA9IHtcbiAgICAgICAgICAgIHJ1bm5pbmc6IHRydWUsXG4gICAgICAgICAgICBub3c6IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNcyxcbiAgICAgICAgICAgIGRhdGFVcGRhdGVzOiAwLFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLnBvcnQgPSBucy5nZXRQb3J0SGFuZGxlKHBvcnROdW0pO1xuICAgICAgICB0aGlzLmpvYnMgPSBuZXcgTWFwKCk7XG4gICAgICAgIHRoaXMuZXhwZWN0ZWRTZXJ2ZXJzID0gW107XG4gICAgICAgIHRoaXMub2JzZXJ2ZWRTZXJ2ZXJzID0gW107XG4gICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihnbG9iYWxUaGlzLCB7YmF0Y2hWaWV3OiB0aGlzfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb21wb25lbnREaWRNb3VudCgpIHtcbiAgICAgICAgY29uc3QgeyBucywgcG9ydE51bSB9ID0gdGhpcy5wcm9wcztcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogdHJ1ZX0pO1xuICAgICAgICBucy5hdEV4aXQoKCk9PntcbiAgICAgICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IGZhbHNlfSk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmFuaW1hdGUoKTtcbiAgICAgICAgdGhpcy5yZWFkUG9ydCgpO1xuICAgIH1cblxuICAgIGNvbXBvbmVudFdpbGxVbm1vdW50KCkge1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiBmYWxzZX0pO1xuICAgIH1cblxuICAgIGFuaW1hdGUgPSAoKT0+e1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUucnVubmluZykgcmV0dXJuO1xuICAgICAgICB0aGlzLnNldFN0YXRlKHtub3c6IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNc30pO1xuICAgICAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRlKTtcbiAgICB9XG5cbiAgICByZWFkUG9ydCA9ICgpPT57XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5ydW5uaW5nKSByZXR1cm47XG4gICAgICAgIHdoaWxlKCF0aGlzLnBvcnQuZW1wdHkoKSkge1xuICAgICAgICAgICAgbGV0IG1zZ3M6IEJhdGNoVmlld01lc3NhZ2UgfCBCYXRjaFZpZXdNZXNzYWdlW10gPSBKU09OLnBhcnNlKHRoaXMucG9ydC5yZWFkKCkgYXMgc3RyaW5nKTtcbiAgICAgICAgICAgIGlmICghQXJyYXkuaXNBcnJheShtc2dzKSkge1xuICAgICAgICAgICAgICAgIG1zZ3MgPSBbbXNnc107XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKGNvbnN0IG1zZyBvZiBtc2dzKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZWNlaXZlTWVzc2FnZShtc2cpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnByb3BzLm5zLnByaW50KCdFcnJvciBwYXJzaW5nIG1lc3NhZ2UgJywgbXNnLCAnOiAnLCBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5wb3J0Lm5leHRXcml0ZSgpLnRoZW4odGhpcy5yZWFkUG9ydCk7XG4gICAgfVxuXG4gICAgcmVjZWl2ZU1lc3NhZ2UobXNnOiBCYXRjaFZpZXdNZXNzYWdlKSB7XG4gICAgICAgIGlmIChtc2cudHlwZSA9PSBcInNwYWNlclwiKSB7XG4gICAgICAgICAgICB0aGlzLnNlcXVlbnRpYWxSb3dJRCArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKG1zZy50eXBlID09IFwiZXhwZWN0ZWRcIikge1xuICAgICAgICAgICAgdGhpcy5leHBlY3RlZFNlcnZlcnMucHVzaChtc2cpO1xuICAgICAgICAgICAgdGhpcy5leHBlY3RlZFNlcnZlcnMgPSB0aGlzLmNsZWFuU2VydmVycyh0aGlzLmV4cGVjdGVkU2VydmVycyk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAobXNnLnR5cGUgPT0gXCJvYnNlcnZlZFwiKSB7XG4gICAgICAgICAgICB0aGlzLm9ic2VydmVkU2VydmVycy5wdXNoKG1zZyk7XG4gICAgICAgICAgICB0aGlzLm9ic2VydmVkU2VydmVycyA9IHRoaXMuY2xlYW5TZXJ2ZXJzKHRoaXMub2JzZXJ2ZWRTZXJ2ZXJzKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cuam9iSUQgIT09IHVuZGVmaW5lZCB8fCBtc2cudHlwZSA9PSAnaGFjaycgfHwgbXNnLnR5cGUgPT0gJ2dyb3cnIHx8IG1zZy50eXBlID09ICd3ZWFrZW4nKSB7XG4gICAgICAgICAgICB0aGlzLmFkZEpvYihtc2cpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnJlY29nbml6ZWQgbWVzc2FnZSB0eXBlOiAke21zZy50eXBlfTpgKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnNldFN0YXRlKHtkYXRhVXBkYXRlczogdGhpcy5zdGF0ZS5kYXRhVXBkYXRlcyArIDF9KTtcbiAgICB9XG5cbiAgICBhZGRKb2IobXNnOiBBY3Rpb25NZXNzYWdlIHwgVXBkYXRlTWVzc2FnZSkge1xuICAgICAgICAvLyBBc3NpZ24gc2VxdWVudGlhbCBJRCBpZiBuZWVkZWRcbiAgICAgICAgbGV0IGpvYklEID0gbXNnLmpvYklEO1xuICAgICAgICBpZiAoam9iSUQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgd2hpbGUgKHRoaXMuam9icy5oYXModGhpcy5zZXF1ZW50aWFsSm9iSUQpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXF1ZW50aWFsSm9iSUQgKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGpvYklEID0gdGhpcy5zZXF1ZW50aWFsSm9iSUQ7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBmaWVsZCBvZiBbJ3N0YXJ0VGltZScsICdkdXJhdGlvbiddIGFzIGNvbnN0KSB7XG4gICAgICAgICAgICBpZiAoIW1zZ1tmaWVsZF0pIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcmVxdWlyZWQgZmllbGQgJyR7ZmllbGR9JzogJHttc2dbZmllbGRdfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZmllbGQgb2YgWydzdGFydFRpbWUnLCAnZHVyYXRpb24nLCAnZW5kVGltZScsICdzdGFydFRpbWVBY3R1YWwnLCAnZW5kVGltZUFjdHVhbCddIGFzIGNvbnN0KSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIG1zZ1tmaWVsZF0gIT0gJ251bWJlcicgfHwgbXNnW2ZpZWxkXSBhcyBudW1iZXIgPiB0aGlzLnZhbGlkVGltZVJhbmdlKClbMV0pIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgdmFsdWUgZm9yICcke2ZpZWxkfSc6ICR7bXNnW2ZpZWxkXX0uIEV4cGVjdGVkIGEgdmFsdWUgZnJvbSBwZXJmb3JtYW5jZS5ub3coKS5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBqb2IgPSB0aGlzLmpvYnMuZ2V0KGpvYklEKTtcbiAgICAgICAgaWYgKGpvYiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAvLyBDcmVhdGUgbmV3IEpvYiByZWNvcmQgd2l0aCByZXF1aXJlZCBmaWVsZHNcbiAgICAgICAgICAgIHRoaXMuam9icy5zZXQoam9iSUQsIHtcbiAgICAgICAgICAgICAgICBqb2JJRDogam9iSUQsXG4gICAgICAgICAgICAgICAgcm93SUQ6IHRoaXMuc2VxdWVudGlhbFJvd0lEKyssXG4gICAgICAgICAgICAgICAgZW5kVGltZTogKG1zZy5zdGFydFRpbWV8fDApICsgKG1zZy5kdXJhdGlvbnx8MCkgYXMgVGltZU1zLFxuICAgICAgICAgICAgICAgIC4uLihtc2cgYXMgQWN0aW9uTWVzc2FnZSlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gTWVyZ2UgdXBkYXRlcyBpbnRvIGV4aXN0aW5nIGpvYiByZWNvcmRcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oam9iLCBtc2cpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY2xlYW5Kb2JzKCk7XG4gICAgfVxuXG4gICAgdmFsaWRUaW1lUmFuZ2UoKSB7XG4gICAgICAgIC8vIHVwIHRvIDIgc2NyZWVucyBpbiB0aGUgcGFzdFxuICAgICAgICAvLyB1cCB0byAzMCBkYXlzIGluIHRoZSBmdXR1cmVcbiAgICAgICAgcmV0dXJuIFt0aGlzLnN0YXRlLm5vdy0oV0lEVEhfU0VDT05EUyoyKjEwMDApLCAxMDAwKjYwKjYwKjI0KjMwXTtcbiAgICB9XG5cbiAgICBjbGVhbkpvYnMoKSB7XG4gICAgICAgIGNvbnN0IFtlYXJsaWVzdFRpbWUsIGxhdGVzdFRpbWVdID0gdGhpcy52YWxpZFRpbWVSYW5nZSgpO1xuICAgICAgICAvLyBGaWx0ZXIgb3V0IGV4cGlyZWQgam9icyAoZW5kVGltZSBtb3JlIHRoYW4gMiBzY3JlZW5zIGluIHRoZSBwYXN0KVxuICAgICAgICBpZiAodGhpcy5qb2JzLnNpemUgPiAyMDApIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qgam9iSUQgb2YgdGhpcy5qb2JzLnZhbHVlcygpKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgam9iID0gdGhpcy5qb2JzLmdldChqb2JJRCkgYXMgSm9iO1xuICAgICAgICAgICAgICAgIGlmICghKGpvYi5lbmRUaW1lID4gZWFybGllc3RUaW1lKSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmpvYnMuZGVsZXRlKGpvYklEKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjbGVhblNlcnZlcnM8VCBleHRlbmRzIFNlcnZlck1lc3NhZ2U+KHNlcnZlcnM6IFRbXSk6IFRbXSB7XG4gICAgICAgIGNvbnN0IFtlYXJsaWVzdFRpbWUsIGxhdGVzdFRpbWVdID0gdGhpcy52YWxpZFRpbWVSYW5nZSgpO1xuICAgICAgICAvLyBUT0RPOiBpbnNlcnQgaXRlbSBpbnRvIHNvcnRlZCBsaXN0IGluc3RlYWQgb2YgcmUtc29ydGluZyBlYWNoIHRpbWVcbiAgICAgICAgcmV0dXJuIHNlcnZlcnMuZmlsdGVyKChzKT0+cy50aW1lID4gZWFybGllc3RUaW1lKS5zb3J0KChhLGIpPT5hLnRpbWUgLSBiLnRpbWUpO1xuICAgIH1cblxuICAgIHJlbmRlcigpIHtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIDxHcmFwaEZyYW1lIG5vdz17dGhpcy5zdGF0ZS5ub3d9PlxuICAgICAgICAgICAgICAgIDxTYWZldHlMYXllciBleHBlY3RlZFNlcnZlcnM9e3RoaXMuZXhwZWN0ZWRTZXJ2ZXJzfSAvPlxuICAgICAgICAgICAgICAgIDxKb2JMYXllciBqb2JzPXtbLi4udGhpcy5qb2JzLnZhbHVlcygpXX0gLz5cbiAgICAgICAgICAgICAgICA8U2VjdXJpdHlMYXllciBleHBlY3RlZFNlcnZlcnM9e3RoaXMuZXhwZWN0ZWRTZXJ2ZXJzfSBvYnNlcnZlZFNlcnZlcnM9e3RoaXMub2JzZXJ2ZWRTZXJ2ZXJzfSAvPlxuICAgICAgICAgICAgICAgIDxNb25leUxheWVyIGV4cGVjdGVkU2VydmVycz17dGhpcy5leHBlY3RlZFNlcnZlcnN9IG9ic2VydmVkU2VydmVycz17dGhpcy5vYnNlcnZlZFNlcnZlcnN9IC8+XG4gICAgICAgICAgICA8L0dyYXBoRnJhbWU+XG4gICAgICAgIClcbiAgICB9XG59XG5cbmZ1bmN0aW9uIEdyYXBoRnJhbWUoe25vdywgY2hpbGRyZW59Ontub3c6VGltZU1zLCBjaGlsZHJlbjogUmVhY3QuUmVhY3ROb2RlfSk6IFJlYWN0LlJlYWN0RWxlbWVudCB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPHN2ZyB2ZXJzaW9uPVwiMS4xXCIgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiXG4gICAgICAgICAgICB3aWR0aD17V0lEVEhfUElYRUxTfVxuICAgICAgICAgICAgaGVpZ2h0PXtIRUlHSFRfUElYRUxTfSBcbiAgICAgICAgICAgIC8vIFNldCB0aGUgdmlld0JveCBmb3IgMTAgc2Vjb25kcyBvZiBoaXN0b3J5LCA2IHNlY29uZHMgb2YgZnV0dXJlLlxuICAgICAgICAgICAgdmlld0JveD17YCR7Y29udmVydFNlY1RvUHgoLTEwIGFzIFRpbWVTZWNvbmRzKX0gMCAke1dJRFRIX1BJWEVMU30gJHtIRUlHSFRfUElYRUxTfWB9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxkZWZzPlxuICAgICAgICAgICAgICAgIDxjbGlwUGF0aCBpZD17YGhpZGUtZnV0dXJlLSR7aW5pdFRpbWV9YH0gY2xpcFBhdGhVbml0cz1cInVzZXJTcGFjZU9uVXNlXCI+XG4gICAgICAgICAgICAgICAgICAgIDxyZWN0IGlkPVwiaGlkZS1mdXR1cmUtcmVjdFwiXG4gICAgICAgICAgICAgICAgICAgICAgICB4PXtjb252ZXJ0VGltZShub3ctNjAwMDAgYXMgVGltZU1zKX0gd2lkdGg9e2NvbnZlcnRUaW1lKDYwMDAwIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXs1MH1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2NsaXBQYXRoPlxuICAgICAgICAgICAgPC9kZWZzPlxuICAgICAgICAgICAgPHJlY3QgaWQ9XCJiYWNrZ3JvdW5kXCIgeD17Y29udmVydFNlY1RvUHgoLTEwIGFzIFRpbWVTZWNvbmRzKX0gd2lkdGg9XCIxMDAlXCIgaGVpZ2h0PVwiMTAwJVwiIGZpbGw9e0dSQVBIX0NPTE9SUy5zYWZlfSAvPlxuICAgICAgICAgICAgPGcgaWQ9XCJ0aW1lQ29vcmRpbmF0ZXNcIiB0cmFuc2Zvcm09e2BzY2FsZSgke1dJRFRIX1BJWEVMUyAvIFdJRFRIX1NFQ09ORFN9IDEpIHRyYW5zbGF0ZSgke2NvbnZlcnRUaW1lKGluaXRUaW1lLW5vdyBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX0gMClgfT5cbiAgICAgICAgICAgICAgICB7Y2hpbGRyZW59XG4gICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgLy8gW1wicmVjdFwiLCB7aWQ6XCJkaXZpZGVyLTFcIiwgeDpjb252ZXJ0U2VjVG9QeCgtMTApLCB3aWR0aDpcIjEwMCVcIiwgeTpIRUlHSFRfUElYRUxTLUZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMlwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtMipGT09URVJfUElYRUxTLCBoZWlnaHQ6MSwgZmlsbDogXCJ3aGl0ZVwifV0sXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICA8cmVjdCBpZD1cImN1cnNvclwiIHg9ezB9IHdpZHRoPXsxfSB5PXswfSBoZWlnaHQ9XCIxMDAlXCIgZmlsbD1cIndoaXRlXCIgLz5cbiAgICAgICAgICAgIDxHcmFwaExlZ2VuZCAvPlxuICAgICAgICA8L3N2Zz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBHcmFwaExlZ2VuZCgpOiBSZWFjdC5SZWFjdEVsZW1lbnQge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwiTGVnZW5kXCIgdHJhbnNmb3JtPVwidHJhbnNsYXRlKC00OTAsIDEwKSwgc2NhbGUoLjUsIC41KVwiPlxuICAgICAgICAgICAgPHJlY3QgeD17MX0geT17MX0gd2lkdGg9ezI3NX0gaGVpZ2h0PXszOTJ9IGZpbGw9XCJibGFja1wiIHN0cm9rZT1cIiM5Nzk3OTdcIiAvPlxuICAgICAgICAgICAge09iamVjdC5lbnRyaWVzKEdSQVBIX0NPTE9SUykubWFwKChbbGFiZWwsIGNvbG9yXSwgaSk9PihcbiAgICAgICAgICAgICAgICA8ZyBrZXk9e2xhYmVsfSB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMjIsICR7MTMgKyA0MSppfSlgfT5cbiAgICAgICAgICAgICAgICAgICAgPHJlY3QgeD17MH0geT17MH0gd2lkdGg9ezIyfSBoZWlnaHQ9ezIyfSBmaWxsPXtjb2xvcn0gLz5cbiAgICAgICAgICAgICAgICAgICAgPHRleHQgZm9udEZhbWlseT1cIkNvdXJpZXIgTmV3XCIgZm9udFNpemU9ezM2fSBmaWxsPVwiIzg4OFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRzcGFuIHg9ezQyLjV9IHk9ezMwfT57bGFiZWwuc3Vic3RyaW5nKDAsMSkudG9VcHBlckNhc2UoKStsYWJlbC5zdWJzdHJpbmcoMSl9PC90c3Bhbj5cbiAgICAgICAgICAgICAgICAgICAgPC90ZXh0PlxuICAgICAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgICkpfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gU2FmZXR5TGF5ZXIoe2V4cGVjdGVkU2VydmVyc306IHtleHBlY3RlZFNlcnZlcnM6IEV4cGVjdGVkU2VydmVyTWVzc2FnZVtdfSk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgbGV0IHByZXZTZXJ2ZXI6IEV4cGVjdGVkU2VydmVyTWVzc2FnZSB8IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cInNhZmV0eUxheWVyXCI+XG4gICAgICAgICAgICB7ZXhwZWN0ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyLCBpKT0+e1xuICAgICAgICAgICAgICAgIGxldCBlbCA9IG51bGw7XG4gICAgICAgICAgICAgICAgLy8gc2hhZGUgdGhlIGJhY2tncm91bmQgYmFzZWQgb24gc2VjTGV2ZWxcbiAgICAgICAgICAgICAgICBpZiAocHJldlNlcnZlciAmJiBzZXJ2ZXIudGltZSA+IHByZXZTZXJ2ZXIudGltZSkge1xuICAgICAgICAgICAgICAgICAgICBlbCA9ICg8cmVjdCBrZXk9e2l9XG4gICAgICAgICAgICAgICAgICAgICAgICB4PXtjb252ZXJ0VGltZShwcmV2U2VydmVyLnRpbWUpfSB3aWR0aD17Y29udmVydFRpbWUoc2VydmVyLnRpbWUgLSBwcmV2U2VydmVyLnRpbWUgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICAgICAgICAgICAgICB5PXswfSBoZWlnaHQ9XCIxMDAlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGw9eyhwcmV2U2VydmVyLmhhY2tEaWZmaWN1bHR5ID4gcHJldlNlcnZlci5taW5EaWZmaWN1bHR5KSA/IEdSQVBIX0NPTE9SUy51bnNhZmUgOiBHUkFQSF9DT0xPUlMuc2FmZX1cbiAgICAgICAgICAgICAgICAgICAgLz4pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBwcmV2U2VydmVyID0gc2VydmVyO1xuICAgICAgICAgICAgICAgIHJldHVybiBlbDtcbiAgICAgICAgICAgIH0pfVxuICAgICAgICAgICAge3ByZXZTZXJ2ZXIgJiYgKFxuICAgICAgICAgICAgICAgIDxyZWN0IGtleT1cInJlbWFpbmRlclwiXG4gICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHByZXZTZXJ2ZXIudGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZSg2MDAwMDAgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD1cIjEwMCVcIlxuICAgICAgICAgICAgICAgICAgICBmaWxsPXsocHJldlNlcnZlci5oYWNrRGlmZmljdWx0eSA+IHByZXZTZXJ2ZXIubWluRGlmZmljdWx0eSkgPyBHUkFQSF9DT0xPUlMudW5zYWZlIDogR1JBUEhfQ09MT1JTLnNhZmV9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBKb2JMYXllcih7am9ic306IHtqb2JzOiBKb2JbXX0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cImpvYkxheWVyXCI+XG4gICAgICAgICAgICB7am9icy5tYXAoKGpvYjogSm9iKT0+KDxKb2JCYXIgam9iPXtqb2J9IGtleT17am9iLmpvYklEfSAvPikpfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gSm9iQmFyKHtqb2J9OiB7am9iOiBKb2J9KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBjb25zdCB5ID0gKChqb2Iucm93SUQgKyAxKSAlICgoSEVJR0hUX1BJWEVMUyAtIEZPT1RFUl9QSVhFTFMqMikgLyA0KSkgKiA0O1xuICAgIGxldCBqb2JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lICYmIGpvYi5kdXJhdGlvbikge1xuICAgICAgICBqb2JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKGpvYi5zdGFydFRpbWUpfSB3aWR0aD17Y29udmVydFRpbWUoam9iLmR1cmF0aW9uLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezJ9XG4gICAgICAgICAgICBmaWxsPXtqb2IuY29sb3IgPz8gR1JBUEhfQ09MT1JTW2pvYi50eXBlXX1cbiAgICAgICAgLz4pXG4gICAgfTtcbiAgICBsZXQgc3RhcnRFcnJvckJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5zdGFydFRpbWVBY3R1YWwpIHtcbiAgICAgICAgY29uc3QgW3QxLCB0Ml0gPSBbam9iLnN0YXJ0VGltZSwgam9iLnN0YXJ0VGltZUFjdHVhbF0uc29ydCgoYSxiKT0+YS1iKTtcbiAgICAgICAgc3RhcnRFcnJvckJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUodDEpfSB3aWR0aD17Y29udmVydFRpbWUodDItdDEgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBmaWxsPXtHUkFQSF9DT0xPUlMuZGVzeW5jfVxuICAgICAgICAgLz4pO1xuICAgIH1cbiAgICBsZXQgZW5kRXJyb3JCYXIgPSBudWxsO1xuICAgIGlmIChqb2IuZW5kVGltZUFjdHVhbCkge1xuICAgICAgICBjb25zdCBbdDEsIHQyXSA9IFtqb2IuZW5kVGltZSwgam9iLmVuZFRpbWVBY3R1YWxdLnNvcnQoKGEsYik9PmEtYik7XG4gICAgICAgIGVuZEVycm9yQmFyID0gKDxyZWN0XG4gICAgICAgICAgICB4PXtjb252ZXJ0VGltZSh0MSl9IHdpZHRoPXtjb252ZXJ0VGltZSh0Mi10MSBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17MX1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SUy5kZXN5bmN9XG4gICAgICAgICAvPik7XG4gICAgfVxuICAgIHJldHVybiAoXG4gICAgICAgIDxnIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7eX0pYH0+XG4gICAgICAgICAgICB7am9iQmFyfVxuICAgICAgICAgICAge3N0YXJ0RXJyb3JCYXJ9XG4gICAgICAgICAgICB7ZW5kRXJyb3JCYXJ9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5pbnRlcmZhY2UgU2VjdXJpdHlMYXllclByb3BzIHtcbiAgICBleHBlY3RlZFNlcnZlcnM6IEV4cGVjdGVkU2VydmVyTWVzc2FnZVtdO1xuICAgIG9ic2VydmVkU2VydmVyczogT2JzZXJ2ZWRTZXJ2ZXJNZXNzYWdlW11cbn1cbmZ1bmN0aW9uIFNlY3VyaXR5TGF5ZXIoe2V4cGVjdGVkU2VydmVycywgb2JzZXJ2ZWRTZXJ2ZXJzfTpTZWN1cml0eUxheWVyUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGV4cGVjdGVkU2VydmVycyA/Pz0gW107XG4gICAgb2JzZXJ2ZWRTZXJ2ZXJzID8/PSBbXTtcbiAgICBsZXQgbWluU2VjID0gMDtcbiAgICBsZXQgbWF4U2VjID0gMTtcbiAgICBmb3IgKGNvbnN0IHNuYXBzaG90cyBvZiBbZXhwZWN0ZWRTZXJ2ZXJzLCBvYnNlcnZlZFNlcnZlcnNdKSB7XG4gICAgICAgIGZvciAoY29uc3Qgc2VydmVyIG9mIHNuYXBzaG90cykge1xuICAgICAgICAgICAgbWluU2VjID0gTWF0aC5taW4obWluU2VjLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHkpO1xuICAgICAgICAgICAgbWF4U2VjID0gTWF0aC5tYXgobWF4U2VjLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgb2JzZXJ2ZWRFdmVudHMgPSBvYnNlcnZlZFNlcnZlcnMubWFwKChzZXJ2ZXIpPT5bc2VydmVyLnRpbWUsIHNlcnZlci5oYWNrRGlmZmljdWx0eV0pIGFzIFRpbWVWYWx1ZVtdO1xuICAgIGNvbnN0IHNob3VsZENsb3NlUGF0aCA9IHRydWU7XG4gICAgY29uc3Qgb2JzZXJ2ZWRQYXRoID0gY29tcHV0ZVBhdGhEYXRhKG9ic2VydmVkRXZlbnRzLCBtaW5TZWMsIHNob3VsZENsb3NlUGF0aCk7XG4gICAgY29uc3Qgb2JzZXJ2ZWRMYXllciA9IChcbiAgICAgICAgPGcgaWQ9XCJvYnNlcnZlZFNlY1wiXG4gICAgICAgICAgICB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4U2VjIC0gbWluU2VjKX0pYH1cbiAgICAgICAgICAgIGZpbGw9e1wiZGFya1wiK0dSQVBIX0NPTE9SUy5zZWN1cml0eX1cbiAgICAgICAgICAgIC8vIGZpbGxPcGFjaXR5OiAwLjUsXG4gICAgICAgICAgICBjbGlwUGF0aD17YHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHBhdGggZD17b2JzZXJ2ZWRQYXRoLmpvaW4oXCIgXCIpfSAvPlxuICAgICAgICA8L2c+XG4gICAgKTtcblxuICAgIGNvbnN0IGV4cGVjdGVkRXZlbnRzID0gZXhwZWN0ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyKT0+W3NlcnZlci50aW1lLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHldKSBhcyBUaW1lVmFsdWVbXTtcbiAgICBjb25zdCBleHBlY3RlZFBhdGggPSBjb21wdXRlUGF0aERhdGEoZXhwZWN0ZWRFdmVudHMpO1xuICAgIGNvbnN0IGV4cGVjdGVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwiZXhwZWN0ZWRTZWNcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heFNlYyAtIG1pblNlYyl9KWB9XG4gICAgICAgICAgICBzdHJva2U9e0dSQVBIX0NPTE9SUy5zZWN1cml0eX1cbiAgICAgICAgICAgIGZpbGw9XCJub25lXCJcbiAgICAgICAgICAgIHN0cm9rZVdpZHRoPXsyfVxuICAgICAgICAgICAgc3Ryb2tlTGluZWpvaW49XCJiZXZlbFwiXG4gICAgICAgID5cbiAgICAgICAgICAgIDxwYXRoIGQ9e2V4cGVjdGVkUGF0aC5qb2luKFwiIFwiKX0gdmVjdG9yRWZmZWN0PVwibm9uLXNjYWxpbmctc3Ryb2tlXCIgLz5cbiAgICAgICAgPC9nPlxuICAgICk7XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cInNlY0xheWVyXCIgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtIRUlHSFRfUElYRUxTIC0gMipGT09URVJfUElYRUxTfSlgfT5cbiAgICAgICAgICAgIHtvYnNlcnZlZExheWVyfVxuICAgICAgICAgICAge2V4cGVjdGVkTGF5ZXJ9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBjb21wdXRlUGF0aERhdGEoZXZlbnRzOiBUaW1lVmFsdWVbXSwgbWluVmFsdWU9MCwgc2hvdWxkQ2xvc2U9ZmFsc2UsIHNjYWxlPTEpIHtcbiAgICBjb25zdCBwYXRoRGF0YSA9IFtdO1xuICAgIGlmIChldmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBbdGltZSwgdmFsdWVdID0gZXZlbnRzWzBdO1xuICAgICAgICAvLyBzdGFydCBsaW5lIGF0IGZpcnN0IHByb2plY3RlZCB0aW1lIGFuZCB2YWx1ZVxuICAgICAgICBwYXRoRGF0YS5wdXNoKGBNICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX0sJHsodmFsdWUqc2NhbGUpLnRvRml4ZWQoMil9YCk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgW3RpbWUsIHZhbHVlXSBvZiBldmVudHMpIHtcbiAgICAgICAgLy8gaG9yaXpvbnRhbCBsaW5lIHRvIGN1cnJlbnQgdGltZVxuICAgICAgICBwYXRoRGF0YS5wdXNoKGBIICR7Y29udmVydFRpbWUodGltZSkudG9GaXhlZCgzKX1gKVxuICAgICAgICAvLyB2ZXJ0aWNhbCBsaW5lIHRvIG5ldyBsZXZlbFxuICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KHZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgIH1cbiAgICAvLyBmaWxsIGluIGFyZWEgYmV0d2VlbiBsYXN0IHNuYXBzaG90IGFuZCByaWdodCBzaWRlIChhcmVhIGFmdGVyIFwibm93XCIgY3Vyc29yIHdpbGwgYmUgY2xpcHBlZCBsYXRlcilcbiAgICBpZiAoZXZlbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgW3RpbWUsIHZhbHVlXSA9IGV2ZW50c1tldmVudHMubGVuZ3RoLTFdO1xuICAgICAgICAvLyBob3Jpem9udGFsIGxpbmUgdG8gZnV0dXJlIHRpbWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKHRpbWUgKyA2MDAwMDAgYXMgVGltZU1zKS50b0ZpeGVkKDMpfWApO1xuICAgICAgICBpZiAoc2hvdWxkQ2xvc2UpIHtcbiAgICAgICAgICAgIC8vIGZpbGwgYXJlYSB1bmRlciBhY3R1YWwgc2VjdXJpdHlcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYFYgJHsobWluVmFsdWUqc2NhbGUpLnRvRml4ZWQoMil9YCk7XG4gICAgICAgICAgICBjb25zdCBtaW5UaW1lID0gZXZlbnRzWzBdWzBdO1xuICAgICAgICAgICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKG1pblRpbWUpLnRvRml4ZWQoMyl9YCk7XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKCdaJyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHBhdGhEYXRhO1xufVxuXG5mdW5jdGlvbiBNb25leUxheWVyKHtleHBlY3RlZFNlcnZlcnMsIG9ic2VydmVkU2VydmVyc306IFNlY3VyaXR5TGF5ZXJQcm9wcyk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgZXhwZWN0ZWRTZXJ2ZXJzID8/PSBbXTtcbiAgICBvYnNlcnZlZFNlcnZlcnMgPz89IFtdO1xuICAgIGlmIChleHBlY3RlZFNlcnZlcnMubGVuZ3RoID09IDAgJiYgb2JzZXJ2ZWRTZXJ2ZXJzLmxlbmd0aCA9PSAwKSByZXR1cm4gbnVsbDtcbiAgICBsZXQgbWluTW9uZXkgPSAwO1xuICAgIGxldCBtYXhNb25leSA9IChleHBlY3RlZFNlcnZlcnNbMF0gfHwgb2JzZXJ2ZWRTZXJ2ZXJzWzBdKS5tb25leU1heDtcbiAgICBjb25zdCBzY2FsZSA9IDEvbWF4TW9uZXk7XG4gICAgbWF4TW9uZXkgKj0gMS4xXG5cbiAgICBjb25zdCBvYnNlcnZlZEV2ZW50cyA9IG9ic2VydmVkU2VydmVycy5tYXAoKHNlcnZlcik9PltzZXJ2ZXIudGltZSwgc2VydmVyLm1vbmV5QXZhaWxhYmxlXSkgYXMgVGltZVZhbHVlW107XG4gICAgbGV0IHNob3VsZENsb3NlUGF0aCA9IHRydWU7XG4gICAgY29uc3Qgb2JzZXJ2ZWRQYXRoID0gY29tcHV0ZVBhdGhEYXRhKG9ic2VydmVkRXZlbnRzLCBtaW5Nb25leSwgc2hvdWxkQ2xvc2VQYXRoLCBzY2FsZSk7XG4gICAgY29uc3Qgb2JzZXJ2ZWRMYXllciA9IChcbiAgICAgICAgPGcgaWQ9XCJvYnNlcnZlZE1vbmV5XCJcbiAgICAgICAgICAgIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhNb25leSAtIG1pbk1vbmV5KSAvIHNjYWxlfSlgfVxuICAgICAgICAgICAgZmlsbD17XCJkYXJrXCIrR1JBUEhfQ09MT1JTLm1vbmV5fVxuICAgICAgICAgICAgLy8gZmlsbE9wYWNpdHk6IDAuNSxcbiAgICAgICAgICAgIGNsaXBQYXRoPXtgdXJsKCNoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfSlgfVxuICAgICAgICA+XG4gICAgICAgICAgICA8cGF0aCBkPXtvYnNlcnZlZFBhdGguam9pbihcIiBcIil9IC8+XG4gICAgICAgIDwvZz5cbiAgICApO1xuXG4gICAgY29uc3QgZXhwZWN0ZWRFdmVudHMgPSBleHBlY3RlZFNlcnZlcnMubWFwKChzZXJ2ZXIpPT5bc2VydmVyLnRpbWUsIHNlcnZlci5tb25leUF2YWlsYWJsZV0pIGFzIFRpbWVWYWx1ZVtdO1xuICAgIHNob3VsZENsb3NlUGF0aCA9IGZhbHNlO1xuICAgIGNvbnN0IGV4cGVjdGVkUGF0aCA9IGNvbXB1dGVQYXRoRGF0YShleHBlY3RlZEV2ZW50cywgbWluTW9uZXksIHNob3VsZENsb3NlUGF0aCwgc2NhbGUpO1xuICAgIGNvbnN0IGV4cGVjdGVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwiZXhwZWN0ZWRNb25leVwiXG4gICAgICAgICAgICB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4TW9uZXkgLSBtaW5Nb25leSkgLyBzY2FsZX0pYH1cbiAgICAgICAgICAgIHN0cm9rZT17R1JBUEhfQ09MT1JTLm1vbmV5fVxuICAgICAgICAgICAgZmlsbD1cIm5vbmVcIlxuICAgICAgICAgICAgc3Ryb2tlV2lkdGg9ezJ9XG4gICAgICAgICAgICBzdHJva2VMaW5lam9pbj1cImJldmVsXCJcbiAgICAgICAgPlxuICAgICAgICAgICAgPHBhdGggZD17ZXhwZWN0ZWRQYXRoLmpvaW4oXCIgXCIpfSB2ZWN0b3JFZmZlY3Q9XCJub24tc2NhbGluZy1zdHJva2VcIiAvPlxuICAgICAgICA8L2c+XG4gICAgKTtcblxuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwibW9uZXlMYXllclwiIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7SEVJR0hUX1BJWEVMUyAtIEZPT1RFUl9QSVhFTFN9KWB9PlxuICAgICAgICAgICAge29ic2VydmVkTGF5ZXJ9XG4gICAgICAgICAgICB7ZXhwZWN0ZWRMYXllcn1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG4iXX0=