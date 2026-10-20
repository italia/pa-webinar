import type { ReactNode } from 'react';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LocaleTabBar from '@/components/ui/locale-tab-bar';
import messages from '@/i18n/messages/it.json';
import type { StatoTestiEvento } from '@/lib/text-translation/auto';
import type { StatoScheda } from '@/lib/text-translation/stato-lingue';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  percorso: (p: string) => p,
}));

import EventTextTranslationStatus from '../event-text-translation-status';

import {
  PannelloLingua,
  RigaLingue,
  schedeDelleLingue,
  useAspettoSchede,
  useLingueEvento,
} from './text-translation';

/**
 * Le lingue dell'evento nel passo «Evento»: le schede con il loro stato
 * scritto, la riga delle lingue, l'avviso dentro la scheda, e nessuna
 * promessa di traduzione dove il motore non c'e'.
 */

let container: HTMLDivElement;
let root: Root;
const ID = '11111111-2222-4333-8444-555555555555';
const tt = messages.admin.textTranslation;

function mount(node: ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        {node}
      </NextIntlClientProvider>
    );
  });
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error('elemento assente');
  act(() => {
    (el as HTMLElement).click();
  });
}

function bottone(testo: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find(
    (x) => x.textContent?.trim() === testo
  );
  if (!b) throw new Error(`nessun pulsante «${testo}»`);
  return b;
}

async function attendi() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom: il fuoco dopo un riquadro di disegno.
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    fn(0);
    return 0;
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('schedeDelleLingue', () => {
  it('la principale, le lingue dell evento attive sul sito, e quelle del sito con un testo', () => {
    expect(
      schedeDelleLingue({
        principale: 'it',
        attive: ['it', 'en', 'fr', 'de'],
        lingueEvento: ['fr', 'uk', 'en'],
        titoli: { de: 'Titel', es: 'Título' },
        descrizioni: {},
      })
    ).toEqual(['it', 'fr', 'en', 'de']);
  });
});

describe('barra delle lingue', () => {
  function Barra({ conStati }: { conStati: boolean }) {
    const [attiva, setAttiva] = useState('it');
    const stati: Record<string, StatoScheda> = {
      it: 'principale',
      en: 'machine',
      de: 'onSave',
    };
    const aspetto = useAspettoSchede(stati);
    return (
      <>
        <LocaleTabBar
          enabledLocales={['it', 'en', 'de']}
          defaultLocale="it"
          activeLocale={attiva}
          onSelectLocale={setAttiva}
          filledLocales={['it', 'en']}
          ariaLabel={conStati ? tt.tabsLabel : undefined}
          panelId={conStati ? 'pannello' : undefined}
          idPrefix={conStati ? 'scheda' : undefined}
          stati={conStati ? aspetto : undefined}
        />
        <p data-testid="attiva">{attiva}</p>
      </>
    );
  }
  const schede = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const premi = (el: HTMLElement, key: string) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });

  it('il modello delle schede: nome, pannello, una sola raggiungibile con Tab, frecce, Inizio e Fine', () => {
    mount(<Barra conStati />);
    expect(container.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe(
      tt.tabsLabel
    );
    const [it, en, de] = schede();
    expect(it!.getAttribute('aria-controls')).toBe('pannello');
    expect(en!.id).toBe('scheda-en');
    expect(schede().map((s) => s.tabIndex)).toEqual([0, -1, -1]);
    // Il nome accessibile dice lo stato, a parole.
    expect(en!.textContent).toBe(`English, ${tt.state.machine}`);
    expect(de!.textContent).toBe(`Deutsch, ${tt.state.onSave}`);
    expect(en!.querySelector('[lang="en"]')).not.toBeNull();

    premi(it!, 'ArrowRight');
    expect(container.querySelector('[data-testid="attiva"]')!.textContent).toBe('en');
    expect(document.activeElement).toBe(schede()[1]);
    expect(schede().map((s) => s.tabIndex)).toEqual([-1, 0, -1]);
    premi(schede()[1]!, 'End');
    expect(container.querySelector('[data-testid="attiva"]')!.textContent).toBe('de');
    premi(schede()[2]!, 'ArrowRight');
    expect(container.querySelector('[data-testid="attiva"]')!.textContent).toBe('it');
    premi(schede()[0]!, 'ArrowLeft');
    expect(container.querySelector('[data-testid="attiva"]')!.textContent).toBe('de');
    premi(schede()[2]!, 'Home');
    expect(container.querySelector('[data-testid="attiva"]')!.textContent).toBe('it');
  });

  it('senza stati resta com era (il motto del sito): asterisco e punto delle compilate', () => {
    mount(<Barra conStati={false} />);
    const [it, en, de] = schede();
    expect(it!.textContent).toBe('Italiano*');
    expect(en!.textContent).toBe('English●');
    expect(de!.textContent).toBe('Deutsch');
    click(de);
    expect(container.querySelector('[data-testid="attiva"]')!.textContent).toBe('de');
  });
});

