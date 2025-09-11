#!/usr/bin/env node

/**
 * Ops Reporter - Flake Risk Score Calculator and SLA Breach Detection
 * 
 * Computes risk scores based on fail rate volatility, environment entropy, 
 * and failure density. Identifies SLA breaches for quarantined tests.
 */

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { QuarantineValidator } from './quarantine-validator.js';

// Risk scoring interfaces
interface TestMetrics {
  testKey: string;
  failRate: number;
  volatility: number;
  envEntropy: number;
  failureDensity: number;
  quarantineDays?: number;
  attempts?: number;
}

interface RiskScore {
  testKey: string;
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  badge: string;
  quarantineDays?: number;
  attempts?: number;
  slaBreached: boolean;
}

interface SLAPolicy {
  maxQuarantineDays: number;
  maxAttempts: number;
  riskThresholds: {
    medium: number;
    high: number;
    critical: number;
  };
}

class OpsReporter {
  private readonly defaultPolicy: SLAPolicy = {
    maxQuarantineDays: 7,
    maxAttempts: 3,
    riskThresholds: {
      medium: 0.3,
      high: 0.6,
      critical: 0.8
    }
  };

  /**
   * Calculate flake risk score based on multiple factors
   * Risk score = f(fail rate volatility, env entropy, failure density)
   */
  calculateRiskScore(metrics: TestMetrics, _policy: SLAPolicy = this.defaultPolicy): number {
    const { volatility, envEntropy, failureDensity } = metrics;
    
    // Weighted risk calculation
    const volatilityWeight = 0.4;  // How much fail rate varies
    const entropyWeight = 0.3;     // Environment diversity (flakiness indicator)
    const densityWeight = 0.3;     // Recent failure concentration
    
    // Normalize inputs to 0-1 range
    const normalizedVolatility = Math.min(volatility, 1.0);
    const normalizedEntropy = Math.min(envEntropy, 1.0);
    const normalizedDensity = Math.min(failureDensity, 1.0);
    
    const riskScore = (
      normalizedVolatility * volatilityWeight +
      normalizedEntropy * entropyWeight +
      normalizedDensity * densityWeight
    );
    
    return Math.min(riskScore, 1.0);
  }

  /**
   * Determine risk level and badge based on score
   */
  getRiskLevel(score: number, policy: SLAPolicy = this.defaultPolicy): { level: RiskScore['level'], badge: string } {
    if (score >= policy.riskThresholds.critical) {
      return { level: 'CRITICAL', badge: '🔴' };
    } else if (score >= policy.riskThresholds.high) {
      return { level: 'HIGH', badge: '🟠' };
    } else if (score >= policy.riskThresholds.medium) {
      return { level: 'MEDIUM', badge: '🟡' };
    } else {
      return { level: 'LOW', badge: '🟢' };
    }
  }

  /**
   * Check if test breaches SLA policies
   */
  checkSLABreach(metrics: TestMetrics, policy: SLAPolicy = this.defaultPolicy): boolean {
    const daysBreach = (metrics.quarantineDays ?? 0) > policy.maxQuarantineDays;
    const attemptsBreach = (metrics.attempts ?? 0) > policy.maxAttempts;
    
    return daysBreach || attemptsBreach;
  }

  /**
   * Generate comprehensive risk assessment
   */
  assessRisks(testMetrics: TestMetrics[], policy: SLAPolicy = this.defaultPolicy): RiskScore[] {
    return testMetrics.map(metrics => {
      const score = this.calculateRiskScore(metrics, policy);
      const { level, badge } = this.getRiskLevel(score, policy);
      const slaBreached = this.checkSLABreach(metrics, policy);

      return {
        testKey: metrics.testKey,
        score,
        level,
        badge,
        quarantineDays: metrics.quarantineDays,
        attempts: metrics.attempts,
        slaBreached
      };
    });
  }

