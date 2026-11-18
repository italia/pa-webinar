// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { regolaConsenso, type PartecipantiNelVideo } from '@/lib/live/consent-rule';
import { consensiRichiesti } from '@/lib/registration/consents';

/**
 * Cosa succede con il consenso alla registrazione in questo evento, in un
 * diagramma che chi organizza apre quando serve: si mostra solo su un evento che
 * registra, dove si puo' registrare. Esce dalla stessa regola della
 * rotta del token e della sala (lib/live/consent-rule), con le scelte fatte fin
 * qui: quello che mostra e' quello che succedera'. I rami sono di chi partecipa,
 * come l'installazione lo tiene nel video (`partecipanti`): solo la voce con il
 * consenso, mai nemmeno quella, o con nome, voce e immagine dove non puo' tenerlo
 * fuori. Chi conduce e' sempre nel video, e lo dice una nota.
 */
export default function ConsentDiagram({
  multitrackRecordingEnabled,
  captionsTranscript,
  trascrizioneVideo,
  participantsCanUnmute,
  participantsCanStartVideo,
  participantsCanShareScreen,
  partecipanti,
}: {
  multitrackRecordingEnabled: boolean;
  captionsTranscript: boolean;
  /** La pipeline AI trascrive il video (`trascrizioneDalVideo`). */
  trascrizioneVideo?: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  /** Come compaiono nel video i partecipanti (lib/recording/availability). */
  partecipanti: PartecipantiNelVideo;
}) {
  const t = useTranslations('admin.wizard.consentMap');
  const id = useId();
  const [aperto, setAperto] = useState(false);
  const formato = {
    recordingEnabled: true,
    multitrackRecordingEnabled,
    captionsTranscript,
    trascrizioneVideo,
    participantsCanUnmute,
    participantsCanStartVideo,
    participantsCanShareScreen,
  };
  const regola = regolaConsenso(formato, true, partecipanti);
  const consensi = consensiRichiesti(formato, partecipanti);
  // Senza un video completo si registra solo la traccia per persona, e la decide
  // il consenso alla trascrizione. Senza tracce non resta niente da dire.
  const senzaVideo = partecipanti === 'assente';
  if (senzaVideo && !consensi.tracce) return null;
  // Chi partecipa non entra mai nel video ('esclusi'): come senza video, decide
  // solo il consenso alla trascrizione, e senza tracce non c'e' una domanda.
  const soloTracce = senzaVideo || regola.voceDallaTrascrizione;
  const visibili = partecipanti === 'visibili';
  // Dove la voce resta nel video e l'evento avvisa soltanto, nessuno sceglie.
  const conRami = soloTracce ? consensi.tracce : !visibili || regola.richiesto;
  const puoRestareFuori = partecipanti === 'solo-voce';
  const note = [
    regola.soloAscolto && t('fixedVoice'),
    !soloTracce && !conRami && t('fixedNotice'),
    !regola.soloAscolto && conRami && t('othersSame'),
    puoRestareFuori && !regola.richiesto && t('audienceNotice'),
    // Chi conduce e' nel video sempre, senza casella (lib/live/consent-rule).
    !senzaVideo && t('hostsAlways'),
    regola.voceDallaTrascrizione && t('hostsOnly'),
    puoRestareFuori && t('trace'),
    conRami && t('anytime'),
    !soloTracce && consensi.tracce && t('transcription'),
  ].filter((nota): nota is string => !!nota);
  const fuori = regola.soloAscolto
    ? t('fixedNotRecorded')
    : soloTracce
      ? t('notRecordedVoice')
      : t('notRecorded');
  const dentro = soloTracce ? t('recordedVoice') : visibili ? t('recordedVisible') : t('recordedFull');

  return (
    <div className="mappa-consensi">
      <button
        type="button"
        className="btn btn-link btn-sm p-0 mappa-consensi__apri"
        aria-expanded={aperto}
        aria-controls={id}
        onClick={() => setAperto(!aperto)}
      >
        <Icon icon={aperto ? 'it-collapse' : 'it-expand'} size="sm" />
        {aperto ? t('hide') : t('show')}
      </button>
      <div id={id} hidden={!aperto}>
        <figure className="mappa-consensi__figura mb-0">
          <figcaption className="mappa-consensi__titolo">{t('title')}</figcaption>
          {conRami && (
            <div className="mappa-consensi__albero">
              <p className="mappa-consensi__radice mb-0">
                <strong>{t('person')}</strong>
                <span>{soloTracce ? t('questionTranscription') : t('question')}</span>
              </p>
              <ul className="mappa-consensi__rami">
                <Ramo
                  esito="si"
                  titolo={t('yes')}
                  sala={t('roomSame')}
                  registrazione={dentro}
                  etichette={{ sala: t('room'), registrazione: t('recording') }}
                />
                <Ramo
                  esito="no"
                  titolo={t('no')}
                  sala={regola.soloAscolto ? t('roomListenOnly') : t('roomSame')}
                  registrazione={fuori}
                  etichette={{ sala: t('room'), registrazione: t('recording') }}
                />
              </ul>
            </div>
          )}
          <ul className="mappa-consensi__note">
            {note.map((nota) => (
              <li key={nota}>{nota}</li>
            ))}
          </ul>
        </figure>
      </div>
    </div>
  );
}

function Ramo({
  esito,
  titolo,
  sala,
  registrazione,
  etichette,
}: {
  esito: 'si' | 'no';
  titolo: string;
  sala: string;
  registrazione: string;
  etichette: { sala: string; registrazione: string };
}) {
  return (
    <li className={`mappa-consensi__ramo is-${esito}`}>
      <span className="mappa-consensi__esito">
        <Icon icon={esito === 'si' ? 'it-check-circle' : 'it-close-circle'} size="sm" />
        {titolo}
      </span>
      <dl className="mappa-consensi__effetti mb-0">
        <div>
          <dt>{etichette.sala}</dt>
          <dd>{sala}</dd>
        </div>
        <div>
          <dt>{etichette.registrazione}</dt>
          <dd>{registrazione}</dd>
        </div>
      </dl>
    </li>
  );
}
