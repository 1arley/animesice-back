import {
  Injectable,
  BadRequestException,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { lookup } from 'dns/promises';
import net from 'net';

/** Regex p/ validar scheme: somente http/https. */
const VALID_SCHEME = /^https?:\/\//i;

/**
 * Allowlist de hosts externos permitidos para chamadas de proxy.
 * Pode ser configurada via env: EMBED_ALLOWED_HOSTS=example.com,cdn.example.com
 */
const ALLOWED_OUTBOUND_HOSTS = (process.env.EMBED_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/** Máximo de redirecionamentos seguidos no fetch (anti-SSRF/anti-loops). */
const MAX_REDIRECTS = 5;

/** Mensagem de erro p/ destinos de rede interna. */
const BLOCKED_MESSAGE =
  'Destino bloqueado: não é permitido proxy para redes internas/metadata.';

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
      response = await this.fetchSafe(
        validated,
        {
          headers: {
            'user-agent': UA_MEDIA,
          },
        },
        this.FETCH_TIMEOUT_MS,
      );
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
      response = await this.fetchSafe(
        validated,
        { headers: upstreamHeaders },
        this.MEDIA_FETCH_TIMEOUT_MS,
      );
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
   * Fetch com (1) timeout e (2) revalidação de SSRF a cada redirecionamento.
   * `redirect: 'manual'` + loop: cada hop é re-normalizado e o DNS re-resolvido
   * contra a blocklist, impedindo 302 para IPs internos/metadata.
   */
  private async fetchSafe(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    let current = url;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const normalized = this.normalizeUrl(current);
      await this.assertHostResolvesSafely(normalized);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(normalized, {
          ...init,
          signal: controller.signal,
          redirect: 'manual',
        });
      } finally {
        clearTimeout(timer);
      }

      const location = response.headers.get('location');
      const isRedirect =
        response.status >= 300 && response.status < 400 && !!location;
      if (!isRedirect) return response;

      try {
        current = new URL(location, normalized).toString();
      } catch {
        return response;
      }
    }

    throw new BadGatewayException('Limite de redirecionamentos excedido.');
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

    if (this.isBlockedHostname(host)) {
      throw new BadRequestException(BLOCKED_MESSAGE);
    }

    if (!this.isHostAllowed(host)) {
      throw new BadRequestException('Host de destino não permitido.');
    }

    return parsed.toString();
  }

  /**
   * Enforce de allowlist para saída HTTP:
   * - sem configuração => bloqueia por padrão (fail closed)
   * - aceita match exato e subdomínio
   */
  private isHostAllowed(host: string): boolean {
    if (ALLOWED_OUTBOUND_HOSTS.length === 0) return false;

    return ALLOWED_OUTBOUND_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  }

  /**
   * Bloqueia loopback, link-local, metadata, RFC1918, CGNAT, IPv6-mapped e
   * hex/octal. Para hostnames com ponto o DNS é resolvido em
   * `assertHostResolvesSafely` (aqui não há como saber o IP).
   */
  private isBlockedHostname(host: string): boolean {
    if (host === 'localhost') return true;
    if (host === 'metadata.google.internal') return true;

    const family = net.isIP(host);
    if (family === 4) return this.isBlockedIp(host);
    if (family === 6) return this.isBlockedIp(host);

    // IPv4 numérico em notação hex/octal não reconhecido por net.isIP.
    if (/^(0x[0-9a-f]+|[0-7]+)(\.(0x[0-9a-f]+|[0-7]+)){3}$/i.test(host)) {
      return true;
    }

    return false;
  }

  /**
   * Resolve o host via DNS e bloqueia se QUALQUER endereço resolvido for
   * privado/link-local/metadata. Impede DNS rebinding p/ rede interna.
   */
  private async assertHostResolvesSafely(urlStr: string): Promise<void> {
    const host = new URL(urlStr).hostname;

    if (net.isIP(host) || host === 'localhost') return;

    let addresses: readonly { address: string }[];
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException(
        'Destino bloqueado: o host não pôde ser resolvido.',
      );
    }

    if (addresses.length === 0) {
      throw new BadRequestException(
        'Destino bloqueado: o host não resolveu para nenhum endereço.',
      );
    }

    for (const addr of addresses) {
      if (this.isBlockedIp(addr.address)) {
        throw new BadRequestException(BLOCKED_MESSAGE);
      }
    }
  }

  /** Bloqueia qualquer IP que aponte p/ infra interna ou não-roteável. */
  private isBlockedIp(ip: string): boolean {
    const family = net.isIP(ip);
    if (family === 4) return this.isBlockedIPv4(ip);
    if (family === 6) return this.isBlockedIPv6(ip);
    return true;
  }

  private isBlockedIPv4(ip: string): boolean {
    const o = ip.split('.').map((p) => parseInt(p, 10));

    if (o.length !== 4) return true;
    const [a, b, c, d] = o;
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      d === undefined
    ) {
      return true;
    }

    // 0.0.0.0/8 — "this network" (aponta p/ si mesmo).
    if (a === 0) return true;
    // 10.0.0.0/8 — RFC1918.
    if (a === 10) return true;
    // 100.64.0.0/10 — CGNAT.
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 — loopback.
    if (a === 127) return true;
    // 169.254.0.0/16 — link-local.
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 — RFC1918.
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.0.0.0/24 — IETF protocol assignments.
    if (a === 192 && b === 0 && c === 0) return true;
    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 — TEST-NET.
    if (a === 192 && b === 0 && c === 2) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    // 192.168.0.0/16 — RFC1918.
    if (a === 192 && b === 168) return true;
    // 198.18.0.0/15 — benchmarking.
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 224.0.0.0/4 — multicast.
    if (a >= 224 && a <= 239) return true;
    // 240.0.0.0/4 — reservado (incl. broadcast).
    if (a >= 240) return true;

    return false;
  }

  private isBlockedIPv6(ip: string): boolean {
    const lower = ip.toLowerCase();

    // IPv4-mapped (::ffff:a.b.c.d) e IPv4-compat (::a.b.c.d): avalia o IPv4 embutido.
    const mapped =
      lower.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/) ??
      lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return this.isBlockedIp(mapped[1]!);
    }

    const bytes = this.parseIPv6(lower);
    if (!bytes) return true;

    const allZero = bytes.every((b) => b === 0);
    if (allZero) return true; // ::
    if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) {
      return true; // ::1 loopback
    }
    const b0 = bytes[0]!;
    const b1 = bytes[1]!;

    // fc00::/7 — ULA.
    if (b0 === 0xfc || b0 === 0xfd) return true;
    // fe80::/10 — link-local.
    if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true;
    // ff00::/8 — multicast.
    if (b0 === 0xff) return true;
    // 2001:db8::/32 — documentação.
    if (b0 === 0x20 && b1 === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8)
      return true;
    // 64:ff9b::/96 — NAT64 well-known.
    if (
      b0 === 0x00 &&
      b1 === 0x64 &&
      bytes[2] === 0xff &&
      bytes[3] === 0x9b &&
      bytes.slice(4, 12).every((b) => b === 0)
    ) {
      return true;
    }
    // 100::/64 — discard-only.
    if (b0 === 0x01 && b1 === 0x00 && bytes.slice(2, 8).every((b) => b === 0)) {
      return true;
    }

    return false;
  }

  /** Converte IPv6 (formato textual) em 16 bytes. null se inválido. */
  private parseIPv6(ip: string): number[] | null {
    const doubleColon = ip.indexOf('::');
    if (doubleColon !== -1 && ip.indexOf('::', doubleColon + 1) !== -1) {
      return null;
    }

    const half = (part: string): number[] | null => {
      if (!part) return [];
      const groups = part.split(':');
      if (groups.length > 4) return null;
      const bytes: number[] = [];
      for (const g of groups) {
        const n = parseInt(g, 16);
        if (Number.isNaN(n) || g.length === 0 || g.length > 4) return null;
        bytes.push((n >> 8) & 0xff, n & 0xff);
      }
      return bytes;
    };

    let head: number[];
    let tail: number[];
    if (doubleColon === -1) {
      head = half(ip)!;
      tail = [];
    } else {
      head = half(ip.slice(0, doubleColon))!;
      tail = half(ip.slice(doubleColon + 2))!;
    }

    if (!head || !tail) return null;

    const total = head.length + tail.length;
    if (total > 16) return null;

    const zeros = 16 - total;
    return [...head, ...new Array<number>(zeros).fill(0), ...tail];
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
          `(["']?)\\s*([^"'\\s>]+)\\s*\\2`,
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
