'use client';

/**
 * La libreria dei modelli di domande, con le domande di ciascuno, e i modi di
 * mostrarla: l'anteprima di un questionario dentro il suo editor e, nel passo
 * «Persone», che cosa si chiede prima e dopo l'evento. Il wizard la legge una
 * volta sola, quando un passo la mostra; un componente usato da solo la legge
 * per conto suo.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';

import ElencoDomande, {
  type DomandaInLettura,
  type GruppoDiDomande,
} from '@/components/questionnaires/elenco-domande';
import { FEEDBACK_GENERIC_TEMPLATE_NAME } from '@/lib/feedback/constants';
import type { QuestionnaireMoment } from '@/lib/questionnaires/template-usage';

import type { QuestionnaireBlock } from './step-4-content';

export interface ModelloDiDomande {
  id: string;
  name: string;
  description: string | null;
  itemCount?: number;
  usage?: QuestionnaireMoment | null;
  items?: DomandaInLettura[];
}

interface Libreria {
  righe: ModelloDiDomande[];
  /** La libreria e' arrivata: prima, contare le domande dei modelli sbaglia. */
  pronta: boolean;
  carica: () => void;
}

const LibreriaContext = createContext<Libreria | null>(null);

export const LibreriaDomandeProvider = LibreriaContext.Provider;

async function leggiLibreria(): Promise<ModelloDiDomande[]> {
  const res = await fetch('/api/admin/question-templates?domande=1', {
    cache: 'no-store',
  });
  // Un errore si propaga: chi legge la libreria riprova alla prossima volta
  // che un passo la chiede, invece di tenersela vuota.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { rows?: unknown };
  return Array.isArray(data.rows) ? (data.rows as ModelloDiDomande[]) : [];
}

/** Quante volte si riprova una libreria che non si e' potuta leggere, e
 *  dopo quanto. */
const TENTATIVI = 3;
const ATTESA_RIPROVA_MS = 5000;

/** Lo stato condiviso del wizard: la libreria si legge alla prima richiesta;
 *  se non arriva si riprova qualche volta, poi alla prossima richiesta. */
export function useStatoLibreriaDomande(): Libreria {
  const [righe, setRighe] = useState<ModelloDiDomande[]>([]);
  const [pronta, setPronta] = useState(false);
  const avviata = useRef(false);
  const tentativi = useRef(0);
  const riprova = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Chiuso il wizard, un nuovo tentativo in attesa non parte piu'.
  useEffect(
    () => () => {
      if (riprova.current) clearTimeout(riprova.current);
    },
    []
  );
  const carica = useCallback(() => {
    if (avviata.current) return;
    avviata.current = true;
    const leggi = () => {
      leggiLibreria()
        .then((r) => {
          setRighe(r);
          setPronta(true);
        })
        .catch(() => {
          tentativi.current += 1;
          if (tentativi.current < TENTATIVI) {
            riprova.current = setTimeout(leggi, ATTESA_RIPROVA_MS);
          } else {
            // Si riprova alla prossima richiesta di un passo.
            tentativi.current = 0;
            avviata.current = false;
          }
        });
    };
    leggi();
  }, []);
  return useMemo(() => ({ righe, pronta, carica }), [righe, pronta, carica]);
}

/** I modelli della libreria e se sono arrivati. Con `attiva` falsa (chi entra
 *  con il link di conduzione, che la libreria non la legge) resta vuota. */
export function useStatoLibreria(attiva = true): {
  righe: ModelloDiDomande[];
  pronta: boolean;
} {
  const condivisa = useContext(LibreriaContext);
  const carica = condivisa?.carica;
  const [proprie, setProprie] = useState<{ righe: ModelloDiDomande[]; pronta: boolean }>({
    righe: [],
    pronta: false,
  });
  useEffect(() => {
    if (!attiva) return;
    if (carica) {
      carica();
      return;
    }
    let annullato = false;
    leggiLibreria()
      .then((r) => {
        if (!annullato) setProprie({ righe: r, pronta: true });
      })
      .catch(() => {
        /* la libreria resta vuota */
      });
    return () => {
      annullato = true;
    };
  }, [attiva, carica]);
  return condivisa ? { righe: condivisa.righe, pronta: condivisa.pronta } : proprie;
}

