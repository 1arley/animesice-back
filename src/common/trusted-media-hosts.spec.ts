import {
  clearTrustedMediaHosts,
  isTrustedMediaHost,
  replaceTrustedMediaHosts,
  trustMediaHost,
  trustMediaHosts,
  trustedMediaHostCount,
} from './trusted-media-hosts';

describe('trusted-media-hosts', () => {
  beforeEach(() => clearTrustedMediaHosts());

  it('normaliza URL completa para host', () => {
    trustMediaHost('https://AKM-CDN-Play-Web.Onfilom.com/x/y.m3u8?a=1');
    expect(isTrustedMediaHost('akm-cdn-play-web.onfilom.com')).toBe(true);
    expect(trustedMediaHostCount()).toBe(1);
  });

  it('aceita host cru e descarta porta', () => {
    trustMediaHost('cdn.exemplo.com:8443');
    expect(isTrustedMediaHost('cdn.exemplo.com')).toBe(true);
  });

  it('ignora entradas vazias ou malformadas', () => {
    trustMediaHost('');
    trustMediaHost('   ');
    trustMediaHost('http://[invalid');
    expect(trustedMediaHostCount()).toBe(0);
    expect(isTrustedMediaHost('qualquer')).toBe(false);
  });

  it('não casa subdomínio de host não confiável (nem o inverso)', () => {
    trustMediaHost('exemplo.com');
    // Subdomínio de um host confiável NÃO é automaticamente confiável: o CDN
    // muda o subdomínio por episódio e a confiança é por host exato.
    expect(isTrustedMediaHost('outro.exemplo.com')).toBe(false);
    expect(isTrustedMediaHost('exemplo.com.evil.net')).toBe(false);
  });

  it('trustMediaHosts registra vários de uma vez', () => {
    trustMediaHosts([
      'https://a.com/1.m3u8',
      'https://b.com/2.m3u8',
      'https://a.com/3.m3u8',
    ]);
    expect(trustedMediaHostCount()).toBe(2);
  });

  it('replaceTrustedMediaHosts substitui o conjunto inteiro', () => {
    trustMediaHost('antigo.com');
    const total = replaceTrustedMediaHosts(['novo.com', 'outro.com']);
    expect(total).toBe(2);
    expect(isTrustedMediaHost('antigo.com')).toBe(false);
    expect(isTrustedMediaHost('novo.com')).toBe(true);
  });

  it('clearTrustedMediaHosts esvazia', () => {
    trustMediaHost('a.com');
    clearTrustedMediaHosts();
    expect(trustedMediaHostCount()).toBe(0);
  });
});
