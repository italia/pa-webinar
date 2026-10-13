'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useToast } from '@/components/ui/toast';
import { codiceErrore } from '@/lib/api-error-message';
import { reminderTriggerAt } from '@/lib/email/reminder-plan';
import { MAX_REMINDERS, REMINDER_PRESETS } from '@/lib/events/reminder-presets';

/**
 * Quando mandare una notifica a chi si e' iscritto: uno dei momenti previsti,
 * fino al massimo per evento. Ogni scelta si salva subito (le rotte dei
 * promemoria, con il link principale), e dopo ogni scelta, come all'apertura,
 * l'elenco si rilegge dal server: e' lui a sapere se un promemoria e' gia'
 * partito nel frattempo, o se un'altra scheda ha cambiato l'elenco. Le stesse
 * regole le applicano le rotte: un promemoria gia' partito non si toglie (e'
 * la traccia di cosa e' stato mandato), un momento gia' passato non si
 * aggiunge (non partirebbe).
 */

export interface PromemoriaRiga {
  id: string;
  offsetMinutes: number;
  label: string;
  sentCount: number;
  createdAt: string;
}

const MESSAGGI: Record<string, 'errorSent' | 'errorPassed' | 'maxReminders' | 'errorChanged'> = {
  REMINDER_SENT: 'errorSent',
  REMINDER_PASSED: 'errorPassed',
  REMINDER_LIMIT: 'maxReminders',
  REMINDER_EXISTS: 'errorChanged',
};

export default function EventRemindersEditor({
  eventSlug,
  moderatorToken,
  startsAt,
  reminders,
  aperto,
  onChange,
}: {
  eventSlug: string;
  moderatorToken: string;
  startsAt: string;
  reminders: PromemoriaRiga[];
  /** L'elenco e' visibile: all'apertura si rilegge dal server. */
  aperto: boolean;
  /** L'elenco del server, dopo ogni lettura. */
  onChange: (reminders: PromemoriaRiga[]) => void;
}) {
  const tr = useTranslations('reminders');
  const toast = useToast();
  const idLimite = useId();
  // Una modifica alla volta: la seconda aspetta che la prima sia salvata e
  // l'elenco riletto. Le caselle non si disattivano (il fuoco andrebbe perso):
  // un clic in quel momento non fa niente.
  const [inCorso, setInCorso] = useState(false);
  const occupato = useRef(false);

  const base = `/api/events/${encodeURIComponent(eventSlug)}/reminders`;
  const auth = { Authorization: `Bearer ${moderatorToken}` };

  const rileggi = useCallback(async () => {
    try {
      const res = await fetch(base, { headers: { Authorization: `Bearer ${moderatorToken}` } });
      if (!res.ok) return;
      const dati = (await res.json()) as { reminders: PromemoriaRiga[] };
      onChange(dati.reminders);
    } catch {
      // Resta l'elenco che c'e'.
    }
  }, [base, moderatorToken, onChange]);

  useEffect(() => {
    if (aperto) void rileggi();
  }, [aperto, rileggi]);

  const perScarto = new Map(reminders.map((r) => [r.offsetMinutes, r]));
  const pieno = reminders.length >= MAX_REMINDERS;
  const inizio = new Date(startsAt);

  const cambia = async (offsetMinutes: number, accendi: boolean) => {
    if (occupato.current) return;
    occupato.current = true;
    setInCorso(true);
    try {
      let res: Response;
      if (accendi) {
        res = await fetch(base, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ offsetMinutes }),
        });
      } else {
        const riga = perScarto.get(offsetMinutes);
        if (!riga) return;
        res = await fetch(`${base}/${riga.id}`, { method: 'DELETE', headers: auth });
      }
      if (!res.ok && !(res.status === 404 && !accendi)) {
        const codice = await codiceErrore(res);
        const chiave = codice ? MESSAGGI[codice] : undefined;
        toast.error(chiave === 'maxReminders' ? tr(chiave, { max: MAX_REMINDERS }) : chiave ? tr(chiave) : tr('saveFailed'));
      }
      // Comunque vada, la verita' e' quella del server.
      await rileggi();
    } catch {
      toast.error(tr('saveFailed'));
    } finally {
      occupato.current = false;
      setInCorso(false);
    }
  };

  return (
    // Il filetto sta sul contenitore: sul bordo del fieldset la legenda ci si
    // siede sopra e lascia una riga che corre alla sua destra.
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid #f0f0f0' }}>
      <fieldset className="border-0 p-0 m-0" aria-busy={inCorso} aria-describedby={idLimite}>
        <legend className="fw-semibold mb-1 p-0" style={{ fontSize: '0.85rem', float: 'none' }}>
          {tr('editLegend')}
        </legend>
        <p id={idLimite} className="mb-2" style={{ color: 'var(--app-muted)', fontSize: '0.78rem' }}>
          {tr('maxReminders', { max: MAX_REMINDERS })}
        </p>
        <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
          {REMINDER_PRESETS.map(({ offsetMinutes, key }) => {
            const riga = perScarto.get(offsetMinutes);
            const acceso = !!riga;
            const inviato = (riga?.sentCount ?? 0) > 0;
            const passato = !acceso && reminderTriggerAt(inizio, offsetMinutes).getTime() <= Date.now();
            const limite = !acceso && pieno;
            // Il perche' di una casella bloccata, nel suo nome: letto una volta.
            const nota = inviato
              ? tr('alreadySent')
              : passato
                ? tr('alreadyPassed')
                : limite
                  ? tr('limitReached')
                  : null;
            const id = `promemoria-${offsetMinutes}`;
            return (
              <li key={offsetMinutes} className="form-check mb-0">
                {/* La casella del design system: è l'etichetta a disegnarla. Con
                    anche la classe di Bootstrap (form-check-input) le due
                    versioni si sovrapponevano e quella disattivata usciva
                    disegnata a metà. */}
                <input
                  type="checkbox"
                  id={id}
                  checked={acceso}
                  disabled={nota !== null}
                  onChange={(e) => void cambia(offsetMinutes, e.target.checked)}
                />
                <label className="form-check-label" htmlFor={id} style={{ fontSize: '0.85rem' }}>
                  {tr(`presets.${key}`)}
                  {/* Lo spazio è testo, non margine: senza, il nome letto dai
                      lettori di schermo diventa «7 giorni prima(orario passato)». */}
                  {nota && (
                    <>
                      {' '}
                      <span style={{ color: 'var(--app-muted)', fontSize: '0.75rem' }}>({nota})</span>
                    </>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </div>
  );
}
