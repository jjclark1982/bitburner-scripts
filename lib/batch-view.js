export function renderBatches(el, batches=[], now) {
    now ||= Date.now();

    function convertTimeToX(t, t0=now, tWidth=15000, pxWidth=800) {
        return ((t - t0) * pxWidth / tWidth);
    }

    // Render the main SVG element if needed
    el ||= svgEl(
        "svg",
        {version: "1.1", width:800, height: 600},
        [
            // ["rect", {id:"background", x=convertTimeToX(now-10000), width="100%", height="100%", fill=GRAPH_COLORS.safe}],
            ["g", {id:"secLayer"}],
            ["g", {id:"jobLayer"}],
            ["rect", {id:"cursor", x:0, width:1, y:0, height: "100%", fill: "white"}],
            renderLegend()
        ]
    );
    // Set the viewBox for 10 seconds of history, 5 seconds of future.
    el.setAttribute("viewBox", `${convertTimeToX(now-10000)} 0 800 600`);

    // Render each job background and foreground
    let secLayer = el.getElementById("secLayer");
    let jobLayer = el.getElementById("jobLayer");
    while(secLayer.firstChild) {
        secLayer.removeChild(secLayer.firstChild);
    }
    while(jobLayer.firstChild) {
        jobLayer.removeChild(jobLayer.firstChild);
    }
    const prevJob = (batches[0] || [])[0];
    let safeSec = prevJob?.result?.minDifficulty || 0;
    let prevSec = (prevJob?.result?.hackDifficulty - prevJob?.change?.security) || 0;
    let prevEnd = now - 20000;
    let i = 0;
    for (const batch of batches) {
        for (const job of batch) {
            i = (i + 1) % 150;
            const endTime = job.endTimeActual || job.endTime;
            if (endTime < now-13000) {
                continue;
            }

            // shade the background based on secLevel
            secLayer.appendChild(svgEl('rect', {
                x: convertTimeToX(prevEnd), width: convertTimeToX(job.endTime - prevEnd, 0),
                y: 0, height: "100%",
                fill: (prevSec > safeSec) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe
            }));
            prevSec = job.result.hackDifficulty;
            prevEnd = job.endTime;

            // draw the job bars
            let color = GRAPH_COLORS[job.task];
            if (job.cancelled) {
                color = GRAPH_COLORS.cancelled;
            }
            jobLayer.appendChild(svgEl('rect', {
                x: convertTimeToX(job.startTime), width: convertTimeToX(job.duration, 0),
                y: i*4, height: 2,
                fill: color
            }));
            // draw the error bars
            if (job.startTimeActual) {
                jobLayer.appendChild(svgEl('rect', {
                    x: convertTimeToX(Math.min(job.startTime, job.startTimeActual)), width: convertTimeToX(Math.abs(job.startTime - job.startTimeActual), 0),
                    y: i*4, height: 1,
                    fill: GRAPH_COLORS.desync
                }));
            }
            if (job.endTimeActual) {
                jobLayer.appendChild(svgEl('rect', {
                    x: convertTimeToX(Math.min(job.endTime, job.endTimeActual)), width: convertTimeToX(Math.abs(job.endTime - job.endTimeActual), 0),
                    y: i*4, height: 1,
                    fill: GRAPH_COLORS.desync
                }));
            }
        }
        // space between batches
        i = (i + 1) % 150;
    }
    secLayer.appendChild(svgEl('rect', {
        x: convertTimeToX(prevEnd), width: convertTimeToX(10000, 0),
        y: 0, height: "100%",
        fill: (prevSec > safeSec) ? '#333' : '#111'
    }));

    return el;
}

const GRAPH_COLORS = {
    "hack": "cyan",
    "grow": "lightgreen",
    "weaken": "yellow",
    "cancelled": "red",
    "desync": "magenta",
    "safe": "#111",
    "unsafe": "#333"
};

function renderLegend() {
    const legendEl = svgEl('g',
        {id: "Legend", transform: "translate(-525, 8), scale(.5, .5)"},
        [['rect', {x: 1, y: 1, width: 275, height: 310, fill: "black", stroke: "#979797"}]]
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

function svgEl(tag, attributes={}, children=[]) {
    const doc = eval("document");
    const xmlns = 'http://www.w3.org/2000/svg';
    const el = doc.createElementNS(xmlns, tag);
    if (tag.toLowerCase() == 'svg') {
        // support export
        attributes['xmlns'] = xmlns;
    }
    for (const [name, val] of Object.entries(attributes)) {
        el.setAttribute(name, val);
    }
    for (let child of children) {
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
