import { Worker } from "hive/worker";

/** @param {NS} ns **/
export async function main(ns) {
    // List the functions this worker is capable of, for static RAM calculation.
    const capabilities = {
        "weaken": ns.weaken
    }
    const worker = new Worker(ns, capabilities);
    await worker.work();
}
