import { spawn } from 'node:child_process';
import type { HttpExtractContext } from './scrape-source.interface';

export interface RustScrapeResult {
  videos: string[];
  iframes: string[];
  cloudflare: boolean;
  playerTokens: string[];
}

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

export function runRustScraper(
  binary: string,
  ctx: HttpExtractContext,
): Promise<RustScrapeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 250);
      reject(new Error('Timeout no scraper Rust.'));
    }, 32_000);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) child.kill('SIGKILL');
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (size > MAX_OUTPUT_BYTES)
        reject(new Error('Saída Rust excedeu o limite.'));
      else if (code !== 0)
        reject(new Error(Buffer.concat(stderr).toString('utf8').slice(0, 500)));
      else {
        try {
          const result = JSON.parse(
            Buffer.concat(stdout).toString('utf8'),
          ) as Partial<RustScrapeResult>;
          if (
            !Array.isArray(result.videos) ||
            !Array.isArray(result.iframes) ||
            !Array.isArray(result.playerTokens) ||
            typeof result.cloudflare !== 'boolean' ||
            !result.videos.every((v) => typeof v === 'string') ||
            !result.playerTokens.every((v) => typeof v === 'string')
          )
            throw new Error('Saída inválida do scraper Rust.');
          resolve(result as RustScrapeResult);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    child.stdin.end(JSON.stringify(ctx));
  });
}
