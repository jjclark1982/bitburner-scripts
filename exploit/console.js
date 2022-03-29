export async function beeper(ns, value) {
    while (true) {
        ns.tprint("beep "+value);
        await ns.sleep(1000);
    }
}

export async function delayedAction(ns) {
    await ns.sleep(2000);
    ns.tprint("delayed action now");
}

export async function main(ns) {
    window.ns = ns;
    await ns.asleep(60*60*1000);
    //document.$hacknet = ns.hacknet;
    return;
    // ns.tprint(ns.getBitNodeMultipliers());
    // ns.tprint(ns.getServerMaxMoney('pserv-1'));
    // ns.run("exploit.ns", 1, document);
    // ns.tprint(ns.heart.break());
    // 
    // delayedAction(ns);
    // let result = beeper(ns, 1);
    // ns.tprint(result);
    // await ns.sleep(500);
    // beeper(ns, 2);
    // await ns.sleep(5000);
}
