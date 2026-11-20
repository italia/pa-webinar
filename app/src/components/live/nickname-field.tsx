// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  FormGroup,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from 'design-react-kit';

import type { StatoNickname } from '@/hooks/use-nickname';
import { NICKNAME_MAX, normalizzaNickname } from '@/lib/live/nickname-rule';

/**
 * Il campo del nickname (lib/live/nickname), in sala d'attesa e nella finestra
 * della sala: si controlla uscendo dal campo, e un nickname occupato porta con
 * se' un'alternativa da usare con un clic. Facoltativo: vuoto, nessuno.
 */
export function NicknameField({
  id,
  stato,
  anonimo,
  confermaSubito = true,
}: {
  id: string;
  stato: StatoNickname;
  /** Pubblico anonimo: senza nickname si compare con lo pseudonimo. */
  anonimo: boolean;
  /** In sala d'attesa si controlla uscendo dal campo, e l'alternativa vale
   *  subito; nella finestra della sala vale quando si applica. */
  confermaSubito?: boolean;
}) {
  const t = useTranslations('live.nickname');
  const aiuto = `${id}-aiuto`;
  const esito = `${id}-esito`;
  const { valore, scrivi, confermato, daConfermare, conferma, inCorso, errore } = stato;
  return (
    <FormGroup className="mb-0 wr-nickname">
      <Input
        id={id}
        label={t('label')}
        type="text"
        value={valore}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => scrivi(e.target.value)}
        onBlur={() => {
          if (confermaSubito && daConfermare && !inCorso) void conferma();
        }}
        maxLength={NICKNAME_MAX * 2}
        autoComplete="off"
        spellCheck={false}
        className={errore ? 'is-invalid' : undefined}
        aria-invalid={errore ? true : undefined}
        aria-describedby={`${aiuto} ${esito}`}
      />
      <small id={aiuto} className="text-muted d-block" style={{ fontSize: '0.8rem' }}>
        {t('help')} {anonimo ? t('helpAnonymous') : t('helpName')}
      </small>
      <div id={esito} className="small mt-1" role={errore ? 'alert' : 'status'}>
        {inCorso ? (
          t('checking')
        ) : errore ? (
          <span className="text-danger">
            {t(`errors.${errore.motivo}`)}{' '}
            {errore.suggerimento && (
              <button
                type="button"
                className="btn btn-link btn-sm p-0 align-baseline"
                onClick={() =>
                  confermaSubito
                    ? void conferma(errore.suggerimento)
                    : scrivi(errore.suggerimento ?? '')
                }
              >
                {t('useSuggestion', { suggestion: errore.suggerimento })}
              </button>
            )}
          </span>
        ) : !daConfermare && confermato ? (
          t('shownAs', { nickname: confermato })
        ) : null}
      </div>
    </FormGroup>
  );
}

/**
 * La finestra della sala per cambiare o togliere il nickname. Il nome in video
 * viene dal token della conferenza: `onApplica` chiede un ingresso nuovo, e la
 * sala si ricollega per un attimo.
 */
export function NicknameDialog({
  aperta,
  onChiudi,
  stato,
  inUso,
  anonimo,
  onApplica,
  container,
}: {
  aperta: boolean;
  onChiudi: () => void;
  stato: StatoNickname;
  /** Il nickname con cui si e' in sala ora. */
  inUso: string | null;
  anonimo: boolean;
  /** Risolve vero se la sala e' rientrata con il nickname nuovo. */
  onApplica: (nickname: string | null) => Promise<boolean>;
  container?: HTMLElement | null;
}) {
  const t = useTranslations('live.nickname');
  const tc = useTranslations('common');
  const id = useId();
  const [fase, setFase] = useState<'scelta' | 'in-corso' | 'fatto'>('scelta');
  const applica = async (richiesto: string) => {
    setFase('in-corso');
    const confermato = await stato.conferma(richiesto);
    if (confermato === false) {
      setFase('scelta');
      return;
    }
    setFase((await onApplica(confermato)) ? 'fatto' : 'scelta');
  };
  const chiudi = () => {
    setFase('scelta');
    onChiudi();
  };
  return (
    <Modal
      isOpen={aperta}
      toggle={chiudi}
      centered
      container={container ?? undefined}
      labelledBy={`${id}-titolo`}
    >
      <ModalHeader id={`${id}-titolo`} closeAriaLabel={tc('close')} toggle={chiudi}>
        {t('dialogTitle')}
      </ModalHeader>
      <ModalBody>
        <p className="small mb-3">{t('dialogIntro')}</p>
        <NicknameField
          id={`${id}-campo`}
          stato={stato}
          anonimo={anonimo}
          confermaSubito={false}
        />
        <p className="small mb-0 mt-3" role="status">
          {fase === 'in-corso'
            ? t('reconnecting')
            : fase === 'fatto'
              ? inUso
                ? t('done', { nickname: inUso })
                : t('doneRemoved')
              : ''}
        </p>
      </ModalBody>
      <ModalFooter>
        {inUso && (
          <Button
            color="secondary"
            outline
            disabled={fase === 'in-corso'}
            onClick={() => void applica('')}
          >
            {t('remove')}
          </Button>
        )}
        <Button
          color="primary"
          disabled={
            fase === 'in-corso' ||
            !stato.valore.trim() ||
            normalizzaNickname(stato.valore) === inUso
          }
          onClick={() => void applica(stato.valore)}
        >
          {t('apply')}
        </Button>
        <Button color="secondary" outline onClick={chiudi}>
          {tc('close')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
