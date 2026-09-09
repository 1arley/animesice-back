import { GachaController } from './gacha.controller';

function makeMocks() {
  return {
    gachaService: {
      roll: jest.fn(),
      status: jest.fn(),
      collection: jest.fn(),
      featured: jest.fn(),
      setFeatured: jest.fn(),
      removeFeatured: jest.fn(),
      publicCard: jest.fn(),
      publicFeatured: jest.fn(),
      recent: jest.fn(),
      ranking: jest.fn(),
    },
  };
}

const req = (userId: string) => ({ user: { id: userId } }) as any;

describe('GachaController', () => {
  let controller: GachaController;
  let m: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    m = makeMocks();
    controller = new GachaController(m.gachaService as any);
    jest.clearAllMocks();
  });

  describe('roll', () => {
    it('delega para o service com userId e turnstileToken', async () => {
      m.gachaService.roll.mockResolvedValue({ ok: true });
      const result = await controller.roll(req('u1'), {
        turnstileToken: 'tok',
      });
      expect(m.gachaService.roll).toHaveBeenCalledWith('u1', 'tok');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('status', () => {
    it('delega para o service com userId', async () => {
      m.gachaService.status.mockResolvedValue({ canRoll: true });
      const result = await controller.status(req('u1'));
      expect(m.gachaService.status).toHaveBeenCalledWith('u1');
      expect(result).toEqual({ canRoll: true });
    });
  });

  describe('collection', () => {
    it('usa o próprio usuário e defaults quando query vazia', async () => {
      m.gachaService.collection.mockResolvedValue([]);
      await controller.collection(
        req('u1'),
        undefined as any,
        undefined as any,
        undefined as any,
        undefined,
        undefined,
        undefined,
      );
      expect(m.gachaService.collection).toHaveBeenCalledWith(
        'u1',
        'u1',
        1,
        24,
        undefined,
        undefined,
        undefined,
      );
    });

    it('aceita userId, page e limit explícitos', async () => {
      m.gachaService.collection.mockResolvedValue([]);
      await controller.collection(
        req('u1'),
        'u2',
        '3',
        '10',
        'recent',
        'RARA',
        'HOLO',
      );
      expect(m.gachaService.collection).toHaveBeenCalledWith(
        'u2',
        'u1',
        3,
        10,
        'recent',
        'RARA',
        'HOLO',
      );
    });

    it('recorre aos defaults com page/limit inválidos', async () => {
      m.gachaService.collection.mockResolvedValue([]);
      await controller.collection(
        req('u1'),
        undefined as any,
        'abc',
        'abc',
        undefined,
        undefined,
        undefined,
      );
      expect(m.gachaService.collection).toHaveBeenCalledWith(
        'u1',
        'u1',
        1,
        24,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('recent', () => {
    it('usa default 20 sem limit', async () => {
      m.gachaService.recent.mockResolvedValue([]);
      await controller.recent(undefined as any);
      expect(m.gachaService.recent).toHaveBeenCalledWith(20);
    });

    it('aceita limit explícito e recorre ao default quando inválido', async () => {
      m.gachaService.recent.mockResolvedValue([]);
      await controller.recent('5');
      expect(m.gachaService.recent).toHaveBeenCalledWith(5);
      await controller.recent('abc');
      expect(m.gachaService.recent).toHaveBeenCalledWith(20);
    });
  });

  describe('ranking', () => {
    it('usa default 20 sem limit', async () => {
      m.gachaService.ranking.mockResolvedValue([]);
      await controller.ranking(undefined as any);
      expect(m.gachaService.ranking).toHaveBeenCalledWith(20);
    });

    it('aceita limit explícito e recorre ao default quando inválido', async () => {
      m.gachaService.ranking.mockResolvedValue([]);
      await controller.ranking('7');
      expect(m.gachaService.ranking).toHaveBeenCalledWith(7);
      await controller.ranking('abc');
      expect(m.gachaService.ranking).toHaveBeenCalledWith(20);
    });
  });
});
