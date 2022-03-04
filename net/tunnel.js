// run tunnel.ns [target]

export function pathToTarget(ns, entry, target) {
    let scanned = {};
    
    function findTargetFrom(host) {
        if (host in scanned) {
            return null;
        }
        scanned[host] = true;
        if (host.toLowerCase() == target.toLowerCase()) {
            return [host];
        }
        for (const neighbor of ns.scan(host).reverse()) {
            const path = findTargetFrom(neighbor);
            if (path != null) {
                return [host].concat(path);
            }
        }
        return null;
    }
    
    return findTargetFrom(entry) || [];
}

export function connectToHost(ns, target, silent=false) {
    const entry = ns.getCurrentServer();
    const path = pathToTarget(ns, entry, target);
    for (const host of path.slice(1)) {
        if (ns.connect(host) && !silent) {
            ns.tprint(`Connected to ${host}`);
        }
    }
}

export async function main(ns) {
    const target = ns.args[0];
    connectToHost(ns, target);
}

export function autocomplete(data, args) {
    return [...data.servers];
}