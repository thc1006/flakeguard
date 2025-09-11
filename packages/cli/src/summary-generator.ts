/**
 * FlakeGuard Markdown Summary Generator
 * 
 * Generates rich markdown summaries for GitHub Actions step summary display.
 */

// Import types - we'll define them locally to avoid circular imports
interface TestResults {
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    flakyCandidates: number;
    runId: string;
    sha: string;
    ref: string;
    timestamp: string;
  };
  failures: any[];
  environment: {
    os?: string;
    node?: string;
    runner?: string;
    workflow?: string;
  };
  analysis: {
    topFlakyTests: any[];
    quarantineCandidates: any[];
    passFailStreaks: any[];
    environmentDiffs: any[];
  };
}

export class FlakeGuardSummaryGenerator {
  
  generateMarkdownSummary(results: TestResults): string {
    const { summary, failures, analysis } = results;
    
    let markdown = '';
    
    // Header
    markdown += '# 🔍 FlakeGuard Test Analysis Summary\n\n';
    
    // Key metrics
    markdown += this.generateMetricsSection(summary);
    
    // Top flaky tests
    if (analysis.topFlakyTests.length > 0) {
      markdown += this.generateFlakyTestsSection(analysis.topFlakyTests);
    }
    
    // Quarantine candidates
    if (analysis.quarantineCandidates.length > 0) {
      markdown += this.generateQuarantineCandidatesSection(analysis.quarantineCandidates);
    }
    
    // Pass/Fail streaks
    if (analysis.passFailStreaks.length > 0) {
      markdown += this.generatePassFailStreaksSection(analysis.passFailStreaks);
    }
    
    // Environment differences
    if (analysis.environmentDiffs.length > 0) {
      markdown += this.generateEnvironmentDiffsSection(analysis.environmentDiffs);
    }
    
    // Recent failures
    if (failures.length > 0) {
      markdown += this.generateRecentFailuresSection(failures);
    }
    
    // Footer with metadata
    markdown += this.generateFooter(summary);
    
    return markdown;
  }

  private generateMetricsSection(summary: any): string {
    const healthScore = this.calculateHealthScore(summary);
    const healthEmoji = this.getHealthEmoji(healthScore);
    
    return `## ${healthEmoji} Test Suite Health\n\n` +
           `| Metric | Value | Status |\n` +
           `|--------|-------|--------|\n` +
           `| **Total Tests** | ${summary.totalTests} | ${this.getTestCountStatus(summary.totalTests)} |\n` +
           `| **Failed Tests** | ${summary.failedTests} | ${this.getFailureStatus(summary.failedTests)} |\n` +
           `| **Flaky Candidates** | ${summary.flakyCandidates} | ${this.getFlakyStatus(summary.flakyCandidates)} |\n` +
           `| **Health Score** | ${Math.round(healthScore * 100)}% | ${this.getHealthStatus(healthScore)} |\n` +
           `| **Run ID** | [\`${summary.runId}\`](https://github.com/${process.env.GITHUB_REPOSITORY || 'unknown/repo'}/actions/runs/${summary.runId}) | - |\n\n`;
  }

  private generateFlakyTestsSection(flakyTests: any[]): string {
    let section = '## 🌀 Top Flaky Tests\n\n';
    section += '*Tests showing inconsistent pass/fail behavior*\n\n';
    
    section += '| Test | File | Score | Fail Rate | Runs | Trend | Last Failure |\n';
    section += '|------|------|-------|-----------|------|-------|---------------|\n';
    
    for (const test of flakyTests.slice(0, 10)) {
      const trendEmoji = this.getTrendEmoji(test.trend);
      const scoreBar = this.getScoreBar(test.flakeScore);
      const failRatePercent = Math.round(test.failRate * 100);
      const fileLink = test.file ? `[\`${test.file}:${test.line || ''}\`]` : 'Unknown';
      const shortMessage = test.lastFailureMessage.length > 50 
        ? test.lastFailureMessage.substring(0, 50) + '...'
        : test.lastFailureMessage;
      
      section += `| **${test.testName}** | ${fileLink} | ${scoreBar} ${Math.round(test.flakeScore * 100)}% | ${failRatePercent}% | ${test.totalRuns} | ${trendEmoji} ${test.trend} | ${shortMessage} |\n`;
    }
    
    section += '\n';
    return section;
  }

