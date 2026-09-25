import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

import { resolveWhiteboardInfraReady } from './whiteboard';

/**
 * Il flag della lavagna deve restare una scelta di RUNTIME: la stessa immagine
 * gira in installazioni con e senza backend Excalidraw, e ognuna lo dichiara
 * nell'env del pod. Letto in un componente client come
 * `process.env.NEXT_PUBLIC_*` puntato, webpack lo congelerebbe nel bundle al
 * build e l'env del pod non conterebbe più niente.
 */

describe('resolveWhiteboardInfraReady', () => {
  it('senza variabile la lavagna resta nascosta', () => {
    expect(resolveWhiteboardInfraReady(undefined)).toBe(false);
    expect(resolveWhiteboardInfraReady(null)).toBe(false);
    expect(resolveWhiteboardInfraReady('')).toBe(false);
  });

  it('"true" la mostra, anche con spazi e maiuscole da values.yaml', () => {
    expect(resolveWhiteboardInfraReady('true')).toBe(true);
    expect(resolveWhiteboardInfraReady(' TRUE ')).toBe(true);
    expect(resolveWhiteboardInfraReady('True')).toBe(true);
  });

  it('un valore che non riconosciamo la lascia nascosta', () => {
    for (const raw of ['1', 'yes', 'on', 'false', 'enabled']) {
      expect(resolveWhiteboardInfraReady(raw)).toBe(false);
    }
  });
});

const SRC = path.resolve(__dirname, '../..');
const LIVE_PAGE = path.join(SRC, 'app/[locale]/events/[slug]/live/page.tsx');
const LIVE_CLIENT = path.join(SRC, 'components/live/live-event-client.tsx');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Via i commenti che occupano la riga: spiegare la trappola non è caderci. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Il testo di un elemento JSX autochiuso, da `<Tag` al primo `/>`. */
function jsxElement(source: string, tag: string): string {
  const start = source.indexOf(`<${tag}`);
  if (start < 0) return '';
  const end = source.indexOf('/>', start);
  return end < 0 ? '' : source.slice(start, end);
}

describe('cablaggio del flag della lavagna (deve restare a RUNTIME)', () => {
  it('nessun file legge NEXT_PUBLIC_WHITEBOARD_ENABLED in notazione puntata', () => {
    // L'ago è composto a pezzi perché questo file non violi la regola che verifica.
    const dottedRead = ['process', 'env', 'NEXT_PUBLIC_WHITEBOARD_ENABLED'].join('.');
    const offenders = sourceFiles(SRC).filter((file) =>
      stripComments(fs.readFileSync(file, 'utf8')).includes(dottedRead),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('il Server Component della sala legge il valore a runtime', () => {
    const page = fs.readFileSync(LIVE_PAGE, 'utf8');
    expect(page).toContain("getPublicEnv('NEXT_PUBLIC_WHITEBOARD_ENABLED')");
    expect(page).toContain('resolveWhiteboardInfraReady');
  });

  it('ogni ramo della pagina passa il flag alla sala', () => {
    const page = stripComments(fs.readFileSync(LIVE_PAGE, 'utf8'));
    expect(countOccurrences(page, 'whiteboardInfraReady={whiteboardInfraReady}')).toBe(
      countOccurrences(page, '<LiveEventClient'),
    );
  });

  it('LiveEventClient inoltra il flag al pulsante e al promemoria', () => {
    // Pulsante (ModeratorControls) e promemoria di esportazione (LiveSidebar)
    // devono comparire insieme: senza una delle due righe il valore arriva dal
    // server e muore nel componente intermedio.
    const client = stripComments(fs.readFileSync(LIVE_CLIENT, 'utf8'));
    expect(jsxElement(client, 'ModeratorControls')).toContain(
      'whiteboardInfraReady={whiteboardInfraReady}',
    );
    expect(jsxElement(client, 'LiveSidebar')).toContain(
      'whiteboardInfraReady={whiteboardInfraReady}',
    );
  });
});
