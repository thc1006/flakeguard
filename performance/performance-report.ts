/**
 * Performance Report Generator
 */
interface PerformanceMetric {
  timestamp: Date;
  component: string;
  operation: string;
  duration: number;
  throughput: number;
  memoryUsage: NodeJS.MemoryUsage;
  success: boolean;
}

interface PerformanceReport {
  summary: {
    testDate: Date;
    totalOperations: number;
    successRate: number;
  };
  metrics: PerformanceMetric[];
}

export class PerformanceReporter {
  private metrics: PerformanceMetric[] = [];

  recordMetric(component: string, operation: string, duration: number, throughput: number, success: boolean): void {
    this.metrics.push({
      timestamp: new Date(),
      component,
      operation,
      duration,
      throughput,
      memoryUsage: process.memoryUsage(),
      success,
    });
  }

  generateReport(): PerformanceReport {
    return {
      summary: {
        testDate: new Date(),
        totalOperations: this.metrics.length,
        successRate: this.metrics.filter(m => m.success).length / this.metrics.length,
      },
      metrics: this.metrics,
    };
  }
}
