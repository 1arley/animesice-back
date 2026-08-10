import {
  keepVideoUrls,
  isExpiringMediaUrl,
  preferPermanentMediaUrls,
} from '@/embed/scrape/extract';

describe('extract helpers', () => {
  describe('isExpiringMediaUrl', () => {
    it('detecta assinatura S3 temporária', () => {
      expect(
        isExpiringMediaUrl(
          'https://cdn/v.mp4?X-Amz-Date=20260728T160632Z&X-Amz-Expires=10800',
        ),
      ).toBe(true);
      expect(
        isExpiringMediaUrl(
          'https://cdn/v.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256',
        ),
      ).toBe(true);
    });

    it('detecta googlevideo expire', () => {
      expect(
        isExpiringMediaUrl(
          'https://rr.test.googlevideo.com/v?expire=1700000000',
        ),
      ).toBe(true);
    });

    it('não marca URLs permanentes (R2/arquivo público)', () => {
      expect(isExpiringMediaUrl('https://pub-x.r2.dev/Leg.mp4')).toBe(false);
      expect(isExpiringMediaUrl('https://cdn/v.mp4?quality=high')).toBe(false);
    });
  });

  describe('preferPermanentMediaUrls', () => {
    it('coloca URL permanente antes de token S3 expirado', () => {
      const expiring =
        'https://hugh.cdn.rumble.cloud/v.mp4?X-Amz-Date=20260728T160632Z&X-Amz-Expires=10800';
      const permanent = 'https://pub-c7f4.r2.dev/Leg.mp4';
      const result = preferPermanentMediaUrls([expiring, permanent]);
      expect(result[0]).toBe(permanent);
      expect(result[1]).toBe(expiring);
    });

    it('mantém ordem quando tudo é permanente', () => {
      const a = 'https://cdn1/v1.mp4';
      const b = 'https://cdn2/v2.mp4';
      expect(preferPermanentMediaUrls([a, b])).toEqual([a, b]);
    });

    it('mantém ordem quando tudo expira', () => {
      const a = 'https://cdn1/v1.mp4?X-Amz-Expires=100';
      const b = 'https://cdn2/v2.mp4?expire=100';
      expect(preferPermanentMediaUrls([a, b])).toEqual([a, b]);
    });
  });

  describe('keepVideoUrls', () => {
    it('filtra apenas .mp4/.m3u8', () => {
      expect(
        keepVideoUrls(['https://cdn/v.mp4', 'blob:xyz', 'https://cdn/v.m3u8']),
      ).toEqual(['https://cdn/v.mp4', 'https://cdn/v.m3u8']);
    });
  });
});
