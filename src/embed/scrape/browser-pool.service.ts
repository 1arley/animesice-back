import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { chromium, type Browser, type BrowserContext } from 'playwright';

const UA_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const IDLE_CONTEXT_TTL_MS = 30_000;
const BROWSER_RESTART_DELAY_MS = 2_000;
const MAX_RESTART_ATTEMPTS = 5;

interface ManagedContext {
  context: BrowserContext;
  lastUsedAt: number;
  inUse: boolean;
}

@Injectable()
export class BrowserPool implements OnModuleInit, OnModuleDestroy {
  private browser: Browser | null = null;
  private readonly contexts = new Map<string, ManagedContext>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private restartAttempts = 0;
  private starting = false;

  onModuleInit(): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- cleanup is fire-and-forget
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), 10_000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await this.closeAll();
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (this.starting) {
      while (this.starting) await new Promise((r) => setTimeout(r, 100));
      if (this.browser && this.browser.isConnected()) return this.browser;
    }
    return this.startBrowser();
  }

  private async startBrowser(): Promise<Browser> {
    this.starting = true;
    try {
      if (this.browser) {
        await this.browser.close().catch(() => undefined);
        this.browser = null;
      }
      this.browser = await chromium.launch({
        headless: true,
        chromiumSandbox: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      this.restartAttempts = 0;
      console.error('[BROWSER-POOL] Chromium started');
      return this.browser;
    } finally {
      this.starting = false;
    }
  }

  async acquireContext(label: string): Promise<{
    browser: Browser;
    context: BrowserContext;
    release: () => Promise<void>;
  }> {
    const browser = await this.ensureBrowser();

    const context = await browser.newContext({
      userAgent: UA_DESKTOP,
      locale: 'pt-BR',
      viewport: { width: 1366, height: 768 },
    });

    const entry: ManagedContext = {
      context,
      lastUsedAt: Date.now(),
      inUse: true,
    };
    const key = `${label}:${Date.now()}`;
    this.contexts.set(key, entry);

    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      entry.inUse = false;
      entry.lastUsedAt = Date.now();
      await context.close().catch(() => undefined);
      this.contexts.delete(key);
    };

    return { browser, context, release };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- cleanup runs async context.close() operations
  private async cleanupIdle(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.contexts) {
      if (!entry.inUse && now - entry.lastUsedAt > IDLE_CONTEXT_TTL_MS) {
        await entry.context.close().catch(() => undefined);
        this.contexts.delete(key);
      }
    }
  }

  private async closeAll(): Promise<void> {
    for (const [, entry] of this.contexts) {
      await entry.context.close().catch(() => undefined);
    }
    this.contexts.clear();
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }

  async restart(): Promise<boolean> {
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      console.error('[BROWSER-POOL] max restart attempts reached');
      return false;
    }
    this.restartAttempts++;
    console.error(
      `[BROWSER-POOL] restarting (attempt ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS})`,
    );
    await this.closeAll();
    await new Promise((r) => setTimeout(r, BROWSER_RESTART_DELAY_MS));
    try {
      await this.ensureBrowser();
      return true;
    } catch {
      return false;
    }
  }

  getStats(): {
    browserAlive: boolean;
    idleContexts: number;
    activeContexts: number;
  } {
    let idle = 0;
    let active = 0;
    for (const [, entry] of this.contexts) {
      if (entry.inUse) active++;
      else idle++;
    }
    return {
      browserAlive: this.browser?.isConnected() ?? false,
      idleContexts: idle,
      activeContexts: active,
    };
  }
}
