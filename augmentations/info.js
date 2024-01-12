/*

/augmentations/info.js (32.6 GB)

List owned augmentations or show stats of a named augmentation.

Example: List installed augmentations
> run /augmentations/info.js

Example: Show stats of a specific augmentation (supports autocomplete)
> run /augmentations/info.js NeuroFlux Governor`,

*/

const FLAGS = [
    ['help', false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return ALL_AUGMENTATIONS;
}

/** @param {NS} ns **/
export async function main(ns) {
    const args = ns.flags(FLAGS);
    const augName = args._.join(' ');

    if (args.help) {
        ns.tprint([
            `List owned augmentations or show stats of a named augmentation.`,
            '',
            "Example: List installed augmentations",
            `> run ${ns.getScriptName()}`,
            '',
            "Example: Show stats of a specific augmentation (supports autocomplete)",
            `> run ${ns.getScriptName()} NeuroFlux Governor`,
            ' '
        ].join('\n'));
        return;
    }

    ns.clearLog();
    ns.tail();

    if (augName) {
        ns.print(reportOnAugmentation(ns, augName));
    }
    else {
        ns.print(reportOnPlayer(ns));
    }
}

export function reportOnAugmentation(ns, augName) {
    const aug = getAugmentationInfo(ns, augName);
    const summary = [aug.name];
    summary.push(' ');
    summary.push(`Status: ${aug.installed ? 'Installed' : aug.purchased ? 'Purchased' : 'Not Owned'}`);
    summary.push(' ');
    summary.push(`Price: ${ns.nFormat(aug.price, "$0.0a")}`);
    summary.push(' ');
    summary.push("Value:");
    for (const [domain, value] of Object.entries(aug.value)) {
        summary.push(`  ${domain}: ${value.toFixed(3)}`);
    }
    summary.push(' ');
    summary.push(`Stats: ${JSON.stringify(aug.stats, null, 2)}`);
    summary.push(' ');
    summary.push(`Prereqs: ${JSON.stringify(aug.prereqs, null, 2)} ${aug.prereqs.every((prereq)=>ns.getOwnedAugmentations(true).includes(prereq)) ? '✓' : '✗'}`);
    summary.push(' ');
    summary.push("Factions:");
    for (let [faction, [rep, repReq]] of Object.entries(aug.factions)) {
        const repStr = ns.nFormat(rep, "0a");
        const repReqStr = ns.nFormat(repReq, "0a");
        summary.push(`  ${faction}: ${repStr} / ${repReqStr} rep ${rep >= repReq ? '✓' : '✗'}`);
    }
    summary.push(' ');

    return summary.join("\n");
}

export function reportOnPlayer(ns) {
    const report = [];
    const sourceFiles = {};
    for (const sourceFile of ns.singularity.getOwnedSourceFiles().sort((a,b)=>a.n-b.n)) {
        sourceFiles[`SourceFile${sourceFile.n}`] = sourceFile.lvl;
    }
    report.push("Source Files: " + JSON.stringify(sourceFiles, null, 2));

    const installedAugs = ns.singularity.getOwnedAugmentations(false);
    report.push("Installed Augmentations: " + JSON.stringify(installedAugs, null, 2));

    const purchasedAugs = ns.singularity.getOwnedAugmentations(true).filter(function(aug){
        return !installedAugs.includes(aug);
    });
    report.push("Purchased Augmentations: " + JSON.stringify(purchasedAugs, null, 2));
    report.push(' ');
    return report.join("\n");
}

// -------------------- utility functions --------------------

export function getAllAugmentations(ns) {
    const augs = {};
    // const factions = ns.getPlayer().factions;
    for (const faction of ALL_FACTIONS) {
        for (const augName of ns.singularity.getAugmentationsFromFaction(faction)) {
            augs[augName] ||= getAugmentationInfo(ns, augName);
        }
    }
    return augs;
}

export function getAugmentationInfo(ns, augName) {
    const aug = {};
    aug.name = augName;
    aug.installed = ns.singularity.getOwnedAugmentations().includes(aug.name);
    aug.purchased = !aug.installed && ns.singularity.getOwnedAugmentations(true).includes(aug.name);

    aug.repReq = ns.singularity.getAugmentationRepReq(aug.name);
    aug.price = ns.singularity.getAugmentationPrice(aug.name);  // TODO: estimate future prices with MultipleAugMultiplier = 1.9;
    aug.prereqs = ns.singularity.getAugmentationPrereq(aug.name);

    aug.stats = ns.singularity.getAugmentationStats(aug.name);
    aug.value = getAugmentationValue(ns, aug);

    aug.factions = getAugmentationFactions(ns, aug.name);

    aug.isUnique = (aug.factions.length == 1);
    aug.isSpecial = isAugmentationSpecial(aug);

    return aug;
}

export function isAugmentationSpecial(aug) {
    const specialFactions = ["Bladeburners", "Church of the Machine God"];
    if (Object.keys(aug.factions).some((f)=>specialFactions.includes(f))) {
        return true;
    }
    return false;
}

export function getAugmentationFactions(ns, augName) {
    const factions = {};
    for (const faction of ALL_FACTIONS) {
        if (ns.singularity.getAugmentationsFromFaction(faction).includes(augName)) {
            factions[faction] = [ns.singularity.getFactionRep(faction), ns.singularity.getAugmentationRepReq(augName)];
        }
    }
    return factions;
}

export function getAugmentationValue(ns, aug) {
    aug.value = {};
    for (const [domain, estimate] of Object.entries(DOMAINS)) {
        aug.value[domain] = estimate(aug);
    }
    return aug.value;
}

// -------------------- value estimators --------------------

export const DOMAINS = {
    "hacking":     estimateHackingValue,
    "charisma":    estimateCharismaValue,
    "combat":      estimateCombatValue,
    "crime":       estimateCrimeValue,
    "faction":     estimateFactionValue,
    "hacknet":     estimateHacknetValue,
    "bladeburner": estimateBladeburnerValue,
    "all":         estimateAllValue,
};

export function estimateHackingValue(aug) {
    const stats = aug.stats;
    let value = (
        (stats.hacking_mult || 1) *
        Math.sqrt(stats.hacking_exp_mult || 1) *
        Math.sqrt(stats.hacking_chance_mult || 1) *
        ((stats.hacking_money_mult || 1) + (stats.hacking_grow_mult || 1) - 1) *
        (stats.hacking_speed_mult || 1)
        
    );
    if (aug.name === "BitRunners Neurolink") {
        value += 0.05;
    }
    if (aug.name === "CashRoot Starter Kit") {
        value += 0.05;
    }
    if (aug.name === "PCMatrix") {
        value += 0.05;
    }
    if (aug.name === "The Red Pill") {
        value += 9;
    }
    return value;
}

export function estimateCombatValue(aug) {
    const stats = aug.stats;
    return (
        Math.sqrt(stats.agility_exp_mult || 1) * (stats.agility_mult || 1) - 1
        +
        Math.sqrt(stats.defense_exp_mult || 1) * (stats.defense_mult || 1) - 1
        +
        Math.sqrt(stats.strength_exp_mult || 1) * (stats.strength_mult || 1) - 1
        +
        Math.sqrt(stats.dexterity_exp_mult || 1) * (stats.dexterity_mult || 1) - 1
        +
        1
    )
}

export function estimateCharismaValue(aug) {
    const stats = aug.stats;
    return (
        Math.sqrt(stats.charisma_exp_mult || 1) *
        (stats.charisma_mult || 1)
    )
}

export function estimateCrimeValue(aug) {
    const stats = aug.stats;
    return (
        (stats.crime_money_mult || 1) * (stats.crime_success_mult || 1) - 1
        +
        1
    )
}

export function estimateFactionValue(aug) {
    const stats = aug.stats;
    let value = (
        (stats.company_rep_mult || 1) - 1
        +
        Math.sqrt(stats.work_money_mult || 1) - 1
        +
        (stats.faction_rep_mult || 1) - 1
        +
        1
    );
    if (aug.name === "Neuroreceptor Management Implant") {
        // Always get "focus" bonus
        value *= 1 / 0.8;
    }
    return value;
}

export function estimateHacknetValue(aug) {
    const stats = aug.stats;
    return (
        (1 / (stats.hacknet_node_purchase_cost_mult || 1)) - 1
        +
        (
            (stats.hacknet_node_money_mult || 1) *
            (1 / (stats.hacknet_node_level_cost_mult || 1)) *
            (1 / (stats.hacknet_node_core_cost_mult || 1)) *
            (1 / (stats.hacknet_node_ram_cost_mult || 1))
        ) - 1
        +
        1
    )
}

export function estimateBladeburnerValue(aug) {
    const stats = aug.stats;
    let value = (
        Math.sqrt(stats.agility_exp_mult || 1) * (stats.agility_mult || 1) - 1
        +
        Math.sqrt(stats.dexterity_exp_mult || 1) * (stats.dexterity_mult || 1) - 1
        +
        ((stats.bladeburner_success_chance_mult || 1) * (stats.bladeburner_stamina_gain_mult || 1)) - 1
        +
        (stats.bladeburner_max_stamina_mult || 1) - 1
        +
        (stats.bladeburner_analysis_mult || 1) - 1
        +
        1
    );
    if (aug.name === "The Blade's Simulacrum") {
        value += 0.7;
    }
    return value;
}

export function estimateAllValue(aug) {
    // assume this runs after other values have been populated.
    delete aug.value.all;
    return averageValue(aug);
}

export function averageValue(aug, domains) {
    if (!domains || domains.length == 0) {
        domains = Object.keys(aug.value);
    }
    if (domains.length == 0) {
        return 1.0;
    }
    let total = 1.0;
    for (const domain of domains) {
        total *= aug.value[domain];
    }
    const value = total ** (1/domains.length);
    return value;
}


/* -------------------- constants -------------------- */

export const ALL_FACTIONS = [
    "Illuminati", "Daedalus", "The Covenant",
    "ECorp", "MegaCorp", "Bachman & Associates", "Blade Industries", "NWO", "Clarke Incorporated", "OmniTek Incorporated", "Four Sigma", "KuaiGong International", "Fulcrum Secret Technologies",
    "BitRunners", "The Black Hand", "NiteSec", "CyberSec",
    "Aevum", "Chongqing", "Ishima", "New Tokyo", "Sector-12", "Volhaven",
    "Speakers for the Dead", "The Dark Army", "The Syndicate", "Silhouette", "Tetrads", "Slum Snakes",
    "Tian Di Hui",
    "Netburners",
    "Bladeburners",
    "Church of the Machine God",
];

export const ALL_AUGMENTATIONS = [
    "Augmented Targeting I",
    "Augmented Targeting II",
    "Augmented Targeting III",
    "Synthetic Heart",
    "Synfibril Muscle",
    "Combat Rib I",
    "Combat Rib II",
    "Combat Rib III",
    "Nanofiber Weave",
    "NEMEAN Subdermal Weave",
    "Wired Reflexes",
    "Graphene Bone Lacings",
    "Bionic Spine",
    "Graphene Bionic Spine Upgrade",
    "Bionic Legs",
    "Graphene Bionic Legs Upgrade",
    "Speech Processor Implant",
    "TITN-41 Gene-Modification Injection",
    "Enhanced Social Interaction Implant",
    "BitWire",
    "Artificial Bio-neural Network Implant",
    "Artificial Synaptic Potentiation",
    "Enhanced Myelin Sheathing",
    "Synaptic Enhancement Implant",
    "Neural-Retention Enhancement",
    "DataJack",
    "Embedded Netburner Module",
    "Embedded Netburner Module Core Implant",
    "Embedded Netburner Module Core V2 Upgrade",
    "Embedded Netburner Module Core V3 Upgrade",
    "Embedded Netburner Module Analyze Engine",
    "Embedded Netburner Module Direct Memory Access Upgrade",
    "Neuralstimulator",
    "Neural Accelerator",
    "Cranial Signal Processors - Gen I",
    "Cranial Signal Processors - Gen II",
    "Cranial Signal Processors - Gen III",
    "Cranial Signal Processors - Gen IV",
    "Cranial Signal Processors - Gen V",
    "Neuronal Densification",
    "Neuroreceptor Management Implant",
    "Nuoptimal Nootropic Injector Implant",
    "Speech Enhancement",
    "FocusWire",
    "PC Direct-Neural Interface",
    "PC Direct-Neural Interface Optimization Submodule",
    "PC Direct-Neural Interface NeuroNet Injector",
    "PCMatrix",
    "ADR-V1 Pheromone Gene",
    "ADR-V2 Pheromone Gene",
    "The Shadow's Simulacrum",
    "Hacknet Node CPU Architecture Neural-Upload",
    "Hacknet Node Cache Architecture Neural-Upload",
    "Hacknet Node NIC Architecture Neural-Upload",
    "Hacknet Node Kernel Direct-Neural Interface",
    "Hacknet Node Core Direct-Neural Interface",
    "NeuroFlux Governor",
    "Neurotrainer I",
    "Neurotrainer II",
    "Neurotrainer III",
    "HyperSight Corneal Implant",
    "LuminCloaking-V1 Skin Implant",
    "LuminCloaking-V2 Skin Implant",
    "HemoRecirculator",
    "SmartSonar Implant",
    "Power Recirculation Core",
    "QLink",
    "The Red Pill",
    "SPTN-97 Gene Modification",
    "ECorp HVMind Implant",
    "CordiARC Fusion Reactor",
    "SmartJaw",
    "Neotra",
    "Xanipher",
    "nextSENS Gene Modification",
    "OmniTek InfoLoad",
    "Photosynthetic Cells",
    "BitRunners Neurolink",
    "The Black Hand",
    "Unstable Circadian Modulator",
    "CRTX42-AA Gene Modification",
    "Neuregen Gene Modification",
    "CashRoot Starter Kit",
    "NutriGen Implant",
    "INFRARET Enhancement",
    "DermaForce Particle Barrier",
    "Graphene BrachiBlades Upgrade",
    "Graphene Bionic Arms Upgrade",
    "BrachiBlades",
    "Bionic Arms",
    "Social Negotiation Assistant (S.N.A)",
    "Hydroflame Left Arm",
    "EsperTech Bladeburner Eyewear",
    "EMS-4 Recombination",
    "ORION-MKIV Shoulder",
    "Hyperion Plasma Cannon V1",
    "Hyperion Plasma Cannon V2",
    "GOLEM Serum",
    "Vangelis Virus",
    "Vangelis Virus 3.0",
    "I.N.T.E.R.L.I.N.K.E.D",
    "Blade's Runners",
    "BLADE-51b Tesla Armor",
    "BLADE-51b Tesla Armor: Power Cells Upgrade",
    "BLADE-51b Tesla Armor: Energy Shielding Upgrade",
    "BLADE-51b Tesla Armor: Unibeam Upgrade",
    "BLADE-51b Tesla Armor: Omnibeam Upgrade",
    "BLADE-51b Tesla Armor: IPU Upgrade",
    "The Blade's Simulacrum",
    "Stanek's Gift - Genesis",
    "Stanek's Gift - Awakening",
    "Stanek's Gift - Serenity"
];
