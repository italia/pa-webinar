'use client';

/**
 * Quanto pesa un evento sul ponte video e sulla rete, per chi lo organizza:
 * le scelte che contano (partecipanti, webcam accese, le altre impostazioni
 * dell'evento), quanto riceve e manda ciascuno, quanto del ponte si usa con un
 * livello e un suggerimento, e le ipotesi della stima. Si ricalcola a ogni
 * cambio dal modello di lib/capacity/model; con `solaLettura` (la pagina
 * dell'evento) mostra le scelte salvate senza cambiarle.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { useDurataTesto } from '@/hooks/use-durata-testo';
import {
  COEFFICIENTI_CORE,
  MAX_RIQUADRI,
  MICROFONI_APERTI_TIPICI,
  SCHERMO_MBPS,
  SOGLIA_CPU_PONTE,
  profiloFlussi,
  stimaCapacita,
  type CapacitaIstanza,
  type InputCapacita,
  type LivelloCapacita,
  type StimaCapacita,
} from '@/lib/capacity/model';
import { videoQualityBudget } from '@/lib/jitsi/config';

/** Le quote di webcam fra cui si sceglie (0: solo chi presenta). */
const PROFILI = [
  { key: 'presenters', value: 0 },
  { key: 'few', value: 10 },
  { key: 'half', value: 50 },
  { key: 'all', value: 100 },
] as const;

const ICONA_LIVELLO: Record<LivelloCapacita, string> = {
  ampio: 'it-check-circle',
  attenzione: 'it-warning-circle',
  limite: 'it-error',
  nonBasta: 'it-close-circle',
};

/** Quanto aspettare, dopo l'ultimo cambio, prima di annunciare la stima. */
const PAUSA_ANNUNCIO_MS = 700;

export interface CapacityPanelProps {
  istanza: CapacitaIstanza;
  evento: InputCapacita;
  /** I partecipanti possono condividere lo schermo (si dice; non cambia la
   *  stima, perche' chi presenta puo' sempre condividere). */
  participantsCanShareScreen: boolean;
  /** La quota di webcam scelta; null: quella del sito. */
  onCameraPctChange?: (next: number | null) => void;
  /** Porta al campo dei partecipanti attesi. */
  onCambiaPartecipanti?: () => void;
  /** Porta alla scelta della qualita' video. */
  onCambiaQualita?: () => void;
  /** Mostra le scelte salvate, senza cambiarle (la pagina dell'evento). */
  solaLettura?: boolean;
  /** Gli iscritti finora (la pagina dell'evento). */
  iscritti?: number;
  /** In sola lettura: il collegamento a dove si cambiano le scelte. */
  modifica?: ReactNode;
  /** Il livello dei titoli interni, secondo la pagina che ospita il pannello. */
  titolo?: 'h4' | 'h6';
}

