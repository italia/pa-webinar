'use client';

/**
 * Una categoria nuova senza uscire dal wizard: il nome, e la categoria nasce
 * gia' scelta per l'evento. Colori e traduzioni si curano poi nella pagina
 * delle categorie, che si apre in un'altra scheda. Solo per l'amministrazione:
 * le categorie sono dell'intero sito.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Link, percorso } from '@/i18n/navigation';
import { Icon } from '@/components/ui/icon';
import { toKebab } from '@/lib/utils/kebab';

export interface EtichettaCreata {
  slug: string;
  name: Record<string, string>;
  color: string | null;
}

export default function NuovaEtichetta({
  defaultLocale,
  esistenti,
  onCreata,
  onScegliEsistente,
}: {
  defaultLocale: string;
  /** Le categorie che ci sono gia': un nome uguale sceglie quella. */
  esistenti: EtichettaCreata[];
  onCreata: (etichetta: EtichettaCreata) => void;
  onScegliEsistente: (slug: string) => void;
}) {
  const t = useTranslations('admin.wizard.step1');
  const id = useId();
  const [aperta, setAperta] = useState(false);
  const [nome, setNome] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [esito, setEsito] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const apri = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (aperta) campo.current?.focus();
  }, [aperta]);

  const chiudi = () => {
    setAperta(false);
    setNome('');
    setErrore(null);
    // Il fuoco torna al pulsante che ha aperto il campo.
    requestAnimationFrame(() => apri.current?.focus());
  };

  // Un secondo Invio mentre la prima richiesta e' in corso non ne manda
  // un'altra: lo stato arriva tardi, il riferimento no.
  const inCorso = useRef(false);
  const crea = async () => {
    if (inCorso.current) return;
    const pulito = nome.trim();
    // Il nome serve almeno con una lettera o una cifra, di qualunque
    // alfabeto. L'indirizzo si scrive con lettere latine: un nome in greco o
    // in cirillico ne riceve uno generato.
    if (!/[\p{L}\p{N}]/u.test(pulito)) {
      setErrore(t('newTagInvalid'));
      return;
    }
    const base = toKebab(pulito).slice(0, 100).replace(/-+$/, '');
    const slug = base || `categoria-${Date.now().toString(36)}`;
    // Un nome che c'e' gia' sceglie la categoria esistente invece di farne
    // una doppia.
    const uguale = esistenti.find(
      (e) =>
        (base !== '' && e.slug === base) ||
        Object.values(e.name).some((n) => n.trim().toLowerCase() === pulito.toLowerCase())
    );
    if (uguale) {
      onScegliEsistente(uguale.slug);
      setEsito(t('newTagExisting', { name: pulito }));
      chiudi();
      return;
    }
    inCorso.current = true;
    setSalvando(true);
    setErrore(null);
    try {
      const res = await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          // Il server vuole il nome in italiano; la lingua del sito, se e'
          // un'altra, lo ha uguale finche' non lo si traduce.
          name: { it: pulito, [defaultLocale]: pulito },
        }),
      });
      if (res.status === 409) {
        setErrore(t('newTagConflict'));
        return;
      }
      if (!res.ok) {
        setErrore(t('newTagFailed'));
        return;
      }
      const creata = (await res.json()) as EtichettaCreata;
      onCreata({ slug: creata.slug, name: creata.name, color: creata.color ?? null });
      setEsito(t('newTagCreated', { name: pulito }));
      chiudi();
    } catch {
      setErrore(t('newTagFailed'));
    } finally {
      inCorso.current = false;
      setSalvando(false);
    }
  };

  return (
    <div className="nuova-etichetta">
      {aperta ? (
        <div className="nuova-etichetta__campo">
          <label htmlFor={`${id}-nome`} className="form-label mb-1">
            {t('newTagLabel')}
          </label>
          <div className="d-flex flex-wrap gap-2 align-items-start">
            <input
              ref={campo}
              id={`${id}-nome`}
              type="text"
              className={`form-control form-control-sm${errore ? ' is-invalid' : ''}`}
              value={nome}
              maxLength={80}
              aria-describedby={errore ? `${id}-errore` : undefined}
              aria-invalid={errore ? true : undefined}
              onChange={(e) => {
                setNome(e.target.value);
                setErrore(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void crea();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  chiudi();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void crea()}
              disabled={salvando}
            >
              {t('newTagAdd')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={chiudi}
            >
              {t('newTagCancel')}
            </button>
          </div>
          {errore && (
            <div id={`${id}-errore`} className="invalid-feedback d-block" role="alert">
              {errore}
            </div>
          )}
        </div>
      ) : (
        <div className="d-flex flex-wrap align-items-center gap-3">
          {/* Un pulsante vero, con la sua icona: non una pillola come le
              categorie che sta accanto, che si sceglierebbe per sbaglio. */}
          <button
            ref={apri}
            type="button"
            className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1 nuova-etichetta__apri"
            onClick={() => {
              setEsito(null);
              setAperta(true);
            }}
          >
            <Icon icon="it-plus" size="xs" color="white" />
            {t('newTag')}
          </button>
          {/* Si apre in una nuova scheda: lo dicono l'icona e il testo. */}
          <Link
            href={percorso('/admin/settings/tags')}
            target="_blank"
            rel="noopener"
            className="nuova-etichetta__gestisci d-inline-flex align-items-center gap-1"
          >
            {t('manageTags')}
            <Icon icon="it-external-link" size="xs" color="primary" />
            <span className="small text-muted">({t('opensInNewTab')})</span>
          </Link>
        </div>
      )}
      <p className="visually-hidden" role="status">
        {esito ?? ''}
      </p>
    </div>
  );
}
