/**
 * BullMQ Worker Performance Optimizations
 */
import { Worker, Queue as _Queue, WorkerOptions } from "bullmq";

interface OptimizedWorkerConfig {
  concurrency: number;
  maxConcurrency: number;
  stalledInterval: number;
  maxStalledCount: number;
}

export class OptimizedWorkerManager {
  private workers = new Map<string, Worker>();
  // private queues = new Map<string, Queue>(); // Unused for now
  
  createOptimizedWorker(name: string, processor: string, config: OptimizedWorkerConfig, connection?: unknown) {
    const workerOptions: WorkerOptions = {
      concurrency: config.concurrency,
      stalledInterval: config.stalledInterval,
      maxStalledCount: config.maxStalledCount,
      connection: connection as any, // Add connection option with type cast
    };
    
    // processor should be a file path string or processor function
    const worker = new Worker(name, processor, workerOptions);
    this.workers.set(name, worker);
    return worker;
  }
  
  getWorkerMetrics(name: string) {
    const worker = this.workers.get(name);
    if (!worker) {
      return null;
    }
    
    return {
      isRunning: worker.isRunning(),
      // Note: processingJobs might not exist on all BullMQ versions
      // processingJobs: worker.processingJobs,
    };
  }
}
