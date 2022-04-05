import { drawTable } from "/lib/box-drawing";
import { getAllHosts } from "/net/server-pool";

export async function main(ns) {
    const hostname = ns.args[0] || 'phantasy';
    const server = new ServerModel(ns, hostname);
    eval("window").server = server;

    ns.disableLog("scan");
    ns.clearLog();
    ns.tail();

    const columns = [
        {header: "Hostname", field: "hostname", width: 18, align: "left"},
        {header: "Prep Time", field: "prepTime", format: drawTable.time},
        {header: "RAM Needed", field: "ramNeeded", format: ns.nFormat, formatArgs: ["0.0 b"]},
        {header: "  $ / sec", field: "moneyPerSec", format: ns.nFormat, formatArgs: ["$0.0a"]},
    ];
    columns.title = "Most Profitable Servers to Hack";
    const rows = mostProfitableServers(ns);
    ns.print(drawTable(columns, rows));
}

export function mostProfitableServers(ns) {
    const servers = getAllHosts(ns).map((host)=>{
        const server = new ServerModel(ns, host);
        return server;
    }).filter((server)=>(
        server.isHackable()
    ));
    for (const server of servers) {
        server.prepTime = server.estimatePrepTime();
        server.profit = server.estimateProfit();
        server.reload();
    }
    return servers.sort((a,b)=>(
        b.profit - a.profit
    ));
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

    isHackable() {
        return (
            this.hasAdminRights &&
            this.moneyMax > 0 &&
            this.requiredHackingSkill <= this.ns.getPlayer().hacking
        )
    }

    reload() {
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

        // Calculate threads
        moneyPercent = Math.min(moneyPercent, 1.0);
        const hackPercentPerThread = ns.formulas.hacking.hackPercent(server, player);
        const threads = Math.min(
            maxThreads,
            Math.ceil(moneyPercent / hackPercentPerThread)
        );
        const effectivePct = threads * hackPercentPerThread;

        // Calculate result
        const playerMoney = this.moneyAvailable * effectivePct;
        const moneyMult = 1 - effectivePct;
        this.moneyAvailable = Math.max(0, this.moneyAvailable * moneyMult);

        const securityChange = ns.hackAnalyzeSecurity(threads);
        this.hackDifficulty += securityChange;


        // Construct job
        const job = {
            task: 'hack',
            threads: threads,
            args: [server.hostname, {threads: threads}],
            duration: duration,
            change: {moneyMult, securityChange, playerMoney},
            result: this.copy(),
        };
        return job;
    }

    planGrow(maxThreads, cores=1) {
        const {ns} = this;
        const server = this;
        const player = ns.getPlayer();

        const duration = ns.formulas.hacking.growTime(server, player);

        // Calculate threads using binary search
        let minThreads = 1;
        if (!maxThreads) {
            // Establish an upper bound based on the single-thread formula which will be too high.
            const growMult = server.moneyMax / Math.max(server.moneyMax, (server.moneyAvailable + minThreads));
            const growMultPerThread = ns.formulas.hacking.growPercent(server, minThreads, player, cores);
            maxThreads = Math.ceil((growMult-1) / (growMultPerThread-1)) + 1;
        }
        while (maxThreads - minThreads > 1) {
            const midThreads = Math.ceil((minThreads + maxThreads) / 2);
            const serverGrowth = ns.formulas.hacking.growPercent(server, midThreads, player, cores);
            const newMoney = (server.moneyAvailable + midThreads) * serverGrowth;
            if (newMoney >= server.moneyMax) {
                maxThreads = midThreads;
            }
            else {
                minThreads = midThreads;
            }
        }
        const threads = maxThreads;

        // Calculate result
        const moneyMult = ns.formulas.hacking.growPercent(server, threads, player, cores);
        this.moneyAvailable = Math.min(this.moneyMax, (this.moneyAvailable + threads) * moneyMult);

        const securityChange = ns.growthAnalyzeSecurity(threads);
        this.hackDifficulty += securityChange;

        // Construct job
        const job = {
            task: 'grow',
            threads: threads,
            args: [server.hostname, {threads: threads}],
            duration: duration,
            change: {moneyMult, securityChange, playerMoney:0},
            result: this.copy(),
        };
        return job;
    }

    planWeaken(maxThreads=Infinity, cores=1) {
        const {ns} = this;
        const server = this;
        const player = ns.getPlayer();
    
        const duration = ns.formulas.hacking.weakenTime(server, player);

        // Calculate threads
        const securityPerThread = -ns.weakenAnalyze(1, cores);
        const neededSecurity = server.minDifficulty - server.hackDifficulty;
        const threads = Math.min(maxThreads, Math.ceil(neededSecurity / securityPerThread));

        // Calculate result
        const securityChange = -ns.weakenAnalyze(threads, cores);
        this.hackDifficulty = Math.max(this.minDifficulty, this.hackDifficulty + securityChange);

        // Construct job
        const job = {
            task: 'weaken',
            threads: threads,
            args: [server.hostname, {threads: threads}],
            duration: duration,
            change: {moneyMult:1, securityChange, playerMoney:0},
            result: this.copy(),
        };
        return job;
    }

    planPrepBatch(maxThreadsPerJob=512, secMargin=1) {
        // Make a list of 'grow' and 'weaken' jobs that will bring the server
        // to a ready state (maximum money and minimum security).
        const batch = new Batch();
        while (this.moneyAvailable < this.moneyMax) {
            while (this.hackDifficulty > this.minDifficulty + secMargin) {
                batch.push(this.planWeaken(maxThreadsPerJob));
            }
            batch.push(this.planGrow(maxThreadsPerJob));
        }
        while (this.hackDifficulty > this.minDifficulty) {
            batch.push(this.planWeaken(maxThreadsPerJob));
        }
        return batch;
    }

    planHackingBatch(moneyPercent=0.05, maxThreadsPerJob=512, secMargin=0.5) {
        // Make a list of jobs that will hack a server and then return it to a ready state.
        // Higher moneyPercent or secMargin will result in more threads per job.
        const batch = new Batch();
        batch.push(this.planHack(moneyPercent, maxThreadsPerJob))
        while (this.hackDifficulty < this.minDifficulty + secMargin) {
            batch.push(this.planGrow(maxThreadsPerJob));
            batch.push(this.planHack(moneyPercent, maxThreadsPerJob));
        }
        batch.push(...this.planPrepBatch(maxThreadsPerJob, secMargin+1));
        return batch;
    }

    estimatePrepTime(maxThreadsPerJob=128, tDelta=200) {
        const batch = this.planPrepBatch(maxThreadsPerJob);
        return batch.totalDuration();
    }

    estimateProfit(moneyPercent=0.05, maxThreadsPerJob=128, tDelta=200) {
        this.planPrepBatch(maxThreadsPerJob);
        const batch = this.planHackingBatch(moneyPercent, maxThreadsPerJob);
        const hackJob = batch[0];

        const money = batch.reduce((total, job)=>(
            total + job.change.playerMoney
        ), 0);
        const activeDuration = batch.activeDuration(tDelta);
        const moneyPerSec = money / (activeDuration/1000);

        const numBatchesAtOnce = Math.floor(batch.totalDuration(tDelta) / activeDuration);

        const totalThreads = numBatchesAtOnce * batch.avgThreads();
        const ramNeeded = totalThreads * 2e9;

        this.ramNeeded = ramNeeded;
        this.moneyPerSec = moneyPerSec;
        return moneyPerSec / totalThreads;
    }
}

