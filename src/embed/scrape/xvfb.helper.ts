import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Gerencia um display Xvfb singleton para Playwright headless: false.
 *
 * O player do Blogger (blogger.com/video.g?token=...) só renderiza o <video>
 * e dispara a request googlevideo.com/videoplayback quando o chromium roda
 * com headless: false (modo janela). Em servidor sem display, precisamos de
 * um Xvfb virtual.
 *
 * Inicia Xvfb na primeira chamada, mantém ativo enquanto o processo viver.
 * Playwright launch deve usar { headless: false, args: ['--no-sandbox'] }.
 *
 * O entrypoint do container já sobe Xvfb e exporta DISPLAY. Se esse Xvfb
 * morrer (restart do container, crash/oom), DISPLAY continua setado apontando
 * pra um socket X morto e o fallback cabecaleiro nunca se recupera. Por isso o
 * helper VALIDA o socket do display antes de confiar em DISPLAY e, se o X
 * server sumiu, limpa a variável e relança um Xvfb próprio.
 */
let xvfbProcess: ChildProcess | null = null;
let displayNumber: string | null = null;

/** Socket de domínio p/ um display (ex: :99 -> /tmp/.X11-unix/X99). */
function displaySocket(display: string): string {
  return join('/tmp/.X11-unix', `X${display.replace(/^:/, '')}`);
}

/** true se o X server do display parece vivo (socket presente). */
function isDisplayAlive(display: string): boolean {
  return existsSync(displaySocket(display));
}

/**
 * Garante que um display Xvfb está ativo e retorna o número do display.
 * Se um DISPLAY externo (entrypoint) tem socket vivo, usa-o. Se DISPLAY está
 * setado mas o X server morreu, limpa e relança. Se não há Xvfb instalado,
 * retorna null (caller decide o que fazer).
 */
export async function ensureXvfb(): Promise<string | null> {
  // Display externo do entrypoint — só confia se o X server estiver vivo.
  if (process.env.DISPLAY && isDisplayAlive(process.env.DISPLAY)) {
    return process.env.DISPLAY;
  }
  // DISPLAY órfão (X morreu) ou inválido — não pode ser reutilizado.
  if (process.env.DISPLAY) {
    delete process.env.DISPLAY;
  }

  if (xvfbProcess && displayNumber && isDisplayAlive(displayNumber)) {
    return displayNumber;
  }
  // Display nosso morreu — limpa e relança.
  if (xvfbProcess) {
    xvfbProcess = null;
    displayNumber = null;
  }

  // Procura um display livre a partir de :99.
  const display = ':99';
  try {
    xvfbProcess = spawn(
      '/usr/bin/Xvfb',
      [display, '-screen', '0', '1366x768x24'],
      {
        stdio: 'ignore',
        detached: true,
      },
    );

    // Se o processo morre imediatamente, Xvfb não está instalado.
    // spawn assíncrono sempre define pid — a morte chega via evento 'exit'.
    // Espera 500ms e checa se ainda está vivo.
    await new Promise((r) => setTimeout(r, 500));
    if (xvfbProcess.exitCode !== null || xvfbProcess.signalCode !== null) {
      xvfbProcess = null;
      return null;
    }

    xvfbProcess.on('error', () => {
      xvfbProcess = null;
      displayNumber = null;
    });

    xvfbProcess.on('exit', () => {
      xvfbProcess = null;
      displayNumber = null;
    });

    displayNumber = display;
    process.env.DISPLAY = display;

    // Dá um tempo para o Xvfb subir.
    return display;
  } catch {
    xvfbProcess = null;
    displayNumber = null;
    return null;
  }
}

/**
 * Aguarda Xvfb estar pronto (daemon sobe assíncrono).
 * Em containers Docker, o Xvfb pode ser iniciado pelo entrypoint.
 */
export async function waitForXvfb(maxWaitMs = 3000): Promise<string | null> {
  const display = await ensureXvfb();
  if (!display) return null;

  // Pequeno delay para o socket do X server abrir.
  await new Promise((r) => setTimeout(r, maxWaitMs));
  return display;
}
