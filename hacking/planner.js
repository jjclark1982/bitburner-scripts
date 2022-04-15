import { drawTable } from "/lib/box-drawing";
import { ServerService } from "/service/servers"; // only used for max ram default value

const FLAGS = [
    ["console", false],
    ["tDelta", 100],
    ["maxTotalRam", 0],
    ["maxThreadsPerJob", 0],
    ["reserveRam", true]
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

    if (!(flags.maxTotalRam && flags.maxThreadsPerJob)) {
        const backend = new ServerService(ns);
        const scriptRam = 1.75;
        flags.maxTotalRam ||= (backend.totalThreadsAvailable(scriptRam) * scriptRam * 0.9);
        flags.maxThreadsPerJob ||= Math.floor(backend.maxThreadsAvailable(scriptRam) / 4);
    }

    ns.print(reportMostProfitableServers(ns, flags));

    ns.print(reportBatchLengthComparison(ns, server, flags));

    if (flags.console) {
        eval("window").server = server;
        await ns.asleep(60*60*1000);
    }
}

export function reportMostProfitableServers(ns, params) {
    const columns = [
        {header: "Hostname", field: "server.hostname", width: 18, align: "left"},
        {header: "Parameters", field: "condition", width: 16, align: "left", truncate: true},
        {header: "Prep Time", field: "prepTime", format: drawTable.time},
        {header: "RAM Used", field: "totalRamBytes", format: ns.nFormat, formatArgs: ["0.0 b"]},
        {header: "  $ / sec", field: "moneyPerSec", format: ns.nFormat, formatArgs: ["$0.0a"]},
        // {header: "Max threads/job", field: "maxThreadsPerJob"}
        // {header: "$/sec/GB", field: "moneyPerSecPerGB", format: ns.nFormat, formatArgs: ["$0.00a"]},
    ];
    columns.title = `Most Profitable Servers to Hack (${ns.nFormat(params.maxTotalRam*1e9, "0.0 b")} total RAM)`;
    const rows = mostProfitableServers(ns, [], params);
    eval("window").mostProfitableServers = rows;
    return drawTable(columns, rows);
}

export function reportBatchLengthComparison(ns, server, params) {
    server ||= new ServerModel(ns, ns.args[0] || "phantasy");
    const columns = [
        {header: "Condition", field: "condition", width: 28, align: "left", truncate: true},
        // {header: "Duration", field: "duration", format: drawTable.time},
        {header: "Batches", field: "numBatchesAtOnce"},
        {header: "Max t", field: "maxThreadsPerJob"},
        {header: "RAM Used", field: "totalRamBytes", format: ns.nFormat, formatArgs: ["0.0 b"]},
        {header: "  $ / sec", field: "moneyPerSec", format: ns.nFormat, formatArgs: ["$0.0a"]},
        // {header: "$/sec/GB", field: "moneyPerSecPerGB", format: ns.nFormat, formatArgs: ["$0.00a"]},
    ];
    columns.title = `Comparison of batches (${ns.nFormat(params.maxTotalRam*1e9, "0.0 b")} total RAM, max ${params.maxThreadsPerJob} threads per job)`;
    const estimates = server.sweepParameters(params);
    const estimatesByMoneyPct = {}
    for (const estimate of estimates) {
        estimate.totalRamBytes = estimate.peakRam * 1e9;
        estimatesByMoneyPct[estimate.params.moneyPercent] ||= [];
        estimatesByMoneyPct[estimate.params.moneyPercent].push(estimate);
    }
    const bestEstimates = {};
    for (const moneyPercent of Object.keys(estimatesByMoneyPct)) {
        const estimates = estimatesByMoneyPct[moneyPercent].sort((a,b)=>(
            b.moneyPerSec - a.moneyPerSec
        ));
        for (const estimate of estimates) {
            bestEstimates[estimate.condition] = estimate;
            break;
        }
    }
    return drawTable(columns, Object.values(bestEstimates));
}

export function *getHackableServers(ns, hostnames) {
    const player = ns.getPlayer();
    if (!hostnames || hostnames.length == 0) {
        hostnames = getAllHosts(ns);
    }
    for (const hostname of hostnames) {
        const server = new ServerModel(ns, hostname);
        if (server.canBeHacked(player)) {
            yield server;
        }
    }
}

