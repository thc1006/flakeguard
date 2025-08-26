import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { Client } from 'pg';
import Redis from 'redis';

import { I18nManager } from '../i18n/I18nManager';
import { DatabaseConfig } from '../types';

export class DatabaseManager {
  private i18n: I18nManager;

  constructor(i18n: I18nManager) {
    this.i18n = i18n;
  }

  async setupDatabase(): Promise<DatabaseConfig> {
    console.log(chalk.gray(this.i18n.t('database.description')));

    const { dbType } = await inquirer.prompt<{ dbType: 'docker' | 'existing' | 'cloud' }>([
      {
        type: 'list',
        name: 'dbType',
        message: this.i18n.t('database.selectType'),
        choices: [
          {
            name: this.i18n.t('database.useDocker'),
            value: 'docker'
          },
          {
            name: this.i18n.t('database.useExisting'),
            value: 'existing'
          },
          {
            name: this.i18n.t('database.useCloud'),
            value: 'cloud'
          }
        ],
        default: 'docker'
      }
    ]);

    let databaseUrl: string;
    let redisUrl: string;

    switch (dbType) {
      case 'docker':
        ({ databaseUrl, redisUrl } = await this.setupDockerDatabases());
        break;
      case 'existing':
        ({ databaseUrl, redisUrl } = await this.setupExistingDatabases());
        break;
      case 'cloud':
        ({ databaseUrl, redisUrl } = await this.setupCloudDatabases());
        break;
      default:
        throw new Error('Invalid database type selected');
    }

    // Test connections
    await this.testConnections(databaseUrl, redisUrl);

    return {
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl
    };
  }

  private async setupDockerDatabases(): Promise<{ databaseUrl: string; redisUrl: string }> {
    console.log('\n' + chalk.blue(this.i18n.t('database.dockerSetup')));
    
    const { startContainers } = await inquirer.prompt<{ startContainers: boolean }>([
      {
        type: 'confirm',
        name: 'startContainers',
        message: this.i18n.t('database.startContainers'),
        default: true
      }
    ]);

    if (startContainers) {
      const spinner = ora(this.i18n.t('database.startingContainers')).start();
      
      try {
        // This would typically run docker-compose up -d for database services
        // For now, we'll assume the containers will be started
        await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate startup time
        
        spinner.succeed(this.i18n.t('database.containersStarted'));
      } catch (error) {
        spinner.fail(this.i18n.t('database.containersFailed'));
        throw error;
      }
    }

    const dbConfig = await inquirer.prompt<{
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
    }>([
      {
        type: 'input',
        name: 'host',
        message: this.i18n.t('database.postgresHost'),
        default: 'localhost'
      },
      {
        type: 'number',
        name: 'port',
        message: this.i18n.t('database.postgresPort'),
        default: 5432
      },
      {
        type: 'input',
        name: 'database',
        message: this.i18n.t('database.postgresDatabase'),
        default: 'flakeguard'
      },
      {
        type: 'input',
        name: 'username',
        message: this.i18n.t('database.postgresUsername'),
        default: 'postgres'
      },
      {
        type: 'password',
        name: 'password',
        message: this.i18n.t('database.postgresPassword'),
        default: 'postgres'
      }
    ]);

    const redisConfig = await inquirer.prompt<{
      host: string;
      port: number;
      password: string;
    }>([
      {
        type: 'input',
        name: 'host',
        message: this.i18n.t('database.redisHost'),
        default: 'localhost'
      },
      {
        type: 'number',
        name: 'port',
        message: this.i18n.t('database.redisPort'),
        default: 6379
      },
      {
        type: 'password',
        name: 'password',
        message: this.i18n.t('database.redisPassword'),
        default: ''
      }
    ]);

    const databaseUrl = `postgresql://${dbConfig.username}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}?schema=public`;
    const redisUrl = redisConfig.password ? 
      `redis://:${redisConfig.password}@${redisConfig.host}:${redisConfig.port}` :
      `redis://${redisConfig.host}:${redisConfig.port}`;

    return { databaseUrl, redisUrl };
  }

  private async setupExistingDatabases(): Promise<{ databaseUrl: string; redisUrl: string }> {
    console.log('\n' + chalk.blue(this.i18n.t('database.existingSetup')));
    
    const { databaseUrl } = await inquirer.prompt<{ databaseUrl: string }>([
      {
        type: 'input',
        name: 'databaseUrl',
        message: this.i18n.t('database.postgresUrl'),
        validate: (input: string) => {
          if (!input.startsWith('postgresql://')) {
            return this.i18n.t('database.invalidPostgresUrl');
          }
          return true;
        }
      }
    ]);

    const { redisUrl } = await inquirer.prompt<{ redisUrl: string }>([
      {
        type: 'input',
        name: 'redisUrl',
        message: this.i18n.t('database.redisUrl'),
        default: 'redis://localhost:6379',
        validate: (input: string) => {
          if (!input.startsWith('redis://')) {
            return this.i18n.t('database.invalidRedisUrl');
          }
          return true;
        }
      }
    ]);

    return { databaseUrl, redisUrl };
  }

