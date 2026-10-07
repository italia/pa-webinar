'use client';

/**
 * Il glossario della post-produzione AI (lib/ai/glossary.ts): l'elenco dei
 * termini con la loro forma scritta, le forme da riportare al termine nella
 * trascrizione, la lettura e la pronuncia nel doppiaggio, le traduzioni
 * fisse e il significato.
 *
 * Due usi: il glossario dell'istanza (lo arricchisce tutto lo staff; chi
 * organizza modifica le voci che ha aggiunto) e quello di un evento nella sua
 * pagina, dove si vedono in sola lettura anche i termini dell'istanza. Le
 * azioni compaiono solo sulle voci con `canEdit`.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Icon } from '@/components/ui/icon';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { localeNames, locales } from '@/i18n/config';
import { Link } from '@/i18n/navigation';
import type { GlossaryEntry, GlossaryReading } from '@/lib/ai/glossary';

interface Risposta {
  terms: GlossaryEntry[];
  /** Solo per un evento: le voci dell'istanza, in sola lettura. */
  instance?: GlossaryEntry[];
}

interface RigaLingua {
  lang: string;
  text: string;
}

interface Bozza {
  term: string;
  aliases: string;
  reading: GlossaryReading;
  spokenAll: string;
  spoken: RigaLingua[];
  translations: RigaLingua[];
  note: string;
}

const VUOTA: Bozza = {
  term: '',
  aliases: '',
  reading: 'auto',
  spokenAll: '',
  spoken: [],
  translations: [],
  note: '',
};

const CERCA_DA = 8;

function bozzaDa(e: GlossaryEntry): Bozza {
  const { '*': tutte, ...perLingua } = e.spoken;
  return {
    term: e.term,
    aliases: e.aliases.join(', '),
    reading: e.reading,
    spokenAll: tutte ?? '',
    spoken: Object.entries(perLingua).map(([lang, text]) => ({ lang, text })),
    translations: Object.entries(e.translations).map(([lang, text]) => ({ lang, text })),
    note: e.note ?? '',
  };
}

function corpoDa(b: Bozza) {
  const righe = (r: RigaLingua[]) =>
    Object.fromEntries(r.filter((x) => x.lang && x.text.trim()).map((x) => [x.lang, x.text.trim()]));
  return {
    term: b.term.trim(),
    aliases: b.aliases
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    reading: b.reading,
    spoken: { ...(b.spokenAll.trim() ? { '*': b.spokenAll.trim() } : {}), ...righe(b.spoken) },
    translations: righe(b.translations),
    note: b.note.trim() || null,
  };
}

