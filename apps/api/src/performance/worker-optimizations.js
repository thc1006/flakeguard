/**
 * BullMQ Worker Performance Optimizations
 */
import { Worker } from "bullmq";
export class OptimizedWorkerManager {
    workers = new Map();
    queues = new Map();
    createOptimizedWorker(name, processor, config) {
        const workerOptions = {
            concurrency: config.concurrency,
            stalledInterval: config.stalledInterval,
            maxStalledCount: config.maxStalledCount,
        };
        const worker = new Worker(name, processor, workerOptions);
        this.workers.set(name, worker);
        return worker;
    }
    getWorkerMetrics(name) {
        const worker = this.workers.get(name);
        return worker ? {
            isRunning: worker.isRunning(),
            processingJobs: worker.processingJobs,
        } : null;
    }
}
//# sourceMappingURL=worker-optimizations.js.map