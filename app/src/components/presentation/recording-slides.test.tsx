import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import type { VideoPlayerHandle } from '@/components/events/video-player';
import type { SlideCue, SlideMaterialView } from '@/lib/presentation/recording-slides';

/**
 * Le slide accanto alla registrazione seguono il video: la pagina giusta a
 * ogni istante, nessuna dove non si presentava, il documento scaricato una
 * volta sola, e l'elenco e i pulsanti che spostano il video. pdf.js è finto
 * (il disegno sul canvas non si prova qui).
 */
const { openPdf } = vi.hoisted(() => {
  const openPdf = vi.fn(async () => {
    const doc = { numPages: 12, getPage: vi.fn(), destroy: vi.fn() };
    return { promise: Promise.resolve(doc), destroy: vi.fn(async () => undefined) };
  });
  return { openPdf };
});
vi.mock('./pdf-loader', () => ({ openPdf }));

import RecordingSlides from './recording-slides';

const tr = messages.recordingSlides;
const A = '55555555-5555-4555-8555-555555555555';
const B = '66666666-6666-4666-8666-666666666666';
const URL_A = `/api/events/evento-di-prova/recording/slides?m=${A}`;
const URL_B = `/api/events/evento-di-prova/recording/slides?m=${B}`;

const CUES: SlideCue[] = [
  { start: 10, end: 70, materialId: A, page: 1 },
  { start: 70, end: 100, materialId: A, page: 2 },
  { start: 300, end: 302, materialId: B, page: 4 },
  { start: 302, end: 600, materialId: B, page: 5 },
];
const MATERIALI: SlideMaterialView[] = [
  { id: A, title: 'Slide della sessione', fileUrl: URL_A, downloadName: 'sessione.pdf' },
  { id: B, title: 'Secondo documento', fileUrl: URL_B, downloadName: null },
];

let container: HTMLDivElement;
let root: Root;
let video: HTMLVideoElement;
let player: { current: VideoPlayerHandle };
const fetchMock = vi.fn();
const seekTo = vi.fn();

function nuovoVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  let tempo = 0;
  Object.defineProperty(v, 'currentTime', {
    configurable: true,
    get: () => tempo,
    set: (x: number) => {
      tempo = x;
    },
  });
  Object.defineProperty(v, 'paused', { configurable: true, get: () => true });
  Object.defineProperty(v, 'duration', { configurable: true, get: () => 600 });
  return v;
}

async function attendi() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(
  cues: SlideCue[] = CUES,
  materials: SlideMaterialView[] = MATERIALI
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RecordingSlides playerRef={player} cues={cues} materials={materials} />
      </NextIntlClientProvider>
    );
  });
  await attendi();
}

/** Il video arriva all'istante `t` (un aggiornamento del tempo, o un salto). */
async function vaiA(t: number, evento: 'timeupdate' | 'seeked' = 'timeupdate') {
  video.currentTime = t;
  await act(async () => {
    video.dispatchEvent(new Event(evento));
  });
  await attendi();
}

const indicatore = () =>
  container.querySelector('.recording-slides__indicator')?.textContent;
const stato = () =>
  container.querySelector('.recording-slides__status')?.textContent ?? '';
const canvas = () => container.querySelector('canvas')!;
const documento = () =>
  container.querySelector('.recording-slides__doc')?.textContent ?? null;
