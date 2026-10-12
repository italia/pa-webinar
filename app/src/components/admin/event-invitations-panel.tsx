'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { SkeletonLines } from '@/components/ui/skeleton';
import { Link, percorso } from '@/i18n/navigation';

/**
 * Gli invitati dell'evento, con chi si e' gia' iscritto. Con l'accesso «solo
 * su invito» e' l'elenco di chi puo' iscriversi, e la domanda di chi organizza
 * e' «chi manca ancora?»; con l'iscrizione aperta e' l'elenco di chi si e'
 * invitato di persona. Si modifica dal wizard (passo «Persone»).
 *
 * Solo con una sessione dello staff: la rotta degli invitati non accetta il
 * link del moderatore.
 */

interface Invitato {
  id: string;
  name: string | null;
  email: string | null;
  role: 'GUEST' | 'SPEAKER';
  registered: boolean;
  person: { displayName: string | null } | null;
}

type Stato = 'caricamento' | 'pronto' | 'errore';

export default function EventInvitationsPanel({
  eventId,
  invitationOnly,
  editHref,
}: {
  eventId: string;
  /** L'evento accetta iscrizioni solo dagli invitati. */
  invitationOnly: boolean;
  /** La modifica sul passo «Persone» del wizard (percorso interno). */
  editHref: string;
}) {
  const t = useTranslations('admin.invitationsPanel');
  const tc = useTranslations('common');
  const [righe, setRighe] = useState<Invitato[]>([]);
  const [stato, setStato] = useState<Stato>('caricamento');

  const carica = useCallback(async () => {
    setStato('caricamento');
    try {
      const res = await fetch(`/api/admin/events/${eventId}/invitations`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dati = (await res.json()) as { rows: Invitato[] };
      setRighe(dati.rows);
      setStato('pronto');
    } catch {
      setStato('errore');
    }
  }, [eventId]);

  useEffect(() => {
    void carica();
  }, [carica]);

  const iscritti = righe.filter((r) => r.registered).length;

  return (
    <section aria-labelledby="invitati-titolo">
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <h2 id="invitati-titolo" className="fw-semibold mb-0" style={{ color: 'var(--app-text)', fontSize: '1rem' }}>
          {t('title')}
          {stato === 'pronto' && (
            <span className="ms-2" style={{ color: 'var(--app-muted)', fontWeight: 400, fontSize: '0.88rem' }}>
              ({righe.length})
            </span>
          )}
        </h2>
        <Link href={percorso(editHref)} className="btn btn-outline-primary btn-sm">
          {t('edit')}
        </Link>
      </div>
      <p className="mb-3" style={{ color: 'var(--app-muted)', fontSize: '0.88rem' }}>
        {invitationOnly ? t('introInvitationOnly') : t('introOpen')}
      </p>

      {stato === 'caricamento' && <SkeletonLines lines={3} loadingLabel={tc('loading')} />}

      {stato === 'errore' && (
        <div className="alert alert-warning d-flex align-items-center justify-content-between gap-2" role="alert">
          <span>{t('loadError')}</span>
          <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => void carica()}>
            {tc('retry')}
          </button>
        </div>
      )}

      {stato === 'pronto' && righe.length === 0 && (
        <p className={invitationOnly ? 'alert alert-warning mb-0' : 'mb-0'} style={invitationOnly ? undefined : { color: 'var(--app-muted)', fontSize: '0.9rem' }}>
          {invitationOnly ? t('emptyInvitationOnly') : t('empty')}
        </p>
      )}

      {stato === 'pronto' && righe.length > 0 && (
        <>
          <p className="mb-2 fw-semibold" style={{ fontSize: '0.9rem' }}>
            {t('registeredCount', { registered: iscritti, total: righe.length })}
          </p>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th scope="col">{t('name')}</th>
                  <th scope="col">{t('email')}</th>
                  <th scope="col">{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {righe.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.person?.displayName || r.name || <span style={{ color: 'var(--app-muted)' }}>—</span>}
                      {r.role === 'SPEAKER' && (
                        <span className="ms-2 badge bg-light text-dark border">{t('roleSpeaker')}</span>
                      )}
                    </td>
                    <td className="text-break">{r.email}</td>
                    <td>
                      {r.registered ? (
                        <span className="badge bg-success">{t('registered')}</span>
                      ) : (
                        <span className="badge bg-light text-dark border">{t('notRegistered')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