export function mostProfitableServers(ns, hostnames, params) {
    const plans = [];
    for (const server of getHackableServers(ns, hostnames)) {
        const bestParams = server.mostProfitableParamsSync(params);
        const batchCycle = server.planBatchCycle(bestParams);
        batchCycle.prepTime = server.estimatePrepTime(params);
        const ONE_HOUR = 60 * 60 * 1000;
        const cycleTimeInNextHour = Math.max(1000, ONE_HOUR - batchCycle.prepTime);
        batchCycle.moneyInNextHour = batchCycle.moneyPerSec * cycleTimeInNextHour;
        batchCycle.server = server;
        batchCycle.totalRamBytes = batchCycle.peakRam * 1e9;
        server.reload();
        plans.push(batchCycle);
    }
    const bestPlans = plans.sort((a,b)=>(
        b.moneyInNextHour - a.moneyInNextHour
    ));
    return bestPlans;
}

/**
 * A ServerModel tracks the state of a server through multiple hacking operations.
 * It has all the fields of a Netscript Server object, plus methods to mutate state.
 */
export class ServerModel {
    constructor(ns, server) {
        this.ns = ns;
        if (typeof(server) === "string") {
            this.hostname = server;
            this.reload();
        }
        else {
            Object.assign(this, server);
        }
    }

    canBeHacked(player) {
        player ||= this.ns.getPlayer()
        return (
            this.hasAdminRights &&
            this.moneyMax > 0 &&
            this.requiredHackingSkill <= player.hacking
        )
    }

    isPrepared(secMargin=0.75, moneyMargin=0.125) {
        return (
            this.hackDifficulty < this.minDifficulty + secMargin &&
            this.moneyAvailable > this.moneyMax * (1 - moneyMargin)
        )
    }

    reload() {
        Object.assign(this, this.ns.getServer(this.hostname));
        this.prepDifficulty = this.hackDifficulty;
        return this;
    }

    copy() {
        return new ServerModel(this.ns, this);
    }

    preppedCopy() {
        const server = this.copy();
        server.moneyAvailable = server.moneyMax;
        server.hackDifficulty = server.minDifficulty;
        server.prepDifficulty = server.minDifficulty;
        return server;
    }

    /**
     * Plan a "hack" job and mutate this server state to reflect its results.
     * @param {number} [moneyPercent=0.05] - Amount of money to hack, from 0.0 to 1.0
     * @param {number} [maxThreads]
     * @param {boolean} [stock=false] - whether to manipulate stock prices
     * @returns {Job}
     */
    planHack(moneyPercent=0.05, maxThreads=Infinity, stock) {
        const {ns} = this;
        const server = this;
        const player = ns.getPlayer();

        // Calculate duration based on last known security level
        const duration = ns.formulas.hacking.hackTime(
            {...server, hackDifficulty: this.prepDifficulty},
            player
        );

        // Calculate threads
        moneyPercent = Math.max(0, Math.min(1.0, moneyPercent));
        const hackPercentPerThread = ns.formulas.hacking.hackPercent(server, player) || 0.00001;
        let threads = Math.ceil(moneyPercent / hackPercentPerThread);
        if (threads > maxThreads) {
            // Split threads evenly among jobs
            const numJobs = Math.ceil(threads / maxThreads);
            threads = Math.ceil(threads / numJobs);
        }

        // Calculate result
        const effectivePercent = Math.min(1, threads * hackPercentPerThread);
        const moneyMult = 1 - effectivePercent;
        const moneyChange = this.moneyAvailable * -effectivePercent;
        this.moneyAvailable = this.moneyAvailable * moneyMult;

        const securityChange = ns.hackAnalyzeSecurity(threads);
        this.hackDifficulty += securityChange;

        // Construct job
        const job = {
            task: 'hack',
            threads: threads,
            args: [server.hostname, {threads, stock}],
            duration: duration,
            change: {moneyMult, moneyChange, securityChange},
            result: this.copy(),
        };
        return job;
    }

