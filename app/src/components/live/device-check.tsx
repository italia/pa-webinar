'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { useAnteprimaSfondo } from '@/hooks/use-background-preview';
import {
  SFONDI_VIRTUALI,
  SFONDO_PREDEFINITO,
  leggiSfondo,
  scriviSfondo,
} from '@/lib/jitsi/virtual-background';

type PermissionState = 'idle' | 'requesting' | 'granted' | 'denied';

/** Errori per cui manca (o e' occupata) la sola webcam: un permesso negato
 *  non c'e', e il microfono si puo' ancora provare da solo. */
const SOLO_AUDIO_SE = new Set(['NotFoundError', 'OverconstrainedError', 'NotReadableError', 'AbortError']);

// Una scelta per ruolo, non una sola per browser: chi ha acceso il microfono
// conducendo un evento non deve ritrovarlo acceso quando partecipa a un altro.
const prefKeys = (conduce: boolean) => {
  const ruolo = conduce ? 'conduce' : 'partecipa';
  return {
    camera: `pawebinar.deviceCheck.${ruolo}.cameraOn`,
    mic: `pawebinar.deviceCheck.${ruolo}.micOn`,
  };
};

function readBoolPref(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function writeBoolPref(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Un breve suono per controllare casse e cuffie prima di entrare. */
function suonoDiProva(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.001;
    osc.connect(gain).connect(ctx.destination);
    const t0 = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    osc.start(t0);
    osc.stop(t0 + 0.65);
    osc.onended = () => void ctx.close();
  } catch {
    /* si entra lo stesso */
  }
}

function IconaCamera({ spenta }: { spenta: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      {spenta && <line x1="2" y1="2" x2="22" y2="22" className="av-toggle__slash" />}
    </svg>
  );
}

function IconaMicrofono({ spento }: { spento: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
      {spento && <line x1="2" y1="2" x2="22" y2="22" className="av-toggle__slash" />}
    </svg>
  );
}

interface DeviceCheckProps {
  /** Called whenever the user toggles camera/mic in the pre-join UI.
   *  Parent wires this into `startWithVideoMuted`/`startWithAudioMuted`
   *  so the choice actually takes effect when the user joins Jitsi. */
  onStateChange?: (s: { cameraOn: boolean; micOn: boolean }) => void;
  /** Chi conduce o interviene: la scelta di fotocamera e microfono si ricorda
   *  a parte da quella di quando si partecipa. */
  conduce?: boolean;
}

/**
 * Audio e video prima di entrare. Fotocamera e microfono partono spenti (o
 * come li si era lasciati l'ultima volta): niente permesso chiesto finché non
 * se ne accende uno. Accendendoli si apre la prova — anteprima, sfondo,
 * periferiche, livello del microfono, prova delle casse — e la scelta passa
 * alla sala come stato d'ingresso.
 */
export default function DeviceCheck({ onStateChange, conduce = false }: DeviceCheckProps) {
  const t = useTranslations('deviceCheck');

  // Spenti finché non si legge la scelta memorizzata, dopo il montaggio: il
  // server non la conosce.
  const chiavi = prefKeys(conduce);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [montato, setMontato] = useState(false);
  useEffect(() => {
    setCameraOn(readBoolPref(chiavi.camera, false));
    setMicOn(readBoolPref(chiavi.mic, false));
    setMontato(true);
  }, [chiavi.camera, chiavi.mic]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meterRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState>('idle');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  // La periferica scelta da chi usa la pagina (vuota = quella del sistema) e
  // quella effettivamente in uso: tenerle separate evita di richiedere il
  // flusso ogni volta che il browser dice quale ha scelto.
  const [sceltaVideo, setSceltaVideo] = useState('');
  const [sceltaAudio, setSceltaAudio] = useState('');
  const [inUsoVideo, setInUsoVideo] = useState('');
  const [inUsoAudio, setInUsoAudio] = useState('');
  const [tentativo, setTentativo] = useState(0);

  // Sfondo virtuale: la scelta vive nelle preferenze del browser e la applica
  // la sala all'ingresso; l'anteprima lo mostra già dietro la persona.
  const [sfondo, setSfondo] = useState<string>(SFONDO_PREDEFINITO);
  useEffect(() => {
    setSfondo(leggiSfondo());
  }, []);

  const fermaFlusso = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    setStream(null);
  }, []);

  // Il flusso segue gli interruttori: si chiede solo ciò che è acceso, e una
  // periferica spenta si rilascia davvero (la luce della webcam si spegne).
  useEffect(() => {
    if (!montato) return;
    if (!cameraOn && !micOn) {
      fermaFlusso();
      setPermissionState('idle');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermissionState('denied');
      return;
    }
    let annullato = false;
    const vincoli = (video: boolean, audio: boolean): MediaStreamConstraints => ({
      video: video ? (sceltaVideo ? { deviceId: { exact: sceltaVideo } } : true) : false,
      audio: audio ? (sceltaAudio ? { deviceId: { exact: sceltaAudio } } : true) : false,
    });
    void (async () => {
      setPermissionState('requesting');
      fermaFlusso();
      try {
        let nuovo: MediaStream;
        try {
          nuovo = await navigator.mediaDevices.getUserMedia(vincoli(cameraOn, micOn));
        } catch (err) {
          // La periferica scelta non c'è più (scollegata, presa da un'altra
          // applicazione): si torna a quella del sistema invece di restare
          // bloccati su un vincolo impossibile.
          if ((sceltaVideo || sceltaAudio) && !annullato) {
            setSceltaVideo('');
            setSceltaAudio('');
            return;
          }
          // Senza webcam, o con la webcam tenuta da un'altra applicazione, la
          // richiesta congiunta fallisce intera e si porta via anche la prova
          // del microfono: si riprova con il solo audio, a camera spenta.
          const name = (err as { name?: unknown } | null)?.name;
          if (!cameraOn || !micOn || sceltaVideo || typeof name !== 'string' || !SOLO_AUDIO_SE.has(name)) {
            throw err;
          }
          nuovo = await navigator.mediaDevices.getUserMedia(vincoli(false, true));
          if (!annullato) setCameraOn(false);
        }
        if (annullato) {
          for (const track of nuovo.getTracks()) track.stop();
          return;
        }
        streamRef.current = nuovo;
        setStream(nuovo);
        const tutte = await navigator.mediaDevices.enumerateDevices();
        if (annullato) return;
        setVideoDevices(tutte.filter((d) => d.kind === 'videoinput'));
        setAudioDevices(tutte.filter((d) => d.kind === 'audioinput'));
        setInUsoVideo(nuovo.getVideoTracks()[0]?.getSettings().deviceId ?? '');
        setInUsoAudio(nuovo.getAudioTracks()[0]?.getSettings().deviceId ?? '');
        setPermissionState('granted');
      } catch {
        if (!annullato) setPermissionState('denied');
      }
    })();
    return () => {
      annullato = true;
    };
  }, [montato, cameraOn, micOn, sceltaVideo, sceltaAudio, tentativo, fermaFlusso]);

  // Uscendo dalla sala d'attesa si spegne tutto.
  useEffect(() => () => {
    if (streamRef.current) for (const track of streamRef.current.getTracks()) track.stop();
  }, []);

  // Il video nell'anteprima.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream && stream.getVideoTracks().length > 0 ? stream : null;
    if (video.srcObject) {
      video.muted = true;
      void video.play().catch(() => {});
    }
  }, [stream]);

  // Il livello del microfono, finché c'è una traccia audio.
  useEffect(() => {
    const traccia = stream?.getAudioTracks()[0];
    if (!stream || !traccia) return;
    const barra = meterRef.current;
    let ctx: AudioContext | null = null;
    let frame: number | null = null;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(new MediaStream([traccia])).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(buffer);
        let somma = 0;
        for (let i = 0; i < buffer.length; i += 1) somma += buffer[i] ?? 0;
        const pct = Math.min(100, Math.round((somma / buffer.length / 128) * 100));
        if (barra) barra.style.width = `${pct}%`;
        frame = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      /* il livello è un aiuto, non un requisito */
    }
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      void ctx?.close().catch(() => {});
      if (barra) barra.style.width = '0%';
    };
  }, [stream]);

  useEffect(() => {
    onStateChange?.({ cameraOn, micOn });
  }, [cameraOn, micOn, onStateChange]);

  const sfondoUrl = SFONDI_VIRTUALI.find((s) => s.id === sfondo)?.url ?? null;
  const videoAttivo = permissionState === 'granted' && cameraOn && !!stream?.getVideoTracks().length;
  const anteprima = useAnteprimaSfondo({ videoRef, canvasRef, sfondoUrl, attiva: videoAttivo });

  const aperto = cameraOn || micOn;

  const interruttore = (
    tipo: 'camera' | 'mic',
    acceso: boolean,
    cambia: (v: boolean) => void,
    chiave: string,
  ) => (
    <label className={`av-toggle${acceso ? ' is-on' : ''}`} htmlFor={`device-check-${tipo}-toggle`}>
      <input
        type="checkbox"
        role="switch"
        className="av-toggle__input"
        id={`device-check-${tipo}-toggle`}
        checked={acceso}
        onChange={(e) => {
          cambia(e.target.checked);
          writeBoolPref(chiave, e.target.checked);
        }}
      />
      <span className="av-toggle__icon">
        {tipo === 'camera' ? <IconaCamera spenta={!acceso} /> : <IconaMicrofono spento={!acceso} />}
      </span>
      <span className="av-toggle__text">
        <span className="av-toggle__name">{tipo === 'camera' ? t('cameraLabel') : t('micLabel')}</span>
        <span className="av-toggle__state">
          {tipo === 'camera'
            ? acceso ? t('cameraToggleOn') : t('cameraToggleOff')
            : acceso ? t('micToggleOn') : t('micToggleOff')}
        </span>
      </span>
      <span className="av-toggle__switch" aria-hidden="true">
        <span className="av-toggle__thumb" />
      </span>
    </label>
  );

  return (
    <section className="av-check" aria-labelledby="device-check-title">
      <h2 className="av-check__title" id="device-check-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
        </svg>
        {t('avTitle')}
      </h2>

      <div className="av-check__toggles">
        {interruttore('camera', cameraOn, setCameraOn, chiavi.camera)}
        {interruttore('mic', micOn, setMicOn, chiavi.mic)}
      </div>

      {!aperto && <p className="av-check__hint">{t('avOffHint')}</p>}

      {/* La prova si apre con un interruttore acceso; chiusa resta fuori dal
          giro della tastiera. */}
      <div className={`av-check__panel${aperto ? ' is-open' : ''}`} inert={!aperto}>
        <div className="av-check__panel-inner">
          {permissionState === 'denied' && (
            <div className="av-check__denied" role="alert">
              <span>{t('permissionNeeded')}</span>
              <Button
                color="primary"
                size="xs"
                onClick={() => {
                  setSceltaVideo('');
                  setSceltaAudio('');
                  setTentativo((n) => n + 1);
                }}
              >
                {t('retry')}
              </Button>
            </div>
          )}

          {/* Anteprima con lo sfondo scelto (canvas sopra il video). */}
          <div className={`av-check__preview${cameraOn ? '' : ' is-hidden'}`}>
            <video ref={videoRef} playsInline muted aria-label={t('preview')} className="av-check__video" />
            <canvas
              ref={canvasRef}
              aria-hidden="true"
              className="av-check__composite"
              style={{ display: sfondoUrl && anteprima === 'pronta' ? 'block' : 'none' }}
            />
            {permissionState === 'requesting' && (
              <div className="av-check__overlay" aria-live="polite">
                <span className="device-check-preview__spinner" aria-hidden="true" />
              </div>
            )}
            {permissionState === 'denied' && (
              <div className="av-check__overlay">{t('noVideo')}</div>
            )}
            {sfondoUrl && anteprima === 'caricamento' && permissionState === 'granted' && (
              <div className="device-check-preview__status" role="status">
                <span className="device-check-preview__spinner" aria-hidden="true" />
                {t('backgroundPreviewLoading')}
              </div>
            )}
          </div>

          <div className="av-check__grid">
            {cameraOn && (
              <div>
                <label htmlFor="device-check-camera" className="form-label small mb-1">
                  {t('cameraLabel')}
                </label>
                <select
                  id="device-check-camera"
                  className="form-select form-select-sm"
                  value={sceltaVideo || inUsoVideo}
                  onChange={(e) => setSceltaVideo(e.target.value)}
                  disabled={permissionState !== 'granted'}
                >
                  {videoDevices.length === 0 && <option value="">—</option>}
                  {videoDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || t('cameraLabel')}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {micOn && (
              <div>
                <label htmlFor="device-check-mic" className="form-label small mb-1">
                  {t('micLabel')}
                </label>
                <select
                  id="device-check-mic"
                  className="form-select form-select-sm"
                  value={sceltaAudio || inUsoAudio}
                  onChange={(e) => setSceltaAudio(e.target.value)}
                  disabled={permissionState !== 'granted'}
                >
                  {audioDevices.length === 0 && <option value="">—</option>}
                  {audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || t('micLabel')}
                    </option>
                  ))}
                </select>
                <div className="small mt-2 mb-1 text-muted">{t('micLevel')}</div>
                <div className="av-check__meter" role="meter" aria-label={t('micLevel')}>
                  <div ref={meterRef} className="av-check__meter-fill" />
                </div>
                {permissionState === 'granted' && !stream?.getAudioTracks()[0] && (
                  <div className="small text-muted mt-1">{t('noAudio')}</div>
                )}
              </div>
            )}
          </div>

          <div className="av-check__speaker">
            <Button color="primary" outline size="xs" onClick={suonoDiProva} className="d-inline-flex align-items-center gap-1">
              <Icon icon="it-hearing" size="xs" color="primary" />
              {t('speakerTest')}
            </Button>
          </div>

          {/* Sfondo virtuale, accanto all'anteprima: è il momento in cui ci si
              guarda; il pulsante di Jitsi vive DENTRO la sala. */}
          {cameraOn && (
            <fieldset className="av-check__backgrounds">
              <legend className="form-label small mb-1" id="device-check-bg-label">
                {t('backgroundLabel')}
              </legend>
              {/* Scelta singola: un gruppo di opzioni, ci si sposta con le frecce. */}
              <div className="av-check__bg-list" role="radiogroup" aria-labelledby="device-check-bg-label">
                {SFONDI_VIRTUALI.map((s) => {
                  const scelto = s.id === sfondo;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={scelto}
                      tabIndex={scelto ? 0 : -1}
                      className={`av-check__bg${scelto ? ' is-selected' : ''}`}
                      title={t(`background.${s.id}`)}
                      onKeyDown={(e) => {
                        const avanti = e.key === 'ArrowRight' || e.key === 'ArrowDown';
                        const indietro = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
                        if (!avanti && !indietro) return;
                        e.preventDefault();
                        const i = SFONDI_VIRTUALI.findIndex((x) => x.id === sfondo);
                        const prossimo =
                          SFONDI_VIRTUALI[(i + (avanti ? 1 : SFONDI_VIRTUALI.length - 1)) % SFONDI_VIRTUALI.length];
                        if (!prossimo) return;
                        setSfondo(prossimo.id);
                        scriviSfondo(prossimo.id);
                        const bottoni = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
                        bottoni?.[SFONDI_VIRTUALI.indexOf(prossimo)]?.focus();
                      }}
                      onClick={() => {
                        setSfondo(s.id);
                        scriviSfondo(s.id);
                      }}
                    >
                      <span
                        className="av-check__bg-thumb"
                        style={s.url ? { backgroundImage: `url(${s.url})` } : undefined}
                      >
                        {!s.url && t('backgroundNoneShort')}
                      </span>
                      <span className="visually-hidden">{t(`background.${s.id}`)}</span>
                    </button>
                  );
                })}
              </div>
              <small className="text-muted d-block mt-1">
                {anteprima === 'errore'
                  ? t('backgroundPreviewUnavailable')
                  : anteprima === 'pronta' || anteprima === 'caricamento'
                    ? t('backgroundHintPreview')
                    : t('backgroundHint')}
              </small>
            </fieldset>
          )}
        </div>
      </div>
    </section>
  );
}
