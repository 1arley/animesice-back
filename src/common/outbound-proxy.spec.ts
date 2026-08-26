import { setupOutboundProxy } from '@/common/outbound-proxy';
import { setGlobalDispatcher } from 'undici';

jest.mock('undici', () => ({
  EnvHttpProxyAgent: jest.fn(),
  setGlobalDispatcher: jest.fn(),
}));

const mockedSetGlobalDispatcher = setGlobalDispatcher as jest.Mock;

describe('setupOutboundProxy', () => {
  const proxyVars = [
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'NO_PROXY',
    'no_proxy',
  ] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    jest.resetAllMocks();
    saved = {};
    for (const v of proxyVars) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of proxyVars) {
      if (saved[v] !== undefined) {
        process.env[v] = saved[v];
      } else {
        delete process.env[v];
      }
    }
  });

  it('não faz nada quando nenhum proxy é configurado', () => {
    setupOutboundProxy();

    expect(mockedSetGlobalDispatcher).not.toHaveBeenCalled();
  });

  it('configura proxy e define NO_PROXY padrão', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.HTTPS_PROXY = 'http://user:pass@proxy:8080';

    setupOutboundProxy();

    expect(process.env.NO_PROXY).toBe('localhost,127.0.0.1,::1,*.local');
    expect(mockedSetGlobalDispatcher).toHaveBeenCalledWith(expect.anything());
    expect(logSpy).toHaveBeenCalledWith(
      '[PROXY] outbound HTTP/HTTPS via http://***@proxy:8080 (NO_PROXY=localhost,127.0.0.1,::1,*.local)',
    );
    logSpy.mockRestore();
  });

  it('mantém NO_PROXY já existente sem alterar', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.HTTPS_PROXY = 'http://proxy:8080';
    process.env.NO_PROXY = 'custom.local';

    setupOutboundProxy();

    expect(process.env.NO_PROXY).toBe('custom.local');
    expect(mockedSetGlobalDispatcher).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('trata falha na configuração com warning no console', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedSetGlobalDispatcher.mockImplementation(() => {
      throw new Error('boom');
    });
    process.env.HTTPS_PROXY = 'http://proxy:8080';

    setupOutboundProxy();

    expect(warnSpy).toHaveBeenCalledWith(
      '[PROXY] falha ao configurar proxy outbound:',
      'boom',
    );
    warnSpy.mockRestore();
  });

  it('lê a variável minúscula https_proxy quando a maiúscula não existe', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.https_proxy = 'http://low-proxy:8080';

    setupOutboundProxy();

    expect(mockedSetGlobalDispatcher).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('lê http_proxy quando HTTPS_PROXY não existe', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.http_proxy = 'http://http-proxy:8080';

    setupOutboundProxy();

    expect(mockedSetGlobalDispatcher).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('não sobrescreve NO_PROXY definido em no_proxy minúsculo', () => {
    process.env.https_proxy = 'http://proxy:8080';
    process.env.no_proxy = 'my-service.local';

    setupOutboundProxy();

    expect(process.env.NO_PROXY).toBeUndefined();
    expect(process.env.no_proxy).toBe('my-service.local');
  });

  it('mascara senha no log do proxy', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.HTTP_PROXY = 'http://u:p@host:80';

    setupOutboundProxy();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('***'));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('u:p'));
    logSpy.mockRestore();
  });
});
