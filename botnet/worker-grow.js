import { Worker } from "/botnet/worker";

/** @param {NS} ns **/
export async function main(ns) {
    // List the functions this worker is capable of, for static RAM calculation.
    const capabilities = {
        "grow": ns.grow
    }
    const worker = new Worker(ns, capabilities);
    await worker.work();
}
