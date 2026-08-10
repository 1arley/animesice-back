#!/usr/bin/env ts-node
/**
 * diagnose-anime.ts — diagnóstico de descoberta/criação/extração/reprodução
 * de um anime a partir do slug. Imprime Anime, Episodes, jobs de Watchtower,
 * fontes candidatas e o veredito de stream.
 *
 * Uso: ts-node scripts/diagnose-anime.ts <slug>
 * Env: DATABASE_URL
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

const slug = process.argv[2];
if (!slug) {
  console.error('Uso: ts-node scripts/diagnose-anime.ts <slug>');
  process.exit(1);
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function probeHost(url: string): Promise<[number, string]> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    await res.body?.cancel();
    return [res.status, ''];
  } catch (e) {
    return [-1, e instanceof Error ? e.message : String(e)];
  }
}

async function main(): Promise<void> {
  const anime = await prisma.anime.findUnique({
    where: { slug },
    include: { episodes: { orderBy: { season: 'asc' } } },
  });
  if (!anime) {
    console.log(`✗ Anime não encontrado: ${slug}`);
    return;
  }

  console.log('=== ANIME ===');
  console.log(
    `id=${anime.id}\nslug=${anime.slug}\ntitle=${anime.title}\nformat=${anime.format ?? '?'}\nstatus=${anime.status}\nepisodeCount=${anime.episodeCount ?? '?'}\nanilistId=${anime.anilistId ?? '-'}\ncover=${anime.coverImage ?? '-'}`,
  );

  console.log('\n=== EPISODES ===');
  if (anime.episodes.length === 0) {
    console.log('Nenhum episódio no DB.');
  }
  for (const e of anime.episodes) {
    console.log(
      `s${e.season}e${e.number} title="${e.title ?? ''}" video=${e.videoUrl ? e.videoUrl.slice(0, 70) + '…' : 'NULL'} embed=${e.embedUrl ?? 'NULL'} broken=${e.videoBroken} checkedAt=${e.videoCheckedAt?.toISOString() ?? '-'} src=${e.sourceId ?? '-'}`,
    );
  }

  console.log('\n=== WATCHTOWER JOBS ===');
  const jobs = await prisma.watchtowerJob.findMany({
    where: {
      OR: [
        { dedupeKey: { contains: anime.id } },
        { dedupeKey: { contains: slug } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  if (jobs.length === 0) console.log('Nenhum job.');
  for (const j of jobs) {
    console.log(
      `${j.type} ${j.status} attempts=${j.attempts}/${j.maxAttempts} dedupe=${j.dedupeKey} err=${(j.lastError ?? '').slice(0, 120)}`,
    );
  }

  console.log('\n=== CANDIDATAS DE FONTE (meusanimes) ===');
  const candidates = [
    `https://meusanimes.blog/e/${slug}-1-episodio-1/`,
    `https://meusanimes.blog/e/${slug}/`,
    `https://meusanimes.blog/a/${slug}/`,
  ];
  for (const u of candidates) {
    const [code, err] = await probeHost(u);
    console.log(
      `${code >= 0 ? `HTTP ${code}` : 'ERR'}\t${u}${err ? ` (${err})` : ''}`,
    );
  }

  console.log('\n=== HOSTS DE MÍDIA vs ALLOWLIST ===');
  const allowedHosts = (process.env.EMBED_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const allow = (host: string) =>
    allowedHosts.some((a) => host === a || host.endsWith(`.${a}`));
  const seen = new Set<string>();
  for (const e of anime.episodes) {
    if (!e.videoUrl) continue;
    try {
      const h = new URL(e.videoUrl).hostname.toLowerCase();
      if (seen.has(h)) continue;
      seen.add(h);
      console.log(`${allow(h) ? 'OK' : 'BLOQUEADO'}\t${h}`);
    } catch {
      console.log(`INVALIDA\t${e.videoUrl.slice(0, 60)}`);
    }
  }

  console.log('\n=== VEREDITO EPISÓDIO 1 ===');
  const ep1 = anime.episodes.find((e) => e.season === 1 && e.number === 1);
  if (!ep1) {
    console.log(
      'Episódio 1 inexistente — escala SCAN_CATALOG/EXTRACT_EPISODE.',
    );
  } else if (!ep1.videoUrl) {
    console.log('Sem videoUrl — getSource tentará re-extração via embedUrl.');
  } else {
    let hostBlocked = false;
    try {
      const h = new URL(ep1.videoUrl).hostname.toLowerCase();
      hostBlocked = !allow(h);
    } catch {
      hostBlocked = true;
    }
    console.log(
      hostBlocked
        ? `videoUrl existe mas host BLOQUEADO pelo EMBED_ALLOWED_HOSTS — media proxy retornará 400.`
        : `videoUrl host permitido — esperado 200 no /stream/source.`,
    );
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
