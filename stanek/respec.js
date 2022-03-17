/** @param {NS} ns **/
export async function main(ns) {
    const fragments = ns.stanek.activeFragments();
    ns.print(JSON.stringify(fragments));
    ns.tail();
    await ns.sleep(100);

    for (const fragment of fragments) {
        ns.stanek.remove(fragment.x, fragment.y);
    }

    for (const fragment of hackingSpec6) {
      ns.stanek.place(fragment.x, fragment.y, fragment.rotation, fragment.id);
    }
}


const hackingSpec5 = [
    {"id": 25, "x": 0, "y": 3, "rotation": 0, "type": 14, "power": 0.5, "limit": 1},
    {"id": 1, "x": 0, "y": 2, "rotation": 0, "type": 6, "power": 1, "limit": 1},
    {"id": 0, "x": 3, "y": 3, "rotation": 0, "type": 6, "power": 1, "limit": 1},
    {"id": 107, "x": 2, "y": 1, "rotation": 0, "type": 18, "power": 1.1, "limit": 99},
    {"id": 5, "x": 4, "y": 0, "rotation": 1, "type": 3, "power": 1.3, "limit": 1},
    {"id": 6, "x": 1, "y": 0, "rotation": 0, "type": 4, "power": 2, "limit": 1},
    {"id": 7, "x": 0, "y": 0, "rotation": 0, "type": 5, "power": 0.5, "limit": 1}
];
  
const hackingSpec6 = [
    {"id":20,"x":0,"y":0,"rotation":0,"shape":[[true,true,true,true]],"type":12,"power":1,"limit":1},
    {"id":25,"x":0,"y":4,"rotation":0,"shape":[[true,false,false],[true,true,true]],"type":14,"power":0.5,"limit":1},
    {"id":5,"x":0,"y":1,"rotation":3,"shape":[[true,true,true],[false,true,false]],"type":3,"power":1.3,"limit":1},
    {"id":1,"x":1,"y":1,"rotation":0,"shape":[[true,true,false],[false,true,true]],"type":6,"power":1,"limit":1},
    {"id":0,"x":3,"y":0,"rotation":0,"shape":[[false,true,true],[true,true,false]],"type":6,"power":1,"limit":1},
    {"id":7,"x":3,"y":4,"rotation":0,"shape":[[true,false,false],[true,true,true]],"type":5,"power":0.5,"limit":1},
    {"id":21,"x":1,"y":3,"rotation":0,"shape":[[true,true],[true,true]],"type":13,"power":2,"limit":1},
    {"id":6,"x":5,"y":1,"rotation":3,"shape":[[true,true,true,true]],"type":4,"power":2,"limit":1},
    {"id":10,"x":3,"y":2,"rotation":1,"shape":[[true,true,true],[false,true,false]],"type":7,"power":2,"limit":1}
];
