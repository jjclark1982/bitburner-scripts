let startTime = Date.now();
/** Convert timestamps to seconds since the graph was started. This resolution works for about 24 hours. */
function convertTime(t, t0=startTime) {
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

/**
 * Job
 * @typedef {Object} Job
 * @property {string} task - name of the netscript function to call (hack, grow, weaken)
 * @property {number} duration - duration in milliseconds
 * @property {number} startTime - timestamp of expected start
 * @property {number} startTimeActual - timestamp of actual start (optional)
 * @property {number} endTime - timestamp of expected end
 * @property {number} endTimeActual - timestamp of actual end (optional)
 * @property {boolean} cancelled - whether the job has been cancelled (optional)
 * @property {Object} result - expected server state after the job completes
 * @property {number} result.hackDifficulty
 * @property {number} result.minDifficulty
 */

/**
 * renderBatches - create an SVG element with a graph of jobs
 * @param {SVGSVGElement} [el] - SVG element to reuse. Will be created if it does not exist yet.
 * @param {Job[][]} batches - array of arrays of jobs
 * @param {number} [now] - current time (optional)
 * @returns {SVGSVGElement}
 */
export function renderBatches(el, batches=[], serverSnapshots=[], now) {
    now ||= Date.now();

    // Render the main SVG element if needed
    el ||= svgEl(
        "svg",
        {
            version: "1.1", width:WIDTH_PIXELS, height: HEIGHT_PIXELS,
            // Set the viewBox for 10 seconds of history, 6 seconds of future.
            viewBox: `${convertSecToPx(-10)} 0 ${WIDTH_PIXELS} ${HEIGHT_PIXELS}`
        },
        [
            // ["defs", {}, [
            //     ["clipPath", {id:"hide-future"}, [
            //         ["rect", {x: convertTime(now-30000), width: 30, y:0, height: 50}]
            //     ]]
            // ]],
            // ["rect", {id:"background", x:convertSecToPx(-10), width:"100%", height:"100%", fill:GRAPH_COLORS.safe}],
            ["g", {id:"timeCoordinates"}, [
                ["g", {id:"safetyLayer"}],
                ["g", {id:"jobLayer"}],
                ["g", {id:"secLayer"}],
                ["g", {id:"moneyLayer"}]
            ]],
            // ["rect", {id:"divider-1", x:convertSecToPx(-10), width:"100%", y:HEIGHT_PIXELS-FOOTER_PIXELS, height:1, fill: "white"}],
            // ["rect", {id:"divider-2", x:convertSecToPx(-10), width:"100%", y:HEIGHT_PIXELS-2*FOOTER_PIXELS, height:1, fill: "white"}],
            ["rect", {id:"cursor", x:0, width:1, y:0, height: "100%", fill: "white"}],
            renderLegend()
        ]
    );

    // Update the time coordinates every frame
    const dataEl = el.getElementById("timeCoordinates");
    dataEl.setAttribute('transform',
        `scale(${WIDTH_PIXELS / WIDTH_SECONDS} 1) translate(${convertTime(startTime-now, 0)} 0)`
    );
    
    // Only update the main data every 250 ms
    const lastUpdate = dataEl.getAttribute('data-last-update') || 0;
    if (now - lastUpdate < 250) {
        return el;
    }
    dataEl.setAttribute('data-last-update', now);
    
    // Render each job background and foreground
    while(dataEl.firstChild) {
        dataEl.removeChild(dataEl.firstChild);
    }
    dataEl.appendChild(renderSafetyLayer(batches, now));
    dataEl.appendChild(renderJobLayer(batches, now));
    dataEl.appendChild(renderSecurityLayer(batches, serverSnapshots, now));
    dataEl.appendChild(renderMoneyLayer(batches, serverSnapshots, now));

    return el;
}

function renderSecurityLayer(batches=[], serverSnapshots=[], now) {
    const secLayer = svgEl('g', {
        id: "secLayer",
        transform: `translate(0 ${HEIGHT_PIXELS - 2*FOOTER_PIXELS})`
        //, "clip-path": "url(#hide-future)"
    });

    let minSec = 0;
    let maxSec = 1;
    for (const [t, server] of serverSnapshots) {
        minSec = Math.min(minSec, server.hackDifficulty);
        maxSec = Math.max(maxSec, server.hackDifficulty);
    }
    for (const batch of batches) {
        for (const job of batch) {
            minSec = Math.min(minSec, job.result.hackDifficulty);
            maxSec = Math.max(maxSec, job.result.hackDifficulty);
        }
    }
    maxSec *= 1.1;

    function convertDifficulty(sec) {
        return FOOTER_PIXELS * (1 - ((sec - minSec) / (maxSec - minSec)));
    }

    let prevServer;
    let prevTime;
    for (const [time, server] of serverSnapshots) {
        if (time < now-(WIDTH_SECONDS*2*1000)) {
            continue;
        }

        // fill area under actual security
        if (prevServer) {
            secLayer.appendChild(svgEl('rect', {
                x: convertTime(prevTime),
                width: convertTime(time, prevTime),
                y: convertDifficulty(prevServer.hackDifficulty),
                height: convertDifficulty(0) - convertDifficulty(prevServer.hackDifficulty),
                fill: "dark"+GRAPH_COLORS.security
            }));
        }
        prevServer = server;
        prevTime = time;
    }
    // TODO: fill in area between last snapshot and "now" cursor, using a smooth clip-path

    let prevJob;
    for (const batch of batches) {
        for (const job of batch) {
            if ((job.endTimeActual || job.endTime) < now-(WIDTH_SECONDS*2*1000)) {
                continue;
            }
            // draw line for projected security
            if (prevJob && job.endTime > prevJob.endTime) {
                secLayer.appendChild(svgEl('line', {
                    x1: convertTime(prevJob.endTime),
                    x2: convertTime(job.endTime),
                    y1: convertDifficulty(prevJob.result.hackDifficulty),
                    y2: convertDifficulty(prevJob.result.hackDifficulty),
                    stroke: GRAPH_COLORS.security,
                    "stroke-width": 2,
                    "vector-effect": "non-scaling-stroke"
                }));
                secLayer.appendChild(svgEl('line', {
                    x1: convertTime(job.endTime),
                    x2: convertTime(job.endTime),
                    y1: convertDifficulty(prevJob.result.hackDifficulty),
                    y2: convertDifficulty(job.result.hackDifficulty),
                    stroke: GRAPH_COLORS.security,
                    "stroke-width": 2,
                    "vector-effect": "non-scaling-stroke"
                }));
            }
            prevJob = job;
        }
    }
    if (prevJob) {
        secLayer.appendChild(svgEl('line', {
            x1: convertTime(prevJob.endTime),
            x2: convertTime(prevJob.endTime + 30000),
            y1: convertDifficulty(prevJob.result.hackDifficulty),
            y2: convertDifficulty(prevJob.result.hackDifficulty),
            stroke: GRAPH_COLORS.security,
            "stroke-width": 2,
            "vector-effect": "non-scaling-stroke"
        }));
    }
    return secLayer;
}

function renderMoneyLayer(batches=[], serverSnapshots=[], now) {
    const moneyLayer = svgEl('g', {
        id:"moneyLayer",
        transform: `translate(0 ${HEIGHT_PIXELS - FOOTER_PIXELS})`
    });
    if (batches.length == 0 && serverSnapshots.length == 0) {
        return moneyLayer;
    }

    const minMoney = 0;
    const maxMoney = batches[0][0].result.moneyMax * 1.1;

    function convertMoney(sec) {
        return FOOTER_PIXELS * (1 - ((sec - minMoney) / (maxMoney - minMoney)));
    }

    let prevServer;
    let prevTime;
    for (const [time, server] of serverSnapshots) {
        if (time < now-(WIDTH_SECONDS*2*1000)) {
            continue;
        }

        // fill area under actual security
        if (prevServer) {
            moneyLayer.appendChild(svgEl('rect', {
                x: convertTime(prevTime),
                width: convertTime(time, prevTime),
                y: convertMoney(prevServer.moneyAvailable),
                height: convertMoney(0) - convertMoney(prevServer.moneyAvailable),
                fill: "dark"+GRAPH_COLORS.money
            }));
        }
        prevServer = server;
        prevTime = time;
    }

    let prevJob;
    for (const batch of batches) {
        for (const job of batch) {
            if ((job.endTimeActual || job.endTime) < now-(WIDTH_SECONDS*2*1000)) {
                continue;
            }

            // draw a line from (prevTime, prevSec) to (job.time, job.sec)
            if (prevJob && job.endTime > prevJob.endTime) {
                moneyLayer.appendChild(svgEl('line', {
                    x1: convertTime(prevJob.endTime),
                    x2: convertTime(job.endTime),
                    y1: convertMoney(prevJob.result.moneyAvailable),
                    y2: convertMoney(prevJob.result.moneyAvailable),
                    stroke: GRAPH_COLORS.money,
                    "stroke-width": 2,
                    "vector-effect": "non-scaling-stroke"
                }));
                moneyLayer.appendChild(svgEl('line', {
                    x1: convertTime(job.endTime),
                    x2: convertTime(job.endTime),
                    y1: convertMoney(prevJob.result.moneyAvailable),
                    y2: convertMoney(job.result.moneyAvailable),
                    stroke: GRAPH_COLORS.money,
                    "stroke-width": 2,
                    "vector-effect": "non-scaling-stroke"
                }));
            }
            prevJob = job;
        }
    }
    if (prevJob) {
        moneyLayer.appendChild(svgEl('line', {
            x1: convertTime(prevJob.endTime),
            x2: convertTime(prevJob.endTime + 30000),
            y1: convertMoney(prevJob.result.moneyAvailable),
            y2: convertMoney(prevJob.result.moneyAvailable),
            stroke: GRAPH_COLORS.money,
            "stroke-width": 2,
            "vector-effect": "non-scaling-stroke"
        }));
    }
    return moneyLayer;
}

function renderSafetyLayer(batches=[], now) {
    const safetyLayer = svgEl('g', {id:"safetyLayer"});

    let prevJob;    
    for (const batch of batches) {
        for (const job of batch) {
            if ((job.endTimeActual || job.endTime) < now-(WIDTH_SECONDS*2*1000)) {
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

function renderJobLayer(batches=[], now) {
    const jobLayer = svgEl('g', {id:"jobLayer"});

    let i = 0;
    for (const batch of batches) {
        for (const job of batch) {
            i = (i + 1) % ((HEIGHT_PIXELS - FOOTER_PIXELS*2) / 4);
            if ((job.endTimeActual || job.endTime) < now-(WIDTH_SECONDS*2*1000)) {
                continue;
            }
            // draw the job bars
            let color = GRAPH_COLORS[job.task];
            if (job.cancelled) {
                color = GRAPH_COLORS.cancelled;
            }
            jobLayer.appendChild(svgEl('rect', {
                x: convertTime(job.startTime), width: convertTime(job.duration, 0),
                y: i*4, height: 2,
                fill: color
            }));
            // draw the error bars
            if (job.startTimeActual) {
                const [t1, t2] = [job.startTime, job.startTimeActual].sort((a,b)=>a-b);
                jobLayer.appendChild(svgEl('rect', {
                    x: convertTime(t1), width: convertTime(t2-t1, 0),
                    y: i*4, height: 1,
                    fill: GRAPH_COLORS.desync
                }));
            }
            if (job.endTimeActual) {
                const [t1, t2] = [job.endTime, job.endTimeActual].sort((a,b)=>a-b);
                jobLayer.appendChild(svgEl('rect', {
                    x: convertTime(t1), width: convertTime(t2-t1, 0),
                    y: i*4, height: 1,
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
    const legendEl = svgEl('g',
        {id: "Legend", transform: "translate(-480, 10), scale(.5, .5)"},
        [['rect', {x: 1, y: 1, width: 275, height: 392, fill: "black", stroke: "#979797"}]]
    );
    let y = 13;
    for (const [label, color] of Object.entries(GRAPH_COLORS)) {
        legendEl.appendChild(svgEl('g', {transform: `translate(22, ${y})`}, [
            ['rect', {x:0, y:10, width: 22, height: 22, fill: color}],
            ['text', {"font-family":"Courier New", "font-size":36, fill: "#888"}, [
                ['tspan', {x:42.5, y:30}, [label.substring(0,1).toUpperCase()+label.substring(1)]]
            ]]
        ]));
        y += 41;
    }
    return legendEl;
}

/* ---------- library functions ---------- */

/** Create an SVG Element that can be displayed in the DOM. */
function svgEl(tagName, attributes={}, children=[]) {
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
        else if (typeof(child) == 'string') {
            child = doc.createTextNode(child);
        }
        el.appendChild(child);
    }
    return el;
}

/** Insert an element into the netscript process's tail window. */
export function logHTML(ns, el) {
    ns.tail();
    const doc = eval("document");
    const command = ns.getScriptName() + ' ' + ns.args.join(' ');
    const logEl = doc.querySelector(`[title="${command}"]`).parentElement.parentElement.nextElementSibling.querySelector('.MuiBox-root')
    logEl.appendChild(el);
}
