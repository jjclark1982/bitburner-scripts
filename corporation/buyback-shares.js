export async function main(ns) {
    const player = ns.getPlayer();
    if (player.hasCorporation) {
        const corpAPI = eval("ns.corporation");
        const corp = corpAPI.getCorporation();
        if (corp.public) {            
            if (corp.issuedShares > 0) {
                const buybackPrice = corp.sharePrice * 1.1;
                const buybackMoney = Math.min(player.money, corp.issuedShares * buybackPrice);
                const numShares = buybackMoney / buybackPrice;
                corpAPI.buyBackShares(numShares);
            }
        }
    }
}