    /**
     * Plan a "grow" job and mutate this server state to reflect its results.
     * @param {number} [maxThreads] 
     * @param {number} [cores=1]
     * @param {boolean} [stock=false] - whether to manipulate stock prices
     * @returns {Job}
     */
    planGrow(maxThreads=Infinity, cores=1, stock) {
        const {ns} = this;
        const server = this;
        const player = ns.getPlayer();

        // Calculate duration based on last known security level
        const duration = ns.formulas.hacking.growTime(
            {...server, hackDifficulty: this.prepDifficulty},
            player
        );

        // Calculate threads using binary search
        let loThreads = 1;
        let hiThreads = maxThreads;
        if (!hiThreads || hiThreads < 1 || hiThreads == Infinity) {
            // Establish an upper bound based on the single-thread formula which will be too high.
            const growMult = server.moneyMax / Math.min(server.moneyMax, (server.moneyAvailable + 1));
            const growMultPerThread = ns.formulas.hacking.growPercent(server, 1, player, cores);
            hiThreads = Math.ceil((growMult-1) / (growMultPerThread-1)) + 1;
        } 
        while (hiThreads - loThreads > 1) {
            const midThreads = Math.ceil((loThreads + hiThreads) / 2);
            const serverGrowth = ns.formulas.hacking.growPercent(server, midThreads, player, cores);
            const newMoney = (server.moneyAvailable + midThreads) * serverGrowth;
            if (newMoney >= server.moneyMax) {
                hiThreads = midThreads;
            }
            else {
                loThreads = midThreads;
            }
        }
        const threads = hiThreads;

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
            args: [server.hostname, {threads, stock}],
            duration: duration,
            change: {moneyMult, moneyChange, securityChange},
            result: this.copy(),
        };
        return job;
    }

    /**
     * Plan a 'weaken' job and mutate this server state to reflect its results.
     * @param {number} [maxThreads] 
     * @param {number} [cores=1] 
     * @returns {Job}
     */
    planWeaken(maxThreads=Infinity, cores=1) {
        const {ns} = this;
        const server = this;
        const player = ns.getPlayer();
    
        // Calculate duration based on last known security level
        const duration = ns.formulas.hacking.weakenTime(
            {...server, hackDifficulty: this.prepDifficulty},
            player
        );

        // Calculate threads
        const securityPerThread = -ns.weakenAnalyze(1, cores);
        const neededSecurity = server.minDifficulty - server.hackDifficulty - 1;
        const threads = Math.min(
            // Split threads with larger jobs first.
            maxThreads,
            Math.ceil(neededSecurity / securityPerThread)
        );

        // Calculate result
        const prevDifficulty = this.hackDifficulty;
        this.hackDifficulty = Math.max(this.minDifficulty, this.hackDifficulty - ns.weakenAnalyze(threads, cores));
        const securityChange = this.hackDifficulty - this.prevDifficulty;

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

    /** 
     * Construct a batch of 'grow' and 'weaken' jobs that will bring the server
     * to a ready state (maximum money and minimum security).
     * @param {Object} params
     * @param {number} [params.maxThreadsPerJob=512]
     * @param {number} [params.prepMargin=0.5] - amount of security above minimum to allow between jobs
     * @param {boolean} [params.naiveSplit=false] - whether to place all jobs of the same type together
     * @param {boolean} [params.growStock] - whether to manipulate stock performance for 'grow' actions
     * @param {number} [params.cores=1]
     * @retruns {Batch}
     */
    planPrepBatch(params) {
        const defaults = {
            maxThreadsPerJob: 512,
            prepMargin: 0.5,
            naiveSplit: false,
            growStock: this.getStockInfo()?.netShares >= 0,
            cores: 1
        };
        params = Object.assign({}, defaults, params);
        const {maxThreadsPerJob, prepMargin, naiveSplit, growStock, cores} = params;

        const batch = new Batch();
        while (naiveSplit && this.hackDifficulty > this.minDifficulty + prepMargin) {
            batch.push(this.planWeaken(maxThreadsPerJob, cores));
        }
        while (this.moneyAvailable < this.moneyMax) {
            while (!naiveSplit && this.hackDifficulty > this.minDifficulty + prepMargin) {
                batch.push(this.planWeaken(maxThreadsPerJob, cores));
            }
            batch.push(this.planGrow(maxThreadsPerJob, cores, growStock));
        }
        while (this.hackDifficulty > this.minDifficulty) {
            batch.push(this.planWeaken(maxThreadsPerJob, cores));
        }
        this.prepDifficulty = this.hackDifficulty; // This isn't true until some delay has passed. Should that delay be represented in the batch data structure?
        return batch;
    }

    /** 
     * Construct a Batch of jobs that will hack a server and then return it to a ready state.
     * Higher moneyPercent or hackMargin will result in more threads per job.
     * @param {Object} params - Parameters for jobs to add to the batch. Additional values will be passed to planPrepBatch.
     * @param {number}
     * @param {number} [params.maxThreadsPerJob=512]
     * @param {number} [params.prepMargin=0.5] - amount of security above minimum to allow between jobs
     * @param {boolean} [params.naiveSplit=false] - whether to place all jobs of the same type together
     * @param {boolean} [params.hackStock] - whether to manipulate stock performance for 'hack' actions
     * @param {boolean} [params.growStock] - whether to manipulate stock performance for 'grow' actions
     * @param {number} [params.cores=1]
     * @retruns {Batch}
     */
     planHackingBatch(params) {
        const defaults = {
            moneyPercent: 0.05,
            maxThreadsPerJob: 512,
            hackMargin: 0.25,
            hackStock: this.getStockInfo()?.netShares < 0,
            growStock: this.getStockInfo()?.netShares >= 0,
            cores: 1
        };
        params = Object.assign({}, defaults, params);
        const {moneyPercent, maxThreadsPerJob, hackMargin, hackStock, growStock, cores} = params;

        const batch = new Batch();
        batch.push(this.planHack(moneyPercent, maxThreadsPerJob, hackStock))
        while (this.hackDifficulty < this.minDifficulty + hackMargin) {
            batch.push(this.planGrow(maxThreadsPerJob, cores, growStock));
            batch.push(this.planHack(moneyPercent, maxThreadsPerJob, hackStock));
        }
        batch.push(...this.planPrepBatch(params));
        return batch;
    }

    /**
     * Calculate the amount of time it will take to bring a server from its current state
     * to a ready state (max money and min security).
     * @param {Object} params - Parameters for jobs to add to the batch. Additional values will be passed to planHackBatch and planPrepBatch.
     * @param {number} [params.tDelta=100] - milliseconds between job completions
     * @returns {number} ms
     */
    estimatePrepTime(params) {
        const defaults = {
            tDelta: 100
        };
        params = Object.assign({}, defaults, params);
        const {tDelta} = params;
        const batch = this.planPrepBatch(params);
        return batch.totalDuration(tDelta);
    }

    /**
     * Calculate metrics of a hacking batch.
     * @param {Object} params - Parameters for jobs to add to the batch. Additional values will be passed to planHackBatch and planPrepBatch.
     * @param {number} [params.maxTotalRam=4096] - GB of ram to use for multiple batches
     * @param {number} [params.tDelta=100] - milliseconds between job completions
     * @param {boolean} [params.reserveRam=false] - whether to plan based on peak RAM usage instead of average RAM usage
     * @returns {BatchCycle} Details of the planned batch cycle
     */
    planBatchCycle(params){
        const defaults = {
            moneyPercent: 0.05,
            maxTotalRam: 16384,
            maxThreadsPerJob: 512,
            hackMargin: 0.25,
            prepMargin: 0.5,
            naiveSplit: false,
            cores: 1,
            tDelta: 100,
            reserveRam: false
        };
        params = Object.assign({}, defaults, params);
        const {moneyPercent, maxTotalRam, tDelta, reserveRam} = params;

        const server = this.preppedCopy();
        const batch = server.planHackingBatch(params);

        const moneyPerBatch = batch.moneyTaken();
        const period = batch.totalDuration(tDelta);

        const numBatchesAtOnce = batch.maxBatchesAtOnce(maxTotalRam, tDelta, reserveRam);
        const timeBetweenStarts = period / numBatchesAtOnce;

        const totalMoney = moneyPerBatch * numBatchesAtOnce;
        const moneyPerSec = totalMoney / (period / 1000);

        // const totalThreads = numBatchesAtOnce * batch.avgThreads(tDelta);
        // const moneyPerSecPerThread = moneyPerSec / totalThreads;
        const peakRam = numBatchesAtOnce * batch.peakRam();
        const avgRam = numBatchesAtOnce * batch.avgRam(tDelta);
        const moneyPerSecPerGB = moneyPerSec / avgRam;

        const maxThreads = batch.maxThreads();
        const condition = `${batch.moneySummary()} ${batch.summary()}`;

        const batchCycle = {
            condition,
            batch,
            params,
            period,
            numBatchesAtOnce,
            timeBetweenStarts,
            peakRam,
            avgRam,
            moneyPerSec,
            moneyPerSecPerGB,
            maxThreadsPerJob: maxThreads
        };
        return batchCycle;
    }

    /**
     * Sweep parameters to survey various types of batches.
     * @param {Object} params 
     * @param {number} [params.maxThreadsPerJob=512] - maximum amount of threads to use for a single job
     * @param {number} [params.maxTotalRam=16384] - maximum amount of ram to use for an entire batch cycle
     * @param {number} [params.tdelta=100] - milliseconds between actions
     * @returns {BatchCycle[]} - list of ideal cycles for each set of parameters
     */
    *sweepParameters(params) {
        const defaults = {
            maxThreadsPerJob: 512,
            maxTotalRam: 16384,
            tDelta: 100
        };
        params = Object.assign({}, defaults, params);
        const estimates = [];
        for (const moneyPercent of range(1/40, 1, 1/40)) {
            for (const hackMargin of [0, 0.25]) {
                for (const prepMargin of [0, 0.5]) {
                    for (const naiveSplit of [false]) {
                        const batchParams = {...params, moneyPercent, hackMargin, prepMargin, naiveSplit};
                        const batchCycle = this.planBatchCycle(batchParams);
                        yield batchCycle;
                    }
                }
            }
        }
        return estimates;
    }

    mostProfitableParamsSync(params) {
        const estimates = [...this.sweepParameters(params)];
        const bestEstimate = estimates.sort((a,b)=>(
            b.moneyPerSec - a.moneyPerSec
        ))[0];
        return bestEstimate.params;
    }

    async mostProfitableParams(params) {
        const estimates = [];
        let i = 0;
        for (const estimate of this.sweepParameters(params)) {
            estimates.push(estimate);
            if (++i % 10 == 0) {
                await sleep(1);
            }
        }
        const bestEstimate = estimates.sort((a,b)=>(
            b.moneyPerSec - a.moneyPerSec
        ))[0];
        return bestEstimate.params;
    }

    getStockInfo(portNum=5) {
        const {ns} = this;
        if ("stockInfo" in this) {
            return this.stockInfo;
        }
        let stockInfo = null;
        if (this.organizationName) {
            const port = ns.getPortHandle(portNum);
            if (!port.empty()) {
                const stockService = port.peek();
                if (typeof(stockService.getStockInfo) == 'function') {
                    stockInfo = stockService.getStockInfo(this.organizationName);
                }
            }
        }
        this.stockInfo = stockInfo;
        // cache this info for 1 ms
        setTimeout(()=>{
            delete this.stockInfo;
        }, 1);
        return this.stockInfo;
    }
}

