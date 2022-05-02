## Library Scripts

This folder is for scripts that:

- have 0 RAM import cost
- can be used in more than one context
- have no `main` functionality (other than usage example)

---

### box-drawing.js

[box-drawing.js](box-drawing.js) is a library for drawing tables with unicode [box-drawing characters](https://en.wikipedia.org/wiki/Box-drawing_character).

Example output:
```
┌───────┬───────┬────────┬─────────────┐
│ Name  │ Count │ Status │ Time        │
├───────┼───────┼────────┼─────────────┤
│   A   │     2 │        │             │
│   B   │    10 │        │             │
│   C   │       │ idle   │             │
│   D   │       │        │    20:05:15 │
│   E   │       │ longe… │             │
└───────┴───────┴────────┴─────────────┘
```

---

### port-service.js

[port-service.js](port-service.js) defines the `PortService` class, which makes an object available through a [Netscript Port](https://bitburner.readthedocs.io/en/latest/netscript/netscriptmisc.html#netscript-ports). It is useful for avoiding redundant RAM costs for optional functionality.

###### Example: Load stock information if it is available

```javascript
import { getService } from "/lib/port-service";
const stockService = getService(ns, 5);
const sharesHeld = stockService?.getStockInfo("Four Sigma")?.shares || 0;
```
