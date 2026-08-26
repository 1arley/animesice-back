import {
  refererForMediaUrl,
  refererForMediaUrlWithFallback,
} from '@/common/url-utils';

describe('refererForMediaUrl', () => {
  it('retorna referer do YouTube para googlevideo.com', () => {
    expect(
      refererForMediaUrl('https://r1.googlevideo.com/videoplayback?id=1'),
    ).toBe('https://youtube.googleapis.com/');
  });

  it('retorna referer da animefire para lightspeedst.net', () => {
    expect(refererForMediaUrl('https://cdn.lightspeedst.net/video.mp4')).toBe(
      'https://animefire.io/',
    );
  });

  it('retorna a origem da própria URL para hosts desconhecidos', () => {
    expect(refererForMediaUrl('https://cdn.example.com/video.mp4')).toBe(
      'https://cdn.example.com',
    );
  });

  it('retorna o fallback customizado para URLs inválidas', () => {
    expect(refererForMediaUrl('not-a-url', 'https://fallback.io/')).toBe(
      'https://fallback.io/',
    );
  });

  it('usa animefire.io como fallback padrão para URLs inválidas', () => {
    expect(refererForMediaUrl('not-a-url')).toBe('https://animefire.io/');
  });

  it('retorna referer correto para subdomínio do googlevideo', () => {
    expect(
      refererForMediaUrl('https://r2---sn-a5msenl7.googlevideo.com/'),
    ).toBe('https://youtube.googleapis.com/');
  });
});

describe('refererForMediaUrlWithFallback', () => {
  it('usa o referer conhecido quando o host é reconhecido', () => {
    expect(
      refererForMediaUrlWithFallback(
        'https://x.googlevideo.com/v',
        'https://site.com/page',
      ),
    ).toBe('https://youtube.googleapis.com/');
  });

  it('usa referer de lightspeedst quando reconhecido', () => {
    expect(
      refererForMediaUrlWithFallback(
        'https://cdn.lightspeedst.net/v.mp4',
        'https://other.com/page',
      ),
    ).toBe('https://animefire.io/');
  });

  it('usa a origem da própria URL de mídia quando o host é desconhecido', () => {
    expect(
      refererForMediaUrlWithFallback(
        'https://cdn.x.com/v.mp4',
        'https://episode.example.com/ver/123',
      ),
    ).toBe('https://cdn.x.com');
  });

  it('usa a origem da página do episódio quando a URL de mídia é inválida', () => {
    expect(
      refererForMediaUrlWithFallback(
        'not-a-url',
        'https://episode.example.com/ver/123',
      ),
    ).toBe('https://episode.example.com');
  });

  it('usa animefire.io quando a mídia e a página são URLs inválidas', () => {
    expect(refererForMediaUrlWithFallback('not-a-url', 'also-invalid')).toBe(
      'https://animefire.io/',
    );
  });
});
