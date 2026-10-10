'use client';

/**
 * La trascrizione dell'evento costruita dai sottotitoli live, nella scheda
 * dell'evento: quante frasi si sono salvate (solo di chi ha dato il
 * consenso), la trascrizione costruita e da dove viene, il pulsante per
 * costruirla o aggiornarla, l'editor, la pubblicazione nella pagina
 * dell'evento anche senza video.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import ToggleSwitch from '@/components/ui/toggle-switch';
import { Link, percorso } from '@/i18n/navigation';
import { useToast } from '@/components/ui/toast';

interface Stato {
  frasi: number;
  segnaposto: number;
  voci: number;
  trascrizione: { recordingId: string; origine: 'sottotitoli' | 'ai'; corretta: boolean } | null;
  pubblicata: boolean;
  videoPubblicato: boolean;
}

export default function CaptionsTranscriptPanel({
  eventId,
  moderatorToken,
  isEnded,
}: {
  eventId: string;
  moderatorToken: string;
  isEnded: boolean;
}) {
  const t = useTranslations('admin.captionsTranscript');
  const toast = useToast();
  const [stato, setStato] = useState<Stato | null>(null);
  const [errore, setErrore] = useState(false);
  const [lavoro, setLavoro] = useState(false);

  const carica = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/events/${eventId}/captions-transcript`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      setStato((await r.json()) as Stato);
      setErrore(false);
    } catch {
      setErrore(true);
    }
  }, [eventId]);

  useEffect(() => {
    void carica();
  }, [carica]);

  async function costruisci(): Promise<void> {
    setLavoro(true);
    try {
      const r = await fetch(`/api/admin/events/${eventId}/captions-transcript`, { method: 'POST' });
      const esito = (await r.json().catch(() => null)) as { stato?: string } | null;
      if (!r.ok) toast.error(t('failed'));
      else if (esito?.stato === 'gia-trascritta') toast.info(t('kept'));
      else if (esito?.stato === 'nessuna-frase') toast.info(t('empty'));
      else if (esito?.stato === 'scaduta') toast.info(t('expired'));
      else if (esito?.stato === 'ai-in-corso') toast.info(t('aiRunning'));
      else toast.success(t('built'));
      await carica();
    } catch {
      toast.error(t('failed'));
    } finally {
      setLavoro(false);
    }
  }

  async function pubblica(): Promise<void> {
    if (!stato) return;
    const prossimo = !stato.pubblicata;
    setLavoro(true);
    try {
      const r = await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moderatorToken}` },
        body: JSON.stringify({ transcriptPublished: prossimo }),
      });
      if (!r.ok) {
        toast.error(t('failed'));
        return;
      }
      setStato({ ...stato, pubblicata: prossimo });
    } catch {
      toast.error(t('failed'));
    } finally {
      setLavoro(false);
    }
  }

  if (errore) {
    return <p className="text-danger small mb-0">{t('loadFailed')}</p>;
  }
  if (!stato) return null;

  const tr = stato.trascrizione;
  return (
    <div className="border rounded p-3" style={{ background: '#fff' }}>
      <p className="text-secondary mb-2" style={{ fontSize: '0.9rem', maxWidth: 680 }}>
        {t('intro')}
      </p>
      <p className="mb-2" style={{ fontSize: '0.9rem' }}>
        {t('stats', { saved: stato.frasi, voices: stato.voci, skipped: stato.segnaposto })}
      </p>

      <p className="mb-3" style={{ fontSize: '0.9rem' }}>
        {!tr
          ? stato.frasi === 0
            ? t('empty')
            : t('none')
          : tr.origine === 'ai'
            ? t('fromAi')
            : tr.corretta
              ? t('revised')
              : t('fromCaptions')}
      </p>

      <div className="d-flex flex-wrap gap-2 mb-3">
        {/* Una trascrizione AI o corretta a mano non si sostituisce: niente pulsante. */}
        {isEnded && stato.frasi > 0 && (!tr || (tr.origine === 'sottotitoli' && !tr.corretta)) && (
          <button
            type="button"
            className={`btn btn-sm ${tr ? 'btn-outline-primary' : 'btn-primary'}`}
            disabled={lavoro}
            onClick={() => void costruisci()}
          >
            {lavoro ? '…' : tr ? t('rebuild') : t('build')}
          </button>
        )}
        {tr && (
          <Link
            href={percorso(`/admin/postprod/${tr.recordingId}`)}
            className="btn btn-sm btn-outline-secondary"
          >
            {t('openEditor')}
          </Link>
        )}
      </div>

      {tr && (
        <div className="border rounded p-3">
          <div className="d-flex justify-content-between align-items-start">
            <div className="me-3">
              <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                {t('publish')}
              </div>
              <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                {stato.videoPubblicato ? t('publishWithVideo') : t('publishDesc')}
              </div>
            </div>
            <ToggleSwitch
              label=""
              ariaLabel={t('publish')}
              checked={stato.pubblicata}
              onChange={() => void pubblica()}
              disabled={lavoro}
            />
          </div>
        </div>
      )}
    </div>
  );
}
