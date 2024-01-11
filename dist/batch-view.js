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
            now: performance.now(),
            dataUpdates: 0,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBNERFO0FBdUNGLE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxLQUE4QixDQUFDO0FBY3hELHlCQUF5QjtBQUV6QixvR0FBb0c7QUFDcEcsd0RBQXdEO0FBQ3hELDBGQUEwRjtBQUMxRixJQUFJLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFZLENBQUM7QUFDM0M7Ozs7R0FJRztBQUNILFNBQVMsV0FBVyxDQUFDLENBQVMsRUFBRSxFQUFFLEdBQUMsUUFBUTtJQUN2QyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFnQixDQUFDO0FBQzVDLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxDQUFjO0lBQ2xDLE9BQU8sQ0FBQyxHQUFHLFlBQVksR0FBRyxhQUEyQixDQUFDO0FBQzFELENBQUM7QUFFRCxNQUFNLFlBQVksR0FBRztJQUNqQixJQUFJLEVBQUUsTUFBTTtJQUNaLElBQUksRUFBRSxZQUFZO0lBQ2xCLE1BQU0sRUFBRSxRQUFRO0lBQ2hCLFNBQVMsRUFBRSxLQUFLO0lBQ2hCLE1BQU0sRUFBRSxTQUFTO0lBQ2pCLElBQUksRUFBRSxNQUFNO0lBQ1osTUFBTSxFQUFFLE1BQU07SUFDZCxRQUFRLEVBQUUsS0FBSztJQUNmLEtBQUssRUFBRSxNQUFNO0NBQ2hCLENBQUM7QUFFRixpR0FBaUc7QUFDakcsMEdBQTBHO0FBQzFHLHFGQUFxRjtBQUNyRixNQUFNLFlBQVksR0FBRyxHQUFpQixDQUFDO0FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEVBQWlCLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUcsR0FBYSxDQUFDO0FBQ3BDLE1BQU0sYUFBYSxHQUFH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LElBQUksRUFBRSxNQUFNLEdBQUMsWUFBWSxDQUFDLEtBQUs7UUFDL0Isb0JBQW9CO1FBQ3BCLFFBQVEsRUFBRSxvQkFBb0IsUUFBUSxHQUFHO1FBRXpDLDhCQUFNLENBQUMsRUFBRSxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFJLENBQ25DLENBQ1AsQ0FBQztJQUVGLE1BQU0sY0FBYyxHQUFHLGVBQWUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUMsRUFBRSxDQUFBLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsY0FBYyxDQUFDLENBQWdCLENBQUM7SUFDMUcsZUFBZSxHQUFHLEtBQUssQ0FBQztJQUN4QixNQUFNLFlBQVksR0FBRyxlQUFlLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxlQUFlLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDdkYsTUFBTSxhQUFhLEdBQUcsQ0FDbEIsMkJBQUcsRUFBRSxFQUFDLGVBQWUsRUFDakIsU0FBUyxFQUFFLGVBQWUsYUFBYSxhQUFhLENBQUMsYUFBYSxHQUFHLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxHQUFHLEtBQUssR0FBRyxFQUNyRyxNQUFNLEVBQUUsWUFBWSxDQUFDLEtBQUssRUFDMUIsSUFBSSxFQUFDLE1BQU0sRUFDWCxXQUFXLEVBQUUsQ0FBQyxFQUNkLGNBQWMsRUFBQyxPQUFPO1FBRXRCLDhCQUFNLENBQUMsRUFBRSxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLFlBQVksRUFBQyxvQkFBb0IsR0FBRyxDQUNyRSxDQUNQLENBQUM7SUFFRixPQUFPLENBQ0gsMkJBQUcsRUFBRSxFQUFDLFlBQVksRUFBQyxTQUFTLEVBQUUsZUFBZSxhQUFhLEdBQUcsYUFBYSxHQUFHO1FBQ3hFLGFBQWE7UUFDYixhQUFhLENBQ2QsQ0FDUCxDQUFDO0FBQ04sQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qXG5cblVzYWdlXG4tLS0tLVxuXG5TdGFydCB0aGUgYmF0Y2ggdmlld2VyIHNjcmlwdCBmcm9tIHRoZSBjb21tYW5kIGxpbmU6XG5cbiAgICBydW4gYmF0Y2gtdmlldy5qcyAtLXBvcnQgMTBcblxuVGhlbiBzZW5kIG1lc3NhZ2VzIHRvIGl0IGZyb20gb3RoZXIgc2NyaXB0cy5cblxuRXhhbXBsZTogRGlzcGxheSBhY3Rpb24gdGltaW5nIChoYWNrIC8gZ3JvdyAvIHdlYWtlbilcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnaGFjaycsXG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBzdGFydFRpbWU6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgICAgICBkdXJhdGlvbjogbnMuZ2V0SGFja1RpbWUodGFyZ2V0KSxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IFVwZGF0ZSBhbiBhY3Rpb24gdGhhdCBoYXMgYWxyZWFkeSBiZWVuIGRpc3BsYXllZFxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBzdGFydFRpbWVBY3R1YWw6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgIH0pKTtcbiAgICBhd2FpdCBucy5oYWNrKHRhcmdldCk7XG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGpvYklEOiAxLFxuICAgICAgICBlbmRUaW1lQWN0dWFsOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IERpc3BsYXkgYSBibGFuayByb3cgYmV0d2VlbiBhY3Rpb25zICh0byB2aXN1YWxseSBzZXBhcmF0ZSBiYXRjaGVzKVxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdzcGFjZXInLFxuICAgIH0pKTtcblxuRXhhbXBsZTogRGlzcGxheSBvYnNlcnZlZCBzZWN1cml0eSAvIG1vbmV5IGxldmVsXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ29ic2VydmVkJyxcbiAgICAgICAgdGltZTogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgICAgIG1pbkRpZmZpY3VsdHk6IG5zLmdldFNlcnZlck1pblNlY3VyaXR5TGV2ZWwodGFyZ2V0KSxcbiAgICAgICAgaGFja0RpZmZpY3VsdHk6IG5zLmdldFNlcnZlclNlY3VyaXR5TGV2ZWwodGFyZ2V0KSxcbiAgICAgICAgbW9uZXlNYXg6IG5zLmdldFNlcnZlck1heE1vbmV5KHRhcmdldCksXG4gICAgICAgIG1vbmV5QXZhaWxhYmxlOiBucy5nZXRTZXJ2ZXJNb25leUF2YWlsYWJsZSh0YXJnZXQpLFxuICAgIH0pKTtcblxuRXhhbXBsZTogRGlzcGxheSBleHBlY3RlZCBzZWN1cml0eSAvIG1vbmV5IGxldmVsICh2YXJpZXMgYnkgYWN0aW9uIHR5cGUgYW5kIHlvdXIgc3RyYXRlZ3kpXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ2V4cGVjdGVkJyxcbiAgICAgICAgdGltZTogam9iLnN0YXJ0VGltZSArIGpvYi5kdXJhdGlvbixcbiAgICAgICAgbWluRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyTWluU2VjdXJpdHlMZXZlbCh0YXJnZXQpLFxuICAgICAgICBoYWNrRGlmZmljdWx0eTogbnMuZ2V0U2VydmVyU2VjdXJpdHlMZXZlbCh0YXJnZXQpICsgbnMuaGFja0FuYWx5emVTZWN1cml0eShqb2IudGhyZWFkcyksXG4gICAgICAgIG1vbmV5TWF4OiBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpLFxuICAgICAgICBtb25leUF2YWlsYWJsZTogTWF0aC5tYXgoMCwgbnMuZ2V0U2VydmVyTWF4TW9uZXkodGFyZ2V0KSAtIG5zLmhhY2tBbmFseXplKHRhcmdldCkgKiBqb2IudGhyZWFkcyAqIG5zLmhhY2tBbmFseXplQ2hhbmNlKHRhcmdldCkpLFxuICAgIH0pKTtcblxuKi9cblxuLy8gLS0tLS0gUHVibGljIEFQSSBUeXBlcyAtLS0tLVxuXG50eXBlIEpvYklEID0gbnVtYmVyIHwgc3RyaW5nO1xuaW50ZXJmYWNlIEFjdGlvbk1lc3NhZ2Uge1xuICAgIHR5cGU6IFwiaGFja1wiIHwgXCJncm93XCIgfCBcIndlYWtlblwiO1xuICAgIGpvYklEPzogSm9iSUQ7XG4gICAgZHVyYXRpb246IFRpbWVNcztcbiAgICBzdGFydFRpbWU6IFRpbWVNcztcbiAgICBzdGFydFRpbWVBY3R1YWw/OiBUaW1lTXM7XG4gICAgZW5kVGltZT86IFRpbWVNcztcbiAgICBlbmRUaW1lQWN0dWFsPzogVGltZU1zO1xuICAgIGNhbmNlbGxlZD86IGJvb2xlYW47XG4gICAgcmVzdWx0PzogbnVtYmVyO1xufVxuaW50ZXJmYWNlIFNwYWNlck1lc3NhZ2Uge1xuICAgIHR5cGU6IFwic3BhY2VyXCJcbn1cbmludGVyZmFjZSBTZXJ2ZXJNZXNzYWdlIHtcbiAgICB0eXBlOiBcImV4cGVjdGVkXCIgfCBcIm9ic2VydmVkXCI7XG4gICAgdGltZTogVGltZU1zO1xuICAgIGhhY2tEaWZmaWN1bHR5OiBudW1iZXI7XG4gICAgbWluRGlmZmljdWx0eTogbnVtYmVyO1xuICAgIG1vbmV5QXZhaWxhYmxlOiBudW1iZXI7XG4gICAgbW9uZXlNYXg6IG51bWJlcjtcbn1cbnR5cGUgRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlID0gU2VydmVyTWVzc2FnZSAmIHtcbiAgICB0eXBlOiBcImV4cGVjdGVkXCJcbn1cbnR5cGUgT2JzZXJ2ZWRTZXJ2ZXJNZXNzYWdlID0gU2VydmVyTWVzc2FnZSAmIHtcbiAgICB0eXBlOiBcIm9ic2VydmVkXCJcbn1cbnR5cGUgQmF0Y2hWaWV3TWVzc2FnZSA9IEFjdGlvbk1lc3NhZ2UgfCBTcGFjZXJNZXNzYWdlIHwgRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlIHwgT2JzZXJ2ZWRTZXJ2ZXJNZXNzYWdlO1xuXG4vLyAtLS0tLSBJbnRlcm5hbCBUeXBlcyAtLS0tLVxuXG5pbXBvcnQgdHlwZSB7IE5TLCBOZXRzY3JpcHRQb3J0LCBTZXJ2ZXIgfSBmcm9tICdAbnMnO1xuaW1wb3J0IHR5cGUgUmVhY3ROYW1lc3BhY2UgZnJvbSAncmVhY3QvaW5kZXgnO1xuY29uc3QgUmVhY3QgPSBnbG9iYWxUaGlzLlJlYWN0IGFzIHR5cGVvZiBSZWFjdE5hbWVzcGFjZTtcblxuaW50ZXJmYWNlIEpvYiBleHRlbmRzIEFjdGlvbk1lc3NhZ2Uge1xuICAgIGpvYklEOiBKb2JJRDtcbiAgICByb3dJRDogbnVtYmVyO1xuICAgIGVuZFRpbWU6IFRpbWVNcztcbn1cblxudHlwZSBUaW1lTXMgPSBSZXR1cm5UeXBlPHR5cGVvZiBwZXJmb3JtYW5jZS5ub3c+ICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwibWlsbGlzZWNvbmRzXCIgfTtcbnR5cGUgVGltZVNlY29uZHMgPSBudW1iZXIgJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJzZWNvbmRzXCIgfTtcbnR5cGUgVGltZVBpeGVscyA9IG51bWJlciAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcInBpeGVsc1wiIH07XG50eXBlIFBpeGVscyA9IG51bWJlciAmIHsgX191bml0czogXCJwaXhlbHNcIiB9O1xudHlwZSBUaW1lVmFsdWUgPSBbVGltZU1zLCBudW1iZXJdO1xuXG4vLyAtLS0tLSBDb25zdGFudHMgLS0tLS0gXG5cbi8vIFRPRE86IGluaXRUaW1lIGlzIHVzZWQgYXMgdW5pcXVlIERPTSBJRCBhbmQgYXMgcmVuZGVyaW5nIG9yaWdpbiBidXQgaXQgaXMgcG9vcmx5IHN1aXRlZCBmb3IgYm90aC5cbi8vICBUaGUgc2NyaXB0IFBJRCB3b3VsZCB3b3JrIGJldHRlciBhcyBhIHVuaXF1ZSBET00gSUQuXG4vLyAgVGhlIFB1YmxpYyBBUEkgY291bGQgcmVxdWlyZSBwZXJmb3JtYW5jZS1lcG9jaCB0aW1lcywgd2hpY2ggd29uJ3QgbmVlZCB0byBiZSBhZGp1c3RlZC5cbmxldCBpbml0VGltZSA9IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNcztcbi8qKlxuICogQ29udmVydCB0aW1lc3RhbXBzIHRvIHNlY29uZHMgc2luY2UgdGhlIGdyYXBoIHdhcyBzdGFydGVkLlxuICogVG8gcmVuZGVyIFNWR3MgdXNpbmcgbmF0aXZlIHRpbWUgdW5pdHMsIHRoZSB2YWx1ZXMgbXVzdCBiZSB2YWxpZCAzMi1iaXQgaW50cy5cbiAqIFNvIHdlIGNvbnZlcnQgdG8gYSByZWNlbnQgZXBvY2ggaW4gY2FzZSBEYXRlLm5vdygpIHZhbHVlcyBhcmUgdXNlZC5cbiAqL1xuZnVuY3Rpb24gY29udmVydFRpbWUodDogVGltZU1zLCB0MD1pbml0VGltZSk6IFRpbWVTZWNvbmRzIHtcbiAgICByZXR1cm4gKCh0IC0gdDApIC8gMTAwMCkgYXMgVGltZVNlY29uZHM7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRTZWNUb1B4KHQ6IFRpbWVTZWNvbmRzKTogVGltZVBpeGVscyB7XG4gICAgcmV0dXJuIHQgKiBXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTIGFzIFRpbWVQaXhlbHM7XG59XG5cbmNvbnN0IEdSQVBIX0NPTE9SUyA9IHtcbiAgICBoYWNrOiBcImN5YW5cIixcbiAgICBncm93OiBcImxpZ2h0Z3JlZW5cIixcbiAgICB3ZWFrZW46IFwieWVsbG93XCIsXG4gICAgY2FuY2VsbGVkOiBcInJlZFwiLFxuICAgIGRlc3luYzogXCJtYWdlbnRhXCIsXG4gICAgc2FmZTogXCIjMTExXCIsXG4gICAgdW5zYWZlOiBcIiMzMzNcIixcbiAgICBzZWN1cml0eTogXCJyZWRcIixcbiAgICBtb25leTogXCJibHVlXCJcbn07XG5cbi8vIFRPRE86IHVzZSBhIGNvbnRleHQgZm9yIHRoZXNlIHNjYWxlIGZhY3RvcnMuIHN1cHBvcnQgc2V0dGluZyB0aGVtIGJ5IGFyZ3MgYW5kIHNjcm9sbC1nZXN0dXJlcy5cbi8vIGNvbnN0IFNjcmVlbkNvbnRleHQgPSBSZWFjdC5jcmVhdGVDb250ZXh0KHtXSURUSF9QSVhFTFMsIFdJRFRIX1NFQ09ORFMsIEhFSUdIVF9QSVhFTFMsIEZPT1RFUl9QSVhFTFN9KTtcbi8vIFRPRE86IHJldmlldyB1c2Ugb2YgNjAwMDAwLCA2MDAwMCwgMTAwMCwgMTAsIGFuZCBXSURUSF9TRUNPTkRTIGFzIGNsaXBwaW5nIGxpbWl0cy5cbmNvbnN0IFdJRFRIX1BJWEVMUyA9IDgwMCBhcyBUaW1lUGl4ZWxzO1xuY29uc3QgV0lEVEhfU0VDT05EUyA9IDE2IGFzIFRpbWVTZWNvbmRzO1xuY29uc3QgSEVJR0hUX1BJWEVMUyA9IDYwMCBhcyBQaXhlbHM7XG5jb25zdCBGT09URVJfUElYRUxTID0gNTAgYXMgUGl4ZWxzO1xuXG5cbi8vIC0tLS0tIE1haW4gUHJvZ3JhbSAtLS0tLVxuXG5jb25zdCBGTEFHUzogW3N0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IHN0cmluZ1tdXVtdID0gW1xuICAgIFtcImhlbHBcIiwgZmFsc2VdLFxuICAgIFtcInBvcnRcIiwgMF1cbl07XG5cbmV4cG9ydCBmdW5jdGlvbiBhdXRvY29tcGxldGUoZGF0YTogYW55LCBhcmdzOiBzdHJpbmdbXSkge1xuICAgIGRhdGEuZmxhZ3MoRkxBR1MpO1xuICAgIHJldHVybiBbXTtcbn1cblxuLyoqIEBwYXJhbSB7TlN9IG5zICoqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1haW4obnM6IE5TKSB7XG4gICAgbnMuZGlzYWJsZUxvZygnc2xlZXAnKTtcbiAgICBucy5jbGVhckxvZygpO1xuICAgIG5zLnRhaWwoKTtcbiAgICBucy5yZXNpemVUYWlsKDgxMCwgNjQwKTtcblxuICAgIGNvbnN0IGZsYWdzID0gbnMuZmxhZ3MoRkxBR1MpO1xuICAgIGlmIChmbGFncy5oZWxwKSB7XG4gICAgICAgIG5zLnRwcmludChbXG4gICAgICAgICAgICBgVVNBR0VgLFxuICAgICAgICAgICAgYD4gcnVuICR7bnMuZ2V0U2NyaXB0TmFtZSgpfSAtLXBvcnQgMTBgLFxuICAgICAgICAgICAgJyAnXG4gICAgICAgIF0uam9pbihcIlxcblwiKSk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwb3J0TnVtID0gZmxhZ3MucG9ydCBhcyBudW1iZXIgfHwgbnMucGlkO1xuICAgIGNvbnN0IHBvcnQgPSBucy5nZXRQb3J0SGFuZGxlKHBvcnROdW0pO1xuICAgIC8vIHBvcnQuY2xlYXIoKTtcbiAgICBucy5wcmludChgTGlzdGVuaW5nIG9uIFBvcnQgJHtwb3J0TnVtfWApO1xuXG4gICAgY29uc3QgYmF0Y2hWaWV3ID0gPEJhdGNoVmlldyBucz17bnN9IHBvcnROdW09e3BvcnROdW19IC8+O1xuICAgIG5zLnByaW50UmF3KGJhdGNoVmlldyk7XG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBhd2FpdCBwb3J0Lm5leHRXcml0ZSgpO1xuICAgIH1cbn1cblxuLy8gLS0tLS0gQmF0Y2hWaWV3IENvbXBvbmVudCAtLS0tLVxuXG5pbnRlcmZhY2UgQmF0Y2hWaWV3UHJvcHMge1xuICAgIG5zOiBOUztcbiAgICBwb3J0TnVtOiBudW1iZXI7XG59XG5pbnRlcmZhY2UgQmF0Y2hWaWV3U3RhdGUge1xuICAgIHJ1bm5pbmc6IGJvb2xlYW47XG4gICAgbm93OiBUaW1lTXM7XG4gICAgZGF0YVVwZGF0ZXM6IG51bWJlcjtcbn1cbmV4cG9ydCBjbGFzcyBCYXRjaFZpZXcgZXh0ZW5kcyBSZWFjdC5Db21wb25lbnQ8QmF0Y2hWaWV3UHJvcHMsIEJhdGNoVmlld1N0YXRlPiB7XG4gICAgcG9ydDogTmV0c2NyaXB0UG9ydDtcbiAgICBqb2JzOiBNYXA8Sm9iSUQsIEpvYj47XG4gICAgc2VxdWVudGlhbFJvd0lEOiBudW1iZXIgPSAwO1xuICAgIHNlcXVlbnRpYWxKb2JJRDogbnVtYmVyID0gMDtcbiAgICBleHBlY3RlZFNlcnZlcnM6IEV4cGVjdGVkU2VydmVyTWVzc2FnZVtdO1xuICAgIG9ic2VydmVkU2VydmVyczogT2JzZXJ2ZWRTZXJ2ZXJNZXNzYWdlW107XG5cbiAgICBjb25zdHJ1Y3Rvcihwcm9wczogQmF0Y2hWaWV3UHJvcHMpe1xuICAgICAgICBzdXBlcihwcm9wcyk7XG4gICAgICAgIGNvbnN0IHsgbnMsIHBvcnROdW0gfSA9IHByb3BzO1xuICAgICAgICB0aGlzLnN0YXRlID0ge1xuICAgICAgICAgICAgcnVubmluZzogdHJ1ZSxcbiAgICAgICAgICAgIG5vdzogcGVyZm9ybWFuY2Uubm93KCkgYXMgVGltZU1zLFxuICAgICAgICAgICAgZGF0YVVwZGF0ZXM6IDAsXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMucG9ydCA9IG5zLmdldFBvcnRIYW5kbGUocG9ydE51bSk7XG4gICAgICAgIHRoaXMuam9icyA9IG5ldyBNYXAoKTtcbiAgICAgICAgdGhpcy5leHBlY3RlZFNlcnZlcnMgPSBbXTtcbiAgICAgICAgdGhpcy5vYnNlcnZlZFNlcnZlcnMgPSBbXTtcbiAgICB9XG5cbiAgICBjb21wb25lbnREaWRNb3VudCgpIHtcbiAgICAgICAgY29uc3QgeyBucyB9ID0gdGhpcy5wcm9wcztcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogdHJ1ZX0pO1xuICAgICAgICBucy5hdEV4aXQoKCk9PntcbiAgICAgICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IGZhbHNlfSk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmFuaW1hdGUoKTtcbiAgICAgICAgdGhpcy5yZWFkUG9ydCgpO1xuICAgICAgICAvLyBPYmplY3QuYXNzaWduKGdsb2JhbFRoaXMsIHtiYXRjaFZpZXc6IHRoaXN9KTtcbiAgICB9XG5cbiAgICBjb21wb25lbnRXaWxsVW5tb3VudCgpIHtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogZmFsc2V9KTtcbiAgICB9XG5cbiAgICBhbmltYXRlID0gKCk9PntcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlLnJ1bm5pbmcpIHJldHVybjtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7bm93OiBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXN9KTtcbiAgICAgICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0ZSk7XG4gICAgfVxuXG4gICAgcmVhZFBvcnQgPSAoKT0+e1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUucnVubmluZykgcmV0dXJuO1xuICAgICAgICB3aGlsZSghdGhpcy5wb3J0LmVtcHR5KCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZzogQmF0Y2hWaWV3TWVzc2FnZSA9IEpTT04ucGFyc2UodGhpcy5wb3J0LnJlYWQoKSBhcyBzdHJpbmcpO1xuICAgICAgICAgICAgdGhpcy5yZWNlaXZlTWVzc2FnZShtc2cpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMucG9ydC5uZXh0V3JpdGUoKS50aGVuKHRoaXMucmVhZFBvcnQpO1xuICAgIH1cblxuICAgIHJlY2VpdmVNZXNzYWdlKG1zZzogQmF0Y2hWaWV3TWVzc2FnZSkge1xuICAgICAgICBpZiAobXNnLnR5cGUgPT0gXCJzcGFjZXJcIikge1xuICAgICAgICAgICAgdGhpcy5zZXF1ZW50aWFsUm93SUQgKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cudHlwZSA9PSBcImV4cGVjdGVkXCIpIHtcbiAgICAgICAgICAgIHRoaXMuZXhwZWN0ZWRTZXJ2ZXJzLnB1c2gobXNnKTtcbiAgICAgICAgICAgIC8vIFRPRE86IHNvcnQgYnkgdGltZSBhbmQgcmVtb3ZlIGV4cGlyZWQgaXRlbXNcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cudHlwZSA9PSBcIm9ic2VydmVkXCIpIHtcbiAgICAgICAgICAgIHRoaXMub2JzZXJ2ZWRTZXJ2ZXJzLnB1c2gobXNnKTtcbiAgICAgICAgICAgIC8vIFRPRE86IHNvcnQgYnkgdGltZSBhbmQgcmVtb3ZlIGV4cGlyZWQgaXRlbXNcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cuam9iSUQgIT09IHVuZGVmaW5lZCB8fCBtc2cudHlwZSA9PSAnaGFjaycgfHwgbXNnLnR5cGUgPT0gJ2dyb3cnIHx8IG1zZy50eXBlID09ICd3ZWFrZW4nKSB7XG4gICAgICAgICAgICB0aGlzLmFkZEpvYihtc2cpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe2RhdGFVcGRhdGVzOiB0aGlzLnN0YXRlLmRhdGFVcGRhdGVzICsgMX0pO1xuICAgIH1cblxuICAgIGFkZEpvYihtc2c6IEFjdGlvbk1lc3NhZ2UpIHtcbiAgICAgICAgLy8gQXNzaWduIHNlcXVlbnRpYWwgSUQgaWYgbmVlZGVkXG4gICAgICAgIGxldCBqb2JJRCA9IG1zZy5qb2JJRDtcbiAgICAgICAgaWYgKGpvYklEID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHdoaWxlICh0aGlzLmpvYnMuaGFzKHRoaXMuc2VxdWVudGlhbEpvYklEKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuc2VxdWVudGlhbEpvYklEICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBqb2JJRCA9IHRoaXMuc2VxdWVudGlhbEpvYklEO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuam9icy5nZXQoam9iSUQpO1xuICAgICAgICBpZiAoam9iID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIC8vIENyZWF0ZSBuZXcgSm9iIHJlY29yZCB3aXRoIHJlcXVpcmVkIGZpZWxkc1xuICAgICAgICAgICAgdGhpcy5qb2JzLnNldChqb2JJRCwge1xuICAgICAgICAgICAgICAgIGpvYklEOiBqb2JJRCxcbiAgICAgICAgICAgICAgICByb3dJRDogdGhpcy5zZXF1ZW50aWFsUm93SUQrKyxcbiAgICAgICAgICAgICAgICBlbmRUaW1lOiBtc2cuc3RhcnRUaW1lICsgbXNnLmR1cmF0aW9uIGFzIFRpbWVNcyxcbiAgICAgICAgICAgICAgICAuLi5tc2dcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gTWVyZ2UgdXBkYXRlcyBpbnRvIGV4aXN0aW5nIGpvYiByZWNvcmRcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oam9iLCBtc2cpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY2xlYW5Kb2JzKCk7XG4gICAgfVxuXG4gICAgY2xlYW5Kb2JzKCkge1xuICAgICAgICAvLyBGaWx0ZXIgb3V0IGV4cGlyZWQgam9icyAoZW5kVGltZSBtb3JlIHRoYW4gMiBzY3JlZW5zIGluIHRoZSBwYXN0KVxuICAgICAgICBpZiAodGhpcy5qb2JzLnNpemUgPiAyMDApIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qgam9iSUQgb2YgdGhpcy5qb2JzLmtleXMoKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuam9icy5nZXQoam9iSUQpIGFzIEpvYjtcbiAgICAgICAgICAgICAgICBpZiAoKGpvYi5lbmRUaW1lQWN0dWFsID8/IGpvYi5lbmRUaW1lKSA8IHRoaXMuc3RhdGUubm93LShXSURUSF9TRUNPTkRTKjIqMTAwMCkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5qb2JzLmRlbGV0ZShqb2JJRCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmVuZGVyKCkge1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgPEdyYXBoRnJhbWUgbm93PXt0aGlzLnN0YXRlLm5vd30+XG4gICAgICAgICAgICAgICAgPFNhZmV0eUxheWVyIGV4cGVjdGVkU2VydmVycz17dGhpcy5leHBlY3RlZFNlcnZlcnN9IC8+XG4gICAgICAgICAgICAgICAgPEpvYkxheWVyIGpvYnM9e1suLi50aGlzLmpvYnMudmFsdWVzKCldfSAvPlxuICAgICAgICAgICAgICAgIDxTZWN1cml0eUxheWVyIGV4cGVjdGVkU2VydmVycz17dGhpcy5leHBlY3RlZFNlcnZlcnN9IG9ic2VydmVkU2VydmVycz17dGhpcy5vYnNlcnZlZFNlcnZlcnN9IC8+XG4gICAgICAgICAgICAgICAgPE1vbmV5TGF5ZXIgZXhwZWN0ZWRTZXJ2ZXJzPXt0aGlzLmV4cGVjdGVkU2VydmVyc30gb2JzZXJ2ZWRTZXJ2ZXJzPXt0aGlzLm9ic2VydmVkU2VydmVyc30gLz5cbiAgICAgICAgICAgIDwvR3JhcGhGcmFtZT5cbiAgICAgICAgKVxuICAgIH1cbn1cblxuZnVuY3Rpb24gR3JhcGhGcmFtZSh7bm93LCBjaGlsZHJlbn06e25vdzpUaW1lTXMsIGNoaWxkcmVuOiBSZWFjdC5SZWFjdE5vZGV9KTogUmVhY3QuUmVhY3RFbGVtZW50IHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8c3ZnIHZlcnNpb249XCIxLjFcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCJcbiAgICAgICAgICAgIHdpZHRoPXtXSURUSF9QSVhFTFN9XG4gICAgICAgICAgICBoZWlnaHQ9e0hFSUdIVF9QSVhFTFN9IFxuICAgICAgICAgICAgLy8gU2V0IHRoZSB2aWV3Qm94IGZvciAxMCBzZWNvbmRzIG9mIGhpc3RvcnksIDYgc2Vjb25kcyBvZiBmdXR1cmUuXG4gICAgICAgICAgICB2aWV3Qm94PXtgJHtjb252ZXJ0U2VjVG9QeCgtMTAgYXMgVGltZVNlY29uZHMpfSAwICR7V0lEVEhfUElYRUxTfSAke0hFSUdIVF9QSVhFTFN9YH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGRlZnM+XG4gICAgICAgICAgICAgICAgPGNsaXBQYXRoIGlkPXtgaGlkZS1mdXR1cmUtJHtpbml0VGltZX1gfSBjbGlwUGF0aFVuaXRzPVwidXNlclNwYWNlT25Vc2VcIj5cbiAgICAgICAgICAgICAgICAgICAgPHJlY3QgaWQ9XCJoaWRlLWZ1dHVyZS1yZWN0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKG5vdy02MDAwMCBhcyBUaW1lTXMpfSB3aWR0aD17Y29udmVydFRpbWUoNjAwMDAgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICAgICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezUwfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvY2xpcFBhdGg+XG4gICAgICAgICAgICA8L2RlZnM+XG4gICAgICAgICAgICA8cmVjdCBpZD1cImJhY2tncm91bmRcIiB4PXtjb252ZXJ0U2VjVG9QeCgtMTAgYXMgVGltZVNlY29uZHMpfSB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCIgZmlsbD17R1JBUEhfQ09MT1JTLnNhZmV9IC8+XG4gICAgICAgICAgICA8ZyBpZD1cInRpbWVDb29yZGluYXRlc1wiIHRyYW5zZm9ybT17YHNjYWxlKCR7V0lEVEhfUElYRUxTIC8gV0lEVEhfU0VDT05EU30gMSkgdHJhbnNsYXRlKCR7Y29udmVydFRpbWUoaW5pdFRpbWUtbm93IGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfSAwKWB9PlxuICAgICAgICAgICAgICAgIHtjaGlsZHJlbn1cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMVwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0yXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy0yKkZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIDxyZWN0IGlkPVwiY3Vyc29yXCIgeD17MH0gd2lkdGg9ezF9IHk9ezB9IGhlaWdodD1cIjEwMCVcIiBmaWxsPVwid2hpdGVcIiAvPlxuICAgICAgICAgICAgPEdyYXBoTGVnZW5kIC8+XG4gICAgICAgIDwvc3ZnPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEdyYXBoTGVnZW5kKCk6IFJlYWN0LlJlYWN0RWxlbWVudCB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJMZWdlbmRcIiB0cmFuc2Zvcm09XCJ0cmFuc2xhdGUoLTQ5MCwgMTApLCBzY2FsZSguNSwgLjUpXCI+XG4gICAgICAgICAgICA8cmVjdCB4PXsxfSB5PXsxfSB3aWR0aD17Mjc1fSBoZWlnaHQ9ezM5Mn0gZmlsbD1cImJsYWNrXCIgc3Ryb2tlPVwiIzk3OTc5N1wiIC8+XG4gICAgICAgICAgICB7T2JqZWN0LmVudHJpZXMoR1JBUEhfQ09MT1JTKS5tYXAoKFtsYWJlbCwgY29sb3JdLCBpKT0+KFxuICAgICAgICAgICAgICAgIDxnIGtleT17bGFiZWx9IHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgyMiwgJHsxMyArIDQxKml9KWB9PlxuICAgICAgICAgICAgICAgICAgICA8cmVjdCB4PXswfSB5PXswfSB3aWR0aD17MjJ9IGhlaWdodD17MjJ9IGZpbGw9e2NvbG9yfSAvPlxuICAgICAgICAgICAgICAgICAgICA8dGV4dCBmb250RmFtaWx5PVwiQ291cmllciBOZXdcIiBmb250U2l6ZT17MzZ9IGZpbGw9XCIjODg4XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dHNwYW4geD17NDIuNX0geT17MzB9PntsYWJlbC5zdWJzdHJpbmcoMCwxKS50b1VwcGVyQ2FzZSgpK2xhYmVsLnN1YnN0cmluZygxKX08L3RzcGFuPlxuICAgICAgICAgICAgICAgICAgICA8L3RleHQ+XG4gICAgICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBTYWZldHlMYXllcih7ZXhwZWN0ZWRTZXJ2ZXJzfToge2V4cGVjdGVkU2VydmVyczogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlW119KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBsZXQgcHJldlNlcnZlcjogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlIHwgdW5kZWZpbmVkO1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwic2FmZXR5TGF5ZXJcIj5cbiAgICAgICAgICAgIHtleHBlY3RlZFNlcnZlcnMubWFwKChzZXJ2ZXIsIGkpPT57XG4gICAgICAgICAgICAgICAgbGV0IGVsID0gbnVsbDtcbiAgICAgICAgICAgICAgICAvLyBzaGFkZSB0aGUgYmFja2dyb3VuZCBiYXNlZCBvbiBzZWNMZXZlbFxuICAgICAgICAgICAgICAgIGlmIChwcmV2U2VydmVyICYmIHNlcnZlci50aW1lID4gcHJldlNlcnZlci50aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGVsID0gKDxyZWN0IGtleT17aX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHByZXZTZXJ2ZXIudGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZShzZXJ2ZXIudGltZSAtIHByZXZTZXJ2ZXIudGltZSBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD1cIjEwMCVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsbD17KHByZXZTZXJ2ZXIuaGFja0RpZmZpY3VsdHkgPiBwcmV2U2VydmVyLm1pbkRpZmZpY3VsdHkpID8gR1JBUEhfQ09MT1JTLnVuc2FmZSA6IEdSQVBIX0NPTE9SUy5zYWZlfVxuICAgICAgICAgICAgICAgICAgICAvPik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHByZXZTZXJ2ZXIgPSBzZXJ2ZXI7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGVsO1xuICAgICAgICAgICAgfSl9XG4gICAgICAgICAgICB7cHJldlNlcnZlciAmJiAoXG4gICAgICAgICAgICAgICAgPHJlY3Qga2V5PVwicmVtYWluZGVyXCJcbiAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUocHJldlNlcnZlci50aW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKDYwMDAwMCBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgeT17MH0gaGVpZ2h0PVwiMTAwJVwiXG4gICAgICAgICAgICAgICAgICAgIGZpbGw9eyhwcmV2U2VydmVyLmhhY2tEaWZmaWN1bHR5ID4gcHJldlNlcnZlci5taW5EaWZmaWN1bHR5KSA/IEdSQVBIX0NPTE9SUy51bnNhZmUgOiBHUkFQSF9DT0xPUlMuc2FmZX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEpvYkxheWVyKHtqb2JzfToge2pvYnM6IEpvYltdfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwiam9iTGF5ZXJcIj5cbiAgICAgICAgICAgIHtqb2JzLm1hcCgoam9iOiBKb2IpPT4oPEpvYkJhciBqb2I9e2pvYn0ga2V5PXtqb2Iuam9iSUR9IC8+KSl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBKb2JCYXIoe2pvYn06IHtqb2I6IEpvYn0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGNvbnN0IHkgPSAoKGpvYi5yb3dJRCArIDEpICUgKChIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMUyoyKSAvIDQpKSAqIDQ7XG4gICAgbGV0IGpvYkJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5zdGFydFRpbWUgJiYgam9iLmR1cmF0aW9uKSB7XG4gICAgICAgIGpvYkJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUoam9iLnN0YXJ0VGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZShqb2IuZHVyYXRpb24sIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17Mn1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SU1tqb2IuY2FuY2VsbGVkID8gJ2NhbmNlbGxlZCcgOiBqb2IudHlwZV19XG4gICAgICAgIC8+KVxuICAgIH07XG4gICAgbGV0IHN0YXJ0RXJyb3JCYXIgPSBudWxsO1xuICAgIGlmIChqb2Iuc3RhcnRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5zdGFydFRpbWUsIGpvYi5zdGFydFRpbWVBY3R1YWxdLnNvcnQoKGEsYik9PmEtYik7XG4gICAgICAgIHN0YXJ0RXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgZmlsbD17R1JBUEhfQ09MT1JTLmRlc3luY31cbiAgICAgICAgIC8+KTtcbiAgICB9XG4gICAgbGV0IGVuZEVycm9yQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLmVuZFRpbWVBY3R1YWwpIHtcbiAgICAgICAgY29uc3QgW3QxLCB0Ml0gPSBbam9iLmVuZFRpbWUsIGpvYi5lbmRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICBlbmRFcnJvckJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUodDEpfSB3aWR0aD17Y29udmVydFRpbWUodDItdDEgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBmaWxsPXtHUkFQSF9DT0xPUlMuZGVzeW5jfVxuICAgICAgICAgLz4pO1xuICAgIH1cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke3l9KWB9PlxuICAgICAgICAgICAge2pvYkJhcn1cbiAgICAgICAgICAgIHtzdGFydEVycm9yQmFyfVxuICAgICAgICAgICAge2VuZEVycm9yQmFyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuaW50ZXJmYWNlIFNlY3VyaXR5TGF5ZXJQcm9wcyB7XG4gICAgZXhwZWN0ZWRTZXJ2ZXJzOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2VbXTtcbiAgICBvYnNlcnZlZFNlcnZlcnM6IE9ic2VydmVkU2VydmVyTWVzc2FnZVtdXG59XG5mdW5jdGlvbiBTZWN1cml0eUxheWVyKHtleHBlY3RlZFNlcnZlcnMsIG9ic2VydmVkU2VydmVyc306U2VjdXJpdHlMYXllclByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBleHBlY3RlZFNlcnZlcnMgPz89IFtdO1xuICAgIG9ic2VydmVkU2VydmVycyA/Pz0gW107XG4gICAgbGV0IG1pblNlYyA9IDA7XG4gICAgbGV0IG1heFNlYyA9IDE7XG4gICAgZm9yIChjb25zdCBzbmFwc2hvdHMgb2YgW2V4cGVjdGVkU2VydmVycywgb2JzZXJ2ZWRTZXJ2ZXJzXSkge1xuICAgICAgICBmb3IgKGNvbnN0IHNlcnZlciBvZiBzbmFwc2hvdHMpIHtcbiAgICAgICAgICAgIG1pblNlYyA9IE1hdGgubWluKG1pblNlYywgc2VydmVyLmhhY2tEaWZmaWN1bHR5KTtcbiAgICAgICAgICAgIG1heFNlYyA9IE1hdGgubWF4KG1heFNlYywgc2VydmVyLmhhY2tEaWZmaWN1bHR5KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG9ic2VydmVkRXZlbnRzID0gb2JzZXJ2ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyKT0+W3NlcnZlci50aW1lLCBzZXJ2ZXIuaGFja0RpZmZpY3VsdHldKSBhcyBUaW1lVmFsdWVbXTtcbiAgICBjb25zdCBzaG91bGRDbG9zZVBhdGggPSB0cnVlO1xuICAgIGNvbnN0IG9ic2VydmVkUGF0aCA9IGNvbXB1dGVQYXRoRGF0YShvYnNlcnZlZEV2ZW50cywgbWluU2VjLCBzaG91bGRDbG9zZVBhdGgpO1xuICAgIGNvbnN0IG9ic2VydmVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwib2JzZXJ2ZWRTZWNcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heFNlYyAtIG1pblNlYyl9KWB9XG4gICAgICAgICAgICBmaWxsPXtcImRhcmtcIitHUkFQSF9DT0xPUlMuc2VjdXJpdHl9XG4gICAgICAgICAgICAvLyBmaWxsT3BhY2l0eTogMC41LFxuICAgICAgICAgICAgY2xpcFBhdGg9e2B1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWB9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxwYXRoIGQ9e29ic2VydmVkUGF0aC5qb2luKFwiIFwiKX0gLz5cbiAgICAgICAgPC9nPlxuICAgICk7XG5cbiAgICBjb25zdCBleHBlY3RlZEV2ZW50cyA9IGV4cGVjdGVkU2VydmVycy5tYXAoKHNlcnZlcik9PltzZXJ2ZXIudGltZSwgc2VydmVyLmhhY2tEaWZmaWN1bHR5XSkgYXMgVGltZVZhbHVlW107XG4gICAgY29uc3QgZXhwZWN0ZWRQYXRoID0gY29tcHV0ZVBhdGhEYXRhKGV4cGVjdGVkRXZlbnRzKTtcbiAgICBjb25zdCBleHBlY3RlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cImV4cGVjdGVkU2VjXCJcbiAgICAgICAgICAgIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhTZWMgLSBtaW5TZWMpfSlgfVxuICAgICAgICAgICAgc3Ryb2tlPXtHUkFQSF9DT0xPUlMuc2VjdXJpdHl9XG4gICAgICAgICAgICBmaWxsPVwibm9uZVwiXG4gICAgICAgICAgICBzdHJva2VXaWR0aD17Mn1cbiAgICAgICAgICAgIHN0cm9rZUxpbmVqb2luPVwiYmV2ZWxcIlxuICAgICAgICA+XG4gICAgICAgICAgICA8cGF0aCBkPXtleHBlY3RlZFBhdGguam9pbihcIiBcIil9IHZlY3RvckVmZmVjdD1cIm5vbi1zY2FsaW5nLXN0cm9rZVwiIC8+XG4gICAgICAgIDwvZz5cbiAgICApO1xuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJzZWNMYXllclwiIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7SEVJR0hUX1BJWEVMUyAtIDIqRk9PVEVSX1BJWEVMU30pYH0+XG4gICAgICAgICAgICB7b2JzZXJ2ZWRMYXllcn1cbiAgICAgICAgICAgIHtleHBlY3RlZExheWVyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cblxuZnVuY3Rpb24gY29tcHV0ZVBhdGhEYXRhKGV2ZW50czogVGltZVZhbHVlW10sIG1pblZhbHVlPTAsIHNob3VsZENsb3NlPWZhbHNlLCBzY2FsZT0xKSB7XG4gICAgY29uc3QgcGF0aERhdGEgPSBbXTtcbiAgICBpZiAoZXZlbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgW3RpbWUsIHZhbHVlXSA9IGV2ZW50c1swXTtcbiAgICAgICAgLy8gc3RhcnQgbGluZSBhdCBmaXJzdCBwcm9qZWN0ZWQgdGltZSBhbmQgdmFsdWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgTSAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9LCR7KHZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IFt0aW1lLCB2YWx1ZV0gb2YgZXZlbnRzKSB7XG4gICAgICAgIC8vIGhvcml6b250YWwgbGluZSB0byBjdXJyZW50IHRpbWVcbiAgICAgICAgcGF0aERhdGEucHVzaChgSCAke2NvbnZlcnRUaW1lKHRpbWUpLnRvRml4ZWQoMyl9YClcbiAgICAgICAgLy8gdmVydGljYWwgbGluZSB0byBuZXcgbGV2ZWxcbiAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyh2YWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICB9XG4gICAgLy8gZmlsbCBpbiBhcmVhIGJldHdlZW4gbGFzdCBzbmFwc2hvdCBhbmQgcmlnaHQgc2lkZSAoYXJlYSBhZnRlciBcIm5vd1wiIGN1cnNvciB3aWxsIGJlIGNsaXBwZWQgbGF0ZXIpXG4gICAgaWYgKGV2ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IFt0aW1lLCB2YWx1ZV0gPSBldmVudHNbZXZlbnRzLmxlbmd0aC0xXTtcbiAgICAgICAgLy8gaG9yaXpvbnRhbCBsaW5lIHRvIGZ1dHVyZSB0aW1lXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYEggJHtjb252ZXJ0VGltZSh0aW1lICsgNjAwMDAwIGFzIFRpbWVNcykudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgaWYgKHNob3VsZENsb3NlKSB7XG4gICAgICAgICAgICAvLyBmaWxsIGFyZWEgdW5kZXIgYWN0dWFsIHNlY3VyaXR5XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBWICR7KG1pblZhbHVlKnNjYWxlKS50b0ZpeGVkKDIpfWApO1xuICAgICAgICAgICAgY29uc3QgbWluVGltZSA9IGV2ZW50c1swXVswXTtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goYEggJHtjb252ZXJ0VGltZShtaW5UaW1lKS50b0ZpeGVkKDMpfWApO1xuICAgICAgICAgICAgcGF0aERhdGEucHVzaCgnWicpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBwYXRoRGF0YTtcbn1cblxuZnVuY3Rpb24gTW9uZXlMYXllcih7ZXhwZWN0ZWRTZXJ2ZXJzLCBvYnNlcnZlZFNlcnZlcnN9OiBTZWN1cml0eUxheWVyUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGV4cGVjdGVkU2VydmVycyA/Pz0gW107XG4gICAgb2JzZXJ2ZWRTZXJ2ZXJzID8/PSBbXTtcbiAgICBpZiAoZXhwZWN0ZWRTZXJ2ZXJzLmxlbmd0aCA9PSAwICYmIG9ic2VydmVkU2VydmVycy5sZW5ndGggPT0gMCkgcmV0dXJuIG51bGw7XG4gICAgbGV0IG1pbk1vbmV5ID0gMDtcbiAgICBsZXQgbWF4TW9uZXkgPSAoZXhwZWN0ZWRTZXJ2ZXJzWzBdIHx8IG9ic2VydmVkU2VydmVyc1swXSkubW9uZXlNYXg7XG4gICAgY29uc3Qgc2NhbGUgPSAxL21heE1vbmV5O1xuICAgIG1heE1vbmV5ICo9IDEuMVxuXG4gICAgY29uc3Qgb2JzZXJ2ZWRFdmVudHMgPSBvYnNlcnZlZFNlcnZlcnMubWFwKChzZXJ2ZXIpPT5bc2VydmVyLnRpbWUsIHNlcnZlci5tb25leUF2YWlsYWJsZV0pIGFzIFRpbWVWYWx1ZVtdO1xuICAgIGxldCBzaG91bGRDbG9zZVBhdGggPSB0cnVlO1xuICAgIGNvbnN0IG9ic2VydmVkUGF0aCA9IGNvbXB1dGVQYXRoRGF0YShvYnNlcnZlZEV2ZW50cywgbWluTW9uZXksIHNob3VsZENsb3NlUGF0aCwgc2NhbGUpO1xuICAgIGNvbnN0IG9ic2VydmVkTGF5ZXIgPSAoXG4gICAgICAgIDxnIGlkPVwib2JzZXJ2ZWRNb25leVwiXG4gICAgICAgICAgICB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4TW9uZXkgLSBtaW5Nb25leSkgLyBzY2FsZX0pYH1cbiAgICAgICAgICAgIGZpbGw9e1wiZGFya1wiK0dSQVBIX0NPTE9SUy5tb25leX1cbiAgICAgICAgICAgIC8vIGZpbGxPcGFjaXR5OiAwLjUsXG4gICAgICAgICAgICBjbGlwUGF0aD17YHVybCgjaGlkZS1mdXR1cmUtJHtpbml0VGltZX0pYH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHBhdGggZD17b2JzZXJ2ZWRQYXRoLmpvaW4oXCIgXCIpfSAvPlxuICAgICAgICA8L2c+XG4gICAgKTtcblxuICAgIGNvbnN0IGV4cGVjdGVkRXZlbnRzID0gZXhwZWN0ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyKT0+W3NlcnZlci50aW1lLCBzZXJ2ZXIubW9uZXlBdmFpbGFibGVdKSBhcyBUaW1lVmFsdWVbXTtcbiAgICBzaG91bGRDbG9zZVBhdGggPSBmYWxzZTtcbiAgICBjb25zdCBleHBlY3RlZFBhdGggPSBjb21wdXRlUGF0aERhdGEoZXhwZWN0ZWRFdmVudHMsIG1pbk1vbmV5LCBzaG91bGRDbG9zZVBhdGgsIHNjYWxlKTtcbiAgICBjb25zdCBleHBlY3RlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cImV4cGVjdGVkTW9uZXlcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heE1vbmV5IC0gbWluTW9uZXkpIC8gc2NhbGV9KWB9XG4gICAgICAgICAgICBzdHJva2U9e0dSQVBIX0NPTE9SUy5tb25leX1cbiAgICAgICAgICAgIGZpbGw9XCJub25lXCJcbiAgICAgICAgICAgIHN0cm9rZVdpZHRoPXsyfVxuICAgICAgICAgICAgc3Ryb2tlTGluZWpvaW49XCJiZXZlbFwiXG4gICAgICAgID5cbiAgICAgICAgICAgIDxwYXRoIGQ9e2V4cGVjdGVkUGF0aC5qb2luKFwiIFwiKX0gdmVjdG9yRWZmZWN0PVwibm9uLXNjYWxpbmctc3Ryb2tlXCIgLz5cbiAgICAgICAgPC9nPlxuICAgICk7XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8ZyBpZD1cIm1vbmV5TGF5ZXJcIiB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSBGT09URVJfUElYRUxTfSlgfT5cbiAgICAgICAgICAgIHtvYnNlcnZlZExheWVyfVxuICAgICAgICAgICAge2V4cGVjdGVkTGF5ZXJ9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuIl19