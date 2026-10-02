/**
 * Preferenze di avviso della chat, scelte da ogni partecipante e ricordate dal
 * browser: quando suonare e quando mostrare una notifica di sistema.
 *
 * - `all`: ogni messaggio degli altri;
 * - `mentions` (predefinito): solo i messaggi che mi nominano o che rispondono
 *   a un mio messaggio;
 * - `off`: silenzio, nessun suono e nessuna notifica (il contatore dei non
 *   letti sulla scheda resta).
 *
 * Nessun avviso per un messaggio che si sta gia' guardando: chat aperta e
 * pagina in primo piano.
 */

export type ChatAlertMode = 'all' | 'mentions' | 'off';

export interface ChatNotifyPrefs {
  mode: ChatAlertMode;
  sound: boolean;
  /** Notifica del browser: serve anche il permesso del browser. */
  desktop: boolean;
}

export const DEFAULT_CHAT_NOTIFY_PREFS: ChatNotifyPrefs = {
  mode: 'mentions',
  sound: true,
  desktop: true,
};

/** Chiave del browser (localStorage): vale per tutte le sale. */
export const CHAT_NOTIFY_STORAGE_KEY = 'pa-webinar.chat-notify';

const MODI: readonly ChatAlertMode[] = ['all', 'mentions', 'off'];

/** Legge le preferenze salvate; un valore assente o rovinato torna al predefinito. */
export function parseChatNotifyPrefs(raw: string | null | undefined): ChatNotifyPrefs {
  if (!raw) return { ...DEFAULT_CHAT_NOTIFY_PREFS };
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof ChatNotifyPrefs, unknown>>;
    return {
      mode: MODI.includes(v.mode as ChatAlertMode)
        ? (v.mode as ChatAlertMode)
        : DEFAULT_CHAT_NOTIFY_PREFS.mode,
      sound: typeof v.sound === 'boolean' ? v.sound : DEFAULT_CHAT_NOTIFY_PREFS.sound,
      desktop: typeof v.desktop === 'boolean' ? v.desktop : DEFAULT_CHAT_NOTIFY_PREFS.desktop,
    };
  } catch {
    return { ...DEFAULT_CHAT_NOTIFY_PREFS };
  }
}

export interface ChatAlertInput {
  prefs: ChatNotifyPrefs;
  /** Il messaggio e' mio: mai un avviso. */
  own: boolean;
  mentionsMe: boolean;
  repliesToMe: boolean;
  /** La chat e' la scheda aperta e il messaggio e' nella lista visibile. */
  onScreen: boolean;
  /** La pagina e' in primo piano (document.visibilityState). */
  pageVisible: boolean;
}

/** Che cosa fare per un messaggio appena arrivato. */
export function chatAlertFor(i: ChatAlertInput): { sound: boolean; desktop: boolean } {
  const nessuno = { sound: false, desktop: false };
  if (i.own || i.prefs.mode === 'off') return nessuno;
  const rilevante = i.prefs.mode === 'all' || i.mentionsMe || i.repliesToMe;
  if (!rilevante) return nessuno;
  // Lo si sta gia' guardando: nessun rumore.
  if (i.onScreen && i.pageVisible) return nessuno;
  return { sound: i.prefs.sound, desktop: i.prefs.desktop };
}
