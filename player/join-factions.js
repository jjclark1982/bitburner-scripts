export function acceptInvites(ns) {
    for (const faction of ns.checkFactionInvitations()) {
        if (!(exclusiveFactions[faction])) {
            ns.joinFaction(faction);
            ns.tprint(`Joined faction ${faction}.`);
        }
    }
}

export const exclusiveFactions = {
    "Aevum": true,
    "Sector-12": true,
    "Volhaven": true,
    "Chongqing": true,
    "New Tokyo": true,
    "Ishima": true
};

export async function main(ns) {
    //if (!ns.getOwnedAugmentations().includes("CashRoot Starter Kit")) {
    //    exclusiveFactions["Sector-12"] = false;
    //    exclusiveFactions.Aevum = false;
    //}
    
    while (true) {
        acceptInvites(ns);
        await ns.sleep(60*1000);
    }
}
