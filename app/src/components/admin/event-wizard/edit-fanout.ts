/**
 * Il salvataggio delle risorse collegate a un evento: organizzatori,
 * co-moderatori e relatori, inviti, materiali, questionari.
 *
 * Vive fuori dal componente perche' e' logica pura di rete: si prova senza
 * rendere il wizard, e i casi che contano — una revoca rifiutata, un secondo
 * salvataggio che deve riprovarla — si verificano richiesta per richiesta.
 */

import { differenzaProfilo, profiloSalvato } from '@/lib/events/grant-profile';

import { questionnaireChanged } from './questionnaire-diff';
import type { AdhocQuestionDraft, QuestionnaireBlock } from './step-4-content';
import type { InitialEventShape, WizardForm } from './wizard-shell';

// ── Questionnaire fan-out helpers ──────────────────────────────────────────

type Placement = 'PRE_REGISTRATION' | 'POST_EVENT';

const PLACEMENT_TITLES: Record<Placement, { it: string; en: string }> = {
  PRE_REGISTRATION: { it: 'Pre-evento', en: 'Pre-event' },
  POST_EVENT: { it: 'Post-evento', en: 'Post-event' },
};

function mapAdhocToApi(
  draft: AdhocQuestionDraft,
  index: number,
  defaultLocale: string,
) {
  // Se il testo visibile è ancora quello caricato dal database, la domanda non
  // è stata riscritta: si rimandano indietro tutte le lingue, non solo quella
  // mostrata. Se invece è stato modificato, vince ciò che l'admin ha scritto.
  const typed = draft.prompt.trim();
  const untouched =
    draft.original !== undefined &&
    (draft.original.prompt[defaultLocale] ?? '').trim() === typed;
  const prompt: Record<string, string> = untouched
    ? draft.original!.prompt
    : { [defaultLocale]: typed };
  const base: Record<string, unknown> = {
    prompt,
    type: draft.type,
    required: draft.required,
    sortOrder: index,
  };
  if (untouched) {
    // Il wizard non ha campi per le etichette agli estremi di una scala:
    // ometterle qui le cancellerebbe.
    if (draft.original!.scaleMinLabel !== undefined)
      base.scaleMinLabel = draft.original!.scaleMinLabel;
    if (draft.original!.scaleMaxLabel !== undefined)
      base.scaleMaxLabel = draft.original!.scaleMaxLabel;
  }
  if (draft.type === 'SINGLE_CHOICE' || draft.type === 'MULTI_CHOICE') {
    base.options = draft.options
      .map((o) => o.trim())
      .filter((o) => o.length > 0)
      .map((o) => ({ [defaultLocale]: o }));
  }
  if (draft.type === 'LIKERT') {
    if (draft.scaleMin != null) base.scaleMin = draft.scaleMin;
    if (draft.scaleMax != null) base.scaleMax = draft.scaleMax;
  }
  return base;
}

