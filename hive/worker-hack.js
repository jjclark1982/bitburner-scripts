import { Worker } from "hive/worker";

const FLAGS = [
    ["port", 1],
    ["id"]
];

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("asleep");

    // List the functions this worker is capable of, for static RAM calculation.
    const capabilities = {
        "hack": ns.hack
    }
    const worker = new Worker(ns, capabilities);
    await worker.work();
}
