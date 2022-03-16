const EXCLUDED_AUGS = {
    "CashRoot Starter Kit": true
};

export async function main(ns) {
    let fundsFraction = 0.01;
    if (ns.args.length > 0) {
        fundsFraction = ns.args[0];
    }
    for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
        for (const aug of ns.sleeve.getSleevePurchasableAugs(i)) {
            if (aug.name in EXCLUDED_AUGS) {
                continue;
            }
            if (aug.cost < fundsFraction*ns.getPlayer().money) {
                if (ns.sleeve.purchaseSleeveAug(i, aug.name)) {
                    ns.tprint(`Sleeve ${i} purchased ${aug.name}`);
                }
            }
        }
    }
}
