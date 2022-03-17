import { trainSleeve } from "sleeves/train.js";
import { workSleeve, clearSleeves } from "sleeves/work.js";

export async function main(ns) {
    const player = ns.getPlayer();
    clearSleeves(ns);
    for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
        const stats = ns.sleeve.getSleeveStats(i);
        if (stats.shock > 20) {
            ns.sleeve.setToShockRecovery(i);
        }
        else if (stats.sync < 100) {
            ns.sleeve.setToSynchronize(i);
        }
        else if (stats.hacking < 50 || player.hacking < 50) {
            trainSleeve(ns, i);
        }
        else {
            workSleeve(ns, i);
        }
    }
}
