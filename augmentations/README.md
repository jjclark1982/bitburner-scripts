### Bitburner Augmentation Scripts

#### [`/augmentations/info.js`](info.js)
Show information about augmentations

Example: List installed augmentations
```
> run /augmentations/info.js
```

Example: Show stats of a specific augmentation (supports autocomplete)
```
> run /augmentations/info.js Cranial Signal Processors - Gen III

Cranial Signal Processors - Gen III

Price: $550.0m
Required Reputation: 50,000
Prereqs: [
  "Cranial Signal Processors - Gen II"
]
Stats: {
  "hacking_mult": 1.09,
  "hacking_speed_mult": 1.02,
  "hacking_money_mult": 1.15
}
```

#### [`/augmentations/plan.js`](plan.js)
List the best augmentations available now, most expensive first.

Usage:
```
/augmentations/plan.js [ hacking | charisma | combat | crime | faction | hacknet | bladeburner | neuroflux | all ... ] [ --buy ]
```

Example: See all augs that increase hacking or hacknet
```
> run /augmentations/plan.js hacking hacknet

Augmentation Plan: hacking, hacknet
  'Neuralstimulator' from Sector-12 for $3.0b
  'Neural-Retention Enhancement' from NiteSec for $250.0m
  'Embedded Netburner Module' from NiteSec for $250.0m
  'Cranial Signal Processors - Gen I' from NiteSec for $70.0m
  'Cranial Signal Processors - Gen II' from NiteSec for $125.0m
  'Power Recirculation Core' from NiteSec for $180.0m
  ...
```

Example: Buy all augs that increase hacking, including NeuroFlux Governor repeatedly (same as `buy.js`)
```
> run /augmentations/plan.js hacking neuroflux --buy
```

#### [`/augmentations/buy.js`](buy.js)
Buy the best augmentations available now, most expensive first.

Usage: 
```
/augmentations/buy.js [ hacking | charisma | combat | crime | faction | hacknet | bladeburner | neuroflux | all ... ]
```

Example: Buy all augs that increase hacking, including NeuroFlux Governor repeatedly
```
> run /augmentations/buy.js hacking neuroflux
```

#### [`/augmentations/future.js`](future.js)
List the best augmentations available soon, sorted by least reputation required.

Example: Show all augs that improve combat or crime, and the closest faction to selling them
```
> run /augmentations/buy.js combat crime

Future Augmentation Plan: combat, crime
  'NeuroFlux Governor' from Tetrads for 1,564 more reputation
  'LuminCloaking-V2 Skin Implant' from Tetrads for 2,995 more reputation
  'Combat Rib III' from The Syndicate for 3,686 more reputation
  ...
```
