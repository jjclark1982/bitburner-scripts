/*

/augmentations/info.js

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
    return AugmentationNames;
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
        const summary = [
            augName,
            '',
            `Price: ${ns.nFormat(ns.getAugmentationPrice(augName), "$0.0a")}`,
            `Required Reputation: ${ns.nFormat(ns.getAugmentationRepReq(augName), "0,0")}`,
            `Factions: ${JSON.stringify(getAugmentationFactions(ns, augName), null, 2)}`,
            `Prereqs: ${JSON.stringify(ns.getAugmentationPrereq(augName), null, 2)}`,
            `Stats: ${JSON.stringify(ns.getAugmentationStats(augName), null, 2)}`,
            ''
        ];
        ns.print(summary.join("\n"));
        return;
    }

    const sourceFiles = {};
    for (const sourceFile of ns.getOwnedSourceFiles().sort((a,b)=>a.n-b.n)) {
        sourceFiles[`SourceFile${sourceFile.n}`] = sourceFile.lvl;
    }
    ns.print("Source Files: ", JSON.stringify(sourceFiles, null, 2), "\n");

    const installedAugs = ns.getOwnedAugmentations(false);
    ns.print("Installed Augmentations: ", JSON.stringify(installedAugs, null, 2), "\n");

    const purchasedAugs = ns.getOwnedAugmentations(true).filter(function(aug){
        return !installedAugs.includes(aug);
    });
    ns.print("Purchased Augmentations: ", JSON.stringify(purchasedAugs, null, 2), "\n");
}

export function getAugmentationFactions(ns, augName) {
    const factions = [];
    for (const faction of ns.getPlayer().factions) {
        if (ns.getAugmentationsFromFaction(faction).includes(augName)) {
            factions.push(faction);
        }
    }
    return factions;
}

const AugmentationNames = [
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
