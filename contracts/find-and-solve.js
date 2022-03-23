import {solvers} from "contracts/solvers.js";

export async function main(ns) {
    ns.disableLog("scan");
    ns.disableLog("sleep");
    while (true) {
        attemptAllContracts(ns);
        await ns.sleep(60*1000);
    }
}

export function attemptAllContracts(ns) {
    const contracts = getContracts(ns);
    ns.print(`Found ${contracts.length} contracts.`);
    for (const contract of contracts) {
        attemptContract(ns, contract);
    }
}

export function getContracts(ns) {
    const contracts = [];
    for (const host of getAllHosts(ns)) {
        for (const file of ns.ls(host)) {
            if (file.match(/\.cct$/)) {
                const contract = {
                    host: host,
                    file: file,
                    type: ns.codingcontract.getContractType(file, host),
                    triesRemaining: ns.codingcontract.getNumTriesRemaining(file, host)
                };
                contracts.push(contract);
            }
        }
    }
    return contracts;
}

export function attemptContract(ns, contract) {
    const solver = solvers[contract.type];
    if (solver) {
        ns.print("Attempting " +JSON.stringify(contract,null,2));
        const solution = solver(ns.codingcontract.getData(contract.file, contract.host));
        const reward = ns.codingcontract.attempt(solution, contract.file, contract.host, {returnReward:true});
        if (reward) {
            ns.tprint(`${reward} for solving "${contract.type}" on ${contract.host}`);
        }
        else {
            ns.tprint(`Failed to solve "${contract.type}" on ${contract.host}`);
        }
    }
    else {
        ns.tprint(`No solver for "${contract.type}" on ${contract.host}`);
    }
}

function getAllHosts(ns) {
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
