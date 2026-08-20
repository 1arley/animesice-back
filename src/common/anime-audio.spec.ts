import { AudioType } from '@prisma/client';
import { audioTypeFromTitle } from '@/common/anime-audio';

describe('audioTypeFromTitle', () => {
  it.each([
    'Naruto Dublado',
    'Naruto (Dublado)',
    'Naruto DUBLADO 2',
    'Naruto - dublado',
  ])('classifica "%s" como dublado', (title) => {
    expect(audioTypeFromTitle(title)).toBe(AudioType.DUBLADO);
  });

  it.each(['Naruto', 'Naruto Legendado', 'Dubladores do Japão'])(
    'classifica "%s" como legendado',
    (title) => {
      expect(audioTypeFromTitle(title)).toBe(AudioType.LEGENDADO);
    },
  );
});
