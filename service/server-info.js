import { PortService } from "/service/lib";
import { ServerList } from "/net/list-servers";

const FLAGS = [
    ["help", false],
    ["port", 1]
]

/** @param {NS} ns **/
export async function main(ns) {
    ns.clearLog();

    const flags = ns.flags(FLAGS);
    if (flags.help) {
        ns.tprint("Provide server information on a netscript port");
        return;
    }

    const serverList = new ServerList(ns);
    const service = new PortService(ns, flags.port, serverList);
    await service.serve();
}
