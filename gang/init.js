export async function main(ns) {
    if (ns.gang.inGang) {
        ns.run("/gang/manage.js");
    }
}
