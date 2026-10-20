'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import useSWR from 'swr';

import {
  clampPage,
  newerState,
  presentationView,
  type PresentationView,
} from '@/lib/presentation/client-state';
import type { PresentationPointer, PresentationState } from '@/lib/presentation/types';

/**
 * La presentazione di un PDF nella sala, lato browser: legge lo stato, lo
 * tiene allineato al canale e, per chi può presentare, avvia, gira pagina e
 * chiude (rotte /api/events/[param]/presentation).
 *
 * Si monta una volta, nel contenitore della sala, e arriva ai pannelli con
 * `PresentationContext`: la scena della presentazione e il pannello dei
 * materiali devono vedere lo stesso stato, non due copie che divergono.
 */

/** Perché un'azione di chi presenta non è andata, per il messaggio da mostrare. */
export type PresentationActionError =
  'changed' | 'closed' | 'notPresentable' | 'forbidden' | 'generic';

export interface PresentationControls {
  view: PresentationView;
  /** La pagina da mostrare: quella di chi presenta, o quella appena chiesta da questo browser. */
  displayPage: number;
  /** Chi conduce o un relatore: può avviare, girare pagina e chiudere. */
  canPresent: boolean;
  /**
   * Avvia la presentazione di un materiale (sostituisce quella in corso), dalla
   * pagina indicata o dalla prima.
   */
  start: (materialId: string, page?: number) => Promise<PresentationActionError | null>;
  /**
   * «Presenta tu»: chi può presentare prende la presentazione in corso, sullo
   * stesso documento, dalla pagina indicata (quella che sta guardando) o da
   * quella di chi presenta. Il suo nome compare come chi presenta.
   */
  takeOver: (page?: number) => Promise<PresentationActionError | null>;
  /** Va a una pagina del documento presentato. Le richieste ravvicinate si accorpano. */
  goTo: (page: number, pageCount?: number) => void;
  /** Chiude la presentazione in corso. */
  stop: () => Promise<PresentationActionError | null>;
  /** Avvio o chiusura in corso. */
  busy: boolean;
  /**
   * L'ultima azione di chi presenta non riuscita (un cambio di pagina o la
   * chiusura); null dopo una riuscita. L'avvio risponde a chi lo chiama.
   */
  actionError: PresentationActionError | null;
  /** Rilegge lo stato completo. */
  refresh: () => void;
}

/** Chi assiste rilegge lo stato completo entro questo intervallo, non tutti insieme. */
const RILETTURA_MAX_MS = 800;

export const PresentationContext = createContext<PresentationControls | null>(null);

/** I controlli della presentazione della sala, o null fuori dalla sala. */
export function usePresentationControls(): PresentationControls | null {
  return useContext(PresentationContext);
}

/** La chiave SWR dello stato: il token resta fuori dall'URL, come per i materiali. */
export function presentationKey(eventSlug: string, token: string): [string, string] {
  return [`/api/events/${eventSlug}/presentation`, token];
}

/**
 * Lo stato completo, o null se il server non lo dà a questo chiamante (401,
 * 403: non sta nella stanza). Ogni altro errore solleva: SWR tiene allora lo
 * stato di prima, e un 502 di passaggio non toglie la slide a tutta la sala
 * né le fa riscaricare il documento.
 */