export default function CapacityPanel({
  istanza,
  evento,
  participantsCanShareScreen,
  onCameraPctChange,
  onCambiaPartecipanti,
  onCambiaQualita,
  solaLettura = false,
  iscritti,
  modifica,
  titolo: Titolo = 'h4',
}: CapacityPanelProps) {
  const t = useTranslations('admin.form.jvbPreview');
  const format = useFormatter();
  const durataTesto = useDurataTesto();
  const id = useId();

  // In sola lettura, con piu' iscritti che partecipanti attesi si stima sugli
  // iscritti.
  const sugliIscritti =
    solaLettura && iscritti !== undefined && iscritti > evento.maxParticipants;
  const input: InputCapacita = sugliIscritti
    ? { ...evento, maxParticipants: iscritti }
    : evento;
  const s = stimaCapacita(input, istanza);

  const numero = (n: number, cifre = 0) =>
    format.number(n, { maximumFractionDigits: cifre });
  const pct = (frazione: number) =>
    format.number(frazione, { style: 'percent', maximumFractionDigits: 0 });
  const banda = (mbps: number) =>
    mbps >= 1000
      ? t('gbps', { value: numero(mbps / 1000, 1) })
      : t('mbps', { value: numero(mbps, mbps < 10 ? 1 : 0) });
  const core = (n: number) => numero(n, n < 10 ? 1 : 0);
  const nomeQualita = t(`quality.${s.qualita}`);

  const { downMbps, upMbps, upPiccoMbps, telefonoMbps, telefonoVideo, upSempreTutti } =
    s.perPartecipante;
  const { livello, carico, soglie } = s.ponte;
  const video = evento.participantsCanStartVideo;

  // La frase per chi usa un lettore di schermo: il risultato di una scelta,
  // detto una volta sola quando si smette di cambiare.
  // La stima dell'apertura non si annuncia; dal primo cambio in poi si.
  const annuncio = t('live', { mbps: banda(downMbps), pct: pct(carico) });
  const [annunciato, setAnnunciato] = useState('');
  const allApertura = useRef<string | null>(annuncio);
  useEffect(() => {
    if (solaLettura || annuncio === allApertura.current) return;
    allApertura.current = null;
    const timer = setTimeout(() => setAnnunciato(annuncio), PAUSA_ANNUNCIO_MS);
    return () => clearTimeout(timer);
  }, [annuncio, solaLettura]);

  const testoLivello = (() => {
    if (livello !== 'nonBasta' || !s.istanza.cascading) return t(`levelText.${livello}`);
    return s.ponte.entra
      ? t('levelText.cascade', { count: s.ponte.ponti })
      : t('levelText.cascadeOver', {
          needed: s.ponte.pontiNecessari,
          available: s.istanza.ponti,
        });
  })();

  // I partecipanti attesi come li conta la stima (fra 2 e 5000), salvo
  // quando la stima conta gli iscritti.
  const attesi = sugliIscritti ? evento.maxParticipants : s.partecipanti;
  const durata =
    evento.durationHours !== null && evento.durationHours > 0
      ? durataTesto(0, Math.round(evento.durationHours * 60) * 60_000)
      : null;

  return (
    <div className="capacita">
      <p className="capacita__intro">{solaLettura ? t('introReadOnly') : t('intro')}</p>

      <div className="capacita__ingressi">
        <p className="capacita__attesi">
          <strong className="capacita__attesi-numero">{numero(attesi)}</strong>{' '}
          {t('expected', { count: attesi })}
          {iscritti !== undefined && (
            <span className="capacita__iscritti">
              {' · '}
              {t('registered', { count: iscritti })}
            </span>
          )}
          {!solaLettura && onCambiaPartecipanti && (
            <>
              {' '}
              <button
                type="button"
                className="btn btn-link capacita__cambia"
                onClick={onCambiaPartecipanti}
                aria-label={t('changeParticipants')}
              >
                {t('change')}
              </button>
            </>
          )}
        </p>
        {sugliIscritti && (
          <p className="capacita__nota">
            {t('sizedOnRegistrations', { count: iscritti })}
          </p>
        )}

        {!solaLettura && (
          <SceltaWebcam
            valore={evento.expectedSenderRatioPct}
            quotaSito={istanza.siteCameraPct}
            video={video}
            presentatori={s.presentatori}
            onChange={(next) => onCameraPctChange?.(next)}
            pct={pct}
          />
        )}

        <div className="capacita__impostazioni">
          <span className="capacita__impostazioni-titolo">{t('fromSettings')}</span>
          <ul>
            {solaLettura && (
              <Impostazione etichetta={t('settings.cameras')}>
                {video
                  ? etichettaQuota(
                      t,
                      evento.expectedSenderRatioPct,
                      istanza.siteCameraPct,
                      pct
                    )
                  : t('camera.presenters')}
              </Impostazione>
            )}
            <Impostazione etichetta={t('settings.quality')}>
              {t('qualityValue', {
                name: nomeQualita,
                height: videoQualityBudget(s.qualita).maxHeight,
              })}
              {onCambiaQualita && !solaLettura && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="btn btn-link capacita__cambia"
                    onClick={onCambiaQualita}
                    aria-label={t('changeQuality')}
                  >
                    {t('change')}
                  </button>
                </>
              )}
            </Impostazione>
            <Impostazione etichetta={t('settings.screen')}>
              {participantsCanShareScreen ? t('screenAll') : t('screenPresenters')}
            </Impostazione>
            <Impostazione etichetta={t('settings.mics')}>
              {evento.participantsCanUnmute ? t('micsAll') : t('micsPresenters')}
            </Impostazione>
            <Impostazione etichetta={t('settings.recording')}>
              {evento.recordingEnabled ? t('on') : t('off')}
            </Impostazione>
            {istanza.captionsAvailable && (
              <Impostazione etichetta={t('settings.captions')}>
                {evento.liveCaptionsEnabled ? t('on') : t('off')}
              </Impostazione>
            )}
            {durata && (
              <Impostazione etichetta={t('settings.duration')}>{durata}</Impostazione>
            )}
          </ul>
          {solaLettura && modifica && <p className="capacita__modifica">{modifica}</p>}
        </div>
      </div>

      <section className="capacita__blocco" aria-labelledby={`${id}-per`}>
        <Titolo id={`${id}-per`} className="capacita__titolo">
          {t('perParticipant')}
        </Titolo>
        <div className="capacita__schede">
          <div className="capacita__scheda">
            <span className="capacita__icona" aria-hidden="true">
              <Icon icon="it-arrow-down" size="sm" />
            </span>
            <p className="capacita__valore">
              <Circa testo={t('about')} />
              {banda(downMbps)}
            </p>
            <p className="capacita__cosa">{t('down')}</p>
            <p className="capacita__dettaglio">
              {t('downDetail', {
                videos: s.videoVisti,
                voices: s.vociInoltrate,
                phoneVideos: telefonoVideo,
                phone: banda(telefonoMbps),
              })}
            </p>
          </div>
          <div className="capacita__scheda">
            <span className="capacita__icona" aria-hidden="true">
              <Icon icon="it-arrow-up" size="sm" />
            </span>
            <p className="capacita__valore">
              <Circa testo={t('about')} />
              {banda(upMbps)}
            </p>
            <p className="capacita__cosa">{t('up')}</p>
            <p className="capacita__dettaglio">
              {upSempreTutti
                ? t('upDetailMax')
                : t('upDetail', { value: banda(upPiccoMbps) })}
            </p>
          </div>
        </div>
      </section>

      <section
        className={`capacita__ponte capacita__ponte--${livello}`}
        aria-labelledby={`${id}-ponte`}
      >
        <div className="capacita__ponte-testa">
          <Titolo id={`${id}-ponte`} className="capacita__titolo">
            {t('bridgeTitle')}
          </Titolo>
          <span className={`capacita__livello capacita__livello--${livello}`}>
            <Icon icon={ICONA_LIVELLO[livello]} size="sm" />
            {t(`level.${livello}`)}
          </span>
        </div>
        <p className="capacita__uso">
          {t.rich('bridgeUse', {
            cores: core(s.ponte.core),
            total: numero(s.ponte.coreDelPonte),
            pct: pct(carico),
            strong: (c) => <strong>{c}</strong>,
          })}
        </p>
        <BarraCarico carico={carico} soglie={soglie} livello={livello} t={t} pct={pct} />
        <p className="capacita__spiega">{testoLivello}</p>
        {s.suggerimento && (
          <p className="capacita__suggerimento">{testoSuggerimento(s, t, pct, numero)}</p>
        )}
        {s.webcamNonAiutano && (
          <p className="capacita__suggerimento">
            {t('camerasDontHelp', { max: MAX_RIQUADRI })}
          </p>
        )}
        <dl className="capacita__risorse">
          <div>
            <dt>{t('bridgeOut')}</dt>
            <dd>
              <Circa testo={t('about')} />
              {banda(s.ponte.outMbps)}
            </dd>
          </div>
          <div>
            <dt>{t('bridgeIn')}</dt>
            <dd>
              <Circa testo={t('about')} />
              {banda(s.ponte.inMbps)}
            </dd>
          </div>
        </dl>
      </section>

      {(s.registrazione || s.sottotitoli) && (
        <div className="capacita__schede">
          {s.registrazione && (
            <div className="capacita__scheda">
              <Titolo className="capacita__titolo">{t('recordingTitle')}</Titolo>
              <p className="capacita__dettaglio">
                {durata
                  ? t('recordingText', {
                      cores: core(s.registrazione.core),
                      min: numero(s.registrazione.gbMin, 1),
                      max: numero(s.registrazione.gbMax, 1),
                      duration: durata,
                    })
                  : t('recordingTextPerHour', {
                      cores: core(s.registrazione.core),
                      min: numero(s.registrazione.gbMin, 1),
                      max: numero(s.registrazione.gbMax, 1),
                    })}
              </p>
            </div>
          )}
          {s.sottotitoli && (
            <div className="capacita__scheda">
              <Titolo className="capacita__titolo">{t('captionsTitle')}</Titolo>
              <p className="capacita__dettaglio">
                {t('captionsText', {
                  cores: core(s.sottotitoli.core),
                  voices: s.sottotitoli.voci,
                })}
              </p>
            </div>
          )}
        </div>
      )}

      <p className="capacita__istanza">
        {t.rich('instance', {
          count: s.istanza.ponti,
          cores: numero(s.istanza.coreDelPonte),
          strong: (c) => <strong>{c}</strong>,
        })}{' '}
        {s.istanza.cascading ? t('instanceCascade') : t('instanceSingle')}
      </p>

      <details className="capacita__come">
        <summary>{t('howTitle')}</summary>
        <Ipotesi s={s} t={t} banda={banda} numero={numero} pct={pct} />
      </details>

      {!solaLettura && (
        <p className="visually-hidden" aria-live="polite">
          {annunciato}
        </p>
      )}
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;
type Pct = (frazione: number) => string;

/** «~» a vista, «circa» a chi ascolta. */
function Circa({ testo }: { testo: string }) {
  return (
    <>
      <span aria-hidden="true">~</span>
      <span className="visually-hidden">{testo} </span>
    </>
  );
}

function Impostazione({
  etichetta,
  children,
}: {
  etichetta: string;
  children: ReactNode;
}) {
  return (
    <li>
      {etichetta}: <strong>{children}</strong>
    </li>
  );
}

/** La quota di webcam in parole: il profilo, o il valore. */
function etichettaQuota(
  t: T,
  valore: number | null,
  quotaSito: number,
  pct: Pct
): string {
  if (valore === null) return `${t('camera.site')} · ${pct(quotaSito / 100)}`;
  const profilo = PROFILI.find((p) => p.value === valore);
  if (profilo?.value === 0) return t('camera.presenters');
  return profilo
    ? `${t(`camera.${profilo.key}`)} · ${pct(valore / 100)}`
    : `${t('camera.custom')} · ${pct(valore / 100)}`;
}

function testoSuggerimento(
  s: StimaCapacita,
  t: T,
  pct: Pct,
  numero: (n: number, cifre?: number) => string
): string | null {
  const g = s.suggerimento;
  if (!g) return null;
  const soglia = pct(s.ponte.soglie.attenzione);
  switch (g.tipo) {
    case 'qualita':
      return t('suggestQuality', {
        threshold: soglia,
        quality: t(`quality.${g.qualita}`),
        pct: pct(g.carico),
      });
    case 'webcam': {
      const profilo = PROFILI.find((p) => p.value === g.quota);
      return t('suggestCameras', {
        threshold: soglia,
        profile: profilo ? t(`camera.${profilo.key}`) : pct(g.quota / 100),
        pct: pct(g.carico),
      });
    }
    case 'partecipanti':
      return t('suggestParticipants', {
        threshold: soglia,
        count: numero(g.partecipanti),
        pct: pct(g.carico),
      });
  }
}

/** Le webcam accese: un profilo, il valore del sito o un valore scritto. */
function SceltaWebcam({
  valore,
  quotaSito,
  video,
  presentatori,
  onChange,
  pct,
}: {
  valore: number | null;
  quotaSito: number;
  video: boolean;
  presentatori: number;
  onChange: (next: number | null) => void;
  pct: Pct;
}) {
  const t = useTranslations('admin.form.jvbPreview');
  const id = useId();
  // «Altro valore» resta scelto anche quando il numero scritto coincide con un
  // profilo; un valore salvato fuori dai profili lo sceglie da se'.
  const [altro, setAltro] = useState(false);
  const fuoriProfilo = valore !== null && !PROFILI.some((p) => p.value === valore);
  const scelto =
    altro || fuoriProfilo ? 'altro' : valore === null ? 'sito' : String(valore);
  const [testo, setTesto] = useState<string | null>(null);

  const scegli = (prossimo: number | null) => {
    setAltro(false);
    setTesto(null);
    onChange(prossimo);
  };

  return (
    <fieldset className="capacita__quota" disabled={!video}>
      <legend className="capacita__domanda">{t('cameraQuestion')}</legend>
      <div className="capacita__profili">
        {PROFILI.map((p) => (
          <label key={p.key} className="capacita__profilo">
            <input
              type="radio"
              name={`${id}-quota`}
              value={p.value}
              checked={video && scelto === String(p.value)}
              onChange={() => scegli(p.value)}
            />
            <span>
              {t(`camera.${p.key}`)}
              {p.value > 0 && <span className="capacita__pct">{pct(p.value / 100)}</span>}
            </span>
          </label>
        ))}
        <label className="capacita__profilo">
          <input
            type="radio"
            name={`${id}-quota`}
            value="sito"
            checked={video && scelto === 'sito'}
            onChange={() => scegli(null)}
          />
          <span>
            {t('camera.site')}
            <span className="capacita__pct">{pct(quotaSito / 100)}</span>
          </span>
        </label>
        <label className="capacita__profilo">
          <input
            type="radio"
            name={`${id}-quota`}
            value="altro"
            checked={video && scelto === 'altro'}
            onChange={() => {
              setAltro(true);
              setTesto(null);
              onChange(valore ?? quotaSito);
            }}
          />
          <span>{t('camera.custom')}</span>
        </label>
      </div>
      {video && scelto === 'altro' && (
        <div className="capacita__altro">
          <label className="form-label" htmlFor={`${id}-altro`}>
            {t('customLabel')}
          </label>
          <input
            id={`${id}-altro`}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            className="form-control"
            value={testo ?? String(valore ?? quotaSito)}
            onChange={(e) => {
              setTesto(e.target.value);
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n)) onChange(Math.min(100, Math.max(0, n)));
            }}
            onBlur={() => setTesto(null)}
          />
        </div>
      )}
      {!video && (
        <p className="capacita__nota">{t('videoDisabled', { count: presentatori })}</p>
      )}
    </fieldset>
  );
}

