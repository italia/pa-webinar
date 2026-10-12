'use client';

/**
 * Avvisi del pannello Domande e risposte mentre si guarda altro (la chat, la
 * conferenza, un'altra scheda del browser).
 *
 * Legge l'elenco a cadenza fissa, con una chiave SWR sua: gli avvisi del
 * canale della sala rinfrescano il pannello aperto, non questa lettura.
 * Altrimenti ogni voto in un'aula piena farebbe rileggere l'elenco intero a
 * tutti, anche a chi guarda altro. Fra una lettura e l'altra (lib/qa/alerts):
 *   - qualcosa di nuovo (una domanda, una risposta) accende il pallino della
 *     scheda finche' la scheda non e' sotto gli occhi;
 *   - chi conduce sente il suono e riceve la notifica per una domanda nuova;
 *   - chi ha fatto una domanda li riceve quando la sua domanda ha risposta.
 * Suono e notifica seguono la campanella della chat (lib/chat/notify-prefs):
 * «Silenzioso» li spegne anche qui.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { questionsReadUrl } from '@/components/qa/question-request';
import { playChatChime } from '@/lib/chat/chime';
import { showDesktopNotification } from '@/lib/chat/desktop-notification';
import {
  CHAT_NOTIFY_STORAGE_KEY,
  chatAlertFor,
  parseChatNotifyPrefs,
} from '@/lib/chat/notify-prefs';
import {
  qaChanges,
  qaSeen,
  readMyQuestions,
  type QaListItem,
  type QaSeen,
} from '@/lib/qa/alerts';

/**
 * Ogni quanto si rilegge. Chi conduce deve accorgersi presto di una domanda,
 * ed e' una manciata di persone; per il pubblico il pallino puo' arrivare con
 * calma.
 */
const POLL_MODERATOR_MS = 5_000;
const POLL_AUDIENCE_MS = 15_000;

/** Prima parte della chiave SWR: diversa dall'URL, il canale non la riconosce. */
const KEY_TAG = 'qa-alerts';

export function useQaAlerts({
  eventSlug,
  token,
  voterGuestId,
  isModerator,
  enabled,
  onScreen,
}: {
  eventSlug: string;
  token: string;
  voterGuestId?: string;
  isModerator: boolean;
  /** Il Q&A e' acceso per questo evento. */
  enabled: boolean;
  /** La scheda del Q&A e' quella in vista. */
  onScreen: boolean;
}): { hasNews: boolean } {
  const t = useTranslations('qa');
  const key = enabled
    ? ([KEY_TAG, questionsReadUrl(`/api/events/${eventSlug}/questions`, { voterGuestId }), token] as const)
    : null;
  const { data } = useSWR<{ questions: QaListItem[] }>(
    key,
    async ([, url, tok]: readonly [string, string, string]) => {
      // `Bearer ` vuoto e' l'ospite, come nel pannello.
      const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    {
      refreshInterval: isModerator ? POLL_MODERATOR_MS : POLL_AUDIENCE_MS,
      revalidateOnFocus: false,
    },
  );

  const seenRef = useRef<QaSeen | null>(null);
  const onScreenRef = useRef(onScreen);
  onScreenRef.current = onScreen;
  const [hasNews, setHasNews] = useState(false);

  useEffect(() => {
    if (onScreen) setHasNews(false);
  }, [onScreen]);

  useEffect(() => {
    const questions = data?.questions;
    if (!questions) return;
    const { newQuestions, newlyAnswered } = qaChanges(seenRef.current, questions);
    seenRef.current = qaSeen(questions);
    if (newQuestions.length === 0 && newlyAnswered.length === 0) return;
    if (!onScreenRef.current) setHasNews(true);

    // Che cosa riguarda chi guarda: per chi conduce le domande nuove, per gli
    // altri la risposta a una delle proprie.
    let avviso: { title: string; body: string } | null = null;
    if (isModerator && newQuestions.length > 0) {
      const q = newQuestions[newQuestions.length - 1]!;
      avviso = { title: t('notifyNewQuestionTitle', { name: q.authorName }), body: q.text };
    } else if (!isModerator && newlyAnswered.length > 0) {
      const mie = readMyQuestions(eventSlug);
      const q = newlyAnswered.find((x) => mie.has(x.id));
      if (q) avviso = { title: t('notifyAnsweredTitle'), body: q.answerText || q.text };
    }
    if (!avviso || typeof window === 'undefined') return;

    let prefs = parseChatNotifyPrefs(null);
    try {
      prefs = parseChatNotifyPrefs(window.localStorage.getItem(CHAT_NOTIFY_STORAGE_KEY));
    } catch {
      // Storage non disponibile: valgono le preferenze predefinite.
    }
    // Riguarda chi guarda, come una menzione in chat.
    const azione = chatAlertFor({
      prefs,
      own: false,
      mentionsMe: true,
      repliesToMe: false,
      onScreen: onScreenRef.current,
      pageVisible: document.visibilityState === 'visible',
      pageFocused: document.hasFocus(),
    });
    if (azione.sound) playChatChime();
    if (azione.desktop) showDesktopNotification(avviso.title, avviso.body, 'pa-webinar-qa');
  }, [data, isModerator, eventSlug, t]);

  return { hasNews: hasNews && !onScreen };
}
