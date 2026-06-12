/**
 * Dev harness — sala d'attesa a 3 zone (chat | gioco Phaser | controlli).
 *
 * Wira le dipendenze concrete del gioco (Mock*) e costruisce attorno la UI
 * funzionale in stile Design System Italia: chat, configurazione audio/video
 * (anteprima reale via getUserMedia), consenso e CTA d'ingresso.
 *
 * Querystring: ?in=20 (sec al LIVE, 0=subito) · ?host=1 · ?bots=120
 * Console:     window.lobby.addBots(50) · .live() · .end() · .destroy()
 */
import './harness.css';
import { mountLobby } from '../src/lobby';
import { MockConferenceState } from '../src/lobby/mocks/MockConferenceState';
import { MockEventSchedule } from '../src/lobby/mocks/MockEventSchedule';
import { MockMediaDevices } from '../src/lobby/mocks/MockMediaDevices';
import { MockPresenceClient } from '../src/lobby/mocks/MockPresenceClient';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} non trovato`);
  return el as T;
};

const params = new URLSearchParams(location.search);
const startInSeconds = params.has('in') ? Number(params.get('in')) : 60;
const host = params.get('host') === '1';
const nBots = params.has('bots') ? Number(params.get('bots')) : 80;

const world = { w: 2400, h: 1600 };
const presence = new MockPresenceClient(nBots, { world });
const conference = new MockConferenceState();
const schedule = new MockEventSchedule({ startInSeconds, host });
const media = new MockMediaDevices();

// Nome partecipante: in questo layout NOME + INGRESSO + CONFIG vivono nel
// pannello controlli a destra, non dentro al gioco. Quindi sopprimiamo la
// modale di onboarding del gioco (flag in storage) e gli passiamo un nome di
// partenza; il gioco mostra solo il giardino sociale.
const STORE = 'pawebinar.participant.name';
const savedName = localStorage.getItem(STORE) ?? '';
try {
  localStorage.setItem('pawebinar.lobby.onboardingDismissed', '1');
} catch {
  /* storage bloccato */
}

// ── Gioco Phaser nella cella centrale ───────────────────────────────────
const handle = mountLobby(
  $('lobby-stage'),
  {
    worldSize: world,
    capacityHint: nBots,
    initialProfile: { name: savedName || 'Ospite' },
  },
  { presence, conference, schedule, media },
);

// ══════════════════════════════════════════════════════════════════════
//  STATO / COUNTDOWN
// ══════════════════════════════════════════════════════════════════════
const statusChip = $('status-chip');

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// Solo il chip di stato a livello pagina: countdown/conteggio dentro al palco
// sono già renderizzati dalla HUD del gioco.
function renderStatus(): void {
  const st = schedule.getStatus();
  if (st === 'live') {
    statusChip.className = 'status-chip is-live';
    statusChip.innerHTML = `<span class="pulse"></span> In diretta`;
  } else if (st === 'ended') {
    statusChip.className = 'status-chip';
    statusChip.textContent = 'Evento concluso';
  } else {
    statusChip.className = 'status-chip';
    statusChip.innerHTML = `Apre tra <b>${fmtCountdown(schedule.getStartsAt() - Date.now())}</b>`;
  }
  refreshCta();
}
schedule.on('statusChange', renderStatus);
setInterval(renderStatus, 1000);

// ══════════════════════════════════════════════════════════════════════
//  NOME → profilo del gioco + abilitazione ingresso
// ══════════════════════════════════════════════════════════════════════
const nameInput = $<HTMLInputElement>('name-input');
nameInput.value = savedName;
nameInput.addEventListener('input', () => {
  const n = nameInput.value.trim();
  handle.setProfile({ name: n });
  if (n.length >= 2) localStorage.setItem(STORE, n);
  refreshCta();
});
if (nameInput.value.trim()) handle.setProfile({ name: nameInput.value.trim() });

// ══════════════════════════════════════════════════════════════════════
//  CONFIGURAZIONE VIDEO/AUDIO (anteprima reale via getUserMedia)
// ══════════════════════════════════════════════════════════════════════
const camPreview = $('cam-preview');
const camVideo = $<HTMLVideoElement>('cam-video');
const camMic = $('cam-mic');
const micBar = $('mic-bar');
const tCam = $('t-cam');
const tMic = $('t-mic');
const camSelect = $<HTMLSelectElement>('cam-select');
const micSelect = $<HTMLSelectElement>('mic-select');

let stream: MediaStream | null = null;
let camOn = true;
let micOn = true;
let audioCtx: AudioContext | null = null;
let rafId = 0;

function setCamUi(): void {
  tCam.classList.toggle('is-on', camOn);
  tCam.setAttribute('aria-pressed', String(camOn));
  camPreview.dataset.on = String(camOn && !!stream?.getVideoTracks().length);
}
function setMicUi(): void {
  tMic.classList.toggle('is-on', micOn);
  tMic.setAttribute('aria-pressed', String(micOn));
  camMic.hidden = !micOn || !stream?.getAudioTracks().length;
}

async function listDevices(): Promise<void> {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const fill = (sel: HTMLSelectElement, kind: MediaDeviceKind, fallback: string) => {
      const cur = sel.value;
      sel.innerHTML = '';
      const list = devs.filter((d) => d.kind === kind);
      if (!list.length) {
        sel.innerHTML = `<option>${fallback}</option>`;
        return;
      }
      for (const d of list) {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || `${fallback} (${d.deviceId.slice(0, 6)})`;
        sel.appendChild(o);
      }
      if (cur) sel.value = cur;
    };
    fill(camSelect, 'videoinput', 'Videocamera');
    fill(micSelect, 'audioinput', 'Microfono');
  } catch {
    /* enumerateDevices non disponibile */
  }
}

function stopMeter(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  audioCtx?.close().catch(() => {});
  audioCtx = null;
  micBar.style.width = '0%';
}

function startMeter(s: MediaStream): void {
  stopMeter();
  const track = s.getAudioTracks()[0];
  if (!track) return;
  try {
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(new MediaStream([track]));
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (const v of data) sum += v;
      const level = Math.min(100, (sum / data.length) * 1.6);
      micBar.style.width = `${micOn ? level : 0}%`;
      rafId = requestAnimationFrame(loop);
    };
    loop();
  } catch {
    /* AudioContext può richiedere un gesto utente */
  }
}

async function startMedia(): Promise<void> {
  try {
    stream?.getTracks().forEach((t) => t.stop());
    stopMeter();
    const constraints: MediaStreamConstraints = {
      video: camOn ? (camSelect.value ? { deviceId: { exact: camSelect.value } } : true) : false,
      audio: micSelect.value ? { deviceId: { exact: micSelect.value } } : true,
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    camVideo.srcObject = stream;
    stream.getVideoTracks().forEach((t) => (t.enabled = camOn));
    stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    startMeter(stream);
    await listDevices(); // i label dei dispositivi compaiono dopo il permesso
  } catch {
    camOn = false; // permesso negato / nessun dispositivo → stato "spenta"
  }
  setCamUi();
  setMicUi();
}

tCam.addEventListener('click', async () => {
  camOn = !camOn;
  if (camOn && !stream?.getVideoTracks().length) {
    await startMedia();
  } else {
    stream?.getVideoTracks().forEach((t) => (t.enabled = camOn));
  }
  setCamUi();
});
tMic.addEventListener('click', () => {
  micOn = !micOn;
  stream?.getAudioTracks().forEach((t) => (t.enabled = micOn));
  setMicUi();
});
camSelect.addEventListener('change', () => {
  if (camOn) void startMedia();
});
micSelect.addEventListener('change', () => void startMedia());

setCamUi();
setMicUi();
void startMedia(); // device-check: prova ad avviare audio/video all'apertura

// ══════════════════════════════════════════════════════════════════════
//  CONSENSO + CTA D'INGRESSO
// ══════════════════════════════════════════════════════════════════════
const consentChk = $<HTMLInputElement>('consent-multitrack');
const enterBtn = $<HTMLButtonElement>('enter-btn');
const enterLabel = $('enter-label');
const enterFoot = $('enter-foot');
consentChk.addEventListener('change', refreshCta);

function refreshCta(): void {
  const nameOk = nameInput.value.trim().length >= 2;
  const consentOk = consentChk.checked;
  const st = schedule.getStatus();
  const live = st === 'live';

  enterBtn.classList.toggle('is-live', live);

  if (!nameOk) {
    enterBtn.disabled = true;
    enterLabel.textContent = 'Inserisci il tuo nome';
    enterFoot.textContent = '';
  } else if (!consentOk) {
    enterBtn.disabled = true;
    enterLabel.textContent = 'Accetta il consenso per entrare';
    enterFoot.textContent = 'Il consenso alla registrazione per partecipante è obbligatorio.';
  } else if (st === 'ended') {
    enterBtn.disabled = true;
    enterLabel.textContent = 'Evento concluso';
    enterFoot.textContent = '';
  } else if (!live) {
    enterBtn.disabled = true;
    enterLabel.textContent = `Apre tra ${fmtCountdown(schedule.getStartsAt() - Date.now())}`;
    enterFoot.textContent = 'Resta nel giardino: entri in automatico appena la sala apre.';
  } else {
    enterBtn.disabled = false;
    enterLabel.textContent = 'Entra ora nella sala';
    enterFoot.textContent = `Entri come "${nameInput.value.trim()}" · camera ${camOn ? 'on' : 'off'} · mic ${micOn ? 'on' : 'off'}`;
  }
}

const toast = $('toast');
let toastT = 0;
function showToast(msg: string): void {
  toast.textContent = msg;
  toast.classList.add('show');
  window.clearTimeout(toastT);
  toastT = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

enterBtn.addEventListener('click', () => {
  showToast(`✅ Entreresti nella sala come "${nameInput.value.trim()}" (demo)`);
});
$('classic-btn').addEventListener('click', () =>
  showToast('Passaggio alla vista classica accessibile (demo)'),
);

// ══════════════════════════════════════════════════════════════════════
//  CHAT (mock viva)
// ══════════════════════════════════════════════════════════════════════
const chatList = $('chat-list');
const chatForm = $<HTMLFormElement>('chat-form');
const chatInput = $<HTMLInputElement>('chat-input');
const AVATAR_COLORS = ['#0066CC', '#008758', '#D9364F', '#7B61FF', '#E07B00', '#0095A8'];
const colorFor = (s: string) =>
  AVATAR_COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length] ?? '#0066CC';

type Who = 'me' | 'peer' | 'sys';
function addMsg(who: Who, name: string, text: string): void {
  const row = document.createElement('div');
  row.className = `msg msg--${who}`;
  if (who === 'sys') {
    const bub = document.createElement('div');
    bub.className = 'msg__bubble';
    bub.textContent = text;
    row.appendChild(bub);
  } else {
    const av = document.createElement('div');
    av.className = 'msg__avatar';
    av.style.background = who === 'me' ? '#004080' : colorFor(name);
    av.textContent = name.slice(0, 1).toUpperCase() || '?';
    const body = document.createElement('div');
    body.className = 'msg__body';
    const nm = document.createElement('div');
    nm.className = 'msg__name';
    nm.textContent = who === 'me' ? 'Tu' : name;
    const bub = document.createElement('div');
    bub.className = 'msg__bubble';
    bub.textContent = text;
    body.append(nm, bub);
    row.append(av, body);
  }
  chatList.appendChild(row);
  chatList.scrollTop = chatList.scrollHeight;
}

const PEERS = ['Giulia', 'Marco', 'Francesca', 'Davide', 'Sara', 'Luca'];
const SEED: Array<[string, string]> = [
  ['Giulia', 'Buongiorno a tutte e tutti! ☕'],
  ['Marco', 'Pronti per il caffettino del DTD?'],
  ['Francesca', "Si sente bene l'audio da voi?"],
];
addMsg('sys', '', "Benvenuto nella sala d'attesa. La chat è moderata.");
SEED.forEach(([n, txt], i) => setTimeout(() => addMsg('peer', n, txt), 500 + i * 900));

const REPLIES = ['Ben detto! 👏', 'Concordo', 'A tra poco allora', 'Caffè versato ☕', 'Perfetto, grazie!'];
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  addMsg('me', nameInput.value.trim() || 'Tu', text);
  chatInput.value = '';
  window.setTimeout(
    () => {
      const peer = PEERS[Math.floor(performance.now()) % PEERS.length] ?? 'Ospite';
      const reply = REPLIES[Math.floor(performance.now() / 7) % REPLIES.length] ?? 'Concordo';
      addMsg('peer', peer, reply);
    },
    1100 + Math.random() * 1200,
  );
});

// ══════════════════════════════════════════════════════════════════════
//  Dev console helpers
// ══════════════════════════════════════════════════════════════════════
Object.assign(window, {
  lobby: {
    handle,
    presence,
    schedule,
    addBots: (n = 30) => presence.addBots(n),
    live: () => schedule.setStatus('live'),
    end: () => schedule.setStatus('ended'),
    destroy: () => {
      handle.destroy();
      schedule.dispose();
      stream?.getTracks().forEach((t) => t.stop());
    },
  },
});

window.addEventListener('beforeunload', () => {
  handle.destroy();
  schedule.dispose();
  stream?.getTracks().forEach((t) => t.stop());
});

renderStatus();
