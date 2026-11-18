// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * Il pannello della registrazione dice a chi pubblica cosa la destinazione
 * dell'evento consente: su un evento riservato il pubblico «tutti» non si
 * sceglie, su un evento senza destinazione c'e' un avviso e nessun blocco, e il
 * rifiuto del server arriva con il suo motivo.
 */
const { toast, refresh } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  refresh: vi.fn(),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  percorso: (p: string) => p,
  useRouter: () => ({ refresh }),
}));
vi.mock('./recording-upload-widget', () => ({
  default: () => <div data-testid="carica" />,
}));

import RecordingManagement from './recording-management';

const t = messages.recording;

const evento = {
  id: 'evento-1',
  slug: 'evento-di-prova',
  status: 'ENDED',
  eventType: 'SCHEDULED',
  recordingEnabled: true,
  recordingDestination: null as 'PUBLIC' | 'REGISTRANTS' | null,
  recordingUrl: 'https://storage.example.com/recordings/sala.mp4' as string | null,
  tempRecordingUrl: null,
  tempRecordingStartedAt: null,
  recordingPublished: false,
  recordingPublishedAt: null,
  recordingAudience: 'PUBLIC' as 'PUBLIC' | 'REGISTRANTS',
  recordingFileSize: null,
  recordingDuration: null,
  recordingDeleteAfterDays: null as number | null,
  legacyRecordingRetention: false as boolean | undefined,
  dataRetentionDays: 30 as number | undefined,
  moderatorToken: 'TOKEN',
};

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

function render(over: Partial<typeof evento> = {}) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RecordingManagement event={{ ...evento, ...over }} />
      </NextIntlClientProvider>
    );
  });
}

const radio = (valore: 'PUBLIC' | 'REGISTRANTS') =>
  container.querySelector<HTMLInputElement>(`#audience-${valore}`)!;
const interruttore = () =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${t.publish}"]`)!;

