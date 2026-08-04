import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

export default async function () {
  console.log('E2E global setup started...');

  // Load test environment variables
  const envFile = process.env.ENV_TEST || '.env.test';
  const envPath = path.join(__dirname, `../../${envFile}`);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`Loaded ${envFile} file for E2E tests`);
  }

  // Set environment variables for E2E testing
  process.env.NODE_ENV = 'test';

  const testDbPath = path.join(__dirname, '../../test/database/e2e.db');
  const testDbDir = path.dirname(testDbPath);

  // Ensure test database directory exists
  if (!fs.existsSync(testDbDir)) {
    fs.mkdirSync(testDbDir, { recursive: true });
    console.log('Created E2E test database directory');
  }

  // Clean up E2E test database if it exists
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
    console.log('Removed existing E2E test database');
  }

  try {
    // Set DATABASE_URL and DATABASE_PROVIDER for E2E tests (SQLite)
    const sqliteUrl = `file:${testDbPath}`;
    process.env.DATABASE_URL = sqliteUrl;
    process.env.DATABASE_PROVIDER = 'sqlite';

    // Update prisma config to use SQLite for this run
    console.log('Generating Prisma client for E2E test environment...');
    execSync('npx prisma generate --schema="prisma/schema.test.prisma"', {
      stdio: 'inherit',
    });

    // Run migrations on E2E test database using db push
    console.log('Running migrations on E2E test database...');
    const dbPath = path
      .resolve(__dirname, '../../test/database/e2e.db')
      .replace(/\\/g, '/');
    const dbUrl = `file:${dbPath}`;
    console.log(`Using database URL: ${dbUrl}`);
    // Use --schema to specify schema file directly (no force-reset since we already deleted the file)
    execSync(
      `npx prisma db push --schema="prisma/schema.test.prisma" --url="${dbUrl}"`,
      {
        stdio: 'inherit',
      },
    );

    // Seed the E2E test database using prisma db seed
    console.log('Seeding E2E test database...');

    const seedEnv = {
      ...process.env,
      DATABASE_URL: dbUrl,
      DATABASE_PROVIDER: 'sqlite',
    };

    execSync('npx prisma db seed', {
      stdio: 'inherit',
      env: seedEnv,
      cwd: path.join(__dirname, '../..'),
    });

    console.log('E2E global setup completed');
  } catch (error) {
    console.error('E2E global setup failed:', error);
    throw error;
  }
}
