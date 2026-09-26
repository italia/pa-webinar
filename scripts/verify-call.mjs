#!/usr/bin/env node
// Prova di una chiamata vera su un'installazione di PA Webinar: crea una
// chiamata istantanea con la chiave dell'istanza, fa entrare due partecipanti
// in due browser headless con videocamera e microfono finti, controlla che
// audio e video arrivino a entrambi attraverso il ponte video, poi chiude la
// chiamata e la cancella.
//
// Uso (la chiave arriva da standard input, mai dagli argomenti):
//   printf '%s\n' "$ADMIN_API_KEY" | node scripts/verify-call.mjs \
//     --url https://webinar.example.org --meet-url https://meet.example.org
//
// La lancia scripts/verify-install.sh --call. Richiede node 20 o più recente,
// Playwright (npm ci nella radice del repository) e un Chromium: quello di
// Playwright (npx playwright install chromium) o --browser <percorso>.
//
// Stampa righe "ok ...", "AVVISO ..." ed "ERRORE ..."; esce con 0 se la
// chiamata funziona, 1 se no, 2 se non può provarla.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');

function uso() {
  process.stdout.write(`Uso: printf '%s\\n' "$ADMIN_API_KEY" | node scripts/verify-call.mjs [opzioni]

  --url URL               portale (obbligatorio)
  --meet-url URL          conferenza (obbligatorio)
  --resolve IP            raggiunge portale e conferenza a questo IP
  --browser PATH          Chrome o Chromium da usare (predefinito: quello di Playwright)
  --ignore-cert-errors    accetta certificati non verificabili (autorità privata)
  --timeout S             attesa massima per entrare nella chiamata (predefinito: 180)
  -h, --help              questo aiuto
`);
}

const opzioni = { timeout: 180, ignoreCert: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const valore = () => {
    const v = argv[++i];
    if (v === undefined) fine(2, `ERRORE ${a} vuole un valore`);
    return v;
  };
  switch (a) {
    case '--url': opzioni.url = valore().replace(/\/+$/, ''); break;
    case '--meet-url': opzioni.meetUrl = valore().replace(/\/+$/, ''); break;
    case '--resolve': opzioni.resolve = valore(); break;
    case '--browser': opzioni.browser = valore(); break;
    case '--ignore-cert-errors': opzioni.ignoreCert = true; break;
    case '--timeout': opzioni.timeout = Number(valore()); break;
    case '-h': case '--help': uso(); process.exit(0); break;
    default: fine(2, `ERRORE opzione sconosciuta: ${a}`);
  }
}

function fine(codice, ...righe) {
  for (const r of righe) process.stdout.write(`${r}\n`);
  process.exit(codice);
}

if (!opzioni.url || !opzioni.meetUrl) fine(2, 'ERRORE servono --url e --meet-url');
if (!Number.isFinite(opzioni.timeout) || opzioni.timeout <= 0) fine(2, 'ERRORE --timeout vuole un numero di secondi');

let chiave = '';
try {
  chiave = readFileSync(0, 'utf8').split('\n')[0].trim();
} catch {
  // nessuno standard input
}
if (!chiave) fine(2, "ERRORE chiave dell'istanza assente su standard input");

let chromium;
try {
  ({ chromium } = createRequire(join(RADICE, 'package.json'))('playwright'));
} catch {
  fine(2, 'ERRORE Playwright non trovato: esegui npm ci nella radice del repository');
}

// Etichette del pulsante d'ingresso, dai testi del portale: la sala si apre in
// italiano, la lingua predefinita. Se il file non c'è (script copiato da solo)
// si riconosce il pulsante dalla forma.
function etichetteIngresso() {
  try {
    const it = JSON.parse(readFileSync(join(RADICE, 'app/src/i18n/messages/it.json'), 'utf8'));
    return [it?.waiting?.joinNowBtn, it?.waiting?.roomJustOpened].filter((s) => typeof s === 'string');
  } catch {
    return [];
  }
}

const ETICHETTE = etichetteIngresso();
const portale = new URL(opzioni.url);
const conferenza = new URL(opzioni.meetUrl);
const scadenza = () => Date.now() + opzioni.timeout * 1000;
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

// Tiene traccia delle connessioni WebRTC di ogni frame, per leggerne le
// statistiche senza dipendere dagli interni della conferenza.
const TRACCIA_CONNESSIONI = `(() => {
  const Originale = window.RTCPeerConnection;
  if (!Originale || window.__connessioniProva) return;
  window.__connessioniProva = [];
  const Tracciata = function (...a) {
    const pc = new Originale(...a);
    window.__connessioniProva.push(pc);
    return pc;
  };
  Tracciata.prototype = Originale.prototype;
  Object.setPrototypeOf(Tracciata, Originale);
  window.RTCPeerConnection = Tracciata;
})();`;

const argomentiBrowser = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];
if (opzioni.resolve) {
  argomentiBrowser.push(`--host-resolver-rules=MAP ${portale.hostname} ${opzioni.resolve}, MAP ${conferenza.hostname} ${opzioni.resolve}`);
}
if (opzioni.ignoreCert) argomentiBrowser.push('--ignore-certificate-errors');

