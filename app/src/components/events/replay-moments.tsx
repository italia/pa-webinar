'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import type { VideoPlayerHandle } from '@/components/events/video-player';
import type { ReplayMoment } from '@/lib/replay/moments';
import { formatVideoTime } from '@/lib/utils/video-time';

/**
 * I momenti della diretta sul tempo del video (lib/replay/moments): argomenti,
 * presentazioni, sondaggi con i risultati, domande trattate, risposte di «In
 * una parola». Il momento in corso nel video e' evidenziato; un clic porta al
 * suo punto.
 */
export default function ReplayMoments({
  moments,
  playerRef,
}: {
  moments: ReplayMoment[];
  playerRef: RefObject<VideoPlayerHandle | null>;
}) {
  const t = useTranslations('postEvent.moments');
  // Il momento in corso: l'ultimo cominciato. Si aggiorna solo quando cambia,
  // non a ogni avanzamento del video.
  const [inCorso, setInCorso] = useState(-1);

  useEffect(() => {
    const video = playerRef.current?.videoEl();
    if (!video) return;
    const aggiorna = () => {
      const ora = video.currentTime;
      let indice = -1;
      for (let i = 0; i < moments.length; i += 1) {
        if (moments[i]!.offsetSec <= ora) indice = i;
        else break;
      }
      setInCorso((prima) => (prima === indice ? prima : indice));
    };
    aggiorna();
    video.addEventListener('timeupdate', aggiorna);
    video.addEventListener('seeked', aggiorna);
    return () => {
      video.removeEventListener('timeupdate', aggiorna);
      video.removeEventListener('seeked', aggiorna);
    };
  }, [playerRef, moments]);

  return (
    <ol className="replay-moments" aria-label={t('title')}>
      {moments.map((m, i) => (
        <li
          key={`${m.kind}-${m.offsetSec}-${i}`}
          className={`replay-moments__voce replay-moments__voce--${m.kind}${i === inCorso ? ' is-current' : ''}`}
          aria-current={i === inCorso ? 'true' : undefined}
        >
          <button
            type="button"
            className="replay-moments__tempo"
            onClick={() => playerRef.current?.seekTo(m.offsetSec)}
            aria-label={t('seekTo', { time: formatVideoTime(m.offsetSec) })}
          >
            {formatVideoTime(m.offsetSec)}
          </button>
          <div className="replay-moments__corpo">
            <span className="replay-moments__tipo">
              <Icon icon={ICONA[m.kind]} size="xs" />
              {t(`kind.${m.kind}`)}
            </span>
            <Contenuto moment={m} />
          </div>
        </li>
      ))}
    </ol>
  );
}

const ICONA: Record<ReplayMoment['kind'], string> = {
  topic: 'it-list',
  presentation: 'it-file',
  poll: 'it-chart-line',
  question: 'it-help-circle',
  wordcloud: 'it-comment',
};

function Contenuto({ moment }: { moment: ReplayMoment }) {
  const t = useTranslations('postEvent.moments');
  switch (moment.kind) {
    case 'topic':
    case 'presentation':
      return <p className="replay-moments__titolo">{moment.title}</p>;
    case 'question':
      return (
        <>
          <p className="replay-moments__titolo">{moment.question}</p>
          {moment.answer && (
            <p className="replay-moments__risposta">
              <strong>{t('answer')}</strong> {moment.answer}
            </p>
          )}
        </>
      );
    case 'poll': {
      const massimo = Math.max(1, ...moment.results.map((r) => r.count));
      return (
        <>
          <p className="replay-moments__titolo">{moment.question}</p>
          <ul className="replay-moments__risultati">
            {moment.results.map((r, i) => (
              <li key={i}>
                <span className="replay-moments__opzione">{r.option}</span>
                <span className="replay-moments__barra" aria-hidden="true">
                  <span style={{ width: `${(r.count / massimo) * 100}%` }} />
                </span>
                <span className="replay-moments__conto">{r.count}</span>
              </li>
            ))}
          </ul>
          <p className="replay-moments__nota">
            {t('votes', { count: moment.totalVotes })}
          </p>
        </>
      );
    }
    case 'wordcloud':
      return (
        <>
          {moment.prompt && <p className="replay-moments__titolo">{moment.prompt}</p>}
          <p className="replay-moments__parole">
            {moment.words.map((w) => (
              <span key={w.word}>
                {w.word} <small>{w.count}</small>
              </span>
            ))}
          </p>
        </>
      );
  }
}
