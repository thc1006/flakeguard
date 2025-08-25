/**
 * Circuit Breaker implementation for GitHub API resilience
 * Implements the Circuit Breaker pattern to prevent cascading failures
 */

import type { Logger } from 'pino';

import { GitHubApiError } from './types.js';
import type {
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitBreakerStatus,
} from './types.js';

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failureCount = 0;
  private lastFailureAt: Date | null = null;
  private nextAttemptAt: Date | null = null;
  private halfOpenAttempts = 0;
  private halfOpenSuccesses = 0;
  private totalRequests = 0;
  private totalFailures = 0;
  private readonly failures: Date[] = [];

  constructor(
    private readonly config: CircuitBreakerConfig,
    private readonly logger: Logger
  ) {}

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(
    operation: () => Promise<T>,
    context?: string
  ): Promise<T> {
    if (!this.config.enabled) {
      return operation();
    }

    this.totalRequests++;
    
    // Check if circuit is open
    if (this.state === 'open') {
      if (this.shouldAttemptReset()) {
        this.logger.info(
          { context, state: this.state },
          'Circuit breaker transitioning to half-open state'
        );
        this.transitionToHalfOpen();
      } else {
        this.logger.warn(
          { 
            context, 
            state: this.state,
            nextAttemptAt: this.nextAttemptAt,
          },
          'Circuit breaker is open, rejecting request'
        );
        throw new GitHubApiError(
          'CIRCUIT_BREAKER_OPEN',
          'Circuit breaker is open, request rejected',
          {
            retryable: false,
            context: {
              state: this.state,
              nextAttemptAt: this.nextAttemptAt,
              failureCount: this.failureCount,
            },
          }
        );
      }
    }

    // Handle half-open state
    if (this.state === 'half-open') {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxCalls) {
        this.logger.warn(
          { context, halfOpenAttempts: this.halfOpenAttempts },
          'Circuit breaker half-open limit reached'
        );
        throw new GitHubApiError(
          'CIRCUIT_BREAKER_OPEN',
          'Circuit breaker half-open limit reached',
          { retryable: false }
        );
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await operation();
      this.onSuccess(context);
      return result;
    } catch (error) {
      this.onFailure(error, context);
      throw error;
    }
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureAt: this.lastFailureAt,
      nextAttemptAt: this.nextAttemptAt,
      halfOpenAttempts: this.halfOpenAttempts,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
    };
  }

  /**
   * Force circuit breaker to specific state (for testing)
   */
  forceState(state: CircuitBreakerState): void {
    this.logger.warn({ oldState: this.state, newState: state }, 'Circuit breaker state forced');
    this.state = state;
    if (state === 'closed') {
      this.reset();
    }
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureAt = null;
    this.nextAttemptAt = null;
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;
    this.failures.length = 0;
    this.logger.info('Circuit breaker reset to closed state');
  }

  /**
   * Get failure rate in the current time window
   */
  getFailureRate(): number {
    this.cleanupOldFailures();
    const windowStart = new Date(Date.now() - this.config.failureTimeWindowMs);
    const recentFailures = this.failures.filter(failure => failure > windowStart);
    return recentFailures.length;
  }

  /**
   * Check if circuit breaker should attempt reset
   */
  private shouldAttemptReset(): boolean {
    if (this.nextAttemptAt === null) {
      return true;
    }
    return Date.now() >= this.nextAttemptAt.getTime();
  }

  /**
   * Handle successful operation
   */
  private onSuccess(context?: string): void {
    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      this.logger.debug(
        { 
          context,
          halfOpenSuccesses: this.halfOpenSuccesses,
          halfOpenAttempts: this.halfOpenAttempts,
        },
        'Circuit breaker half-open success'
      );

      // Check if we should close the circuit
      const successRate = this.halfOpenSuccesses / this.halfOpenAttempts;
      if (successRate >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success in closed state
      if (this.failureCount > 0) {
        this.logger.debug(
          { context, previousFailureCount: this.failureCount },
          'Circuit breaker success, resetting failure count'
        );
        this.failureCount = 0;
        this.lastFailureAt = null;
      }
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(error: any, context?: string): void {
    this.totalFailures++;
    this.failureCount++;
    this.lastFailureAt = new Date();
    this.failures.push(this.lastFailureAt);

    this.logger.warn(
      { 
        context,
        error: error.message,
        failureCount: this.failureCount,
        state: this.state,
      },
      'Circuit breaker recorded failure'
    );

    if (this.state === 'half-open') {
      // Any failure in half-open state should open the circuit
      this.transitionToOpen();
    } else if (this.state === 'closed') {
      // Check if we should open the circuit
      this.cleanupOldFailures();
      const recentFailures = this.getFailureRate();
      
      if (recentFailures >= this.config.failureThreshold) {
        this.transitionToOpen();
      }
    }
  }

  /**
   * Transition to open state
   */
  private transitionToOpen(): void {
    this.state = 'open';
    this.nextAttemptAt = new Date(Date.now() + this.config.openTimeoutMs);
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;

    this.logger.error(
      {
        failureCount: this.failureCount,
        nextAttemptAt: this.nextAttemptAt,
      },
      'Circuit breaker opened due to failures'
    );
  }

  /**
   * Transition to half-open state
   */
  private transitionToHalfOpen(): void {
    this.state = 'half-open';
    this.nextAttemptAt = null;
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;

    this.logger.info('Circuit breaker transitioned to half-open state');
  }

  /**
   * Transition to closed state
   */
  private transitionToClosed(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureAt = null;
    this.nextAttemptAt = null;
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;

    this.logger.info(
      { successRate: this.halfOpenSuccesses / this.halfOpenAttempts },
      'Circuit breaker closed after successful recovery'
    );
  }

  /**
   * Remove failures outside the time window
   */
  private cleanupOldFailures(): void {
    const windowStart = new Date(Date.now() - this.config.failureTimeWindowMs);
    let removeCount = 0;
    
    while (this.failures.length > 0 && this.failures[0]! <= windowStart) {
      this.failures.shift();
      removeCount++;
    }

    if (removeCount > 0) {
      this.logger.debug(
        { removedFailures: removeCount, remainingFailures: this.failures.length },
        'Cleaned up old failures from circuit breaker'
      );
    }
  }
}

/**
 * Circuit breaker metrics collector
 */
export class CircuitBreakerMetrics {
  private readonly stateTransitions: Array<{
    from: CircuitBreakerState;
    to: CircuitBreakerState;
    timestamp: Date;
  }> = [];

  constructor(private readonly logger: Logger) {}

  /**
   * Record state transition
   */
  recordStateTransition(from: CircuitBreakerState, to: CircuitBreakerState): void {
    this.stateTransitions.push({
      from,
      to,
      timestamp: new Date(),
    });

    this.logger.info(
      { from, to, timestamp: new Date() },
      'Circuit breaker state transition recorded'
    );

    // Keep only last 100 transitions
    if (this.stateTransitions.length > 100) {
      this.stateTransitions.shift();
    }
  }

  /**
   * Get state transitions in time window
   */
  getStateTransitions(windowMs: number): typeof this.stateTransitions {
    const windowStart = new Date(Date.now() - windowMs);
    return this.stateTransitions.filter(t => t.timestamp > windowStart);
  }

  /**
   * Calculate uptime percentage
   */
  getUptimePercentage(windowMs: number): number {
    const windowStart = new Date(Date.now() - windowMs);
    const transitions = this.getStateTransitions(windowMs);
    
    if (transitions.length === 0) {
      return 100; // Assume 100% uptime if no transitions
    }

    let uptimeMs = 0;
    let currentState: CircuitBreakerState = 'closed';
    let lastTransitionTime = windowStart;

    for (const transition of transitions) {
      if (currentState === 'closed') {
        uptimeMs += transition.timestamp.getTime() - lastTransitionTime.getTime();
      }
      currentState = transition.to;
      lastTransitionTime = transition.timestamp;
    }

    // Add remaining time if currently closed
    if (currentState === 'closed') {
      uptimeMs += Date.now() - lastTransitionTime.getTime();
    }

    return (uptimeMs / windowMs) * 100;
  }

  /**
   * Get circuit breaker health score (0-100)
   */
  getHealthScore(windowMs: number): number {
    const uptimePercent = this.getUptimePercentage(windowMs);
    const transitions = this.getStateTransitions(windowMs);
    
    // Penalize frequent state changes
    const transitionPenalty = Math.min(transitions.length * 2, 20);
    
    return Math.max(0, uptimePercent - transitionPenalty);
  }

  /**
   * Export metrics for monitoring systems
   */
  exportMetrics(): {
    stateTransitionsLast24h: number;
    stateTransitionsLast1h: number;
    uptimePercentage24h: number;
    uptimePercentage1h: number;
    healthScore24h: number;
    healthScore1h: number;
  } {
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    return {
      stateTransitionsLast24h: this.getStateTransitions(day).length,
      stateTransitionsLast1h: this.getStateTransitions(hour).length,
      uptimePercentage24h: this.getUptimePercentage(day),
      uptimePercentage1h: this.getUptimePercentage(hour),
      healthScore24h: this.getHealthScore(day),
      healthScore1h: this.getHealthScore(hour),
    };
  }
}