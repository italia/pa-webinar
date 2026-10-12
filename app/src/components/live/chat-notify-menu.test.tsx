import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { DEFAULT_CHAT_NOTIFY_PREFS, type ChatNotifyPrefs } from '@/lib/chat/notify-prefs';

import ChatNotifyMenu from './chat-notify-menu';

/**
 * La campanella della chat: si sceglie quando essere avvisati, il permesso del
 * browser si chiede solo accendendo le notifiche, Esc chiude e rimette il
 * fuoco sulla campanella.
 */

vi.mock('@/lib/chat/chime', () => ({ playChatChime: vi.fn() }));

const t = messages.live.chat;
let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);

function render(prefs: ChatNotifyPrefs = DEFAULT_CHAT_NOTIFY_PREFS) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages}>
        <ChatNotifyMenu prefs={prefs} onChange={onChange} />
      </NextIntlClientProvider>,
    );
  });
}

const bottone = () => container.querySelector<HTMLButtonElement>('.chat-notify__btn')!;
const apri = () => act(() => bottone().click());
const radio = (testo: string) =>
  Array.from(container.querySelectorAll('label')).find((l) => l.textContent === testo)!
    .querySelector('input')!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onChange.mockClear();
  requestPermission.mockClear();
  vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default', requestPermission }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ChatNotifyMenu', () => {
  it('la campanella dice lo stato, e in silenzioso lo dice', () => {
    render();
    expect(bottone().getAttribute('aria-label')).toBe(t.notifyButton);
    expect(bottone().textContent).toContain(t.notifyMentions);
    render({ ...DEFAULT_CHAT_NOTIFY_PREFS, mode: 'off' });
    expect(bottone().getAttribute('aria-label')).toBe(t.notifyButtonOff);
  });

  it('scegliere «Tutti i messaggi» lo salva e chiede il permesso, perché le notifiche sono accese', () => {
    render();
    apri();
    act(() => radio(t.notifyAll).click());
    expect(onChange).toHaveBeenCalledWith({ mode: 'all' });
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('in silenzioso suono e notifiche sono spenti', () => {
    render({ ...DEFAULT_CHAT_NOTIFY_PREFS, mode: 'off' });
    apri();
    const caselle = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(Array.from(caselle).every((c) => c.disabled)).toBe(true);
  });

  it('con le notifiche bloccate dal browser lo spiega e non le offre', () => {
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'denied', requestPermission }));
    render();
    apri();
    expect(container.textContent).toContain(t.notifyDesktopBlocked);
    const notifiche = Array.from(container.querySelectorAll('label'))
      .find((l) => l.textContent === t.notifyDesktop)!
      .querySelector('input')!;
    expect(notifiche.disabled).toBe(true);
  });

  it('Esc chiude il menu e rimette il fuoco sulla campanella', () => {
    render();
    apri();
    expect(container.querySelector('[role=dialog]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(bottone());
  });

  it('con il permesso ancora da decidere la casella non risulta spuntata, e spuntarla lo chiede', async () => {
    render();
    apri();
    const notifiche = Array.from(container.querySelectorAll('label'))
      .find((l) => l.textContent === t.notifyDesktop)!
      .querySelector('input')!;
    expect(notifiche.checked).toBe(false);
    await act(async () => {
      notifiche.click();
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ desktop: true });
  });
});
