import { PortService } from "/service/lib";
import { ServerPool } from "/net/server-pool";

const FLAGS = [
    ["help", false],
    ["port", 1]
]

/** @param {NS} ns **/
export async function main(ns) {
    ns.clearLog();

    const flags = ns.flags(FLAGS);
    if (flags.help) {
        ns.tprint("Provide server information on a netscript port")
        return;
    }

    const serverList = new ServerList(ns);
    const serverService = new PortService(ns, flags.port);
    await serverService.serve(serverList);
}
