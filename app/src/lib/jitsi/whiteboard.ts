/**
 * Se l'installazione ha il backend della lavagna di Jitsi (Excalidraw).
 *
 * La lavagna nativa di Jitsi richiede un backend di collaborazione e
 * `config.whiteboard.enabled` lato Jitsi. Finché l'installazione non li ha, il
 * pulsante «Lavagna» della barra del moderatore e il promemoria per esportarla
 * restano nascosti: un pulsante che non fa niente è peggio di nessun pulsante.
 * L'operatore lo dichiara con `NEXT_PUBLIC_WHITEBOARD_ENABLED=true` nell'env
 * del pod.
 *
 * Il valore lo legge il Server Component della sala con `getPublicEnv` e scende
 * come prop: letto dentro un componente client in notazione puntata, webpack lo
 * sostituirebbe a BUILD time e resterebbe congelato nell'immagine, per cui
 * cambiarlo in Helm non avrebbe effetto (stessa trappola di rnnoise, vedi
 * `lib/jitsi/rnnoise.ts` e `lib/env.ts`).
 *
 * @param raw valore RUNTIME di `NEXT_PUBLIC_WHITEBOARD_ENABLED`.
 * @returns `true` solo per `true` (a meno di spazi e maiuscole); variabile
 *          assente, vuota o diversa → lavagna nascosta.
 */
export function resolveWhiteboardInfraReady(raw: string | null | undefined): boolean {
  return raw?.trim().toLowerCase() === 'true';
}