/**
 * Job
 * @typedef {Object} Job
 * @property {string} task - the netscript function to call
 * @property {string[]} args - the arguments to the function
 * @property {Object} change - expected changes of this operation
 */

/**
 * BatchCycle
 * @typedef {Object} BatchCycle - also called a plan
 * @property {string} condition
 * @property {Object} params
 * @property {Batch} batch
 * @property {number} period
 * @property {number} numBatchesAtOnce - aka "depth"
 * @property {number} timeBetweenStarts
 * @property {number} peakRam - ram use if all processes reserve ram
 * @property {number} totalRam - ram use 
 * @property {number} moneyPerSec
 * @property {number} moneyPerSecPerGB
 * @property {number} maxThreadsPerJob
 */

/**
 * Batch
 * @typedef {Array} Batch - array of jobs with methods for calculating useful metrics
 * 
 * Jobs are ordered by their endTime and there is a clear firstEndTime and lastEndTime,
 * but the earliestStartTime also depends on other timing factors.
 */
export class Batch extends Array {

    summary() {
        const tasks = this.map((job)=>(job.task || '-').substr(0,1).toUpperCase());
        return tasks.join('');
    }

    longSummary() {
        const tasks = this.map((job)=>(
            job.task || '-').substr(0,1).toLowerCase() + job.threads
        );
        return tasks.join(' ');
    }