async function premi(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const rifiuto = (status: number, code?: string) =>
  new Response(JSON.stringify({ error: 'rifiutato', code }), { status });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  toast.error.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('RecordingManagement — destinazione riservata', () => {
  const riservato = {
    recordingDestination: 'REGISTRANTS',
    recordingAudience: 'REGISTRANTS',
  } as const;

  it('il pubblico «tutti» non si sceglie, e il motivo si legge', () => {
    render(riservato);
    expect(radio('PUBLIC').disabled).toBe(true);
    expect(radio('REGISTRANTS').checked).toBe(true);
    expect(radio('REGISTRANTS').disabled).toBe(false);
    expect(container.textContent).toContain(t.audienceReservedNote);
    expect(container.textContent).not.toContain(t.destinationMissing);
  });

  it('pubblicare per gli iscritti resta possibile', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    render(riservato);
    await premi(interruttore());
    expect(interruttore().checked).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      recordingPublished: true,
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('RecordingManagement — evento senza destinazione', () => {
  it('nessun blocco, e un avviso a chi pubblica', () => {
    render();
    expect(radio('PUBLIC').disabled).toBe(false);
    expect(container.textContent).toContain(t.destinationMissing);
  });

  it('vale anche per una chiamata rapida', () => {
    render({ eventType: 'INSTANT' });
    expect(container.textContent).toContain(t.destinationMissing);
  });

  it('un evento storico importato non ha consensi su cui avvisare', () => {
    render({ eventType: 'LEGACY' });
    expect(container.textContent).not.toContain(t.destinationMissing);
  });

  const avviso = () =>
    [...container.querySelectorAll('.alert')].find((el) =>
      el.textContent?.includes(t.destinationMissing)
    );
  const carica = () => container.querySelector('[data-testid="carica"]');

  it.each([
    ['con la registrazione accesa', true],
    ['con la registrazione spenta', false],
  ])('senza il file, %s, l’avviso sta sopra il caricamento', (_n, recordingEnabled) => {
    render({ recordingUrl: null, recordingEnabled });
    expect(carica()).not.toBeNull();
    expect(
      avviso()!.compareDocumentPosition(carica()!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('senza il file l’avviso vale anche per una chiamata rapida', () => {
    render({ recordingUrl: null, eventType: 'INSTANT' });
    expect(avviso()).toBeDefined();
  });

  it('con il file l’avviso compare una volta sola', () => {
    render();
    expect(
      [...container.querySelectorAll('.alert')].filter((el) =>
        el.textContent?.includes(t.destinationMissing)
      )
    ).toHaveLength(1);
  });

  it.each([
    ['un evento storico', { eventType: 'LEGACY' }],
    ['una destinazione dichiarata', { recordingDestination: 'PUBLIC' }],
    ['un evento riservato', { recordingDestination: 'REGISTRANTS' }],
  ] as const)('senza il file, %s non ha l’avviso', (_n, over) => {
    render({ recordingUrl: null, ...over });
    expect(carica()).not.toBeNull();
    expect(avviso()).toBeUndefined();
  });

  it('in diretta, con la registrazione accesa, non si carica e non c’e’ avviso', () => {
    render({ recordingUrl: null, status: 'LIVE' });
    expect(carica()).toBeNull();
    expect(avviso()).toBeUndefined();
  });

  it('in diretta, con la registrazione spenta, si carica: l’avviso resta', () => {
    render({ recordingUrl: null, recordingEnabled: false, status: 'LIVE' });
    expect(carica()).not.toBeNull();
    expect(avviso()).toBeDefined();
  });
});

describe('RecordingManagement — dopo il caricamento', () => {
  it('quando la pagina si rilegge, le scelte seguono cio’ che il server ha salvato', () => {
    render({ recordingUrl: null, recordingEnabled: false });
    render({
      recordingEnabled: true,
      recordingDestination: 'REGISTRANTS',
      recordingAudience: 'REGISTRANTS',
      recordingPublished: true,
    });
    expect(interruttore().checked).toBe(true);
    expect(radio('REGISTRANTS').checked).toBe(true);
    expect(radio('PUBLIC').checked).toBe(false);
  });
});

describe('RecordingManagement — destinazione pubblica', () => {
  it('nessun avviso, e il pubblico si sceglie', () => {
    render({ recordingDestination: 'PUBLIC' });
    expect(radio('PUBLIC').disabled).toBe(false);
    expect(container.textContent).not.toContain(t.destinationMissing);
    expect(container.textContent).not.toContain(t.audienceReservedNote);
  });
});

describe('RecordingManagement — il pubblico del video', () => {
  it('salvato, rilegge l’evento: decide anche cio’ che la pagina dice delle domande', async () => {
    refresh.mockClear();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    render({ recordingDestination: 'PUBLIC' });
    await premi(radio('REGISTRANTS'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('rifiutato, no', async () => {
    refresh.mockClear();
    fetchMock.mockResolvedValue(rifiuto(409, 'RECORDING_DESTINATION_NOT_COVERED'));
    render({ recordingDestination: 'PUBLIC', recordingAudience: 'REGISTRANTS' });
    await premi(radio('PUBLIC'));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('RecordingManagement — un rifiuto del server', () => {
  it('il codice della destinazione arriva a chi pubblica, e la scelta torna com’era', async () => {
    fetchMock.mockResolvedValue(rifiuto(409, 'RECORDING_DESTINATION_NOT_COVERED'));
    render({ recordingDestination: 'PUBLIC', recordingAudience: 'REGISTRANTS' });
    await premi(radio('PUBLIC'));
    expect(toast.error).toHaveBeenCalledWith(
      messages.apiErrors.recordingDestinationNotCovered
    );
    expect(radio('REGISTRANTS').checked).toBe(true);
  });

  it('vale anche per l’interruttore di pubblicazione', async () => {
    fetchMock.mockResolvedValue(rifiuto(409, 'RECORDING_DESTINATION_NOT_COVERED'));
    render();
    await premi(interruttore());
    expect(interruttore().checked).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      messages.apiErrors.recordingDestinationNotCovered
    );
  });

  it('senza un codice resta il messaggio di sempre', async () => {
    fetchMock.mockResolvedValue(rifiuto(500));
    render();
    await premi(interruttore());
    expect(toast.error).toHaveBeenCalledWith(t.saveFailed);
  });

  it('senza rete resta il messaggio di sempre', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render();
    await premi(interruttore());
    expect(interruttore().checked).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(t.saveFailed);
  });
});

describe('RecordingManagement — durata della registrazione', () => {
  const scelta = (giorni: number) =>
    container.querySelector<HTMLInputElement>(`#retention-${giorni}`)!;

  it('si sceglie anche prima che il video ci sia, e anche dopo averlo tolto', () => {
    render({ recordingUrl: null, status: 'PUBLISHED' });
    expect(container.textContent).toContain(t.retentionLabel);
    expect(scelta(-1).checked).toBe(true);
    // In diretta no: il pannello mostra la registrazione in corso.
    render({ recordingUrl: null, status: 'LIVE' });
    expect(container.textContent).not.toContain(t.retentionLabel);
  });

  it('offre anche un anno, e dice che non segue i dati dell’evento', () => {
    render({ recordingDeleteAfterDays: 365 });
    expect(scelta(365).checked).toBe(true);
    expect(container.textContent).toContain(t.retention['1y']);
    expect(container.textContent).toContain(t.retentionNote);
  });

  it('salva la scelta con il link di conduzione', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    render();
    await premi(scelta(30));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/events/evento-1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ recordingDeleteAfterDays: 30 }),
      })
    );
    expect(scelta(30).checked).toBe(true);
  });

  it('rifiutata, torna com’era e lo dice', async () => {
    fetchMock.mockResolvedValue(rifiuto(403));
    render({ recordingDeleteAfterDays: 90 });
    await premi(scelta(-1));
    expect(scelta(90).checked).toBe(true);
    expect(toast.error).toHaveBeenCalled();
  });
  describe('in un evento nato prima della regola', () => {
    it('non pubblicato, mostra la durata che vale e spegne le scelte piu’ lunghe', () => {
      render({
        legacyRecordingRetention: true,
        dataRetentionDays: 45,
        recordingDeleteAfterDays: 90,
      });
      // La conservazione dei dati, che non e' fra le scelte, si aggiunge.
      expect(scelta(45).checked).toBe(true);
      expect(container.textContent).toContain('45 giorni');
      expect(scelta(30).disabled).toBe(false);
      expect(scelta(90).disabled).toBe(true);
      expect(scelta(-1).disabled).toBe(true);
      expect(container.textContent).toContain(
        t.retentionLegacy.replace(
          '{days, plural, one {# giorno} other {# giorni}}',
          '45 giorni'
        )
      );
    });

    it('pubblicato, si sceglie come sempre', () => {
      render({
        legacyRecordingRetention: true,
        recordingPublished: true,
        recordingDeleteAfterDays: null,
      });
      expect(scelta(-1).checked).toBe(true);
      expect(scelta(365).disabled).toBe(false);
      expect(container.textContent).not.toContain(t.retentionLegacy.slice(0, 30));
    });
  });
});
