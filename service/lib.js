/**
 * Get a service from a Netscript port.
 * Returns undefined if no service is running right now.
 * @param {NS} ns 
 * @param {number} portNum 
 */
export function getService(ns, portNum) {
    const portHandle = ns.getPortHandle(portNum);
    if (!portHandle.empty()) {
        return portHandle.peek();
    }
}

/**
 * Get a service from a Netscript port.
 * Wait up to 2.5 seconds for the service to start (such as after reloading from save).
 * @param {NS} ns 
 * @param {number} portNum 
 */
export async function waitForService(ns, portNum) {
    const port = ns.getPortHandle(portNum);
    let tries = 50;
    while (port.empty() && tries-- > 0) {
        await ns.asleep(50);
    }
    if (port.empty()) {
        return null;
    }
    return port.peek();
}

/**
 * @typedef {Object} PortService - Service that makes an object available to other proecesses through a Netscript port.
 */
export class PortService {
    constructor(ns, portNum=1) {
        this.ns = ns;
        this.portNum = portNum;
        this.portHandle = ns.getPortHandle(portNum);
    }

    async serve(obj) {
        const {ns} = this;
        ns.disableLog("asleep");

        obj._service = this;
        this.object = obj;
        this.objectClassName = obj.constructor.name;
        this.objectName ||= this.objectClassName.substr(0,1).toLowerCase() + this.objectClassName.substr(1);

        // Replace any existing service on the same port.
        if (!this.portHandle.empty()) {
            const otherObj = this.portHandle.read();
            if (otherObj?._service) {
                otherObj._service.running = false;
                // await ns.asleep(1000);
            }
        }

        // Publish this service on the port.
        this.portHandle.clear();
        this.portHandle.write(this.object);

        // Publish this service in the browser's developer console.
        eval('window')[this.objectName] = this.object;
        eval('window')[`port${this.portNum}`] = this.object;

        // Unpublish this service when the process ends for any reason.
        ns.atExit(this.tearDown);

        // Block until something sets `this.running` to false.
        ns.tprint(`Started ${this.objectClassName} Service on port ${this.portNum}`);
        this.running = true;
        while (this.running) {
            if (typeof(this.object.report) === "function") {
                ns.clearLog();
                ns.print(this.report());    
            }
            await ns.asleep(1000);
        }
        this.tearDown();
        ns.tprint(`Stopped ${this.objectClassName} Service on port ${this.portNum}`);
    }

    tearDown = () => {
        this.running = false;
        if (this.portHandle.peek() === this.object) {
            this.portHandle.read();
        }
        delete eval('window')[this.objectName];
        delete eval('window')[`port${this.portNum}`];
    }
}

/** 
 * Example program to demonstrate functionality
 * @param {NS} ns 
 */
export async function main(ns) {
    const flags = ns.flags([
        ['port', 1]
    ]);

    function ExampleObject(){};
    const exampleObject = new ExampleObject();

    const exampleService = new PortService(ns, flags.port);
    await exampleService.serve(exampleObject);
}
