/**
 * Validazione headless del PoC facefx: Chrome con webcam finta, harness
 * locale via http server, asserzioni sui risultati.
 *
 *   node infra/jitsi/facefx/run-poc-test.mjs
 *
 * Usa il Chromium di Playwright dell'app (o /usr/bin/google-chrome come
 * fallback) — nessuna GUI necessaria.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };

const server = createServer(async (req, res) => {
  try {
    const path = join(root, req.url === '/' ? 'harness.html' : req.url);
    res.setHeader('Content-Type', MIME[extname(path)] ?? 'text/plain');
    res.end(await readFile(path));
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/harness.html`;

let executablePath;
try {
  executablePath = chromium.executablePath();
  await readFile(executablePath).catch(() => {
    throw new Error('playwright chromium non scaricato');
  });
} catch {
  executablePath = '/usr/bin/google-chrome';
}

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: [
    '--use-fake-device-for-media-capture',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage();
page.on('console', (m) => console.log('  [browser]', m.text()));
await page.goto(url);
const results = await page.evaluate(() => window.__runTests(), null);
await browser.close();
server.close();

console.log('\nRisultati:', JSON.stringify(results, null, 2));

const checks = [
  ['t1 passthrough se disabilitato', results.t1_disabled_passthrough === true],
  ['t2 track processata (generator)', results.t2_enabled_is_generator === true],
  ['t2 settings proxati dalla sorgente', results.t2_settings_proxied === true],
  ['t2 framerate sostenuto (>=30 frame in 2s)', results.t2_frames_in_2s >= 30],
  ['t3 sorgente scura schiarita (>1.8x)', results.t3_brightened === true],
  ['t4 stop propagato alla sorgente', results.t4_stop_propagates === true],
  ['nessun errore', results.errors.length === 0],
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
