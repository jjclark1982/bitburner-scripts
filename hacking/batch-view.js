let startTime = Date.now();

export function renderBatches(el, batches=[], now) {
    const widthPixels = 800;
    const widthSeconds = 16;
    const heightPixels = 600;

    now ||= Date.now();

    /** Convert timestamps to seconds since the graph was started. This resolution works for about 24 hours. */
    function convertTime(t, t0=startTime) {
        return ((t - t0) / 1000);
    }

    function convertSecToPx(t) {
        return t * widthPixels / widthSeconds;
    }

    // Render the main SVG element if needed
    el ||= svgEl(
        "svg",
        // Set the viewBox for 10 seconds of history, 6 seconds of future.
        {version: "1.1", width:800, height: 600, viewBox: `${convertSecToPx(-10)} 0 ${widthPixels} ${heightPixels}`},
        [
            // ["rect", {id:"background", x:convertSecToPx(-10), width:"100%", height:"100%", fill:GRAPH_COLORS.safe}],
            ["g", {id:"timeCoordinates"}, [
                ["g", {id:"secLayer"}],
                ["g", {id:"jobLayer"}],
            ]],
            ["rect", {id:"cursor", x:0, width:1, y:0, height: "100%", fill: "white"}],
            renderLegend()
        ]
    );

    // Update the time coordinates every frame
    el.getElementById("timeCoordinates").setAttribute('transform',
        `scale(${widthPixels / widthSeconds} 1) translate(${convertTime(startTime-now, 0)} 0)`
    );
    
    // Only update the main data every 250 ms
    const lastUpdate = el.getAttribute('data-last-update') || 0;
    if (now - lastUpdate < 250) {
        return el;
    }
    el.setAttribute('data-last-update', now);
    
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
    let prevEnd = now - 30000;
    let i = 0;
    for (const batch of batches) {
        for (const job of batch) {
            i = (i + 1) % 150;
            if ((job.endTimeActual || job.endTime) < now-20000) {
                continue;
            }

            // shade the background based on secLevel
            if (job.endTime > prevEnd) {
                secLayer.appendChild(svgEl('rect', {
                    x: convertTime(prevEnd), width: convertTime(job.endTime - prevEnd, 0),
                    y: 0, height: "100%",
                    fill: (prevSec > safeSec) ? GRAPH_COLORS.unsafe : GRAPH_COLORS.safe
                }));    
            }
            prevSec = job.result.hackDifficulty;
            prevEnd = job.endTime;

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
                jobLayer.appendChild(svgEl('rect', {
                    x: convertTime(Math.min(job.startTime, job.startTimeActual)), width: convertTime(Math.abs(job.startTime - job.startTimeActual), 0),
                    y: i*4, height: 1,
                    fill: GRAPH_COLORS.desync
                }));
            }
            if (job.endTimeActual) {
                jobLayer.appendChild(svgEl('rect', {
                    x: convertTime(Math.min(job.endTime, job.endTimeActual)), width: convertTime(Math.abs(job.endTime - job.endTimeActual), 0),
                    y: i*4, height: 1,
                    fill: GRAPH_COLORS.desync
                }));
            }
        }
        // space between batches
        i = (i + 1) % 150;
    }
    secLayer.appendChild(svgEl('rect', {
        x: convertTime(prevEnd), width: convertTime(10000, 0),
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
        {id: "Legend", transform: "translate(-480, 10), scale(.5, .5)"},
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
