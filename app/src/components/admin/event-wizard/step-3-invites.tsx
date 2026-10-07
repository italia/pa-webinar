'use client';

import { useContext, useState } from 'react';
import { useTranslations } from 'next-intl';

import RubricaPicker, {
  RubricaAccessContext,
  type RubricaPickedPerson,
} from '@/components/admin/rubrica-picker';
import FileOrUrlInput from '@/components/ui/file-or-url-input';

/** Un ente che organizza l'evento: compare nella pagina pubblica. */
export interface OrganizerEntry {
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
}

export interface ModeratorEntry {
  name: string;
  email: string;
  personId: string | null;
}

export interface SpeakerEntry {
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

export interface Step3Value {
  organizers: OrganizerEntry[];
  moderators: ModeratorEntry[];
  speakers: SpeakerEntry[];
  invitations: InvitationEntry[];
}

interface Props {
  value: Step3Value;
  onChange: (patch: Partial<Step3Value>) => void;
  /** Con il solo link del moderatore gli inviti si vedono ma non si
   *  modificano: li gestisce lo staff. */
  invitationsLocked?: boolean;
  /** Il moderatore principale (passo Riepilogo): non si aggiunge anche qui. */
  primaryModeratorEmail?: string | null;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function Step3Invites({
  value,
  onChange,
  invitationsLocked = false,
  primaryModeratorEmail = null,
}: Props) {
  const t = useTranslations('admin.wizard.step3');
  const principale = primaryModeratorEmail?.trim() ? [primaryModeratorEmail.trim()] : [];

  return (
    <div>
      <h2 className="h4 fw-bold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('heading')}
      </h2>
      <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
        {t('intro')}
      </p>

      <OrganizersSection
        value={value.organizers}
        onChange={(next) => onChange({ organizers: next })}
      />

      <PeopleSection
        kind="moderators"
        value={value.moderators}
        onChange={(next) => onChange({ moderators: next })}
        taken={[...principale, ...value.speakers.map((p) => p.email)]}
      />

      <PeopleSection
        kind="speakers"
        value={value.speakers}
        onChange={(next) => onChange({ speakers: next })}
        taken={[...principale, ...value.moderators.map((p) => p.email)]}
      />

      <InvitationsSection
        value={value.invitations}
        onChange={(next) => onChange({ invitations: next })}
        locked={invitationsLocked}
      />
    </div>
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
          {count > 0 && <span className="badge rounded-pill ms-2 wizard-group__count">{count}</span>}
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
  onRemove,
}: {
  items: T[];
  keyOf: (item: T) => string;
  primary: (item: T) => string;
  secondary: (item: T) => string | null;
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
function RubricaRow({ onAddMany }: { onAddMany: (picks: RubricaPickedPerson[]) => void }) {
  const t = useTranslations('admin.wizard.step3');
  if (!useContext(RubricaAccessContext)) return null;
  return (
    <div className="mb-2">
      <RubricaPicker mode="multi" onAddMany={onAddMany} placeholder={t('rubricaPick')} />
      <small className="text-muted">{t('rubricaOrAdd')}</small>
    </div>
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
    <Gruppo title={t('organizersHeading')} help={t('organizersHelp')} count={value.length}>
      <AddedList
        items={value}
        keyOf={(o) => o.name}
        primary={(o) => o.name}
        secondary={(o) => o.websiteUrl}
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

/** Co-moderatori e relatori: stesso modulo, accesso diverso. */
function PeopleSection({
  kind,
  value,
  onChange,
  taken,
}: {
  kind: 'moderators' | 'speakers';
  value: ModeratorEntry[];
  onChange: (next: ModeratorEntry[]) => void;
  /** Gli indirizzi gia' nell'altro elenco: una persona ha un ruolo solo. */
  taken: readonly string[];
}) {
  const t = useTranslations('admin.wizard.step3');
  // Ogni sezione compare una volta sola nel passo: gli id fissi bastano.
  const id = kind === 'moderators' ? 'mod' : 'sp';
  const [draft, setDraft] = useState<ModeratorEntry>({ name: '', email: '', personId: null });
  const [err, setErr] = useState<string | null>(null);
  // Gli indirizzi gia' usati, senza distinguere maiuscole: quelli caricati da
  // un evento esistente possono averne.
  const giaPresenti = new Set([...value.map((p) => p.email), ...taken].map((e) => e.toLowerCase()));

  const add = () => {
    if (!draft.name.trim() || !draft.email.trim()) {
      setErr(t(kind === 'moderators' ? 'moderatorRequired' : 'speakerRequired'));
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
    onChange([...value, { name: draft.name.trim(), email, personId: draft.personId }]);
    setDraft({ name: '', email: '', personId: null });
  };

  const onAddMany = (picks: RubricaPickedPerson[]) => {
    const existing = new Set(giaPresenti);
    const toAdd: ModeratorEntry[] = [];
    for (const p of picks) {
      const email = (p.email ?? '').trim().toLowerCase();
      if (!email || !isEmail(email) || existing.has(email)) continue;
      existing.add(email);
      toAdd.push({ name: p.displayName || email, email, personId: p.id });
    }
    // Chi era gia' presente (o senza un indirizzo valido) non si aggiunge, e
    // va detto: altrimenti sembra aggiunto.
    setErr(toAdd.length < picks.length ? t('pickSkipped') : null);
    if (toAdd.length > 0) onChange([...value, ...toAdd]);
  };

  return (
    <Gruppo
      title={t(kind === 'moderators' ? 'moderatorsHeading' : 'speakersHeading')}
      help={t(kind === 'moderators' ? 'moderatorsHelp' : 'speakersHelp')}
      count={value.length}
    >
      <AddedList
        items={value}
        keyOf={(p) => p.email}
        primary={(p) => p.name}
        secondary={(p) => p.email}
        onRemove={(i) => onChange(value.filter((_, j) => j !== i))}
      />
      <RubricaRow onAddMany={onAddMany} />

      <div className="row g-2 align-items-end">
        <div className="col-md-5">
          <label className="form-label" htmlFor={`${id}-name`}>
            {t(kind === 'moderators' ? 'moderatorName' : 'speakerName')}
          </label>
          <input
            id={`${id}-name`}
            type="text"
            className="form-control"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value, personId: null })}
          />
        </div>
        <div className="col-md-5">
          <label className="form-label" htmlFor={`${id}-email`}>
            {t(kind === 'moderators' ? 'moderatorEmail' : 'speakerEmail')}
          </label>
          <input
            id={`${id}-email`}
            type="email"
            className="form-control"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value, personId: null })}
          />
        </div>
        <div className="col-md-2">
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
}: {
  value: InvitationEntry[];
  onChange: (next: InvitationEntry[]) => void;
  locked: boolean;
}) {
  const t = useTranslations('admin.wizard.step3');
  const id = 'inv';
  const [draft, setDraft] = useState({ name: '', email: '', personId: null as string | null });
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
      toAdd.push({ name: p.displayName?.trim() || null, email, role: 'GUEST', personId: p.id });
    }
    setErr(toAdd.length < picks.length ? t('pickSkipped') : null);
    if (toAdd.length > 0) onChange([...value, ...toAdd]);
  };

  return (
    <Gruppo title={t('invitationsHeading')} help={t('invitationsHelp')} count={value.length}>
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
                onChange={(e) => setDraft({ ...draft, name: e.target.value, personId: null })}
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
                onChange={(e) => setDraft({ ...draft, email: e.target.value, personId: null })}
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
