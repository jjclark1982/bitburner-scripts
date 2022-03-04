export async function main(ns) {
    let player = ns.getPlayer();
    player.karma = ns.heart.break();
    const factions = player.factions;
    player.factions = {};
    for (const f of factions) {
        player.factions[f] = `${ns.getFactionFavor(f)} favor, ${parseInt(ns.getFactionRep(f))} rep`;
    }
    ns.print(JSON.stringify(player, null, 2));
    ns.tail();
}