export async function submitQuestionnaire(
  report: FanoutReport,
  eventId: string,
  placement: Placement,
  block: QuestionnaireBlock,
  defaultLocale: string,
): Promise<FanoutResult | null> {
  if (block.templateIds.length === 0 && block.adhocQuestions.length === 0) {
    return null;
  }
  // Questi quattro campi il wizard non li mostra. Per un questionario che
  // esiste già si rimandano indietro quelli che ha: scrivere i predefiniti
  // sopra un titolo curato, o azzerare l'obbligatorietà, sarebbe una perdita
  // silenziosa — e succede a ogni salvataggio, anche quando l'admin voleva
  // solo aggiungere una domanda.
  const body = {
    placement,
    title: block.original?.title ?? PLACEMENT_TITLES[placement],
    description: block.original?.description ?? {},
    required: block.original?.required ?? false,
    allowEdit: block.original?.allowEdit ?? false,
    templateIds: block.templateIds,
    adhocItems: block.adhocQuestions.map((q, i) =>
      mapAdhocToApi(q, i, defaultLocale),
    ),
  };
  return fanoutFetch(
    report,
    'questionnaires',
    `/api/admin/events/${eventId}/questionnaires/${placement}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/**
 * Edit mode: apply what the admin did to the questionnaire, and nothing else.
 *
 * Three outcomes, because the PUT alone can't express all of them: untouched →
 * don't write at all (it would reset what the wizard doesn't show); emptied →
 * DELETE, because the PUT ignores an empty body and the removal would be
 * swallowed silently; otherwise → the usual upsert.
 *
 * Un questionario che aveva gia' risposte all'apertura non si scrive mai da
 * qui: il passo lo mostra in sola lettura, ma una bozza ripresa potrebbe
 * portarne una versione modificata, e svuotarlo cancellerebbe le risposte.
 * Se le risposte arrivano dopo l'apertura, il server rifiuta la DELETE senza
 * conferma (e la PUT) con 409: il rifiuto finisce nel resoconto, e
 * `onHasResponses` lo segna nello scatto, cosi' i salvataggi successivi non
 * ripetono la richiesta che fallirebbe di nuovo.
 */
async function saveQuestionnaire(
  report: FanoutReport,
  eventId: string,
  placement: Placement,
  block: QuestionnaireBlock,
  initial: QuestionnaireBlock | null,
  defaultLocale: string,
  initialResponses: number,
  onHasResponses: () => void,
): Promise<void> {
  if (initialResponses > 0) return;
  if (!questionnaireChanged(block, initial)) return;

  const emptied =
    block.templateIds.length === 0 && block.adhocQuestions.length === 0;
  let esito: FanoutResult | null;
  if (emptied) {
    if (!initial) return;
    esito = await fanoutFetch(
      report,
      'questionnaires',
      `/api/admin/events/${eventId}/questionnaires/${placement}`,
      { method: 'DELETE' },
      // Gia' eliminato dalla pagina dei questionari in un'altra scheda: e'
      // lo stato desiderato, non un errore da mostrare.
      [404],
    );
  } else {
    esito = await submitQuestionnaire(report, eventId, placement, block, defaultLocale);
  }
  if (esito?.outcome === 'failed' && esito.status === 409) onHasResponses();
}

// ── Edit-mode fan-out: diff against the initial snapshot ────────────────────
//
// For each related collection (organizers / event moderators / invitations /
// materials) we:
//   – POST every row in `form` that is NOT in the initial snapshot (by a
//     stable identity key), and
//   – DELETE every initial row that is NOT in `form` by the same key.
//
// Identity keys:
//   – organizers:        `${name}|${websiteUrl}|${logoUrl}`
//   – moderators:        `${role}|${email}`
//   – invitations:       `${email}` (invitations are event-scoped unique by email)
//   – materials:         `${title}|${url}`
//
// Rows that exist on both sides are left untouched — the admin who only
// wanted to rename/reorder would need a dedicated PATCH-each row flow,
// which is out of scope for this refactor. Renaming effectively
// "replaces" the row (delete + re-add) which is acceptable here.
//
// Questionnaires are handled differently: the upsert endpoint is PUT and
// idempotently replaces templates + adhoc items, so we just call it.

/**
 * Il corpo con cui il wizard crea un materiale (POST
 * /api/admin/events/{id}/materials). Il wizard tiene il tipo in minuscolo
 * ('file' | 'link') e un id provvisorio; l'API vuole 'FILE' | 'LINK' e
 * nessun id: mandando la bozza cosi' com'era, ogni materiale veniva
 * rifiutato e l'evento nasceva senza.
 */
export function materialPayload(m: WizardForm['materials'][number]) {
  const file = m.type === 'file';
  return {
    title: m.title,
    url: m.url,
    description: m.description ?? null,
    type: file ? ('FILE' as const) : ('LINK' as const),
    visibility: m.visibility,
    // Di un file caricato la chiave nello storage: senza, la pulizia non
    // saprebbe che cosa cancellare e il file resterebbe per sempre.
    ...(file && {
      fileName: m.fileName ?? null,
      fileSize: m.fileSize ?? null,
      mimeType: m.mimeType ?? null,
      blobPath: m.blobPath ?? null,
    }),
  };
}

/**
 * Cosa il fan-out non e' riuscito a salvare.
 *
 * Il fan-out applica le modifiche alle risorse collegate con una richiesta per
 * ciascuna, e ognuna puo' fallire da sola: l'evento e' gia' salvato, il resto
 * no. Finche' gli esiti venivano ingoiati, il caso piu' frequente — una
 * domanda estemporanea incompleta, che fa rifiutare l'intero questionario —
 * si presentava come un salvataggio riuscito, e il questionario spariva.
 */
export interface FanoutReport {
  /** Le risorse che hanno rifiutato, nell'ordine in cui sono state tentate. */
  failed: string[];
  /** Il primo motivo dato dal server: e' l'unico che l'operatore puo' usare. */
  reason: string | null;
  /**
   * Le persone (co-moderatori e relatori) tolte dal wizard la cui revoca non
   * e' riuscita. Stanno a parte perche' non e' una modifica mancata come le
   * altre: il loro collegamento di accesso resta valido, e l'operatore deve
   * sapere di chi si tratta.
   */
  revocationFailed: string[];
}

export function newFanoutReport(): FanoutReport {
  return { failed: [], reason: null, revocationFailed: [] };
}

/**
 * L'esito di una richiesta del fan-out.
 *
 * - `ok`: il server ha eseguito la richiesta;
 * - `already`: il server dice che lo stato voluto c'era gia' (una riga gia'
 *   cancellata altrove risponde 404, un invito gia' presente 409);
 * - `failed`: rifiutata o mai arrivata. Lo scatto NON va aggiornato, cosi' il
 *   salvataggio successivo la riprova.
 */
export type FanoutOutcome = 'ok' | 'already' | 'failed';

interface FanoutResult {
  outcome: FanoutOutcome;
  /** Lo stato HTTP della risposta; null se la rete e' caduta. */
  status: number | null;
  /** Il corpo di una risposta riuscita: porta l'id della riga appena creata. */
  body: { id?: string } | null;
  /** Il motivo del rifiuto, quando `failed`. */
  reason: string | null;
}

async function fanoutRequest(
  input: string,
  init: RequestInit,
  alreadyStatuses: number[],
): Promise<FanoutResult> {
  try {
    const res = await fetch(input, init);
    if (res.ok) {
      // Il corpo serve a chi crea: porta l'identificativo della riga appena
      // nata, che va registrato nello scatto perche' un secondo salvataggio
      // non la ricrei, e perche' resti cancellabile nella stessa sessione.
      const body = (await res.json().catch(() => null)) as { id?: string } | null;
      return { outcome: 'ok', status: res.status, body, reason: null };
    }
    if (alreadyStatuses.includes(res.status)) {
      return { outcome: 'already', status: res.status, body: null, reason: null };
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      outcome: 'failed',
      status: res.status,
      body: null,
      reason: body.error ?? `HTTP ${res.status}`,
    };
  } catch {
    // Rete caduta: la risorsa non e' salvata, e va detto comunque.
    return { outcome: 'failed', status: null, body: null, reason: null };
  }
}

/**
 * Esegue una richiesta del fan-out registrando il rifiuto invece di ingoiarlo.
 *
 * `alreadyStatuses` sono gli stati che il server usa per dire che lo stato
 * voluto c'era gia': non sono errori da mostrare (vedi `FanoutOutcome`).
 */
export async function fanoutFetch(
  report: FanoutReport,
  resource: string,
  input: string,
  init: RequestInit,
  alreadyStatuses: number[] = [],
): Promise<FanoutResult> {
  const result = await fanoutRequest(input, init, alreadyStatuses);
  if (result.outcome === 'failed') {
    report.failed.push(resource);
    if (report.reason === null && result.reason !== null) {
      report.reason = result.reason;
    }
  }
  return result;
}

/**
 * Applica alle risorse collegate solo cio' che e' cambiato.
 *
 * `initial` viene AGGIORNATO man mano che le operazioni riescono, e chi chiama
 * deve conservarlo fra un salvataggio e l'altro. Senza, dopo un fallimento
 * parziale il secondo tentativo ricalcolerebbe il differenziale contro la
 * fotografia scattata all'apertura della pagina e ricreerebbe cio' che al
 * primo giro era gia' andato a buon fine: organizzatori, materiali e
 * co-moderatori duplicati — e per i co-moderatori ogni duplicato e' un nuovo
 * collegamento di accesso durevole, cioe' una credenziale.
 *
 * Vale anche al contrario: una cancellazione fallita lascia la riga nello
 * scatto, cosi' il salvataggio successivo la riprova. Per una revoca e' la
 * differenza fra un accesso tolto e uno che resta valido per sempre senza che
 * nessuno lo sappia.
 *
 * Tutte le richieste che agiscono con il collegamento del moderatore lo
 * mandano come `Authorization: Bearer`, l'unica forma che le rotte leggono
 * oltre a `?token=`: un'intestazione diversa arriva come richiesta anonima.
 */
export async function fanoutEditDiff(
  eventId: string,
  moderatorToken: string,
  form: WizardForm,
  initial: InitialEventShape,
  defaultLocale: string,
): Promise<FanoutReport> {
  const report = newFanoutReport();
  const auth = { Authorization: `Bearer ${moderatorToken}` };

  // Organizers
  const orgKey = (o: { name: string; logoUrl: string | null; websiteUrl: string | null }) =>
    `${o.name}|${o.websiteUrl ?? ''}|${o.logoUrl ?? ''}`;
  const initialOrgByKey = new Map(
    initial.organizers.map((o) => [orgKey(o), o]),
  );
  const currentOrgKeys = new Set(form.organizers.map(orgKey));
  for (const o of form.organizers) {
    if (initialOrgByKey.has(orgKey(o))) continue;
    const creato = await fanoutFetch(
      report,
      'organizers',
      `/api/events/${eventId}/organizers`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          name: o.name,
          logoUrl: o.logoUrl,
          websiteUrl: o.websiteUrl,
        }),
      },
    );
    if (creato.body?.id) {
      initial.organizers.push({
        id: creato.body.id,
        name: o.name,
        logoUrl: o.logoUrl ?? null,
        websiteUrl: o.websiteUrl ?? null,
      });
    }
  }
  for (const o of initial.organizers) {
    if (currentOrgKeys.has(orgKey(o))) continue;
    const esito = await fanoutFetch(
      report,
      'organizers',
      `/api/events/${eventId}/organizers/${o.id}`,
      { method: 'DELETE', headers: auth },
      // Gia' rimosso altrove: e' lo stato che si voleva.
      [404],
    );
    if (esito.outcome === 'failed') continue;
    initial.organizers = initial.organizers.filter((x) => x.id !== o.id);
  }

  // Le persone (concessioni MODERATOR e SPEAKER, una tabella sola). Una
  // persona già salvata si riconosce dall'id della sua concessione, non
  // dall'indirizzo: le concessioni senza email (dal pannello dell'evento)
  // avrebbero tutte la stessa chiave. Una persona nuova si riconosce da ruolo
  // ed email, che il wizard chiede e non ripete: serve al salvataggio che
  // riprova, quando la concessione creata al primo giro è già nello scatto.
  type Concessione = (typeof initial.eventModerators)[number];
  const chiave = (m: { email: string | null; role: 'MODERATOR' | 'SPEAKER' }) =>
    `${m.role}|${(m.email ?? '').toLowerCase()}`;
  const correnti = [
    ...form.moderators.map((m) => ({ ...m, role: 'MODERATOR' as const })),
    ...form.speakers.map((m) => ({ ...m, organizer: false, role: 'SPEAKER' as const })),
  ];
  // Le concessioni da tenere: quelle che una persona del modulo usa ancora.
  const tenute = new Set<string>();
  const trova = (pred: (g: Concessione) => boolean) =>
    initial.eventModerators.find((g) => !tenute.has(g.id) && pred(g));

  for (const c of correnti) {
    const salvata = c.grantId ? initial.eventModerators.find((g) => g.id === c.grantId) : undefined;
    // La concessione con cui la persona entra ora: la sua, se il ruolo è lo
    // stesso; quella che la sostituisce, se un salvataggio precedente ha
    // già cambiato il ruolo; per una persona nuova, quella creata al giro
    // prima.
    const attuale =
      salvata && salvata.role === c.role
        ? salvata
        : salvata
          ? trova((g) => g.replaces === salvata.id && g.role === c.role)
          : c.email
            ? trova((g) => !g.replaces && chiave(g) === chiave(c))
            : undefined;
    if (attuale) {
      tenute.add(attuale.id);
      // Il link resta: cambia solo il profilo (ente, logo, organizzatore,
      // pagina pubblica).
      const profilo = differenzaProfilo(attuale, c);
      if (!profilo) continue;
      const aggiornato = await fanoutFetch(
        report,
        'moderators',
        `/api/events/${eventId}/moderators/${attuale.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify(profilo),
        },
      );
      if (aggiornato.outcome === 'ok') Object.assign(attuale, profilo);
      continue;
    }
    // Una persona nuova, o un cambio fra moderatore e relatore: serve una
    // concessione nuova, con un link nuovo.
    const profilo = profiloSalvato(c);
    const creato = await fanoutFetch(
      report,
      'moderators',
      `/api/events/${eventId}/moderators`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          name: c.name,
          // Una concessione senza indirizzo resta senza: la stringa vuota
          // non è un'email e farebbe rifiutare la richiesta.
          email: c.email || undefined,
          role: c.role,
          ...profilo,
        }),
      },
    );
    if (creato.body?.id) {
      initial.eventModerators.push({
        id: creato.body.id,
        name: c.name,
        email: c.email || null,
        role: c.role,
        personId: null,
        ...profilo,
        ...(salvata && { replaces: salvata.id }),
      });
      tenute.add(creato.body.id);
    } else if (salvata) {
      // Il cambio di ruolo non è riuscito: la persona tiene il link che ha.
      tenute.add(salvata.id);
    }
  }
  for (const m of [...initial.eventModerators]) {
    if (tenute.has(m.id)) continue;
    // Una revoca: finche' non riesce, il collegamento della persona resta
    // valido. Non entra fra le risorse generiche ma nell'elenco nominativo,
    // che il wizard mostra per nome.
    const esito = await fanoutRequest(
      `/api/events/${eventId}/moderators/${m.id}`,
      { method: 'DELETE', headers: auth },
      [404],
    );
    if (esito.outcome === 'failed') {
      report.revocationFailed.push(m.name);
      continue;
    }
    initial.eventModerators = initial.eventModerators.filter((x) => x.id !== m.id);
  }

  // Invitations (admin-session auth, no moderator token)
  const invKey = (i: { email: string }) => i.email.toLowerCase();
  const initialInvByKey = new Map(initial.invitations.map((i) => [invKey(i), i]));
  const currentInvKeys = new Set(form.invitations.map(invKey));
  for (const i of form.invitations) {
    if (initialInvByKey.has(invKey(i))) continue;
    const creato = await fanoutFetch(
      report,
      'invitations',
      `/api/admin/events/${eventId}/invitations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: i.email,
          name: i.name ?? undefined,
          role: i.role,
          personId: i.personId ?? undefined,
        }),
      },
      // 409 = esiste gia' un invito per quella email su questo evento, che e'
      // esattamente lo stato voluto. Senza, un secondo salvataggio dopo un
      // fallimento parziale lo segnalerebbe come errore per sempre, e non si
      // arriverebbe mai a un salvataggio pulito.
      [409],
    );
    if (creato.body?.id) {
      initial.invitations.push({
        id: creato.body.id,
        name: i.name ?? null,
        email: i.email,
        role: i.role,
        personId: i.personId ?? null,
      });
    }
  }
  for (const i of initial.invitations) {
    if (currentInvKeys.has(invKey(i))) continue;
    const esito = await fanoutFetch(
      report,
      'invitations',
      `/api/admin/events/${eventId}/invitations/${i.id}`,
      { method: 'DELETE' },
      [404],
    );
    if (esito.outcome === 'failed') continue;
    initial.invitations = initial.invitations.filter((x) => x.id !== i.id);
  }

  // Materials
  const matKey = (m: { title: string; url: string }) => `${m.title}|${m.url}`;
  const initialMatByKey = new Map(initial.materials.map((m) => [matKey(m), m]));
  const currentMatKeys = new Set(form.materials.map(matKey));
  for (const m of form.materials) {
    if (initialMatByKey.has(matKey(m))) continue;
    const creato = await fanoutFetch(
      report,
      'materials',
      `/api/admin/events/${eventId}/materials`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(materialPayload(m)),
      },
    );
    if (creato.body?.id) {
      initial.materials.push({ ...m, id: creato.body.id, description: m.description ?? null });
    }
  }
  for (const m of initial.materials) {
    if (currentMatKeys.has(matKey(m))) continue;
    const esito = await fanoutFetch(
      report,
      'materials',
      `/api/admin/events/${eventId}/materials/${m.id}`,
      { method: 'DELETE' },
      [404],
    );
    if (esito.outcome === 'failed') continue;
    initial.materials = initial.materials.filter((x) => x.id !== m.id);
  }

  // Un rifiuto per risposte arrivate nel frattempo: lo scatto lo ricorda.
  const segnaRisposte = (momento: 'pre' | 'post') => {
    initial.questionnaireResponses = {
      pre: initial.questionnaireResponses?.pre ?? 0,
      post: initial.questionnaireResponses?.post ?? 0,
      [momento]: Math.max(1, initial.questionnaireResponses?.[momento] ?? 0),
    };
  };

  // Questionnaires — PUT is idempotent (replaces templates + adhoc items);
  // a rejection (e.g. 409 once responses exist) lands in the report like the
  // other resources.
  //
  // Only when the admin actually changed it: the PUT rewrites the whole
  // questionnaire from the fields the wizard knows, so saving an untouched one
  // would reset the title, the mandatory flag and any multilingual text the
  // wizard doesn't show (see questionnaire-diff for the full reasoning).
  await saveQuestionnaire(
    report,
    eventId,
    'PRE_REGISTRATION',
    form.preEventQuestionnaire,
    initial.preEventQuestionnaire,
    defaultLocale,
    initial.questionnaireResponses?.pre ?? 0,
    () => segnaRisposte('pre'),
  );
  await saveQuestionnaire(
    report,
    eventId,
    'POST_EVENT',
    form.postEventQuestionnaire,
    initial.postEventQuestionnaire,
    defaultLocale,
    initial.questionnaireResponses?.post ?? 0,
    () => segnaRisposte('post'),
  );

  return report;
}