export default function GlossaryManager({
  apiBase,
  token = null,
  scope,
}: {
  /** /api/admin/glossary, o /api/admin/events/{id}/glossary. */
  apiBase: string;
  /** Il token del moderatore, quando la pagina si e' aperta dal suo link. */
  token?: string | null;
  scope: 'instance' | 'event';
}) {
  const t = useTranslations('admin.glossary');
  const toast = useToast();
  const confirm = useConfirm();
  const headers = useMemo((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);
  const { data, error, isLoading, mutate } = useSWR<Risposta>([apiBase, token], async () => {
    const res = await fetch(apiBase, { credentials: 'include', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Risposta;
  });

  const [cerca, setCerca] = useState('');
  const [inModifica, setInModifica] = useState<string | 'new' | null>(null);
  const [bozza, setBozza] = useState<Bozza>(VUOTA);
  const [salvando, setSalvando] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const voci = data?.terms ?? [];
  const filtro = cerca.trim().toLocaleLowerCase();
  const visibili = filtro
    ? voci.filter((v) =>
        [v.term, v.note ?? '', ...v.aliases].some((x) => x.toLocaleLowerCase().includes(filtro)),
      )
    : voci;

  const nomeLingua = (l: string) =>
    l === '*' ? t('allLanguages') : (localeNames as Record<string, string>)[l] ?? l;

  const apri = (v: GlossaryEntry | null) => {
    setBozza(v ? bozzaDa(v) : VUOTA);
    setInModifica(v ? v.id : 'new');
    setErrore(null);
  };

  const messaggioErrore = async (res: Response): Promise<string> => {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === 'CONFLICT') return t('conflict');
    if (body.code === 'GLOSSARY_FULL') return t('full');
    if (res.status === 422) return t('invalid');
    return t('error');
  };

  const salva = async () => {
    if (!bozza.term.trim()) {
      setErrore(t('termRequired'));
      return;
    }
    setSalvando(true);
    setErrore(null);
    try {
      const res = await fetch(inModifica === 'new' ? apiBase : `${apiBase}/${inModifica}`, {
        method: inModifica === 'new' ? 'POST' : 'PATCH',
        credentials: 'include',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpoDa(bozza)),
      });
      if (!res.ok) {
        setErrore(await messaggioErrore(res));
        return;
      }
      toast.success(t('saved'));
      setInModifica(null);
      await mutate();
    } catch {
      setErrore(t('error'));
    } finally {
      setSalvando(false);
    }
  };

  const elimina = async (v: GlossaryEntry) => {
    const ok = await confirm({
      title: t('delete'),
      message: t('deleteConfirm', { term: v.term }),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`${apiBase}/${v.id}`, { method: 'DELETE', credentials: 'include', headers });
      if (!res.ok) {
        toast.error(await messaggioErrore(res));
        return;
      }
      toast.success(t('deleted'));
      if (inModifica === v.id) setInModifica(null);
      await mutate();
    } catch {
      toast.error(t('error'));
    }
  };

  if (isLoading) return <p className="text-muted mb-0">{t('loading')}</p>;
  if (error || !data) return <p className="text-danger mb-0">{t('loadFailed')}</p>;

  return (
    <div className="glossary">
      <div className="glossary__toolbar">
        {voci.length > CERCA_DA && (
          <div className="glossary__search">
            <label htmlFor={`glossary-search-${scope}`} className="visually-hidden">
              {t('searchLabel')}
            </label>
            <input
              id={`glossary-search-${scope}`}
              type="search"
              className="form-control form-control-sm"
              placeholder={t('searchLabel')}
              value={cerca}
              onChange={(e) => setCerca(e.target.value)}
            />
          </div>
        )}
        {inModifica === null && (
          <button type="button" className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1" onClick={() => apri(null)}>
            <Icon icon="it-plus" size="sm" color="white" aria-hidden="true" />
            {t('add')}
          </button>
        )}
      </div>

      {inModifica === 'new' && (
        <Editor bozza={bozza} setBozza={setBozza} errore={errore} salvando={salvando}
          onSalva={salva} onAnnulla={() => setInModifica(null)} nomeLingua={nomeLingua} scope={scope} />
      )}

      {voci.length === 0 ? (
        <p className="glossary__empty">{t('empty')}</p>
      ) : (
        <ul className="glossary__list">
          {visibili.map((v) =>
            inModifica === v.id ? (
              <li key={v.id} className="glossary__item glossary__item--editing">
                <Editor bozza={bozza} setBozza={setBozza} errore={errore} salvando={salvando}
                  onSalva={salva} onAnnulla={() => setInModifica(null)} nomeLingua={nomeLingua} scope={scope} />
              </li>
            ) : (
              <li key={v.id} className="glossary__item">
                <Voce voce={v} nomeLingua={nomeLingua} />
                {v.canEdit !== false && (
                <div className="glossary__actions">
                  <button type="button" className="btn btn-link btn-sm p-1" onClick={() => apri(v)}
                    aria-label={t('editTerm', { term: v.term })}>
                    <Icon icon="it-pencil" size="sm" color="primary" aria-hidden="true" />
                  </button>
                  <button type="button" className="btn btn-link btn-sm p-1" onClick={() => elimina(v)}
                    aria-label={t('deleteTerm', { term: v.term })}>
                    <Icon icon="it-delete" size="sm" color="danger" aria-hidden="true" />
                  </button>
                </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {scope === 'event' && (data.instance?.length ?? 0) > 0 && (
        <details className="glossary__instance">
          <summary>{t('instanceTerms', { count: data.instance!.length })}</summary>
          <ul className="glossary__chips">
            {data.instance!.map((v) => (
              <li key={v.id} title={v.note ?? undefined}>{v.term}</li>
            ))}
          </ul>
        </details>
      )}
      {/* Il glossario comune si arricchisce dalla sua pagina, con la sessione
          dello staff: chi entra col link del moderatore non la apre. */}
      {scope === 'event' && !token && (
        <p className="glossary__shared">
          <Link href="/admin/glossary">{t('openInstance')}</Link>
        </p>
      )}
    </div>
  );
}

function Voce({ voce, nomeLingua }: { voce: GlossaryEntry; nomeLingua: (l: string) => string }) {
  const t = useTranslations('admin.glossary');
  const pronunce = Object.entries(voce.spoken);
  const traduzioni = Object.entries(voce.translations);
  return (
    <div className="glossary__body">
      <div className="glossary__head">
        <span className="glossary__term">{voce.term}</span>
        {voce.reading !== 'auto' && (
          <span className="glossary__badge">
            {voce.reading === 'spell' ? t('readingSpell') : t('readingWord')}
          </span>
        )}
        {voce.note && <span className="glossary__note">{voce.note}</span>}
      </div>
      {(pronunce.length > 0 || traduzioni.length > 0 || voce.aliases.length > 0) && (
        <dl className="glossary__details">
          {pronunce.length > 0 && (
            <div>
              <dt>{t('spokenLabel')}</dt>
              <dd>{pronunce.map(([l, x]) => `${nomeLingua(l)}: ${x}`).join(' · ')}</dd>
            </div>
          )}
          {traduzioni.length > 0 && (
            <div>
              <dt>{t('translationsLabel')}</dt>
              <dd>{traduzioni.map(([l, x]) => `${nomeLingua(l)}: ${x}`).join(' · ')}</dd>
            </div>
          )}
          {voce.aliases.length > 0 && (
            <div>
              <dt>{t('aliasesLabel')}</dt>
              <dd>{voce.aliases.join(', ')}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function Editor({
  bozza,
  setBozza,
  errore,
  salvando,
  onSalva,
  onAnnulla,
  nomeLingua,
  scope,
}: {
  bozza: Bozza;
  setBozza: (fn: (b: Bozza) => Bozza) => void;
  errore: string | null;
  salvando: boolean;
  onSalva: () => void;
  onAnnulla: () => void;
  nomeLingua: (l: string) => string;
  scope: 'instance' | 'event';
}) {
  const t = useTranslations('admin.glossary');
  const id = (nome: string) => `glossary-${scope}-${nome}`;
  return (
    <form
      className="glossary__editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSalva();
      }}
    >
      <div className="row g-3">
        <div className="col-md-4">
          <label htmlFor={id('term')} className="form-label">{t('termLabel')}</label>
          <input id={id('term')} className="form-control" maxLength={80} required value={bozza.term}
            onChange={(e) => setBozza((b) => ({ ...b, term: e.target.value }))} aria-describedby={id('term-help')} />
          <div id={id('term-help')} className="form-text">{t('termHelp')}</div>
        </div>
        <div className="col-md-8">
          <label htmlFor={id('note')} className="form-label">{t('noteLabel')}</label>
          <input id={id('note')} className="form-control" maxLength={300} value={bozza.note}
            onChange={(e) => setBozza((b) => ({ ...b, note: e.target.value }))} aria-describedby={id('note-help')} />
          <div id={id('note-help')} className="form-text">{t('noteHelp')}</div>
        </div>
        <div className="col-12">
          <label htmlFor={id('aliases')} className="form-label">{t('aliasesLabel')}</label>
          <input id={id('aliases')} className="form-control" value={bozza.aliases}
            onChange={(e) => setBozza((b) => ({ ...b, aliases: e.target.value }))} aria-describedby={id('aliases-help')} />
          <div id={id('aliases-help')} className="form-text">{t('aliasesHelp')}</div>
        </div>
        <div className="col-md-4">
          <label htmlFor={id('reading')} className="form-label">{t('readingLabel')}</label>
          <select id={id('reading')} className="form-select" value={bozza.reading}
            onChange={(e) => setBozza((b) => ({ ...b, reading: e.target.value as GlossaryReading }))}>
            <option value="auto">{t('readingAuto')}</option>
            <option value="spell">{t('readingSpell')}</option>
            <option value="word">{t('readingWord')}</option>
          </select>
        </div>
        <div className="col-md-8">
          <label htmlFor={id('spoken-all')} className="form-label">
            {t('spokenLabel')} — {t('allLanguages')}
          </label>
          <input id={id('spoken-all')} className="form-control" maxLength={120} value={bozza.spokenAll}
            onChange={(e) => setBozza((b) => ({ ...b, spokenAll: e.target.value }))} aria-describedby={id('spoken-help')} />
          <div id={id('spoken-help')} className="form-text">{t('spokenHelp')}</div>
        </div>
        <div className="col-md-6">
          <RigheLingua titolo={t('spokenByLanguage')} righe={bozza.spoken} nomeLingua={nomeLingua} idBase={id('spoken')}
            onChange={(r) => setBozza((b) => ({ ...b, spoken: r }))} />
        </div>
        <div className="col-md-6">
          <RigheLingua titolo={t('translationsLabel')} aiuto={t('translationsHelp')} righe={bozza.translations}
            nomeLingua={nomeLingua} idBase={id('tr')} onChange={(r) => setBozza((b) => ({ ...b, translations: r }))} />
        </div>
      </div>
      {errore && (
        <div className="alert alert-danger mt-3 mb-0" role="alert">
          {errore}
        </div>
      )}
      <div className="d-flex gap-2 mt-3">
        <button type="submit" className="btn btn-primary btn-sm" disabled={salvando}>
          {t('save')}
        </button>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onAnnulla} disabled={salvando}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

function RigheLingua({
  titolo,
  aiuto,
  righe,
  onChange,
  nomeLingua,
  idBase,
}: {
  titolo: string;
  aiuto?: string;
  righe: RigaLingua[];
  onChange: (r: RigaLingua[]) => void;
  nomeLingua: (l: string) => string;
  idBase: string;
}) {
  const t = useTranslations('admin.glossary');
  const usate = new Set(righe.map((r) => r.lang));
  const libera = (locales as readonly string[]).find((l) => !usate.has(l));
  return (
    <fieldset className="glossary__langs">
      <legend className="form-label">{titolo}</legend>
      {aiuto && <p className="form-text mt-0">{aiuto}</p>}
      {righe.map((r, i) => (
        <div key={i} className="glossary__lang-row">
          <label htmlFor={`${idBase}-lang-${i}`} className="visually-hidden">{t('languageLabel')}</label>
          <select id={`${idBase}-lang-${i}`} className="form-select form-select-sm" value={r.lang}
            onChange={(e) => onChange(righe.map((x, k) => (k === i ? { ...x, lang: e.target.value } : x)))}>
            {(locales as readonly string[])
              .filter((l) => l === r.lang || !usate.has(l))
              .map((l) => (
                <option key={l} value={l}>{nomeLingua(l)}</option>
              ))}
          </select>
          <label htmlFor={`${idBase}-text-${i}`} className="visually-hidden">{titolo}</label>
          <input id={`${idBase}-text-${i}`} className="form-control form-control-sm" maxLength={120} value={r.text}
            onChange={(e) => onChange(righe.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} />
          <button type="button" className="btn btn-link btn-sm p-1" aria-label={t('removeLanguage')}
            onClick={() => onChange(righe.filter((_, k) => k !== i))}>
            <Icon icon="it-close" size="sm" aria-hidden="true" />
          </button>
        </div>
      ))}
      {libera && (
        <button type="button" className="btn btn-link btn-sm px-0"
          onClick={() => onChange([...righe, { lang: libera, text: '' }])}>
          {t('addLanguage')}
        </button>
      )}
    </fieldset>
  );
}
