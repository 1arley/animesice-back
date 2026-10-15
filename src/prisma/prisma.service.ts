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
        // Aumenta pool p/ absorver bursts do Watchtower (tick + repair + checkReleases concorrentes)
        // Default node-postgres = 10; 20 evita "pool exhausted" sob carga.
        max: Number(process.env.DATABASE_POOL_MAX ?? 20),
        // Idle timeout: libera conexões ociosas após 30s (default 30s)
        idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT ?? 30_000),
        // Connection timeout: falha rápido se pool cheio (default 0 = infinito)
        connectionTimeoutMillis: Number(
          process.env.DATABASE_CONN_TIMEOUT ?? 5_000,
        ),
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
