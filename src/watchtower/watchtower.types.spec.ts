import {
  isBoostedSlug,
  priorityForSlug,
  PRIORITY_BOOST,
} from '@/watchtower/watchtower.types';

describe('watchtower priority boost (backlog temporário)', () => {
  describe('isBoostedSlug', () => {
    const franchiseSlugs = [
      'kaguya-sama-love-is-war',
      'kaguya-sama-love-is-war-2',
      'kaguya-sama-wa-kokurasetai-otona-e-no-kaidan',
      'mushoku-tensei-isekai-ittara-honki-dasu',
      'mushoku-tensei-isekai-ittara-honki-dasu-2',
      'mushoku-tensei-isekai-ittara-honki-dasu-3',
      'mushoku-tensei-iii-isekai-ittara-honki-dasu',
    ];
    it.each(franchiseSlugs)('casa o slug "%s"', (slug) => {
      expect(isBoostedSlug(slug)).toBe(true);
    });

    it('casa temporadas dubladas da franquia', () => {
      expect(isBoostedSlug('kaguya-sama-love-is-war-dublado')).toBe(true);
      expect(
        isBoostedSlug('mushoku-tensei-isekai-ittara-honki-dasu-dublado-2'),
      ).toBe(true);
    });

    it.each([
      null,
      undefined,
      '',
      'one-piece',
      'boruto-naruto-next-generations',
      'kaguya-a-princesa-espacial',
    ])('não casa slug fora da lista (%s)', (slug) => {
      expect(isBoostedSlug(slug)).toBe(false);
    });
  });

  describe('priorityForSlug', () => {
    it('aplica PRIORITY_BOOST quando o slug é da lista', () => {
      expect(priorityForSlug('kaguya-sama-love-is-war', 280)).toBe(
        PRIORITY_BOOST,
      );
      expect(
        priorityForSlug('mushoku-tensei-isekai-ittara-honki-dasu-3', 100),
      ).toBe(PRIORITY_BOOST);
    });

    it('mantém prioridade original para slugs fora da lista', () => {
      expect(priorityForSlug('one-piece', 100)).toBe(100);
      expect(priorityForSlug(null, 50)).toBe(50);
    });

    it('nunca sobe a prioridade (maior número) para slug da lista', () => {
      // base já urgente (40) permanece 40 — boost só baixa o número
      expect(priorityForSlug('kaguya-sama-love-is-war', 40)).toBe(40);
    });
  });
});