/** I modelli della libreria (vuota finche' non arriva). */
export function useLibreriaDomande(attiva = true): ModelloDiDomande[] {
  return useStatoLibreria(attiva).righe;
}

/** Le domande di un questionario del wizard, per provenienza: i modelli scelti
 *  nell'ordine in cui compaiono, poi quelle scritte per l'evento. */
export function gruppiDelBlocco(
  blocco: QuestionnaireBlock,
  libreria: ModelloDiDomande[],
  etichette: { daModello: (nome: string) => string; dellEvento: string }
): GruppoDiDomande[] {
  const gruppi: GruppoDiDomande[] = [];
  for (const id of blocco.templateIds) {
    const modello = libreria.find((m) => m.id === id);
    if (modello?.items) {
      gruppi.push({ titolo: etichette.daModello(modello.name), domande: modello.items });
    }
  }
  if (blocco.adhocQuestions.length > 0) {
    gruppi.push({
      titolo: etichette.dellEvento,
      domande: blocco.adhocQuestions.map((q) => ({
        prompt: q.prompt,
        type: q.type,
        options: q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE' ? q.options : [],
        scaleMin: q.scaleMin,
        scaleMax: q.scaleMax,
        required: q.required,
      })),
    });
  }
  return gruppi;
}

/** Quante domande fa un questionario del wizard: si conta anche prima che le
 *  domande dei modelli siano arrivate, con il numero che la libreria dichiara. */
export function contaBlocco(
  blocco: QuestionnaireBlock,
  libreria: ModelloDiDomande[]
): number {
  const daiModelli = blocco.templateIds.reduce((n, id) => {
    const modello = libreria.find((m) => m.id === id);
    return n + (modello?.items?.length ?? modello?.itemCount ?? 0);
  }, 0);
  return daiModelli + blocco.adhocQuestions.length;
}

/** Le domande di tutti i modelli scelti sono arrivate: solo allora l'elenco
 *  che si apre e il numero che lo annuncia dicono la stessa cosa. */
function domandeArrivate(
  blocco: QuestionnaireBlock,
  libreria: ModelloDiDomande[]
): boolean {
  // Un modello che la libreria arrivata non ha piu' (una bozza ripresa dopo
  // che e' stato tolto) non conta, ne' nel numero ne' nell'elenco.
  return blocco.templateIds.every((id) => {
    const modello = libreria.find((m) => m.id === id);
    return !modello || modello.items !== undefined;
  });
}

function useEtichette() {
  const t = useTranslations('admin.wizard.step4');
  return useMemo(
    () => ({
      daModello: (nome: string) => t('previewFromTemplate', { name: nome }),
      dellEvento: t('previewAdhoc'),
    }),
    [t]
  );
}

/** «Vedi le domande»: il questionario come lo leggera' chi risponde. */
export function AnteprimaDomande({
  blocco,
  libreria,
}: {
  blocco: QuestionnaireBlock;
  libreria: ModelloDiDomande[];
}) {
  const t = useTranslations('admin.wizard.step4');
  const etichette = useEtichette();
  // Con modelli scelti e la libreria ancora vuota, i numeri non si sanno.
  const pronta = libreria.length > 0 || blocco.templateIds.length === 0;
  const quante = contaBlocco(blocco, libreria);
  if (!pronta || quante === 0 || !domandeArrivate(blocco, libreria)) return null;
  return (
    <details className="anteprima-domande">
      <summary>{t('previewShow', { count: quante })}</summary>
      <ElencoDomande gruppi={gruppiDelBlocco(blocco, libreria, etichette)} />
    </details>
  );
}

/** Il questionario dopo l'evento come sara': in creazione, senza scelte, il
 *  feedback predefinito che il server aggiunge. */
