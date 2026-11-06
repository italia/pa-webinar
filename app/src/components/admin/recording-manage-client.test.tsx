// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { ComponentProps, ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * La pagina di una registrazione: dice perche' la trascrizione del video non e'
 * partita e con quale conseguenza, e avvia la pipeline con la conferma sulle
 * voci quando la pagina sa gia' che serve.
 */
const { avvia, toast } = vi.hoisted(() => ({
  avvia: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/hooks/use-avvio-pipeline', () => ({ useAvvioPipeline: () => avvia }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  percorso: (p: string) => p,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('./recording-overview', () => ({ default: () => null }));
vi.mock('./transcript-editor', () => ({ default: () => null }));
vi.mock('./summary-editor', () => ({ default: () => null }));
vi.mock('./translation-manager', () => ({ default: () => null }));
vi.mock('./archive-panel', () => ({ default: () => null }));
vi.mock('./ai-reliability-panel', () => ({ default: () => null }));
vi.mock('./recording-slides-panel', () => ({ default: () => null }));

import RecordingManageClient from './recording-manage-client';

const tp = messages.admin.postprod;
const tv = messages.admin.voiceConsent;

let container: HTMLDivElement;
let root: Root;

function disegna(props: Partial<ComponentProps<typeof RecordingManageClient>> = {}) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RecordingManageClient
          recordingId="rec-1"
          eventTitle="Evento"
          eventSlug="evento"
          status="READY"
          durationSec={60}
          sourceLanguage="it"
          createdAt="2026-11-05T10:00:00.000Z"
          {...props}
        />
      </NextIntlClientProvider>
    );
  });
}

const avviso = () => container.querySelector('[role="status"].alert');
const pulsante = (testo: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent === testo)!;
const conPulsante = (testo: string) => testo.replace('{button}', tp.generateAi);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  avvia.mockResolvedValue(new Response(JSON.stringify({ enqueued: 1 })));
  vi.stubGlobal('location', { reload: vi.fn() });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('le azioni della pagina', () => {
  it('vanno a capo: su un telefono non allargano la pagina', () => {
    disegna();
    expect(pulsante(tp.generateAi).parentElement?.classList).toContain('flex-wrap');
  });
});

describe('l’avviso sulla trascrizione ferma', () => {
  it('senza sottotitoli dice che l’evento resta senza trascrizione', () => {
    disegna({ confermaVoci: true, avvisoConfermaVoci: true });
    expect(avviso()?.textContent).toBe(conPulsante(tv.waitingNoCaptions));
  });

  it('con i sottotitoli dice che resta quella trascrizione', () => {
    disegna({ confermaVoci: true, avvisoConfermaVoci: true, restaDaiSottotitoli: true });
    expect(avviso()?.textContent).toBe(conPulsante(tv.waiting));
  });

  it('non compare se la pipeline non sarebbe partita comunque', () => {
    disegna({ confermaVoci: true });
    expect(avviso()).toBeNull();
  });

  it('non compare a pipeline gia’ partita', () => {
    disegna({ confermaVoci: true, avvisoConfermaVoci: true, status: 'POSTPROD_DONE' });
    expect(avviso()).toBeNull();
  });
});

describe('l’avvio della pipeline', () => {
  it('«Genera AI» manda la conferma nota sulle voci, una domanda sola', async () => {
    disegna({ confermaVoci: true, avvisoConfermaVoci: true });
    await act(async () => pulsante(tp.generateAi).click());
    expect(avvia).toHaveBeenCalledWith(
      '/api/admin/postprod/recordings/rec-1/generate-ai',
      { summary: true },
      expect.objectContaining({ confermaVociNota: true })
    );
  });

  it('il rilancio fa lo stesso', async () => {
    disegna({ confermaVoci: true, status: 'POSTPROD_FAILED' });
    await act(async () => pulsante(tp.rerun).click());
    expect(avvia).toHaveBeenCalledWith(
      '/api/admin/postprod/recordings/rec-1/rerun',
      {},
      expect.objectContaining({ confermaVociNota: true })
    );
  });

  it('tracce non ancora arrivate: lo dice, e la pagina resta dov’e’', async () => {
    avvia.mockResolvedValue(new Response(JSON.stringify({ enqueued: 0, tracksPending: true })));
    disegna();
    await act(async () => pulsante(tp.generateAi).click());
    expect(toast.success).toHaveBeenCalledWith(messages.apiErrors.tracksPending);
    expect(toast.error).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('una registrazione che non chiede conferma parte senza quella domanda', async () => {
    disegna();
    await act(async () => pulsante(tp.generateAi).click());
    expect(avvia.mock.calls[0]![2]).toMatchObject({ confermaVociNota: false });
  });

  it('senza file resta l’aggiornamento dai sottotitoli, e nessun avvio', () => {
    disegna({ soloSottotitoli: true });
    expect(pulsante(tp.captionsRebuild)).toBeDefined();
    expect(pulsante(tp.generateAi)).toBeUndefined();
    expect(pulsante(tp.rerun)).toBeUndefined();
  });
});
