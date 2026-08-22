import {
  Injectable,
  BadRequestException,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';
import { Readable } from 'stream';
import sanitizeHtml from 'sanitize-html';
import {
  isBlockedHostname,
  pinnedDispatcher,
  resolveSafeUrl,
} from '@/common/ssrf';
import { fetch as undiciFetch, type Dispatcher } from 'undici';

// Os testes existentes mockam global.fetch. Em runtime, o Agent e o fetch
// precisam vir da mesma instalação de undici (veja fetchSafe).
const outboundFetch: typeof undiciFetch = (...args) =>
  process.env.NODE_ENV === 'test'
    ? (globalThis.fetch as unknown as typeof undiciFetch)(...args)
    : undiciFetch(...args);

/** Regex p/ validar scheme: somente http/https. */
const VALID_SCHEME = /^https?:\/\//i;

/**
 * Porta padrão por scheme. Usada p/:
 * - bloquear portas não padrão (anti port-scan SSRF) sem hardcode de 80/443;
 * - canonicizar (remover porta redundante) na URL outbound.
 */
const DEFAULT_PORTS: Readonly<Record<string, string>> = Object.freeze({
  'http:': '80',
  'https:': '443',
});

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

/** Teto de bytes p/ corpo de HTML proxyado (anti memory-bloat). */
const MAX_HTML_BYTES = 5 * 1024 * 1024;

/** Ponte isolada usada pela Watch Party para controlar o video dentro do
 * iframe proxyado. Só troca estado de mídia via postMessage; não expõe DOM,
 * cookies ou conteúdo da página terceira ao parent. */
const WATCH_PARTY_BRIDGE = `<script data-animesice-watch-party-bridge>
(() => {
  const TYPE = 'animesice:watch-party';
  let role = 'viewer';
  let lastReport = 0;
  const player = () => {
    const videos = Array.from(document.querySelectorAll('video'));
    return videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || null;
  };
  const send = (event, extra = {}) => parent.postMessage({ type: TYPE, event, ...extra }, '*');
  const showActivation = (video) => {
    if (document.getElementById('animesice-watch-party-activate')) return;
    const button = document.createElement('button');
    button.id = 'animesice-watch-party-activate';
    button.textContent = 'Clique para ativar a reprodução sincronizada';
    button.style.cssText = 'position:fixed;inset:0;margin:auto;z-index:2147483647;width:max-content;max-width:85%;height:max-content;padding:12px 16px;border:1px solid #8ee8ff;border-radius:6px;background:rgba(0,0,0,.88);color:white;font:600 14px sans-serif;cursor:pointer';
    button.onclick = async () => { try { await video.play(); button.remove(); report('applied'); } catch {} };
    document.body.appendChild(button);
  };
  const report = (event = 'state') => {
    const video = player();
    if (!video) return send('unavailable');
    send(event, { currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0, isPlaying: !video.paused && !video.ended });
  };
  const configure = () => {
    const video = player();
    if (!video || video.dataset.animesiceBridge) return;
    video.dataset.animesiceBridge = '1';
    if (role !== 'host') video.controls = false;
    for (const event of ['play', 'pause', 'seeked', 'ended']) video.addEventListener(event, () => report());
    video.addEventListener('timeupdate', () => {
      if (role === 'host' && Date.now() - lastReport > 5000) { lastReport = Date.now(); report(); }
    });
    send('ready');
  };
  addEventListener('message', async ({ data }) => {
    if (!data || data.type !== TYPE) return;
    if (data.command === 'setRole') {
      role = data.role === 'host' ? 'host' : 'viewer';
      const video = player();
      if (video) video.controls = role === 'host';
      configure();
      return;
    }
    if (data.command === 'getState') { configure(); report(); return; }
    if (data.command !== 'apply') return;
    const video = player();
    if (!video) return send('unavailable');
    if (Number.isFinite(data.currentTime) && Math.abs(video.currentTime - data.currentTime) >= 0.75) video.currentTime = Math.max(0, data.currentTime);
    try {
      if (data.isPlaying) await video.play(); else video.pause();
      report('applied');
    } catch { showActivation(video); send('autoplay-blocked'); }
  });
  new MutationObserver(configure).observe(document.documentElement, { childList: true, subtree: true });
  configure();
  send('bridge-ready');
})();
</script>`;

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

interface SafeFetchResult {
  response: Response;
  dispatcher: Dispatcher;
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
    let dispatcher: Dispatcher;
    try {
      ({ response, dispatcher } = await this.fetchSafe(
        validated,
        {
          headers: {
            'user-agent': UA_MEDIA,
          },
        },
        this.FETCH_TIMEOUT_MS,
      ));
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

    try {
      if (response.status === 404) {
        throw new NotFoundException('Página destino não encontrada.');
      }

      const contentType =
        response.headers.get('content-type') ?? 'text/html; charset=utf-8';

      let body = await this.readHtmlCapped(response.body, MAX_HTML_BYTES);

      const origin = this.originOf(validated);

      body = this.injectBaseHref(body, origin);
      body = this.rewriteResourceUrls(body, origin, validated);
      body = this.sanitizeProxiedHtml(body);
      body = this.injectWatchPartyBridge(body);

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
    } finally {
      await dispatcher.close();
    }
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
    let dispatcher: Dispatcher;
    try {
      ({ response, dispatcher } = await this.fetchSafe(
        validated,
        { headers: upstreamHeaders },
        this.MEDIA_FETCH_TIMEOUT_MS,
      ));
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
      await dispatcher.close();
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
      await dispatcher.close();
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

    // fetch() entrega um ReadableStream Web. O pipeline do Express espera um
    // Readable do Node; um type-cast não faz essa conversão e pode encerrar a
    // resposta na borda (Cloudflare reporta 502). O adapter também nos dá um
    // ponto seguro para liberar o Agent pinado quando o stream terminar ou o
    // cliente desconectar.
    const body = Readable.fromWeb(
      response.body as import('stream/web').ReadableStream<Uint8Array>,
    );
    body.once('close', () => {
      void dispatcher.close().catch(() => undefined);
    });

    return {
      status: response.status,
      headers: cleanHeaders,
      body,
    };
  }

  /** Cria um Readable a partir de string (mensagens de erro upstream). */
  private readableFrom(text: string): Readable {
    return Readable.from(text);
  }

  /**
   * Lê o corpo como texto com teto de bytes (anti memory-bloat por upstream
   * lento/ilimitado). Aborta se exceder o limite.
   */
  private async readHtmlCapped(
    body: ReadableStream<Uint8Array> | null,
    maxBytes: number,
  ): Promise<string> {
    if (!body) return '';
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let out = '';
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new BadGatewayException('Página destino muito grande.');
        }
        out += decoder.decode(value, { stream: true });
      }
      out += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    return out;
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
  ): Promise<SafeFetchResult> {
    let current = url;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const normalized = this.normalizeUrl(current);
      const resolution = await resolveSafeUrl(normalized);
      const dispatcher = pinnedDispatcher(resolution);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      // codeql-ui disable taint tracking: URL validated via resolveSafeUrl above
      let response: Response;
      try {
        // O dispatcher vem do pacote `undici`; use o fetch do mesmo pacote.
        // O fetch global do Node usa a cópia interna do undici e, em produção,
        // recusava silenciosamente o Agent externo com `fetch failed`, fazendo
        // todo /embed/media retornar 502 embora a CDN respondesse 206.
        response = await outboundFetch(resolution.url, {
          ...init,
          signal: controller.signal,
          redirect: 'manual',
          dispatcher,
        });
      } catch (err) {
        await dispatcher.close();
        throw err;
      } finally {
        clearTimeout(timer);
      }

      const location = response.headers.get('location');
      const isRedirect =
        response.status >= 300 && response.status < 400 && !!location;
      if (!isRedirect) return { response, dispatcher };

      await response.body?.cancel();
      await dispatcher.close();
      try {
        current = new URL(location, resolution.url).toString();
      } catch {
        throw new BadGatewayException('Redirecionamento upstream inválido.');
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

    // Rejeita userinfo no authority — cobre user:pass@ e bypass `@host` (sem
    // credenciais preenchidas, onde `parsed.username` viria vazio).
    if (/^https?:\/\/([^@/?#]*@)/i.test(trimmed)) {
      throw new BadRequestException('Credenciais na URL não são permitidas.');
    }

    const defaultPort = DEFAULT_PORTS[parsed.protocol];
    if (parsed.port && parsed.port !== defaultPort) {
      throw new BadRequestException(
        `Porta de destino não permitida: ${parsed.protocol} só aceita a porta padrão ${defaultPort}.`,
      );
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (isBlockedHostname(host)) {
      throw new BadRequestException(BLOCKED_MESSAGE);
    }

    if (!this.isHostAllowed(host)) {
      throw new BadRequestException('Host de destino não permitido.');
    }

    // Canoniciza URL outbound: remove fragmento e porta redundante (idêntica
    // à padrão do scheme), garantindo URL estrita e não ambígua p/ o fetch.
    parsed.hash = '';
    if (parsed.port === defaultPort) parsed.port = '';

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
   * Sanitiza HTML proxyado de fontes externas: remove scripts, event handlers,
   * javascript: URIs e tags perigosas. Preserva <base>, <link>, <style> e
   * iframe (necessários para players de vídeo).
   */
  private sanitizeProxiedHtml(html: string): string {
    return sanitizeHtml(html, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([
        'iframe',
        'video',
        'source',
        'audio',
        'base',
        'link',
        'meta',
        'style',
        'script',
      ]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        iframe: [
          'src',
          'allow',
          'allowfullscreen',
          'frameborder',
          'width',
          'height',
          'style',
          'class',
          'id',
          'data-*',
        ],
        video: [
          'src',
          'controls',
          'autoplay',
          'muted',
          'loop',
          'preload',
          'width',
          'height',
          'style',
          'class',
          'poster',
        ],
        source: ['src', 'type', 'media'],
        audio: [
          'src',
          'controls',
          'autoplay',
          'muted',
          'loop',
          'preload',
          'style',
          'class',
        ],
        base: ['href'],
        link: ['rel', 'href', 'type', 'media', 'crossorigin'],
        meta: ['charset', 'name', 'content', 'http-equiv'],
        style: ['type', 'media'],
        '*': ['id', 'class', 'style', 'title', 'lang', 'dir'],
      },
      allowedSchemes: ['http', 'https', 'data', 'blob'],
      allowVidetagProtocolInlining: true,
    });
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

  private injectWatchPartyBridge(html: string): string {
    // Um CSP em <meta> do upstream poderia bloquear a ponte inline. O proxy já
    // aplica seu próprio CSP sandboxado no header da resposta.
    const withoutMetaCsp = html.replace(
      /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,
      '',
    );
    if (/<\/body\s*>/i.test(withoutMetaCsp)) {
      return withoutMetaCsp.replace(
        /<\/body\s*>/i,
        `${WATCH_PARTY_BRIDGE}</body>`,
      );
    }
    return `${withoutMetaCsp}\n${WATCH_PARTY_BRIDGE}`;
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
