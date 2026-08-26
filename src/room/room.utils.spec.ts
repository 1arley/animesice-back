import { generateRoomSlug } from './room.utils';

describe('room.utils', () => {
  describe('generateRoomSlug', () => {
    it('gera slug com 8 caracteres (base64url de 6 bytes)', () => {
      const slug = generateRoomSlug();
      expect(slug).toHaveLength(8);
    });

    it('gera slugs únicos em chamadas consecutivas', () => {
      const slugs = new Set(
        Array.from({ length: 100 }, () => generateRoomSlug()),
      );
      // Com 10 bytes aleatórios em base64url, colisões são extremamente improváveis
      expect(slugs.size).toBe(100);
    });

    it('contém apenas caracteres base64url ([a-zA-Z0-9_-])', () => {
      for (let i = 0; i < 50; i++) {
        const slug = generateRoomSlug();
        expect(slug).toMatch(/^[a-zA-Z0-9_-]+$/);
      }
    });
  });
});
