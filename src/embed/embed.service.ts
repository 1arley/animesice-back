import {
  Injectable,
  BadRequestException,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';
import { Readable } from 'stream';

/** Headers de frame que devem removidos do upstream. */
const STRIPPED_HEADER_PREFIXES: ReadonlyArray<string> = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'frame-options',
];

/** Regex p/ validar scheme: somente http/https. */
const VALID_SCHEME = /^https?:\/\//i;

/** UA desktop real para passar anti-hotlinking das CDNs piratas. */
const UA_MEDIA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Tags/atributos cujo href/src devem ser reescritos p/ URL absoluta. */
const RESOURCE_ATTRS: ReadonlyArray<{ tag: string; attr: string }> = [
  { tag: 'a', attr: 'href' },
  { tag: 'script', attr: 'src' },
  { tag: 'link', attr: 'href' },
  { tag: 'img', attr: 'src' },
  { tag: 'source', attr: 'src' },
  { tag: 'iframe', attr: 'src' },
];

/** Headers de resposta que o proxy de midia repassa do upstream. */
const MEDIA_PASSTHROUGH_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'content-length',
  'accept-ranges',
  'content-range',
  'content-disposition',
  'etag',
  'last-modified',
  'cache-control',
  'age',
  'date',
]);

/** Headers de request hop-by-hop/seguranca que nunca repassamos ao upstream. */
const REQUEST_DROP_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'connection',
  'referer',
  'origin',
  'cookie',
  'authorization',
  'accept-encoding', // evita br (stream raw p/ Range confiavel)
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
]);

/** Resultado do proxy HTML. */
export interface ProxyHtmlResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Resultado do proxy de midia (streaming binario). */
export interface ProxyMediaResult {
  status: number;
  headers: Record<string, string>;
  body: Readable;
}

@Injectable()
export class EmbedService {
  /** Timeout do fetch upstream (anti-abuso). */
  private readonly FETCH_TIMEOUT_MS = 30_000;

  /** Timeout do fetch de mídia (streams grandes, mas evita travar indefinidamente). */
  private readonly MEDIA_FETCH_TIMEOUT_MS = 30_000;

  /**
   * Baixa HTML de targetUrl, remove headers de frame,
   * reescreve links/assets relativos p/ absolutos e injeta <base href>.
   */
  async proxyHtml(targetUrl: string): Promise<ProxyHtmlResult> {
    const validated = this.validateAndNormalizeUrl(targetUrl);

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
      try {
        response = await fetch(validated, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'user-agent': UA_MEDIA,
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
   * Proxy de mídia (.mp4/.m3u8/segmentos): busca o binário da CDN externa
   * injetando Referer/Origin/UA do site de origem (anti-hotlinking) e faz
   * streaming com suporte a Range (seek). O IP de saida é o do backend —
   * mesmo IP que fez o scrape — resolvendo tambem o IP-vinculo dos tokens.
   *
   * @param raw URL absoluta da midia (.mp4/.m3u8/segmento .ts).
   * @param reqHeaders headers do request do cliente (repassa Range).
   * @param sourceOrigin origem do site fonte (ex: https://animefire.io).
   *        Se informada, Referer/Origin apontam p/ ela (anti-hotlinking).
   *        Senao, fallback p/ a origem da propria midia.
   */
  async proxyMedia(
    raw: string,
    reqHeaders?: Record<string, string | string[] | undefined>,
    sourceOrigin?: string,
  ): Promise<ProxyMediaResult> {
    const validated = this.normalizeUrl(raw);
    // Preferencia: origem do site fonte (Referer valido p/ anti-hotlinking);
    // fallback p/ origem da midia (caso de mp4 publica sem anti-hotlinking).
    const refOrigin = sourceOrigin
      ? this.normalizeUrl(sourceOrigin).replace(/\/$/, '')
      : this.originOf(validated);

    const upstreamHeaders: Record<string, string> = {
      'user-agent': UA_MEDIA,
      // Anti-hotlinking: CDNs pirate (lightspeedst.net etc.) validam Referer
      // contra o site fonte (animefire.io), nao contra o host da CDN.
      referer: refOrigin + '/',
      origin: refOrigin,
      accept: '*/*',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.5',
    };

    // Repassa Range do cliente p/ suporte a seek, descartando hop-by-hop.
    if (reqHeaders) {
      for (const [k, v] of Object.entries(reqHeaders)) {
        if (v == null) continue;
        const lower = k.toLowerCase();
        if (REQUEST_DROP_HEADERS.has(lower)) continue;
        if (lower === 'range') {
          const rangeVal = Array.isArray(v) ? v[0] : v;
          if (rangeVal) upstreamHeaders.range = rangeVal;
        }
      }
    }

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.MEDIA_FETCH_TIMEOUT_MS,
      );
      try {
        response = await fetch(validated, {
          signal: controller.signal,
          redirect: 'follow',
          headers: upstreamHeaders,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new BadGatewayException(
          'Tempo limite excedido ao buscar a mídia.',
        );
      }
      throw new BadGatewayException(
        'Falha ao buscar a mídia: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    // Erro upstream (4xx/5xx): repassa o status ao cliente em vez de mascarar.
    // 403 = anti-hotlinking real; 404 = token/segmento expirado; 5xx = CDN fora.
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        status: response.status,
        headers: {
          'content-type':
            response.headers.get('content-type') ?? 'text/plain; charset=utf-8',
          'x-proxy-error': 'upstream-' + response.status,
        },
        body: this.readableFrom(errorBody || `CDN retornou ${response.status}`),
      };
    }

    // Stream raw — nao usar .text()/.arrayBuffer() (midia grande).
    if (!response.body) {
      throw new BadGatewayException('Resposta da CDN sem corpo.');
    }

    const cleanHeaders: Record<string, string> = {};
    for (const [key, value] of response.headers.entries()) {
      if (MEDIA_PASSTHROUGH_HEADERS.has(key.toLowerCase())) {
        cleanHeaders[key] = value;
      }
    }
    // Garante content-type mesmo se upstream omitiu.
    if (!cleanHeaders['content-type'] && !cleanHeaders['Content-Type']) {
      cleanHeaders['content-type'] = this.guessContentType(validated);
    }

    return {
      status: response.status,
      headers: cleanHeaders,
      body: response.body as unknown as Readable,
    };
  }

  /** Cria um Readable a partir de string (mensagens de erro upstream). */
  private readableFrom(text: string): Readable {
    return Readable.from(text);
  }

  /** Guess simples de content-type pela extensao. */
  private guessContentType(url: string): string {
    const path = (url.split('?')[0] ?? url).toLowerCase();
    if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (path.endsWith('.mp4')) return 'video/mp4';
    if (path.endsWith('.ts')) return 'video/mp2t';
    if (path.endsWith('.webm')) return 'video/webm';
    return 'application/octet-stream';
  }

  /**
   * Valida scheme (http/https), rejeita javascript:, e bloqueia
   * destinos que apontem p/ loopback/link-local/metadata (SSRF).
   */
  private validateAndNormalizeUrl(raw: string): string {
    return this.normalizeUrl(raw);
  }

  /** Normaliza/valida URL — exposto p/ controller reusar no proxy de midia. */
  normalizeUrl(raw: string): string {
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
