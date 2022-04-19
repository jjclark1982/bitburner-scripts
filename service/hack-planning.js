import { PortService } from "/lib/port-service";
import { HackPlanner } from "/hacking/planner";

const FLAGS = [
    ["help", false],
    ["port", 4]
]

/** @param {NS} ns **/
export async function main(ns) {
    ns.clearLog();

    const flags = ns.flags(FLAGS);
    if (flags.help) {
        ns.tprint("Provide hack/grow/weaken planning services on a netscript port");
        return;
    }

    const hackPlanner = new HackPlanner(ns);
    const service = new PortService(ns, flags.port, hackPlanner);
    await service.serve();
}
