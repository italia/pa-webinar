import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * Il pannello dello staff delle slide sincronizzate: dice perché le slide si
 * vedono o no, le accende e le spegne, e la correzione dell'allineamento si
 * prova nell'anteprima prima di salvarla.
 */
const { anteprima, toast } = vi.hoisted(() => ({
  anteprima: { cues: [] as Array<{ start: number; page: number }> },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
vi.mock('@/components/events/video-player', () => ({
  default: () => <div data-testid="video" />,
}));
vi.mock('@/components/presentation/recording-slides', () => ({
  default: ({ cues }: { cues: Array<{ start: number; page: number }> }) => {
    anteprima.cues = cues;
    return <div data-testid="anteprima-slide" />;
  },
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  percorso: (p: string) => p,
}));

import RecordingSlidesPanel from './recording-slides-panel';

const ts = messages.admin.postprod.slides;
const ID = '11111111-2222-4333-8444-555555555555';
const A = '55555555-5555-4555-8555-555555555555';
const B = '66666666-6666-4666-8666-666666666666';

function dati(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    offsetSec: 0,
    exactZero: false,
    durationSec: 600,
    hasVideo: true,
    isEventVideo: true,
    eventVideoPublished: true,
    eventShowsMaterials: true,
    eventSlug: 'evento-di-prova',
    mediaUrl: `/api/admin/postprod/recordings/${ID}/media`,
    marks: [
      { t: 10, kind: 'started', materialId: A, page: 1 },
      { t: 70, kind: 'page', materialId: A, page: 2 },
      { t: 200, kind: 'started', materialId: B, page: 1 },
    ],
    materials: [
      { id: A, title: 'Slide della sessione', problem: null, fileUrl: '/a' },
      { id: B, title: 'Solo in sala', problem: 'notVisibleAfter', fileUrl: null },
    ],
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

async function attendi() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <RecordingSlidesPanel recordingId={ID} />
        </NextIntlClientProvider>
      </SWRConfig>
    );
  });
  await attendi();
}

function rispondi(corpo: ReturnType<typeof dati>) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({
        enabled: corpo.enabled,
        offsetSec: corpo.offsetSec,
        ...patch,
      });
    }
    return Response.json(corpo);
  });
}

const interruttore = () =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${ts.toggle}"]`)!;
const campo = () => container.querySelector<HTMLInputElement>('input[type="number"]')!;
function pulsante(testo: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === testo
  );
}
function scrivi(input: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  act(() => {
    setter.call(input, valore);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const patch = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  anteprima.cues = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('pannello delle slide sincronizzate', () => {
  it('stato, materiali con il motivo, interruttore acceso e anteprima', async () => {
    rispondi(dati());
    await render();
    expect(container.textContent).toContain(ts.zeroEstimated);
    expect(container.textContent).toContain(ts.shownPublic);
    expect(container.textContent).toContain(ts.problem.none);
    expect(container.textContent).toContain(ts.problem.notVisibleAfter);
    expect(interruttore().checked).toBe(true);
    expect(interruttore().disabled).toBe(false);
    // L'anteprima mostra solo il materiale che si può mostrare.
    expect(anteprima.cues).toEqual([
      { start: 10, end: 70, materialId: A, page: 1 },
      { start: 70, end: 200, materialId: A, page: 2 },
    ]);
  });

  it('la correzione si prova nell’anteprima e si salva solo con il pulsante', async () => {
    rispondi(dati());
    await render();
    scrivi(campo(), '-4');
    await attendi();
    expect(anteprima.cues.map((c) => c.start)).toEqual([6, 66]);
    expect(container.textContent).toContain(ts.offsetUnsaved.replace('{saved}', '0'));
    expect(patch()).toEqual([]);

    await act(async () => pulsante(ts.offsetSave)!.click());
    await attendi();
    expect(patch()).toEqual([{ offsetSec: -4 }]);
    expect(container.textContent).toContain(ts.saved);
  });

  it('una correzione non valida non si salva', async () => {
    rispondi(dati());
    await render();
    scrivi(campo(), '4000');
    await attendi();
    expect(pulsante(ts.offsetSave)!.disabled).toBe(true);
    expect(campo().getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain(ts.offsetInvalid.replace('{max}', '3600'));
  });

  it('l’interruttore spegne le slide', async () => {
    rispondi(dati());
    await render();
    await act(async () => interruttore().click());
    await attendi();
    expect(patch()).toEqual([{ enabled: false }]);
  });

  it('nessun PDF presentato nel video: interruttore spento e bloccato, niente anteprima', async () => {
    rispondi(dati({ marks: [] }));
    await render();
    expect(container.textContent).toContain(ts.noPresentation);
    expect(interruttore().checked).toBe(false);
    expect(interruttore().disabled).toBe(true);
    expect(container.querySelector('[data-testid="anteprima-slide"]')).toBeNull();
  });

  it('un altro segmento, o video non pubblicato: lo dice', async () => {
    rispondi(dati({ isEventVideo: false }));
    await render();
    expect(container.textContent).toContain(ts.notEventVideo);
    expect(container.textContent).not.toContain(ts.shownPublic);
  });

  it('senza video: lo dice e non offre nulla', async () => {
    rispondi(dati({ hasVideo: false, mediaUrl: null }));
    await render();
    expect(container.textContent).toContain(ts.noVideo);
    expect(interruttore().disabled).toBe(true);
    expect(campo()).toBeNull();
  });

  it('una correzione che porta tutto fuori dal video non toglie il campo né il resto', async () => {
    rispondi(dati());
    await render();
    scrivi(campo(), '700');
    await attendi();
    expect(campo()).not.toBeNull();
    expect(campo().value).toBe('700');
    expect(interruttore().disabled).toBe(false);
    expect(container.textContent).not.toContain(ts.noPresentation);
    // L'anteprima lo mostra: nessuna slide nel video con questa correzione.
    expect(anteprima.cues).toEqual([]);
  });

  it('con i materiali spenti sulla pagina: lo dice, e le slide non risultano pubbliche', async () => {
    rispondi(dati({ eventShowsMaterials: false }));
    await render();
    expect(container.textContent).toContain(ts.notShownOnPage);
    expect(container.textContent).not.toContain(ts.shownPublic);
  });
});
