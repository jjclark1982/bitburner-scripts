/** @param {NS} ns **/
export async function main(ns) {
    const growthFactor = ns.args[0];

    for (const memberName of ns.gang.getMemberNames()) {
        const member = ns.gang.getMemberInformation(memberName);
        ascendIfReady(ns, member, growthFactor);
    }
}

export function ascendIfReady(ns, member, factor=2.0) {
    const ascResult = ns.gang.getAscensionResult(member.name);
    if (!ascResult) {
        return;
    }
    // TODO: check ascResult.respect
    if (ascResult.str > factor * member.str_asc_mult) {
        ns.gang.ascendMember(member.name);
    }
}
