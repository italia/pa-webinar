'use client';

/**
 * La videochiamata al volo: un nome, e si entra subito come moderatori. Il
 * link per gli ospiti si copia dalla sala o dall'elenco delle chiamate rapide.
 */

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { useRouter, percorso } from '@/i18n/navigation';
import { messaggioErroreApi } from '@/lib/api-error-message';

export default function CreateInstantCall() {
  const t = useTranslations('admin.instantCall');
  const tc = useTranslations('common');
  const tApi = useTranslations('apiErrors');
  const router = useRouter();
  const id = useId();

  const [title, setTitle] = useState('');
  const [moderatorName, setModeratorName] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [maxParticipants, setMaxParticipants] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!title.trim() || loading) return;
    if (joinPassword && joinPassword.length < 4) {
      setError(t('passwordTooShort'));
      return;
    }
    const maxParticipantsNum = maxParticipants.trim() ? parseInt(maxParticipants, 10) : undefined;
    if (
      maxParticipantsNum !== undefined &&
      (Number.isNaN(maxParticipantsNum) || maxParticipantsNum < 2 || maxParticipantsNum > 500)
    ) {
      setError(t('maxParticipantsInvalid'));
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/events/instant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: { it: title.trim() },
          moderatorName: moderatorName.trim() || undefined,
          joinPassword: joinPassword.trim() || undefined,
          maxParticipants: maxParticipantsNum,
        }),
      });

      if (!res.ok) {
        setError(messaggioErroreApi(res.status, tApi, tc('error')));
        setLoading(false);
        return;
      }

      const data = (await res.json()) as { slug: string; moderatorToken: string };
      router.push(percorso(`/events/${data.slug}/live?token=${data.moderatorToken}`));
    } catch {
      setError(tc('error'));
      setLoading(false);
    }
  };

  return (
    <form
      className="chiamata-nuova"
      aria-labelledby={`${id}-titolo`}
      onSubmit={(e) => {
        e.preventDefault();
        void handleCreate();
      }}
    >
      <div className="chiamata-nuova__testa">
        <span className="chiamata-nuova__icona" aria-hidden="true">
          <Icon icon="it-video" size="sm" />
        </span>
        <div>
          <h2 id={`${id}-titolo`} className="chiamata-nuova__titolo">
            {t('title')}
          </h2>
          <p className="chiamata-nuova__sottotitolo">{t('subtitle')}</p>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <div className="mb-3">
        <label htmlFor={`${id}-nome`} className="form-label">
          {t('nameLabel')}
        </label>
        <input
          id={`${id}-nome`}
          type="text"
          className="form-control"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('namePlaceholder')}
          disabled={loading}
          maxLength={200}
          required
        />
      </div>

      <div className="mb-3">
        <label htmlFor={`${id}-moderatore`} className="form-label">
          {t('moderatorLabel')}
        </label>
        <input
          id={`${id}-moderatore`}
          type="text"
          className="form-control"
          value={moderatorName}
          onChange={(e) => setModeratorName(e.target.value)}
          placeholder={t('moderatorPlaceholder')}
          disabled={loading}
          maxLength={100}
        />
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label htmlFor={`${id}-password`} className="form-label">
            {t('passwordLabel')}
          </label>
          <input
            id={`${id}-password`}
            type="password"
            className="form-control"
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
            placeholder={t('passwordPlaceholder')}
            disabled={loading}
            maxLength={200}
            autoComplete="new-password"
            aria-describedby={`${id}-password-aiuto`}
          />
          <p id={`${id}-password-aiuto`} className="form-text">
            {t('passwordHint')}
          </p>
        </div>
        <div className="col-12 col-md-6">
          <label htmlFor={`${id}-partecipanti`} className="form-label">
            {t('maxParticipantsLabel')}
          </label>
          <input
            id={`${id}-partecipanti`}
            type="number"
            className="form-control"
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(e.target.value)}
            placeholder={t('maxParticipantsPlaceholder')}
            disabled={loading}
            min={2}
            max={500}
            aria-describedby={`${id}-partecipanti-aiuto`}
          />
          <p id={`${id}-partecipanti-aiuto`} className="form-text">
            {t('maxParticipantsHint')}
          </p>
        </div>
      </div>

      <button
        type="submit"
        className="btn btn-primary d-inline-flex align-items-center gap-2"
        disabled={loading || !title.trim()}
      >
        <Icon icon="it-video" size="xs" color="white" />
        {loading ? t('creating') : t('create')}
      </button>

      <p className="chiamata-nuova__nota">{t('hint')}</p>
    </form>
  );
}
