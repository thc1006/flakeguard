import { promises as fs } from 'fs';
import path from 'path';

import { TranscriptEntry } from '../types';

export class TranscriptLogger {
  private filePath?: string;
  private entries: TranscriptEntry[] = [];
  private isEnabled: boolean;

  constructor(filePath?: string) {
    this.filePath = filePath;
    this.isEnabled = !!filePath;
  }

  async init(): Promise<void> {
    if (!this.isEnabled || !this.filePath) {return;}
    
    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    
    // Write initial header
    await this.writeHeader();
  }

  async log(message: string, data?: unknown, level: 'info' | 'error' | 'warn' | 'debug' = 'info'): Promise<void> {
    const entry: TranscriptEntry = {
      timestamp: new Date().toISOString(),
      level,
      stage: this.getCurrentStage(),
      message,
      data
    };
    
    this.entries.push(entry);
    
    if (this.isEnabled && this.filePath) {
      await this.writeEntry(entry);
    }
  }

  async error(message: string, error?: unknown): Promise<void> {
    await this.log(message, {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    }, 'error');
  }

  async warn(message: string, data?: unknown): Promise<void> {
    await this.log(message, data, 'warn');
  }

  async debug(message: string, data?: unknown): Promise<void> {
    await this.log(message, data, 'debug');
  }

  private async writeHeader(): Promise<void> {
    if (!this.filePath) {return;}
    
    const header = [
      '# FlakeGuard Setup Wizard Transcript',
      `# Generated: ${new Date().toISOString()}`,
      `# Node Version: ${process.version}`,
      `# Platform: ${process.platform}`,
      `# Working Directory: ${process.cwd()}`,
      '',
      'Timeline:',
      '=========',
      ''
    ].join('\n');
    
    await fs.writeFile(this.filePath, header, 'utf8');
  }

  private async writeEntry(entry: TranscriptEntry): Promise<void> {
    if (!this.filePath) {return;}
    
    const timestamp = new Date(entry.timestamp).toLocaleString();
    const levelIcon = this.getLevelIcon(entry.level);
    
    let logLine = `[${timestamp}] ${levelIcon} ${entry.stage.toUpperCase()}: ${entry.message}`;
    
    if (entry.data) {
      logLine += '\n' + this.formatData(entry.data);
    }
    
    logLine += '\n\n';
    
    await fs.appendFile(this.filePath, logLine, 'utf8');
  }

  private getLevelIcon(level: string): string {
    switch (level) {
      case 'info': return 'ℹ️ ';
      case 'error': return '❌';
      case 'warn': return '⚠️ ';
      case 'debug': return '🔍';
      default: return '📝';
    }
  }

  private getCurrentStage(): string {
    // This would be set by the wizard, for now return generic
    return 'setup';
  }

  private formatData(data: unknown): string {
    if (typeof data === 'string') {
      return `  Data: ${data}`;
    }
    
    try {
      // Mask sensitive information before logging
      const maskedData = this.maskSensitiveData(data);
      return `  Data: ${JSON.stringify(maskedData, null, 2)}`
        .split('\n')
        .map(line => `    ${line}`)
        .join('\n');
    } catch (error) {
      return `  Data: [Could not serialize data: ${error}]`;
    }
  }

  private maskSensitiveData(data: unknown): unknown {
    if (typeof data !== 'object' || data === null) {
      return data;
    }
    
    const sensitiveKeys = [
      'password',
      'secret',
      'token',
      'key',
      'auth',
      'credential',
      'private'
    ];
    
    if (Array.isArray(data)) {
      return data.map(item => this.maskSensitiveData(item));
    }
    
    const masked: Record<string, unknown> = { ...(data as Record<string, unknown>) };
    
    for (const [key, value] of Object.entries(masked)) {
      const lowerKey = key.toLowerCase();
      
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        if (typeof value === 'string' && value.length > 0) {
          masked[key] = value.length <= 8 ? 
            '*'.repeat(value.length) : 
            `${value.substring(0, 2)}${'*'.repeat(value.length - 4)}${value.substring(value.length - 2)}`;
        } else {
          masked[key] = '[REDACTED]';
        }
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = this.maskSensitiveData(value);
      }
    }
    
    return masked;
  }

  getEntries(): TranscriptEntry[] {
    return [...this.entries];
  }

  async getTranscriptContent(): Promise<string | null> {
    if (!this.filePath) {return null;}
    
    try {
      return await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      return null;
    }
  }

  async exportSummary(): Promise<{
    totalEntries: number;
    errorCount: number;
    warningCount: number;
    duration: number;
    stages: string[];
  }> {
    const errorCount = this.entries.filter(e => e.level === 'error').length;
    const warningCount = this.entries.filter(e => e.level === 'warn').length;
    
    const stages = [...new Set(this.entries.map(e => e.stage))];
    
    const firstEntry = this.entries[0];
    const lastEntry = this.entries[this.entries.length - 1];
    const startTime = firstEntry ? new Date(firstEntry.timestamp).getTime() : 0;
    const endTime = lastEntry ? new Date(lastEntry.timestamp).getTime() : 0;
    const duration = endTime - startTime;
    
    return {
      totalEntries: this.entries.length,
      errorCount,
      warningCount,
      duration,
      stages
    };
  }

  async close(): Promise<void> {
    if (!this.isEnabled || !this.filePath) {return;}
    
    const summary = await this.exportSummary();
    
    const footer = [
      '',
      'Summary:',
      '========',
      `Total Entries: ${summary.totalEntries}`,
      `Errors: ${summary.errorCount}`,
      `Warnings: ${summary.warningCount}`,
      `Duration: ${(summary.duration / 1000).toFixed(2)} seconds`,
      `Stages: ${summary.stages.join(', ')}`,
      '',
      `Transcript completed: ${new Date().toISOString()}`,
      ''
    ].join('\n');
    
    await fs.appendFile(this.filePath, footer, 'utf8');
  }
}