/** Il carico sulla barra, con i segni delle due soglie: a vista soltanto, la
 *  frase sopra dice gia' il valore. */
function BarraCarico({
  carico,
  soglie,
  livello,
  t,
  pct,
}: {
  carico: number;
  soglie: { attenzione: number; critica: number };
  livello: LivelloCapacita;
  t: T;
  pct: Pct;
}) {
  const segni = [
    { key: 'markWarn', at: soglie.attenzione },
    { key: 'markCritical', at: soglie.critica },
  ] as const;
  return (
    <div aria-hidden="true">
      <div className="capacita__barra-segni">
        {/* Verso la fine della barra l'etichetta sta a sinistra del segno:
            non esce dal bordo. */}
        {segni.map((g) => (
          <span
            key={g.key}
            className={`capacita__segno-testo${g.at > 0.75 ? ' capacita__segno-testo--prima' : ''}`}
            style={
              g.at > 0.75 ? { right: `${(1 - g.at) * 100}%` } : { left: `${g.at * 100}%` }
            }
          >
            {t(g.key, { pct: pct(g.at) })}
          </span>
        ))}
      </div>
      <div className="capacita__barra">
        <span
          className={`capacita__riempimento capacita__riempimento--${livello}`}
          style={{ width: `${Math.min(1, carico) * 100}%` }}
        />
        {segni.map((g) => (
          <span
            key={g.key}
            className="capacita__segno"
            style={{ left: `${g.at * 100}%` }}
          />
        ))}
      </div>
      <ul className="capacita__barra-legenda">
        {segni.map((g) => (
          <li key={g.key}>{t(g.key, { pct: pct(g.at) })}</li>
        ))}
      </ul>
    </div>
  );
}