const risultati = [];
let esito = 0;
const ok = (m) => risultati.push(`ok ${m}`);
const avviso = (m) => risultati.push(`AVVISO ${m}`);
const errore = (m) => {
  risultati.push(`ERRORE ${m}`);
  esito = 1;
};

let browser;
let chiamata;
let paginaAdmin;

async function nuovaPagina() {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: opzioni.ignoreCert,
    permissions: ['camera', 'microphone'],
    locale: 'it-IT',
  });
  await ctx.addInitScript(TRACCIA_CONNESSIONI);
  return ctx.newPage();
}

// Richiesta al portale dall'interno della pagina: passa dallo stesso browser,
// con la stessa risoluzione dei nomi e gli stessi cookie.
async function api(pagina, percorso, init) {
  return pagina.evaluate(async ({ percorso, init }) => {
    const r = await fetch(percorso, init);
    const testo = await r.text();
    let corpo;
    try { corpo = JSON.parse(testo); } catch { corpo = null; }
    return { status: r.status, corpo };
  }, { percorso, init });
}

function frameConferenza(pagina) {
  return pagina.frames().find((f) => {
    try { return new URL(f.url()).hostname === conferenza.hostname; } catch { return false; }
  });
}

async function entra(pagina, url, nome) {
  await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const campo = pagina.locator('#waiting-name');
  await campo.waitFor({ timeout: 60_000 });
  await campo.fill(nome);
  let pulsante = null;
  for (const etichetta of ETICHETTE) {
    const p = pagina.getByRole('button', { name: etichetta, exact: false });
    if (await p.count()) { pulsante = p.first(); break; }
  }
  pulsante ??= pagina.locator('button.btn-lg:not([disabled])').first();
  // Durante l'allestimento del ponte video il pulsante resta spento.
  await pulsante.waitFor({ timeout: opzioni.timeout * 1000 });
  const limite = scadenza();
  while (!(await pulsante.isEnabled()) && Date.now() < limite) await attendi(2000);
  await pulsante.click();
}

async function statoConferenza(pagina) {
  const frame = frameConferenza(pagina);
  if (!frame) return null;
  return frame.evaluate(() => {
    const st = window.APP?.store?.getState?.();
    const partecipanti = st?.['features/base/participants'];
    const remoti = partecipanti?.remote;
    return {
      entrato: Boolean(st?.['features/base/conference']?.conference),
      ruolo: partecipanti?.local?.role ?? null,
      remoti: remoti ? (remoti.size ?? Object.keys(remoti).length) : 0,
    };
  }).catch(() => null);
}

async function attendiIngresso(pagina, remotiAttesi) {
  const limite = scadenza();
  let s = null;
  while (Date.now() < limite) {
    s = await statoConferenza(pagina);
    if (s?.entrato && s.remoti >= remotiAttesi) return s;
    await attendi(2000);
  }
  return s;
}

// Byte e fotogrammi ricevuti su tutte le connessioni del frame della
// conferenza, e il tipo di percorso scelto (diretto o via TURN, UDP o TCP).
async function statisticheMedia(pagina) {
  const frame = frameConferenza(pagina);
  if (!frame) return null;
  return frame.evaluate(async () => {
    const pcs = [...(window.__connessioniProva ?? [])];
    const interna = window.APP?.conference?._room?.jvbJingleSession?.peerconnection?.peerconnection;
    if (interna && !pcs.includes(interna)) pcs.push(interna);
    const tot = { audio: 0, video: 0, fotogrammi: 0, percorso: null };
    for (const pc of pcs) {
      if (pc.connectionState === 'closed') continue;
      const report = await pc.getStats();
      const perId = new Map();
      report.forEach((s) => perId.set(s.id, s));
      report.forEach((s) => {
        if (s.type === 'inbound-rtp') {
          if (s.kind === 'audio') tot.audio += s.bytesReceived ?? 0;
          if (s.kind === 'video') {
            tot.video += s.bytesReceived ?? 0;
            tot.fotogrammi += s.framesDecoded ?? 0;
          }
        }
        if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && !tot.percorso) {
          const locale = perId.get(s.localCandidateId);
          if (locale) tot.percorso = `${locale.candidateType ?? '?'}/${(locale.protocol ?? '?').toLowerCase()}`;
        }
      });
    }
    return tot;
  }).catch(() => null);
}