function pulsante(testo: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === testo || b.getAttribute('aria-label') === testo
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 })
  );
  vi.stubGlobal('fetch', fetchMock);
  openPdf.mockClear();
  seekTo.mockReset();
  video = nuovoVideo();
  seekTo.mockImplementation((s: number) => {
    video.currentTime = s;
    video.dispatchEvent(new Event('seeked'));
  });
  player = {
    current: {
      currentTime: () => video.currentTime,
      seekTo,
      pause: vi.fn(),
      play: vi.fn(),
      setSubtitle: vi.fn(),
      setAudio: vi.fn(),
      videoEl: () => video,
    },
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('slide accanto alla registrazione', () => {
  it('prima della prima slide: nessuna slide, e un pulsante porta il video alla prima', async () => {
    await render();
    expect(indicatore()).toBe(tr.noSlideShort);
    expect(stato()).toContain(tr.notYet);
    // Il primo documento si prepara già, prima che serva.
    expect(fetchMock).toHaveBeenCalledWith(URL_A, expect.anything());
    const vai = pulsante(tr.goToNext.replace('{time}', '0:10'));
    expect(vai).toBeDefined();
    await act(async () => vai!.click());
    expect(seekTo).toHaveBeenCalledWith(10.05, false);
  });

  it('segue il tempo del video: la pagina di ogni istante, il documento scaricato una volta', async () => {
    await render();
    await vaiA(15);
    expect(indicatore()).toBe('Slide 1 di 12');
    expect(canvas().getAttribute('aria-label')).toBe(
      'Slide 1 di 12: Slide della sessione'
    );
    expect(documento()).toBe('Slide della sessione');

    await vaiA(70);
    expect(indicatore()).toBe('Slide 2 di 12');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Chiusa la presentazione: nessuna slide, e il prossimo documento si prepara.
    await vaiA(150, 'seeked');
    expect(indicatore()).toBe(tr.noSlideShort);
    expect(stato()).toContain(tr.noSlideNow);
    expect(documento()).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith(URL_B, expect.anything());

    await vaiA(310);
    expect(indicatore()).toBe('Slide 5 di 12');
    expect(documento()).toBe('Secondo documento');

    // Tornando indietro il primo documento è già in memoria.
    await vaiA(20, 'seeked');
    expect(indicatore()).toBe('Slide 1 di 12');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(openPdf).toHaveBeenCalledTimes(2);
  });

  it('annuncia il documento a schermo senza interrompere', async () => {
    await render();
    await vaiA(15);
    const regioni = Array.from(container.querySelectorAll('[aria-live="polite"]'));
    expect(regioni.map((r) => r.textContent)).toEqual([
      tr.nowShowing.replace('{title}', 'Slide della sessione'),
      'Slide 1 di 12',
    ]);
  });

  it('l’elenco delle slide sposta il video e segna quella in corso', async () => {
    await render();
    await vaiA(80);
    const voci = Array.from(container.querySelectorAll('.recording-slides__chapter'));
    // La slide rimasta a schermo due secondi non entra nell'elenco.
    expect(
      voci.map((v) => v.querySelector('.recording-slides__chapter-time')?.textContent)
    ).toEqual(['0:10', '1:10', '5:02']);
    expect(voci[1]!.getAttribute('aria-current')).toBe('true');
    expect(voci[0]!.getAttribute('aria-current')).toBeNull();
    // Con più documenti ogni voce dice di quale.
    expect(voci[2]!.textContent).toContain('Secondo documento');
    expect(container.querySelector('.recording-slides__list summary')?.textContent).toBe(
      tr.listTitle.replace('{count}', '3')
    );

    await act(async () => (voci[2] as HTMLButtonElement).click());
    expect(seekTo).toHaveBeenLastCalledWith(302.05, false);
    await attendi();
    expect(indicatore()).toBe('Slide 5 di 12');
  });

  it('«precedente» e «successiva» spostano il video fra le slide dell’elenco', async () => {
    await render();
    await vaiA(75);
    await act(async () => pulsante(tr.next)!.click());
    expect(seekTo).toHaveBeenLastCalledWith(302.05, false);

    await vaiA(75);
    await act(async () => pulsante(tr.previous)!.click());
    // Oltre due secondi dall'inizio: si torna all'inizio della slide in corso.
    expect(seekTo).toHaveBeenLastCalledWith(70.05, false);

    await vaiA(71);
    await act(async () => pulsante(tr.previous)!.click());
    expect(seekTo).toHaveBeenLastCalledWith(10.05, false);

    await vaiA(5);
    expect(pulsante(tr.previous)!.disabled).toBe(true);
    await vaiA(400);
    expect(pulsante(tr.next)!.disabled).toBe(true);
  });

  it('lo scaricamento del PDF solo dove la pagina lo offre', async () => {
    await render();
    await vaiA(15);
    const link = container.querySelector<HTMLAnchorElement>(
      'a.recording-slides__download'
    );
    expect(link?.getAttribute('href')).toBe(URL_A);
    expect(link?.getAttribute('download')).toBe('sessione.pdf');
    // Il nome del link dice anche quale documento, nella lingua della pagina.
    expect(link?.getAttribute('aria-label')).toBe(
      tr.downloadNamed.replace('{title}', 'Slide della sessione')
    );
    await vaiA(310);
    expect(container.querySelector('a.recording-slides__download')).toBeNull();
  });

  it('documento non leggibile: un avviso e «Riprova» lo riscarica', async () => {
    fetchMock.mockImplementation(async () => new Response('no', { status: 404 }));
    await render();
    await vaiA(15);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      tr.loadError
    );
    fetchMock.mockImplementation(
      async () => new Response(new Uint8Array([0x25, 0x50]), { status: 200 })
    );
    await act(async () => pulsante(tr.retry)!.click());
    await attendi();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(indicatore()).toBe('Slide 1 di 12');
  });

  it('dopo l’ultima slide lo dice, senza pulsante', async () => {
    await render([{ start: 10, end: 100, materialId: A, page: 1 }], [MATERIALI[0]!]);
    await vaiA(200);
    expect(stato()).toContain(tr.noMore);
    expect(container.querySelector('.recording-slides__status button')).toBeNull();
    // Un solo documento: le voci dell'elenco non lo ripetono.
    expect(container.querySelector('.recording-slides__chapter-doc')).toBeNull();
  });

  it('un errore di prima non resta mentre il documento si riscarica', async () => {
    let risolvi: (r: Response) => void = () => {};
    let tentativiA = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === URL_A) {
        tentativiA++;
        if (tentativiA === 1) return new Response('no', { status: 502 });
        return new Promise<Response>((r) => {
          risolvi = r;
        });
      }
      return new Response(new Uint8Array([0x25, 0x50]), { status: 200 });
    });
    await render();
    await vaiA(15);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      tr.loadError
    );
    // Il video va al secondo documento e torna al primo: si riscarica.
    await vaiA(310, 'seeked');
    await vaiA(20, 'seeked');
    expect(tentativiA).toBe(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain(tr.loading);
    await act(async () =>
      risolvi(new Response(new Uint8Array([0x25, 0x50]), { status: 200 }))
    );
    await attendi();
    expect(indicatore()).toBe('Slide 1 di 12');
  });
});
