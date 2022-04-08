import { drawTable } from "/lib/box-drawing";
import { serverPool } from "/net/server-pool";

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

    const backend = serverPool(ns, 2.0);

    ns.print(reportMostProfitableServers(ns, backend));

    ns.print(reportBatchLengthComparison(ns, server, backend));

    if (flags.console) {
        eval("window").server = server;
        await ns.asleep(60*60*1000);
    }
}

export function reportMostProfitableServers(ns, backend) {
    const maxTotalRam = backend ? (backend.totalRam - backend.totalUsedRam) * .9 : 16384;
    const params = {maxTotalRam};
    const columns = [
        {header: "Hostname", field: "server.hostname", width: 18, align: "left"},
        {header: "Parameters", field: "condition", width: 20, align: "left", truncate: true},
        {header: "Prep Time", field: "prepTime", format: drawTable.time},
        {header: "RAM Used", field: "totalRamBytes", format: ns.nFormat, formatArgs: ["0.0 b"]},
        {header: "  $ / sec", field: "moneyPerSec", format: ns.nFormat, formatArgs: ["$0.0a"]},
        // {header: "Max threads/job", field: "maxThreadsPerJob"}
        // {header: "$/sec/GB", field: "moneyPerSecPerGB", format: ns.nFormat, formatArgs: ["$0.00a"]},
    ];
    columns.title = `Most Profitable Servers to Hack (${ns.nFormat(maxTotalRam*1e9, "0.0 b")} total RAM)`;
    const rows = mostProfitableServers(ns, [], params);
    eval("window").mostProfitableServers = rows;
    return drawTable(columns, rows);
}

