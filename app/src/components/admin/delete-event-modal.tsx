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

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/events/${eventId}?token=${moderatorToken}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        setIsOpen(false);
        onDeleted();
      }
    } finally {
      setDeleting(false);
    }
  }, [eventId, moderatorToken, onDeleted]);

  return (
    <>
      <Button color="danger" outline onClick={() => setIsOpen(true)}>
        {t('deleteEvent')}
      </Button>
      <Modal isOpen={isOpen} toggle={() => setIsOpen(false)} centered>
        <ModalHeader toggle={() => setIsOpen(false)}>
          {t('deleteEvent')}
        </ModalHeader>
        <ModalBody>
          <p>{t('deleteConfirm')}</p>
        </ModalBody>
        <ModalFooter>
          <Button
            color="secondary"
            outline
            onClick={() => setIsOpen(false)}
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
