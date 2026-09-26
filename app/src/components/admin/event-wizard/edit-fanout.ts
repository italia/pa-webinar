/**
 * Il salvataggio delle risorse collegate a un evento: organizzatori,
 * co-moderatori e relatori, inviti, materiali, questionari.
 *
 * Vive fuori dal componente perche' e' logica pura di rete: si prova senza
 * rendere il wizard, e i casi che contano — una revoca rifiutata, un secondo
 * salvataggio che deve riprovarla — si verificano richiesta per richiesta.
 */

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
): Promise<void> {
  if (block.templateIds.length === 0 && block.adhocQuestions.length === 0) {
    return;
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
  await fanoutFetch(
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
 */
async function saveQuestionnaire(
  report: FanoutReport,
  eventId: string,
  placement: Placement,
  block: QuestionnaireBlock,
  initial: QuestionnaireBlock | null,
  defaultLocale: string,
): Promise<void> {
  if (!questionnaireChanged(block, initial)) return;

  const emptied =
    block.templateIds.length === 0 && block.adhocQuestions.length === 0;
  if (emptied) {
    if (!initial) return;
    await fanoutFetch(
      report,
      'questionnaires',
      `/api/admin/events/${eventId}/questionnaires/${placement}`,
      { method: 'DELETE' },
      // Gia' eliminato dalla pagina dei questionari in un'altra scheda: e'
      // lo stato desiderato, non un errore da mostrare.
      [404],
    );
    return;
  }

  await submitQuestionnaire(report, eventId, placement, block, defaultLocale);
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
//   – organizers:        `${name}|${organization}`
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
      return { outcome: 'ok', body, reason: null };
    }
    if (alreadyStatuses.includes(res.status)) {
      return { outcome: 'already', body: null, reason: null };
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { outcome: 'failed', body: null, reason: body.error ?? `HTTP ${res.status}` };
  } catch {
    // Rete caduta: la risorsa non e' salvata, e va detto comunque.
    return { outcome: 'failed', body: null, reason: null };
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
  const orgKey = (o: { name: string; organization: string }) =>
    `${o.name}|${o.organization}`;
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
        organization: o.organization,
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

  // EventModerators (MODERATOR + SPEAKER roles share one table)
  const modKey = (
    m: { email: string | null; role: 'MODERATOR' | 'SPEAKER' },
  ) => `${m.role}|${(m.email ?? '').toLowerCase()}`;
  const initialModByKey = new Map(
    initial.eventModerators.map((m) => [modKey(m), m]),
  );
  const currentMods: Array<{ email: string; role: 'MODERATOR' | 'SPEAKER'; name: string }> = [
    ...form.moderators.map((m) => ({ email: m.email, role: 'MODERATOR' as const, name: m.name })),
    ...form.speakers.map((s) => ({ email: s.email, role: 'SPEAKER' as const, name: s.name })),
  ];
  const currentModKeys = new Set(currentMods.map(modKey));
  for (const m of currentMods) {
    if (initialModByKey.has(modKey(m))) continue;
    const creato = await fanoutFetch(
      report,
      'moderators',
      `/api/events/${eventId}/moderators`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ name: m.name, email: m.email, role: m.role }),
      },
    );
    if (creato.body?.id) {
      initial.eventModerators.push({
        id: creato.body.id,
        name: m.name,
        email: m.email,
        role: m.role,
        personId: null,
      });
    }
  }
  for (const m of initial.eventModerators) {
    if (currentModKeys.has(modKey(m))) continue;
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
        body: JSON.stringify(m),
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
  );
  await saveQuestionnaire(
    report,
    eventId,
    'POST_EVENT',
    form.postEventQuestionnaire,
    initial.postEventQuestionnaire,
    defaultLocale,
  );

  return report;
}