describe('la riga «Lingue dell evento»', () => {
  const props = {
    principale: 'it',
    valore: 'en,de,uk',
    onCambia: vi.fn(),
    attive: ['it', 'en', 'de', 'fr'],
    altreLingue: true,
    conTesto: (l: string) => l === 'de',
    motore: true,
    avvisoAmministrazione: false,
  };

  it('dice le lingue, con quelle solo per sottotitoli e sintesi, e che cosa succede al salvataggio', () => {
    mount(<RigaLingue {...props} />);
    const riga = container.querySelector('.lingue-evento__riga')!.textContent!;
    expect(riga).toContain(
      `${tt.mainLanguage.replace('{language}', 'Italiano')} · English · Deutsch · `
    );
    expect(riga).toContain(tt.onlyCaptions.replace('{language}', ''));
    expect(container.textContent).toContain(tt.helpAuto);
    const cambia = container.querySelector<HTMLButtonElement>('#ev-lingue-cambia')!;
    expect(cambia.getAttribute('aria-expanded')).toBe('false');
    click(cambia);
    expect(cambia.getAttribute('aria-expanded')).toBe('true');
    // Prima le lingue del sito, poi quelle solo per sottotitoli e sintesi.
    expect(container.querySelector('details summary')!.textContent).toContain(
      tt.othersGroup
    );
  });

  it('motore spento: nessuna promessa; l amministrazione vede dove accenderlo', () => {
    mount(<RigaLingue {...props} motore={false} />);
    expect(container.textContent).not.toContain(tt.helpAuto);
    expect(container.textContent).toContain(
      tt.helpManual.replace('{source}', 'italiano')
    );
    expect(container.textContent).not.toContain(tt.engineOff);
    act(() => root.unmount());
    root = createRoot(container);
    mount(<RigaLingue {...props} motore={false} avvisoAmministrazione />);
    expect(container.textContent).toContain(tt.engineOff);
    expect(container.querySelector('a')!.getAttribute('href')).toBe('/admin/settings');
  });

  it('togliere una lingua con un testo chiede conferma; senza testo no', () => {
    const onCambia = vi.fn();
    mount(<RigaLingue {...props} onCambia={onCambia} />);
    click(container.querySelector('#ev-lingue-cambia'));
    const casella = (l: string) =>
      [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
        (c) => c.labels?.[0]?.getAttribute('lang') === l
      )!;
    // Senza testo: si toglie e basta.
    click(casella('en'));
    expect(onCambia).toHaveBeenLastCalledWith('de,uk', []);

    // Con un testo: la domanda, e il fuoco su «Togli».
    click(casella('de'));
    expect(onCambia).toHaveBeenCalledTimes(1);
    const domanda = tt.removeQuestion.replace(/\{language\}/g, 'Deutsch');
    expect(container.textContent).toContain(domanda);
    expect(document.activeElement?.textContent).toBe(tt.removeConfirm);
    click(bottone(tt.cancel));
    expect(onCambia).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(domanda);

    click(casella('de'));
    click(bottone(tt.removeConfirm));
    expect(onCambia).toHaveBeenLastCalledWith('en,uk', ['de']);
  });

  it('un errore sulle lingue apre la scelta e lo dice', () => {
    mount(<RigaLingue {...props} invalid />);
    expect(
      container.querySelector('#ev-lingue-cambia')!.getAttribute('aria-expanded')
    ).toBe('true');
    expect(container.textContent).toContain(tt.languagesRequired);
  });
});

