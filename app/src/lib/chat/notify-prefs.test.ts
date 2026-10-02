import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHAT_NOTIFY_PREFS,
  chatAlertFor,
  parseChatNotifyPrefs,
  type ChatNotifyPrefs,
} from './notify-prefs';

const base = {
  own: false,
  mentionsMe: false,
  repliesToMe: false,
  onScreen: false,
  pageVisible: true,
};
const prefs = (p: Partial<ChatNotifyPrefs> = {}): ChatNotifyPrefs => ({
  ...DEFAULT_CHAT_NOTIFY_PREFS,
  ...p,
});

describe('parseChatNotifyPrefs', () => {
  it('assente o rovinato: il predefinito (solo menzioni, suono e notifica)', () => {
    expect(parseChatNotifyPrefs(null)).toEqual(DEFAULT_CHAT_NOTIFY_PREFS);
    expect(parseChatNotifyPrefs('{non json')).toEqual(DEFAULT_CHAT_NOTIFY_PREFS);
    expect(parseChatNotifyPrefs(JSON.stringify({ mode: 'sempre', sound: 'si' }))).toEqual(
      DEFAULT_CHAT_NOTIFY_PREFS,
    );
  });

  it('un valore valido resta com’è', () => {
    expect(parseChatNotifyPrefs(JSON.stringify({ mode: 'off', sound: false, desktop: false }))).toEqual({
      mode: 'off',
      sound: false,
      desktop: false,
    });
  });
});

describe('chatAlertFor', () => {
  it('mai per un mio messaggio, mai in silenzioso', () => {
    expect(chatAlertFor({ ...base, own: true, mentionsMe: true, prefs: prefs({ mode: 'all' }) })).toEqual({
      sound: false,
      desktop: false,
    });
    expect(chatAlertFor({ ...base, mentionsMe: true, prefs: prefs({ mode: 'off' }) })).toEqual({
      sound: false,
      desktop: false,
    });
  });

  it('solo menzioni: avvisa per una menzione o una risposta, non per gli altri messaggi', () => {
    const p = prefs({ mode: 'mentions' });
    expect(chatAlertFor({ ...base, prefs: p })).toEqual({ sound: false, desktop: false });
    expect(chatAlertFor({ ...base, mentionsMe: true, prefs: p })).toEqual({ sound: true, desktop: true });
    expect(chatAlertFor({ ...base, repliesToMe: true, prefs: p })).toEqual({ sound: true, desktop: true });
  });

  it('tutti i messaggi: avvisa per ogni messaggio degli altri', () => {
    expect(chatAlertFor({ ...base, prefs: prefs({ mode: 'all' }) })).toEqual({ sound: true, desktop: true });
  });

  it('nessun avviso per ciò che si sta già guardando', () => {
    expect(
      chatAlertFor({ ...base, mentionsMe: true, onScreen: true, pageVisible: true, prefs: prefs() }),
    ).toEqual({ sound: false, desktop: false });
    // Chat aperta ma pagina in secondo piano: l'avviso serve.
    expect(
      chatAlertFor({ ...base, mentionsMe: true, onScreen: true, pageVisible: false, prefs: prefs() }),
    ).toEqual({ sound: true, desktop: true });
  });

  it('suono e notifica si spengono uno per uno', () => {
    expect(chatAlertFor({ ...base, mentionsMe: true, prefs: prefs({ sound: false }) })).toEqual({
      sound: false,
      desktop: true,
    });
    expect(chatAlertFor({ ...base, mentionsMe: true, prefs: prefs({ desktop: false }) })).toEqual({
      sound: true,
      desktop: false,
    });
  });
});
