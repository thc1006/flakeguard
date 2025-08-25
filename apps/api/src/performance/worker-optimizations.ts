/**
 * BullMQ Worker Performance Optimizations
 */
import { Worker, Queue, QueueOptions, WorkerOptions } from "bullmq";

interface OptimizedWorkerConfig {
  concurrency: number;
  maxConcurrency: number;
  stalledInterval: number;
  maxStalledCount: number;
}

export class OptimizedWorkerManager {
  private workers = new Map<string, Worker>();
  private queues = new Map<string, Queue>();
  
  createOptimizedWorker(name: string, processor: any, config: OptimizedWorkerConfig) {
    const workerOptions: WorkerOptions = {
      concurrency: config.concurrency,
      stalledInterval: config.stalledInterval,
      maxStalledCount: config.maxStalledCount,
    };
    
    const worker = new Worker(name, processor, workerOptions);
    this.workers.set(name, worker);
    return worker;
  }
  
  getWorkerMetrics(name: string) {
    const worker = this.workers.get(name);
    return worker ? {
      isRunning: worker.isRunning(),
      processingJobs: worker.processingJobs,
    } : null;
  }
}
