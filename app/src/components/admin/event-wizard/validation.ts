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
import { parseLocaleList } from '@/lib/ai/target-locales';
import { MAX_RETENTION_DAYS } from '@/lib/validation/retention';
import { WIZARD_STEPS, type WizardStep } from '@/lib/events/wizard-steps';

import type { WizardForm } from './wizard-shell';

export const STEP_KEYS = WIZARD_STEPS;
export type StepKey = WizardStep;

/**
 * I controlli che devono passare prima di lasciare un passo.
 *
 * Valgono anche per «Salva come bozza»: la creazione salva sempre una bozza e
 * lo schema del server e' lo stesso per bozza e pubblicazione, quindi titolo,
 * date e descrizione servono comunque. La bozza rinuncia solo al contatto
 * dell'organizzatore principale (`validatePublish`), come dice il passo
 * Persone.
 */
export function validateStep(
  step: StepKey,
  form: WizardForm,
  defaultLocale: string,
  /** Il massimo accettato per la conservazione: in modifica, se l'evento ha
   *  gia' un valore piu' alto (una pubblicazione in libreria), quello. */
  retentionMax: number = MAX_RETENTION_DAYS,
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
  }
  if (step === 'schedule') {
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
      form.maxParticipants > 5000
    ) {
      errs['maxParticipants'] = 'outOfRange';
    }
  }
  if (step === 'review') {
    // La traduzione automatica senza lingue target non produce nulla:
    // richiediamo almeno una lingua. Le lingue si scelgono nel riepilogo (e
    // nelle impostazioni avanzate, alla registrazione).
    // Letti come li legge la pipeline: un valore vecchio scritto a mano
    // ("english", "en;fr") non conta come lingua.
    // Conta solo una traduzione che parte davvero: senza registrazione o senza
    // trascrizione l'interruttore resta nel modulo ma non si salva (e le
    // lingue non si vedono).
    const traduce = form.recordingEnabled && form.aiTranscriptEnabled && form.aiTranslationEnabled;
    if (traduce && parseLocaleList(form.aiTargetLocales).length === 0) {
      errs['aiTargetLocales'] = 'required';
    }
  }
  if (step === 'advanced') {
    // Gli stessi limiti del server: un valore fuori misura (arrivato da un
    // template) farebbe fallire il salvataggio senza dire dove.
    const giorni = form.dataRetentionDays;
    if (!Number.isInteger(giorni) || giorni < 1 || giorni > retentionMax) {
      errs['dataRetentionDays'] = 'outOfRange';
    }
  }
  return errs;
}

/** Un indirizzo email plausibile: la stessa regola per il pulsante
 *  «Pubblica», per il campo che lo chiede e per l'elenco di cio' che manca. */
export function emailValida(email: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email ?? '').trim());
}

/** Il nome dell'organizzatore principale basta per pubblicare. */
export function nomeOrganizzatoreValido(nome: string | null | undefined): boolean {
  return (nome ?? '').trim().length >= 2;
}

export function validatePublish(form: WizardForm): Record<string, string> {
  const errs: Record<string, string> = {};
  // Nell'ordine della pagina: prima il nome, poi l'email.
  if (!nomeOrganizzatoreValido(form.moderatorName)) {
    errs['moderatorName'] = 'required';
  }
  if (!emailValida(form.moderatorEmail)) {
    errs['moderatorEmail'] = 'required';
  }
  return errs;
}

/**
 * I campi che un passo sa evidenziare, con il passo che li mostra. Un errore
 * del server su un campo fuori elenco non ha un posto visibile: va detto nel
 * messaggio, altrimenti «controlla i campi evidenziati» non indica niente.
 */
const INLINE_FIELDS: ReadonlyMap<string, StepKey> = new Map<string, StepKey>([
  ['startsAt', 'schedule'],
  ['endsAt', 'schedule'],
  ['maxParticipants', 'schedule'],
  ['aiTargetLocales', 'review'],
  ['gdprTemplateId', 'advanced'],
  ['dataRetentionDays', 'advanced'],
  ['moderatorName', 'invites'],
  ['moderatorEmail', 'invites'],
  ['moderatorOrganization', 'invites'],
  ['moderatorOrganizationLogoUrl', 'invites'],
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

/** Un campo che manca, e il passo in cui si compila. */
export interface CampoMancante {
  key: string;
  step: StepKey;
  /** Serve per salvare anche una bozza, o solo per pubblicare. */
  perPubblicare: boolean;
}

/**
 * Tutto cio' che manca, nell'ordine del wizard: lo dicono la barra dei passi
 * («Da completare») e il riepilogo («Per pubblicare manca ancora»), prima di
 * premere un pulsante.
 */
export function campiMancanti(
  form: WizardForm,
  defaultLocale: string,
  retentionMax: number = MAX_RETENTION_DAYS,
  /** Si pubblica da qui (creazione): contano anche i dati che servono solo
   *  per pubblicare. In modifica si aggiorna e basta. */
  conPubblicazione = true,
): CampoMancante[] {
  const out: CampoMancante[] = [];
  for (const step of STEP_KEYS) {
    for (const key of Object.keys(validateStep(step, form, defaultLocale, retentionMax))) {
      out.push({ key, step, perPubblicare: false });
    }
  }
  for (const key of conPubblicazione ? Object.keys(validatePublish(form)) : []) {
    out.push({ key, step: INLINE_FIELDS.get(key) ?? 'invites', perPubblicare: true });
  }
  const ordine = (k: StepKey) => STEP_KEYS.indexOf(k);
  return out.sort((a, b) => ordine(a.step) - ordine(b.step));
}
