// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { useId } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import type { ChiNonAcconsente, SchedaPrivacy } from '@/lib/events/privacy-sheet';

/**
 * La scheda privacy di un evento, con gli stessi fatti nel modulo d'iscrizione e
 * in sala d'attesa. Riceve la scheda gia' calcolata sul server
 * (lib/events/privacy-sheet) e sceglie solo i testi: una riga senza frasi non
 * compare.
 *
 * `testoIa` e' il testo che l'amministrazione ha scritto per questa lingua: dice
 * come si elabora la registrazione al posto delle frasi su sintesi, traduzione e
 * doppiaggio. Restano a parte il resoconto, che parte anche da sondaggi e domande
 * pubblicate, e cio' che chi organizza puo' chiedere dopo l'evento.
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

/** Cio' che chi non acconsente legge in sala d'attesa, se conduce (`schedaInSala`). */
function chiConduceNonAcconsente(scheda: SchedaPrivacy): ChiNonAcconsente | null {
  if (scheda.registrazione.conduceSempre) return null;
  switch (scheda.registrazione.chiNonAcconsente) {
    case null:
      return null;
    // Dove la voce non si toglie dal video, chi conduce resta ripreso.
    case 'soloAscolto':
    case 'avviso':
      return 'conduceRipreso';
    default:
      return 'restaFuori';
  }
}

const TESTO_TRACCE = {
  cancellate: 'transcript.tracks',
  conservate: 'transcript.tracksRetained',
} as const;

const TESTO_DOMANDE = {
  soloTesto: 'chat.questionsText',
  nonPubblicate: 'chat.questionsNone',
} as const;

/**
 * La scheda come la legge chi e' in sala d'attesa. Sottotitoli, chat e Q&A sono
 * le funzioni che chi modera accende e spegne dal vivo: la sala riceve il valore
 * di adesso, il resto della scheda non cambia a sala aperta. Il testo dei
 * sottotitoli diventa trascrizione solo se i sottotitoli ci sono.
 *
 * La rubrica si sceglie solo nel modulo d'iscrizione: la sala non ha quella
 * casella, quindi non la promette.
 *
 * La scheda sul server e' una sola per evento e parla a chi partecipa. Chi conduce
 * o interviene entra con il proprio nome e con microfono e videocamera: la sala
 * gli dice cio' che vale per lui.
 */
export function schedaInSala(
  scheda: SchedaPrivacy,
  adesso: {
    sottotitoli: boolean;
    chat: boolean;
    domande: boolean;
    conduce?: boolean;
    /** Questa persona ha dato il consenso alla trascrizione. */
    trascrizioneData?: boolean;
  }
): SchedaPrivacy {
  const testoSottotitoli = adesso.sottotitoli && scheda.sottotitoli.testoConservato;
  return {
    ...scheda,
    ...(adesso.conduce
      ? {
          pseudonimi: false,
          registrazione: {
            ...scheda.registrazione,
            chiNonAcconsente: chiConduceNonAcconsente(scheda),
          },
        }
      : {}),
    sottotitoli: { ...scheda.sottotitoli, attivi: adesso.sottotitoli },
    trascrizione: {
      ...scheda.trascrizione,
      chiesta: scheda.trascrizione.chiesta || testoSottotitoli || !!adesso.trascrizioneData,
      sottotitoli: testoSottotitoli,
    },
    chat: { ...scheda.chat, attiva: adesso.chat, domandeAttive: adesso.domande },
    rubrica: null,
  };
}

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
  const tConsenso = useTranslations('gdpr.consent');
  const tSala = useTranslations('waiting');
  const titolo = useId();

  const { registrazione, trascrizione, sottotitoli, ia, conservazione, rubrica } = scheda;

  const frasiRegistrazione = [t(TESTO_MODO[registrazione.modo])];
  if (registrazione.destinazione) {
    frasiRegistrazione.push(t(TESTO_DESTINAZIONE[registrazione.destinazione]));
  }
  if (registrazione.chiNonAcconsente === 'conduceRipreso') {
    frasiRegistrazione.push(tConsenso('recordingOptionalHost'));
  } else if (registrazione.chiNonAcconsente) {
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
    frasiIa.push(t('ai.accuracy'));
  }

  const frasiChat: string[] = [];
  if (scheda.chat.attiva) frasiChat.push(t('chat.messages'));
  if (scheda.chat.domandeAttive) frasiChat.push(t(TESTO_DOMANDE[scheda.chat.esitoDomande]));

  // La registrazione non segue i dati delle persone: resta finche' chi organizza
  // non la cancella, o per i giorni scelti.
  const frasiConservazione = [t('retention.data', { days: conservazione.giorniDati })];
  const registrazioneTenuta = conservazione.registrazione;
  if (registrazioneTenuta) {
    const { giorni, video } = registrazioneTenuta;
    frasiConservazione.push(
      giorni === null
        ? t(video ? 'retention.recordingKept' : 'retention.transcriptKept')
        : t(video ? 'retention.recordingDays' : 'retention.transcriptDays', { days: giorni })
    );
  }

  // Il nome nella trascrizione si dice dove quel consenso esiste.
  const frasiNome = scheda.pseudonimi
    ? [t('name.pseudonym'), ...(trascrizione.chiesta ? [t('name.pseudonymTranscript')] : [])]
    : [t('name.real')];

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
          frasi={frasiNome}
        />
        <Fatto icona="it-comment" etichetta={t('chat.label')} frasi={frasiChat} />
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
