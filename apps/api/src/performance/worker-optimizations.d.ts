/**
 * BullMQ Worker Performance Optimizations
 */
import { Worker } from "bullmq";
interface OptimizedWorkerConfig {
    concurrency: number;
    maxConcurrency: number;
    stalledInterval: number;
    maxStalledCount: number;
}
export declare class OptimizedWorkerManager {
    private workers;
    private queues;
    createOptimizedWorker(name: string, processor: any, config: OptimizedWorkerConfig): Worker<any, any, string>;
    getWorkerMetrics(name: string): {
        isRunning: boolean;
        processingJobs: any;
    } | null;
}
export {};
//# sourceMappingURL=worker-optimizations.d.ts.map