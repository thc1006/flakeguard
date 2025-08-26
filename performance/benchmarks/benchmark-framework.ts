/**
 * FlakeGuard Performance Benchmark Suite
 */
import { performance } from "perf_hooks";

interface BenchmarkResult {
  name: string;
  duration: number;
  throughput: number;
  memory: NodeJS.MemoryUsage;
  success: boolean;
  error?: string;
}

export class PerformanceBenchmark {
  private results: BenchmarkResult[] = [];

  async runBenchmark(name: string, fn: () => Promise<unknown>, iterations: number = 100): Promise<BenchmarkResult> {
    const startMemory = process.memoryUsage();
    const startTime = performance.now();
    
    try {
      for (let i = 0; i < iterations; i++) {
        await fn();
      }
      
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      const duration = endTime - startTime;
      const throughput = iterations / (duration / 1000); // operations per second
      
      const result: BenchmarkResult = {
        name,
        duration,
        throughput,
        memory: {
          rss: endMemory.rss - startMemory.rss,
          heapTotal: endMemory.heapTotal - startMemory.heapTotal,
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external,
          arrayBuffers: endMemory.arrayBuffers - startMemory.arrayBuffers,
        },
        success: true,
      };
      
      this.results.push(result);
      return result;
      
    } catch (error) {
      const result: BenchmarkResult = {
        name,
        duration: 0,
        throughput: 0,
        memory: startMemory,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      
      this.results.push(result);
      return result;
    }
  }
  
  getResults(): BenchmarkResult[] {
    return [...this.results];
  }
  
  generateReport(): string {
    const report = this.results.map(result => {
      if (!result.success) {
        return `❌ ${result.name}: FAILED - ${result.error}`;
      }
      
      return [
        `✅ ${result.name}:`,
        `   Duration: ${result.duration.toFixed(2)}ms`,
        `   Throughput: ${result.throughput.toFixed(2)} ops/sec`,
        `   Memory Delta: ${(result.memory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
      ].join("\n");
    }).join("\n\n");
    
    return report;
  }
}
