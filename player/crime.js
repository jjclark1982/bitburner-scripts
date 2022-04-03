/*

Usage:
/player/crime.js "deal drugs"

*/

import { prepareStats } from "player/train.js";

const CRIME_NAMES = ["shoplift", "rob store", "mug", "larceny", "deal drugs", "bond forgery", "traffick arms", "homicide", "grand theft auto", "kidnap", "assassinate", "heist"];

export function autocomplete(data, args) {
    return CRIME_NAMES;
}

export async function doCrimes(ns, forcedSelection=null) {
    while (true) {
        let crimes = {};
        for (const crimeName of CRIME_NAMES) {
            crimes[crimeName] = {
                name: crimeName,
                chance: ns.getCrimeChance(crimeName)
            };
        }
        //crimes = crimes.sort(function(a, b){
        //    return a.chance - b.chance; // ascending
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
        if (player.numPeopleKilled < 30 && crimes.homicide.chance > 0.9) {
            selectedCrime = crimes.homicide;
        }
        if (selectedCrime == crimes.homicide && player.numPeopleKilled > 100 && karma < -1e6) {
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
       "strength": 5,
       "defense": 5,
       "dexterity": 10,
       "agility": 10
    };
    await prepareStats(ns, targetStats);
    ns.stopAction();
    await doCrimes(ns, ns.args[0]);
}

