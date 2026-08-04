import * as fs from 'fs';
import * as path from 'path';

export default async function () {
  console.log('E2E global teardown started...');

  const testDbPath = path.join(__dirname, '../../test/database/e2e.db');

  // Clean up E2E test database
  if (fs.existsSync(testDbPath)) {
    try {
      fs.unlinkSync(testDbPath);
      console.log('E2E test database removed successfully');
    } catch (error) {
      console.warn('Could not remove E2E test database:', error);
    }
  }

  // Clean up E2E test database journal if exists
  const testDbJournalPath = path.join(
    __dirname,
    '../../test/database/e2e.db-journal',
  );
  if (fs.existsSync(testDbJournalPath)) {
    try {
      fs.unlinkSync(testDbJournalPath);
      console.log('E2E test database journal removed');
    } catch (error) {
      console.warn('Could not remove E2E test database journal:', error);
    }
  }

  // Clean up E2E test database shm if exists
  const testDbShmPath = path.join(__dirname, '../../test/database/e2e.db-shm');
  if (fs.existsSync(testDbShmPath)) {
    try {
      fs.unlinkSync(testDbShmPath);
      console.log('E2E test database SHM removed');
    } catch (error) {
      console.warn('Could not remove E2E test database SHM:', error);
    }
  }

  // Clean up E2E test database wal if exists
  const testDbWalPath = path.join(__dirname, '../../test/database/e2e.db-wal');
  if (fs.existsSync(testDbWalPath)) {
    try {
      fs.unlinkSync(testDbWalPath);
      console.log('E2E test database WAL removed');
    } catch (error) {
      console.warn('Could not remove E2E test database WAL:', error);
    }
  }

  console.log('E2E global teardown completed');
}
