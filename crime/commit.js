// crime.ns "deal drugs"
import {prepareStats} from "lib.ns";


export async function doCrimes(ns, forcedSelection=null) {
    const crimeNames = ["shoplift", "rob store", "mug", "larceny", "deal drugs", "bond forgery", "traffick arms", "homicide", "grand theft auto", "kidnap", "assassinate", "heist"];
    
    while (true) {
        let crimes = {};
        for (const crimeName of crimeNames) {
            crimes[crimeName] = {
                name: crimeName,
                chance: ns.getCrimeChance(crimeName)
            };
        }
        //crimes = crimes.sort(function(c1, c2){
        //    return c1.chance - c2.chance; // ascending
        //});

        let selectedCrime = crimes[0];
        for (const crime of Object.values(crimes).reverse()) {
            if (crime.chance > 0.75) {
                selectedCrime = crime;
                break;
            }
        }
        const player = ns.getPlayer();
        const karma = ns.heart.break();
        if (player.numPeopleKilled < 100 && crimes.homicide.chance > 0.9) {
            selectedCrime = crimes.homicide;
        }
        if (selectedCrime == crimes.homicide && player.numPeopleKilled > 300 && karma < -1e6) {
            return;
        }
        
        //ns.tprint(crimes);
        //ns.tprint(`Selected ${selectedCrime.name}: chance=${selectedCrime.chance}`);
        //return;

        let delay = ns.commitCrime(forcedSelection || selectedCrime.name);
        await ns.sleep(0.6*delay);
        if (!ns.isBusy()) {
            return;
        }
        while(ns.isBusy()){
            await ns.sleep(0.1*delay);
        }
    }
}

export async function main(ns) {
    const targetStats = {
       "strength": 20,
       "defense": 20,
       "dexterity": 20,
       "agility": 20
    };
    await prepareStats(ns, targetStats);
    ns.stopAction();
    await doCrimes(ns, ns.args[0]);
}

