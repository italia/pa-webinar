'use client';

/**
 * Promise-based confirmation dialog rendered as a Bootstrap Italia
 * (.italia) Modal — a drop-in replacement for the native
 * window.confirm().
 *
 * Usage:
 *   1. Mount <ConfirmProvider> once high in the tree (already done in
 *      the admin layout).
 *   2. In any descendant client component:
 *        const confirm = useConfirm();
 *        if (!(await confirm({ title: 'Elimina', message: '…', danger: true }))) return;
 *
 * The returned promise resolves to true (Conferma) or false (Annulla /
 * dismiss). Only one dialog is shown at a time.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from 'design-react-kit';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm button in a destructive (red) style. */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface DialogState extends ConfirmOptions {
  open: boolean;
}

export function ConfirmProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, setState] = useState<DialogState>({
    open: false,
    title: '',
    message: '',
  });
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    setState((s) => ({ ...s, open: false }));
    if (resolver.current) {
      resolver.current(value);
      resolver.current = null;
    }
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setState({ open: true, ...options });
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal isOpen={state.open} toggle={() => settle(false)} centered>
        <ModalHeader toggle={() => settle(false)}>{state.title}</ModalHeader>
        <ModalBody>
          <p className="mb-0">{state.message}</p>
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" outline onClick={() => settle(false)}>
            {state.cancelLabel ?? 'Annulla'}
          </Button>
          <Button color={state.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
            {state.confirmLabel ?? 'Conferma'}
          </Button>
        </ModalFooter>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a <ConfirmProvider>');
  }
  return ctx;
}
