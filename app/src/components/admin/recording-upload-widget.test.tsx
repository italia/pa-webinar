// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import inglese from '@/i18n/messages/en.json';
import messaggi from '@/i18n/messages/it.json';

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import RecordingUploadWidget from './recording-upload-widget';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('RecordingUploadWidget', () => {
  it('non promette la pagina pubblica: chi vede il video lo decide l’evento', () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messaggi}>
          <RecordingUploadWidget eventId="evento-1" />
        </NextIntlClientProvider>
      );
    });
    expect(container.textContent).toContain(messaggi.admin.recordingUpload.subtitle);
    expect(messaggi.admin.recordingUpload.subtitle).not.toMatch(/pubblica/i);
    expect(inglese.admin.recordingUpload.subtitle).not.toMatch(/public/i);
  });
});
