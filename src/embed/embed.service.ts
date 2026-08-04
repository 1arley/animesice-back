import {
  Injectable,
  BadRequestException,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';

/** Headers de frame que devem removidos do upstream. */
const STRIPPED_HEADER_PREFIXES: ReadonlyArray<string> = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'frame-options',
];

/** Regex p/ validar scheme: somente http/https. */
const VALID_SCHEME = /^https?:\/\//i;

/** Tags/atributos cujo href/src devem ser reescritos p/ URL absoluta. */
const RESOURCE_ATTRS: ReadonlyArray<{ tag: string; attr: string }> = [
  { tag: 'a', attr: 'href' },
  { tag: 'script', attr: 'src' },
  { tag: 'link', attr: 'href' },
  { tag: 'img', attr: 'src' },
  { tag: 'source', attr: 'src' },
  { tag: 'iframe', attr: 'src' },
];

/** Resultado do proxy HTML. */
export interface ProxyHtmlResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

@Injectable()
export class EmbedService {
  /** Timeout do fetch upstream (anti-abuso). */
  private readonly FETCH_TIMEOUT_MS = 30_000;

  /**
   * Baixa HTML de targetUrl, remove headers de frame,
   * reescreve links/assets relativos p/ absolutos e injeta <base href>.
   */
  async proxyHtml(targetUrl: string): Promise<ProxyHtmlResult> {
    const validated = this.validateAndNormalizeUrl(targetUrl);

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.FETCH_TIMEOUT_MS,
      );
      try {
        response = await fetch(validated, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'user-agent':
              'Mozilla/5.0 (compatible; AnimesIceEmbedProxy/1.0)',
          },
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new BadGatewayException(
          'Tempo limite excedido ao buscar o destino.',
        );
      }
      throw new BadGatewayException(
        'Falha ao buscar o destino: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    if (response.status === 404) {
      throw new NotFoundException('Página destino não encontrada.');
    }

    const contentType =
      response.headers.get('content-type') ?? 'text/html; charset=utf-8';

    let body = await response.text();

    const origin = this.originOf(validated);

    body = this.injectBaseHref(body, origin);
    body = this.rewriteResourceUrls(body, origin, validated);

    const cleanHeaders: Record<string, string> = {
      'content-type': contentType.startsWith('text/html')
        ? contentType
        : 'text/html; charset=utf-8',
    };

    this.copySafeHeader(response, cleanHeaders, 'cache-control');
    this.copySafeHeader(response, cleanHeaders, 'last-modified');
    this.copySafeHeader(response, cleanHeaders, 'etag');

    return {
      status: response.status,
      headers: cleanHeaders,
      body,
    };
  }

  /**
   * Valida scheme (http/https), rejeita javascript:, e bloqueia
   * destinos que apontem p/ loopback/link-local/metadata (SSRF).
   */
  private validateAndNormalizeUrl(raw: string): string {
    if (!raw || typeof raw !== 'string') {
      throw new BadRequestException('URL ausente ou inválida.');
    }

    const trimmed = raw.trim();

    if (!VALID_SCHEME.test(trimmed)) {
      throw new BadRequestException(
        'Scheme inválido: somente http/https são permitidos.',
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new BadRequestException('URL malformada.');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(
        'Scheme inválido: somente http/https são permitidos.',
      );
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (this.isBlockedHost(host)) {
      throw new BadRequestException(
        'Destino bloqueado: não é permitido proxy para redes internas/metadata.',
      );
    }

    return parsed.toString();
  }

  /** Bloqueia loopback, link-local e metadata endpoints. */
  private isBlockedHost(host: string): boolean {
    if (host === 'localhost') return true;
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
    if (host.startsWith('127.')) return true;
    if (host.startsWith('169.254.')) return true;
    if (host === '0.0.0.0' || host === '0.0.0.0/0') return true;
    if (host === 'metadata.google.internal') return true;

    // 10.x, 172.16-31.x, 192.168.x (RFC1918) — bloqueio defensivo.
    if (
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return true;
    }

    // IPv4 numérico puro ainda válido foi coberto acima; fallback hex/octal.
    if (/^0x[0-9a-f]+\.?/i.test(host)) return true;

    return false;
  }

  private originOf(url: string): string {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  }

  /**
   * Injeta <base href="ORIGEM"> no <head> p/ que recursos relativos
   * resolvam contra o domínio original, não contra o backend do proxy.
   */
  private injectBaseHref(html: string, origin: string): string {
    const baseTag = `<base href="${this.escapeHtmlAttr(origin)}">`;

    const headOpen = /<head[^>]*>/i;
    if (headOpen.test(html)) {
      return html.replace(headOpen, (match) => `${match}\n${baseTag}`);
    }

    // Sem <head>: coloca antes do primeiro <html> ou cria um HEAD.
    const htmlOpen = /<html[^>]*>/i;
    if (htmlOpen.test(html)) {
      return html.replace(
        htmlOpen,
        (match) => `${match}\n<head>${baseTag}</head>`,
      );
    }

    return `<head>${baseTag}</head>\n${html}`;
  }

  /**
   * Reescreve href/src relativos ou absolutos do destino p/ URLs absolutas
   * apontando p/ o domínio original (mediafire/animefire), p/ que scripts
   * como o video.js continuem carregando ao invés de bater no backend.
   */
  private rewriteResourceUrls(
    html: string,
    origin: string,
    baseUrl: string,
  ): string {
    let out = html;

    for (const { tag, attr } of RESOURCE_ATTRS) {
      const re = new RegExp(
        `<${tag}\\b([^>]*?)\\s${attr}\\s*=\\s*` +
          `(["\']?)\\s*([^"\'\\s>]+)\\s*\\2`,
        'gi',
      );
      out = out.replace(re, (match, pre: string, _q: string, val: string) => {
        const rewritten = this.resolveResourceUrl(val, origin, baseUrl);
        if (rewritten === val) return match;
        return `<${tag}${pre} ${attr}="${this.escapeHtmlAttr(rewritten)}"`;
      });
    }

    return out;
  }

  /**
   * Resolve um href/src contra a origem/base do destino.
   * - scheme-relative (//host) -> https?://host
   * - root-relative (/path) -> origin + path
   * - path-relative (a/b) -> resolved contra baseUrl
   * - já absoluto -> mantido (exceto se vazio/âncora).
   */
  private resolveResourceUrl(
    val: string,
    origin: string,
    baseUrl: string,
  ): string {
    if (!val) return val;

    // âncora / apenas hash
    if (val.startsWith('#')) return val;
    // mailto/tel etc.
    if (/^(mailto|tel|data|javascript):/i.test(val)) return val;
    // scheme-relative
    if (val.startsWith('//')) {
      return `${new URL(origin).protocol}//${val.slice(2)}`;
    }
    // já absoluto http(s)
    if (VALID_SCHEME.test(val)) return val;
    // root-relative
    if (val.startsWith('/')) {
      return `${origin}${val}`;
    }
    // path-relative: resolve contra baseUrl (que já é absoluto)
    try {
      return new URL(val, baseUrl).toString();
    } catch {
      return val;
    }
  }

  private copySafeHeader(
    res: Response,
    target: Record<string, string>,
    name: string,
  ): void {
    const val = res.headers.get(name);
    if (val) target[name] = val;
  }

  private escapeHtmlAttr(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
