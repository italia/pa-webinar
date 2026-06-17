#!/usr/bin/env node
/**
 * Coherence stress harness (ADR-013 multitrack validation).
 *
 * Spawns N headless-Chrome SENDER bots in ONE process, each joining the same
 * Jitsi room with a DISTINCT participant name (own minted JWT), publishing a
 * real audio track, periodically TOGGLING the mic (mute/unmute), and joining
 * /leaving on a STAGGER. This is what Malleus can't do (one JWT, no toggle, no
 * churn) and is exactly what the recorder per-source attribution must survive:
 *   - distinct names  → each track file maps to the right participant name
 *   - mic toggle      → a participant produces MULTIPLE session files (pid-seq)
 *   - staggered join  → late-join offsets in the merged timeline
 *
 * Env:
 *   JITSI_DOMAIN        e.g. pa-webinar-jitsi.developers.italia.it
 *   JITSI_ROOM          room name (must match the recorder's room, incl. any suffix)
 *   JITSI_JWT_SECRET    HS256 secret (Prosody)
 *   JITSI_JWT_ISSUER    (pa-webinar)  JITSI_JWT_AUDIENCE (jitsi)  JITSI_JWT_SUBJECT (domain)
 *   BOTS                number of senders            (default 5)
 *   NAME_PREFIX         display-name prefix          (default "Speaker")
 *   DURATION_S          base session length seconds  (default 1200)
 *   TOGGLE_S            mic mute/unmute period sec    (default 45; 0 disables)
 *   STAGGER_S           seconds between bot joins     (default 4)
 *   EARLY_LEAVE_EVERY   every Nth bot leaves early (~60% dur) to test churn (default 5; 0 disables)
 *   ICE_POLICY          'all' for in-cluster direct, '' to inherit served relay (default '')
 *   CONCURRENCY_PAGES   max simultaneous browser pages (default = BOTS)
 */
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';

const env = process.env;
const DOMAIN = req('JITSI_DOMAIN');
const ROOM = req('JITSI_ROOM');
const SECRET = req('JITSI_JWT_SECRET');
const ISSUER = env.JITSI_JWT_ISSUER || 'pa-webinar';
const AUD = env.JITSI_JWT_AUDIENCE || 'jitsi';
const SUB = env.JITSI_JWT_SUBJECT || DOMAIN;
const BOTS = int('BOTS', 5);
const NAME_PREFIX = env.NAME_PREFIX || 'Speaker';
const DURATION_S = int('DURATION_S', 1200);
const TOGGLE_S = int('TOGGLE_S', 45);
const STAGGER_S = int('STAGGER_S', 4);
const EARLY_LEAVE_EVERY = int('EARLY_LEAVE_EVERY', 5);
const ICE_POLICY = env.ICE_POLICY || '';