describe('l avviso dentro la scheda', () => {
  const base = {
    lingua: 'en',
    principale: 'it',
    motore: true,
    staff: true,
    inviando: false,
    errore: null,
    onRiletta: vi.fn(),
    onRitraduci: vi.fn(),
    onRiprova: vi.fn(),
  };
  const testo = (s: string) =>
    s.replace('{source}', 'italiano').replace('{language}', 'English');

  it('automatica: si segna come riletta', () => {
    const onRiletta = vi.fn();
    mount(<PannelloLingua {...base} stato="machine" onRiletta={onRiletta} />);
    expect(container.textContent).toContain(testo(tt.panel.machine));
    click(bottone(tt.markReviewed));
    expect(onRiletta).toHaveBeenCalledTimes(1);
  });

  it('da aggiornare: «Ritraduci» chiede conferma; «È ancora corretta» no', () => {
    const onRitraduci = vi.fn();
    const onRiletta = vi.fn();
    mount(
      <PannelloLingua
        {...base}
        stato="stale"
        onRitraduci={onRitraduci}
        onRiletta={onRiletta}
      />
    );
    click(bottone(tt.retranslate));
    expect(onRitraduci).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      tt.retranslateQuestion.replace('{language}', 'English')
    );
    expect(document.activeElement?.textContent).toBe(tt.retranslateConfirm);
    click(bottone(tt.retranslateConfirm));
    expect(onRitraduci).toHaveBeenCalledTimes(1);
    click(bottone(tt.stillCorrect));
    expect(onRiletta).toHaveBeenCalledTimes(1);
  });

  it('a motore spento, o con il solo link di conduzione, non si offre «Ritraduci»', () => {
    mount(<PannelloLingua {...base} stato="stale" motore={false} />);
    expect(container.textContent).not.toContain(tt.retranslate);
    expect(container.textContent).toContain(tt.stillCorrect);
    act(() => root.unmount());
    root = createRoot(container);
    mount(<PannelloLingua {...base} stato="stale" staff={false} />);
    expect(container.textContent).not.toContain(tt.retranslate);
  });

  it('non riuscita: il motivo e «Riprova», solo per lo staff', () => {
    const onRiprova = vi.fn();
    mount(
      <PannelloLingua
        {...base}
        stato="failed"
        fallimento="MT_UNAVAILABLE"
        onRiprova={onRiprova}
      />
    );
    expect(container.textContent).toContain(
      tt.panel.failed.replace('{reason}', messages.apiErrors.mtUnavailable)
    );
    click(bottone(tt.retry));
    expect(onRiprova).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    root = createRoot(container);
    mount(<PannelloLingua {...base} stato="failed" staff={false} />);
    expect(container.textContent).toContain(tt.panel.failedGeneric);
    expect(container.querySelector('button')).toBeNull();
  });

  it('vuota, al salvataggio, in traduzione: dice che cosa succede, senza azioni', () => {
    for (const stato of ['empty', 'onSave', 'translating', 'waiting'] as const) {
      act(() => root.unmount());
      root = createRoot(container);
      mount(<PannelloLingua {...base} stato={stato} />);
      expect(container.textContent).toContain(testo(tt.panel[stato]));
      expect(container.querySelector('button')).toBeNull();
    }
  });

  it('riletta e principale: niente da dire', () => {
    mount(<PannelloLingua {...base} stato="human" />);
    expect(container.textContent).toBe('');
  });
});

