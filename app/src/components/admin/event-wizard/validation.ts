/**
 * Controlli del wizard e lettura degli errori di validazione del server.
 *
 * Gli errori sono chiavi a punti (`title.it`, `startsAt`): i passi le leggono
 * per evidenziare il campo e mostrano il proprio testo localizzato, il valore
 * della chiave non arriva mai all'operatore.
 */

import {
  EVENT_DESCRIPTION_MIN_LENGTH,
  EVENT_DESCRIPTION_REQUIRED_LOCALE,
} from '@/lib/validation/event-description';

import type { WizardForm } from './wizard-shell';

export const STEP_KEYS = ['base', 'permissions', 'invites', 'content', 'review'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

/**
 * I controlli che devono passare prima di lasciare un passo.
 *
 * Valgono anche per «Salva come bozza»: la creazione salva sempre una bozza e
 * lo schema del server e' lo stesso per bozza e pubblicazione, quindi titolo,
 * date e descrizione servono comunque. La bozza rinuncia solo al contatto del
 * moderatore principale (`validatePublish`), come dice il passo Riepilogo.
 */
export function validateStep(
  step: StepKey,
  form: WizardForm,
  defaultLocale: string,
): Record<string, string> {
  const errs: Record<string, string> = {};
  if (step === 'base') {
    const titleDef = (form.title[defaultLocale] ?? '').trim();
    if (titleDef.length < 3) {
      errs[`title.${defaultLocale}`] = 'required';
    }
    // Stessa soglia del server, ma sul testo senza spazi ai bordi: dieci
    // spazi non sono una descrizione.
    const descriptionDef = (form.description[defaultLocale] ?? '').trim();
    if (descriptionDef.length < EVENT_DESCRIPTION_MIN_LENGTH) {
      errs[`description.${defaultLocale}`] = 'required';
    }
    try {
      const start = new Date(form.startsAt);
      const end = new Date(form.endsAt);
      if (Number.isNaN(start.getTime())) errs['startsAt'] = 'invalid';
      if (Number.isNaN(end.getTime())) errs['endsAt'] = 'invalid';
      if (!errs['startsAt'] && !errs['endsAt'] && end <= start) {
        errs['endsAt'] = 'mustBeAfterStart';
      }
    } catch {
      errs['startsAt'] = 'invalid';
    }
    if (
      !Number.isFinite(form.maxParticipants) ||
      form.maxParticipants < 2 ||
      form.maxParticipants > 500
    ) {
      errs['maxParticipants'] = 'outOfRange';
    }
  }
  if (step === 'permissions') {
    // La traduzione automatica senza lingue target non produce nulla:
    // richiediamo almeno una lingua. (Errore mostrato nello step 2.)
    if (form.aiTranslationEnabled && !(form.aiTargetLocales ?? '').trim()) {
      errs['aiTargetLocales'] = 'required';
    }
  }
  return errs;
}

export function validatePublish(form: WizardForm): Record<string, string> {
  const errs: Record<string, string> = {};
  const email = (form.moderatorEmail ?? '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errs['moderatorEmail'] = 'required';
  }
  const name = (form.moderatorName ?? '').trim();
  if (name.length < 2) {
    errs['moderatorName'] = 'required';
  }
  return errs;
}

/**
 * I campi che un passo sa evidenziare, con il passo che li mostra. Un errore
 * del server su un campo fuori elenco non ha un posto visibile: va detto nel
 * messaggio, altrimenti «controlla i campi evidenziati» non indica niente.
 */
const INLINE_FIELDS: ReadonlyMap<string, StepKey> = new Map<string, StepKey>([
  ['startsAt', 'base'],
  ['endsAt', 'base'],
  ['maxParticipants', 'base'],
  ['aiTargetLocales', 'permissions'],
  ['gdprTemplateId', 'review'],
  ['moderatorName', 'review'],
  ['moderatorEmail', 'review'],
]);

/** Campi multilingua: il passo 1 li evidenzia nella lingua predefinita. */
const LOCALIZED_FIELDS = new Set(['title', 'description']);

export interface ServerIssueMapping {
  /** Chiavi da evidenziare, nella forma che leggono i passi. */
  fieldErrors: Record<string, string>;
  /** Il primo passo, nell'ordine del wizard, con un campo da correggere. */
  step: StepKey | null;
  /** I messaggi del server che nessun campo sa mostrare. */
  unmapped: string[];
}

/**
 * Traduce i `details` di una risposta 422 nei campi e nel passo del wizard.
 *
 * Lo schema del server segnala titolo e descrizione con il solo nome del campo
 * (`['description']`), per la lingua che esige: `it`. Se e' la lingua
 * predefinita del sito, il passo 1 evidenzia il campo; altrimenti non c'e' un
 * campo da evidenziare e il messaggio resta nell'avviso.
 */
export function mapServerIssues(details: unknown, defaultLocale: string): ServerIssueMapping {
  const fieldErrors: Record<string, string> = {};
  const unmapped: string[] = [];
  const steps = new Set<StepKey>();

  const issues = Array.isArray(details) ? details : [];
  for (const raw of issues) {
    const issue = (raw ?? {}) as { path?: unknown; message?: unknown };
    const path = Array.isArray(issue.path)
      ? issue.path.map(String)
      : issue.path != null
        ? String(issue.path).split('.')
        : [];
    const field = path[0] ?? '';
    const message = typeof issue.message === 'string' && issue.message ? issue.message : field;

    if (LOCALIZED_FIELDS.has(field)) {
      const locale = path[1] ?? EVENT_DESCRIPTION_REQUIRED_LOCALE;
      if (locale === defaultLocale) {
        fieldErrors[`${field}.${locale}`] = 'server';
        steps.add('base');
        continue;
      }
    } else {
      const step = INLINE_FIELDS.get(field);
      if (step) {
        fieldErrors[field] = 'server';
        steps.add(step);
        continue;
      }
    }
    if (message) unmapped.push(message);
  }

  return {
    fieldErrors,
    step: STEP_KEYS.find((k) => steps.has(k)) ?? null,
    unmapped,
  };
}
