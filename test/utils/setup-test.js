/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require('child_process');
const { existsSync } = require('fs');

// Prisma refuses destructive CLI commands (db push --force-reset, migrate reset)
// when it detects AI agent env vars. Strip them so the test harness can run.
delete process.env.OPENCODE;
delete process.env.OPENCODE_PID;
delete process.env.AGENT;
delete process.env.CLAUDECODE;
delete process.env.CODEX;
delete process.env.CURSOR;
delete process.env.GITHUB_COPILOT;
delete process.env.WINDSURF;
delete process.env.CONTINUE;
delete process.env.AIDER;
delete process.env.DEVIN;
delete process.env.REPLIT_AGENT;


function checkRequirements() {
  const errors = [];

  if (!existsSync('./docker-compose.test.yml')) {
    errors.push('docker-compose.test.yml não foi encontrado na raiz');
  }

  if (!existsSync('./.env.test')) {
    errors.push('.env.test não foi encontrado na raiz');
  }

  try {
    execSync('docker --version', { stdio: 'pipe' });
  } catch {
    errors.push(
      'docker não encontrado — instale em https://docs.docker.com/get-docker',
    );
  }

  try {
    execSync('npx dotenv-cli --help', { stdio: 'pipe' });
  } catch {
    errors.push(
      'dotenv-cli não encontrado — instale com: npm install -g dotenv-cli',
    );
  }

  if (errors.length > 0) {
    console.error('\n🚨 Pré-requisitos não atendidos:\n');
    errors.forEach((e) => console.error(` ❌ ${e} `));
    console.error('\nCorrija os problemas acima e tente novamente.\n');
    process.exit(1);
  }

  console.log('✅ Todos os pré-requisitos atendidos.\n');
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

checkRequirements();

try {
  run('docker compose -f ./docker-compose.test.yml rm -sf animesice-db-test');

  run('docker compose -f ./docker-compose.test.yml up --build -d --wait');

  run('npx dotenv-cli -e .env.test -- npx prisma generate');

  run(
    'npx dotenv-cli -e .env.test -- npx prisma migrate reset --force',
  );

  run(
    'npx dotenv-cli -e .env.test -- npx jest --config ./test/jest-e2e.json --runInBand --forceExit',
  );
} finally {
  run('docker compose -f ./docker-compose.test.yml rm -sf');
}