export async function fetchPresentation([url, token]: readonly [
  string,
  string,
]): Promise<PresentationState | null> {
  const res = await fetch(url, {
    cache: 'no-store',
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`presentation: HTTP ${res.status}`);
  return (await res.json()) as PresentationState;
}

/** L'errore da mostrare per una risposta non riuscita delle mutazioni. */
export function actionErrorFromResponse(
  status: number,
  code?: string
): PresentationActionError {
  if (status === 409) return code === 'EVENT_CLOSED' ? 'closed' : 'changed';
  if (status === 422 && code === 'NOT_PRESENTABLE') return 'notPresentable';
  if (status === 401 || status === 403) return 'forbidden';
  return 'generic';
}

/**
 * Il messaggio di un'azione di chi presenta non riuscita, dal namespace
 * `presentation` (il `t` di `useTranslations('presentation')`).
 */
export function presentationErrorMessage(
  t: (key: `errors.${PresentationActionError}`) => string,
  errore: PresentationActionError
): string {
  return t(`errors.${errore}`);
}

async function erroreDi(res: Response): Promise<PresentationActionError> {
  let code: string | undefined;
  try {
    code = ((await res.json()) as { code?: string }).code;
  } catch {
    // Risposta non JSON (un proxy): conta solo lo stato.
  }
  return actionErrorFromResponse(res.status, code);
}

interface UsePresentationOptions {
  eventSlug: string;
  token: string;
  /** Il puntatore arrivato dal canale della sala (hooks/use-live-state). */
  pointer: PresentationPointer | null;
  /** Il canale consegna: il polling resta solo come rete lenta. */
  pushLive: boolean;
  canPresent: boolean;
  /** Falso finché non si è nella chiamata: in sala d'attesa non si legge nulla. */
  active?: boolean;
}

export function usePresentation({
  eventSlug,
  token,
  pointer,
  pushLive,
  canPresent,
  active = true,
}: UsePresentationOptions): PresentationControls {
  const url = `/api/events/${eventSlug}/presentation`;
  const { data, mutate } = useSWR<PresentationState | null>(
    active ? presentationKey(eventSlug, token) : null,
    fetchPresentation,
    {
      // Con il canale vivo le pagine arrivano da sole: un giro lento ripara un
      // messaggio perso. Senza, il giro è l'unica fonte: rapido mentre si
      // presenta, lento quando non succede niente.
      refreshInterval: (ultimo) =>
        pushLive ? 60_000 : ultimo?.presentation ? 4_000 : 15_000,
      revalidateOnFocus: true,
    }
  );

  // Le risposte alle proprie mutazioni: chi presenta vede subito l'esito,
  // senza aspettare il canale.
  const [mio, setMio] = useState<PresentationState | null>(null);
  const completo = newerState(data, mio);
  const view = useMemo(
    () => presentationView(eventSlug, completo, pointer),
    [eventSlug, completo, pointer]
  );

  // Il canale ha annunciato un documento nuovo, o un passaggio di mano: si
  // rilegge lo stato completo (titolo, chi presenta). Una volta per versione.
  // Chi assiste aspetta un istante a caso, come per il file: una sala piena
  // che rilegge nello stesso millisecondo è un picco evitabile.
  const rilettoRef = useRef(-1);
  useEffect(() => {
    if (!view.stale || view.version <= rilettoRef.current) return;
    const versione = view.version;
    const rileggi = () => {
      rilettoRef.current = versione;
      void mutate();
    };
    if (canPresent) {
      rileggi();
      return;
    }
    const timer = setTimeout(rileggi, Math.floor(Math.random() * RILETTURA_MAX_MS));
    return () => clearTimeout(timer);
  }, [view.stale, view.version, mutate, canPresent]);

  const accogli = useCallback((stato: PresentationState) => {
    setMio((prima) => newerState(prima, stato));
  }, []);

  // ── Pagine: l'ultima chiesta vince ───────────────────────────────────────
  // Chi gira tre pagine di fila non manda tre richieste in parallelo, che
  // potrebbero arrivare in un altro ordine: ne parte una alla volta, e quella
  // dopo porta l'ultima pagina chiesta nel frattempo. Fino all'esito la pagina
  // chiesta si mostra subito (`attesa`).
  const [attesa, setAttesa] = useState<{ materialId: string; page: number } | null>(null);
  const desiderataRef = useRef<{
    materialId: string;
    page: number;
    pageCount?: number;
  } | null>(null);
  const inVoloRef = useRef(false);
  const [actionError, setActionError] = useState<PresentationActionError | null>(null);

  const goTo = useCallback(
    (page: number, pageCount?: number) => {
      const materialId = view.materialId;
      if (!canPresent || !materialId) return;
      const pagina = clampPage(page, pageCount);
      desiderataRef.current = {
        materialId,
        page: pagina,
        ...(pageCount ? { pageCount } : {}),
      };
      setAttesa({ materialId, page: pagina });
      if (inVoloRef.current) return;
      inVoloRef.current = true;
      void (async () => {
        try {
          while (desiderataRef.current) {
            const prossima = desiderataRef.current;
            desiderataRef.current = null;
            let res: Response;
            try {
              res = await fetch(url, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(prossima),
              });
            } catch {
              setActionError('generic');
              continue;
            }
            if (res.ok) {
              setActionError(null);
              accogli((await res.json()) as PresentationState);
            } else {
              const errore = await erroreDi(res);
              setActionError(errore);
              // Il documento è cambiato (o la presentazione è chiusa): le
              // pagine ancora in coda erano per l'altro.
              if (errore === 'changed' || errore === 'closed') {
                desiderataRef.current = null;
                void mutate();
              }
            }
          }
        } finally {
          inVoloRef.current = false;
          setAttesa(null);
        }
      })();
    },
    [view.materialId, canPresent, url, token, accogli, mutate]
  );

  const displayPage =
    attesa && attesa.materialId === view.materialId ? attesa.page : view.page;

  // ── Avvio e chiusura ─────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);

  const start = useCallback(
    async (
      materialId: string,
      page?: number
    ): Promise<PresentationActionError | null> => {
      if (!canPresent) return 'forbidden';
      setBusy(true);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(page && page > 1 ? { materialId, page } : { materialId }),
        });
        if (!res.ok) return await erroreDi(res);
        accogli((await res.json()) as PresentationState);
        setActionError(null);
        return null;
      } catch {
        return 'generic';
      } finally {
        setBusy(false);
      }
    },
    [canPresent, url, token, accogli]
  );

  const stop = useCallback(async (): Promise<PresentationActionError | null> => {
    const materialId = view.materialId;
    if (!canPresent) return 'forbidden';
    if (!materialId) return null;
    setBusy(true);
    try {
      const res = await fetch(`${url}?materialId=${encodeURIComponent(materialId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // Anche la scena deve dirlo: chi presenta crederebbe chiusa una
        // presentazione che la sala vede ancora.
        const errore = await erroreDi(res);
        setActionError(errore);
        void mutate();
        return errore;
      }
      desiderataRef.current = null;
      accogli((await res.json()) as PresentationState);
      setActionError(null);
      return null;
    } catch {
      setActionError('generic');
      return 'generic';
    } finally {
      setBusy(false);
    }
  }, [view.materialId, canPresent, url, token, accogli, mutate]);

  const takeOver = useCallback(
    async (page?: number): Promise<PresentationActionError | null> => {
      const materialId = view.materialId;
      if (!materialId) return null;
      const errore = await start(materialId, page ?? view.page);
      setActionError(errore);
      if (errore) void mutate();
      return errore;
    },
    [view.materialId, view.page, start, mutate]
  );

  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);

  // Il valore del contesto: un oggetto nuovo solo quando cambia qualcosa, non
  // a ogni disegno della sala (contatori, flag, timer), che altrimenti
  // ridisegnerebbe la scena e l'elenco dei materiali.
  return useMemo(
    () => ({
      view,
      displayPage,
      canPresent,
      start,
      takeOver,
      goTo,
      stop,
      busy,
      actionError,
      refresh,
    }),
    [
      view,
      displayPage,
      canPresent,
      start,
      takeOver,
      goTo,
      stop,
      busy,
      actionError,
      refresh,
    ]
  );
}
