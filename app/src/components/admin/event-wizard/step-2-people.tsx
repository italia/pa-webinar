'use client';

import { useContext, useState } from 'react';
import { useTranslations } from 'next-intl';

import RubricaPicker, {
  RubricaAccessContext,
  type RubricaPickedPerson,
} from '@/components/admin/rubrica-picker';
import FileOrUrlInput from '@/components/ui/file-or-url-input';
import type { PersonRole } from '@/lib/events/grant-profile';
import { logoPubblico } from '@/lib/events/public-people';

/** Un ente che organizza l'evento: compare nella pagina pubblica. */
export interface OrganizerEntry {
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
}

/** L'ente di una persona e se la pagina pubblica la presenta. L'ente della
 *  persona può essere diverso da quello che organizza l'evento. */
export interface PersonProfile {
  organization: string | null;
  organizationLogoUrl: string | null;
  publicListed: boolean;
}

/** Organizzatori e moderatori: conducono la sala, ognuno con il proprio link. */
export interface ModeratorEntry extends PersonProfile {
  /** La concessione salvata della persona; assente per chi è nuovo. */
  grantId?: string | null;
  name: string;
  email: string;
  personId: string | null;
  /** Organizzatore: la pagina pubblica lo presenta fra chi organizza. */
  organizer: boolean;
}

/** Relatori: parlano e mostrano lo schermo, senza poteri di moderazione. */
export interface SpeakerEntry extends PersonProfile {
  /** La concessione salvata della persona; assente per chi è nuovo. */
  grantId?: string | null;
  name: string;
  email: string;
  personId: string | null;
}

/**
 * Una persona invitata. Il ruolo resta quello salvato (gli inviti nuovi sono
 * ospiti): chi deve parlare si aggiunge fra i relatori, che hanno un accesso
 * proprio.
 */
export interface InvitationEntry {
  name: string | null;
  email: string;
  role: 'GUEST' | 'SPEAKER';
  personId: string | null;
}

export interface StepPeopleValue {
  organizers: OrganizerEntry[];
  moderators: ModeratorEntry[];
  speakers: SpeakerEntry[];
  invitations: InvitationEntry[];
}

/** L'organizzatore principale, con il profilo per la pagina pubblica. */
interface LeadOrganizer extends PersonProfile {
  name: string;
  email: string;
}

interface LeadOrganizerPatch {
  moderatorName?: string;
  moderatorEmail?: string;
  moderatorOrganization?: string | null;
  moderatorOrganizationLogoUrl?: string | null;
  moderatorPublicListed?: boolean;
}