class Batch extends Array {
    activeDuration(tDelta=200) {
        return this.length * tDelta;
    }

    maxDuration() {
        return this.sort((a,b)=>b.duration-a.duration)[0]?.duration || 0;
    }

    totalDuration(tDelta) {
        return this.maxDuration() + this.activeDuration(tDelta);
    }

    peakThreads() {
        return this.reduce((total, job)=>(total+job.threads), 0);
    }

    avgThreads() {
        const threadSeconds = this.reduce((total,job)=>(
            total + job.threads * job.duration
        ), 0);
        return threadSeconds / this.totalDuration();
    }

    setFirstEndTime(firstEndTime, tDelta=200) {
        let endTime = firstEndTime;
        for (const job of this) {
            job.endTime = endTime;
            endTime += tDelta;
            job.startTime = job.endTime - job.duration;
        }
    }

    setStartTime(startTime, tDelta=200) {
        if (this.length > 0) {
            if (!this[0].startTime) {
                this.setFirstEndTime(startTime + this[0].duration, tDelta);
            }
            const earliestStart = this.earliestStartTime();
            if (earliestStart < startTime) {
                this.adjustSchedule(startTime - earliestStart);
            }
        }
    }

    earliestStartTime() {
        if (this.length == 0) {
            return null;
        }
        earliest = Infinity;
        for (const job of this) {
            earliest = Math.min(earliest, job.startTime);
        }
        return earliest;
    }

    adjustSchedule(offset) {
        if (!offset) {
            offset = Date.now() - this.earliestStartTime()
        }
        for (const job of this) {
            job.startTime += offset;
            job.endTime += offset;
        }
    }
}