  /**
   * Load quarantine data and calculate days in quarantine
   */
  async loadQuarantineMetrics(configPath: string = '.flakeguard/quarantine.yml'): Promise<{ testKey: string, quarantineDays: number }[]> {
    try {
      const validator = new QuarantineValidator();
      const result = await validator.validateFile(configPath);
      
      if (!result.isValid || !result.config) {
        return [];
      }

      const now = new Date();
      return result.config.quarantined_tests.map((entry: any) => {
        const quarantineDate = entry.quarantined_at ? new Date(entry.quarantined_at) : new Date();
        const daysDiff = Math.floor((now.getTime() - quarantineDate.getTime()) / (1000 * 60 * 60 * 24));
        
        return {
          testKey: entry.test_key,
          quarantineDays: Math.max(0, daysDiff)
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Generate mock test metrics for demonstration
   */
  generateMockMetrics(quarantineData: { testKey: string, quarantineDays: number }[]): TestMetrics[] {
    const baseTests = [
      { testKey: 'auth::login::timeout', failRate: 0.15, volatility: 0.8, envEntropy: 0.9, failureDensity: 0.7, attempts: 4 },
      { testKey: 'payment::checkout::network', failRate: 0.25, volatility: 0.6, envEntropy: 0.4, failureDensity: 0.5, attempts: 2 },
      { testKey: 'ui::modal::flicker', failRate: 0.05, volatility: 0.3, envEntropy: 0.6, failureDensity: 0.2, attempts: 1 },
      { testKey: 'db::connection::race', failRate: 0.35, volatility: 0.9, envEntropy: 0.8, failureDensity: 0.9, attempts: 5 },
      { testKey: 'api::rate_limit::burst', failRate: 0.12, volatility: 0.4, envEntropy: 0.3, failureDensity: 0.3, attempts: 2 }
    ];

    // Merge quarantine data with base metrics
    return baseTests.map(test => {
      const quarantineInfo = quarantineData.find(q => q.testKey === test.testKey);
      return {
        ...test,
        quarantineDays: quarantineInfo?.quarantineDays
      };
    });
  }

  /**
   * Format and print risk summary table
   */
  printRiskSummary(risks: RiskScore[], policy: SLAPolicy = this.defaultPolicy): void {
    // Sort by risk score descending
    const sortedRisks = risks.sort((a, b) => b.score - a.score);
    
    console.log('\n📊 FLAKE RISK ASSESSMENT SUMMARY');
    console.log('═'.repeat(80));
    
    // SLA Policy Info
    console.log(`📋 SLA Policy: Max ${policy.maxQuarantineDays} days quarantine, ${policy.maxAttempts} attempts\n`);
    
    // Risk table header
    console.log('┌─────────────────────────────────┬───────┬─────────┬──────────┬──────────┬─────────┐');
    console.log('│ Test Key                        │ Badge │ Risk    │ Quarantine│ Attempts │ SLA     │');
    console.log('│                                 │       │ Score   │ Days     │          │ Status  │');
    console.log('├─────────────────────────────────┼───────┼─────────┼──────────┼──────────┼─────────┤');
    
    sortedRisks.forEach(risk => {
      const testKey = risk.testKey.padEnd(31).substring(0, 31);
      const score = risk.score.toFixed(2).padStart(5);
      const quarantineDays = (risk.quarantineDays?.toString() ?? '-').padStart(8);
      const attempts = (risk.attempts?.toString() ?? '-').padStart(8);
      const slaStatus = risk.slaBreached ? '⚠️  BREACH' : '✅  OK   ';
      
      console.log(`│ ${testKey} │  ${risk.badge}    │  ${score}  │   ${quarantineDays} │   ${attempts} │ ${slaStatus} │`);
    });
    
    console.log('└─────────────────────────────────┴───────┴─────────┴──────────┴──────────┴─────────┘');
    
    // Summary statistics
    const totalTests = risks.length;
    const breaches = risks.filter(r => r.slaBreached).length;
    const criticalRisks = risks.filter(r => r.level === 'CRITICAL').length;
    const highRisks = risks.filter(r => r.level === 'HIGH').length;
    
    console.log(`\n📈 SUMMARY STATISTICS:`);
    console.log(`   • Total Tests: ${totalTests}`);
    console.log(`   • SLA Breaches: ${breaches} ${breaches > 0 ? '⚠️' : '✅'}`);
    console.log(`   • Critical Risk: ${criticalRisks} ${criticalRisks > 0 ? '🔴' : '✅'}`);
    console.log(`   • High Risk: ${highRisks} ${highRisks > 0 ? '🟠' : '✅'}`);
    
    if (breaches > 0) {
      console.log('\n⚠️  ACTION REQUIRED: SLA breaches detected. Consider immediate remediation.');
    }
    
    console.log('\n🔍 Risk Factors: Volatility (40%), Environment Entropy (30%), Failure Density (30%)');
  }

  /**
   * Generate detailed JSON report
   */
  generateJSONReport(risks: RiskScore[], policy: SLAPolicy = this.defaultPolicy): string {
    const report = {
      timestamp: new Date().toISOString(),
      policy,
      summary: {
        totalTests: risks.length,
        slaBreaches: risks.filter(r => r.slaBreached).length,
        riskDistribution: {
          critical: risks.filter(r => r.level === 'CRITICAL').length,
          high: risks.filter(r => r.level === 'HIGH').length,
          medium: risks.filter(r => r.level === 'MEDIUM').length,
          low: risks.filter(r => r.level === 'LOW').length
        }
      },
      risks: risks.sort((a, b) => b.score - a.score)
    };
    
    return JSON.stringify(report, null, 2);
  }
}

// CLI Commands
async function reportCommand(options: { 
  config?: string; 
  format?: 'table' | 'json'; 
  policy?: string;
  maxDays?: number;
  maxAttempts?: number;
}) {
  const reporter = new OpsReporter();
  
  // Load custom policy if provided
  let policy = reporter['defaultPolicy'];
  if (options.policy) {
    try {
      const policyData = await readFile(options.policy, 'utf-8');
      policy = JSON.parse(policyData);
    } catch (error) {
      console.error(`❌ Failed to load policy file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  }
  
  // Override policy with CLI options
  if (options.maxDays) policy.maxQuarantineDays = options.maxDays;
  if (options.maxAttempts) policy.maxAttempts = options.maxAttempts;
  
  try {
    // Load quarantine data
    const quarantineData = await reporter.loadQuarantineMetrics(options.config);
    
    // Generate test metrics (mock data + quarantine info)
    const testMetrics = reporter.generateMockMetrics(quarantineData);
    
    // Assess risks
    const risks = reporter.assessRisks(testMetrics, policy);
    
    // Output results
    if (options.format === 'json') {
      console.log(reporter.generateJSONReport(risks, policy));
    } else {
      reporter.printRiskSummary(risks, policy);
    }
    
  } catch (error) {
    console.error(`❌ Error generating report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

// CLI Setup
const program = new Command();

program
  .name('flakeguard-ops-reporter')
  .description('FlakeGuard Ops Reporter - Risk scoring and SLA breach detection')
  .version('1.0.0');

program
  .command('report')
  .description('Generate flake risk assessment and SLA breach report')
  .option('-c, --config <path>', 'Path to quarantine config file', '.flakeguard/quarantine.yml')
  .option('-f, --format <type>', 'Output format (table|json)', 'table')
  .option('-p, --policy <path>', 'Path to custom SLA policy JSON file')
  .option('--max-days <number>', 'Override max quarantine days', (val) => parseInt(val))
  .option('--max-attempts <number>', 'Override max attempts', (val) => parseInt(val))
  .action(reportCommand);

// Parse CLI arguments or show help
if (process.argv.length === 2) {
  program.help();
} else {
  program.parse();
}

export { OpsReporter, TestMetrics, RiskScore, SLAPolicy };