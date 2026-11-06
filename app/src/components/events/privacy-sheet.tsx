// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { useId } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import type { SchedaPrivacy } from '@/lib/events/privacy-sheet';

/**
 * La scheda privacy di un evento, con gli stessi fatti nel modulo d'iscrizione e
 * in sala d'attesa. Riceve la scheda gia' calcolata sul server
 * (lib/events/privacy-sheet) e sceglie solo i testi: una riga senza frasi non
 * compare.
 *
 * `testoIa` e' il testo che l'amministrazione ha scritto per questa lingua: dice
 * come si elabora la registrazione al posto delle frasi su sintesi, traduzione e
 * doppiaggio. Restano a parte il resoconto, che parte anche da chat, domande e
 * sondaggi, e cio' che chi organizza puo' chiedere dopo l'evento.
 */
const TESTO_MODO = {
  nessuna: 'recording.none',
  soloTracce: 'recording.tracksOnly',
  manuale: 'recording.manual',
  automatica: 'recording.auto',
} as const;

const TESTO_DESTINAZIONE = {
  PUBLIC: 'recording.destinationPublic',
  REGISTRANTS: 'recording.destinationReserved',
  nonDichiarata: 'recording.destinationUnset',
} as const;

const TESTO_CHI_NON_ACCONSENTE = {
  restaFuori: 'recording.refuseOut',
  soloAscolto: 'recording.refuseListenOnly',
  avviso: 'recording.audienceNotice',
  avvisoVoce: 'recording.audienceNoticeVoice',
} as const;

const TESTO_TRACCE = {
  cancellate: 'transcript.tracks',
  conservate: 'transcript.tracksRetained',
} as const;

function Fatto({
  icona,
  etichetta,
  frasi,
}: {
  icona: string;
  etichetta: string;
  frasi: string[];
}) {
  if (frasi.length === 0) return null;
  return (
    <li className="wr-fact">
      <span className="wr-fact__icon" aria-hidden="true">
        <Icon icon={icona} size="sm" color="primary" />
      </span>
      <span className="wr-fact__body">
        <span className="wr-fact__label">{etichetta}</span>
        {frasi.map((frase) => (
          <span className="wr-fact__value" key={frase}>
            {frase}
          </span>
        ))}
      </span>
    </li>
  );
}

export function PrivacySheet({
  scheda,
  testoIa,
}: {
  scheda: SchedaPrivacy;
  testoIa?: string | null;
}) {
  const t = useTranslations('gdpr.sheet');
  const tSala = useTranslations('waiting');
  const titolo = useId();

  const { registrazione, trascrizione, sottotitoli, ia, conservazione, rubrica } = scheda;

  const frasiRegistrazione = [t(TESTO_MODO[registrazione.modo])];
  if (registrazione.destinazione) {
    frasiRegistrazione.push(t(TESTO_DESTINAZIONE[registrazione.destinazione]));
  }
  if (registrazione.chiNonAcconsente) {
    frasiRegistrazione.push(t(TESTO_CHI_NON_ACCONSENTE[registrazione.chiNonAcconsente]));
  }
  if (registrazione.conduceSempre) frasiRegistrazione.push(t('recording.hostsAlways'));

  const frasiTrascrizione: string[] = [];
  if (trascrizione.sottotitoli) frasiTrascrizione.push(t('transcript.captions'));
  if (trascrizione.tracce) frasiTrascrizione.push(t(TESTO_TRACCE[trascrizione.tracce]));
  if (trascrizione.dalVideo) frasiTrascrizione.push(t('transcript.fromVideo'));

  const frasiIa: string[] = [];
  if (ia) {
    const testo = testoIa?.trim();
    const elaborazione =
      ia.sintesi ||
      ia.traduzione ||
      ia.doppiaggio ||
      ia.elaborabileDopo ||
      !!trascrizione.tracce ||
      trascrizione.dalVideo;
    if (testo && elaborazione) {
      frasiIa.push(testo);
    } else if (!testo) {
      if (ia.sintesi) frasiIa.push(t('ai.summary'));
      if (ia.traduzione) frasiIa.push(t('ai.translation'));
      if (ia.doppiaggio) frasiIa.push(t('ai.dubbing'));
    }
    if (ia.elaborabileDopo) frasiIa.push(t('ai.onRequest'));
    frasiIa.push(t('ai.report'));
  }

  const frasiConservazione = [t('retention.data', { days: conservazione.giorniDati })];
  if (conservazione.video) {
    const giorni = conservazione.video.giorniDopoPubblicazione;
    frasiConservazione.push(t('retention.videoUnpublished'));
    frasiConservazione.push(
      giorni === null
        ? t('retention.videoPublishedOpen')
        : t('retention.videoPublishedDays', { days: giorni })
    );
  }

  return (
    <section className="wr-summary" aria-labelledby={titolo}>
      <h2 className="wr-section-title" id={titolo}>
        {t('title')}
      </h2>
      <p className="small mb-3">{t('intro')}</p>
      <ul className="wr-facts wr-facts--frasi">
        <Fatto
          icona="it-video"
          etichetta={t('recording.label')}
          frasi={frasiRegistrazione}
        />
        <Fatto
          icona="it-file"
          etichetta={t('transcript.label')}
          frasi={frasiTrascrizione}
        />
        {sottotitoli.attivi && (
          <Fatto
            icona="it-hearing"
            etichetta={t('captions.label')}
            frasi={[
              sottotitoli.testoConservato
                ? tSala('captionsNoticeTranscript')
                : tSala('captionsNotice'),
            ]}
          />
        )}
        <Fatto icona="it-software" etichetta={t('ai.label')} frasi={frasiIa} />
        <Fatto
          icona="it-list"
          etichetta={t('list.label')}
          frasi={[t(scheda.elencoVisibile ? 'list.visible' : 'list.hidden')]}
        />
        <Fatto
          icona="it-user"
          etichetta={t('name.label')}
          frasi={[t(scheda.pseudonimi ? 'name.pseudonym' : 'name.real')]}
        />
        <Fatto
          icona="it-clock"
          etichetta={t('retention.label')}
          frasi={frasiConservazione}
        />
        {rubrica && (
          <Fatto
            icona="it-mail"
            etichetta={t('addressBook.label')}
            frasi={[t('addressBook.offered', { months: rubrica.mesi })]}
          />
        )}
      </ul>
    </section>
  );
}