async function controllaMedia(pagina, chi) {
  const prima = await statisticheMedia(pagina);
  await attendi(4000);
  const dopo = await statisticheMedia(pagina);
  if (!prima || !dopo) {
    errore(`${chi}: statistiche WebRTC non leggibili`);
    return;
  }
  const audio = dopo.audio - prima.audio;
  const video = dopo.video - prima.video;
  const percorso = dopo.percorso ? `, percorso ${dopo.percorso}` : '';
  if (audio > 0 && video > 0 && dopo.fotogrammi > 0) {
    const kbit = Math.round(((audio + video) * 8) / 4 / 1000);
    ok(`${chi}: riceve audio e video (${kbit} kbit/s${percorso})`);
  } else if (audio > 0 || video > 0) {
    avviso(`${chi}: riceve ${audio > 0 ? 'solo audio' : 'solo video'}${percorso}`);
  } else {
    errore(`${chi}: nessun media ricevuto in 4 secondi${percorso} (porta UDP del ponte video raggiungibile? TURN?)`);
  }
}

// Subito dopo un aggiornamento il front end della conferenza si riavvia e il
// proxy risponde 502 per qualche secondo: si aspetta che config.js risponda 200
// tre volte di fila (al massimo 60 secondi) prima di entrare.
async function attendiConferenza(pagina) {
  const limite = Date.now() + 60_000;
  let diFila = 0;
  let ultimo = 0;
  while (Date.now() < limite) {
    const r = await pagina.goto(`${opzioni.meetUrl}/config.js`, { timeout: 20_000 }).catch(() => null);
    ultimo = r?.status() ?? 0;
    diFila = ultimo === 200 ? diFila + 1 : 0;
    if (diFila >= 3) return;
    await attendi(1000);
  }
  throw new Error(`la conferenza non risponde stabilmente (config.js: ${ultimo || 'nessuna risposta'})`);
}

async function chiudiChiamata() {
  if (!chiamata || !paginaAdmin) return;
  const autorizzazione = { Authorization: `Bearer ${chiamata.moderatorToken}`, 'Content-Type': 'application/json' };
  try {
    await api(paginaAdmin, `/api/events/${chiamata.id}`, { method: 'PUT', headers: autorizzazione, body: JSON.stringify({ status: 'ENDED' }) });
    const del = await api(paginaAdmin, `/api/events/${chiamata.id}`, { method: 'DELETE', headers: autorizzazione });
    if (del.status >= 200 && del.status < 300) ok('chiamata di prova chiusa e cancellata');
    else avviso(`chiamata di prova non cancellata (risposta ${del.status}): cancellala dall'area di amministrazione`);
  } catch (e) {
    avviso(`chiamata di prova non cancellata (${String(e).slice(0, 120)}): cancellala dall'area di amministrazione`);
  }
}

try {
  browser = await chromium.launch({
    ...(opzioni.browser ? { executablePath: opzioni.browser } : {}),
    args: argomentiBrowser,
  });
} catch (e) {
  fine(2, `ERRORE browser non avviato: ${String(e.message ?? e).split('\n')[0]} (npx playwright install chromium, o --browser)`);
}

try {
  paginaAdmin = await nuovaPagina();
  await attendiConferenza(paginaAdmin);
  await paginaAdmin.goto(`${opzioni.url}/api/health`, { timeout: 60_000 });
  const accesso = await api(paginaAdmin, '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: chiave }),
  });
  chiave = '';
  if (accesso.status !== 200) throw new Error(`accesso con la chiave: risposta ${accesso.status}`);

  const creata = await api(paginaAdmin, '/api/events/instant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'it' },
    body: JSON.stringify({ title: { it: 'Verifica installazione' }, maxParticipants: 2 }),
  });
  if (creata.status !== 201 || !creata.corpo?.links) throw new Error(`creazione della chiamata di prova: risposta ${creata.status}`);
  chiamata = creata.corpo;

  const guest = await nuovaPagina();
  await entra(paginaAdmin, chiamata.links.liveRoom, 'Verifica moderatore');
  const mod0 = await attendiIngresso(paginaAdmin, 0);
  if (!mod0?.entrato) throw new Error('il moderatore non entra nella conferenza (JWT, prosody, jicofo?)');
  await entra(guest, chiamata.links.shareLink, 'Verifica ospite');
  const ospite = await attendiIngresso(guest, 1);
  const mod = await attendiIngresso(paginaAdmin, 1);
  if (ospite?.entrato && mod?.remoti >= 1 && ospite.remoti >= 1) {
    ok(`due partecipanti nella conferenza (ruoli: ${mod.ruolo ?? '?'} e ${ospite.ruolo ?? '?'})`);
    if (mod.ruolo !== 'moderator') avviso(`il moderatore entra con il ruolo ${mod.ruolo}`);
    if (ospite.ruolo === 'moderator') avviso("l'ospite entra come moderatore");
  } else {
    throw new Error(`i partecipanti non si vedono (moderatore: ${JSON.stringify(mod)}, ospite: ${JSON.stringify(ospite)})`);
  }
  // Qualche secondo perché i flussi si stabilizzino.
  await attendi(6000);
  await controllaMedia(guest, 'ospite');
  await controllaMedia(paginaAdmin, 'moderatore');
} catch (e) {
  errore(`prova di chiamata: ${String(e.message ?? e).split('\n')[0].slice(0, 300)}`);
} finally {
  await chiudiChiamata();
  await browser.close().catch(() => {});
}

fine(esito, ...risultati);
