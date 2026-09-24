'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Button, FormGroup, Input, Label } from 'design-react-kit';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

/**
 * Gli organizzatori dell'istanza (ADR-014): chi puo' creare e gestire i
 * propri eventi senza la chiave dell'amministrazione.
 */
interface Riga {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  eventCount: number;
}

export default function OrganizersManagement() {
  const t = useTranslations('admin.organizers');
  const locale = useLocale();
  const fmt = useFormatter();
  const toast = useToast();
  const confirm = useConfirm();

  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [invita, setInvita] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const carica = useCallback(async () => {
    const res = await fetch('/api/admin/organizers', { cache: 'no-store' });
    if (!res.ok) {
      toast.error(t('loadError'));
      setRighe([]);
      return;
    }
    const data = (await res.json()) as { rows: Riga[] };
    setRighe(data.rows);
  }, [t, toast]);

  useEffect(() => {
    void carica();
  }, [carica]);

  async function crea(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      const res = await fetch('/api/admin/organizers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nome, email, invite: invita, locale }),
      });
      if (res.status === 409) {
        toast.error(t('exists'));
        return;
      }
      if (!res.ok) {
        toast.error(t('actionError'));
        return;
      }
      const esito = (await res.json()) as { invited?: boolean };
      if (invita && !esito.invited) toast.error(t('inviteFailed'));
      else toast.success(invita ? t('createdInvited') : t('created'));
      setNome('');
      setEmail('');
      await carica();
    } finally {
      setSalvando(false);
    }
  }

  async function azione(r: Riga, tipo: 'invite' | 'toggle' | 'delete') {
    if (tipo === 'delete') {
      const ok = await confirm({
        title: t('deleteTitle'),
        message: t('deleteMessage', { name: r.name, count: r.eventCount }),
        confirmLabel: t('delete'),
        danger: true,
      });
      if (!ok) return;
    }
    if (tipo === 'toggle' && r.active) {
      const ok = await confirm({
        title: t('deactivateTitle'),
        message: t('deactivateMessage', { name: r.name }),
        confirmLabel: t('deactivate'),
      });
      if (!ok) return;
    }
    const url =
      tipo === 'invite' ? `/api/admin/organizers/${r.id}/invite` : `/api/admin/organizers/${r.id}`;
    const res = await fetch(url, {
      method: tipo === 'invite' ? 'POST' : tipo === 'toggle' ? 'PATCH' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:
        tipo === 'invite'
          ? JSON.stringify({ locale })
          : tipo === 'toggle'
            ? JSON.stringify({ active: !r.active })
            : undefined,
    });
    if (!res.ok) {
      toast.error(t('actionError'));
      return;
    }
    toast.success(
      tipo === 'invite' ? t('invited') : tipo === 'delete' ? t('deleted') : t('updated'),
    );
    await carica();
  }

  return (
    <>
      <section className="mb-5" aria-labelledby="org-nuovo">
        <h2 id="org-nuovo" className="h5 mb-3">
          {t('newTitle')}
        </h2>
        <form onSubmit={crea} className="row g-3 align-items-end" style={{ maxWidth: 860 }}>
          <FormGroup className="col-md-4 mb-0">
            <Label htmlFor="org-nome">{t('name')}</Label>
            <Input
              id="org-nome"
              value={nome}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNome(e.target.value)}
              required
              minLength={2}
            />
          </FormGroup>
          <FormGroup className="col-md-4 mb-0">
            <Label htmlFor="org-email">{t('email')}</Label>
            <Input
              id="org-email"
              type="email"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              required
            />
          </FormGroup>
          <div className="col-md-4">
            <Button type="submit" color="primary" className="w-100" disabled={salvando}>
              {t('add')}
            </Button>
          </div>
          <div className="col-12">
            <div className="form-check">
              <input
                id="org-invita"
                type="checkbox"
                className="form-check-input"
                checked={invita}
                onChange={(e) => setInvita(e.target.checked)}
              />
              <label htmlFor="org-invita" className="form-check-label">
                {t('sendNow')}
              </label>
            </div>
          </div>
        </form>
      </section>

      <section aria-labelledby="org-elenco">
        <h2 id="org-elenco" className="h5 mb-3">
          {t('listTitle')}
        </h2>
        {righe === null ? (
          <p className="text-secondary">{t('loading')}</p>
        ) : righe.length === 0 ? (
          <p className="text-secondary">{t('empty')}</p>
        ) : (
          <div className="table-responsive">
            <table className="table align-middle">
              <caption className="visually-hidden">{t('listTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('name')}</th>
                  <th scope="col">{t('email')}</th>
                  <th scope="col">{t('events')}</th>
                  <th scope="col">{t('lastLogin')}</th>
                  <th scope="col">{t('status')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {righe.map((r) => (
                  <tr key={r.id}>
                    <td className="fw-semibold">{r.name}</td>
                    <td>{r.email}</td>
                    <td>{r.eventCount}</td>
                    <td>
                      {r.lastLoginAt
                        ? fmt.dateTime(new Date(r.lastLoginAt), { dateStyle: 'medium', timeStyle: 'short' })
                        : t('never')}
                    </td>
                    <td>
                      <span className={`badge ${r.active ? 'bg-success' : 'bg-secondary'}`}>
                        {r.active ? t('active') : t('inactive')}
                      </span>
                    </td>
                    <td className="text-end text-nowrap">
                      {r.active && (
                        <Button
                          size="xs"
                          color="primary"
                          outline
                          className="me-2"
                          onClick={() => azione(r, 'invite')}
                          aria-label={t('inviteFor', { name: r.name })}
                        >
                          {t('invite')}
                        </Button>
                      )}
                      <Button
                        size="xs"
                        color="secondary"
                        outline
                        className="me-2"
                        onClick={() => azione(r, 'toggle')}
                        aria-label={
                          r.active
                            ? t('deactivateFor', { name: r.name })
                            : t('activateFor', { name: r.name })
                        }
                      >
                        {r.active ? t('deactivate') : t('activate')}
                      </Button>
                      <Button
                        size="xs"
                        color="danger"
                        outline
                        onClick={() => azione(r, 'delete')}
                        aria-label={t('deleteFor', { name: r.name })}
                      >
                        {t('delete')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
