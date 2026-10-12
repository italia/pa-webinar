'use client';

/**
 * Correzione e cancellazione di un'iscrizione dalla scheda Persone, per le
 * richieste di rettifica (art. 16) o di cancellazione (art. 17) che arrivano
 * allo staff per altre vie. La rotta e' la stessa per l'amministrazione e per
 * chi organizza l'evento (ADR-014).
 *
 * L'email non si mostra: e' cifrata e la pagina non la decifra. Si scrive solo
 * quella nuova, se va cambiata.
 */
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'design-react-kit';

import { useRouter } from '@/i18n/navigation';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

interface RegistrationRow {
  id: string;
  displayName: string;
  organization: string | null;
  organizationRole: string | null;
}

export default function RegistrationRowActions({
  eventId,
  registration,
}: {
  eventId: string;
  registration: RegistrationRow;
}) {
  const t = useTranslations('admin.registrationActions');
  const tc = useTranslations('common');
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(registration.displayName);
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState(registration.organization ?? '');
  const [role, setRole] = useState(registration.organizationRole ?? '');

  const url = `/api/admin/events/${eventId}/registrations/${registration.id}`;

  const save = useCallback(async () => {
    const body: Record<string, string | null> = {};
    if (name.trim() !== registration.displayName) body.displayName = name.trim();
    if (email.trim()) body.email = email.trim();
    if (organization.trim() !== (registration.organization ?? '')) {
      body.organization = organization.trim() || null;
    }
    if (role.trim() !== (registration.organizationRole ?? '')) {
      body.organizationRole = role.trim() || null;
    }
    if (Object.keys(body).length === 0) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const { code } = (await res.json().catch(() => ({}))) as { code?: string };
        toast.error(t(code === 'ADDRESS_BOOK_LINKED' ? 'addressBookLinked' : 'emailTaken'));
        return;
      }
      if (!res.ok) {
        toast.error(t('failed'));
        return;
      }
      toast.success(t('saved'));
      setOpen(false);
      setEmail('');
      router.refresh();
    } catch {
      toast.error(t('failed'));
    } finally {
      setBusy(false);
    }
  }, [name, email, organization, role, registration, url, toast, t, router]);

  const remove = useCallback(async () => {
    const ok = await confirm({
      title: t('deleteTitle'),
      message: t('deleteBody', { name: registration.displayName }),
      confirmLabel: t('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('failed'));
        return;
      }
      toast.success(t('deleted'));
      router.refresh();
    } catch {
      toast.error(t('failed'));
    } finally {
      setBusy(false);
    }
  }, [confirm, registration.displayName, url, toast, t, tc, router]);

  return (
    <div className="d-flex gap-2 justify-content-end">
      <button
        type="button"
        className="btn btn-outline-primary btn-sm"
        onClick={() => setOpen(true)}
        disabled={busy}
        aria-label={t('editFor', { name: registration.displayName })}
      >
        {t('edit')}
      </button>
      <button
        type="button"
        className="btn btn-outline-danger btn-sm"
        onClick={remove}
        disabled={busy}
        aria-label={t('deleteFor', { name: registration.displayName })}
      >
        {t('delete')}
      </button>

      <Modal isOpen={open} toggle={() => setOpen(false)} centered>
        <ModalHeader closeAriaLabel={tc('close')} toggle={() => setOpen(false)}>
          {t('editTitle')}
        </ModalHeader>
        <ModalBody>
          <div className="mb-3">
            <label htmlFor={`reg-name-${registration.id}`} className="form-label">
              {t('name')}
            </label>
            <input
              id={`reg-name-${registration.id}`}
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="mb-3">
            <label htmlFor={`reg-email-${registration.id}`} className="form-label">
              {t('newEmail')}
            </label>
            <input
              id={`reg-email-${registration.id}`}
              type="email"
              className="form-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={`reg-email-help-${registration.id}`}
              maxLength={254}
            />
            <small id={`reg-email-help-${registration.id}`} className="form-text">
              {t('newEmailHelp')}
            </small>
          </div>
          <div className="mb-3">
            <label htmlFor={`reg-org-${registration.id}`} className="form-label">
              {t('organization')}
            </label>
            <input
              id={`reg-org-${registration.id}`}
              className="form-control"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <label htmlFor={`reg-role-${registration.id}`} className="form-label">
              {t('organizationRole')}
            </label>
            <input
              id={`reg-role-${registration.id}`}
              className="form-control"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              maxLength={200}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" outline onClick={() => setOpen(false)} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button color="primary" onClick={save} disabled={busy || name.trim().length < 2}>
            {busy ? tc('loading') : t('save')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
