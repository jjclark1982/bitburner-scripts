export async function main(ns) {
    // Print an example table to demonstrate functionality.
    const columns = [
        {header: "Name ", field: "name", align: "center"},
        {header: "Count", field: "count"},
        {header: "Status", field: "status", align: "left", truncate: true},
        {header: "Time       ", field: "time", format: drawTable.time}
    ];
    const rows = [
        {name: "A", count: 2},
        {name: "B", count: 10},
        {name: "C", status: "idle"},
        {name: "D", time: Date.now()},
        {name: "E", status: "longer_status"}
    ];
    ns.tprint("\n" + drawTable(columns, rows));
}

/*
columns: {width, header, field, format, align, truncate}
rows: obj with each [field]
*/
export function drawTable(columns, rows) {
    for (const col of columns) {
        col.width ||= col.header.length;
    }
    
    let lines = [];
    lines.push(drawHR(columns, ['┌', '┬', '─', '┐']));

    lines.push('│ ' + columns.map((col)=>
        pad(col.header || col.field, col.width, ' ', col.align || 'left')
    ).join(' │ ') + ' │');

    lines.push(drawHR(columns, ['├', '┼', '─', '┤']));

    for (const row of rows) {
        const values = columns.map((col)=>{
            let val = row[col.field];
            if (Array.isArray(col.field)) {
                val = col.field.map((f)=>row[f]);
            }
            if (Array.isArray(col.format)) {
                const vals = (val || []).map((v)=>(
                    col.format[0](v, ...(col.formatArgs||[]))
                ));
                val = formatFraction(vals, col.itemWidth);
            }
            else if (typeof(col.format) == 'function') {
                val = col.format(val, ...(col.formatArgs||[]));
            }
            val = pad(`${val || ''}`, col.width, ' ', col.align || 'right');
            if (col.truncate && val.length > col.width) {
                val = val.substring(0,col.width-1) + "…";
            }
            return val;
        });
        lines.push('│ ' + values.join(' │ ') + ' │');
    }

    lines.push(drawHR(columns, ['└', '┴', '─', '┘']));

    return lines.join('\n');
}

function drawHR(columns, glyphs=['└', '┴', '─', '┘']) {
    let line = glyphs[0];
    const segments = [];
    for (const col of columns) {
        const segment = pad('', col.width+2, glyphs[2]);
        segments.push(segment);
    }
    line = glyphs[0] + segments.join(glyphs[1]) + glyphs[3];
    return line;
}

function pad(str, length, filler=' ', align='right') {
    if (align == 'right') {
        while (str.length < length) {
            str = filler + str;
        }
    }
    else if (align == 'left') {
        while (str.length < length) {
            str = str + filler;
        }
    }
    else {
        while (str.length < length) {
            str = str + filler;
            if (str.length < length) {
                str = filler + str;
            }
        }
    }
    return str;
}

export function formatTime(timeMS, precision=0) {
    if (!timeMS) {
        return '';
    }
    const d = new Date(2000, 1, 1, 0, 0, timeMS/1000)
    let timeStr = d.toTimeString().slice(0,8);
    if (timeMS >= 60 * 60 * 1000) {
        timeStr = timeStr.slice(0,8);
    }
    else if (timeMS >= 10 * 60 * 1000) {
        timeStr = timeStr.slice(3,8);
    }
    else {
        timeStr = timeStr.slice(4,8);
    }
    if (precision > 0) {
        let msStr = (timeMS / 1000 - Math.floor(timeMS/1000)).toFixed(precision);
        timeStr += msStr.substring(1);
    }
    return timeStr;
}
drawTable.time = formatTime;

export function formatFraction(fraction, itemWidth=0) {
    const values = fraction.filter((val)=>
        !!val
    ).map((val)=>
        pad(val, itemWidth)
    );
    return values.join(" / ");
}
drawTable.fraction = formatFraction;
