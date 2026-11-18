// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from 'design-react-kit';

import { eliminaEvento } from '@/lib/events/event-actions';

interface DeleteEventModalProps {
  eventId: string;
  /** Vuoto per l'admin che non organizza l'evento: non ha il link di
   *  conduzione, ed elimina con la propria sessione (la rotta in blocco). */
  moderatorToken: string;
  onDeleted: () => void;
}


export default function DeleteEventModal({
  eventId,
  moderatorToken,
  onDeleted,
}: DeleteEventModalProps) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const [isOpen, setIsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const esito = await eliminaEvento(eventId, moderatorToken);
      if (esito.ok) {
        setIsOpen(false);
        onDeleted();
        return;
      }
      setError(esito.codice === 'EVENT_LIVE' ? t('deleteLiveBlocked') : tc('errorGeneric'));
    } catch {
      setError(tc('errorGeneric'));
    } finally {
      setDeleting(false);
    }
  }, [eventId, moderatorToken, onDeleted, t, tc]);

  const chiudi = () => {
    setIsOpen(false);
    setError(null);
  };

  return (
    <>
      <Button color="danger" outline onClick={() => setIsOpen(true)}>
        {t('deleteEvent')}
      </Button>
      <Modal isOpen={isOpen} toggle={chiudi} centered>
        <ModalHeader closeAriaLabel={tc('close')} toggle={chiudi}>
          {t('deleteEvent')}
        </ModalHeader>
        <ModalBody>
          <p className={error ? undefined : 'mb-0'}>{t('deleteConfirm')}</p>
          {error && (
            <div className="alert alert-danger mb-0" role="alert">
              {error}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            color="secondary"
            outline
            onClick={chiudi}
            disabled={deleting}
          >
            {tc('cancel')}
          </Button>
          <Button
            color="danger"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? tc('loading') : tc('delete')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