function bloccoDopo(
  post: QuestionnaireBlock,
  libreria: ModelloDiDomande[],
  feedbackPredefinito: boolean
): QuestionnaireBlock {
  const predefinito = libreria.find((m) => m.name === FEEDBACK_GENERIC_TEMPLATE_NAME);
  return feedbackPredefinito &&
    predefinito &&
    post.templateIds.length === 0 &&
    post.adhocQuestions.length === 0
    ? { templateIds: [predefinito.id], adhocQuestions: [] }
    : post;
}

/** Nel riepilogo, sotto cio' che si chiede all'iscrizione: quante domande
 *  prima e dopo l'evento. */
export function RigheQuestionari({
  pre,
  post,
  feedbackPredefinito,
}: {
  pre: QuestionnaireBlock;
  post: QuestionnaireBlock;
  feedbackPredefinito: boolean;
}) {
  const t = useTranslations('admin.wizard.step3');
  const { righe: libreria, pronta } = useStatoLibreria();
  const dopo = bloccoDopo(post, libreria, feedbackPredefinito);
  // Prima che la libreria arrivi i numeri sarebbero sbagliati: non si dicono.
  const noto = (b: QuestionnaireBlock) => pronta && domandeArrivate(b, libreria);
  return (
    <>
      {noto(pre) && (
        <span className="d-block text-secondary">
          {t('questionsBefore', { count: contaBlocco(pre, libreria) })}
        </span>
      )}
      {noto(dopo) && (
        <span className="d-block text-secondary">
          {t('questionsAfter', { count: contaBlocco(dopo, libreria) })}
        </span>
      )}
    </>
  );
}

/**
 * Nel passo «Persone», sotto che cosa si chiede all'iscrizione: le domande in
 * piu' prima dell'evento e il questionario di gradimento dopo, ciascuno con
 * le sue domande da aprire e il modo di cambiarle.
 */
export function RiepilogoQuestionari({
  pre,
  post,
  feedbackPredefinito,
  onModifica,
}: {
  pre: QuestionnaireBlock;
  post: QuestionnaireBlock;
  /** In creazione, senza scelte, dopo l'evento si propone il feedback
   *  predefinito: lo si mostra com'e'. */
  feedbackPredefinito: boolean;
  onModifica: () => void;
}) {
  const t = useTranslations('admin.wizard.step3');
  const t4 = useTranslations('admin.wizard.step4');
  const { righe: libreria, pronta } = useStatoLibreria();
  const etichette = useEtichette();

  const dopo = bloccoDopo(post, libreria, feedbackPredefinito);

  const righe = [
    {
      chiave: 'pre',
      blocco: pre,
      testo: (n: number) => t('questionsBefore', { count: n }),
      // Finche' la libreria non arriva (o se non si e' potuta leggere) il
      // numero sarebbe sbagliato: resta il momento, e «Modifica».
      momento: t4('preHeading'),
      modifica: t('editQuestionsBefore'),
    },
    {
      chiave: 'post',
      blocco: dopo,
      testo: (n: number) => t('questionsAfter', { count: n }),
      momento: t4('postHeading'),
      modifica: t('editQuestionsAfter'),
    },
  ];

  return (
    <div className="wizard-questionari">
      <p className="wizard-iscrizione__domanda mb-1">{t('questionnairesHeading')}</p>
      <ul className="wizard-questionari__righe">
        {righe.map((r) => {
          const quante = contaBlocco(r.blocco, libreria);
          const noto = pronta && domandeArrivate(r.blocco, libreria);
          return (
            <li key={r.chiave} className="wizard-questionari__riga">
              {!noto ? (
                <span className="wizard-questionari__testo">{r.momento}</span>
              ) : quante > 0 ? (
                <details className="anteprima-domande anteprima-domande--riga">
                  <summary>{r.testo(quante)}</summary>
                  <ElencoDomande
                    gruppi={gruppiDelBlocco(r.blocco, libreria, etichette)}
                  />
                </details>
              ) : (
                <span className="wizard-questionari__testo">{r.testo(quante)}</span>
              )}
              <button
                type="button"
                className="btn btn-link btn-sm p-0 wizard-questionari__modifica"
                onClick={onModifica}
                aria-label={r.modifica}
              >
                {t('editQuestions')}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