describe('useLingueEvento — lo stato delle schede nel wizard', () => {
  const ORA = new Date('2026-10-20T12:00:00.000Z');
  const server = (
    lingue: StatoTestiEvento['lingue'],
    job: StatoTestiEvento['job'] = null
  ): StatoTestiEvento => ({
    engine: 'available',
    principale: 'it',
    lingue,
    job,
    testi: { title: {}, description: {} },
  });
  const riga = (code: string, extra: Partial<StatoTestiEvento['lingue'][number]>) => ({
    code,
    page: true,
    event: true,
    state: 'onSave' as StatoScheda,
    origin: null,
    current: true,
    ...extra,
  });

  let ultimo: ReturnType<typeof useLingueEvento> | null = null;
  function Banco(props: {
    iniziale: StatoTestiEvento | null;
    toccate?: string[];
    titoli?: Record<string, string>;
    staff?: boolean;
    motore?: boolean;
    onArrivati?: (t: StatoTestiEvento['testi']) => void;
  }) {
    ultimo = useLingueEvento({
      eventId: ID,
      iniziale: props.iniziale,
      motore: props.motore ?? true,
      staff: props.staff ?? true,
      principale: 'it',
      attive: ['it', 'en', 'fr', 'de'],
      lingueEvento: ['en', 'fr', 'de'],
      titoli: { it: 'Titolo', ...props.titoli },
      descrizioni: { it: 'Descrizione' },
      toccate: new Set(props.toccate ?? []),
      principaleSalvato: { title: 'Titolo', description: 'Descrizione' },
      onArrivati: props.onArrivati ?? (() => {}),
    });
    return <p>{ultimo.annuncio}</p>;
  }

  it('dal server, corretto da cio che si fa nella pagina', () => {
    mount(
      <Banco
        iniziale={server([
          riga('it', { state: 'principale' }),
          riga('en', { state: 'machine', origin: 'MACHINE' }),
          riga('fr', { state: 'stale', origin: 'HUMAN', current: false }),
          riga('de', { state: 'onSave' }),
        ])}
        titoli={{ en: 'Title', fr: 'Titre' }}
      />
    );
    expect(ultimo!.stati).toEqual({
      it: 'principale',
      en: 'machine',
      fr: 'stale',
      de: 'onSave',
    });

    // Toccata: di una persona, aggiornata.
    mount(
      <Banco
        iniziale={server([riga('en', { state: 'machine', origin: 'MACHINE' })])}
        titoli={{ en: 'Title', fr: 'Titre' }}
        toccate={['en', 'fr']}
      />
    );
    expect(ultimo!.stati.en).toBe('human');
    expect(ultimo!.stati.fr).toBe('human');
  });

  it('il testo principale cambiato nel modulo: l automatica si ritraduce al salvataggio', () => {
    mount(
      <Banco
        iniziale={server([riga('en', { state: 'machine', origin: 'MACHINE' })])}
        titoli={{ it: 'Un altro titolo', en: 'Title' }}
      />
    );
    expect(ultimo!.stati.en).toBe('onSave');
    // A motore spento, invece, e' da aggiornare: nessuna promessa.
    mount(
      <Banco
        iniziale={server([riga('en', { state: 'machine', origin: 'MACHINE' })])}
        titoli={{ it: 'Un altro titolo', en: 'Title' }}
        motore={false}
      />
    );
    expect(ultimo!.stati.en).toBe('stale');
    expect(ultimo!.stati.de).toBe('empty');
  });

  it('in traduzione: lo staff rilegge ogni 10 secondi e porta i testi arrivati', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(ORA);
    const job = {
      status: 'RUNNING',
      createdAt: new Date(ORA.getTime() - 60_000).toISOString(),
      completedAt: null,
      errorCode: null,
      targetLanguages: ['de'],
    };
    const arrivato = {
      ...server([riga('de', { state: 'machine', origin: 'MACHINE' })]),
      testi: { title: { de: 'Titel' }, description: { de: 'Beschreibung' } },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(arrivato)));
    vi.stubGlobal('fetch', fetchMock);
    const onArrivati = vi.fn();
    mount(
      <Banco
        iniziale={server([riga('de', { state: 'translating' })], job)}
        onArrivati={onArrivati}
      />
    );
    expect(ultimo!.stati.de).toBe('translating');
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    vi.useRealTimers();
    await attendi();
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/events/${ID}/text-translation`, {
      cache: 'no-store',
    });
    expect(onArrivati).toHaveBeenCalledWith(arrivato.testi);
    expect(container.textContent).toBe(
      tt.announceReady.replace('{languages}', 'Deutsch')
    );
  });

  it('con il solo link di conduzione non si rilegge (la lettura e dell amministrazione)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const job = {
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      completedAt: null,
      errorCode: null,
      targetLanguages: ['de'],
    };
    mount(
      <Banco
        iniziale={server([riga('de', { state: 'translating' })], job)}
        staff={false}
      />
    );
    expect(ultimo!.stati.de).toBe('translating');
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('una lettura partita prima di un salvataggio non riporta il testo vecchio nel modulo', async () => {
    let rispondi: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (rispondi = r)))
    );
    const onArrivati = vi.fn();
    mount(
      <Banco
        iniziale={server([riga('de', { state: 'onSave' })])}
        onArrivati={onArrivati}
      />
    );
    let lettura: Promise<void> = Promise.resolve();
    act(() => {
      lettura = ultimo!.ricarica();
    });
    // Il salvataggio finisce mentre la lettura e' in viaggio.
    act(() => ultimo!.scarta());
    await act(async () => {
      rispondi(
        new Response(
          JSON.stringify(server([riga('de', { state: 'human', origin: 'HUMAN' })]))
        )
      );
      await lettura;
    });
    expect(onArrivati).not.toHaveBeenCalled();
    expect(ultimo!.stati.de).toBe('onSave');
  });

  it('«Riprova» chiede la traduzione di quella lingua', async () => {
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ stato: 'accodato' }), { status: 202 })
        : new Response(JSON.stringify(server([riga('de', { state: 'translating' })])))
    );
    vi.stubGlobal('fetch', fetchMock);
    mount(
      <Banco iniziale={server([riga('de', { state: 'failed', failure: 'GENERIC' })])} />
    );
    expect(ultimo!.stati.de).toBe('failed');
    expect(ultimo!.fallimenti.de).toBe('GENERIC');
    await act(async () => {
      await ultimo!.riprova('de');
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ lingue: ['de'] });
    expect(container.textContent).toBe(
      tt.announceQueued.replace('{languages}', 'Deutsch')
    );
  });

  it('«Riprova» senza un lavoro nuovo lo dice, invece di annunciarlo', async () => {
    for (const [stato, atteso] of [
      ['in-corso', tt.retryBusy],
      ['nessuna', tt.retryNothing],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_u: string, init?: RequestInit) =>
          init?.method === 'POST'
            ? new Response(JSON.stringify({ stato }))
            : new Response(JSON.stringify(server([riga('de', { state: 'failed' })])))
        )
      );
      mount(
        <Banco iniziale={server([riga('de', { state: 'failed', failure: 'GENERIC' })])} />
      );
      await act(async () => {
        await ultimo!.riprova('de');
      });
      expect(ultimo!.errore).toBe(atteso);
      expect(container.textContent).not.toContain(
        tt.announceQueued.replace('{languages}', 'Deutsch')
      );
      act(() => root.unmount());
      root = createRoot(container);
    }
  });
});

describe("le lingue nella pagina dell'evento", () => {
  const risposta = (lingue: StatoTestiEvento['lingue']) =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            engine: 'available',
            principale: 'it',
            lingue,
            job: null,
            testi: { title: {}, description: {} },
          })
        )
    );
  const l = (code: string, state: StatoScheda, extra: Record<string, unknown> = {}) => ({
    code,
    page: true,
    event: true,
    state,
    origin: null,
    current: true,
    ...extra,
  });

  it('una riga per lingua della pagina, e il link ai testi quando c e qualcosa da rileggere', async () => {
    vi.stubGlobal(
      'fetch',
      risposta([
        l('it', 'principale'),
        l('en', 'machine'),
        l('fr', 'translating'),
        l('uk', 'empty', { page: false }),
      ])
    );
    mount(
      <EventTextTranslationStatus
        eventId={ID}
        editHref="/admin/events/x/edit?step=base"
      />
    );
    await attendi();
    const item = (language: string, state: string) =>
      tt.status.item.replace('{language}', language).replace('{state}', state);
    expect(container.textContent).toContain(
      tt.status.summary.replace(
        '{list}',
        [
          item('English', tt.stateLower.machine),
          item('Français', tt.stateLower.translating),
        ].join(' · ')
      )
    );
    expect(container.querySelector('a')!.getAttribute('href')).toBe(
      '/admin/events/x/edit?step=base'
    );
  });

  it('tutto riletto: nessun link; nessuna altra lingua: niente', async () => {
    vi.stubGlobal('fetch', risposta([l('it', 'principale'), l('en', 'human')]));
    mount(<EventTextTranslationStatus eventId={ID} editHref="/x" />);
    await attendi();
    expect(container.querySelector('a')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    vi.stubGlobal('fetch', risposta([l('it', 'principale')]));
    mount(<EventTextTranslationStatus eventId={ID} editHref="/x" />);
    await attendi();
    expect(container.textContent).toBe('');
  });
});
