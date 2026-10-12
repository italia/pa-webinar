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

interface DeleteEventModalProps {
  eventId: string;
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
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });
      if (res.ok) {
        setIsOpen(false);
        onDeleted();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      setError(body.code === 'EVENT_LIVE' ? t('deleteLiveBlocked') : tc('errorGeneric'));
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
