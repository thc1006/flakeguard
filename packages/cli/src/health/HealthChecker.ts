import { Client } from 'pg';
import Redis from 'redis';
import axios from 'axios';
import chalk from 'chalk';
import { HealthCheckResult, ServiceHealth } from '../types';
import { I18nManager } from '../i18n/I18nManager';

export class HealthChecker {
  private i18n: I18nManager;

  constructor(i18n: I18nManager) {
    this.i18n = i18n;
  }

  async runHealthChecks(config: Record<string, any>): Promise<Record<string, HealthCheckResult>> {
    const results: Record<string, HealthCheckResult> = {};
    
    // Database health check
    if (config.DATABASE_URL) {
      results.database = await this.checkDatabase(config.DATABASE_URL);
    }
    
    // Redis health check
    if (config.REDIS_URL) {
      results.redis = await this.checkRedis(config.REDIS_URL);
    }
    
    // API endpoint health check
    if (config.PORT && config.HOST) {
      results.api = await this.checkApiEndpoint(config.HOST, config.PORT);
    }
    
    // GitHub integration health check
    if (config.ENABLE_GITHUB_WEBHOOKS && config.GITHUB_APP_ID) {
      results.github = await this.checkGitHubIntegration(config);
    }
    
    // Slack integration health check
    if (config.ENABLE_SLACK_APP && config.SLACK_BOT_TOKEN) {
      results.slack = await this.checkSlackIntegration(config);
    }
    
    // System resources check
    results.system = await this.checkSystemResources();
    
    return results;
  }

