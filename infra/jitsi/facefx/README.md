# paFaceFx — PoC miglioramento volti (fase 1, zero ML / zero licenze)

Auto-esposizione (levels da istogramma luma), gamma adattiva, white balance
gray-world e vibrance leggera applicati alla webcam **prima** che Jitsi la
veda, in un singolo pass WebGL2 via Insertable Streams
(`MediaStreamTrackProcessor → shader → MediaStreamTrackGenerator`).

È la "fase 1" del piano filtri: recupera la gran parte del beneficio percepito
dei "low-light mode" commerciali sui volti sottoesposti. La "fase 2"
(skin smoothing mascherato: bilateral separato half-res + maschera pelle,
eventualmente maschera face-skin via MediaPipe `selfie_multiclass`) si innesta
sulla stessa pipeline.

## Come si deploya

`facefx.js` è la fonte di verità. La copia viene incollata dentro
`_custom_config_js` del subchart web nei values Helm (stesso meccanismo già
usato per STUN/TURN): il container docker jitsi-meet appende il custom config
a `config.js`, che esegue **prima** di lib-jitsi-meet — quindi il patch di
`getUserMedia` è in piedi prima che la camera venga richiesta. Niente fork,
niente rebuild: deploy = `helm upgrade`.

## Opt-in (default: spento)

- l'app aggiunge `paFaceFx: true` al `configOverwrite` dell'IFrame API
  (finisce nel fragment dell'URL dell'iframe), **oppure**
- `localStorage.setItem('paFaceFx', '1')` nell'origin Jitsi (prove manuali).

## Sicurezza di funzionamento

- Solo Chromium (feature-detect su Insertable Streams): altrove no-op totale.
- Qualunque errore → passthrough dei frame originali (mai una call rotta).
- `getSettings/getConstraints/getCapabilities/applyConstraints/stop` sono
  delegati alla track sorgente: device switching e mute di Jitsi invariati.
- Non tocca screenshare (`getDisplayMedia`) né audio.

## Validazione

```bash
cd app && node ../infra/jitsi/facefx/run-poc-test.mjs
```

Headless Chrome con harness locale: passthrough da spento, framerate
sostenuto, sorgente scura schiarita >1.8×, stop propagato. Nota nota bene:
senza i flag fake-device attivi Chrome può usare la webcam reale della
macchina (i frame restano locali).

## Limiti noti del PoC

- L'analisi frame (64×36 ogni 12 frame) usa `getImageData` → warning
  "GPU stall due to ReadPixels" in console: innocuo, ottimizzabile spostando
  le statistiche su readback GL asincrono se mai servisse.
- La copia nei values va tenuta in sync a mano con `facefx.js` (PoC).
- Nessuna UI: l'esposizione del toggle agli utenti (per-evento o per-utente)
  è lavoro dell'app (tema "ottimizzazione frontend").
