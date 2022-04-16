export const programs = [
    ["BruteSSH.exe", 50, 500000],
    ["FTPCrack.exe", 100, 1500000],
    ["relaySMTP.exe", 250, 5000000],
    ["HTTPWorm.exe", 500, 30000000],
    ["SQLInject.exe", 750, 250000000],
    ["AutoLink.exe", 200, 1000000],
    ["ServerProfiler.exe", 200, 1000000],
    ["DeepscanV1.exe", 250, 500000],
    ["DeepscanV2.exe", 500, 25000000]
];

export async function waitForMoney(ns, amount) {
    if (ns.getServerMoneyAvailable('home') < amount) {
        ns.print(`Waiting for ${ns.nFormat(amount, "$0.0a")}`);
        while (ns.getServerMoneyAvailable('home') < amount) {
            await ns.sleep(10*1000);
        }
    }
}

export async function main(ns) {
    await waitForMoney(ns, 200000);
    ns.purchaseTor();

    for (const program of programs) {
        if (!ns.fileExists(program[0])) {
            ns.print(`Next program: ${program[0]}`);
            await waitForMoney(ns, program[2]);
            ns.purchaseProgram(program[0]);
        }
            //if (!ns.isBusy()) {
            //    if (ns.getHackingLevel() < program[1]) {
            //        ns.universityCourse("Rothman University", "Algorithms");
            //    }
            //    else {
            //        ns.createProgram(program[0]);
            //    }
            //}
    }
    ns.tprint("INFO: Installed all programs.");
}
