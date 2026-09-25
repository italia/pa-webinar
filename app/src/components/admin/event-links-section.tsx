'use client';

/**
 * I link di un evento, in un posto solo e con scritto a cosa servono.
 *
 * PERCHE': in cima alla pagina c'erano tre pulsanti «copia» identici — pagina
 * pubblica, invito diretto, amministrazione — senza niente che dicesse a chi
 * vada dato quale. Chi amministra li distingue per abitudine; chi arriva la
 * prima volta, o ci torna dopo un mese, no, e il rischio non e' simmetrico:
 * sbagliare e mandare in giro il link di amministrazione significa consegnare
 * l'evento a chi lo riceve.
 *
 * Quindi: in cima resta il link che si usa quasi sempre, e tutto il resto sta
 * qui, con nome, una riga di spiegazione e l'indirizzo in chiaro. Il link di
 * amministrazione e' l'unico coperto finche' non lo si chiede: e' una
 * credenziale durevole, e questa pagina si apre spesso mentre si condivide lo
 * schermo.
 */
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

interface Riga {
  chiave: 'publicPage' | 'guestJoin' | 'callInvite' | 'moderatorLink';
  url: string;
  /** Coperto finche' non lo si chiede. */
  riservato?: boolean;
}

function Chiave() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

export default function EventLinksSection({ righe }: { righe: Riga[] }) {
  const t = useTranslations('admin.links');
  // Scoperte una per una: oggi la riga riservata e' una sola, ma il giorno in
  // cui se ne aggiunge un'altra un interruttore unico scoprirebbe anche quella
  // che nessuno ha chiesto di vedere — su una pagina che si apre mentre si
  // condivide lo schermo.
  const [scoperte, setScoperte] = useState<Set<string>>(new Set());
  const [copiato, setCopiato] = useState<string | null>(null);
  const [fallita, setFallita] = useState<string | null>(null);

  /**
   * Dire «copiato» quando non e' vero, qui, e' peggio che dire niente: chi
   * amministra incolla quello che era negli appunti da prima — magari il link
   * pubblico preso dalla riga sopra al posto di quello moderatore, o il
   * contrario. Il ripiego a mano non lancia quando fallisce, RESTITUISCE falso:
   * per questo si guarda il valore di ritorno invece di fidarsi del try.
   */
  const copia = useCallback(async (chiave: string, url: string) => {
    let riuscita = false;
    try {
      await navigator.clipboard.writeText(url);
      riuscita = true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        riuscita = document.execCommand('copy');
      } catch {
        riuscita = false;
      }
      ta.remove();
    }

    if (riuscita) {
      setFallita(null);
      setCopiato(chiave);
      setTimeout(() => setCopiato((c) => (c === chiave ? null : c)), 2000);
    } else {
      // L'indirizzo resta a schermo e selezionabile: e' il ripiego onesto.
      setCopiato(null);
      setFallita(chiave);
    }
  }, []);

  return (
    <div className="d-flex flex-column gap-3">
      {righe.map((r) => {
        const coperto = r.riservato && !scoperte.has(r.chiave);
        return (
          <div
            key={r.chiave}
            className="p-3 rounded"
            style={{ border: '1px solid #E3E7EF', backgroundColor: '#FBFCFE' }}
          >
            {/* Niente `flex-wrap` sul largo: con una spiegazione lunga il
                pulsante finiva sotto al testo in una riga sola e le tre voci
                non si somigliavano piu'. Sotto i 576px si impila di proposito. */}
            <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start gap-2 gap-sm-3">
              <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                <div className="fw-semibold d-flex align-items-center gap-2" style={{ fontSize: '0.95rem' }}>
                  {r.riservato && (
                    <span style={{ color: '#A66300' }}>
                      <Chiave />
                    </span>
                  )}
                  {t(`${r.chiave}`)}
                </div>
                <div className="text-muted mt-1" style={{ fontSize: '0.85rem' }}>
                  {t(`${r.chiave}Hint`)}
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-shrink-0">
                {r.riservato && (
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() =>
                      setScoperte((prec) => {
                        const p = new Set(prec);
                        if (p.has(r.chiave)) p.delete(r.chiave);
                        else p.add(r.chiave);
                        return p;
                      })
                    }
                    aria-expanded={!coperto}
                    aria-label={`${coperto ? t('reveal') : t('hide')} — ${t(`${r.chiave}`)}`}
                  >
                    {coperto ? t('reveal') : t('hide')}
                  </button>
                )}
                <button
                  type="button"
                  className={`btn btn-sm ${copiato === r.chiave ? 'btn-success' : 'btn-primary'}`}
                  onClick={() => copia(r.chiave, r.url)}
                  // Il nome dice QUALE link copia: cinque pulsanti «Copia
                  // link» uno sotto l'altro, a voce, sono indistinguibili.
                  aria-label={`${t('copyLink')} — ${t(`${r.chiave}`)}`}
                >
                  <span aria-hidden="true">
                    {copiato === r.chiave ? t('copied') : t('copyLink')}
                  </span>
                </button>
              </div>
            </div>

            {r.riservato && !coperto && (
              // Riquadro semplice e non <Alert> del pacchetto: li' l'icona
              // finisce sotto al testo (vedi globals.scss).
              <div
                className="p-2 mt-2 rounded"
                style={{ background: '#FFF6D6', border: '1px solid #E5C558', fontSize: '0.8rem' }}
              >
                {t('warning')}
              </div>
            )}

            {/* L'annuncio a voce si riempie solo quando qualcosa e' successo e
                poi resta vuoto: una regione viva che torna all'etichetta
                iniziale la rileggerebbe da sola, senza che nessuno abbia
                toccato niente. */}
            <span role="status" className="visually-hidden">
              {copiato === r.chiave ? t('copied') : fallita === r.chiave ? t('copyFailed') : ''}
            </span>

            {fallita === r.chiave && (
              <div
                className="p-2 mt-2 rounded"
                style={{ background: '#FFE7E7', border: '1px solid #E29292', fontSize: '0.8rem' }}
              >
                {t('copyFailed')}
              </div>
            )}

            <div
              className="mt-2 px-2 py-1 rounded text-truncate"
              style={{
                background: '#F1F3F7',
                fontFamily: 'Roboto Mono, monospace',
                fontSize: '0.78rem',
                color: coperto ? '#8A94A6' : '#33485F',
              }}
              title={coperto ? undefined : r.url}
            >
              {coperto ? (
                <>
                  {/* I pallini sono un segno visivo: a voce diventerebbero
                      quarantotto «punto elenco». Chi ascolta sente invece che
                      il link e' nascosto, ed e' la stessa cosa che si vede. */}
                  <span aria-hidden="true">{'•'.repeat(48)}</span>
                  <span className="visually-hidden">{t('hidden')}</span>
                </>
              ) : (
                r.url
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
