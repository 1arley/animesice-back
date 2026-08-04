import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function main() {
  console.log(
    'Template initialized. Remove this script and use Application entrypoint.',
  );
}

async function run() {
  try {
    main();
  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    await prisma.$disconnect();
  }
}

void run();
