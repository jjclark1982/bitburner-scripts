import { drawTable } from "/lib/box-drawing";

const FLAGS = [
    ["console", false]
];

export function autocomplete(data, args) {
    data.flags(FLAGS);
    return data.servers;
}

export async function main(ns) {
    const flags = ns.flags(FLAGS);
    const hostname = flags._[0] || 'phantasy';
    const server = new ServerModel(ns, hostname);
    
    ns.disableLog("scan");
    ns.clearLog();
    ns.tail();

    ns.print(reportMostProfitableServers(ns));

    ns.print(reportBatchLengthComparison(ns, server));

    if (flags.console) {
        eval("window").server = server;
        await ns.sleep(60*60*1000);
    }
}

export function reportMostProfitableServers(ns, server) {
    const columns = [
        {header: "Hostname", field: "hostname", width: 18, align: "left"},
        {header: "Prep Time", field: "prepTime", format: drawTable.time},
        {header: "RAM Needed", field: "ramNeeded", format: ns.nFormat, formatArgs: ["0.0 b"]},
        {header: "  $ / sec", field: "moneyPerSec", format: ns.nFormat, formatArgs: ["$0.0a"]},
        {header: "$/sec/GB", field: "moneyPerSecPerGB", format: ns.nFormat, formatArgs: ["$0.00a"]},
    ];
    columns.title = "Most Profitable Servers to Hack";
    const rows = mostProfitableServers(ns);
    return drawTable(columns, rows);
}

export function reportBatchLengthComparison(ns) {
    const server = new ServerModel(ns, ns.args[0] || "phantasy");
    const columns = [
        {header: "Condition", field: "condition", width: 28, align: "left"},
        {header: "Batches", field: "numBatchesAtOnce"},
        {header: "RAM Needed", field: "ramNeeded", format: ns.nFormat, formatArgs: ["0.0 b"]},
        {header: "  $ / sec", field: "moneyPerSec", format: ns.nFormat, formatArgs: ["$0.0a"]},
        {header: "$/sec/GB", field: "moneyPerSecPerGB", format: ns.nFormat, formatArgs: ["$0.00a"]},
    ];
    columns.title = "Comparison of batches with at most 1024 threads per job";
    const conditions = {};
    for (const moneyPercent of [0.05, 0.10, 0.20, 0.40, 0.80]) {
        for (const [hackMargin, prepMargin] of [[0,0], [0,0.25], [0.25, 0.5]]) {
            for (const naiveSplit of [true, false]) {
                server.estimateProfit(moneyPercent, 1024, 100, hackMargin, prepMargin, naiveSplit);
                server.condition = `${moneyPercent*100}% money, ${server.batchSummary}`;
                if (moneyPercent < 0.1) server.condition = ' ' + server.condition;
                conditions[server.condition] = server.copy();
            }
        }
    }
    return drawTable(columns, Object.values(conditions));
}

