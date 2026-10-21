import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import DeviceCheck from './device-check';

const t = messages.deviceCheck;
let container: HTMLDivElement;
let root: Root;

function render(props: Parameters<typeof DeviceCheck>[0]) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <DeviceCheck {...props} />
      </NextIntlClientProvider>
    );
  });
}

const interruttori = () =>
  Array.from(container.querySelectorAll<HTMLInputElement>('input[role="switch"]')).map(
    (el) => el.id
  );

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DeviceCheck — microfono e fotocamera concessi dall'evento", () => {
  it('chi può tutto sceglie entrambi', () => {
    render({});
    expect(interruttori()).toEqual([
      'device-check-camera-toggle',
      'device-check-mic-toggle',
    ]);
    expect(container.textContent).toContain(t.avOffHint);
  });

  it('chi ascolta soltanto non ha niente da accendere, e lo legge', () => {
    const onStateChange = vi.fn();
    render({ microfonoConcesso: false, fotocameraConcessa: false, onStateChange });
    expect(interruttori()).toEqual([]);
    expect(container.textContent).toContain(t.avListenOnly);
    expect(onStateChange).toHaveBeenLastCalledWith({ cameraOn: false, micOn: false });
  });

  it("una scelta salvata non accende un mezzo che l'evento non concede", () => {
    window.localStorage.setItem('pawebinar.deviceCheck.partecipa.micOn', '1');
    const onStateChange = vi.fn();
    render({ microfonoConcesso: false, onStateChange });
    expect(interruttori()).toEqual(['device-check-camera-toggle']);
    expect(container.textContent).toContain(t.avMicLocked);
    // L'invito a provare parla solo della fotocamera, non del microfono bloccato.
    expect(container.textContent).toContain(t.avOffHintCamera);
    expect(container.textContent).not.toContain(t.avOffHint);
    expect(onStateChange).toHaveBeenLastCalledWith({ cameraOn: false, micOn: false });
  });
});