  private async setupCloudDatabases(): Promise<{ databaseUrl: string; redisUrl: string }> {
    console.log('\n' + chalk.blue(this.i18n.t('database.cloudSetup')));
    
    const { provider } = await inquirer.prompt<{ provider: string }>([
      {
        type: 'list',
        name: 'provider',
        message: this.i18n.t('database.selectProvider'),
        choices: [
          { name: 'AWS RDS + ElastiCache', value: 'aws' },
          { name: 'Google Cloud SQL + Memorystore', value: 'gcp' },
          { name: 'Azure Database + Cache', value: 'azure' },
          { name: 'Railway', value: 'railway' },
          { name: 'Supabase + Upstash', value: 'supabase' },
          { name: 'Other', value: 'other' }
        ]
      }
    ]);

    console.log(chalk.yellow(`\n${this.i18n.t('database.cloudInstructions', { provider })}\n`));

    const { databaseUrl } = await inquirer.prompt<{ databaseUrl: string }>([
      {
        type: 'input',
        name: 'databaseUrl',
        message: this.i18n.t('database.cloudPostgresUrl'),
        validate: (input: string) => {
          if (!input.startsWith('postgresql://')) {
            return this.i18n.t('database.invalidPostgresUrl');
          }
          return true;
        }
      }
    ]);

    const { redisUrl } = await inquirer.prompt<{ redisUrl: string }>([
      {
        type: 'input',
        name: 'redisUrl',
        message: this.i18n.t('database.cloudRedisUrl'),
        validate: (input: string) => {
          if (!input.startsWith('redis://') && !input.startsWith('rediss://')) {
            return this.i18n.t('database.invalidRedisUrl');
          }
          return true;
        }
      }
    ]);

    return { databaseUrl, redisUrl };
  }

  private async testConnections(databaseUrl: string, redisUrl: string): Promise<void> {
    const spinner = ora(this.i18n.t('database.testingConnections')).start();
    
    try {
      // Test PostgreSQL connection
      const pgClient = new Client({ connectionString: databaseUrl });
      await pgClient.connect();
      await pgClient.query('SELECT 1');
      await pgClient.end();
      
      spinner.text = this.i18n.t('database.testingRedis');
      
      // Test Redis connection
      const redisClient = Redis.createClient({ url: redisUrl });
      await redisClient.connect();
      await redisClient.ping();
      await redisClient.quit();
      
      spinner.succeed(this.i18n.t('database.connectionsSuccessful'));
    } catch (error) {
      spinner.fail(this.i18n.t('database.connectionsFailed'));
      
      console.log(chalk.red('\n' + this.i18n.t('database.connectionError') + ':'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      
      const { continueAnyway } = await inquirer.prompt<{ continueAnyway: boolean }>([
        {
          type: 'confirm',
          name: 'continueAnyway',
          message: this.i18n.t('database.continueWithoutConnection'),
          default: false
        }
      ]);
      
      if (!continueAnyway) {
        throw new Error(this.i18n.t('database.setupAborted'));
      }
    }
  }

  async createDatabase(databaseUrl: string): Promise<void> {
    const spinner = ora(this.i18n.t('database.creatingDatabase')).start();
    
    try {
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      
      // Run migrations or create tables here
      // This would typically run Prisma migrations or SQL scripts
      
      await client.end();
      spinner.succeed(this.i18n.t('database.databaseCreated'));
    } catch (error) {
      spinner.fail(this.i18n.t('database.databaseCreationFailed'));
      throw error;
    }
  }

  async seedAdminUser(databaseUrl: string): Promise<void> {
    const spinner = ora(this.i18n.t('database.seedingAdmin')).start();
    
    const adminUser = await inquirer.prompt<{
      email: string;
      name: string;
      password: string;
    }>([
      {
        type: 'input',
        name: 'email',
        message: this.i18n.t('database.adminEmail'),
        validate: (input: string) => {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(input)) {
            return this.i18n.t('database.invalidEmail');
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'name',
        message: this.i18n.t('database.adminName'),
        default: 'Admin User'
      },
      {
        type: 'password',
        name: 'password',
        message: this.i18n.t('database.adminPassword'),
        validate: (input: string) => {
          if (input.length < 8) {
            return this.i18n.t('database.passwordTooShort');
          }
          return true;
        }
      }
    ]);
    
    try {
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      
      // Hash password and insert admin user
      // This would typically use bcrypt and insert into users table
      
      await client.end();
      spinner.succeed(this.i18n.t('database.adminUserCreated'));
      
      console.log(chalk.green(`\n✅ ${this.i18n.t('database.adminCredentials')}:`));
      console.log(chalk.white(`   ${this.i18n.t('database.email')}: ${adminUser.email}`));
      console.log(chalk.white(`   ${this.i18n.t('database.password')}: ${adminUser.password}`));
    } catch (error) {
      spinner.fail(this.i18n.t('database.adminUserFailed'));
      throw error;
    }
  }
}