'use client';

/**
 * La capacita' di un evento in un colpo d'occhio, per chi dimensiona
 * l'installazione: quanti parleranno (si sceglie), il flusso da chi parla ai
 * ponti video a chi ascolta, quanto dei ponti si usa e le risorse che servono.
 * I ponti vengono dagli stessi conti dello scaler (lib/jvb-sizing) con la
 * quota scelta; banda, memoria, durata e spazio dalle stesse stime della
 * pagina dell'evento (lib/estimates).
 */

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { IconaMicrofono } from '@/components/admin/guided-format';
import { Icon } from '@/components/ui/icon';
import { estimateNumbers } from '@/lib/estimates';
import { jvbsForEvent, type JvbSizingConfig } from '@/lib/jvb-sizing';

const PROFILI = [
  { key: 'webinar', value: 5 },
  { key: 'meeting', value: 30 },
  { key: 'workshop', value: 60 },
  { key: 'allHands', value: 100 },
] as const;

/** Sopra questi partecipanti la quota ereditata dal sito va detta. */
const AVVISO_QUOTA_OLTRE = 100;

export interface CapacityPanelProps {
  maxParticipants: number;
  /** null = la quota del sito. */
  senderRatioPct: number | null;
  onSenderRatioChange: (next: number | null) => void;
  videoEnabled: boolean;
  defaultSenderRatioPct: number;
  sizingConfig: JvbSizingConfig;
  recordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanShareScreen: boolean;
  /** Inizio e fine (per la durata e lo spazio della registrazione). */
  startsAt?: string;
  endsAt?: string;
}

/** Gli avvisi del pannello: il riepilogo del wizard li segnala. */
export function capacityWarnings({
  maxParticipants,
  senderRatioPct,
  videoEnabled,
  defaultSenderRatioPct,
  sizingConfig,
}: Pick<
  CapacityPanelProps,
  | 'maxParticipants'
  | 'senderRatioPct'
  | 'videoEnabled'
  | 'defaultSenderRatioPct'
  | 'sizingConfig'
>): { atCeiling: boolean; shouldWarnInherited: boolean } {
  const quota = videoEnabled ? (senderRatioPct ?? defaultSenderRatioPct) : 0;
  const ponti = jvbsForEvent(
    Math.max(0, maxParticipants),
    quota,
    videoEnabled,
    sizingConfig
  );
  return {
    atCeiling: ponti >= sizingConfig.maxReplicas && maxParticipants > 0,
    shouldWarnInherited:
      senderRatioPct === null && videoEnabled && maxParticipants >= AVVISO_QUOTA_OLTRE,
  };
}