    peakThreads() {
        return this.reduce((total, job)=>(
            total + job.threads
        ), 0);
    }

    avgThreads(tDelta) {
        const threadMSeconds = this.reduce((total,job)=>(
            total + job.threads * job.duration
        ), 0);
        return threadMSeconds / this.totalDuration(tDelta);
    }

    maxThreads() {
        return this.reduce((total, job)=>(
            Math.max(total, job.threads)
        ), 0);
    }

    peakRam() {
        return this.reduce((total, job)=>(
            total + job.threads * (TASK_RAM[job.task] || TASK_RAM['*'])
        ), 0);
    }

    avgRam(tDelta) {
        const gbMSeconds = this.reduce((total,job)=>{
            const gb = TASK_RAM[job.task] || 2.0;
            return total + job.threads * gb * job.duration
        }, 0);
        return gbMSeconds / this.totalDuration(tDelta);
    }

    moneyTaken() {
        return this.reduce((total, job)=>{
            if (job.change?.moneyChange < 0) {
                return total - job.change.moneyChange;
            }
            return total;
        }, 0);
    }

    actualMoneyPercent() {
        const minMoneyMult = this.reduce((total, job)=>(
            Math.min(total, job.change.moneyMult)
        ), 1);
        const moneyPercent = 1 - minMoneyMult;
        return moneyPercent;
    }

