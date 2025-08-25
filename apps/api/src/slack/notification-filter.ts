/**
 * Advanced notification filtering and escalation system
 */

import type {
  FlakeNotification,
  NotificationFilter,
  EscalationPolicy,
} from './types.js';
import { logger } from '../utils/logger.js';

export class NotificationFilterService {
  private filters: Map<string, NotificationFilter> = new Map();
  private escalationPolicies: Map<string, EscalationPolicy> = new Map();
  private recentNotifications = new Map<string, Date>();

  public registerFilter(key: string, filter: NotificationFilter): void {
    this.filters.set(key, filter);
    logger.debug({ key }, 'Notification filter registered');
  }

  public registerEscalationPolicy(key: string, policy: EscalationPolicy): void {
    this.escalationPolicies.set(key, policy);
    logger.debug({ key }, 'Escalation policy registered');
  }

  public shouldSendNotification(notification: FlakeNotification): boolean {
    const repoFilter = this.filters.get(notification.repository);
    if (repoFilter && !this.applyFilter(notification, repoFilter)) {
      return false;
    }

    if (notification.routing.teams) {
      for (const team of notification.routing.teams) {
        const teamFilter = this.filters.get(`team:${team}`);
        if (teamFilter && !this.applyFilter(notification, teamFilter)) {
          return false;
        }
      }
    }

    const globalFilter = this.filters.get('global');
    if (globalFilter && !this.applyFilter(notification, globalFilter)) {
      return false;
    }

    if (this.isRateLimited(notification)) {
      logger.debug({
        type: notification.type,
        repository: notification.repository,
      }, 'Notification rate limited');
      return false;
    }

    return true;
  }

  public shouldEscalate(notification: FlakeNotification): EscalationPolicy | null {
    if (notification.priority !== 'critical' && notification.priority !== 'high') {
      return null;
    }

    const repoPolicy = this.escalationPolicies.get(notification.repository);
    if (repoPolicy && this.matchesEscalationTriggers(notification, repoPolicy)) {
      return repoPolicy;
    }

    const globalPolicy = this.escalationPolicies.get('global');
    if (globalPolicy && this.matchesEscalationTriggers(notification, globalPolicy)) {
      return globalPolicy;
    }

    return null;
  }

  private applyFilter(notification: FlakeNotification, filter: NotificationFilter): boolean {
    if (filter.repositories.length > 0 && !filter.repositories.includes(notification.repository)) {
      return false;
    }

    if (notification.data.flakeScore && filter.testNameFilters.length > 0) {
      const testName = notification.data.flakeScore.testName.toLowerCase();
      const matches = filter.testNameFilters.some(pattern => 
        testName.includes(pattern.toLowerCase())
      );
      if (!matches) return false;
    }

    if (notification.data.flakeScore && filter.excludePatterns.length > 0) {
      const testName = notification.data.flakeScore.testName.toLowerCase();
      const testFullName = notification.data.flakeScore.testFullName.toLowerCase();
      
      const shouldExclude = filter.excludePatterns.some(pattern => 
        testName.includes(pattern.toLowerCase()) || 
        testFullName.includes(pattern.toLowerCase())
      );
      
      if (shouldExclude) return false;
    }

    if (notification.data.flakeScore && notification.data.flakeScore.score < filter.minScore) {
      return false;
    }

    if (notification.data.flakeScore && notification.data.flakeScore.confidence < filter.minConfidence) {
      return false;
    }

    if (filter.timeFilters.businessHoursOnly) {
      const now = new Date();
      const hour = now.getHours();
      if (hour < 9 || hour >= 18) {
        return false;
      }
    }

    return true;
  }

  private matchesEscalationTriggers(notification: FlakeNotification, policy: EscalationPolicy): boolean {
    const { triggers } = policy;

    if (notification.data.flakeScore) {
      const failureRate = notification.data.flakeScore.features.failSuccessRatio;
      if (failureRate >= triggers.failureRateThreshold) {
        return true;
      }

      if (notification.data.flakeScore.score >= triggers.flakinessScoreThreshold) {
        return true;
      }

      if (notification.data.flakeScore.features.consecutiveFailures >= triggers.consecutiveFailures) {
        return true;
      }
    }

    if (notification.type === 'critical_spike') {
      return true;
    }

    return false;
  }

  private isRateLimited(notification: FlakeNotification): boolean {
    const key = `${notification.type}:${notification.repository}`;
    const lastSent = this.recentNotifications.get(key);
    
    if (!lastSent) {
      this.recentNotifications.set(key, new Date());
      return false;
    }

    const rateLimitMinutes = this.getRateLimitMinutes(notification.type);
    const minutesSinceLastSent = (Date.now() - lastSent.getTime()) / (1000 * 60);
    
    if (minutesSinceLastSent < rateLimitMinutes) {
      return true;
    }

    this.recentNotifications.set(key, new Date());
    return false;
  }

  private getRateLimitMinutes(type: FlakeNotification['type']): number {
    switch (type) {
      case 'critical_spike': return 5;
      case 'flake_detected': return 15;
      case 'quarantine_recommended': return 60;
      case 'quality_summary': return 1440;
      default: return 30;
    }
  }
}
