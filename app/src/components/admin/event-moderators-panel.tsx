'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Input, Label } from 'design-react-kit';

type GrantRole = 'MODERATOR' | 'SPEAKER';

interface ModeratorRow {
  id: string;
  name: string;
  email: string | null;
  role: GrantRole;
  token: string;
  createdAt: string;
  revokedAt: string | null;
}

interface Props {
  eventId: string;
  eventSlug: string;
  moderatorToken: string;
  baseUrl: string;
  locale: string;
}

export default function EventModeratorsPanel({
  eventId,
  eventSlug,
  moderatorToken,
  baseUrl,
  locale,
}: Props) {
  const t = useTranslations('admin.coModerators');
  const tc = useTranslations('common');

  const [rows, setRows] = useState<ModeratorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<GrantRole>('MODERATOR');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const authHeader = { Authorization: `Bearer ${moderatorToken}` };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/events/${eventId}/moderators`, {
        cache: 'no-store',
        headers: authHeader,
      });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows);
      }
    } finally {
      setLoading(false);
    }
  // authHeader is derived from a stable prop; re-computing it per render
  // would keep fetchRows unstable and re-fire the effect. Safe to omit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, moderatorToken]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const handleAdd = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (name.trim().length < 2) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`/api/events/${eventId}/moderators`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim() || undefined,
            role,
          }),
        });
        if (!res.ok) {
          setError(t('errors.addFailed'));
          return;
        }
        setName('');
        setEmail('');
        setRole('MODERATOR');
        setShowForm(false);
        await fetchRows();
      } finally {
        setSubmitting(false);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name, email, role, eventId, moderatorToken, fetchRows, t],
  );

  const handleRevoke = useCallback(
    async (id: string) => {
      if (!confirm(t('confirmRevoke'))) return;
      const res = await fetch(`/api/events/${eventId}/moderators/${id}`, {
        method: 'DELETE',
        headers: authHeader,
      });
      if (res.ok) fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId, moderatorToken, fetchRows, t],
  );

  const magicLink = useCallback(
    (token: string) => `${baseUrl}/${locale}/events/${eventSlug}/live?token=${token}`,
    [baseUrl, locale, eventSlug],
  );

  const handleCopy = useCallback(async (row: ModeratorRow) => {
    await navigator.clipboard.writeText(magicLink(row.token));
    setCopiedId(row.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, [magicLink]);

  const activeCount = rows.filter((r) => r.revokedAt === null).length;

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
            {t('intro')}
          </div>
          <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
            {t('introHint')}
          </div>
        </div>
        {!showForm && (
          <Button color="primary" size="sm" onClick={() => setShowForm(true)}>
            + {t('add')}
          </Button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="border rounded p-3 mb-3">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="mb-2">
            <Label htmlFor="co-mod-name">{t('name')}</Label>
            <Input
              id="co-mod-name"
              type="text"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="mb-2">
            <Label htmlFor="co-mod-email">{t('email')}</Label>
            <Input
              id="co-mod-email"
              type="email"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
            />
          </div>
          <div className="mb-3">
            <Label htmlFor="co-mod-role">{t('role')}</Label>
            <select
              id="co-mod-role"
              className="form-select"
              value={role}
              onChange={(e) => setRole(e.target.value as GrantRole)}
            >
              <option value="MODERATOR">{t('roleModerator')}</option>
              <option value="SPEAKER">{t('roleSpeaker')}</option>
            </select>
            <div className="text-muted mt-1" style={{ fontSize: '0.78rem' }}>
              {role === 'SPEAKER' ? t('roleSpeakerHint') : t('roleModeratorHint')}
            </div>
          </div>
          <div className="d-flex gap-2">
            <Button color="primary" size="sm" type="submit" disabled={submitting || name.trim().length < 2}>
              {submitting ? tc('saving') : tc('save')}
            </Button>
            <Button
              color="secondary"
              outline
              size="sm"
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
            >
              {tc('cancel')}
            </Button>
          </div>
        </form>
      )}

      {loading && rows.length === 0 ? (
        <div className="text-muted">{tc('loading')}</div>
      ) : rows.length === 0 ? (
        <div className="text-muted text-center py-3" style={{ fontSize: '0.88rem' }}>
          {t('empty')}
        </div>
      ) : (
        <div className="d-flex flex-column gap-2">
          {rows.map((row) => {
            const revoked = row.revokedAt !== null;
            const link = magicLink(row.token);
            return (
              <div
                key={row.id}
                className="d-flex justify-content-between align-items-start border rounded p-3"
                style={{ opacity: revoked ? 0.55 : 1 }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                    <span className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                      {row.name}
                    </span>
                    <Badge
                      color=""
                      pill
                      style={{
                        fontSize: '0.68rem',
                        background: row.role === 'SPEAKER' ? '#FEF5E6' : '#E8F1FA',
                        color: row.role === 'SPEAKER' ? '#A66300' : '#0759A9',
                      }}
                    >
                      {row.role === 'SPEAKER' ? t('roleSpeaker') : t('roleModerator')}
                    </Badge>
                    {revoked && (
                      <Badge color="" pill style={{ fontSize: '0.7rem', background: '#E9ECEF', color: 'var(--app-muted)' }}>
                        {t('revoked')}
                      </Badge>
                    )}
                  </div>
                  {row.email && (
                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                      {row.email}
                    </div>
                  )}
                  {!revoked && (
                    <code
                      className="d-block mt-1"
                      style={{
                        background: '#f5f7fb',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: '0.72rem',
                        wordBreak: 'break-all',
                        color: 'var(--app-text)',
                      }}
                    >
                      {link}
                    </code>
                  )}
                </div>
                <div className="d-flex gap-1 flex-shrink-0 ms-2">
                  {!revoked && (
                    <>
                      <Button
                        color="secondary"
                        outline
                        size="xs"
                        onClick={() => handleCopy(row)}
                        title={t('copyLink')}
                      >
                        {copiedId === row.id ? t('copied') : t('copyLink')}
                      </Button>
                      <Button
                        color="danger"
                        outline
                        size="xs"
                        onClick={() => handleRevoke(row.id)}
                      >
                        {t('revoke')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div className="text-muted text-end" style={{ fontSize: '0.75rem' }}>
            {t('activeCount', { count: activeCount })}
          </div>
        </div>
      )}
    </div>
  );
}