  private generateQuarantineCandidatesSection(candidates: any[]): string {
    let section = '## ⚠️ Quarantine Candidates\n\n';
    section += '*Tests recommended for temporary quarantine*\n\n';
    
    section += '| Test | Priority | TTL | Reason | Est. Savings |\n';
    section += '|------|----------|-----|--------|--------------|\n';
    
    for (const candidate of candidates) {
      const priorityEmoji = this.getPriorityEmoji(candidate.priority);
      const priorityBadge = `${priorityEmoji} **${candidate.priority.toUpperCase()}**`;
      
      section += `| **${candidate.testName}** | ${priorityBadge} | ${candidate.suggestedTTL} | ${candidate.reason} | ${candidate.impact.estimatedSavingsMinutes} min/week |\n`;
    }
    
    section += '\n';
    
    // Add quarantine actions
    section += '### 🎯 Recommended Actions\n\n';
    section += '```yaml\n';
    section += '# Add to .flakeguard/quarantine.yml\n';
    section += 'quarantined_tests:\n';
    
    for (const candidate of candidates.slice(0, 3)) {
      section += `  - test: "${candidate.testKey}"\n`;
      section += `    until: "${this.calculateExpiryDate(candidate.suggestedTTL)}"\n`;
      section += `    reason: "${candidate.reason}"\n`;
      section += `    priority: ${candidate.priority}\n\n`;
    }
    
    section += '```\n\n';
    return section;
  }

  private generatePassFailStreaksSection(streaks: any[]): string {
    let section = '## 📈 Pass/Fail Patterns\n\n';
    section += '*Recent test execution patterns*\n\n';
    
    section += '| Test | Current Streak | Pattern | Longest Pass | Longest Fail |\n';
    section += '|------|----------------|---------|--------------|---------------|\n';
    
    for (const streak of streaks) {
      const streakEmoji = streak.currentStreak.type === 'pass' ? '✅' : '❌';
      const streakText = `${streakEmoji} ${streak.currentStreak.count} ${streak.currentStreak.type}`;
      const patternDisplay = this.formatPattern(streak.pattern);
      
      section += `| **${streak.testName}** | ${streakText} | \`${patternDisplay}\` | ${streak.longestStreaks.passes} | ${streak.longestStreaks.failures} |\n`;
    }
    
    section += '\n';
    section += '*Pattern Legend: P = Pass, F = Fail (most recent on right)*\n\n';
    return section;
  }

  private generateEnvironmentDiffsSection(envDiffs: any[]): string {
    let section = '## 🌍 Environment Analysis\n\n';
    section += '*Tests showing environment-specific behavior*\n\n';
    
    for (const diff of envDiffs) {
      section += `### ${diff.testName}\n\n`;
      section += `**Suspected Cause:** ${diff.suspectedCause}\n\n`;
      section += '| Status | Environments |\n';
      section += '|--------|---------------|\n';
      section += `| ✅ **Passing** | ${diff.environments.passing.join(', ')} |\n`;
      section += `| ❌ **Failing** | ${diff.environments.failing.join(', ')} |\n\n`;
    }
    
    return section;
  }

  private generateRecentFailuresSection(failures: any[]): string {
    let section = '## 🚨 Recent Test Failures\n\n';
    
    const flakyFailures = failures.filter(f => f.messageHash.startsWith('flaky:'));
    const normalFailures = failures.filter(f => !f.messageHash.startsWith('flaky:'));
    
    if (flakyFailures.length > 0) {
      section += '### 🌀 Flaky Failures (May Pass on Retry)\n\n';
      section += '<details>\n<summary>Click to expand flaky test details</summary>\n\n';
      
      for (const failure of flakyFailures.slice(0, 5)) {
        section += `**${failure.name}** in \`${failure.file || 'unknown'}:${failure.line || '?'}\`\n`;
        section += `> ${failure.message}\n\n`;
      }
      
      section += '</details>\n\n';
    }
    
    if (normalFailures.length > 0) {
      section += '### ❌ Deterministic Failures\n\n';
      section += '<details>\n<summary>Click to expand failure details</summary>\n\n';
      
      for (const failure of normalFailures.slice(0, 5)) {
        section += `**${failure.name}** in \`${failure.file || 'unknown'}:${failure.line || '?'}\`\n`;
        section += `> ${failure.message}\n\n`;
        
        if (failure.stack) {
          section += '```\n';
          section += failure.stack.split('\n').slice(0, 3).join('\n');
          section += '\n...\n```\n\n';
        }
      }
      
      section += '</details>\n\n';
    }
    
    return section;
  }

