import { ServerPool } from "/net/deploy-script";

export async function main(ns) {
    const script = "/unmanaged-hacking/hack-grow-weaken.js";
    const serverPool = new ServerPool(ns);
    let numKilled = 0;
    for (const server of serverPool) {
        const result = ns.scriptKill(script, server.hostname);
        if (result) {
            numKilled++;
        }
    }
    ns.tprint(`INFO: Stopped ${numKilled} scripts.`);
}
