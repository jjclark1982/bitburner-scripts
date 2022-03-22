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
> run /augmentations/future.js combat crime faction

Future Augmentation Plan: combat, crime, faction
       1,777 more reputation with Speakers for the Dead for 'The Shadow's Simulacrum'
      37,042 more reputation with Tian Di Hui for 'Neuroreceptor Management Implant'
      62,465 more reputation with NiteSec for 'Graphene BrachiBlades Upgrade'
      70,744 more reputation with The Syndicate for 'Bionic Legs'
      89,045 more reputation with The Black Hand for 'The Black Hand'
  ...
```
