import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const episodes = await prisma.episode.findMany({
    where: { embedUrl: { not: null } },
    select: {
      id: true,
      embedUrl: true,
      sourceId: true,
      anime: { select: { audio: true } },
    },
  });
  const rows = episodes.filter(
    (episode) =>
      episode.embedUrl &&
      /meusanimes\.blog|meusdoramas\.club/i.test(episode.embedUrl),
  );
  console.log(
    `[MEUSA-BACKFILL] ${rows.length} episódios elegíveis; apply=${apply}`,
  );
  if (!apply) return;

  for (const episode of rows) {
    await prisma.episodeSource.upsert({
      where: {
        episodeId_sourceId: {
          episodeId: episode.id,
          sourceId: episode.sourceId ?? 'meusanimes',
        },
      },
      update: { pageUrl: episode.embedUrl!, audio: episode.anime.audio },
      create: {
        episodeId: episode.id,
        sourceId: episode.sourceId ?? 'meusanimes',
        pageUrl: episode.embedUrl!,
        audio: episode.anime.audio,
      },
    });
  }
  console.log(`[MEUSA-BACKFILL] ${rows.length} vínculos gravados`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