export function mostProfitableServers(ns) {
    const player = ns.getPlayer();
    const servers = getAllHosts(ns).map((host)=>{
        const server = new ServerModel(ns, host);
        return server;
    }).filter((server)=>(
        server.canBeHacked(player)
    ));
    for (const server of servers) {
        server.prepTime = server.estimatePrepTime();
        server.profit = server.estimateProfit(0.05, 128, 100, 0, 0.25);
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

    canBeHacked(player) {
        player ||= this.ns.getPlayer()
        return (
            this.hasAdminRights &&
            this.moneyMax > 0 &&
            this.requiredHackingSkill <= player.hacking
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
        const prevMoney = this.moneyAvailable;
        const moneyMult = 1 - effectivePct;
        this.moneyAvailable = Math.max(0, this.moneyAvailable * moneyMult);
        const moneyChange = this.moneyAvailable - prevMoney;

        const securityChange = ns.hackAnalyzeSecurity(threads);
        this.hackDifficulty += securityChange;

        // Construct job
        const job = {
            task: 'hack',
            threads: threads,
            args: [server.hostname, {threads: threads}],
            duration: duration,
            change: {moneyMult, moneyChange, securityChange},
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
        const prevMoney = this.moneyAvailable;
        const moneyMult = ns.formulas.hacking.growPercent(server, threads, player, cores);
        this.moneyAvailable = Math.min(this.moneyMax, (this.moneyAvailable + threads) * moneyMult);
        const moneyChange = this.moneyAvailable - prevMoney;

        const securityChange = ns.growthAnalyzeSecurity(threads);
        this.hackDifficulty += securityChange;

        // Construct job
        const job = {
            task: 'grow',
            threads: threads,
            args: [server.hostname, {threads: threads}],
            duration: duration,
            change: {moneyMult, moneyChange, securityChange},
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
            change: {moneyMult:1, moneyChange:0, securityChange},
            result: this.copy(),
        };
        return job;
    }

    planPrepBatch(maxThreadsPerJob=512, secMargin=1, naiveSplit=false) {
        // Make a list of 'grow' and 'weaken' jobs that will bring the server
        // to a ready state (maximum money and minimum security).
        const batch = new Batch();
        while (naiveSplit && this.hackDifficulty > this.minDifficulty + secMargin) {
            batch.push(this.planWeaken(maxThreadsPerJob));
        }
        while (this.moneyAvailable < this.moneyMax) {
            while (!naiveSplit && this.hackDifficulty > this.minDifficulty + secMargin) {
                batch.push(this.planWeaken(maxThreadsPerJob));
            }
            batch.push(this.planGrow(maxThreadsPerJob));
        }
        while (this.hackDifficulty > this.minDifficulty) {
            batch.push(this.planWeaken(maxThreadsPerJob));
        }
        return batch;
    }

    planHackingBatch(moneyPercent=0.05, maxThreadsPerJob=512, secMargin=0.5, prepMargin=1.5, naiveSplit=false) {
        // Make a list of jobs that will hack a server and then return it to a ready state.
        // Higher moneyPercent or secMargin will result in more threads per job.
        const batch = new Batch();
        batch.push(this.planHack(moneyPercent, maxThreadsPerJob))
        while (this.hackDifficulty < this.minDifficulty + secMargin) {
            batch.push(this.planGrow(maxThreadsPerJob));
            batch.push(this.planHack(moneyPercent, maxThreadsPerJob));
        }
        batch.push(...this.planPrepBatch(maxThreadsPerJob, prepMargin, naiveSplit));
        return batch;
    }

    estimatePrepTime(maxThreadsPerJob=128, tDelta=200) {
        const batch = this.planPrepBatch(maxThreadsPerJob);
        return batch.totalDuration(tDelta);
    }

    assumePrepped() {
        this.moneyAvailable = this.moneyMax;
        this.hackDifficulty = this.minDifficulty;
    }

    estimateProfit(moneyPercent=0.05, maxThreadsPerJob=128, tDelta=200, margin=0.0, prepMargin=0.5, naiveSplit=false) {
        this.assumePrepped();
        const batch = this.planHackingBatch(moneyPercent, maxThreadsPerJob, margin, prepMargin, naiveSplit);
        const hackJob = batch[0];

        const money = batch.moneyTaken();
        const totalDuration = batch.totalDuration(tDelta);
        const activeDuration = batch.activeDuration(tDelta);

        const numBatchesAtOnce = Math.floor(totalDuration / activeDuration);
        const totalMoney = money * numBatchesAtOnce;
        const moneyPerSec = totalMoney / (totalDuration / 1000);

        const totalRam = numBatchesAtOnce * batch.avgRam();

        this.batchSummary = batch.summary();
        this.numBatchesAtOnce = numBatchesAtOnce;
        this.ramNeeded = totalRam * 1e9;
        this.moneyPerSec = moneyPerSec;
        this.moneyPerSecPerGB = moneyPerSec / totalRam;
        return this.moneyPerSecPerGB;
    }
}

class Batch extends Array {
    summary() {
        const tasks = this.map((job)=>(job.task || '-').substr(0,1).toUpperCase());
        return tasks.join("");
    }

    peakThreads() {
        return this.reduce((total, job)=>(
            total + job.threads
        ), 0);
    }

    avgThreads() {
        const threadMSeconds = this.reduce((total,job)=>(
            total + job.threads * job.duration
        ), 0);
        return threadMSeconds / this.totalDuration();
    }

    peakRam() {
        return this.reduce((total, job)=>(
            total + job.threads * (TASK_RAM[job.task] || 2.0)
        ), 0);
    }

    avgRam() {
        const gbMSeconds = this.reduce((total,job)=>{
            const gb = TASK_RAM[job.task] || 2.0;
            return total + job.threads * gb * job.duration
        }, 0);
        return gbMSeconds / this.totalDuration();
    }

    moneyTaken() {
        return this.reduce((total, job)=>{
            if (job.change?.moneyChange < 0) {
                return total - job.change.moneyChange;
            }
            return total;
        }, 0);
    }

    activeDuration(tDelta=200) {
        return this.length * tDelta;
    }

    maxDuration() {
        return this.reduce((longest, job)=>(
            Math.max(longest, job.duration)
        ), 0);
    }

    totalDuration(tDelta=200) {
        if (!this.earliestStartTime()) {
            this.setStartTime(1, tDelta);
        }
        return this.latestEndTime() + tDelta - this.earliestStartTime();
        // return this.maxDuration() + this.activeDuration(tDelta);
    }

    latestEndTime() {
        return this[this.length-1]?.endTime;
    }

    earliestStartTime() {
        if (this.length == 0) {
            return null;
        }
        const earliest = this.reduce((e, job)=>(
            Math.min(e, job.startTime)
        ), Infinity);
        return earliest;
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

export function getAllHosts(ns) {
    getAllHosts.cache ||= {};
    const scanned = getAllHosts.cache;
    const toScan = ['home'];
    while (toScan.length > 0) {
        const host = toScan.shift();
        scanned[host] = true;
        for (const nextHost of ns.scan(host)) {
            if (!(nextHost in scanned)) {
                toScan.push(nextHost);
            }
        }
    }
    const allHosts = Object.keys(scanned);
    return allHosts;
}

const TASK_RAM = {
    'hack': 1.7,
    'grow': 1.75,
    'weaken': 1.75
};
