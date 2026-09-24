'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Button, FormGroup, Input, Label } from 'design-react-kit';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

/**
 * Le utenze dello staff (ADR-014): organizzatori, che gestiscono i propri
 * eventi, e amministratori, che gestiscono l'istanza con un nome proprio
 * invece della chiave condivisa.
 */
type Ruolo = 'ORGANIZER' | 'ADMIN';

interface Riga {
  id: string;
  name: string;
  email: string;
  role: Ruolo;
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
  const [io, setIo] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [ruolo, setRuolo] = useState<Ruolo>('ORGANIZER');
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
    const data = (await res.json()) as { rows: Riga[]; selfId: string | null };
    setRighe(data.rows);
    setIo(data.selfId);
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
        body: JSON.stringify({ name: nome, email, role: ruolo, invite: invita, locale }),
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
      setRuolo('ORGANIZER');
      await carica();
    } finally {
      setSalvando(false);
    }
  }

  async function cambiaRuolo(r: Riga, nuovo: Ruolo) {
    if (nuovo === r.role) return;
    const ok = await confirm(
      nuovo === 'ADMIN'
        ? {
            title: t('promoteTitle'),
            message: t('promoteMessage', { name: r.name }),
            confirmLabel: t('promote'),
            danger: true,
          }
        : {
            title: t('demoteTitle'),
            message: t('demoteMessage', { name: r.name }),
            confirmLabel: t('demote'),
          }
    );
    if (!ok) return;
    const res = await fetch(`/api/admin/organizers/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: nuovo }),
    });
    if (!res.ok) {
      toast.error(t('actionError'));
      return;
    }
    toast.success(t('updated'));
    await carica();
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
      tipo === 'invite'
        ? `/api/admin/organizers/${r.id}/invite`
        : `/api/admin/organizers/${r.id}`;
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
      tipo === 'invite' ? t('invited') : tipo === 'delete' ? t('deleted') : t('updated')
    );
    await carica();
  }

  return (
    <>
      <section className="mb-5" aria-labelledby="org-nuovo">
        <h2 id="org-nuovo" className="h5 mb-3">
          {t('newTitle')}
        </h2>
        <form
          onSubmit={crea}
          className="row g-3 align-items-end"
          style={{ maxWidth: 860 }}
        >
          <FormGroup className="col-md-3 mb-0">
            <Label htmlFor="org-nome">{t('name')}</Label>
            <Input
              id="org-nome"
              value={nome}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNome(e.target.value)
              }
              required
              minLength={2}
            />
          </FormGroup>
          <FormGroup className="col-md-3 mb-0">
            <Label htmlFor="org-email">{t('email')}</Label>
            <Input
              id="org-email"
              type="email"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEmail(e.target.value)
              }
              required
            />
          </FormGroup>
          <div className="col-md-3">
            <label htmlFor="org-ruolo" className="form-label">
              {t('role')}
            </label>
            <select
              id="org-ruolo"
              className="form-select"
              value={ruolo}
              onChange={(e) => setRuolo(e.target.value as Ruolo)}
              aria-describedby="org-ruolo-aiuto"
            >
              <option value="ORGANIZER">{t('roleOrganizer')}</option>
              <option value="ADMIN">{t('roleAdmin')}</option>
            </select>
          </div>
          <div className="col-md-3">
            <Button type="submit" color="primary" className="w-100" disabled={salvando}>
              {t('add')}
            </Button>
          </div>
          <div className="col-12">
            <p id="org-ruolo-aiuto" className="form-text mt-0 mb-2">
              {t('roleHelp')}
            </p>
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
                  <th scope="col">{t('role')}</th>
                  <th scope="col">{t('events')}</th>
                  <th scope="col">{t('lastLogin')}</th>
                  <th scope="col">{t('status')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {righe.map((r) => {
                  const sonoIo = r.id === io;
                  return (
                    <tr key={r.id}>
                      <td className="fw-semibold">
                        {r.name}
                        {sonoIo && (
                          <span className="text-secondary fw-normal"> ({t('you')})</span>
                        )}
                      </td>
                      <td>{r.email}</td>
                      <td>
                        {sonoIo ? (
                          t(r.role === 'ADMIN' ? 'roleAdmin' : 'roleOrganizer')
                        ) : (
                          <select
                            className="form-select form-select-sm"
                            value={r.role}
                            onChange={(e) => void cambiaRuolo(r, e.target.value as Ruolo)}
                            aria-label={t('roleFor', { name: r.name })}
                          >
                            <option value="ORGANIZER">{t('roleOrganizer')}</option>
                            <option value="ADMIN">{t('roleAdmin')}</option>
                          </select>
                        )}
                      </td>
                      <td>{r.eventCount}</td>
                      <td>
                        {r.lastLoginAt
                          ? fmt.dateTime(new Date(r.lastLoginAt), {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                          : t('never')}
                      </td>
                      <td>
                        <span
                          className={`badge ${r.active ? 'bg-success' : 'bg-secondary'}`}
                        >
                          {r.active ? t('active') : t('inactive')}
                        </span>
                      </td>
                      <td className="text-end text-nowrap">
                        {/* Le proprie azioni no: togliersi l'accesso per errore
                          lascerebbe l'istanza senza chi la amministra. */}
                        {sonoIo ? (
                          <span className="small text-secondary">{t('selfLocked')}</span>
                        ) : (
                          <>
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
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
