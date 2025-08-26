import { promises as fs } from 'fs';
import net from 'net';
import path from 'path';

import { spawn } from 'cross-spawn';
import semver from 'semver';


import { I18nManager } from '../i18n/I18nManager.js';
import { ValidationResult, PortCheck } from '../types/index.js';

export class EnvironmentValidator {
  private i18n: I18nManager;

  constructor(i18n: I18nManager) {
    this.i18n = i18n;
  }

  async validateAll(): Promise<Record<string, ValidationResult>> {
    const results: Record<string, ValidationResult> = {};

    // Node.js version validation
    results.node = this.validateNodeVersion();
    
    // Package manager validation
    results.packageManager = await this.validatePackageManager();
    
    // Docker validation
    results.docker = await this.validateDocker();
    
    // System dependencies
    results.systemDeps = await this.validateSystemDependencies();
    
    // Port availability
    results.ports = await this.validatePorts();
    
    // File system permissions
    results.permissions = await this.validatePermissions();
    
    // Network connectivity
    results.network = await this.validateNetworkConnectivity();

    return results;
  }

  private validateNodeVersion(): ValidationResult {
    try {
      const nodeVersion = process.version;
      const required = '>=20.0.0';
      
      if (semver.satisfies(nodeVersion, required)) {
        return {
          valid: true,
          message: this.i18n.t('validation.node.valid', { version: nodeVersion })
        };
      } else {
        return {
          valid: false,
          critical: true,
          message: this.i18n.t('validation.node.invalid', { 
            current: nodeVersion, 
            required 
          }),
          suggestions: [
            this.i18n.t('validation.node.suggestion1'),
            this.i18n.t('validation.node.suggestion2')
          ]
        };
      }
    } catch (error) {
      return {
        valid: false,
        critical: true,
        message: this.i18n.t('validation.node.error'),
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async validatePackageManager(): Promise<ValidationResult> {
    try {
      // Check for pnpm first
      const pnpmVersion = await this.getCommandVersion('pnpm', '--version');
      if (pnpmVersion && semver.gte(pnpmVersion, '8.0.0')) {
        return {
          valid: true,
          message: this.i18n.t('validation.packageManager.pnpm', { version: pnpmVersion })
        };
      }

      // Fall back to npm
      const npmVersion = await this.getCommandVersion('npm', '--version');
      if (npmVersion && semver.gte(npmVersion, '9.0.0')) {
        return {
          valid: true,
          message: this.i18n.t('validation.packageManager.npm', { version: npmVersion }),
          suggestions: [this.i18n.t('validation.packageManager.pnpmRecommended')]
        };
      }

      return {
        valid: false,
        critical: true,
        message: this.i18n.t('validation.packageManager.notFound'),
        suggestions: [
          this.i18n.t('validation.packageManager.installPnpm'),
          this.i18n.t('validation.packageManager.installNpm')
        ]
      };
    } catch (error) {
      return {
        valid: false,
        critical: true,
        message: this.i18n.t('validation.packageManager.error'),
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async validateDocker(): Promise<ValidationResult> {
    try {
      const dockerVersion = await this.getCommandVersion('docker', '--version');
      const composeVersion = await this.getCommandVersion('docker', 'compose', 'version', '--short');
      
      if (dockerVersion && composeVersion) {
        return {
          valid: true,
          message: this.i18n.t('validation.docker.valid', {
            dockerVersion,
            composeVersion
          })
        };
      } else if (dockerVersion && !composeVersion) {
        return {
          valid: false,
          message: this.i18n.t('validation.docker.missingCompose'),
          suggestions: [this.i18n.t('validation.docker.installCompose')]
        };
      } else {
        return {
          valid: false,
          message: this.i18n.t('validation.docker.notFound'),
          suggestions: [
            this.i18n.t('validation.docker.installDocker'),
            this.i18n.t('validation.docker.startDocker')
          ]
        };
      }
    } catch (error) {
      return {
        valid: false,
        message: this.i18n.t('validation.docker.error'),
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async validateSystemDependencies(): Promise<ValidationResult> {
    const checks: string[] = [];
    
    try {
      // Check Git
      const gitVersion = await this.getCommandVersion('git', '--version');
      if (gitVersion) {
        checks.push(this.i18n.t('validation.system.gitOk'));
      } else {
        checks.push(this.i18n.t('validation.system.gitMissing'));
      }

      // Check curl/wget for API testing
      const curlVersion = await this.getCommandVersion('curl', '--version');
      const wgetVersion = await this.getCommandVersion('wget', '--version');
      
      if (curlVersion ?? wgetVersion) {
        checks.push(this.i18n.t('validation.system.httpClientOk'));
      } else {
        checks.push(this.i18n.t('validation.system.httpClientMissing'));
      }

      const allValid = !checks.some(check => check.includes('missing'));
      
      return {
        valid: allValid,
        message: allValid ? 
          this.i18n.t('validation.system.allValid') : 
          this.i18n.t('validation.system.someInvalid'),
        details: checks
      };
    } catch (error) {
      return {
        valid: false,
        message: this.i18n.t('validation.system.error'),
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async validatePorts(): Promise<ValidationResult> {
    const portsToCheck = [3000, 5432, 6379, 3001]; // API, PostgreSQL, Redis, Slack
    const portChecks: PortCheck[] = [];
    
    for (const port of portsToCheck) {
      const available = await this.isPortAvailable(port);
      portChecks.push({ port, available });
    }
    
    const unavailablePorts = portChecks.filter(p => !p.available);
    
    if (unavailablePorts.length === 0) {
      return {
        valid: true,
        message: this.i18n.t('validation.ports.allAvailable')
      };
    } else {
      return {
        valid: false,
        message: this.i18n.t('validation.ports.someUnavailable', {
          ports: unavailablePorts.map(p => p.port).join(', ')
        }),
        suggestions: [
          this.i18n.t('validation.ports.changeConfig'),
          this.i18n.t('validation.ports.stopServices')
        ]
      };
    }
  }

  private async validatePermissions(): Promise<ValidationResult> {
    try {
      const cwd = process.cwd();
      
      // Test write permissions
      const testFile = path.join(cwd, '.flakeguard-test');
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
      
      return {
        valid: true,
        message: this.i18n.t('validation.permissions.valid')
      };
    } catch (error) {
      return {
        valid: false,
        critical: true,
        message: this.i18n.t('validation.permissions.invalid'),
        details: error instanceof Error ? error.message : String(error),
        suggestions: [
          this.i18n.t('validation.permissions.checkOwnership'),
          this.i18n.t('validation.permissions.runAsAdmin')
        ]
      };
    }
  }

  private async validateNetworkConnectivity(): Promise<ValidationResult> {
    try {
      // Test GitHub API connectivity
      const githubTest = await this.testHttpConnectivity('api.github.com', 443);
      
      // Test Docker Hub connectivity  
      const dockerTest = await this.testHttpConnectivity('registry-1.docker.io', 443);
      
      if (githubTest && dockerTest) {
        return {
          valid: true,
          message: this.i18n.t('validation.network.valid')
        };
      } else {
        return {
          valid: false,
          message: this.i18n.t('validation.network.issues'),
          suggestions: [
            this.i18n.t('validation.network.checkFirewall'),
            this.i18n.t('validation.network.checkProxy')
          ]
        };
      }
    } catch (error) {
      return {
        valid: false,
        message: this.i18n.t('validation.network.error'),
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async getCommandVersion(...args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      const command = args[0];
      if (!command) {
        resolve(null);
        return;
      }
      const child = spawn(command, args.slice(1), {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000
      });
      
      let output = '';
      
      child.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });
      
      child.on('close', (code: number | null) => {
        if (code === 0) {
          // Extract version number from output
          const versionMatch = output.match(/\d+\.\d+\.\d+/);
          resolve(versionMatch?.[0] ?? output.trim());
        } else {
          resolve(null);
        }
      });
      
      child.on('error', () => {
        resolve(null);
      });
    });
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, () => {
        server.close(() => {
          resolve(true);
        });
      });
      
      server.on('error', () => {
        resolve(false);
      });
    });
  }

  private async testHttpConnectivity(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 5000);
      
      socket.connect(port, host, () => {
        clearTimeout(timeout);
        socket.end();
        resolve(true);
      });
      
      socket.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }
}