import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const provider = process.env.DATABASE_PROVIDER || 'postgresql';

    if (provider === 'sqlite') {
      const adapter = new PrismaLibSql({
        url: process.env.DATABASE_URL || '',
      });
      super({ adapter });
    } else {
      const databaseUrl = process.env.DATABASE_URL || '';
      const pool = new Pool({
        connectionString: databaseUrl,
      });
      const adapter = new PrismaPg(pool);
      super({ adapter });
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
