export async function main(ns) {
    const player = ns.getPlayer();
    if (player.hasCorporation) {
        const corpAPI = eval("ns.corporation");
        const corp = corpAPI.getCorporation();
        // use a public corporation as a piggy bank:
        if (corp.public) {            
            // sell some shares when they amount to more cash than we have on hand
            if (corp.shareSaleCooldown <= 0 && corp.sharePrice * 1e7 > player.money) {
                corpAPI.sellShares(1e7);
            }
            // buyback shares when we can.
            else if (corp.issuedShares > 0) {
                const buybackPrice = corp.sharePrice * 1.1;
                if (player.money > (corp.issuedShares * buybackPrice) * 2) {
                    corpAPI.buyBackShares(corp.issuedShares);
                }
            }
        }
    }
}