function req(n) { const v = env[n]; if (!v) { console.error(`missing env ${n}`); process.exit(1); } return v; }
function int(n, d) { const v = env[n]; return v != null && v !== '' ? Number(v) : d; }
function b64url(s) { return Buffer.from(s).toString('base64url'); }
function mintJwt(name) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    context: { user: { id: crypto.randomUUID(), name, moderator: 'false' },
               features: { recording: 'false', livestreaming: 'false', 'screen-sharing': 'false' } },
    room: '*', iss: ISSUER, aud: AUD, sub: SUB, iat: now, exp: now + 6 * 3600,
  }));
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// In-page sender: connects, joins, publishes audio, toggles mic, leaves.
const IN_PAGE = (cfg) => new Promise((resolve) => {
  /* eslint-disable */
  const J = window.JitsiMeetJS;
  const log = (m) => window.__log && window.__log(m);
  if (!J) { log('no lib-jitsi-meet'); return resolve('no-ljm'); }
  J.init({ disableAudioLevels: true });
  J.setLogLevel(J.logLevels.ERROR);
  const jc = window.config || {};
  if (cfg.icePolicy) { jc.iceTransportPolicy = cfg.icePolicy; jc.useStunTurn = cfg.icePolicy !== 'all'; }
  const hosts = jc.hosts || {};
  const serviceUrl = jc.websocket || jc.bosh;
  const conn = new J.JitsiConnection(null, cfg.jwt, { hosts, serviceUrl, clientNode: 'https://jitsi.org/jitsimeet' });
  let conf = null, audio = null, joined = false, toggleTimer = null, muted = false;
  const finish = () => {
    if (toggleTimer) clearInterval(toggleTimer);
    try { if (audio) audio.dispose && audio.dispose(); } catch (e) {}
    try { conf && conf.leave(); } catch (e) {}
    try { conn.disconnect(); } catch (e) {}
    resolve('ok');
  };
  conn.addEventListener(J.events.connection.CONNECTION_ESTABLISHED, async () => {
    conf = conn.initJitsiConference(cfg.room, jc);
    conf.setDisplayName(cfg.name);
    conf.on(J.events.conference.CONFERENCE_JOINED, async () => {
      joined = true;
      log('joined ' + cfg.name);
      try {
        const tracks = await J.createLocalTracks({ devices: ['audio'] });
        audio = tracks.find((t) => t.getType() === 'audio');
        if (audio) { await conf.addTrack(audio); log('audio published ' + cfg.name); }
      } catch (e) { log('addTrack err ' + e); }
      if (cfg.toggleMs > 0 && audio) {
        toggleTimer = setInterval(async () => {
          try { if (muted) { await audio.unmute(); muted = false; } else { await audio.mute(); muted = true; } } catch (e) {}
        }, cfg.toggleMs);
      }
    });
    conf.on(J.events.conference.CONFERENCE_FAILED, (e) => { log('CONF_FAILED ' + e); finish(); });
    conf.join();
  });
  conn.addEventListener(J.events.connection.CONNECTION_FAILED, (e) => { log('CONN_FAILED ' + e); finish(); });
  conn.connect();
  setTimeout(finish, cfg.durationMs);
  /* eslint-enable */
});

async function runBot(browser, i) {
  const name = `${NAME_PREFIX}-${String(i + 1).padStart(2, '0')}`;
  const jwt = mintJwt(name);
  const early = EARLY_LEAVE_EVERY > 0 && (i + 1) % EARLY_LEAVE_EVERY === 0;
  const durationMs = (early ? Math.floor(DURATION_S * 0.6) : DURATION_S) * 1000;
  const page = await browser.newPage();
  await page.exposeFunction('__log', (m) => console.log(`[${name}] ${m}`));
  try {
    await page.goto(`https://${DOMAIN}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.addScriptTag({ url: `https://${DOMAIN}/libs/lib-jitsi-meet.min.js` });
    await page.addScriptTag({ url: `https://${DOMAIN}/config.js` });
    await page.evaluate(IN_PAGE, { jwt, room: ROOM.toLowerCase(), name, toggleMs: TOGGLE_S * 1000, durationMs, icePolicy: ICE_POLICY });
  } catch (e) {
    console.error(`[${name}] error: ${String(e).slice(0, 120)}`);
  } finally {
    try { await page.close(); } catch (e) {}
  }
}

(async () => {
  console.log(`coherence-bots: ${BOTS} senders → ${DOMAIN}/${ROOM} | toggle=${TOGGLE_S}s stagger=${STAGGER_S}s dur=${DURATION_S}s ice=${ICE_POLICY || 'inherit'}`);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
           '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
           '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'],
    protocolTimeout: 0,
  });
  const tasks = [];
  for (let i = 0; i < BOTS; i++) {
    tasks.push(runBot(browser, i));
    if (STAGGER_S > 0 && i < BOTS - 1) await new Promise((r) => setTimeout(r, STAGGER_S * 1000));
  }
  await Promise.allSettled(tasks);
  await browser.close();
  console.log('coherence-bots: all senders finished');
})();
