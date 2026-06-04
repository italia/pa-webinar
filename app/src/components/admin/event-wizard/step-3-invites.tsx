'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import RubricaPicker, {
  type RubricaPickedPerson,
} from '@/components/admin/rubrica-picker';

export interface OrganizerEntry {
  name: string;
  organization: string;
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
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function Step3Invites({ value, onChange }: Props) {
  const t = useTranslations('admin.wizard.step3');

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

      <ModeratorsSection
        value={value.moderators}
        onChange={(next) => onChange({ moderators: next })}
      />

      <SpeakersSection
        value={value.speakers}
        onChange={(next) => onChange({ speakers: next })}
      />

      <InvitationsSection
        value={value.invitations}
        onChange={(next) => onChange({ invitations: next })}
      />
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
  const [draft, setDraft] = useState<OrganizerEntry>({
    name: '',
    organization: '',
    logoUrl: null,
    websiteUrl: null,
  });
  const [err, setErr] = useState<string | null>(null);

  const add = () => {
    if (!draft.name.trim() || !draft.organization.trim()) {
      setErr(t('organizerRequired'));
      return;
    }
    setErr(null);
    onChange([
      ...value,
      {
        name: draft.name.trim(),
        organization: draft.organization.trim(),
        logoUrl: draft.logoUrl?.trim() || null,
        websiteUrl: draft.websiteUrl?.trim() || null,
      },
    ]);
    setDraft({ name: '', organization: '', logoUrl: null, websiteUrl: null });
  };

  const onPick = (p: RubricaPickedPerson) => {
    setDraft((d) => ({
      ...d,
      name: p.displayName || d.name,
      organization: p.organization ?? d.organization,
    }));
  };

  return (
    <section className="mb-4">
      <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
        {t('organizersHeading')}
      </h3>
      <p className="text-secondary mb-2" style={{ fontSize: '0.85rem' }}>
        {t('organizersHelp')}
      </p>

      {value.length > 0 && (
        <ul className="list-group mb-3">
          {value.map((o, i) => (
            <li
              key={`${o.name}-${i}`}
              className="list-group-item d-flex justify-content-between align-items-center"
            >
              <div>
                <div className="fw-semibold">{o.name}</div>
                <small className="text-muted">{o.organization}</small>
                {o.websiteUrl && (
                  <div>
                    <small className="text-muted">{o.websiteUrl}</small>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                {t('remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-2">
        <RubricaPicker onSelect={onPick} placeholder={t('rubricaPick')} />
        <small className="text-muted">{t('rubricaOrAdd')}</small>
      </div>

      <div className="row g-2 align-items-end">
        <div className="col-md-4">
          <label className="form-label" htmlFor="org-name">
            {t('organizerName')}
          </label>
          <input
            id="org-name"
            type="text"
            className="form-control"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
          />
        </div>
        <div className="col-md-3">
          <label className="form-label" htmlFor="org-org">
            {t('organizerOrganization')}
          </label>
          <input
            id="org-org"
            type="text"
            className="form-control"
            value={draft.organization}
            onChange={(e) =>
              setDraft({ ...draft, organization: e.target.value })
            }
            required
          />
        </div>
        <div className="col-md-3">
          <label className="form-label" htmlFor="org-web">
            {t('organizerWebsite')}
          </label>
          <input
            id="org-web"
            type="url"
            className="form-control"
            value={draft.websiteUrl ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, websiteUrl: e.target.value || null })
            }
          />
        </div>
        <div className="col-md-2">
          <button
            type="button"
            className="btn btn-primary w-100"
            onClick={add}
            disabled={!draft.name.trim() || !draft.organization.trim()}
          >
            {t('add')}
          </button>
        </div>
        {err && (
          <div className="col-12">
            <small className="text-danger">{err}</small>
          </div>
        )}
      </div>
    </section>
  );
}

function ModeratorsSection({
  value,
  onChange,
}: {
  value: ModeratorEntry[];
  onChange: (next: ModeratorEntry[]) => void;
}) {
  const t = useTranslations('admin.wizard.step3');
  const [draft, setDraft] = useState<ModeratorEntry>({
    name: '',
    email: '',
    personId: null,
  });
  const [err, setErr] = useState<string | null>(null);

  const add = () => {
    if (!draft.name.trim() || !draft.email.trim()) {
      setErr(t('moderatorRequired'));
      return;
    }
    if (!isEmail(draft.email.trim())) {
      setErr(t('invalidEmail'));
      return;
    }
    setErr(null);
    onChange([
      ...value,
      {
        name: draft.name.trim(),
        email: draft.email.trim().toLowerCase(),
        personId: draft.personId,
      },
    ]);
    setDraft({ name: '', email: '', personId: null });
  };

  const onAddMany = (picks: RubricaPickedPerson[]) => {
    const existing = new Set(value.map((m) => m.email));
    const toAdd: ModeratorEntry[] = [];
    for (const p of picks) {
      const email = (p.email ?? '').trim().toLowerCase();
      if (!email || !isEmail(email)) continue;
      if (existing.has(email)) continue;
      existing.add(email);
      toAdd.push({
        name: p.displayName || email,
        email,
        personId: p.id,
      });
    }
    if (toAdd.length > 0) onChange([...value, ...toAdd]);
  };

  return (
    <section className="mb-4">
      <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
        {t('moderatorsHeading')}
      </h3>
      <p className="text-secondary mb-2" style={{ fontSize: '0.85rem' }}>
        {t('moderatorsHelp')}
      </p>

      {value.length > 0 && (
        <ul className="list-group mb-3">
          {value.map((m, i) => (
            <li
              key={`${m.email}-${i}`}
              className="list-group-item d-flex justify-content-between align-items-center"
            >
              <div>
                <div className="fw-semibold">{m.name}</div>
                <small className="text-muted">{m.email}</small>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                {t('remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-2">
        <RubricaPicker
          mode="multi"
          onAddMany={onAddMany}
          placeholder={t('rubricaPick')}
        />
        <small className="text-muted">{t('rubricaOrAdd')}</small>
      </div>

      <div className="row g-2 align-items-end">
        <div className="col-md-5">
          <label className="form-label" htmlFor="mod-name">
            {t('moderatorName')}
          </label>
          <input
            id="mod-name"
            type="text"
            className="form-control"
            value={draft.name}
            onChange={(e) =>
              setDraft({ ...draft, name: e.target.value, personId: null })
            }
          />
        </div>
        <div className="col-md-5">
          <label className="form-label" htmlFor="mod-email">
            {t('moderatorEmail')}
          </label>
          <input
            id="mod-email"
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
        {err && (
          <div className="col-12">
            <small className="text-danger">{err}</small>
          </div>
        )}
      </div>
    </section>
  );
}

function SpeakersSection({
  value,
  onChange,
}: {
  value: SpeakerEntry[];
  onChange: (next: SpeakerEntry[]) => void;
}) {
  const t = useTranslations('admin.wizard.step3');
  const [draft, setDraft] = useState<SpeakerEntry>({
    name: '',
    email: '',
    personId: null,
  });
  const [err, setErr] = useState<string | null>(null);

  const add = () => {
    if (!draft.name.trim() || !draft.email.trim()) {
      setErr(t('speakerRequired'));
      return;
    }
    if (!isEmail(draft.email.trim())) {
      setErr(t('invalidEmail'));
      return;
    }
    setErr(null);
    onChange([
      ...value,
      {
        name: draft.name.trim(),
        email: draft.email.trim().toLowerCase(),
        personId: draft.personId,
      },
    ]);
    setDraft({ name: '', email: '', personId: null });
  };

  const onAddMany = (picks: RubricaPickedPerson[]) => {
    const existing = new Set(value.map((s) => s.email));
    const toAdd: SpeakerEntry[] = [];
    for (const p of picks) {
      const email = (p.email ?? '').trim().toLowerCase();
      if (!email || !isEmail(email)) continue;
      if (existing.has(email)) continue;
      existing.add(email);
      toAdd.push({
        name: p.displayName || email,
        email,
        personId: p.id,
      });
    }
    if (toAdd.length > 0) onChange([...value, ...toAdd]);
  };

  return (
    <section className="mb-4">
      <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
        {t('speakersHeading')}
      </h3>
      <p className="text-secondary mb-2" style={{ fontSize: '0.85rem' }}>
        {t('speakersHelp')}
      </p>

      {value.length > 0 && (
        <ul className="list-group mb-3">
          {value.map((s, i) => (
            <li
              key={`${s.email}-${i}`}
              className="list-group-item d-flex justify-content-between align-items-center"
            >
              <div>
                <div className="fw-semibold">{s.name}</div>
                <small className="text-muted">{s.email}</small>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                {t('remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-2">
        <RubricaPicker
          mode="multi"
          onAddMany={onAddMany}
          placeholder={t('rubricaPick')}
        />
        <small className="text-muted">{t('rubricaOrAdd')}</small>
      </div>

      <div className="row g-2 align-items-end">
        <div className="col-md-5">
          <label className="form-label" htmlFor="sp-name">
            {t('speakerName')}
          </label>
          <input
            id="sp-name"
            type="text"
            className="form-control"
            value={draft.name}
            onChange={(e) =>
              setDraft({ ...draft, name: e.target.value, personId: null })
            }
          />
        </div>
        <div className="col-md-5">
          <label className="form-label" htmlFor="sp-email">
            {t('speakerEmail')}
          </label>
          <input
            id="sp-email"
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
        {err && (
          <div className="col-12">
            <small className="text-danger">{err}</small>
          </div>
        )}
      </div>
    </section>
  );
}

function InvitationsSection({
  value,
  onChange,
}: {
  value: InvitationEntry[];
  onChange: (next: InvitationEntry[]) => void;
}) {
  const t = useTranslations('admin.wizard.step3');
  const [draft, setDraft] = useState<InvitationEntry>({
    name: '',
    email: '',
    role: 'GUEST',
    personId: null,
  });
  const [err, setErr] = useState<string | null>(null);

  const add = () => {
    if (!isEmail((draft.email ?? '').trim())) {
      setErr(t('invalidEmail'));
      return;
    }
    const email = draft.email.trim().toLowerCase();
    if (value.some((v) => v.email === email)) {
      setErr(t('duplicateEmail'));
      return;
    }
    setErr(null);
    onChange([
      ...value,
      {
        name: draft.name?.trim() || null,
        email,
        role: draft.role,
        personId: draft.personId,
      },
    ]);
    setDraft({ name: '', email: '', role: 'GUEST', personId: null });
  };

  const onAddMany = (picks: RubricaPickedPerson[]) => {
    const existing = new Set(value.map((v) => v.email));
    const toAdd: InvitationEntry[] = [];
    for (const p of picks) {
      const email = (p.email ?? '').trim().toLowerCase();
      if (!email || !isEmail(email)) continue;
      if (existing.has(email)) continue;
      existing.add(email);
      toAdd.push({
        name: p.displayName?.trim() || null,
        email,
        role: draft.role,
        personId: p.id,
      });
    }
    if (toAdd.length > 0) onChange([...value, ...toAdd]);
  };

  return (
    <section className="mb-3">
      <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
        {t('invitationsHeading')}
      </h3>
      <p className="text-secondary mb-2" style={{ fontSize: '0.85rem' }}>
        {t('invitationsHelp')}
      </p>

      {value.length > 0 && (
        <ul className="list-group mb-3">
          {value.map((inv, i) => (
            <li
              key={`${inv.email}-${i}`}
              className="list-group-item d-flex justify-content-between align-items-center"
            >
              <div>
                <div className="fw-semibold">
                  {inv.name ?? inv.email}
                  <span
                    className="badge ms-2"
                    style={{
                      backgroundColor: inv.role === 'SPEAKER' ? '#0066CC' : '#6c757d',
                      fontSize: '0.7rem',
                    }}
                  >
                    {t(`role.${inv.role}`)}
                  </span>
                </div>
                {inv.name && <small className="text-muted">{inv.email}</small>}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                {t('remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-2">
        <RubricaPicker
          mode="multi"
          onAddMany={onAddMany}
          placeholder={t('rubricaPick')}
        />
        <small className="text-muted">{t('rubricaOrAdd')}</small>
      </div>

      <div className="row g-2 align-items-end">
        <div className="col-md-4">
          <label className="form-label" htmlFor="inv-name">
            {t('invitationName')}
          </label>
          <input
            id="inv-name"
            type="text"
            className="form-control"
            value={draft.name ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, name: e.target.value, personId: null })
            }
          />
        </div>
        <div className="col-md-4">
          <label className="form-label" htmlFor="inv-email">
            {t('invitationEmail')}
          </label>
          <input
            id="inv-email"
            type="email"
            className="form-control"
            value={draft.email}
            onChange={(e) =>
              setDraft({ ...draft, email: e.target.value, personId: null })
            }
            required
          />
        </div>
        <div className="col-md-2">
          <label className="form-label" htmlFor="inv-role">
            {t('invitationRole')}
          </label>
          <select
            id="inv-role"
            className="form-select"
            value={draft.role}
            onChange={(e) =>
              setDraft({ ...draft, role: e.target.value as 'GUEST' | 'SPEAKER' })
            }
          >
            <option value="GUEST">{t('role.GUEST')}</option>
            <option value="SPEAKER">{t('role.SPEAKER')}</option>
          </select>
        </div>
        <div className="col-md-2">
          <button type="button" className="btn btn-primary w-100" onClick={add}>
            {t('add')}
          </button>
        </div>
        {err && (
          <div className="col-12">
            <small className="text-danger">{err}</small>
          </div>
        )}
      </div>
    </section>
  );
}