  private generateFooter(summary: any): string {
    const timestamp = new Date(summary.timestamp).toLocaleString();
    
    return `---\n\n` +
           `<details>\n<summary>📊 Analysis Metadata</summary>\n\n` +
           `- **Analysis Time:** ${timestamp}\n` +
           `- **Commit:** \`${summary.sha.substring(0, 8)}\`\n` +
           `- **Branch:** ${summary.ref.replace('refs/heads/', '')}\n` +
           `- **FlakeGuard Version:** 1.0.0\n` +
           `- **Analysis Engine:** GitHub Actions Ingestion\n\n` +
           `</details>\n\n` +
           `*Generated by [FlakeGuard](https://github.com/flakeguard) 🛡️*\n`;
  }

  // Helper methods for formatting and emojis
  
  private calculateHealthScore(summary: any): number {
    const totalTests = summary.totalTests || 1;
    const failedTests = summary.failedTests || 0;
    const flakyTests = summary.flakyCandidates || 0;
    
    const failureRate = failedTests / totalTests;
    const flakyRate = flakyTests / totalTests;
    
    // Health score: 100% minus weighted penalties
    return Math.max(0, 1 - (failureRate * 0.6) - (flakyRate * 0.4));
  }

  private getHealthEmoji(score: number): string {
    if (score >= 0.9) return '🟢';
    if (score >= 0.7) return '🟡';
    if (score >= 0.5) return '🟠';
    return '🔴';
  }

  private getHealthStatus(score: number): string {
    if (score >= 0.9) return '**Excellent**';
    if (score >= 0.7) return '**Good**';
    if (score >= 0.5) return '**Fair**';
    return '**Needs Attention**';
  }

  private getTestCountStatus(count: number): string {
    return count > 0 ? '✅' : '⚠️';
  }

  private getFailureStatus(count: number): string {
    if (count === 0) return '✅ None';
    if (count <= 2) return '⚠️ Few';
    return '❌ Many';
  }

  private getFlakyStatus(count: number): string {
    if (count === 0) return '✅ None';
    if (count <= 1) return '⚠️ Low';
    if (count <= 3) return '🟠 Medium';
    return '🔴 High';
  }

  private getTrendEmoji(trend: string): string {
    switch (trend) {
      case 'improving': return '📈';
      case 'worsening': return '📉';
      default: return '📊';
    }
  }

  private getPriorityEmoji(priority: string): string {
    switch (priority) {
      case 'critical': return '🚨';
      case 'high': return '🔥';
      case 'medium': return '⚠️';
      default: return 'ℹ️';
    }
  }

  private getScoreBar(score: number): string {
    const barLength = 5;
    const filledBars = Math.round(score * barLength);
    const emptyBars = barLength - filledBars;
    
    return '█'.repeat(filledBars) + '░'.repeat(emptyBars);
  }

  private formatPattern(pattern: string): string {
    // Add spaces for readability
    return pattern.split('').join(' ');
  }

  private calculateExpiryDate(ttl: string): string {
    const now = new Date();
    
    if (ttl.includes('week')) {
      const weeks = parseInt(ttl) || 1;
      now.setDate(now.getDate() + (weeks * 7));
    } else if (ttl.includes('day')) {
      const days = parseInt(ttl) || 7;
      now.setDate(now.getDate() + days);
    }
    
    return now.toISOString().split('T')[0] || now.toDateString(); // YYYY-MM-DD format
  }
}