/**
 * F18 — chi decide se la soppressione rumore avanzata (rnnoise) di Jitsi è
 * accesa, e soprattutto QUANDO quella decisione viene presa.
 *
 * Il worklet rnnoise di `jitsi/web:stable-10741` stock non ricampiona: su un
 * AudioContext ≠ 48 kHz processa a vuoto e ZITTISCE il microfono (in demo un
 * moderatore è rimasto muto). Per questo l'app la forza OFF via IFrame API.
 * L'immagine patchata (`infra/jitsi-web-patched`, contesto forzato a 48 kHz)
 * toglie la causa — ma "l'immagine è patchata" non dimostra che l'audio
 * funzioni: le guardie sul bundle provano che la patch c'è, non che si sente.
 * L'accensione va provata in una call vera, con microfoni veri.
 *
 * Ed è il motivo di questo modulo: la scelta deve poter cambiare SENZA
 * ricostruire l'immagine. Prima il valore era letto dentro un componente
 * client come `process.env.NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE` in notazione
 * puntata, che webpack sostituisce a BUILD time: il flag restava congelato nel
 * bundle e cambiarlo in Helm non aveva alcun effetto. È la stessa trappola già
 * corretta per `NEXT_PUBLIC_APP_URL` in `lib/auth/jwt.ts` (vedi `lib/env.ts`).
 * Ora il valore lo legge un Server Component con `getPublicEnv` e scende come
 * prop fino a `JitsiRoom`, quindi basta cambiare l'env del pod e riavviarlo.
 */

/**
 * @param raw valore RUNTIME di `NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE`
 *            (da `getPublicEnv`, mai da `process.env.NEXT_PUBLIC_*` puntato).
 * @returns `true` = l'app forza rnnoise OFF e la ri-spegne per tutta la call;
 *          `false` = rnnoise attiva (richiede l'immagine jitsi/web patchata).
 */
export function resolveRnnoiseEnforceOff(raw: string | null | undefined): boolean {
  // Il default — variabile assente, vuota o irriconoscibile — resta
  // enforce-OFF di proposito: accendere rnnoise sull'immagine sbagliata
  // ammutolisce i partecipanti, e il danno si scopre a evento iniziato. Per
  // accenderla servono DUE condizioni insieme: il jitsi/web patchato a 48 kHz
  // davvero servito, e `NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE="false"` nell'env del
  // pod; poi si ri-valida il microfono in una call LIVE.
  //
  // Accende solo la stringa esatta `false` (a meno di spazi e maiuscole, che
  // sono quello che capita quotando un valore in un values.yaml). Qualunque
  // altra scrittura — 'off', 'no', '0', un refuso — ricade sul comportamento
  // sicuro invece di essere indovinata: con un doppio negativo nel nome della
  // variabile, indovinare è il modo migliore per accendere rnnoise per sbaglio.
  return raw?.trim().toLowerCase() !== 'false';
}
