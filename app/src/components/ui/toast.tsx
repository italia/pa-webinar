'use client';

/**
 * Minimal toast notification system, styled with Bootstrap Italia
 * (.italia) utility classes.
 *
 * Usage:
 *   1. Mount <ToastProvider> once high in the tree (already done in the
 *      admin layout).
 *   2. In any descendant client component:
 *        const toast = useToast();
 *        toast.success('Salvato');
 *        toast.error('Operazione fallita');
 *        toast.info('In corso…');
 *
 * Toasts render fixed top-right. Successi e informazioni si chiudono da soli
 * dopo ~4 s, con il conteggio fermo finche' il puntatore o il fuoco ci sono
 * sopra; gli errori restano finche' non li si chiude, perche' chi non ha
 * fatto in tempo a leggerli non saprebbe cosa e' andato storto. Gli errori
 * sono annunciati subito (role="alert"), gli altri con calma (role="status").
 * Un errore riguarda la pagina in cui e' nato: cambiando pagina si chiude.
 * Una conferma invece puo' accompagnare il passaggio (salva, poi vai).
 *
 * We deliberately avoid design-react-kit's <Icon> here: it has caused
 * hydration mismatches in components that render on every page. Icons
 * are inline SVG instead.
 */

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 4000;
const MASSIMO = 5;

/**
 * Al massimo cinque alla volta. Lascia il posto prima la conferma piu'
 * vecchia: un errore non ancora letto non lo scaccia una raffica di successi.
 * L'ultimo arrivato resta sempre: se prima ci sono solo errori, esce il piu'
 * vecchio.
 */
function limita(toasts: ToastItem[]): ToastItem[] {
  const restano = [...toasts];
  while (restano.length > MASSIMO) {
    const conferma = restano.slice(0, -1).findIndex((t) => t.variant !== 'error');
    restano.splice(conferma === -1 ? 0 : conferma, 1);
  }
  return restano;
}

const VARIANT_CLASS: Record<ToastVariant, string> = {
  success: 'border-success',
  error: 'border-danger',
  info: 'border-primary',
};

const VARIANT_ICON_COLOR: Record<ToastVariant, string> = {
  success: '#008758',
  error: '#d9364f',
  info: '#0066cc',
};

function ToastIcon({ variant }: { variant: ToastVariant }): React.ReactElement {
  const color = VARIANT_ICON_COLOR[variant];
  // Inline SVG (not design-react-kit <Icon>) to avoid hydration mismatch.
  if (variant === 'success') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill={color} />
        <path d="M7 12.5l3 3 7-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (variant === 'error') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill={color} />
        <path d="M8 8l8 8M16 8l-8 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill={color} />
      <path d="M12 11v5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="7.5" r="1.25" fill="#fff" />
    </svg>
  );
}

export function ToastProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const tc = useTranslations('common');
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // I toast con il puntatore sopra e quelli con il fuoco dentro.
  const sopra = useRef(new Set<number>());
  const aFuoco = useRef(new Set<number>());

  const remove = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    sopra.current.delete(id);
    aFuoco.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Il conto alla rovescia di un toast che si chiude da solo.
  const avvia = useCallback(
    (id: number) => {
      const prima = timers.current.get(id);
      if (prima) clearTimeout(prima);
      timers.current.set(
        id,
        setTimeout(() => remove(id), AUTO_DISMISS_MS),
      );
    },
    [remove],
  );
  const ferma = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  // Il conto riparte solo quando ne' il puntatore ne' il fuoco sono sul
  // toast: chi ci e' arrivato con la tastiera non se lo vede sparire.
  const entra = useCallback(
    (insieme: Set<number>, id: number) => {
      insieme.add(id);
      ferma(id);
    },
    [ferma],
  );
  const esce = useCallback(
    (insieme: Set<number>, id: number) => {
      insieme.delete(id);
      if (!sopra.current.has(id) && !aFuoco.current.has(id)) avvia(id);
    },
    [avvia],
  );

  const pathname = usePathname();
  useEffect(() => {
    setToasts((prev) => (prev.some((t) => t.variant === 'error') ? prev.filter((t) => t.variant !== 'error') : prev));
  }, [pathname]);

  useEffect(() => {
    const attivi = timers.current;
    return () => {
      for (const timer of attivi.values()) clearTimeout(timer);
      attivi.clear();
    };
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((prev) => limita([...prev, { id, variant, message }]));
      if (variant !== 'error') avvia(id);
    },
    [avvia],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
      info: (message: string) => push('info', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: 'fixed',
          top: '1rem',
          right: '1rem',
          zIndex: 2000,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          maxWidth: 'min(360px, calc(100vw - 2rem))',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.variant === 'error' ? 'alert' : 'status'}
            className={`bg-white shadow rounded border-start border-4 ${VARIANT_CLASS[t.variant]} d-flex align-items-start gap-2 p-3`}
            style={{ pointerEvents: 'auto' }}
            onMouseEnter={t.variant === 'error' ? undefined : () => entra(sopra.current, t.id)}
            onMouseLeave={t.variant === 'error' ? undefined : () => esce(sopra.current, t.id)}
            onFocus={t.variant === 'error' ? undefined : () => entra(aFuoco.current, t.id)}
            onBlur={
              t.variant === 'error'
                ? undefined
                : (e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) esce(aFuoco.current, t.id);
                  }
            }
          >
            <span className="flex-shrink-0 d-inline-flex" style={{ lineHeight: 0, marginTop: 2 }}>
              <ToastIcon variant={t.variant} />
            </span>
            <span className="flex-grow-1" style={{ fontSize: '0.9rem', color: '#17324d' }}>
              {t.message}
            </span>
            <button
              type="button"
              className="btn-close flex-shrink-0"
              aria-label={tc('close')}
              onClick={() => remove(t.id)}
              style={{ fontSize: '0.7rem' }}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return ctx;
}