  private async checkDatabase(databaseUrl: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      
      // Test basic query
      const result = await client.query('SELECT NOW() as current_time, version() as version');
      
      await client.end();
      
      const responseTime = Date.now() - startTime;
      
      return {
        healthy: true,
        message: this.i18n.t('health.database.healthy'),
        responseTime,
        details: `PostgreSQL ${result.rows[0].version.split(' ')[1]}`
      };
    } catch (error) {
      return {
        healthy: false,
        message: this.i18n.t('health.database.unhealthy'),
        details: error instanceof Error ? error.message : String(error),
        responseTime: Date.now() - startTime
      };
    }
  }

  private async checkRedis(redisUrl: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const client = Redis.createClient({ url: redisUrl });
      await client.connect();
      
      // Test ping
      await client.ping();
      
      // Test basic operations
      await client.set('health-check', 'ok', { EX: 1 });
      const result = await client.get('health-check');
      
      await client.quit();
      
      if (result !== 'ok') {
        throw new Error('Redis read/write test failed');
      }
      
      const responseTime = Date.now() - startTime;
      
      return {
        healthy: true,
        message: this.i18n.t('health.redis.healthy'),
        responseTime
      };
    } catch (error) {
      return {
        healthy: false,
        message: this.i18n.t('health.redis.unhealthy'),
        details: error instanceof Error ? error.message : String(error),
        responseTime: Date.now() - startTime
      };
    }
  }

  private async checkApiEndpoint(host: string, port: number): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/health`;
    
    try {
      const response = await axios.get(url, {
        timeout: 5000,
        validateStatus: () => true // Accept any status code
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.status === 200) {
        return {
          healthy: true,
          message: this.i18n.t('health.api.healthy'),
          responseTime,
          details: `HTTP ${response.status}`
        };
      } else {
        return {
          healthy: false,
          message: this.i18n.t('health.api.unhealthy'),
          responseTime,
          details: `HTTP ${response.status}: ${response.statusText}`
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
        return {
          healthy: false,
          message: this.i18n.t('health.api.notRunning'),
          responseTime,
          details: this.i18n.t('health.api.startService')
        };
      }
      
      return {
        healthy: false,
        message: this.i18n.t('health.api.unhealthy'),
        responseTime,
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async checkGitHubIntegration(config: Record<string, any>): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // This would validate GitHub App configuration
      // For now, we'll perform basic validation
      
      if (!config.GITHUB_APP_ID || !config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) {
        throw new Error('Missing required GitHub configuration');
      }
      
      // Test GitHub API connectivity
      const response = await axios.get(`https://api.github.com/app`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'FlakeGuard-Setup/1.0.0'
        },
        timeout: 10000
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.status === 200) {
        return {
          healthy: true,
          message: this.i18n.t('health.github.healthy'),
          responseTime,
          details: `App ID: ${config.GITHUB_APP_ID}`
        };
      } else {
        throw new Error(`GitHub API returned ${response.status}`);
      }
    } catch (error) {
      return {
        healthy: false,
        message: this.i18n.t('health.github.unhealthy'),
        details: error instanceof Error ? error.message : String(error),
        responseTime: Date.now() - startTime
      };
    }
  }

  private async checkSlackIntegration(config: Record<string, any>): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      if (!config.SLACK_BOT_TOKEN) {
        throw new Error('Missing Slack bot token');
      }
      
      // Test Slack API
      const response = await axios.get('https://slack.com/api/auth.test', {
        headers: {
          'Authorization': `Bearer ${config.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.data.ok) {
        return {
          healthy: true,
          message: this.i18n.t('health.slack.healthy'),
          responseTime,
          details: `Team: ${response.data.team}, Bot: ${response.data.user}`
        };
      } else {
        throw new Error(response.data.error || 'Slack API authentication failed');
      }
    } catch (error) {
      return {
        healthy: false,
        message: this.i18n.t('health.slack.unhealthy'),
        details: error instanceof Error ? error.message : String(error),
        responseTime: Date.now() - startTime
      };
    }
  }

  private async checkSystemResources(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const os = await import('os');
      
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const memoryUsage = (usedMemory / totalMemory) * 100;
      
      const cpuCount = os.cpus().length;
      const loadAvg = os.loadavg();
      const avgLoad = loadAvg[0] / cpuCount * 100;
      
      const responseTime = Date.now() - startTime;
      
      // Check if system is under stress
      const memoryStress = memoryUsage > 90;
      const cpuStress = avgLoad > 80;
      
      if (memoryStress || cpuStress) {
        return {
          healthy: false,
          message: this.i18n.t('health.system.stressed'),
          responseTime,
          details: `Memory: ${memoryUsage.toFixed(1)}%, CPU: ${avgLoad.toFixed(1)}%`
        };
      }
      
      return {
        healthy: true,
        message: this.i18n.t('health.system.healthy'),
        responseTime,
        details: `Memory: ${memoryUsage.toFixed(1)}%, CPU: ${avgLoad.toFixed(1)}%, Cores: ${cpuCount}`
      };
    } catch (error) {
      return {
        healthy: false,
        message: this.i18n.t('health.system.error'),
        details: error instanceof Error ? error.message : String(error),
        responseTime: Date.now() - startTime
      };
    }
  }

  async runContinuousHealthCheck(
    config: Record<string, any>, 
    intervalMs: number = 30000,
    callback?: (results: Record<string, HealthCheckResult>) => void
  ): Promise<void> {
    const runCheck = async () => {
      try {
        const results = await this.runHealthChecks(config);
        
        if (callback) {
          callback(results);
        } else {
          this.logHealthResults(results);
        }
      } catch (error) {
        console.error(
          chalk.red(`Health check failed: ${error instanceof Error ? error.message : String(error)}`)
        );
      }
    };
    
    // Run initial check
    await runCheck();
    
    // Set up interval
    const interval = setInterval(runCheck, intervalMs);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log(chalk.yellow('\nHealth monitoring stopped.'));
      process.exit(0);
    });
  }

  private logHealthResults(results: Record<string, HealthCheckResult>): void {
    console.log(`\n${chalk.blue('Health Check Results')} - ${new Date().toISOString()}`);
    
    for (const [service, result] of Object.entries(results)) {
      const icon = result.healthy ? '✅' : '❌';
      const color = result.healthy ? chalk.green : chalk.red;
      const responseTime = result.responseTime ? `(${result.responseTime}ms)` : '';
      
      console.log(`${icon} ${color(service)}: ${result.message} ${chalk.gray(responseTime)}`);
      
      if (result.details) {
        console.log(`   ${chalk.gray(result.details)}`);
      }
    }
  }

  async generateHealthReport(config: Record<string, any>): Promise<ServiceHealth[]> {
    const healthResults = await this.runHealthChecks(config);
    
    return Object.entries(healthResults).map(([name, result]) => ({
      name,
      status: result.healthy ? 'healthy' : 'unhealthy',
      checks: [result],
      uptime: result.responseTime,
      version: result.details?.includes('PostgreSQL') ? result.details : undefined
    }));
  }
}