export default function CapacityPanel({
  maxParticipants,
  senderRatioPct,
  onSenderRatioChange,
  videoEnabled,
  defaultSenderRatioPct,
  sizingConfig,
  recordingEnabled,
  participantsCanUnmute,
  participantsCanShareScreen,
  startsAt,
  endsAt,
}: CapacityPanelProps) {
  const t = useTranslations('admin.form.jvbPreview');
  const format = useFormatter();
  const id = useId();

  const partecipanti = Math.max(0, maxParticipants);
  const quota = videoEnabled
    ? Math.max(0, Math.min(100, senderRatioPct ?? defaultSenderRatioPct))
    : 0;
  const parlano = Math.ceil(partecipanti * (quota / 100));
  const ascoltano = Math.max(0, partecipanti - parlano);
  const ponti = jvbsForEvent(partecipanti, quota, videoEnabled, sizingConfig);

  // Quanto dei ponti si usa: il costo di chi parla e di chi ascolta, in core,
  // sulla capacita' dei ponti accesi.
  const capacita = ponti * Math.max(1, sizingConfig.cpuCoresPerPod);
  const coreParlano =
    sizingConfig.sendersPerCore > 0 ? parlano / sizingConfig.sendersPerCore : 0;
  const coreAscolto =
    sizingConfig.receiversPerCore > 0 ? ascoltano / sizingConfig.receiversPerCore : 0;
  const quotaParlano = (coreParlano / capacita) * 100;
  const quotaAscolto = (coreAscolto / capacita) * 100;
  const carico = quotaParlano + quotaAscolto;
  const oltre = carico > 100;
  // La barra non va oltre il suo bordo: le due parti si riducono insieme.
  const riduci = oltre ? 100 / carico : 1;

  const stime = estimateNumbers({
    maxParticipants: partecipanti,
    startsAt,
    endsAt,
    recordingEnabled,
    participantsCanUnmute,
    participantsCanStartVideo: videoEnabled,
    participantsCanShareScreen,
    expectedSenderRatioPct: quota,
    jvbSizingConfig: sizingConfig,
  });

  const { atCeiling, shouldWarnInherited } = capacityWarnings({
    maxParticipants,
    senderRatioPct,
    videoEnabled,
    defaultSenderRatioPct,
    sizingConfig,
  });

  const pct = (n: number) =>
    format.number(n / 100, { style: 'percent', maximumFractionDigits: 0 });
  const mbps = (n: number) =>
    n >= 1000
      ? t('gbps', { value: format.number(n / 1000, { maximumFractionDigits: 1 }) })
      : t('mbps', { value: format.number(n, { maximumFractionDigits: n < 10 ? 1 : 0 }) });
  const ore = Math.floor(stime.durationHours);
  const minuti = Math.round((stime.durationHours - ore) * 60);

  const scelto = senderRatioPct === null ? 'sito' : String(senderRatioPct);
  // Una quota salvata che non e' fra i profili (scritta via API, con un
  // modulo precedente o da una bozza ripresa) resta fra le scelte, anche dopo
  // averne provata un'altra.
  const fuoriProfilo =
    senderRatioPct !== null && !PROFILI.some((p) => p.value === senderRatioPct)
      ? senderRatioPct
      : null;
  const [personalizzata, setPersonalizzata] = useState(fuoriProfilo);
  if (fuoriProfilo !== null && fuoriProfilo !== personalizzata) {
    setPersonalizzata(fuoriProfilo);
  }

  return (
    <div className="capacita">
      <fieldset className="capacita__quota" disabled={!videoEnabled}>
        <legend className="capacita__domanda">{t('ratioQuestion')}</legend>
        <div className="capacita__profili">
          {PROFILI.map((p) => (
            <label key={p.key} className="capacita__profilo">
              <input
                type="radio"
                name={`${id}-quota`}
                value={p.value}
                checked={scelto === String(p.value)}
                onChange={() => onSenderRatioChange(p.value)}
              />
              <span>
                {t(`preset.${p.key}`)}{' '}
                <span className="capacita__pct">{pct(p.value)}</span>
              </span>
            </label>
          ))}
          {personalizzata !== null && (
            <label className="capacita__profilo">
              <input
                type="radio"
                name={`${id}-quota`}
                value={personalizzata}
                checked={scelto === String(personalizzata)}
                onChange={() => onSenderRatioChange(personalizzata)}
              />
              <span>
                {t('customValue')}{' '}
                <span className="capacita__pct">{pct(personalizzata)}</span>
              </span>
            </label>
          )}
          <label className="capacita__profilo">
            <input
              type="radio"
              name={`${id}-quota`}
              value="sito"
              checked={scelto === 'sito'}
              onChange={() => onSenderRatioChange(null)}
            />
            <span>
              {t('siteValue')}{' '}
              <span className="capacita__pct">{pct(defaultSenderRatioPct)}</span>
            </span>
          </label>
        </div>
        {!videoEnabled && <p className="capacita__nota">{t('videoDisabled')}</p>}
      </fieldset>

      {/* Chi usa un lettore di schermo sente il risultato di una scelta: i
          ponti e il carico cambiano senza che il fuoco si sposti. */}
      <p className="visually-hidden" aria-live="polite">
        {t('liveSummary', { pods: ponti, load: pct(carico) })}
      </p>

      {/* Da chi parla, attraverso i ponti video, a chi ascolta. */}
      <ol className="capacita__flusso" aria-label={t('flowLabel')}>
        <li className="capacita__nodo">
          <span className="capacita__icona" aria-hidden="true">
            <IconaMicrofono />
          </span>
          <span className="capacita__numero">{format.number(parlano)}</span>
          <span className="capacita__etichetta">{t('senders')}</span>
          <span className="capacita__dettaglio">
            {t('perPersonUp', { value: mbps(stime.moderatorUpMbps) })}
          </span>
        </li>
        <li
          className={`capacita__nodo capacita__nodo--ponte${atCeiling ? ' capacita__nodo--limite' : ''}`}
        >
          <span className="capacita__icona" aria-hidden="true">
            <Icon icon="it-exchange-circle" size="sm" />
          </span>
          <span className="capacita__numero">{format.number(ponti)}</span>
          <span className="capacita__etichetta">{t(ponti === 1 ? 'pod' : 'pods')}</span>
          <span className="capacita__dettaglio">
            {t('bridgeDetail', {
              max: sizingConfig.maxReplicas,
              ram: format.number(stime.jvbRamMB / 1024, { maximumFractionDigits: 1 }),
            })}
          </span>
        </li>
        <li className="capacita__nodo">
          <span className="capacita__icona" aria-hidden="true">
            <Icon icon="it-hearing" size="sm" />
          </span>
          <span className="capacita__numero">{format.number(ascoltano)}</span>
          <span className="capacita__etichetta">{t('receivers')}</span>
          <span className="capacita__dettaglio">
            {t('perPersonDown', { value: mbps(stime.participantDownMbps) })}
          </span>
        </li>
      </ol>

      {/* Quanto dei ponti accesi si usa: chi parla pesa molto piu' di chi ascolta. */}
      <div className="capacita__carico">
        <div className="capacita__carico-testa">
          <span id={`${id}-carico`}>{t('loadLabel', { count: ponti })}</span>
          <strong className={oltre ? 'capacita__oltre' : undefined}>{pct(carico)}</strong>
        </div>
        <div
          className="capacita__barra"
          role="img"
          aria-labelledby={`${id}-carico`}
          aria-describedby={`${id}-legenda`}
        >
          <span
            className="capacita__parte capacita__parte--parlano"
            style={{ width: `${quotaParlano * riduci}%` }}
          />
          <span
            className="capacita__parte capacita__parte--ascolto"
            style={{ width: `${quotaAscolto * riduci}%` }}
          />
        </div>
        <ul id={`${id}-legenda`} className="capacita__legenda">
          <li>
            <span
              className="capacita__campione capacita__campione--parlano"
              aria-hidden="true"
            />
            {t('loadSenders', { pct: pct(quotaParlano) })}
          </li>
          <li>
            <span
              className="capacita__campione capacita__campione--ascolto"
              aria-hidden="true"
            />
            {t('loadReceivers', { pct: pct(quotaAscolto) })}
          </li>
          <li>
            <span className="capacita__campione" aria-hidden="true" />
            {oltre ? t('loadOver') : t('loadFree', { pct: pct(100 - carico) })}
          </li>
        </ul>
      </div>

      <dl className="capacita__risorse">
        <div>
          <dt>{t('totalBandwidth')}</dt>
          <dd>{mbps(stime.totalMbps)}</dd>
        </div>
        <div>
          <dt>{t('duration')}</dt>
          <dd>
            {minuti === 0
              ? t('durationHours', { hours: ore })
              : ore === 0
                ? t('durationMinutes', { minutes: minuti })
                : t('durationValue', { hours: ore, minutes: minuti })}
          </dd>
        </div>
        {recordingEnabled && (
          <div>
            <dt>{t('storage')}</dt>
            <dd>
              {t('gigabytes', {
                value: format.number(stime.storageGB, { maximumFractionDigits: 1 }),
              })}
            </dd>
          </div>
        )}
      </dl>

      {shouldWarnInherited && (
        <div className="alert alert-warning mt-3 mb-0" role="note">
          {t('warnInherited', {
            participants: maxParticipants,
            defaultPct: defaultSenderRatioPct,
          })}
        </div>
      )}
      {atCeiling && (
        <div className="alert alert-warning mt-3 mb-0" role="note">
          {t('warnCeiling', { max: sizingConfig.maxReplicas })}
        </div>
      )}
    </div>
  );
}
