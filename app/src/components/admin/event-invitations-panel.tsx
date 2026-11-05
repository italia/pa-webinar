'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { SkeletonLines } from '@/components/ui/skeleton';
import { Link, percorso } from '@/i18n/navigation';

/**
 * Gli invitati dell'evento, con chi ha ricevuto l'invito e chi si e' gia'
 * iscritto. Con l'accesso «solo su invito» e' l'elenco di chi puo' iscriversi,
 * e la domanda di chi organizza e' «chi manca ancora?»; con l'iscrizione
 * aperta e' l'elenco di chi si invita di persona. L'invito parte per email da
 * qui (lib/email/invitation), quando l'evento e' pubblicato; l'elenco si
 * modifica dal wizard (passo «Persone»).
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
  /** L'ultimo invio dell'invito (ISO); null se non e' mai partito. */
  sentAt: string | null;
  person: { displayName: string | null } | null;
}

type Stato = 'caricamento' | 'pronto' | 'errore';

export default function EventInvitationsPanel({
  eventId,
  invitationOnly,
  editHref,
  inviabile = true,
}: {
  eventId: string;
  /** L'evento accetta iscrizioni solo dagli invitati. */
  invitationOnly: boolean;
  /** L'evento e' pubblicato e non concluso: gli inviti possono partire. */
  inviabile?: boolean;
  /** La modifica sul passo «Persone» del wizard (percorso interno). */
  editHref: string;
}) {
  const t = useTranslations('admin.invitationsPanel');
  const tc = useTranslations('common');
  const [righe, setRighe] = useState<Invitato[]>([]);
  const [stato, setStato] = useState<Stato>('caricamento');
  const format = useFormatter();
  // L'invio in corso (tutti, o un invitato) e il suo esito, detto qui sotto.
  const [invio, setInvio] = useState<string | null>(null);
  const [esito, setEsito] = useState<{ tipo: 'ok' | 'errore'; testo: string } | null>(null);

  const invia = async (ids?: string[]) => {
    setInvio(ids?.[0] ?? 'tutti');
    setEsito(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/invitations/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      if (!res.ok) {
        const codice = ((await res.json().catch(() => ({}))) as { code?: string }).code;
        setEsito({
          tipo: 'errore',
          testo:
            codice === 'EVENT_NOT_SENDABLE'
              ? t('sendNotPublished')
              : res.status === 429
                ? t('sendTooMany')
                : t('sendError'),
        });
        return;
      }
      const { sent, skipped, remaining = 0 } = (await res.json()) as {
        sent: number;
        skipped: number;
        remaining?: number;
      };
      setEsito({
        tipo: 'ok',
        testo:
          t('sendDone', { sent, skipped }) + (remaining > 0 ? ` ${t('sendRemaining', { remaining })}` : ''),
      });
      await carica();
    } catch {
      setEsito({ tipo: 'errore', testo: t('sendError') });
    } finally {
      setInvio(null);
    }
  };

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
  const daInvitare = righe.filter((r) => !r.registered && !r.sentAt).length;

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
      {stato === 'pronto' && righe.length > 0 && (
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!inviabile || daInvitare === 0 || invio !== null}
            onClick={() => void invia()}
          >
            {invio === 'tutti' ? t('sending') : t('sendAll', { count: daInvitare })}
          </button>
          {!inviabile && (
            <span style={{ color: 'var(--app-muted)', fontSize: '0.85rem' }}>{t('sendNotPublished')}</span>
          )}
        </div>
      )}
      {esito && (
        <p
          className={`mb-3 ${esito.tipo === 'ok' ? 'text-success' : 'text-danger'}`}
          role={esito.tipo === 'ok' ? 'status' : 'alert'}
          style={{ fontSize: '0.9rem' }}
        >
          {esito.testo}
        </p>
      )}

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
                  <th scope="col">
                    <span className="visually-hidden">{t('actions')}</span>
                  </th>
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
                      ) : r.sentAt ? (
                        <span className="badge bg-light text-dark border">
                          {t('invitedOn', {
                            date: format.dateTime(new Date(r.sentAt), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                          })}
                        </span>
                      ) : (
                        <span className="badge bg-light text-dark border">{t('notInvited')}</span>
                      )}
                    </td>
                    <td className="text-end">
                      {!r.registered && (
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0"
                          disabled={!inviabile || invio !== null}
                          onClick={() => void invia([r.id])}
                        >
                          {invio === r.id ? t('sending') : r.sentAt ? t('resend') : t('send')}
                          <span className="visually-hidden">{`: ${r.person?.displayName || r.name || r.email || ''}`}</span>
                        </button>
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
