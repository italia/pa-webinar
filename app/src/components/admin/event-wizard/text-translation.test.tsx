import type { ReactNode } from 'react';
import { act, useCallback, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { applicaProposta, type TextTranslations } from '@/lib/text-translation/proposals';
import { improntaSorgente } from '@/lib/text-translation/source';
import LocaleTabBar from '@/components/ui/locale-tab-bar';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  percorso: (p: string) => p,
}));

import EventTextTranslationStatus from '../event-text-translation-status';

import {
  lingueDaTradurre,
  TraduzioneTestiCard,
  useTraduzioneTesti,
} from './text-translation';

/**
 * La traduzione automatica nel wizard: riempie solo i campi vuoti, mai il
 * testo scritto da una persona, e segna le lingue riempite.
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

/**
 * Come il wizard: il modulo, la funzione che riempie i campi vuoti, la scheda,
 * e un pulsante che cambia il testo di partenza come farebbe chi scrive.
 */
function Banco({
  titoli,
  descrizioni,
}: {
  titoli: Record<string, string>;
  descrizioni: Record<string, string>;
}) {
  const [form, setForm] = useState({ title: titoli, description: descrizioni });
  const [segnate, setSegnate] = useState<string[]>([]);
  const ref = useRef(form);
  ref.current = form;
  const applica = useCallback((p: TextTranslations, lingue: string[]) => {
    const { riempite } = applicaProposta(
      p,
      lingue,
      ref.current.title,
      ref.current.description
    );
    setForm((prima) => {
      const r = applicaProposta(p, riempite, prima.title, prima.description);
      return { title: r.title, description: r.description };
    });
    setSegnate((s) => [...s, ...riempite]);
    return riempite;
  }, []);
  const stato = useTraduzioneTesti({
    attiva: true,
    eventId: ID,
    sorgente: 'it',
    titoli: form.title,
    descrizioni: form.description,
    applica,
  });
  return (
    <>
      <TraduzioneTestiCard
        mode="edit"
        stato={stato}
        lingueAttive={['it', 'en', 'de', 'fr']}
        sorgente="it"
        titoli={form.title}
        descrizioni={form.description}
      />
      <pre data-testid="modulo">{JSON.stringify({ ...form, segnate })}</pre>
      <button
        type="button"
        data-testid="riscrivi"
        onClick={() =>
          setForm((prima) => ({
            ...prima,
            description: { ...prima.description, it: `${prima.description.it} riscritto` },
          }))
        }
      />
    </>
  );
}

const modulo = () =>
  JSON.parse(container.querySelector('[data-testid="modulo"]')!.textContent!) as {
    title: Record<string, string>;
    description: Record<string, string>;
    segnate: string[];
  };
const pulsante = (testo: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === testo)!;
const stato = () => container.querySelector('[role="status"]')!.textContent;
const attendi = async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};
/** Il giro successivo della rilettura ogni 10 secondi. */
const avanza = async () => {
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  await attendi();
};

