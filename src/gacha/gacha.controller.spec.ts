import { GachaController } from './gacha.controller';

function makeMocks() {
  return {
    gachaService: {
      roll: jest.fn(),
      spin: jest.fn(),
      claim: jest.fn(),
      spins: jest.fn(),
      status: jest.fn(),
      collection: jest.fn(),
      featured: jest.fn(),
      setFeatured: jest.fn(),
      removeFeatured: jest.fn(),
      publicCard: jest.fn(),
      publicFeatured: jest.fn(),
      adminCards: jest.fn(),
      adminCreateCard: jest.fn(),
      adminUpdateCard: jest.fn(),
      adminUserCards: jest.fn(),
      adminGrantUserCard: jest.fn(),
      adminDeleteUserCard: jest.fn(),
      adminResetRoll: jest.fn(),
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

  describe('spin and claim', () => {
    it('delega spin, claim e spins com userId', async () => {
      m.gachaService.spin.mockResolvedValue({ ok: true });
      m.gachaService.claim.mockResolvedValue({ ok: true });
      m.gachaService.spins.mockResolvedValue([]);

      await controller.spin(req('u1'));
      await controller.claim(req('u1'), {
        spinId: 's1',
        turnstileToken: 'tok',
      });
      await controller.spins(req('u1'));

      expect(m.gachaService.spin).toHaveBeenCalledWith('u1');
      expect(m.gachaService.claim).toHaveBeenCalledWith('u1', 's1', 'tok');
      expect(m.gachaService.spins).toHaveBeenCalledWith('u1');
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

  describe('featured and public cards', () => {
    it('delega ações de destaque e rotas públicas', async () => {
      await controller.featured(req('u1'));
      await controller.setFeatured(req('u1'), { userCardId: 'c1' });
      await controller.removeFeatured(req('u1'));
      await controller.publicCard('c1');
      await controller.publicFeatured('u2');

      expect(m.gachaService.featured).toHaveBeenCalledWith('u1');
      expect(m.gachaService.setFeatured).toHaveBeenCalledWith('u1', 'c1');
      expect(m.gachaService.removeFeatured).toHaveBeenCalledWith('u1');
      expect(m.gachaService.publicCard).toHaveBeenCalledWith('c1');
      expect(m.gachaService.publicFeatured).toHaveBeenCalledWith('u2');
    });
  });

  describe('admin', () => {
    it('delega listagem e ações administrativas', async () => {
      await controller.adminCards('2', '10', 'card', 'RARA');
      await controller.adminCreateCard({ name: 'Card', rarity: 'COMUM' });
      await controller.adminUpdateCard('c1', { rarity: 'RARA' });
      await controller.adminUserCards('u1', '2', '10');
      await controller.adminGrantUserCard('u1', { cardId: 'c1' });
      await controller.adminDeleteUserCard('p1');
      await controller.adminResetRoll('u1');

      expect(m.gachaService.adminCards).toHaveBeenCalledWith(
        2,
        10,
        'card',
        'RARA',
      );
      expect(m.gachaService.adminCreateCard).toHaveBeenCalledWith({
        name: 'Card',
        rarity: 'COMUM',
      });
      expect(m.gachaService.adminUpdateCard).toHaveBeenCalledWith('c1', {
        rarity: 'RARA',
      });
      expect(m.gachaService.adminUserCards).toHaveBeenCalledWith('u1', 2, 10);
      expect(m.gachaService.adminGrantUserCard).toHaveBeenCalledWith(
        'u1',
        'c1',
      );
      expect(m.gachaService.adminDeleteUserCard).toHaveBeenCalledWith('p1');
      expect(m.gachaService.adminResetRoll).toHaveBeenCalledWith('u1');
    });

    it('rejeita raridades inválidas', () => {
      expect(() =>
        controller.adminCreateCard({ name: 'Card', rarity: 'INVALIDA' }),
      ).toThrow('Raridade inválida');
      expect(() =>
        controller.adminUpdateCard('c1', { rarity: 'INVALIDA' }),
      ).toThrow('Raridade inválida');
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
