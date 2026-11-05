'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { useConfirm, type ConfirmOptions } from '@/components/ui/confirm-dialog';
import { CODICE_CONFERMA_VOCI } from '@/lib/ai/voice-consent-code';
import { codiceErrore } from '@/lib/api-error-message';

export interface OpzioniAvvio {
  /** La conferma dell'azione (che cosa fa), se l'azione ne ha una. */
  conferma?: ConfirmOptions;
  /**
   * Si sa gia' che servira' la conferma sulle voci (la pagina l'ha calcolata):
   * una sola domanda, con il testo dell'azione e quello sulle voci, e la
   * conferma parte con la prima richiesta.
   */
  confermaVociNota?: boolean;
}

/**
 * Avvia la pipeline AI (generate-ai, rerun) chiedendo, quando serve, la
 * conferma che tutte le voci del video completo hanno acconsentito alla
 * trascrizione. Una domanda sola: quella dell'azione, oppure quella che le
 * unisce quando la conferma sulle voci e' gia' nota; se il server la chiede
 * comunque (409), si chiede solo quella. Restituisce la risposta finale, o
 * null se chi amministra non conferma.
 */
export function useAvvioPipeline() {
  const confirm = useConfirm();
  const t = useTranslations('admin.voiceConsent');

  return useCallback(
    async (
      url: string,
      body: Record<string, unknown> = {},
      opzioni: OpzioniAvvio = {}
    ): Promise<Response | null> => {
      const invia = (extra: Record<string, unknown>) =>
        fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, ...extra }),
        });
      const domandaVoci = (prima?: string): ConfirmOptions => ({
        title: t('title'),
        message: prima ? `${prima} ${t('message')}` : t('message'),
        confirmLabel: t('confirm'),
        cancelLabel: t('cancel'),
      });

      if (opzioni.confermaVociNota) {
        if (!(await confirm(domandaVoci(opzioni.conferma?.message)))) return null;
        return invia({ allVoicesConsented: true });
      }
      if (opzioni.conferma && !(await confirm(opzioni.conferma))) return null;
      const prima = await invia({});
      if (
        prima.status !== 409 ||
        (await codiceErrore(prima.clone())) !== CODICE_CONFERMA_VOCI
      ) {
        return prima;
      }
      if (!(await confirm(domandaVoci()))) return null;
      return invia({ allVoicesConsented: true });
    },
    [confirm, t]
  );
}
