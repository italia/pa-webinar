'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * «Rimandami il link» per una registrazione riservata agli iscritti: chi si
 * e' iscritto scrive l'indirizzo e riceve di nuovo il link personale della
 * visione (POST /api/events/[slug]/recording/access). La risposta e' sempre la
 * stessa, iscritto o no.
 */
export default function RecordingLinkRequest({
  slug,
  locale,
}: {
  slug: string;
  locale: string;
}) {
  const t = useTranslations('events.detail');
  const [email, setEmail] = useState('');
  const [stato, setStato] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function invia(e: React.FormEvent) {
    e.preventDefault();
    setStato('sending');
    try {
      const r = await fetch(`/api/events/${slug}/recording/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale }),
      });
      setStato(r.ok ? 'sent' : 'error');
    } catch {
      setStato('error');
    }
  }

  if (stato === 'sent') {
    return (
      <p className="mt-2 mb-0" role="status">
        {t('recordingLinkSent')}
      </p>
    );
  }
  return (
    <form className="mt-3 d-flex flex-wrap align-items-end gap-2" onSubmit={invia}>
      <div className="flex-grow-1" style={{ minWidth: 220 }}>
        <label htmlFor="recording-link-email" className="form-label small mb-1">
          {t('recordingLinkEmailLabel')}
        </label>
        <input
          id="recording-link-email"
          type="email"
          className="form-control"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={stato === 'sending'}
      >
        {t('recordingLinkSend')}
      </button>
      {stato === 'error' && (
        <p className="w-100 small text-danger mb-0" role="alert">
          {t('recordingLinkError')}
        </p>
      )}
    </form>
  );
}