    moneySummary() {
        const moneyPercent = this.actualMoneyPercent();
        return `${moneyPercent<0.09999 ? ' ' : ''}${(moneyPercent*100).toFixed(1)}%`;
    }

    activeDuration(tDelta=100) {
        return this.length * tDelta;
    }

    maxDuration() {
        return this.reduce((longest, job)=>(
            Math.max(longest, job.duration)
        ), 0);
    }

    totalDuration(tDelta=100) {
        if (this.length == 0) {
            return 0;
        }
        if (!this.firstEndTime()) {
            this.setFirstEndTime(1, tDelta);
        }
        return this.lastEndTime() + tDelta - this.earliestStartTime();
        // return this.maxDuration() + this.activeDuration(tDelta);
    }

    firstEndTime() {
        return this[0]?.endTime;
    }

    lastEndTime() {
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

    setFirstEndTime(firstEndTime, tDelta=100) {
        let endTime = firstEndTime;
        for (const job of this) {
            job.endTime = endTime;
            endTime += tDelta;
            job.startTime = job.endTime - job.duration;
        }
    }

    setStartTime(startTime, tDelta=100) {
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
        if (offset) {
            for (const job of this) {
                job.startTime += offset;
                job.endTime += offset;
            }
        }
    }

    ensureStartInFuture(now, tDelta) {
        now ||= Date.now();
        if (!(this.earliestStartTime() > now)) {
            this.setStartTime(now, tDelta);
        }
    }

    maxBatchesAtOnce(maxTotalRam, tDelta=100, reserveRam=false) {
        const totalDuration = this.totalDuration(tDelta);
        const activeDuration = this.activeDuration(tDelta);
        const maxBatchesPerCycle = Math.floor(totalDuration / activeDuration);
        const ramUsed = reserveRam ? this.peakRam() : this.avgRam(tDelta);

        const maxBatchesInRam = Math.floor(maxTotalRam / ramUsed);

        return Math.min(maxBatchesPerCycle, maxBatchesInRam);
    }

    minTimeBetweenBatches(maxTotalRam, tDelta=100) {
        const totalDuration = this.totalDuration(tDelta);
        const numBatchesAtOnce = this.maxBatchesAtOnce(maxTotalRam, tDelta);
        return (totalDuration / numBatchesAtOnce);

    }
}

/* ----- library functions ----- */

function range(min, max, step) {
    const result = [];
    let i = min;
    while (i < max) {
        result.push(i);
        i += step;
    }
    return result;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    null: 1.6,
    'hack': 1.7,
    'grow': 1.75,
    'weaken': 1.75,
    '*': 2.0
};