async function proposta(
  titolo: string,
  descrizione: string,
  extra: Partial<TextTranslations> = {}
) {
  return {
    version: 1,
    sourceLanguage: 'it',
    sourceHash: await improntaSorgente({
      sourceLanguage: 'it',
      title: titolo,
      description: descrizione,
    }),
    generatedAt: '',
    model: { id: 'm', version: null },
    title: { en: 'Title', de: 'Titel' },
    description: { en: 'Text', de: 'Text DE' },
    ...extra,
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('lingueDaTradurre', () => {
  it('le lingue con un campo ancora vuoto dove la lingua di partenza ha testo', () => {
    expect(
      lingueDaTradurre(
        ['it', 'en', 'de', 'fr'],
        'it',
        { it: 'T', en: 'T', de: '' },
        { it: 'D', en: 'D' }
      )
    ).toEqual(['de', 'fr']);
    expect(lingueDaTradurre(['it', 'en'], 'it', { it: '' }, { it: '' })).toEqual([]);
  });
});

describe('scheda della traduzione automatica (modifica)', () => {
  it('chiede la traduzione del testo del modulo e riempie solo i campi vuoti', async () => {
    const p = await proposta('Ciclo | Titolo', 'Testo');
    const chiamate: Array<{ metodo: string; corpo: unknown }> = [];
    let consegnata = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        chiamate.push({
          metodo: init?.method ?? 'GET',
          corpo: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (init?.method === 'POST') {
          consegnata = true;
          return new Response(JSON.stringify({ stato: 'accodato', jobId: 'j' }), {
            status: 202,
          });
        }
        return new Response(
          JSON.stringify(
            consegnata
              ? {
                  job: { status: 'DONE', lastError: null, sourceHash: p.sourceHash },
                  proposals: p,
                  pending: [],
                }
              : { job: null, proposals: null, pending: [] }
          )
        );
      })
    );
    mount(
      <Banco
        titoli={{ it: 'Ciclo | Titolo', en: 'Titolo scritto a mano' }}
        descrizioni={{ it: 'Testo' }}
      />
    );
    await attendi();
    // Di partenza le lingue con un campo vuoto: tutte e tre.
    const caselle = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    expect(caselle.map((c) => c.checked)).toEqual([true, true, true]);
    await act(async () => {
      pulsante(tt.start).click();
    });
    await attendi();
    expect(chiamate.find((c) => c.metodo === 'POST')!.corpo).toEqual({
      sourceLanguage: 'it',
      title: 'Ciclo | Titolo',
      description: 'Testo',
      targetLanguages: ['en', 'de', 'fr'],
    });
    const f = modulo();
    // Il titolo inglese scritto a mano resta; la descrizione inglese vuota si riempie.
    expect(f.title).toEqual({
      it: 'Ciclo | Titolo',
      en: 'Titolo scritto a mano',
      de: 'Titel',
    });
    expect(f.description).toEqual({ it: 'Testo', en: 'Text', de: 'Text DE' });
    expect(f.segnate).toEqual(['en', 'de']);
    expect(container.querySelector('[role="status"]')!.textContent).toBe(
      tt.done.replace('{languages}', 'English, Deutsch')
    );
  });

  it("mentre il lavoro e' in coda lo stato si rilegge ogni 10 secondi", async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let letture = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        letture += 1;
        return new Response(
          JSON.stringify({
            job: { status: 'RUNNING', lastError: null, sourceHash: 'x' },
            proposals: null,
          })
        );
      })
    );
    mount(<Banco titoli={{ it: 'Titolo' }} descrizioni={{ it: 'Testo' }} />);
    await attendi();
    expect(container.querySelector('[role="status"]')!.textContent).toBe(tt.running);
    expect(letture).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await attendi();
    expect(letture).toBe(2);
  });

  it("se il testo di partenza cambia mentre il lavoro gira, a lavoro finito non riempie niente", async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const p = await proposta('Titolo', 'Testo');
    let fase: 'nessuno' | 'in-coda' | 'consegnata' = 'nessuno';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          fase = 'in-coda';
          return new Response(JSON.stringify({ stato: 'accodato', jobId: 'j' }), {
            status: 202,
          });
        }
        const job =
          fase === 'nessuno'
            ? null
            : {
                status: fase === 'consegnata' ? 'DONE' : 'PENDING',
                lastError: null,
                sourceHash: p.sourceHash,
              };
        return new Response(
          JSON.stringify({ job, proposals: fase === 'consegnata' ? p : null })
        );
      })
    );
    mount(<Banco titoli={{ it: 'Titolo' }} descrizioni={{ it: 'Testo' }} />);
    await attendi();
    await act(async () => {
      pulsante(tt.start).click();
    });
    await attendi();
    expect(stato()).toBe(tt.queued);
    // Chi aspetta continua a scrivere la descrizione italiana.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="riscrivi"]')!.click();
    });
    fase = 'consegnata';
    await avanza();
    // La traduzione del testo di prima non entra nel modulo...
    expect(modulo()).toEqual({
      title: { it: 'Titolo' },
      description: { it: 'Testo riscritto' },
      segnate: [],
    });
    // ...lo si dice, con il pulsante per tradurre il testo attuale...
    expect(stato()).toBe(tt.sourceChanged.replace('{button}', tt.start));
    expect(pulsante(tt.start).disabled).toBe(false);
    // ...e non si offre: viene da un altro testo.
    expect(container.textContent).not.toContain(tt.useOffer);
  });

  it("con un'altra traduzione gia' in corso lo dice finche' non finisce, e non accoda niente", async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    // La traduzione chiesta alla creazione, di un altro testo.
    const altra = await proposta('Titolo di prima', 'Testo di prima');
    let status = 'PENDING';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return new Response(
            JSON.stringify({ stato: 'in-corso', jobId: 'j', sourceHash: altra.sourceHash })
          );
        }
        return new Response(
          JSON.stringify({
            job: { status, lastError: null, sourceHash: altra.sourceHash },
            proposals: status === 'DONE' ? altra : null,
          })
        );
      })
    );
    mount(<Banco titoli={{ it: 'Titolo' }} descrizioni={{ it: 'Testo' }} />);
    await attendi();
    expect(stato()).toBe(tt.queued);
    await act(async () => {
      pulsante(tt.start).click();
    });
    await attendi();
    // Non «in coda»: la richiesta di questa pagina non e' stata accodata.
    expect(stato()).toBe(tt.busy);
    status = 'RUNNING';
    await avanza();
    expect(stato()).toBe(tt.busy);
    // Finita l'altra: l'avviso sparisce e il modulo resta com'era.
    status = 'DONE';
    await avanza();
    expect(stato()).toBe('');
    expect(modulo()).toEqual({
      title: { it: 'Titolo' },
      description: { it: 'Testo' },
      segnate: [],
    });
  });

  it("una proposta gia' pronta per lo stesso testo si offre; per un altro testo no", async () => {
    const p = await proposta('Titolo', 'Testo');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ job: null, proposals: p, pending: [] }))
      )
    );
    mount(
      <Banco
        titoli={{ it: 'Titolo', de: 'Mein Titel' }}
        descrizioni={{ it: 'Testo', de: 'Mein Text' }}
      />
    );
    await attendi();
    expect(container.textContent).toContain(tt.offer.replace('{languages}', 'English'));
    await act(async () => {
      pulsante(tt.useOffer).click();
    });
    await attendi();
    expect(modulo().title).toEqual({ it: 'Titolo', de: 'Mein Titel', en: 'Title' });
    expect(modulo().segnate).toEqual(['en']);
    // Riempita la lingua, l'offerta sparisce.
    expect(container.textContent).not.toContain(tt.useOffer);

    act(() => root.unmount());
    root = createRoot(container);
    mount(<Banco titoli={{ it: 'Titolo cambiato' }} descrizioni={{ it: 'Testo' }} />);
    await attendi();
    expect(container.textContent).not.toContain(tt.useOffer);
  });
});

