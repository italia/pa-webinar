// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * Il modulo per registrare una richiesta di rimozione arrivata al titolare
 * per altre vie: la registrazione, la persona fra chi era in sala (anche piu'
 * righe, se e' rientrata con un altro link), il nome e come e' arrivata.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Button, Card, CardBody } from 'design-react-kit';

import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

interface Registrazione {
  id: string;
  createdAt: string;
  durationSec: number | null;
  hasVideo: boolean;
  event: { id: string; title: unknown; startsAt: string };
}

interface Persona {
  key: string;
  name: string | null;
  kind: 'registrant' | 'host' | 'guest';
  seatIds: string[];
  firstJoinedAt: string;
  lastLeftAt: string | null;
  inVideo: boolean;
}

export default function NewRequestForm({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('admin.recordingRemovals');
  const fmt = useFormatter();
  const locale = useLocale();
  const id = useId();
  const [cerca, setCerca] = useState('');
  const [registrazioni, setRegistrazioni] = useState<Registrazione[] | null>(null);
  const [scelta, setScelta] = useState('');
  const [persone, setPersone] = useState<Persona[] | null>(null);
  const [selezione, setSelezione] = useState<Set<string>>(new Set());
  const [nome, setNome] = useState('');
  const [nomeToccato, setNomeToccato] = useState(false);
  const [nota, setNota] = useState('');
  const [errore, setErrore] = useState(false);
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    let annullato = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/recording-removals/recordings?q=${encodeURIComponent(cerca)}`,
          {
            cache: 'no-store',
          }
        );
        if (!res.ok) throw new Error(String(res.status));
        const corpo = (await res.json()) as { recordings: Registrazione[] };
        if (!annullato) setRegistrazioni(corpo.recordings);
      } catch {
        if (!annullato) setRegistrazioni([]);
      }
    }, 250);
    return () => {
      annullato = true;
      clearTimeout(timer);
    };
  }, [cerca]);

  useEffect(() => {
    setPersone(null);
    setSelezione(new Set());
    if (!scelta) return undefined;
    let annullato = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/recording-removals/people?recordingId=${scelta}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(String(res.status));
        const corpo = (await res.json()) as { people: Persona[] };
        if (!annullato) setPersone(corpo.people);
      } catch {
        if (!annullato) setPersone([]);
      }
    })();
    return () => {
      annullato = true;
    };
  }, [scelta]);

  function cambiaPersona(p: Persona, attiva: boolean) {
    const nuova = new Set(selezione);
    if (attiva) nuova.add(p.key);
    else nuova.delete(p.key);
    setSelezione(nuova);
    if (attiva && !nomeToccato && p.name) setNome(p.name);
  }

  async function invia(e: FormEvent) {
    e.preventDefault();
    if (!scelta || !nome.trim()) return;
    setInvio(true);
    setErrore(false);
    try {
      const seatIds = (persone ?? [])
        .filter((p) => selezione.has(p.key))
        .flatMap((p) => p.seatIds);
      const res = await fetch('/api/admin/recording-removals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordingId: scelta,
          seatIds,
          name: nome.trim(),
          ...(nota.trim() ? { note: nota.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onCreated(((await res.json()) as { id: string }).id);
    } catch {
      setErrore(true);
      setInvio(false);
    }
  }

  const ora = (iso: string) => fmt.dateTime(new Date(iso), { timeStyle: 'short' });

  return (
    <Card className="border-0 shadow-sm mb-4">
      <CardBody className="p-4">
        <h2 className="h5 mb-1">{t('newTitle')}</h2>
        <p className="text-muted mb-3">{t('newIntro')}</p>
        <form onSubmit={invia}>
          <div className="mb-3">
            <label htmlFor={`${id}-cerca`} className="form-label">
              {t('recordingSearch')}
            </label>
            <input
              id={`${id}-cerca`}
              type="search"
              className="form-control"
              value={cerca}
              onChange={(e) => setCerca(e.target.value)}
            />
          </div>
          <div className="mb-3">
            <label htmlFor={`${id}-registrazione`} className="form-label">
              {t('recordingLabel')}
            </label>
            {registrazioni !== null && registrazioni.length === 0 ? (
              <p className="text-muted mb-0">{t('recordingNone')}</p>
            ) : (
              <select
                id={`${id}-registrazione`}
                className="form-select"
                value={scelta}
                required
                onChange={(e) => setScelta(e.target.value)}
              >
                <option value="">{t('recordingChoose')}</option>
                {(registrazioni ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {t('recordingOption', {
                      title: getLocalized(r.event.title as LocalizedField, locale),
                      date: fmt.dateTime(new Date(r.createdAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </option>
                ))}
              </select>
            )}
          </div>

          {scelta && persone !== null && (
            <fieldset className="mb-3">
              <legend className="form-label fs-6">{t('peopleLabel')}</legend>
              {persone.length === 0 ? (
                <p className="text-muted mb-0">{t('peopleNone')}</p>
              ) : (
                persone.map((p) => (
                  <div className="form-check" key={p.key}>
                    <input
                      id={`${id}-${p.key}`}
                      className="form-check-input"
                      type="checkbox"
                      checked={selezione.has(p.key)}
                      onChange={(e) => cambiaPersona(p, e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor={`${id}-${p.key}`}>
                      <strong>{p.name ?? t('unnamed')}</strong> · {t(`kinds.${p.kind}`)} ·{' '}
                      {p.lastLeftAt
                        ? t('personTimes', {
                            from: ora(p.firstJoinedAt),
                            to: ora(p.lastLeftAt),
                          })
                        : t('personStill', { from: ora(p.firstJoinedAt) })}
                      {!p.inVideo && <> · {t('personNotInVideo')}</>}
                    </label>
                  </div>
                ))
              )}
            </fieldset>
          )}

          <div className="mb-3">
            <label htmlFor={`${id}-nome`} className="form-label">
              {t('nameLabel')}
            </label>
            <input
              id={`${id}-nome`}
              className="form-control"
              value={nome}
              maxLength={200}
              required
              onChange={(e) => {
                setNome(e.target.value);
                setNomeToccato(true);
              }}
            />
          </div>
          <div className="mb-3">
            <label htmlFor={`${id}-nota`} className="form-label">
              {t('noteLabel')}
            </label>
            <textarea
              id={`${id}-nota`}
              className="form-control"
              rows={2}
              maxLength={2000}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
          </div>
          {errore && (
            <div className="alert alert-danger" role="alert">
              {t('createError')}
            </div>
          )}
          <div className="d-flex gap-2">
            <Button
              color="primary"
              type="submit"
              disabled={invio || !scelta || !nome.trim()}
            >
              {t('create')}
            </Button>
            <Button color="secondary" outline type="button" onClick={onCancel}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
