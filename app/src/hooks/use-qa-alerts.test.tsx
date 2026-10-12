import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { SWRConfig, useSWRConfig, type ScopedMutator } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { CHAT_NOTIFY_STORAGE_KEY } from '@/lib/chat/notify-prefs';
import { rememberMyQuestion, type QaListItem } from '@/lib/qa/alerts';

import { isPanelKey } from './use-live-state';

import { useQaAlerts } from './use-qa-alerts';

/**
 * Gli avvisi del Q&A mentre si guarda altro: il pallino sulla scheda, e il
 * suono per chi e' riguardato (chi conduce per una domanda nuova, chi ha
 * chiesto per la risposta alla propria). «Silenzioso» toglie il suono, non
 * il pallino.
 */

const { chime } = vi.hoisted(() => ({ chime: vi.fn() }));
vi.mock('@/lib/chat/chime', () => ({ playChatChime: chime }));

const SLUG = 'evento-di-prova';
const URL_LETTURA = `/api/events/${SLUG}/questions`;
let elenco: QaListItem[];
let container: HTMLDivElement;
let root: Root;
let pallino: boolean;
// La cache e' isolata per ogni prova: si rinfresca da dentro, come il canale.
let rinfresca: ScopedMutator;

function Sonda(props: { isModerator: boolean; onScreen: boolean }) {
  rinfresca = useSWRConfig().mutate;
  pallino = useQaAlerts({
    eventSlug: SLUG,
    token: '',
    isModerator: props.isModerator,
    enabled: true,
    onScreen: props.onScreen,
  }).hasNews;
  return null;
}

const domanda = (id: string, extra: Partial<QaListItem> = {}): QaListItem => ({
  id,
  authorName: 'Ospite A',
  text: `Domanda ${id}`,
  status: 'PENDING',
  answerText: null,
  ...extra,
});

async function attendi() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(props: { isModerator: boolean; onScreen?: boolean }) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <Sonda isModerator={props.isModerator} onScreen={props.onScreen ?? false} />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
  });
  await attendi();
}

/** L'elenco cambia e arriva la lettura successiva degli avvisi. */
async function cambia(nuovo: QaListItem[]) {
  elenco = nuovo;
  await act(async () => {
    await rinfresca((k) => Array.isArray(k) && k[0] === 'qa-alerts');
  });
  await attendi();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  chime.mockClear();
  window.localStorage.clear();
  elenco = [domanda('a')];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ questions: elenco }), { status: 200 })),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useQaAlerts', () => {
  it('legge l\'elenco delle domande, ma un avviso del canale non lo fa rileggere', async () => {
    await render({ isModerator: true });
    const letture = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(letture[0]?.[0]).toBe(URL_LETTURA);
    const prima = letture.length;

    // Cio' che fa la sala a un avviso `qa` (un voto, una domanda): rilegge
    // le chiavi del pannello. Questa lettura ha la sua cadenza.
    await act(async () => {
      await rinfresca((k) => isPanelKey(k, SLUG, 'qa'));
    });
    await attendi();
    expect(letture.length).toBe(prima);
  });

  it('chi conduce: una domanda nuova accende il pallino e suona', async () => {
    await render({ isModerator: true });
    expect(pallino).toBe(false);

    await cambia([domanda('a'), domanda('b')]);

    expect(pallino).toBe(true);
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('chi ha chiesto: la risposta alla propria domanda suona, quella altrui no', async () => {
    rememberMyQuestion(SLUG, 'a');
    elenco = [domanda('a'), domanda('b')];
    await render({ isModerator: false });

    await cambia([domanda('a'), domanda('b', { answerText: 'Sì.' })]);
    expect(pallino).toBe(true);
    expect(chime).not.toHaveBeenCalled();

    await cambia([domanda('a', { answerText: 'Entro giugno.' }), domanda('b', { answerText: 'Sì.' })]);
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('con la scheda in vista niente pallino', async () => {
    await render({ isModerator: true, onScreen: true });
    await cambia([domanda('a'), domanda('b')]);
    expect(pallino).toBe(false);
  });

  it('in silenzioso resta il pallino ma non il suono', async () => {
    window.localStorage.setItem(
      CHAT_NOTIFY_STORAGE_KEY,
      JSON.stringify({ mode: 'off', sound: true, desktop: true }),
    );
    await render({ isModerator: true });
    await cambia([domanda('a'), domanda('b')]);

    expect(pallino).toBe(true);
    expect(chime).not.toHaveBeenCalled();
  });
});
