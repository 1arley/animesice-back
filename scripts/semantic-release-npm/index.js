import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

export async function verifyConditions(pluginConfig = {}, { cwd }) {
  if (pluginConfig.npmPublish !== false) {
    throw new Error('The local release plugin only supports npmPublish: false.');
  }

  if (pluginConfig.pkgRoot || pluginConfig.tarballDir) {
    throw new Error('The local release plugin only updates package files at the project root.');
  }

  const packageJson = JSON.parse(await readFile(path.resolve(cwd, 'package.json'), 'utf8'));
  if (!packageJson.name) {
    throw new Error('The project package.json must include a name.');
  }
}

export async function prepare(pluginConfig = {}, { cwd, nextRelease: { version }, logger }) {
  await verifyConditions(pluginConfig, { cwd });

  const packageJsonPath = path.resolve(cwd, 'package.json');
  const packageLockPath = path.resolve(cwd, 'package-lock.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const packageLock = JSON.parse(await readFile(packageLockPath, 'utf8'));

  packageJson.version = version;
  packageLock.version = version;

  if (packageLock.packages?.['']) {
    packageLock.packages[''].version = version;
  }

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
  logger.log('Write version %s to package.json and package-lock.json', version);
}