/** Le ipotesi della stima, una per riga. */
function Ipotesi({
  s,
  t,
  banda,
  numero,
  pct,
}: {
  s: StimaCapacita;
  t: T;
  banda: (mbps: number) => string;
  numero: (n: number, cifre?: number) => string;
  pct: Pct;
}) {
  const f = profiloFlussi(s.qualita);
  // I flussi piccoli con due decimali: 0,15 non e' 0,2.
  const fine = (mbps: number) => t('mbps', { value: numero(mbps, mbps < 1 ? 2 : 1) });
  const righe: Array<[string, string]> = [
    [
      t('how.cameras'),
      t('how.camerasValue', {
        count: s.webcam,
        total: s.partecipanti,
        presenters: s.presentatori,
      }),
    ],
    [
      t('how.seen'),
      f.lastN >= 0 && f.lastN < MAX_RIQUADRI
        ? t('how.seenValueLastN', {
            count: s.videoVisti,
            lastN: f.lastN,
            phone: s.perPartecipante.telefonoVideo,
          })
        : t('how.seenValue', {
            count: s.videoVisti,
            max: MAX_RIQUADRI,
            phone: s.perPartecipante.telefonoVideo,
          }),
    ],
    [
      t('how.mics'),
      t('how.micsValue', { count: s.microfoniAperti, typical: MICROFONI_APERTI_TIPICI }),
    ],
    [
      t('how.voices'),
      s.numLoudest > 0
        ? t('how.voicesLoudest', { count: s.vociInoltrate, loudest: s.numLoudest })
        : t('how.voicesAll', { count: s.vociInoltrate }),
    ],
    [
      t('how.caps', { quality: t(`quality.${s.qualita}`) }),
      t('how.capsValue', {
        small: fine(f.riquadro),
        medium: fine(f.medio),
        main: fine(f.primoPiano),
        peak: fine(f.picco),
      }),
    ],
    [t('how.screen'), t('how.screenValue', { value: banda(SCHERMO_MBPS) })],
    [
      t('how.packets'),
      t('how.packetsValue', {
        out: numero(s.ponte.outPps / 1000, 1),
        in: numero(s.ponte.inPps / 1000, 1),
      }),
    ],
    [
      t('how.cores'),
      t('how.coresValue', {
        base: numero(COEFFICIENTI_CORE.base, 2),
        perKpps: numero(COEFFICIENTI_CORE.perKpps, 3),
        perMbps: numero(COEFFICIENTI_CORE.perMbps, 3),
      }),
    ],
    [t('how.load'), t('how.loadValue', { cpu: pct(SOGLIA_CPU_PONTE) })],
  ];
  return (
    <table className="table table-sm capacita__ipotesi">
      <tbody>
        {righe.map(([etichetta, valore]) => (
          <tr key={etichetta}>
            <th scope="row">{etichetta}</th>
            <td>{valore}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** La capacita' in una riga, per il riepilogo del wizard. */
export interface RiepilogoCapacita {
  /** Il carico del ponte (1 = pieno). */
  carico: number;
  livello: LivelloCapacita;
  /** Quanto riceve chi guarda, in Mbps. */
  downMbps: number;
}

/** La capacita' nel riepilogo: sempre detta, come avviso da «attenzione» in su. */
export function RigaCapacita({
  capacita,
  onDettagli,
}: {
  capacita: RiepilogoCapacita;
  onDettagli?: () => void;
}) {
  const t = useTranslations('admin.form.jvbPreview');
  const format = useFormatter();
  const avviso = capacita.livello !== 'ampio';
  const mbps = capacita.downMbps;
  return (
    <p className={`capacita__riepilogo${avviso ? ' capacita__riepilogo--avviso' : ''}`}>
      <Icon
        icon={avviso ? 'it-warning-circle' : 'it-info-circle'}
        size="sm"
        className="me-1"
      />
      <span>
        {t('review', {
          pct: format.number(capacita.carico, {
            style: 'percent',
            maximumFractionDigits: 0,
          }),
          level: t(`level.${capacita.livello}`),
          mbps: t('mbps', {
            value: format.number(mbps, { maximumFractionDigits: mbps < 10 ? 1 : 0 }),
          }),
        })}
        {onDettagli && (
          <>
            {' · '}
            <button
              type="button"
              className="btn btn-link p-0 capacita__riepilogo-link"
              onClick={onDettagli}
            >
              {t('reviewDetails')}
            </button>
          </>
        )}
      </span>
    </p>
  );
}
