import { AudioType } from '@prisma/client';
import { AdminService } from '@/admin/admin.service';

describe('AdminService (consistência de áudio)', () => {
  function build() {
    const anime = {
      findUnique: jest.fn(),
      create: jest.fn(async ({ data }) => data),
      update: jest.fn(async ({ data }) => data),
    };
    const prisma = { anime };
    const service = new AdminService(prisma as any, {} as any, {} as any);
    return { service, anime };
  }

  it('ignora áudio manual divergente ao criar', async () => {
    const { service, anime } = build();
    anime.findUnique.mockResolvedValue(null);

    await service.createAnime({
      slug: 'frieren',
      title: 'Sousou no Frieren',
      audio: AudioType.DUBLADO,
    });

    expect(anime.create.mock.calls[0][0].data.audio).toBe(AudioType.LEGENDADO);
  });

  it('recalcula o áudio quando o título é editado', async () => {
    const { service, anime } = build();
    anime.findUnique.mockResolvedValue({
      slug: 'frieren',
      title: 'Sousou no Frieren',
    });

    await service.updateAnime('frieren', {
      title: 'Sousou no Frieren Dublado',
      audio: AudioType.LEGENDADO,
    });

    expect(anime.update.mock.calls[0][0].data.audio).toBe(AudioType.DUBLADO);
  });
});