describe('scheda della traduzione automatica (creazione)', () => {
  it('si sceglie di tradurre dopo il salvataggio, e le lingue compaiono solo allora', async () => {
    const onDopo = vi.fn();
    mount(
      <TraduzioneTestiCard
        mode="create"
        dopo={{ attiva: false, lingue: null }}
        onDopo={onDopo}
        lingueAttive={['it', 'en']}
        sorgente="it"
        titoli={{ it: 'Titolo' }}
        descrizioni={{ it: 'Testo' }}
      />
    );
    expect(container.querySelectorAll('fieldset')).toHaveLength(0);
    await act(async () => {
      container.querySelector<HTMLInputElement>('#traduci-dopo')!.click();
    });
    expect(onDopo).toHaveBeenCalledWith({ attiva: true, lingue: null });
  });
});

describe('barra delle lingue', () => {
  it('una lingua tradotta in automatico ha il suo segno, con un nome accessibile', () => {
    mount(
      <LocaleTabBar
        enabledLocales={['it', 'en', 'de']}
        defaultLocale="it"
        activeLocale="it"
        onSelectLocale={() => {}}
        filledLocales={['it', 'en', 'de']}
        machineLocales={['en']}
        machineLabel={tt.machineMark}
      />
    );
    const schede = [...container.querySelectorAll('[role="tab"]')];
    expect(schede[1]!.textContent).toContain(tt.machineMark);
    expect(schede[2]!.textContent).not.toContain(tt.machineMark);
  });
});

describe("stato nella pagina dell'evento", () => {
  it('pronta: le lingue e il link per rileggerla; non riuscita: il motivo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              job: { status: 'DONE', lastError: null },
              pending: ['en', 'de'],
            })
          )
      )
    );
    mount(
      <EventTextTranslationStatus
        eventId={ID}
        editHref="/admin/events/x/edit?step=base"
      />
    );
    await attendi();
    expect(container.textContent).toContain(
      tt.status.ready.replace('{languages}', 'English, Deutsch')
    );
    expect(container.querySelector('a')!.getAttribute('href')).toBe(
      '/admin/events/x/edit?step=base'
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              job: { status: 'FAILED', lastError: 'engine timeout', errorCode: null },
              pending: [],
            })
          )
      )
    );
    act(() => root.unmount());
    root = createRoot(container);
    mount(<EventTextTranslationStatus eventId={ID} editHref="/x" />);
    await attendi();
    // Il motivo grezzo (in inglese) non arriva nella pagina.
    expect(container.textContent).toBe(tt.status.failedGeneric);
  });

  it('motore assente: il motivo nella lingua della pagina, e niente quando il motore torna', async () => {
    const risposta = (available: boolean) =>
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              available,
              job: {
                status: 'FAILED',
                lastError: 'The CPU translation engine is not configured (AI_MT_BASE_URL)',
                errorCode: 'MT_UNAVAILABLE',
              },
              pending: [],
            })
          )
      );
    vi.stubGlobal('fetch', risposta(false));
    mount(<EventTextTranslationStatus eventId={ID} editHref="/x" />);
    await attendi();
    expect(container.textContent).toBe(
      tt.status.failed.replace('{reason}', messages.apiErrors.mtUnavailable)
    );

    vi.stubGlobal('fetch', risposta(true));
    act(() => root.unmount());
    root = createRoot(container);
    mount(<EventTextTranslationStatus eventId={ID} editHref="/x" />);
    await attendi();
    expect(container.textContent).toBe('');
  });

  it('niente da dire: niente nella pagina', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ job: null, pending: [] })))
    );
    mount(<EventTextTranslationStatus eventId={ID} editHref="/x" />);
    await attendi();
    expect(container.textContent).toBe('');
  });
});
