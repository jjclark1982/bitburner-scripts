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
                    this.props.ns.print('Error parsing message ', msg, `: ${e}`);
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
        let job = this.jobs.get(jobID);
        if (job === undefined) {
            // Create new Job record with required fields
            job = {
                jobID: jobID,
                rowID: this.sequentialRowID++,
                endTime: (msg.startTime || 0) + (msg.duration || 0),
                ...msg
            };
        }
        else {
            // Merge updates into existing job record
            Object.assign(job, msg);
        }
        for (const field of ['startTime', 'duration']) {
            if (!job[field]) {
                throw new Error(`Missing required field '${field}': ${job[field]}`);
            }
        }
        for (const field of ['startTime', 'duration', 'endTime', 'startTimeActual', 'endTimeActual']) {
            if (typeof job[field] != 'number' || job[field] > this.validTimeRange()[1]) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmF0Y2gtdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9iYXRjaC12aWV3LnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBcUVFO0FBMENGLE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxLQUE4QixDQUFDO0FBY3hELHlCQUF5QjtBQUV6QixvR0FBb0c7QUFDcEcsd0RBQXdEO0FBQ3hELDBGQUEwRjtBQUMxRixJQUFJLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFZLENBQUM7QUFDM0M7Ozs7R0FJRztBQUNILFNBQVMsV0FBVyxDQUFDLENBQVMsRUFBRSxFQUFFLEdBQUMsUUFBUTtJQUN2QyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFnQixDQUFDO0FBQzVDLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxDQUFjO0lBQ2xDLE9BQU8sQ0FBQyxHQUFHLFlBQVksR0FBRyxhQUEyQixDQUFDO0FBQzFELENBQUM7QUFFRCxNQUFNLFlBQVksR0FBRztJQUNqQixJQUFJLEVBQUUsTUFBTTtJQUNaLElBQUksRUFBRSxZQUFZO0lBQ2xCLE1BQU0sRUFBRSxRQUFRO0lBQ2hCLE1BQU0sRUFBRSxTQUFTO0lBQ2pCLElBQUksRUFBRSxNQUFNO0lBQ1osTUFBTSxFQUFFLE1BQU07SUFDZCxRQUFRLEVBQUUsS0FBSztJQUNmLEtBQUssRUFBRSxNQUFNO0NBQ2hCLENBQUM7QUFFRixpR0FBaUc7QUFDakcsMEdBQTBHO0FBQzFHLHFGQUFxRjtBQUNyRixNQUFNLFlBQVksR0FBRyxHQUFpQixDQUFDO0FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEVBQWlCLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUcsR0FBYSxDQUFDO0FBQ3BDLE1BQU0sYUFBYSxHQUFHLEVBQVksQ0FBQztB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QUFlLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFDLEVBQUUsQ0FBQSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFnQixDQUFDO0lBQzFHLGVBQWUsR0FBRyxLQUFLLENBQUM7SUFDeEIsTUFBTSxZQUFZLEdBQUcsZUFBZSxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ3ZGLE1BQU0sYUFBYSxHQUFHLENBQ2xCLDJCQUFHLEVBQUUsRUFBQyxlQUFlLEVBQ2pCLFNBQVMsRUFBRSxlQUFlLGFBQWEsYUFBYSxDQUFDLGFBQWEsR0FBRyxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUMsR0FBRyxLQUFLLEdBQUcsRUFDckcsTUFBTSxFQUFFLFlBQVksQ0FBQyxLQUFLLEVBQzFCLElBQUksRUFBQyxNQUFNLEVBQ1gsV0FBVyxFQUFFLENBQUMsRUFDZCxjQUFjLEVBQUMsT0FBTztRQUV0Qiw4QkFBTSxDQUFDLEVBQUUsWUFBWSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxZQUFZLEVBQUMsb0JBQW9CLEdBQUcsQ0FDckUsQ0FDUCxDQUFDO0lBRUYsT0FBTyxDQUNILDJCQUFHLEVBQUUsRUFBQyxZQUFZLEVBQUMsU0FBUyxFQUFFLGVBQWUsYUFBYSxHQUFHLGFBQWEsR0FBRztRQUN4RSxhQUFhO1FBQ2IsYUFBYSxDQUNkLENBQ1AsQ0FBQztBQUNOLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuXG5Vc2FnZVxuLS0tLS1cblxuU3RhcnQgdGhlIGJhdGNoIHZpZXdlciBzY3JpcHQgZnJvbSB0aGUgY29tbWFuZCBsaW5lOlxuXG4gICAgcnVuIGJhdGNoLXZpZXcuanMgLS1wb3J0IDEwXG5cblRoZW4gc2VuZCBtZXNzYWdlcyB0byBpdCBmcm9tIG90aGVyIHNjcmlwdHMuXG5cbkV4YW1wbGU6IERpc3BsYXkgYWN0aW9uIHRpbWluZyAoaGFjayAvIGdyb3cgLyB3ZWFrZW4pXG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdHlwZTogJ2hhY2snLFxuICAgICAgICBqb2JJRDogMSxcbiAgICAgICAgc3RhcnRUaW1lOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICAgICAgZHVyYXRpb246IG5zLmdldEhhY2tUaW1lKHRhcmdldCksXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBVcGRhdGUgYW4gYWN0aW9uIHRoYXQgaGFzIGFscmVhZHkgYmVlbiBkaXNwbGF5ZWRcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBqb2JJRDogMSxcbiAgICAgICAgc3RhcnRUaW1lQWN0dWFsOiBwZXJmb3JtYW5jZS5ub3coKSxcbiAgICB9KSk7XG4gICAgYXdhaXQgbnMuaGFjayh0YXJnZXQpO1xuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBqb2JJRDogMSxcbiAgICAgICAgZW5kVGltZUFjdHVhbDogcGVyZm9ybWFuY2Uubm93KCksXG4gICAgfSkpO1xuXG5FeGFtcGxlOiBEaXNwbGF5IGEgYmxhbmsgcm93IGJldHdlZW4gYWN0aW9ucyAodG8gdmlzdWFsbHkgc2VwYXJhdGUgYmF0Y2hlcylcblxuICAgIG5zLndyaXRlUG9ydCgxMCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB0eXBlOiAnc3BhY2VyJyxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IERpc3BsYXkgb2JzZXJ2ZWQgc2VjdXJpdHkgLyBtb25leSBsZXZlbFxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdvYnNlcnZlZCcsXG4gICAgICAgIHRpbWU6IHBlcmZvcm1hbmNlLm5vdygpLFxuICAgICAgICBtaW5EaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJNaW5TZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIGhhY2tEaWZmaWN1bHR5OiBucy5nZXRTZXJ2ZXJTZWN1cml0eUxldmVsKHRhcmdldCksXG4gICAgICAgIG1vbmV5TWF4OiBucy5nZXRTZXJ2ZXJNYXhNb25leSh0YXJnZXQpLFxuICAgICAgICBtb25leUF2YWlsYWJsZTogbnMuZ2V0U2VydmVyTW9uZXlBdmFpbGFibGUodGFyZ2V0KSxcbiAgICB9KSk7XG5cbkV4YW1wbGU6IERpc3BsYXkgZXhwZWN0ZWQgc2VjdXJpdHkgLyBtb25leSBsZXZlbCAodmFyaWVzIGJ5IGFjdGlvbiB0eXBlIGFuZCB5b3VyIHN0cmF0ZWd5KVxuXG4gICAgbnMud3JpdGVQb3J0KDEwLCBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHR5cGU6ICdleHBlY3RlZCcsXG4gICAgICAgIHRpbWU6IGpvYi5zdGFydFRpbWUgKyBqb2IuZHVyYXRpb24sXG4gICAgICAgIG1pbkRpZmZpY3VsdHk6IG5zLmdldFNlcnZlck1pblNlY3VyaXR5TGV2ZWwodGFyZ2V0KSxcbiAgICAgICAgaGFja0RpZmZpY3VsdHk6IG5zLmdldFNlcnZlclNlY3VyaXR5TGV2ZWwodGFyZ2V0KSArIG5zLmhhY2tBbmFseXplU2VjdXJpdHkoam9iLnRocmVhZHMpLFxuICAgICAgICBtb25leU1heDogbnMuZ2V0U2VydmVyTWF4TW9uZXkodGFyZ2V0KSxcbiAgICAgICAgbW9uZXlBdmFpbGFibGU6IE1hdGgubWF4KDAsIG5zLmdldFNlcnZlck1heE1vbmV5KHRhcmdldCkgLSBucy5oYWNrQW5hbHl6ZSh0YXJnZXQpICogam9iLnRocmVhZHMgKiBucy5oYWNrQW5hbHl6ZUNoYW5jZSh0YXJnZXQpKSxcbiAgICB9KSk7XG5cbllvdSBjYW4gYWxzbyBzZW5kIGFuIGFycmF5IG9mIHN1Y2ggbWVzc2FnZXMgaW4gYSBzaW5nbGUgcG9ydCB3cml0ZS4gRm9yIGV4YW1wbGU6XG5cbiAgICBucy53cml0ZVBvcnQoMTAsIEpTT04uc3RyaW5naWZ5KFtcbiAgICAgICAge2pvYklEOiAnMS4xJywgdHlwZTogJ2hhY2snLCAgIC4uLn0sXG4gICAgICAgIHtqb2JJRDogJzEuMicsIHR5cGU6ICd3ZWFrZW4nLCAuLi59LFxuICAgICAgICB7am9iSUQ6ICcxLjMnLCB0eXBlOiAnZ3JvdycsICAgLi4ufSxcbiAgICAgICAge2pvYklEOiAnMS40JywgdHlwZTogJ3dlYWtlbicsIC4uLn0sXG4gICAgXSkpO1xuXG4qL1xuXG4vLyAtLS0tLSBQdWJsaWMgQVBJIFR5cGVzIC0tLS0tXG5cbnR5cGUgSm9iSUQgPSBhbnk7XG5pbnRlcmZhY2UgQWN0aW9uTWVzc2FnZSB7XG4gICAgdHlwZTogXCJoYWNrXCIgfCBcImdyb3dcIiB8IFwid2Vha2VuXCI7XG4gICAgam9iSUQ/OiBKb2JJRDtcbiAgICBkdXJhdGlvbjogVGltZU1zO1xuICAgIHN0YXJ0VGltZTogVGltZU1zO1xuICAgIHN0YXJ0VGltZUFjdHVhbD86IFRpbWVNcztcbiAgICBlbmRUaW1lPzogVGltZU1zO1xuICAgIGVuZFRpbWVBY3R1YWw/OiBUaW1lTXM7XG4gICAgY29sb3I/OiBzdHJpbmc7XG4gICAgcmVzdWx0PzogbnVtYmVyO1xufVxudHlwZSBVcGRhdGVNZXNzYWdlID0gUGFydGlhbDxBY3Rpb25NZXNzYWdlPiAmIHtcbiAgICBqb2JJRDogSm9iSUQ7XG59XG5pbnRlcmZhY2UgU3BhY2VyTWVzc2FnZSB7XG4gICAgdHlwZTogXCJzcGFjZXJcIlxufVxuaW50ZXJmYWNlIFNlcnZlck1lc3NhZ2Uge1xuICAgIHR5cGU6IFwiZXhwZWN0ZWRcIiB8IFwib2JzZXJ2ZWRcIjtcbiAgICB0aW1lOiBUaW1lTXM7XG4gICAgaGFja0RpZmZpY3VsdHk6IG51bWJlcjtcbiAgICBtaW5EaWZmaWN1bHR5OiBudW1iZXI7XG4gICAgbW9uZXlBdmFpbGFibGU6IG51bWJlcjtcbiAgICBtb25leU1heDogbnVtYmVyO1xufVxudHlwZSBFeHBlY3RlZFNlcnZlck1lc3NhZ2UgPSBTZXJ2ZXJNZXNzYWdlICYge1xuICAgIHR5cGU6IFwiZXhwZWN0ZWRcIlxufVxudHlwZSBPYnNlcnZlZFNlcnZlck1lc3NhZ2UgPSBTZXJ2ZXJNZXNzYWdlICYge1xuICAgIHR5cGU6IFwib2JzZXJ2ZWRcIlxufVxudHlwZSBCYXRjaFZpZXdNZXNzYWdlID0gQWN0aW9uTWVzc2FnZSB8IFVwZGF0ZU1lc3NhZ2UgfCBTcGFjZXJNZXNzYWdlIHwgRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlIHwgT2JzZXJ2ZWRTZXJ2ZXJNZXNzYWdlO1xuXG4vLyAtLS0tLSBJbnRlcm5hbCBUeXBlcyAtLS0tLVxuXG5pbXBvcnQgdHlwZSB7IE5TLCBOZXRzY3JpcHRQb3J0LCBTZXJ2ZXIgfSBmcm9tICdAbnMnO1xuaW1wb3J0IHR5cGUgUmVhY3ROYW1lc3BhY2UgZnJvbSAncmVhY3QvaW5kZXgnO1xuY29uc3QgUmVhY3QgPSBnbG9iYWxUaGlzLlJlYWN0IGFzIHR5cGVvZiBSZWFjdE5hbWVzcGFjZTtcblxuaW50ZXJmYWNlIEpvYiBleHRlbmRzIEFjdGlvbk1lc3NhZ2Uge1xuICAgIGpvYklEOiBKb2JJRDtcbiAgICByb3dJRDogbnVtYmVyO1xuICAgIGVuZFRpbWU6IFRpbWVNcztcbn1cblxudHlwZSBUaW1lTXMgPSBSZXR1cm5UeXBlPHR5cGVvZiBwZXJmb3JtYW5jZS5ub3c+ICYgeyBfX2RpbWVuc2lvbjogXCJ0aW1lXCIsIF9fdW5pdHM6IFwibWlsbGlzZWNvbmRzXCIgfTtcbnR5cGUgVGltZVNlY29uZHMgPSBudW1iZXIgJiB7IF9fZGltZW5zaW9uOiBcInRpbWVcIiwgX191bml0czogXCJzZWNvbmRzXCIgfTtcbnR5cGUgVGltZVBpeGVscyA9IG51bWJlciAmIHsgX19kaW1lbnNpb246IFwidGltZVwiLCBfX3VuaXRzOiBcInBpeGVsc1wiIH07XG50eXBlIFBpeGVscyA9IG51bWJlciAmIHsgX191bml0czogXCJwaXhlbHNcIiB9O1xudHlwZSBUaW1lVmFsdWUgPSBbVGltZU1zLCBudW1iZXJdO1xuXG4vLyAtLS0tLSBDb25zdGFudHMgLS0tLS0gXG5cbi8vIFRPRE86IGluaXRUaW1lIGlzIHVzZWQgYXMgdW5pcXVlIERPTSBJRCBhbmQgYXMgcmVuZGVyaW5nIG9yaWdpbiBidXQgaXQgaXMgcG9vcmx5IHN1aXRlZCBmb3IgYm90aC5cbi8vICBUaGUgc2NyaXB0IFBJRCB3b3VsZCB3b3JrIGJldHRlciBhcyBhIHVuaXF1ZSBET00gSUQuXG4vLyAgVGhlIFB1YmxpYyBBUEkgY291bGQgcmVxdWlyZSBwZXJmb3JtYW5jZS1lcG9jaCB0aW1lcywgd2hpY2ggd29uJ3QgbmVlZCB0byBiZSBhZGp1c3RlZC5cbmxldCBpbml0VGltZSA9IHBlcmZvcm1hbmNlLm5vdygpIGFzIFRpbWVNcztcbi8qKlxuICogQ29udmVydCB0aW1lc3RhbXBzIHRvIHNlY29uZHMgc2luY2UgdGhlIGdyYXBoIHdhcyBzdGFydGVkLlxuICogVG8gcmVuZGVyIFNWR3MgdXNpbmcgbmF0aXZlIHRpbWUgdW5pdHMsIHRoZSB2YWx1ZXMgbXVzdCBiZSB2YWxpZCAzMi1iaXQgaW50cy5cbiAqIFNvIHdlIGNvbnZlcnQgdG8gYSByZWNlbnQgZXBvY2ggaW4gY2FzZSBEYXRlLm5vdygpIHZhbHVlcyBhcmUgdXNlZC5cbiAqL1xuZnVuY3Rpb24gY29udmVydFRpbWUodDogVGltZU1zLCB0MD1pbml0VGltZSk6IFRpbWVTZWNvbmRzIHtcbiAgICByZXR1cm4gKCh0IC0gdDApIC8gMTAwMCkgYXMgVGltZVNlY29uZHM7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRTZWNUb1B4KHQ6IFRpbWVTZWNvbmRzKTogVGltZVBpeGVscyB7XG4gICAgcmV0dXJuIHQgKiBXSURUSF9QSVhFTFMgLyBXSURUSF9TRUNPTkRTIGFzIFRpbWVQaXhlbHM7XG59XG5cbmNvbnN0IEdSQVBIX0NPTE9SUyA9IHtcbiAgICBoYWNrOiBcImN5YW5cIixcbiAgICBncm93OiBcImxpZ2h0Z3JlZW5cIixcbiAgICB3ZWFrZW46IFwieWVsbG93XCIsXG4gICAgZGVzeW5jOiBcIm1hZ2VudGFcIixcbiAgICBzYWZlOiBcIiMxMTFcIixcbiAgICB1bnNhZmU6IFwiIzMzM1wiLFxuICAgIHNlY3VyaXR5OiBcInJlZFwiLFxuICAgIG1vbmV5OiBcImJsdWVcIlxufTtcblxuLy8gVE9ETzogdXNlIGEgY29udGV4dCBmb3IgdGhlc2Ugc2NhbGUgZmFjdG9ycy4gc3VwcG9ydCBzZXR0aW5nIHRoZW0gYnkgYXJncyBhbmQgc2Nyb2xsLWdlc3R1cmVzLlxuLy8gY29uc3QgU2NyZWVuQ29udGV4dCA9IFJlYWN0LmNyZWF0ZUNvbnRleHQoe1dJRFRIX1BJWEVMUywgV0lEVEhfU0VDT05EUywgSEVJR0hUX1BJWEVMUywgRk9PVEVSX1BJWEVMU30pO1xuLy8gVE9ETzogcmV2aWV3IHVzZSBvZiA2MDAwMDAsIDYwMDAwLCAxMDAwLCAxMCwgYW5kIFdJRFRIX1NFQ09ORFMgYXMgY2xpcHBpbmcgbGltaXRzLlxuY29uc3QgV0lEVEhfUElYRUxTID0gODAwIGFzIFRpbWVQaXhlbHM7XG5jb25zdCBXSURUSF9TRUNPTkRTID0gMTYgYXMgVGltZVNlY29uZHM7XG5jb25zdCBIRUlHSFRfUElYRUxTID0gNjAwIGFzIFBpeGVscztcbmNvbnN0IEZPT1RFUl9QSVhFTFMgPSA1MCBhcyBQaXhlbHM7XG5cblxuLy8gLS0tLS0gTWFpbiBQcm9ncmFtIC0tLS0tXG5cbmNvbnN0IEZMQUdTOiBbc3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgc3RyaW5nW11dW10gPSBbXG4gICAgW1wiaGVscFwiLCBmYWxzZV0sXG4gICAgW1wicG9ydFwiLCAwXSxcbiAgICBbXCJkZWJ1Z1wiLCBmYWxzZV0sXG5dO1xuXG5leHBvcnQgZnVuY3Rpb24gYXV0b2NvbXBsZXRlKGRhdGE6IGFueSwgYXJnczogc3RyaW5nW10pIHtcbiAgICBkYXRhLmZsYWdzKEZMQUdTKTtcbiAgICByZXR1cm4gW107XG59XG5cbi8qKiBAcGFyYW0ge05TfSBucyAqKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYWluKG5zOiBOUykge1xuICAgIG5zLmRpc2FibGVMb2coJ3NsZWVwJyk7XG4gICAgbnMuZGlzYWJsZUxvZygnYXNsZWVwJyk7XG4gICAgbnMuY2xlYXJMb2coKTtcbiAgICBucy50YWlsKCk7XG4gICAgbnMucmVzaXplVGFpbCg4MTAsIDY0MCk7XG5cbiAgICBjb25zdCBmbGFncyA9IG5zLmZsYWdzKEZMQUdTKTtcbiAgICBpZiAoZmxhZ3MuaGVscCkge1xuICAgICAgICBucy50cHJpbnQoW1xuICAgICAgICAgICAgYFVTQUdFYCxcbiAgICAgICAgICAgIGA+IHJ1biAke25zLmdldFNjcmlwdE5hbWUoKX0gLS1wb3J0IDEwYCxcbiAgICAgICAgICAgICcgJ1xuICAgICAgICBdLmpvaW4oXCJcXG5cIikpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHBvcnROdW0gPSBmbGFncy5wb3J0IGFzIG51bWJlciB8fCBucy5waWQ7XG4gICAgY29uc3QgZGVidWcgPSBmbGFncy5kZWJ1ZyBhcyBib29sZWFuO1xuXG4gICAgY29uc3QgYmF0Y2hWaWV3ID0gPEJhdGNoVmlldyBucz17bnN9IHBvcnROdW09e3BvcnROdW19IGRlYnVnPXtkZWJ1Z30gLz47XG4gICAgbnMucHJpbnQoYExpc3RlbmluZyBvbiBQb3J0ICR7cG9ydE51bX1gKTtcbiAgICBucy5wcmludFJhdyhiYXRjaFZpZXcpO1xuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgYXdhaXQgbnMuYXNsZWVwKDYwKjEwMDApO1xuICAgIH1cbn1cblxuLy8gLS0tLS0gQmF0Y2hWaWV3IENvbXBvbmVudCAtLS0tLVxuXG5pbnRlcmZhY2UgQmF0Y2hWaWV3UHJvcHMge1xuICAgIG5zOiBOUztcbiAgICBwb3J0TnVtOiBudW1iZXI7XG4gICAgZGVidWc/OiBib29sZWFuO1xufVxuaW50ZXJmYWNlIEJhdGNoVmlld1N0YXRlIHtcbiAgICBydW5uaW5nOiBib29sZWFuO1xuICAgIG5vdzogVGltZU1zO1xuICAgIGRhdGFVcGRhdGVzOiBudW1iZXI7XG59XG5leHBvcnQgY2xhc3MgQmF0Y2hWaWV3IGV4dGVuZHMgUmVhY3QuQ29tcG9uZW50PEJhdGNoVmlld1Byb3BzLCBCYXRjaFZpZXdTdGF0ZT4ge1xuICAgIHBvcnQ6IE5ldHNjcmlwdFBvcnQ7XG4gICAgam9iczogTWFwPEpvYklELCBKb2I+O1xuICAgIHNlcXVlbnRpYWxSb3dJRDogbnVtYmVyID0gMDtcbiAgICBzZXF1ZW50aWFsSm9iSUQ6IG51bWJlciA9IDA7XG4gICAgZXhwZWN0ZWRTZXJ2ZXJzOiBFeHBlY3RlZFNlcnZlck1lc3NhZ2VbXTtcbiAgICBvYnNlcnZlZFNlcnZlcnM6IE9ic2VydmVkU2VydmVyTWVzc2FnZVtdO1xuXG4gICAgY29uc3RydWN0b3IocHJvcHM6IEJhdGNoVmlld1Byb3BzKXtcbiAgICAgICAgc3VwZXIocHJvcHMpO1xuICAgICAgICBjb25zdCB7IG5zLCBwb3J0TnVtLCBkZWJ1ZyB9ID0gcHJvcHM7XG4gICAgICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICAgICAgICBydW5uaW5nOiB0cnVlLFxuICAgICAgICAgICAgbm93OiBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXMsXG4gICAgICAgICAgICBkYXRhVXBkYXRlczogMCxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5wb3J0ID0gbnMuZ2V0UG9ydEhhbmRsZShwb3J0TnVtKTtcbiAgICAgICAgdGhpcy5qb2JzID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLmV4cGVjdGVkU2VydmVycyA9IFtdO1xuICAgICAgICB0aGlzLm9ic2VydmVkU2VydmVycyA9IFtdO1xuICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oZ2xvYmFsVGhpcywge2JhdGNoVmlldzogdGhpc30pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29tcG9uZW50RGlkTW91bnQoKSB7XG4gICAgICAgIGNvbnN0IHsgbnMsIHBvcnROdW0gfSA9IHRoaXMucHJvcHM7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe3J1bm5pbmc6IHRydWV9KTtcbiAgICAgICAgbnMuYXRFeGl0KCgpPT57XG4gICAgICAgICAgICB0aGlzLnNldFN0YXRlKHtydW5uaW5nOiBmYWxzZX0pO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5hbmltYXRlKCk7XG4gICAgICAgIHRoaXMucmVhZFBvcnQoKTtcbiAgICB9XG5cbiAgICBjb21wb25lbnRXaWxsVW5tb3VudCgpIHtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7cnVubmluZzogZmFsc2V9KTtcbiAgICB9XG5cbiAgICBhbmltYXRlID0gKCk9PntcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlLnJ1bm5pbmcpIHJldHVybjtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7bm93OiBwZXJmb3JtYW5jZS5ub3coKSBhcyBUaW1lTXN9KTtcbiAgICAgICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0ZSk7XG4gICAgfVxuXG4gICAgcmVhZFBvcnQgPSAoKT0+e1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUucnVubmluZykgcmV0dXJuO1xuICAgICAgICB3aGlsZSghdGhpcy5wb3J0LmVtcHR5KCkpIHtcbiAgICAgICAgICAgIGxldCBtc2dzOiBCYXRjaFZpZXdNZXNzYWdlIHwgQmF0Y2hWaWV3TWVzc2FnZVtdID0gSlNPTi5wYXJzZSh0aGlzLnBvcnQucmVhZCgpIGFzIHN0cmluZyk7XG4gICAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkobXNncykpIHtcbiAgICAgICAgICAgICAgICBtc2dzID0gW21zZ3NdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yIChjb25zdCBtc2cgb2YgbXNncykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVjZWl2ZU1lc3NhZ2UobXNnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9wcy5ucy5wcmludCgnRXJyb3IgcGFyc2luZyBtZXNzYWdlICcsIG1zZywgYDogJHtlfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLnBvcnQubmV4dFdyaXRlKCkudGhlbih0aGlzLnJlYWRQb3J0KTtcbiAgICB9XG5cbiAgICByZWNlaXZlTWVzc2FnZShtc2c6IEJhdGNoVmlld01lc3NhZ2UpIHtcbiAgICAgICAgaWYgKG1zZy50eXBlID09IFwic3BhY2VyXCIpIHtcbiAgICAgICAgICAgIHRoaXMuc2VxdWVudGlhbFJvd0lEICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAobXNnLnR5cGUgPT0gXCJleHBlY3RlZFwiKSB7XG4gICAgICAgICAgICB0aGlzLmV4cGVjdGVkU2VydmVycy5wdXNoKG1zZyk7XG4gICAgICAgICAgICB0aGlzLmV4cGVjdGVkU2VydmVycyA9IHRoaXMuY2xlYW5TZXJ2ZXJzKHRoaXMuZXhwZWN0ZWRTZXJ2ZXJzKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChtc2cudHlwZSA9PSBcIm9ic2VydmVkXCIpIHtcbiAgICAgICAgICAgIHRoaXMub2JzZXJ2ZWRTZXJ2ZXJzLnB1c2gobXNnKTtcbiAgICAgICAgICAgIHRoaXMub2JzZXJ2ZWRTZXJ2ZXJzID0gdGhpcy5jbGVhblNlcnZlcnModGhpcy5vYnNlcnZlZFNlcnZlcnMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKG1zZy5qb2JJRCAhPT0gdW5kZWZpbmVkIHx8IG1zZy50eXBlID09ICdoYWNrJyB8fCBtc2cudHlwZSA9PSAnZ3JvdycgfHwgbXNnLnR5cGUgPT0gJ3dlYWtlbicpIHtcbiAgICAgICAgICAgIHRoaXMuYWRkSm9iKG1zZyk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVucmVjb2duaXplZCBtZXNzYWdlIHR5cGU6ICR7bXNnLnR5cGV9OmApO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe2RhdGFVcGRhdGVzOiB0aGlzLnN0YXRlLmRhdGFVcGRhdGVzICsgMX0pO1xuICAgIH1cblxuICAgIGFkZEpvYihtc2c6IEFjdGlvbk1lc3NhZ2UgfCBVcGRhdGVNZXNzYWdlKSB7XG4gICAgICAgIC8vIEFzc2lnbiBzZXF1ZW50aWFsIElEIGlmIG5lZWRlZFxuICAgICAgICBsZXQgam9iSUQgPSBtc2cuam9iSUQ7XG4gICAgICAgIGlmIChqb2JJRCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB3aGlsZSAodGhpcy5qb2JzLmhhcyh0aGlzLnNlcXVlbnRpYWxKb2JJRCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNlcXVlbnRpYWxKb2JJRCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgam9iSUQgPSB0aGlzLnNlcXVlbnRpYWxKb2JJRDtcbiAgICAgICAgfVxuICAgICAgICBsZXQgam9iID0gdGhpcy5qb2JzLmdldChqb2JJRCk7XG4gICAgICAgIGlmIChqb2IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgLy8gQ3JlYXRlIG5ldyBKb2IgcmVjb3JkIHdpdGggcmVxdWlyZWQgZmllbGRzXG4gICAgICAgICAgICBqb2IgPSB7XG4gICAgICAgICAgICAgICAgam9iSUQ6IGpvYklELFxuICAgICAgICAgICAgICAgIHJvd0lEOiB0aGlzLnNlcXVlbnRpYWxSb3dJRCsrLFxuICAgICAgICAgICAgICAgIGVuZFRpbWU6IChtc2cuc3RhcnRUaW1lfHwwKSArIChtc2cuZHVyYXRpb258fDApIGFzIFRpbWVNcyxcbiAgICAgICAgICAgICAgICAuLi4obXNnIGFzIEFjdGlvbk1lc3NhZ2UpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gTWVyZ2UgdXBkYXRlcyBpbnRvIGV4aXN0aW5nIGpvYiByZWNvcmRcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oam9iLCBtc2cpO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZmllbGQgb2YgWydzdGFydFRpbWUnLCAnZHVyYXRpb24nXSBhcyBjb25zdCkge1xuICAgICAgICAgICAgaWYgKCFqb2JbZmllbGRdKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHJlcXVpcmVkIGZpZWxkICcke2ZpZWxkfSc6ICR7am9iW2ZpZWxkXX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IGZpZWxkIG9mIFsnc3RhcnRUaW1lJywgJ2R1cmF0aW9uJywgJ2VuZFRpbWUnLCAnc3RhcnRUaW1lQWN0dWFsJywgJ2VuZFRpbWVBY3R1YWwnXSBhcyBjb25zdCkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBqb2JbZmllbGRdICE9ICdudW1iZXInIHx8IGpvYltmaWVsZF0gYXMgbnVtYmVyID4gdGhpcy52YWxpZFRpbWVSYW5nZSgpWzFdKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHZhbHVlIGZvciAnJHtmaWVsZH0nOiAke2pvYltmaWVsZF19LiBFeHBlY3RlZCBhIHZhbHVlIGZyb20gcGVyZm9ybWFuY2Uubm93KCkuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5qb2JzLnNldChqb2JJRCwgam9iKTtcbiAgICAgICAgdGhpcy5jbGVhbkpvYnMoKTtcbiAgICB9XG5cbiAgICB2YWxpZFRpbWVSYW5nZSgpIHtcbiAgICAgICAgLy8gdXAgdG8gMiBzY3JlZW5zIGluIHRoZSBwYXN0XG4gICAgICAgIC8vIHVwIHRvIDMwIGRheXMgaW4gdGhlIGZ1dHVyZVxuICAgICAgICByZXR1cm4gW3RoaXMuc3RhdGUubm93LShXSURUSF9TRUNPTkRTKjIqMTAwMCksIDEwMDAqNjAqNjAqMjQqMzBdO1xuICAgIH1cblxuICAgIGNsZWFuSm9icygpIHtcbiAgICAgICAgY29uc3QgW2VhcmxpZXN0VGltZSwgbGF0ZXN0VGltZV0gPSB0aGlzLnZhbGlkVGltZVJhbmdlKCk7XG4gICAgICAgIC8vIEZpbHRlciBvdXQgZXhwaXJlZCBqb2JzIChlbmRUaW1lIG1vcmUgdGhhbiAyIHNjcmVlbnMgaW4gdGhlIHBhc3QpXG4gICAgICAgIGlmICh0aGlzLmpvYnMuc2l6ZSA+IDIwMCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBqb2JJRCBvZiB0aGlzLmpvYnMudmFsdWVzKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBqb2IgPSB0aGlzLmpvYnMuZ2V0KGpvYklEKSBhcyBKb2I7XG4gICAgICAgICAgICAgICAgaWYgKCEoam9iLmVuZFRpbWUgPiBlYXJsaWVzdFRpbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuam9icy5kZWxldGUoam9iSUQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNsZWFuU2VydmVyczxUIGV4dGVuZHMgU2VydmVyTWVzc2FnZT4oc2VydmVyczogVFtdKTogVFtdIHtcbiAgICAgICAgY29uc3QgW2VhcmxpZXN0VGltZSwgbGF0ZXN0VGltZV0gPSB0aGlzLnZhbGlkVGltZVJhbmdlKCk7XG4gICAgICAgIC8vIFRPRE86IGluc2VydCBpdGVtIGludG8gc29ydGVkIGxpc3QgaW5zdGVhZCBvZiByZS1zb3J0aW5nIGVhY2ggdGltZVxuICAgICAgICByZXR1cm4gc2VydmVycy5maWx0ZXIoKHMpPT5zLnRpbWUgPiBlYXJsaWVzdFRpbWUpLnNvcnQoKGEsYik9PmEudGltZSAtIGIudGltZSk7XG4gICAgfVxuXG4gICAgcmVuZGVyKCkge1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgPEdyYXBoRnJhbWUgbm93PXt0aGlzLnN0YXRlLm5vd30+XG4gICAgICAgICAgICAgICAgPFNhZmV0eUxheWVyIGV4cGVjdGVkU2VydmVycz17dGhpcy5leHBlY3RlZFNlcnZlcnN9IC8+XG4gICAgICAgICAgICAgICAgPEpvYkxheWVyIGpvYnM9e1suLi50aGlzLmpvYnMudmFsdWVzKCldfSAvPlxuICAgICAgICAgICAgICAgIDxTZWN1cml0eUxheWVyIGV4cGVjdGVkU2VydmVycz17dGhpcy5leHBlY3RlZFNlcnZlcnN9IG9ic2VydmVkU2VydmVycz17dGhpcy5vYnNlcnZlZFNlcnZlcnN9IC8+XG4gICAgICAgICAgICAgICAgPE1vbmV5TGF5ZXIgZXhwZWN0ZWRTZXJ2ZXJzPXt0aGlzLmV4cGVjdGVkU2VydmVyc30gb2JzZXJ2ZWRTZXJ2ZXJzPXt0aGlzLm9ic2VydmVkU2VydmVyc30gLz5cbiAgICAgICAgICAgIDwvR3JhcGhGcmFtZT5cbiAgICAgICAgKVxuICAgIH1cbn1cblxuZnVuY3Rpb24gR3JhcGhGcmFtZSh7bm93LCBjaGlsZHJlbn06e25vdzpUaW1lTXMsIGNoaWxkcmVuOiBSZWFjdC5SZWFjdE5vZGV9KTogUmVhY3QuUmVhY3RFbGVtZW50IHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8c3ZnIHZlcnNpb249XCIxLjFcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCJcbiAgICAgICAgICAgIHdpZHRoPXtXSURUSF9QSVhFTFN9XG4gICAgICAgICAgICBoZWlnaHQ9e0hFSUdIVF9QSVhFTFN9IFxuICAgICAgICAgICAgLy8gU2V0IHRoZSB2aWV3Qm94IGZvciAxMCBzZWNvbmRzIG9mIGhpc3RvcnksIDYgc2Vjb25kcyBvZiBmdXR1cmUuXG4gICAgICAgICAgICB2aWV3Qm94PXtgJHtjb252ZXJ0U2VjVG9QeCgtMTAgYXMgVGltZVNlY29uZHMpfSAwICR7V0lEVEhfUElYRUxTfSAke0hFSUdIVF9QSVhFTFN9YH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGRlZnM+XG4gICAgICAgICAgICAgICAgPGNsaXBQYXRoIGlkPXtgaGlkZS1mdXR1cmUtJHtpbml0VGltZX1gfSBjbGlwUGF0aFVuaXRzPVwidXNlclNwYWNlT25Vc2VcIj5cbiAgICAgICAgICAgICAgICAgICAgPHJlY3QgaWQ9XCJoaWRlLWZ1dHVyZS1yZWN0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKG5vdy02MDAwMCBhcyBUaW1lTXMpfSB3aWR0aD17Y29udmVydFRpbWUoNjAwMDAgYXMgVGltZU1zLCAwIGFzIFRpbWVNcyl9XG4gICAgICAgICAgICAgICAgICAgICAgICB5PXswfSBoZWlnaHQ9ezUwfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvY2xpcFBhdGg+XG4gICAgICAgICAgICA8L2RlZnM+XG4gICAgICAgICAgICA8cmVjdCBpZD1cImJhY2tncm91bmRcIiB4PXtjb252ZXJ0U2VjVG9QeCgtMTAgYXMgVGltZVNlY29uZHMpfSB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCIgZmlsbD17R1JBUEhfQ09MT1JTLnNhZmV9IC8+XG4gICAgICAgICAgICA8ZyBpZD1cInRpbWVDb29yZGluYXRlc1wiIHRyYW5zZm9ybT17YHNjYWxlKCR7V0lEVEhfUElYRUxTIC8gV0lEVEhfU0VDT05EU30gMSkgdHJhbnNsYXRlKCR7Y29udmVydFRpbWUoaW5pdFRpbWUtbm93IGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfSAwKWB9PlxuICAgICAgICAgICAgICAgIHtjaGlsZHJlbn1cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAvLyBbXCJyZWN0XCIsIHtpZDpcImRpdmlkZXItMVwiLCB4OmNvbnZlcnRTZWNUb1B4KC0xMCksIHdpZHRoOlwiMTAwJVwiLCB5OkhFSUdIVF9QSVhFTFMtRk9PVEVSX1BJWEVMUywgaGVpZ2h0OjEsIGZpbGw6IFwid2hpdGVcIn1dLFxuICAgICAgICAgICAgICAgIC8vIFtcInJlY3RcIiwge2lkOlwiZGl2aWRlci0yXCIsIHg6Y29udmVydFNlY1RvUHgoLTEwKSwgd2lkdGg6XCIxMDAlXCIsIHk6SEVJR0hUX1BJWEVMUy0yKkZPT1RFUl9QSVhFTFMsIGhlaWdodDoxLCBmaWxsOiBcIndoaXRlXCJ9XSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIDxyZWN0IGlkPVwiY3Vyc29yXCIgeD17MH0gd2lkdGg9ezF9IHk9ezB9IGhlaWdodD1cIjEwMCVcIiBmaWxsPVwid2hpdGVcIiAvPlxuICAgICAgICAgICAgPEdyYXBoTGVnZW5kIC8+XG4gICAgICAgIDwvc3ZnPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEdyYXBoTGVnZW5kKCk6IFJlYWN0LlJlYWN0RWxlbWVudCB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJMZWdlbmRcIiB0cmFuc2Zvcm09XCJ0cmFuc2xhdGUoLTQ5MCwgMTApLCBzY2FsZSguNSwgLjUpXCI+XG4gICAgICAgICAgICA8cmVjdCB4PXsxfSB5PXsxfSB3aWR0aD17Mjc1fSBoZWlnaHQ9ezM5Mn0gZmlsbD1cImJsYWNrXCIgc3Ryb2tlPVwiIzk3OTc5N1wiIC8+XG4gICAgICAgICAgICB7T2JqZWN0LmVudHJpZXMoR1JBUEhfQ09MT1JTKS5tYXAoKFtsYWJlbCwgY29sb3JdLCBpKT0+KFxuICAgICAgICAgICAgICAgIDxnIGtleT17bGFiZWx9IHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgyMiwgJHsxMyArIDQxKml9KWB9PlxuICAgICAgICAgICAgICAgICAgICA8cmVjdCB4PXswfSB5PXswfSB3aWR0aD17MjJ9IGhlaWdodD17MjJ9IGZpbGw9e2NvbG9yfSAvPlxuICAgICAgICAgICAgICAgICAgICA8dGV4dCBmb250RmFtaWx5PVwiQ291cmllciBOZXdcIiBmb250U2l6ZT17MzZ9IGZpbGw9XCIjODg4XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dHNwYW4geD17NDIuNX0geT17MzB9PntsYWJlbC5zdWJzdHJpbmcoMCwxKS50b1VwcGVyQ2FzZSgpK2xhYmVsLnN1YnN0cmluZygxKX08L3RzcGFuPlxuICAgICAgICAgICAgICAgICAgICA8L3RleHQ+XG4gICAgICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBTYWZldHlMYXllcih7ZXhwZWN0ZWRTZXJ2ZXJzfToge2V4cGVjdGVkU2VydmVyczogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlW119KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBsZXQgcHJldlNlcnZlcjogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlIHwgdW5kZWZpbmVkO1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwic2FmZXR5TGF5ZXJcIj5cbiAgICAgICAgICAgIHtleHBlY3RlZFNlcnZlcnMubWFwKChzZXJ2ZXIsIGkpPT57XG4gICAgICAgICAgICAgICAgbGV0IGVsID0gbnVsbDtcbiAgICAgICAgICAgICAgICAvLyBzaGFkZSB0aGUgYmFja2dyb3VuZCBiYXNlZCBvbiBzZWNMZXZlbFxuICAgICAgICAgICAgICAgIGlmIChwcmV2U2VydmVyICYmIHNlcnZlci50aW1lID4gcHJldlNlcnZlci50aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGVsID0gKDxyZWN0IGtleT17aX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHByZXZTZXJ2ZXIudGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZShzZXJ2ZXIudGltZSAtIHByZXZTZXJ2ZXIudGltZSBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHk9ezB9IGhlaWdodD1cIjEwMCVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsbD17KHByZXZTZXJ2ZXIuaGFja0RpZmZpY3VsdHkgPiBwcmV2U2VydmVyLm1pbkRpZmZpY3VsdHkpID8gR1JBUEhfQ09MT1JTLnVuc2FmZSA6IEdSQVBIX0NPTE9SUy5zYWZlfVxuICAgICAgICAgICAgICAgICAgICAvPik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHByZXZTZXJ2ZXIgPSBzZXJ2ZXI7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGVsO1xuICAgICAgICAgICAgfSl9XG4gICAgICAgICAgICB7cHJldlNlcnZlciAmJiAoXG4gICAgICAgICAgICAgICAgPHJlY3Qga2V5PVwicmVtYWluZGVyXCJcbiAgICAgICAgICAgICAgICAgICAgeD17Y29udmVydFRpbWUocHJldlNlcnZlci50aW1lKX0gd2lkdGg9e2NvbnZlcnRUaW1lKDYwMDAwMCBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgICAgICAgICAgeT17MH0gaGVpZ2h0PVwiMTAwJVwiXG4gICAgICAgICAgICAgICAgICAgIGZpbGw9eyhwcmV2U2VydmVyLmhhY2tEaWZmaWN1bHR5ID4gcHJldlNlcnZlci5taW5EaWZmaWN1bHR5KSA/IEdSQVBIX0NPTE9SUy51bnNhZmUgOiBHUkFQSF9DT0xPUlMuc2FmZX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIEpvYkxheWVyKHtqb2JzfToge2pvYnM6IEpvYltdfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwiam9iTGF5ZXJcIj5cbiAgICAgICAgICAgIHtqb2JzLm1hcCgoam9iOiBKb2IpPT4oPEpvYkJhciBqb2I9e2pvYn0ga2V5PXtqb2Iuam9iSUR9IC8+KSl9XG4gICAgICAgIDwvZz5cbiAgICApO1xufVxuXG5mdW5jdGlvbiBKb2JCYXIoe2pvYn06IHtqb2I6IEpvYn0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGNvbnN0IHkgPSAoKGpvYi5yb3dJRCArIDEpICUgKChIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMUyoyKSAvIDQpKSAqIDQ7XG4gICAgbGV0IGpvYkJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5zdGFydFRpbWUgJiYgam9iLmR1cmF0aW9uKSB7XG4gICAgICAgIGpvYkJhciA9ICg8cmVjdFxuICAgICAgICAgICAgeD17Y29udmVydFRpbWUoam9iLnN0YXJ0VGltZSl9IHdpZHRoPXtjb252ZXJ0VGltZShqb2IuZHVyYXRpb24sIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17Mn1cbiAgICAgICAgICAgIGZpbGw9e2pvYi5jb2xvciA/PyBHUkFQSF9DT0xPUlNbam9iLnR5cGVdfVxuICAgICAgICAvPilcbiAgICB9O1xuICAgIGxldCBzdGFydEVycm9yQmFyID0gbnVsbDtcbiAgICBpZiAoam9iLnN0YXJ0VGltZUFjdHVhbCkge1xuICAgICAgICBjb25zdCBbdDEsIHQyXSA9IFtqb2Iuc3RhcnRUaW1lLCBqb2Iuc3RhcnRUaW1lQWN0dWFsXS5zb3J0KChhLGIpPT5hLWIpO1xuICAgICAgICBzdGFydEVycm9yQmFyID0gKDxyZWN0XG4gICAgICAgICAgICB4PXtjb252ZXJ0VGltZSh0MSl9IHdpZHRoPXtjb252ZXJ0VGltZSh0Mi10MSBhcyBUaW1lTXMsIDAgYXMgVGltZU1zKX1cbiAgICAgICAgICAgIHk9ezB9IGhlaWdodD17MX1cbiAgICAgICAgICAgIGZpbGw9e0dSQVBIX0NPTE9SUy5kZXN5bmN9XG4gICAgICAgICAvPik7XG4gICAgfVxuICAgIGxldCBlbmRFcnJvckJhciA9IG51bGw7XG4gICAgaWYgKGpvYi5lbmRUaW1lQWN0dWFsKSB7XG4gICAgICAgIGNvbnN0IFt0MSwgdDJdID0gW2pvYi5lbmRUaW1lLCBqb2IuZW5kVGltZUFjdHVhbF0uc29ydCgoYSxiKT0+YS1iKTtcbiAgICAgICAgZW5kRXJyb3JCYXIgPSAoPHJlY3RcbiAgICAgICAgICAgIHg9e2NvbnZlcnRUaW1lKHQxKX0gd2lkdGg9e2NvbnZlcnRUaW1lKHQyLXQxIGFzIFRpbWVNcywgMCBhcyBUaW1lTXMpfVxuICAgICAgICAgICAgeT17MH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgZmlsbD17R1JBUEhfQ09MT1JTLmRlc3luY31cbiAgICAgICAgIC8+KTtcbiAgICB9XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHt5fSlgfT5cbiAgICAgICAgICAgIHtqb2JCYXJ9XG4gICAgICAgICAgICB7c3RhcnRFcnJvckJhcn1cbiAgICAgICAgICAgIHtlbmRFcnJvckJhcn1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmludGVyZmFjZSBTZWN1cml0eUxheWVyUHJvcHMge1xuICAgIGV4cGVjdGVkU2VydmVyczogRXhwZWN0ZWRTZXJ2ZXJNZXNzYWdlW107XG4gICAgb2JzZXJ2ZWRTZXJ2ZXJzOiBPYnNlcnZlZFNlcnZlck1lc3NhZ2VbXVxufVxuZnVuY3Rpb24gU2VjdXJpdHlMYXllcih7ZXhwZWN0ZWRTZXJ2ZXJzLCBvYnNlcnZlZFNlcnZlcnN9OlNlY3VyaXR5TGF5ZXJQcm9wcyk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgZXhwZWN0ZWRTZXJ2ZXJzID8/PSBbXTtcbiAgICBvYnNlcnZlZFNlcnZlcnMgPz89IFtdO1xuICAgIGxldCBtaW5TZWMgPSAwO1xuICAgIGxldCBtYXhTZWMgPSAxO1xuICAgIGZvciAoY29uc3Qgc25hcHNob3RzIG9mIFtleHBlY3RlZFNlcnZlcnMsIG9ic2VydmVkU2VydmVyc10pIHtcbiAgICAgICAgZm9yIChjb25zdCBzZXJ2ZXIgb2Ygc25hcHNob3RzKSB7XG4gICAgICAgICAgICBtaW5TZWMgPSBNYXRoLm1pbihtaW5TZWMsIHNlcnZlci5oYWNrRGlmZmljdWx0eSk7XG4gICAgICAgICAgICBtYXhTZWMgPSBNYXRoLm1heChtYXhTZWMsIHNlcnZlci5oYWNrRGlmZmljdWx0eSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBvYnNlcnZlZEV2ZW50cyA9IG9ic2VydmVkU2VydmVycy5tYXAoKHNlcnZlcik9PltzZXJ2ZXIudGltZSwgc2VydmVyLmhhY2tEaWZmaWN1bHR5XSkgYXMgVGltZVZhbHVlW107XG4gICAgY29uc3Qgc2hvdWxkQ2xvc2VQYXRoID0gdHJ1ZTtcbiAgICBjb25zdCBvYnNlcnZlZFBhdGggPSBjb21wdXRlUGF0aERhdGEob2JzZXJ2ZWRFdmVudHMsIG1pblNlYywgc2hvdWxkQ2xvc2VQYXRoKTtcbiAgICBjb25zdCBvYnNlcnZlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cIm9ic2VydmVkU2VjXCJcbiAgICAgICAgICAgIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhTZWMgLSBtaW5TZWMpfSlgfVxuICAgICAgICAgICAgZmlsbD17XCJkYXJrXCIrR1JBUEhfQ09MT1JTLnNlY3VyaXR5fVxuICAgICAgICAgICAgLy8gZmlsbE9wYWNpdHk6IDAuNSxcbiAgICAgICAgICAgIGNsaXBQYXRoPXtgdXJsKCNoaWRlLWZ1dHVyZS0ke2luaXRUaW1lfSlgfVxuICAgICAgICA+XG4gICAgICAgICAgICA8cGF0aCBkPXtvYnNlcnZlZFBhdGguam9pbihcIiBcIil9IC8+XG4gICAgICAgIDwvZz5cbiAgICApO1xuXG4gICAgY29uc3QgZXhwZWN0ZWRFdmVudHMgPSBleHBlY3RlZFNlcnZlcnMubWFwKChzZXJ2ZXIpPT5bc2VydmVyLnRpbWUsIHNlcnZlci5oYWNrRGlmZmljdWx0eV0pIGFzIFRpbWVWYWx1ZVtdO1xuICAgIGNvbnN0IGV4cGVjdGVkUGF0aCA9IGNvbXB1dGVQYXRoRGF0YShleHBlY3RlZEV2ZW50cyk7XG4gICAgY29uc3QgZXhwZWN0ZWRMYXllciA9IChcbiAgICAgICAgPGcgaWQ9XCJleHBlY3RlZFNlY1wiXG4gICAgICAgICAgICB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0ZPT1RFUl9QSVhFTFN9KSBzY2FsZSgxICR7LUZPT1RFUl9QSVhFTFMgLyAobWF4U2VjIC0gbWluU2VjKX0pYH1cbiAgICAgICAgICAgIHN0cm9rZT17R1JBUEhfQ09MT1JTLnNlY3VyaXR5fVxuICAgICAgICAgICAgZmlsbD1cIm5vbmVcIlxuICAgICAgICAgICAgc3Ryb2tlV2lkdGg9ezJ9XG4gICAgICAgICAgICBzdHJva2VMaW5lam9pbj1cImJldmVsXCJcbiAgICAgICAgPlxuICAgICAgICAgICAgPHBhdGggZD17ZXhwZWN0ZWRQYXRoLmpvaW4oXCIgXCIpfSB2ZWN0b3JFZmZlY3Q9XCJub24tc2NhbGluZy1zdHJva2VcIiAvPlxuICAgICAgICA8L2c+XG4gICAgKTtcblxuICAgIHJldHVybiAoXG4gICAgICAgIDxnIGlkPVwic2VjTGF5ZXJcIiB0cmFuc2Zvcm09e2B0cmFuc2xhdGUoMCAke0hFSUdIVF9QSVhFTFMgLSAyKkZPT1RFUl9QSVhFTFN9KWB9PlxuICAgICAgICAgICAge29ic2VydmVkTGF5ZXJ9XG4gICAgICAgICAgICB7ZXhwZWN0ZWRMYXllcn1cbiAgICAgICAgPC9nPlxuICAgICk7XG59XG5cbmZ1bmN0aW9uIGNvbXB1dGVQYXRoRGF0YShldmVudHM6IFRpbWVWYWx1ZVtdLCBtaW5WYWx1ZT0wLCBzaG91bGRDbG9zZT1mYWxzZSwgc2NhbGU9MSkge1xuICAgIGNvbnN0IHBhdGhEYXRhID0gW107XG4gICAgaWYgKGV2ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IFt0aW1lLCB2YWx1ZV0gPSBldmVudHNbMF07XG4gICAgICAgIC8vIHN0YXJ0IGxpbmUgYXQgZmlyc3QgcHJvamVjdGVkIHRpbWUgYW5kIHZhbHVlXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYE0gJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfSwkeyh2YWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBbdGltZSwgdmFsdWVdIG9mIGV2ZW50cykge1xuICAgICAgICAvLyBob3Jpem9udGFsIGxpbmUgdG8gY3VycmVudCB0aW1lXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYEggJHtjb252ZXJ0VGltZSh0aW1lKS50b0ZpeGVkKDMpfWApXG4gICAgICAgIC8vIHZlcnRpY2FsIGxpbmUgdG8gbmV3IGxldmVsXG4gICAgICAgIHBhdGhEYXRhLnB1c2goYFYgJHsodmFsdWUqc2NhbGUpLnRvRml4ZWQoMil9YCk7XG4gICAgfVxuICAgIC8vIGZpbGwgaW4gYXJlYSBiZXR3ZWVuIGxhc3Qgc25hcHNob3QgYW5kIHJpZ2h0IHNpZGUgKGFyZWEgYWZ0ZXIgXCJub3dcIiBjdXJzb3Igd2lsbCBiZSBjbGlwcGVkIGxhdGVyKVxuICAgIGlmIChldmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBbdGltZSwgdmFsdWVdID0gZXZlbnRzW2V2ZW50cy5sZW5ndGgtMV07XG4gICAgICAgIC8vIGhvcml6b250YWwgbGluZSB0byBmdXR1cmUgdGltZVxuICAgICAgICBwYXRoRGF0YS5wdXNoKGBIICR7Y29udmVydFRpbWUodGltZSArIDYwMDAwMCBhcyBUaW1lTXMpLnRvRml4ZWQoMyl9YCk7XG4gICAgICAgIGlmIChzaG91bGRDbG9zZSkge1xuICAgICAgICAgICAgLy8gZmlsbCBhcmVhIHVuZGVyIGFjdHVhbCBzZWN1cml0eVxuICAgICAgICAgICAgcGF0aERhdGEucHVzaChgViAkeyhtaW5WYWx1ZSpzY2FsZSkudG9GaXhlZCgyKX1gKTtcbiAgICAgICAgICAgIGNvbnN0IG1pblRpbWUgPSBldmVudHNbMF1bMF07XG4gICAgICAgICAgICBwYXRoRGF0YS5wdXNoKGBIICR7Y29udmVydFRpbWUobWluVGltZSkudG9GaXhlZCgzKX1gKTtcbiAgICAgICAgICAgIHBhdGhEYXRhLnB1c2goJ1onKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcGF0aERhdGE7XG59XG5cbmZ1bmN0aW9uIE1vbmV5TGF5ZXIoe2V4cGVjdGVkU2VydmVycywgb2JzZXJ2ZWRTZXJ2ZXJzfTogU2VjdXJpdHlMYXllclByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgICBleHBlY3RlZFNlcnZlcnMgPz89IFtdO1xuICAgIG9ic2VydmVkU2VydmVycyA/Pz0gW107XG4gICAgaWYgKGV4cGVjdGVkU2VydmVycy5sZW5ndGggPT0gMCAmJiBvYnNlcnZlZFNlcnZlcnMubGVuZ3RoID09IDApIHJldHVybiBudWxsO1xuICAgIGxldCBtaW5Nb25leSA9IDA7XG4gICAgbGV0IG1heE1vbmV5ID0gKGV4cGVjdGVkU2VydmVyc1swXSB8fCBvYnNlcnZlZFNlcnZlcnNbMF0pLm1vbmV5TWF4O1xuICAgIGNvbnN0IHNjYWxlID0gMS9tYXhNb25leTtcbiAgICBtYXhNb25leSAqPSAxLjFcblxuICAgIGNvbnN0IG9ic2VydmVkRXZlbnRzID0gb2JzZXJ2ZWRTZXJ2ZXJzLm1hcCgoc2VydmVyKT0+W3NlcnZlci50aW1lLCBzZXJ2ZXIubW9uZXlBdmFpbGFibGVdKSBhcyBUaW1lVmFsdWVbXTtcbiAgICBsZXQgc2hvdWxkQ2xvc2VQYXRoID0gdHJ1ZTtcbiAgICBjb25zdCBvYnNlcnZlZFBhdGggPSBjb21wdXRlUGF0aERhdGEob2JzZXJ2ZWRFdmVudHMsIG1pbk1vbmV5LCBzaG91bGRDbG9zZVBhdGgsIHNjYWxlKTtcbiAgICBjb25zdCBvYnNlcnZlZExheWVyID0gKFxuICAgICAgICA8ZyBpZD1cIm9ic2VydmVkTW9uZXlcIlxuICAgICAgICAgICAgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtGT09URVJfUElYRUxTfSkgc2NhbGUoMSAkey1GT09URVJfUElYRUxTIC8gKG1heE1vbmV5IC0gbWluTW9uZXkpIC8gc2NhbGV9KWB9XG4gICAgICAgICAgICBmaWxsPXtcImRhcmtcIitHUkFQSF9DT0xPUlMubW9uZXl9XG4gICAgICAgICAgICAvLyBmaWxsT3BhY2l0eTogMC41LFxuICAgICAgICAgICAgY2xpcFBhdGg9e2B1cmwoI2hpZGUtZnV0dXJlLSR7aW5pdFRpbWV9KWB9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxwYXRoIGQ9e29ic2VydmVkUGF0aC5qb2luKFwiIFwiKX0gLz5cbiAgICAgICAgPC9nPlxuICAgICk7XG5cbiAgICBjb25zdCBleHBlY3RlZEV2ZW50cyA9IGV4cGVjdGVkU2VydmVycy5tYXAoKHNlcnZlcik9PltzZXJ2ZXIudGltZSwgc2VydmVyLm1vbmV5QXZhaWxhYmxlXSkgYXMgVGltZVZhbHVlW107XG4gICAgc2hvdWxkQ2xvc2VQYXRoID0gZmFsc2U7XG4gICAgY29uc3QgZXhwZWN0ZWRQYXRoID0gY29tcHV0ZVBhdGhEYXRhKGV4cGVjdGVkRXZlbnRzLCBtaW5Nb25leSwgc2hvdWxkQ2xvc2VQYXRoLCBzY2FsZSk7XG4gICAgY29uc3QgZXhwZWN0ZWRMYXllciA9IChcbiAgICAgICAgPGcgaWQ9XCJleHBlY3RlZE1vbmV5XCJcbiAgICAgICAgICAgIHRyYW5zZm9ybT17YHRyYW5zbGF0ZSgwICR7Rk9PVEVSX1BJWEVMU30pIHNjYWxlKDEgJHstRk9PVEVSX1BJWEVMUyAvIChtYXhNb25leSAtIG1pbk1vbmV5KSAvIHNjYWxlfSlgfVxuICAgICAgICAgICAgc3Ryb2tlPXtHUkFQSF9DT0xPUlMubW9uZXl9XG4gICAgICAgICAgICBmaWxsPVwibm9uZVwiXG4gICAgICAgICAgICBzdHJva2VXaWR0aD17Mn1cbiAgICAgICAgICAgIHN0cm9rZUxpbmVqb2luPVwiYmV2ZWxcIlxuICAgICAgICA+XG4gICAgICAgICAgICA8cGF0aCBkPXtleHBlY3RlZFBhdGguam9pbihcIiBcIil9IHZlY3RvckVmZmVjdD1cIm5vbi1zY2FsaW5nLXN0cm9rZVwiIC8+XG4gICAgICAgIDwvZz5cbiAgICApO1xuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGcgaWQ9XCJtb25leUxheWVyXCIgdHJhbnNmb3JtPXtgdHJhbnNsYXRlKDAgJHtIRUlHSFRfUElYRUxTIC0gRk9PVEVSX1BJWEVMU30pYH0+XG4gICAgICAgICAgICB7b2JzZXJ2ZWRMYXllcn1cbiAgICAgICAgICAgIHtleHBlY3RlZExheWVyfVxuICAgICAgICA8L2c+XG4gICAgKTtcbn1cbiJdfQ==