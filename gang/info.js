export async function main(ns) {
    ns.clearLog();
    ns.tail();

    const gang = ns.gang.getGangInformation();
    ns.print(JSON.stringify(gang,null,2));
    for (const memberName of ns.gang.getMemberNames()) {
        const member = ns.gang.getMemberInformation(memberName);
        ns.print(JSON.stringify(member));
    }
    ns.print(JSON.stringify(ns.gang.getOtherGangInformation(), null, 2));
}
