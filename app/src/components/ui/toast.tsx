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
 * Toasts render fixed top-right, auto-dismiss after ~4s, and are
 * announced to assistive tech via role="status" + aria-live="polite".
 *
 * We deliberately avoid design-react-kit's <Icon> here: it has caused
 * hydration mismatches in components that render on every page (see
 * project memory). Icons are inline SVG instead.
 */

import {
  createContext,
  useCallback,
  useContext,
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

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((prev) => [...prev, { id, variant, message }]);
      setTimeout(() => remove(id), AUTO_DISMISS_MS);
    },
    [remove],
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
            role="status"
            className={`bg-white shadow rounded border-start border-4 ${VARIANT_CLASS[t.variant]} d-flex align-items-start gap-2 p-3`}
            style={{ pointerEvents: 'auto' }}
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
              aria-label="Chiudi"
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
