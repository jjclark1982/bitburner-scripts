export async function main(ns) {
    const hostname = ns.args[0] || 'phantasy';
    const server = new ServerModel(ns, hostname);
    eval("window").server = server;

    await ns.asleep(60*60*1000);
}

/*
shadow server class for planning potential sequences of actions
*/

export class ServerModel {
    constructor(ns, server) {
        this.ns = ns;
        if (typeof(server) === "string") {
            server = ns.getServer(server);
        }
        Object.assign(this, server);
    }

    reset() {
        Object.assign(this, this.ns.getServer(this.hostname));
    }

    copy() {
        return new ServerModel(this.ns, this);
    }

    planHack(moneyPercent, maxThreads=Infinity) {
        const {ns} = this;
        const server = this;
        const player = ns.getPlayer();
    
        const duration = ns.formulas.hacking.hackTime(server, player);

        // calculate threads
        const hackPercentPerThread = ns.formulas.hacking.hackPercent(server, player);
        const threads = Math.min(
            maxThreads,
            Math.ceil(moneyPercent / hackPercentPerThread)
        );
        const effectivePct = threads * hackPercentPerThread;

        // calculate result
        const moneyMult = 1 - effectivePct;
        this.moneyAvailable = Math.max(0, this.moneyAvailable * moneyMult);

        const securityChange = ns.hackAnalyzeSecurity(threads);
        this.hackDifficulty += securityChange;

        // construct job
        const job = {
            task: 'hack',
            args: [server.hostname, {threads: threads}],
            threads: threads,
            duration: duration,
            change: {moneyMult, securityChange},
            result: this.copy(),
        };
        return job;
    }

    planGrow(maxThreads, cores=1) {
        const {ns} = this;
        const server = this;
        const player = ns.getPlayer();

        const duration = ns.formulas.hacking.growTime(server, player);

        // calculate threads using unbounded binary search
        let minThreads = 1;
        if (!maxThreads) {
            const growMult = (server.moneyMax / server.moneyAvailable);
            const growMultPerThread = ns.formulas.hacking.growPercent(server, 1, player, cores);
            maxThreads = Math.ceil((growMult-1) / (growMultPerThread-1)) + 1;
        }
        while (maxThreads - minThreads > 1) {
            let midThreads = Math.ceil((minThreads + maxThreads) / 2);
            const serverGrowth = ns.formulas.hacking.growPercent(server, midThreads, player, cores);
            let newMoney = (server.moneyAvailable + midThreads) * serverGrowth;
            if (newMoney >= server.moneyMax) {
                maxThreads = midThreads;
            }
            else {
                minThreads = midThreads;
            }
        }
        const threads = maxThreads;

        // calculate result
        const moneyMult = ns.formulas.hacking.growPercent(server, threads, player, cores);
        this.moneyAvailable = Math.min(this.moneyMax, this.moneyAvailable * moneyMult);

        const securityChange = ns.growthAnalyzeSecurity(threads);
        this.hackDifficulty += securityChange;

        // construct job
        const job = {
            task: 'grow',
            args: [server.hostname, {threads: threads}],
            threads: threads,
            duration: duration,
            change: {moneyMult, securityChange},
            result: this.copy(),
        };
        return job;
    }

    planWeaken(maxThreads=Infinity, cores=1) {
        const {ns} = this;
        const server = this;
        const player = ns.getPlayer();
    
        const duration = ns.formulas.hacking.weakenTime(server, player);

        // calculate threads
        const weakSecPerThread = -ns.weakenAnalyze(1, cores);
        const neededSecurity = server.minDifficulty - server.hackDifficulty;
        const threads = Math.min(maxThreads, Math.ceil(neededSecurity / weakSecPerThread));

        // calculate result
        const securityChange = ns.weakenAnalyze(threads, cores);
        this.hackDifficulty = Math.max(this.minDifficulty, this.hackDifficulty - securityChange);

        // construct job
        const job = {
            task: 'weaken',
            args: [server.hostname, {threads: threads}],
            threads: threads,
            duration: duration,
            change: {moneyMult:1, securityChange},
            result: this.copy(),
        };
        return job;
    }

    planPrep(maxThreadsPerJob=512) {
        // Make a list of 'grow' and 'weaken' jobs that will bring the server
        // to maximum money and minimum security.
        const jobs = [];
        while (this.moneyAvailable < this.moneyMax) {
            while (this.hackDifficulty > this.minDifficulty+1) {
                jobs.push(this.planWeaken(maxThreadsPerJob));
            }
            jobs.push(this.planGrow(maxThreadsPerJob));
        }
        while (this.hackDifficulty > this.minDifficulty) {
            jobs.push(this.planWeaken(maxThreadsPerJob));
        }
        return jobs;
    }

    planBatch(moneyPercent=0.05, maxThreadsPerJob=512) {
        const jobs = [];
        jobs.push(this.planHack(moneyPercent, maxThreadsPerJob))
        jobs.push(...this.planPrep(maxThreadsPerJob));
        return jobs;
    }
}
