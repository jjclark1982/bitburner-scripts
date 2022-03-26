export function getAllHosts(ns) {
    // Return an array of all hostnames.
    getAllHosts.cache ||= {};
    const scanned = getAllHosts.cache;
    const toScan = ['home'];
    while (toScan.length > 0) {
        const host = toScan.shift();
        scanned[host] = true;
        for (const nextHost of ns.scan(host)) {
            if (!(nextHost in scanned)) {
                toScan.push(nextHost);
            }
        }
    }
    const allHosts = Object.keys(scanned);
    return allHosts;
}

export function getAllServers(ns) {
    return getAllHosts(ns).map(ns.getServer);
}

export function getBiggestServers(ns) {
    const biggestHosts = getAllHosts(ns).map(function(host){
        const server = ns.getServer(host);
        server.availableRam = server.maxRam - server.ramUsed;
        return server;
    }).filter(function(server){
        return server.hasAdminRights;
    }).sort(function(a,b){
        return (b.availableRam - a.availableRam);
    });
    return biggestHosts;
}

export function getBiggestHost(ns) {
    return getBiggestServers(ns)[0].hostname;
}

export async function runMaxThreadsOnHost({ns, host, script, args, reservedRam}) {
    args ||= [];
    reservedRam ||= 0;

    const scriptRam = ns.getScriptRam(script, 'home');
    await ns.scp(script, 'home', host);

    const server = ns.getServer(host);
    let availableRam = server.maxRam - server.ramUsed - reservedRam;
    const threads = Math.floor(availableRam / scriptRam);
    if (threads > 0) {
        const pid = ns.exec(script, host, threads, ...args);
        ns.tprint(`Running on ${host} with PID ${pid}: ${threads}x ${script} ${args.join(' ')}`);
        return pid;
    }
    else {
        ns.tprint(`Not enough available RAM on ${host} to run ${script}`);
        return null;
    }
}
