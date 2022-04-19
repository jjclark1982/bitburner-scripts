import { PortService } from "/lib/port-service";
import { ServerPool } from "/net/deploy-script";

const FLAGS = [
    ["help", false],
    ["port", 2]
]

/** @param {NS} ns **/
export async function main(ns) {
    ns.clearLog();

    const flags = ns.flags(FLAGS);
    if (flags.help) {
        ns.tprint("Provide script deployment services on a netscript port");
        return;
    }

    const serverPool = new ServerPool(ns);
    const service = new PortService(ns, flags.port, serverPool);
    await service.serve();
}
