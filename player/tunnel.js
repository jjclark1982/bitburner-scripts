const FLAGS = [
    ["help", false],
    ["verbose", true],
    ["silent", false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return [...data.servers];
}

export async function main(ns) {
    const flags = ns.flags(FLAGS);
    const verbose = flags.verbose && !flags.silent;
    const target = flags._[0];

    if (flags.help) {
        ns.tprint([
            "Connect to any server.",
            "",
            "Usage:",
            `alias tunnel="run ${ns.getScriptName()}"`,
            "tunnel [host]",
            " "
        ].join("\n"));
        return;
    }

    connectToHost(ns, target, verbose);
}

export function connectToHost(ns, target, verbose=false) {
    const entry = ns.getCurrentServer();
    const path = pathToTarget(ns, entry, target);
    for (const host of path.slice(1)) {
        if (ns.connect(host) && verbose) {
            ns.tprint(`Connected to ${host}`);
        }
    }
}

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