export function reportBatchLengthComparison(ns, server, backend) {
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
    const tDelta = 100;
    const maxTotalRam = backend ? (backend.totalRam - backend.totalUsedRam) * .9 : 16384;
    const maxThreadsPerJob = 1024;
    const params = {maxThreadsPerJob, tDelta, maxTotalRam};
    columns.title = `Comparison of batches with at most ${ns.nFormat(maxTotalRam*1e9, "0.0 b")} RAM, at most ${maxThreadsPerJob} threads per job`;
    const estimates = server.sweepParameters(params);
    const estimatesByMoneyPct = {}
    for (const estimate of estimates) {
        estimate.totalRamBytes = estimate.totalRam * 1e9;
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

export function mostProfitableServers(ns, hostnames, params) {
    const player = ns.getPlayer();
    if (!hostnames || hostnames.length == 0) {
        hostnames = getAllHosts(ns);
    }
    const serverStats = hostnames.map((host)=>{
        const server = new ServerModel(ns, host);
        return server;
    }).filter((server)=>(
        server.canBeHacked(player)
    )).map((server)=>{
        const bestParams = server.mostProfitableParameters(params);
        const batchCycle = server.planBatchCycle(bestParams);
        batchCycle.prepTime = server.estimatePrepTime(params);
        batchCycle.server = server;
        batchCycle.totalRamBytes = batchCycle.totalRam * 1e9;
        server.reload();
        return batchCycle;
    }).sort((a,b)=>(
        b.moneyPerSec - a.moneyPerSec
    ));
    return serverStats;
}

/**
 * A ServerModel tracks the state of a server through multiple hacking operations.
 * It has all the fields of a Netscript Server object, plus methods to mutate state.
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
        return this;
    }

    copy() {
        return new ServerModel(this.ns, this);
    }

    preppedCopy() {
        const server = this.copy();
        server.moneyAvailable = server.moneyMax;
        server.hackDifficulty = server.minDifficulty;
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
    
        const duration = ns.formulas.hacking.hackTime(server, player);

        // Calculate threads
        moneyPercent = Math.max(0, Math.min(1.0, moneyPercent));
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
    planGrow(maxThreads, cores=1, stock) {
        const {ns} = this;
        const server = this;
        const player = ns.getPlayer();

        const duration = ns.formulas.hacking.growTime(server, player);

        // Calculate threads using binary search
        let minThreads = 1;
        if (!maxThreads || maxThreads < 1 || maxThreads == Infinity) {
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
     * @returns 
     */
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
     * @param {number} [params.cores=1]
     * @retruns {Batch}
     */
    planPrepBatch(params) {
        const defaults = {
            maxThreadsPerJob: 512,
            prepMargin: 0.5,
            naiveSplit: false,
            cores: 1
        };
        params = Object.assign({}, defaults, params);
        const {maxThreadsPerJob, prepMargin, naiveSplit, cores} = params;

        const batch = new Batch();
        while (naiveSplit && this.hackDifficulty > this.minDifficulty + prepMargin) {
            batch.push(this.planWeaken(maxThreadsPerJob, cores));
        }
        while (this.moneyAvailable < this.moneyMax) {
            while (!naiveSplit && this.hackDifficulty > this.minDifficulty + prepMargin) {
                batch.push(this.planWeaken(maxThreadsPerJob, cores));
            }
            batch.push(this.planGrow(maxThreadsPerJob, cores));
        }
        while (this.hackDifficulty > this.minDifficulty) {
            batch.push(this.planWeaken(maxThreadsPerJob, cores));
        }
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
     * @param {number} [params.cores=1]
     * @retruns {Batch}
     */
     planHackingBatch(params) {
        const defaults = {
            moneyPercent: 0.05,
            maxThreadsPerJob: 512,
            hackMargin: 0.25,
            cores: 1
        };
        params = Object.assign({}, defaults, params);
        const {moneyPercent, maxThreadsPerJob, hackMargin, cores} = params;

        const batch = new Batch();
        batch.push(...this.planPrepBatch(params));
        batch.push(this.planHack(moneyPercent, maxThreadsPerJob))
        while (this.hackDifficulty < this.minDifficulty + hackMargin) {
            batch.push(this.planGrow(maxThreadsPerJob, cores));
            batch.push(this.planHack(moneyPercent, maxThreadsPerJob));
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
            tDelta: 100
        };
        params = Object.assign({}, defaults, params);
        const {moneyPercent, maxTotalRam, tDelta} = params;

        const server = this.preppedCopy();
        const batch = server.planHackingBatch(params);

        const moneyPerBatch = batch.moneyTaken();
        const cycleDuration = batch.totalDuration(tDelta);

        const numBatchesAtOnce = batch.maxBatchesAtOnce(maxTotalRam, tDelta);
        const timeBetweenBatches = cycleDuration / numBatchesAtOnce;

        const totalMoney = moneyPerBatch * numBatchesAtOnce;
        const moneyPerSec = totalMoney / (cycleDuration / 1000);

        // const totalThreads = numBatchesAtOnce * batch.avgThreads();
        // const moneyPerSecPerThread = moneyPerSec / totalThreads;
        const totalRam = numBatchesAtOnce * batch.avgRam();
        const moneyPerSecPerGB = moneyPerSec / totalRam;

        const maxThreads = batch.maxThreads();
        const condition = `${moneyPercent<0.09999 ? ' ' : ''}${(moneyPercent*100).toFixed(1)}% ${batch.summary()}`; // (t≤${maxThreads<100?' ':''}${maxThreads})

        const batchCycle = {
            condition,
            batch,
            params,
            duration: cycleDuration,
            numBatchesAtOnce,
            timeBetweenBatches,
            totalRam,
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
    sweepParameters(params) {
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
                        estimates.push(batchCycle);
                    }
                }
            }
        }
        return estimates;
    }

    mostProfitableParameters(params) {
        const estimates = this.sweepParameters(params);
        const bestEstimate = estimates.sort((a,b)=>(
            b.moneyPerSec - a.moneyPerSec
        ))[0];
        return bestEstimate.params;
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
 * @typedef {Object} BatchCycle
 * @property {Batch} batch
 * @property {Object} params
 * @property {number} duration
 * @property {number} numBatchesAtOnce
 * @property {number} minTimeBetweenBatches
 * @property {number} totalRam
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
class Batch extends Array {

    summary() {
        const tasks = this.map((job)=>(job.task || '-').substr(0,1).toUpperCase());
        return tasks.join('');
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

    maxThreads() {
        return this.reduce((total, job)=>(
            Math.max(total, job.threads)
        ), 0);
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
        if (!this.earliestStartTime()) {
            this.setStartTime(1, tDelta);
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
        if (!offset) {
            offset = Date.now() - this.earliestStartTime()
        }
        for (const job of this) {
            job.startTime += offset;
            job.endTime += offset;
        }
    }

    maxBatchesAtOnce(maxTotalRam, tDelta=100) {
        const totalDuration = this.totalDuration(tDelta);
        const activeDuration = this.activeDuration(tDelta);
        const maxBatchesPerCycle = Math.floor(totalDuration / activeDuration);

        const maxBatchesInRam = Math.floor(maxTotalRam / this.avgRam());

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
