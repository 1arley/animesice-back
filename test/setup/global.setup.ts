import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

export default async function () {
  console.log('Global setup for unit tests started...');

  // Load test environment variables
  const envPath = path.join(__dirname, '../../.env.test');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log('Loaded .env.test file');
  }

  // Set environment variables for testing
  process.env.NODE_ENV = 'test';

  const testDbPath = path.join(__dirname, '../../test/database/test.db');
  const testDbDir = path.dirname(testDbPath);

  // Ensure test database directory exists
  if (!fs.existsSync(testDbDir)) {
    fs.mkdirSync(testDbDir, { recursive: true });
    console.log('Created test database directory');
  }

  // Clean up test database if it exists
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
    console.log('Removed existing test database');
  }

  try {
    // Generate Prisma client for test environment
    console.log('Generating Prisma client for test environment...');
    execSync('npx prisma generate', { stdio: 'inherit' });

    // Run migrations on test database
    console.log('Running migrations on test database...');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });

    // Seed the test database if needed
    console.log('Seeding test database...');
    const seedPath = path.join(__dirname, '../../prisma/seed.ts');
    if (fs.existsSync(seedPath)) {
      execSync('npx ts-node prisma/seed.ts', { stdio: 'inherit' });
    }

    console.log('Global setup for unit tests completed');
  } catch (error) {
    console.error('Global setup failed:', error);
    throw error;
  }
}
