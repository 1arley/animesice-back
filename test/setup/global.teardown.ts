import * as fs from 'fs';
import * as path from 'path';

export default async function () {
  console.log('Global teardown for unit tests started...');

  const testDbPath = path.join(__dirname, '../../test/database/test.db');

  // Clean up test database
  if (fs.existsSync(testDbPath)) {
    try {
      fs.unlinkSync(testDbPath);
      console.log('Test database removed successfully');
    } catch (error) {
      console.warn('Could not remove test database:', error);
    }
  }

  // Clean up test database journal if exists
  const testDbJournalPath = path.join(
    __dirname,
    '../../test/database/test.db-journal',
  );
  if (fs.existsSync(testDbJournalPath)) {
    try {
      fs.unlinkSync(testDbJournalPath);
      console.log('Test database journal removed');
    } catch (error) {
      console.warn('Could not remove test database journal:', error);
    }
  }

  // Clean up test database shm if exists
  const testDbShmPath = path.join(__dirname, '../../test/database/test.db-shm');
  if (fs.existsSync(testDbShmPath)) {
    try {
      fs.unlinkSync(testDbShmPath);
      console.log('Test database SHM removed');
    } catch (error) {
      console.warn('Could not remove test database SHM:', error);
    }
  }

  // Clean up test database wal if exists
  const testDbWalPath = path.join(__dirname, '../../test/database/test.db-wal');
  if (fs.existsSync(testDbWalPath)) {
    try {
      fs.unlinkSync(testDbWalPath);
      console.log('Test database WAL removed');
    } catch (error) {
      console.warn('Could not remove test database WAL:', error);
    }
  }

  console.log('Global teardown for unit tests completed');
}