interface Props {
  value: StepPeopleValue;
  onChange: (patch: Partial<StepPeopleValue>) => void;
  /** Con il solo link del moderatore gli inviti si vedono ma non si
   *  modificano: li gestisce lo staff. */
  invitationsLocked?: boolean;
  /** L'organizzatore principale: riceve il link condiviso per condurre. */
  primary: LeadOrganizer;
  onPrimaryChange: (patch: LeadOrganizerPatch) => void;
  fieldErrors?: Record<string, string>;
  /** Chi crea l'evento, precompilato: se lo conduce un'altra persona, il
   *  link deve arrivare a lei. */
  prefilledModeratorEmail?: string | null;
  /** I link partono alla pubblicazione (evento nuovo o in bozza). */
  showLinksOnPublish?: boolean;
  /** L'iscrizione pubblica dell'installazione (SiteSetting): decide che cosa
   *  vuol dire l'elenco degli invitati. */
  publicRegistrationEnabled?: boolean;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function StepPeople({
  value,
  onChange,
  invitationsLocked = false,
  primary,
  onPrimaryChange,
  fieldErrors = {},
  prefilledModeratorEmail = null,
  showLinksOnPublish = false,
  publicRegistrationEnabled = true,
}: Props) {
  const t = useTranslations('admin.wizard.step3');
  const principale = primary.email.trim() ? [primary.email.trim()] : [];

  return (
    <div>
      <h2 className="h4 fw-bold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('heading')}
      </h2>
      <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
        {t('intro')}
      </p>

      <PrimarySection
        primary={primary}
        onPrimaryChange={onPrimaryChange}
        fieldErrors={fieldErrors}
        prefilledModeratorEmail={prefilledModeratorEmail}
        showLinksOnPublish={showLinksOnPublish}
      />

      <OrganizersSection
        value={value.organizers}
        onChange={(next) => onChange({ organizers: next })}
      />

      <PeopleSection
        moderators={value.moderators}
        speakers={value.speakers}
        onChange={onChange}
        taken={principale}
      />

      <InvitationsSection
        value={value.invitations}
        onChange={(next) => onChange({ invitations: next })}
        locked={invitationsLocked}
        publicRegistrationEnabled={publicRegistrationEnabled}
      />
    </div>
  );
}

/**
 * L'organizzatore principale: riceve per email il link condiviso per condurre
 * l'evento. Nome ed email servono per pubblicare, non per la bozza.
 */
function PrimarySection({
  primary,
  onPrimaryChange,
  fieldErrors,
  prefilledModeratorEmail,
  showLinksOnPublish,
}: {
  primary: LeadOrganizer;
  onPrimaryChange: Props['onPrimaryChange'];
  fieldErrors: Record<string, string>;
  prefilledModeratorEmail: string | null;
  showLinksOnPublish: boolean;
}) {
  const t = useTranslations('admin.wizard.step3');
  const precompilato =
    !!prefilledModeratorEmail &&
    primary.email.trim().toLowerCase() === prefilledModeratorEmail.trim().toLowerCase();
  return (
    <section
      className="wizard-group wizard-group--static mb-3"
      aria-labelledby="wiz-primary-title"
    >
      <div className="wizard-group__body">
        <h3
          id="wiz-primary-title"
          className="h6 fw-semibold mb-1"
          style={{ color: 'var(--app-text)' }}
        >
          {t('primaryHeading')}
        </h3>
        <p className="text-secondary mb-2" style={{ fontSize: '0.85rem' }}>
          {t('primaryHelp')}
          {showLinksOnPublish && <> {t('linksOnPublish')}</>}
        </p>
        {precompilato && (
          <div
            className="alert alert-warning py-2 mb-3"
            role="note"
            style={{ fontSize: '0.85rem' }}
          >
            {t('primaryPrefilled')}
          </div>
        )}
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label" htmlFor="wiz-primary-name">
              {t('personName')}
            </label>
            <input
              id="wiz-primary-name"
              type="text"
              className={`form-control${fieldErrors.moderatorName ? ' is-invalid' : ''}`}
              value={primary.name}
              onChange={(e) => onPrimaryChange({ moderatorName: e.target.value })}
            />
            {fieldErrors.moderatorName && (
              <div className="invalid-feedback d-block">{t('primaryNameRequired')}</div>
            )}
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="wiz-primary-email">
              {t('personEmail')}
            </label>
            <input
              id="wiz-primary-email"
              type="email"
              className={`form-control${fieldErrors.moderatorEmail ? ' is-invalid' : ''}`}
              value={primary.email}
              onChange={(e) => onPrimaryChange({ moderatorEmail: e.target.value })}
            />
            {fieldErrors.moderatorEmail && (
              <div className="invalid-feedback d-block">{t('primaryEmailRequired')}</div>
            )}
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="wiz-primary-org">
              {t('personOrganization')}
            </label>
            <input
              id="wiz-primary-org"
              type="text"
              maxLength={200}
              className={`form-control${fieldErrors.moderatorOrganization ? ' is-invalid' : ''}`}
              value={primary.organization ?? ''}
              onChange={(e) =>
                onPrimaryChange({ moderatorOrganization: e.target.value || null })
              }
            />
            {(fieldErrors.moderatorOrganization ||
              fieldErrors.moderatorOrganizationLogoUrl) && (
              <div className="invalid-feedback d-block">{t('primaryProfileInvalid')}</div>
            )}
          </div>
          <div className="col-md-6 d-flex align-items-end">
            <div className="form-check mb-2">
              <input
                id="wiz-primary-public"
                type="checkbox"
                className="form-check-input"
                checked={primary.publicListed}
                onChange={(e) =>
                  onPrimaryChange({ moderatorPublicListed: e.target.checked })
                }
              />
              <label className="form-check-label" htmlFor="wiz-primary-public">
                {t('personPublic')}
              </label>
            </div>
          </div>
          <div className="col-12">
            <details className="wizard-person__logo">
              <summary className="small">
                {primary.organizationLogoUrl ? t('personLogoChange') : t('personLogoAdd')}
              </summary>
              <div className="pt-2">
                <FileOrUrlInput
                  id="wiz-primary-logo"
                  label={t('personLogo')}
                  assetType="image"
                  value={primary.organizationLogoUrl}
                  onChange={(v) => onPrimaryChange({ moderatorOrganizationLogoUrl: v })}
                />
              </div>
            </details>
            <LogoEsterno url={primary.organizationLogoUrl} />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Una sezione del passo, richiudibile: chiusa finche' e' vuota, aperta se ha
 * gia' qualcuno. Il riassunto dice cosa contiene e quante persone ci sono,
 * cosi' il passo si legge con un colpo d'occhio e si apre solo cio' che serve.
 */
function Gruppo({
  title,
  help,
  count,
  children,
}: {
  title: string;
  help: string;
  count: number;
  children: React.ReactNode;
}) {
  const [apertoAllInizio] = useState(count > 0);
  return (
    <details className="wizard-group mb-3" open={apertoAllInizio || undefined}>
      <summary>
        <span className="wizard-group__title">
          {title}
          {count > 0 && (
            <span className="badge rounded-pill ms-2 wizard-group__count">{count}</span>
          )}
        </span>
        <span className="wizard-group__help">{help}</span>
      </summary>
      <div className="wizard-group__body">{children}</div>
    </details>
  );
}

/** L'elenco di chi e' gia' stato aggiunto; senza `onRemove` e' in sola lettura. */
function AddedList<T>({
  items,
  keyOf,
  primary,
  secondary,
  note,
  onRemove,
}: {
  items: T[];
  keyOf: (item: T) => string;
  primary: (item: T) => string;
  secondary: (item: T) => string | null;
  /** Una nota sotto la voce, quando serve. */
  note?: (item: T) => React.ReactNode;
  onRemove?: (index: number) => void;
}) {
  const t = useTranslations('admin.wizard.step3');
  if (items.length === 0) return null;
  return (
    <ul className="list-group mb-3">
      {items.map((item, i) => (
        <li
          key={`${keyOf(item)}-${i}`}
          className="list-group-item d-flex justify-content-between align-items-center gap-2"
        >
          <div className="text-break">
            <div className="fw-semibold">{primary(item)}</div>
            {secondary(item) && <small className="text-muted">{secondary(item)}</small>}
            {note?.(item)}
          </div>
          {onRemove && (
            <button
              type="button"
              className="btn btn-sm btn-outline-danger flex-shrink-0"
              onClick={() => onRemove(i)}
              aria-label={t('removeItem', { name: primary(item) })}
            >
              {t('remove')}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** La ricerca in rubrica, quando chi compila puo' usarla. */
function RubricaRow({
  onAddMany,
}: {
  onAddMany: (picks: RubricaPickedPerson[]) => void;
}) {
  const t = useTranslations('admin.wizard.step3');
  if (!useContext(RubricaAccessContext)) return null;
  return (
    <div className="mb-2">
      <RubricaPicker mode="multi" onAddMany={onAddMany} placeholder={t('rubricaPick')} />
      <small className="text-muted">{t('rubricaOrAdd')}</small>
    </div>
  );
}

/**
 * Un logo indicato con un indirizzo di un altro sito non compare nella pagina
 * pubblica (lib/events/public-people): va detto subito, non scoperto dopo.
 */
function LogoEsterno({ url }: { url: string | null | undefined }) {
  const t = useTranslations('admin.wizard.step3');
  if (!url || logoPubblico(url)) return null;
  return (
    <small className="d-block text-warning mt-1" role="status">
      {t('logoExternal')}
    </small>
  );
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="col-12">
      <small className="text-danger" role="alert">
        {message}
      </small>
    </div>
  );
}

function OrganizersSection({
  value,
  onChange,
}: {
  value: OrganizerEntry[];
  onChange: (next: OrganizerEntry[]) => void;
}) {
  const t = useTranslations('admin.wizard.step3');
  const id = 'org';
  const vuoto: OrganizerEntry = { name: '', logoUrl: null, websiteUrl: null };
  const [draft, setDraft] = useState<OrganizerEntry>(vuoto);
  const [err, setErr] = useState<string | null>(null);

  const add = () => {
    if (!draft.name.trim()) {
      setErr(t('organizerRequired'));
      return;
    }
    setErr(null);
    onChange([
      ...value,
      {
        name: draft.name.trim(),
        logoUrl: draft.logoUrl?.trim() || null,
        websiteUrl: draft.websiteUrl?.trim() || null,
      },
    ]);
    setDraft(vuoto);
  };

  return (
    <Gruppo
      title={t('organizersHeading')}
      help={t('organizersHelp')}
      count={value.length}
    >
      <AddedList
        items={value}
        keyOf={(o) => o.name}
        primary={(o) => o.name}
        secondary={(o) => o.websiteUrl}
        note={(o) => <LogoEsterno url={o.logoUrl} />}
        onRemove={(i) => onChange(value.filter((_, j) => j !== i))}
      />

      <div className="row g-2 align-items-end">
        <div className="col-md-6">
          <label className="form-label" htmlFor={`${id}-name`}>
            {t('organizerName')}
          </label>
          <input
            id={`${id}-name`}
            type="text"
            className="form-control"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="col-md-6">
          <label className="form-label" htmlFor={`${id}-web`}>
            {t('organizerWebsite')}
          </label>
          <input
            id={`${id}-web`}
            type="url"
            className="form-control"
            value={draft.websiteUrl ?? ''}
            onChange={(e) => setDraft({ ...draft, websiteUrl: e.target.value || null })}
          />
        </div>
        <div className="col-12">
          <FileOrUrlInput
            id={`${id}-logo`}
            label={t('organizerLogo')}
            assetType="image"
            value={draft.logoUrl}
            onChange={(v) => setDraft({ ...draft, logoUrl: v })}
          />
          <LogoEsterno url={draft.logoUrl} />
        </div>
        <div className="col-md-3">
          <button type="button" className="btn btn-primary w-100" onClick={add}>
            {t('add')}
          </button>
        </div>
        <FieldError message={err} />
      </div>
    </Gruppo>
  );
}

/** Una persona dell'elenco, con l'elenco e la posizione da cui viene. */
interface Riga {
  kind: 'moderators' | 'speakers';
  index: number;
  entry: ModeratorEntry | SpeakerEntry;
  role: PersonRole;
}

function righe(moderators: ModeratorEntry[], speakers: SpeakerEntry[]): Riga[] {
  return [
    ...moderators.map((entry, index) => ({
      kind: 'moderators' as const,
      index,
      entry,
      role: (entry.organizer === true ? 'organizer' : 'moderator') as PersonRole,
    })),
    ...speakers.map((entry, index) => ({
      kind: 'speakers' as const,
      index,
      entry,
      role: 'speaker' as const,
    })),
  ];
}

interface Bozza extends PersonProfile {
  name: string;
  email: string;
  personId: string | null;
  role: PersonRole;
}

// «Mostra nella pagina pubblica» parte spento per tutti: pubblicare nome ed
// ente di una persona è una scelta, persona per persona.
const BOZZA_VUOTA: Bozza = {
  name: '',
  email: '',
  personId: null,
  role: 'speaker',
  organization: null,
  organizationLogoUrl: null,
  publicListed: false,
};

/** Mette una persona nell'elenco del suo ruolo. */
function conRuolo(
  moderators: ModeratorEntry[],
  speakers: SpeakerEntry[],
  persona: SpeakerEntry,
  role: PersonRole
): Pick<StepPeopleValue, 'moderators' | 'speakers'> {
  if (role === 'speaker') return { moderators, speakers: [...speakers, persona] };
  return {
    moderators: [...moderators, { ...persona, organizer: role === 'organizer' }],
    speakers,
  };
}

/**
 * Le persone dell'evento in un elenco solo: organizzatori, moderatori e
 * relatori. Ognuno riceve un proprio link per entrare con il suo ruolo; il
 * ruolo si cambia dall'elenco.
 */
function PeopleSection({
  moderators,
  speakers,
  onChange,
  taken,
}: {
  moderators: ModeratorEntry[];
  speakers: SpeakerEntry[];
  onChange: (patch: Partial<StepPeopleValue>) => void;
  /** Gli indirizzi già usati altrove (l'organizzatore principale). */
  taken: readonly string[];
}) {
  const t = useTranslations('admin.wizard.step3');
  const id = 'person';
  const [draft, setDraft] = useState<Bozza>(BOZZA_VUOTA);
  const [err, setErr] = useState<string | null>(null);
  const tutte = righe(moderators, speakers);
  // Una persona ha un ruolo solo: gli indirizzi, senza distinguere maiuscole
  // (quelli di un evento esistente possono averne).
  const giaPresenti = new Set(
    [...tutte.map((r) => r.entry.email), ...taken].map((e) => e.toLowerCase())
  );

  const senza = (r: Riga): Pick<StepPeopleValue, 'moderators' | 'speakers'> =>
    r.kind === 'moderators'
      ? { moderators: moderators.filter((_, j) => j !== r.index), speakers }
      : { moderators, speakers: speakers.filter((_, j) => j !== r.index) };

  const aggiorna = (r: Riga, patch: Partial<ModeratorEntry>) => {
    if (r.kind === 'moderators') {
      onChange({
        moderators: moderators.map((m, j) => (j === r.index ? { ...m, ...patch } : m)),
      });
    } else {
      onChange({
        speakers: speakers.map((m, j) => (j === r.index ? { ...m, ...patch } : m)),
      });
    }
  };

  const cambiaRuolo = (r: Riga, role: PersonRole) => {
    if (role === r.role) return;
    // Fra organizzatore e moderatore cambia solo il segno: il link resta.
    if (r.kind === 'moderators' && role !== 'speaker') {
      aggiorna(r, { organizer: role === 'organizer' });
      return;
    }
    const { organizer: _organizer, ...persona } = r.entry as ModeratorEntry;
    const resto = senza(r);
    onChange(conRuolo(resto.moderators, resto.speakers, persona, role));
  };

  const add = () => {
    if (!draft.name.trim() || !draft.email.trim()) {
      setErr(t('personRequired'));
      return;
    }
    const email = draft.email.trim().toLowerCase();
    if (!isEmail(email)) {
      setErr(t('invalidEmail'));
      return;
    }
    if (giaPresenti.has(email)) {
      setErr(t('duplicateEmail'));
      return;
    }
    setErr(null);
    onChange(
      conRuolo(
        moderators,
        speakers,
        {
          name: draft.name.trim(),
          email,
          personId: draft.personId,
          organization: draft.organization?.trim() || null,
          organizationLogoUrl: draft.organizationLogoUrl?.trim() || null,
          publicListed: draft.publicListed,
        },
        draft.role
      )
    );
    // Il ruolo resta: di solito si aggiungono più persone con lo stesso.
    setDraft({ ...BOZZA_VUOTA, role: draft.role });
  };

  const onAddMany = (picks: RubricaPickedPerson[]) => {
    const existing = new Set(giaPresenti);
    let next: Pick<StepPeopleValue, 'moderators' | 'speakers'> = { moderators, speakers };
    let aggiunte = 0;
    for (const p of picks) {
      const email = (p.email ?? '').trim().toLowerCase();
      if (!email || !isEmail(email) || existing.has(email)) continue;
      existing.add(email);
      aggiunte += 1;
      next = conRuolo(
        next.moderators,
        next.speakers,
        {
          name: p.displayName || email,
          email,
          personId: p.id,
          organization: p.organization?.trim() || null,
          organizationLogoUrl: null,
          publicListed: false,
        },
        draft.role
      );
    }
    // Chi era già presente (o senza un indirizzo valido) non si aggiunge, e
    // va detto: altrimenti sembra aggiunto.
    setErr(aggiunte < picks.length ? t('pickSkipped') : null);
    if (aggiunte > 0) onChange(next);
  };

  const opzioniRuolo = (
    <>
      <option value="organizer">{t('roleOrganizer')}</option>
      <option value="moderator">{t('roleModerator')}</option>
      <option value="speaker">{t('roleSpeaker')}</option>
    </>
  );

  return (
    <Gruppo title={t('peopleHeading')} help={t('peopleHelp')} count={tutte.length}>
      {tutte.length > 0 && (
        <ul className="list-group mb-3 wizard-people">
          {tutte.map((r, i) => {
            const rid = `${id}-${i}`;
            return (
              <li
                key={r.entry.grantId ?? `${r.kind}-${r.entry.email}`}
                className="list-group-item wizard-person"
              >
                <div className="d-flex justify-content-between align-items-start gap-2">
                  <div className="text-break">
                    <div className="fw-semibold">{r.entry.name}</div>
                    <small className="text-muted">{r.entry.email}</small>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger flex-shrink-0"
                    onClick={() => onChange(senza(r))}
                    aria-label={t('removeItem', { name: r.entry.name })}
                  >
                    {t('remove')}
                  </button>
                </div>
                <div className="row g-2 mt-1 align-items-end">
                  <div className="col-sm-4">
                    <label className="form-label small mb-1" htmlFor={`${rid}-role`}>
                      {t('personRole')}
                    </label>
                    <select
                      id={`${rid}-role`}
                      className="form-select form-select-sm"
                      value={r.role}
                      onChange={(e) => cambiaRuolo(r, e.target.value as PersonRole)}
                    >
                      {opzioniRuolo}
                    </select>
                  </div>
                  <div className="col-sm-8">
                    <label className="form-label small mb-1" htmlFor={`${rid}-org`}>
                      {t('personOrganization')}
                    </label>
                    <input
                      id={`${rid}-org`}
                      type="text"
                      maxLength={200}
                      className="form-control form-control-sm"
                      value={r.entry.organization ?? ''}
                      onChange={(e) =>
                        aggiorna(r, { organization: e.target.value || null })
                      }
                    />
                  </div>
                  <div className="col-12 d-flex flex-wrap align-items-center gap-3">
                    <div className="form-check mb-0">
                      <input
                        id={`${rid}-public`}
                        type="checkbox"
                        className="form-check-input"
                        checked={!!r.entry.publicListed}
                        onChange={(e) => aggiorna(r, { publicListed: e.target.checked })}
                      />
                      <label className="form-check-label small" htmlFor={`${rid}-public`}>
                        {t('personPublic')}
                      </label>
                    </div>
                    <details className="wizard-person__logo">
                      <summary className="small">
                        {r.entry.organizationLogoUrl
                          ? t('personLogoChange')
                          : t('personLogoAdd')}
                      </summary>
                      <div className="pt-2">
                        <FileOrUrlInput
                          id={`${rid}-logo`}
                          label={t('personLogo')}
                          assetType="image"
                          value={r.entry.organizationLogoUrl}
                          onChange={(v) => aggiorna(r, { organizationLogoUrl: v })}
                        />
                      </div>
                    </details>
                    <LogoEsterno url={r.entry.organizationLogoUrl} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RubricaRow onAddMany={onAddMany} />

      <div className="row g-2 align-items-end">
        <div className="col-md-6">
          <label className="form-label" htmlFor={`${id}-name`}>
            {t('personName')}
          </label>
          <input
            id={`${id}-name`}
            type="text"
            className="form-control"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value, personId: null })}
          />
        </div>
        <div className="col-md-6">
          <label className="form-label" htmlFor={`${id}-email`}>
            {t('personEmail')}
          </label>
          <input
            id={`${id}-email`}
            type="email"
            className="form-control"
            value={draft.email}
            onChange={(e) =>
              setDraft({ ...draft, email: e.target.value, personId: null })
            }
          />
        </div>
        <div className="col-md-4">
          <label className="form-label" htmlFor={`${id}-role`}>
            {t('personRole')}
          </label>
          <select
            id={`${id}-role`}
            className="form-select"
            value={draft.role}
            aria-describedby={`${id}-role-help`}
            onChange={(e) => setDraft({ ...draft, role: e.target.value as PersonRole })}
          >
            {opzioniRuolo}
          </select>
        </div>
        <div className="col-md-8">
          <label className="form-label" htmlFor={`${id}-org`}>
            {t('personOrganization')}
          </label>
          <input
            id={`${id}-org`}
            type="text"
            maxLength={200}
            className="form-control"
            value={draft.organization ?? ''}
            aria-describedby={`${id}-org-help`}
            onChange={(e) => setDraft({ ...draft, organization: e.target.value || null })}
          />
        </div>
        <div className="col-12">
          <small id={`${id}-role-help`} className="d-block text-secondary">
            {t(`roleHelp.${draft.role}`)}
          </small>
          <small id={`${id}-org-help`} className="d-block text-secondary">
            {t('personOrganizationHelp')}
          </small>
        </div>
        <div className="col-12">
          <FileOrUrlInput
            id={`${id}-logo`}
            label={t('personLogo')}
            assetType="image"
            value={draft.organizationLogoUrl}
            onChange={(v) => setDraft({ ...draft, organizationLogoUrl: v })}
          />
          <LogoEsterno url={draft.organizationLogoUrl} />
        </div>
        <div className="col-md-8">
          <div className="form-check">
            <input
              id={`${id}-public`}
              type="checkbox"
              className="form-check-input"
              checked={draft.publicListed}
              onChange={(e) => setDraft({ ...draft, publicListed: e.target.checked })}
            />
            <label className="form-check-label" htmlFor={`${id}-public`}>
              {t('personPublic')}
            </label>
          </div>
        </div>
        <div className="col-md-4">
          <button type="button" className="btn btn-primary w-100" onClick={add}>
            {t('add')}
          </button>
        </div>
        <FieldError message={err} />
      </div>
    </Gruppo>
  );
}

function InvitationsSection({
  value,
  onChange,
  locked,
  publicRegistrationEnabled,
}: {
  value: InvitationEntry[];
  onChange: (next: InvitationEntry[]) => void;
  locked: boolean;
  publicRegistrationEnabled: boolean;
}) {
  const t = useTranslations('admin.wizard.step3');
  const id = 'inv';
  const [draft, setDraft] = useState({
    name: '',
    email: '',
    personId: null as string | null,
  });
  const [err, setErr] = useState<string | null>(null);

  const add = () => {
    const email = draft.email.trim().toLowerCase();
    if (!isEmail(email)) {
      setErr(t('invalidEmail'));
      return;
    }
    if (value.some((v) => v.email.toLowerCase() === email)) {
      setErr(t('duplicateEmail'));
      return;
    }
    setErr(null);
    onChange([
      ...value,
      { name: draft.name.trim() || null, email, role: 'GUEST', personId: draft.personId },
    ]);
    setDraft({ name: '', email: '', personId: null });
  };

  const onAddMany = (picks: RubricaPickedPerson[]) => {
    const existing = new Set(value.map((v) => v.email.toLowerCase()));
    const toAdd: InvitationEntry[] = [];
    for (const p of picks) {
      const email = (p.email ?? '').trim().toLowerCase();
      if (!email || !isEmail(email) || existing.has(email)) continue;
      existing.add(email);
      toAdd.push({
        name: p.displayName?.trim() || null,
        email,
        role: 'GUEST',
        personId: p.id,
      });
    }
    setErr(toAdd.length < picks.length ? t('pickSkipped') : null);
    if (toAdd.length > 0) onChange([...value, ...toAdd]);
  };

  return (
    <Gruppo
      title={t('invitationsHeading')}
      help={t(
        publicRegistrationEnabled ? 'invitationsHelpOpen' : 'invitationsHelpRestricted'
      )}
      count={value.length}
    >
      <AddedList
        items={value}
        keyOf={(inv) => inv.email}
        primary={(inv) => inv.name ?? inv.email}
        secondary={(inv) => (inv.name ? inv.email : null)}
        onRemove={locked ? undefined : (i) => onChange(value.filter((_, j) => j !== i))}
      />
      {locked ? (
        <p className="text-secondary mb-0" style={{ fontSize: '0.85rem' }}>
          {t('invitationsStaffOnly')}
        </p>
      ) : (
        <>
          <RubricaRow onAddMany={onAddMany} />
          <div className="row g-2 align-items-end">
            <div className="col-md-5">
              <label className="form-label" htmlFor={`${id}-name`}>
                {t('invitationName')}
              </label>
              <input
                id={`${id}-name`}
                type="text"
                className="form-control"
                value={draft.name}
                onChange={(e) =>
                  setDraft({ ...draft, name: e.target.value, personId: null })
                }
              />
            </div>
            <div className="col-md-5">
              <label className="form-label" htmlFor={`${id}-email`}>
                {t('invitationEmail')}
              </label>
              <input
                id={`${id}-email`}
                type="email"
                className="form-control"
                value={draft.email}
                onChange={(e) =>
                  setDraft({ ...draft, email: e.target.value, personId: null })
                }
              />
            </div>
            <div className="col-md-2">
              <button type="button" className="btn btn-primary w-100" onClick={add}>
                {t('add')}
              </button>
            </div>
            <FieldError message={err} />
          </div>
        </>
      )}
    </Gruppo>
  );
}
