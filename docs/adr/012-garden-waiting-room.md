# ADR-012 — Waiting room "Giardino": lobby sociale stile Pokemon

**Stato**: Proposto (2026-04-24)
**Decisori**: team pa-webinar / DTD
**Contesto abilitante**: feedback informale post-caffettino 24 aprile — "la sala d'attesa potrebbe essere più divertente"

## Contesto

La waiting room attuale (implementata con il refactor del 23 aprile, vedi `app/src/components/live/waiting-room.tsx`) è **funzionale ma statica**: l'utente arriva, vede un countdown, configura nome/email, testa device, legge le netiquette e aspetta. Se arriva 10 minuti prima, aspetta 10 minuti con un video player di musica d'attesa.

Per gli eventi informali (tipo "caffettino" del venerdì mattina, community call DTD) questo contesto è pretesto: le persone **vogliono parlare tra loro prima dell'evento** — è metà del punto del caffettino. Oggi non hanno modo di farlo: possono solo leggere la chat globale (se è abilitata) sapendo che è letta anche dal moderatore.

Il suggerimento degli utenti: trasformare la waiting room in un **ambiente social 2D in stile pixel-game**, con:
- Un avatar personalizzabile (genere + stile)
- Un giardino con piante, chioschi, fontane, monumenti, DJ
- Movimento libero
- Un DJ virtuale che riproduce musica, sostituibile/scegliibile dall'utente
- **Chat di prossimità**: parli con chi ti è vicino (tipo Gather.town)
- Chat di gruppo (max 5) quando ci si raduna attorno a un punto di interesse

Lo scopo: rendere l'arrivo anticipato un'esperienza desiderata, non un'attesa subita. Rompere il ghiaccio prima che la call "seria" parta.

## Opzioni valutate

### Opzione A — Integrare [WorkAdventure](https://workadventu.re/) (open-source)

WorkAdventure è un progetto OSS francese (Licenza AGPL-3.0 / parti Apache-2.0) che implementa esattamente questo pattern: mappe tiled, avatar RPG Maker, chat di prossimità, audio spaziale opzionale. Self-hostabile. Si integra via iframe.

**Pro**
- Zero tempo di sviluppo base game
- Mature: usato da community reali (Hacktoberfest, eventi Mozilla)
- Mappa editabile con Tiled (OSS tool ben noto)
- Supporto audio/video Jitsi integrato (sarebbe perfetto)

**Contro**
- AGPL-3.0 sul core: **incompatibile con EUPL-1.2 se linkata come parte del nostro deployable**. In iframe separato con URL a dominio dedicato è invece legalmente OK (non è una "combined work")
- Adds un secondo servizio da deployare + manutenere (stack: Node + TypeScript + Phaser)
- GDPR: WorkAdventure salva stato utente (posizione, avatar) — altra PII da mappare
- Estetica: default sprites anni-90 stile RPG Maker, non .italia — richiede custom tilemap

### Opzione B — Implementazione custom in-house sopra [Phaser 3](https://phaser.io/)

Costruire il nostro mini-game usando Phaser 3 (MIT licensed) come engine, Socket.IO / WebSocket per il multiplayer, tileset custom in stile "giardino italiano".

**Pro**
- Controllo totale su estetica, feature, GDPR
- Un solo deployable (componente client + server di presenza sulla stessa app)
- Licenza MIT compatibile EUPL
- Possibilità di temi per-evento (giardino estivo, biblioteca per evento accademico, piazza per assemblea pubblica)

**Contro**
- **Grosso**: ~4-8 settimane di dev per un MVP decente
  - Design tilemap (pixel art custom, artista grafico)
  - Game loop + input (tastiera, touch)
  - Net code (sincronizzazione posizioni 10-20 Hz, interpolazione lag)
  - Proximity chat (raycasting, gruppi ≤5, WebRTC mesh o SFU riutilizzato)
  - Persistenza stato (avatar scelto, ultima posizione)
  - Accessibilità (vedi sotto)
- Nuova superficie d'attacco (WebSocket non autenticato? rate-limit posizioni?)
- Operational burden: altra connection-pool, altro monitoring

### Opzione C — Lobby minimale "senza game" con prossimità

Middle ground: non un game 2D con movimento, ma una **vista a piantina statica** con "tavoli" nominati (es. "Tavolo caffè", "Angolo relax"). L'utente clicca su un tavolo, entra in quel mini-gruppo; chat e audio sono limitati ai membri del tavolo. Max 5 per tavolo. Nessun avatar mobile, nessuna pixel art.

**Pro**
- Cattura il 70% del beneficio UX (raggruppamento + chat di prossimità) con il 20% del lavoro
- Accessibilità semplice: è solo liste + bottoni, funziona con screen reader / keyboard nav
- Niente engine game, niente net code continuo (solo subscribe/unsubscribe a gruppi)
- Riutilizza infrastruttura SSE / WebSocket già esistente per chat

**Contro**
- Meno "wow effect"
- Non è quello che l'utente ha chiesto

### Opzione D — Mantenere lo status quo

Attendiamo più feedback prima di investire: la waiting room attuale (con device check, netiquette, chat preview) è ragionevole per la maggior parte degli eventi.

## Analisi accessibilità (criticità per PA)

Un progetto della PA italiana deve rispettare [WCAG 2.1 livello AA](https://www.agid.gov.it/it/design-servizi/accessibilita) e la [L. 4/2004 "Stanca"](https://www.agid.gov.it/sites/default/files/repository_files/circolari/legge_9_gennaio_2004.pdf). Un giardino 2D con movimento è difficile da rendere accessibile:

| Esigenza utente | Rischio |
|---|---|
| Screen reader | Canvas game è opaco — nessun testo strutturato |
| Solo tastiera | Richiede mappatura completa (frecce + azione), ben documentata |
| Disabilità motorie | Movimento real-time può essere faticoso vs UI a bottoni |
| Daltonismo | Sprites + pixel art devono rispettare contrast ratio 4.5:1 |
| Epilessia fotosensibile | Niente flash >3/s, nessuna animazione aggressiva |

**Mitigazione obbligatoria**: ogni evento che attiva la modalità Giardino deve avere **un fallback completo** alla waiting room tradizionale (bottone "Vista classica" sempre presente). Questo raddoppia il lavoro di test ma è non-negoziabile per una PA.

## Impatto GDPR

- **Avatar persistente**: se lo stile scelto è salvato cross-evento, serve nuovo consenso (analogo a `Person.optedInToAddressBook` — vedi ADR-011)
- **Posizione**: dato transitorio, non salvato → OK se trattiamo come telemetria di sessione (non logghiamo)
- **Chat di prossimità**: messaggi non salvati DB (al pari di chat Jitsi) — OK. Se invece si decidesse di loggarli per moderazione, serve consenso e retention policy
- **Audio/video spaziale** (se implementato): stessa trattazione della call Jitsi principale, JWT scope separato

## Roadmap proposta (se decidiamo di procedere con Opzione B)

**Fase 0 — Design e validazione (ADR approvato)**
- Mockup stile .italia (figma)
- Test con 5-10 utenti DTD (anche solo su mockup cliccabili)
- Decisione palette colori + stile (pixel art vs illustrazione flat)

**Fase 1 — MVP stanza singola (2-3 settimane)**
- Una mappa fissa (giardino base)
- Avatar customization: 4 preset, no upload
- Movimento con frecce/WASD + touch joystick mobile
- Proximity text chat (raggio in tile)
- Fallback "Vista classica" sempre raggiungibile
- Server di presenza: Redis pub/sub (già in stack) + WebSocket via `/api/ws/garden`

**Fase 2 — Interazioni (2-3 settimane)**
- Punti d'interesse cliccabili: DJ stand (cambia musica waiting-room), fontana (animazione+chat), chiosco (micro-game opzionale)
- Gruppi ≤5 con spazio "privato" (zona cerchiata)
- Reazioni emoji sopra l'avatar
- Sound effects leggeri

**Fase 3 — (molto più in là) Audio/video spaziale**
- Riuso JVB Jitsi per SFU
- Audio che si affievolisce con la distanza
- Solo se feedback Fase 1-2 giustifica l'investimento

## La mia opinione (Claude)

**Valuto il concetto come:**
- **Culturalmente giusto** per i caffettini DTD / community PA: la socializzazione informale è reale valore
- **Tecnicamente fattibile** ma **grosso** — non è un pomeriggio, è 5-10 settimane di lavoro per fare qualcosa di decente
- **Rischioso sul piano accessibilità** per una piattaforma PA — va progettato con il fallback classico fin dal primo prototipo, non aggiunto dopo

**Come procederei se il team DTD valida:**
1. **Non implementazione autonoma questa sera** — è fuori scope per quello che posso fare da solo senza feedback di design
2. Proporrei di partire dall'**Opzione C (lobby con tavoli)** come primo passo, 1-2 settimane di lavoro: consegna il 70% del valore UX (proximity chat di gruppo) e si può validare se la community la usa
3. Se l'uso è reale, passare all'**Opzione B Fase 1** per l'esperienza completa — con budget dedicato e possibilmente un'artista per le tilemap
4. L'**Opzione A (WorkAdventure)** è tentante ma la complicazione AGPL + PII + branding non-italia probabilmente non vale la candela per la PA

**Raccomandazione**: approva l'ADR come "Proposto", decidi se vuoi partire dall'**Opzione C "lobby con tavoli"** come prima iterazione (che posso implementare in autonomia in 2-3 sessioni di lavoro concentrate), rimandando il Giardino pixel-art a Fase 2 con più validazione.

Se invece vuoi davvero il Giardino pixel-art ora, dimmelo esplicitamente e pianifichiamo insieme: in quel caso ci vogliono sessioni dedicate a Phaser setup, tilemap design, protocollo WebSocket, test accessibilità.

## Conseguenze

**Se approvato (qualsiasi opzione)**:
- Nuovo componente `waiting-room-garden.tsx` o equivalente, toggle per-evento su `SiteSetting` e/o `Event.waitingRoomStyle`
- Se Opzione B: nuove dipendenze (Phaser, Socket.IO lato server), nuovo endpoint WebSocket, nuovo Prisma model per avatar persistente
- Se Opzione C: nessuna dep nuova, estensione del chat model con un `zoneId` opzionale

**Se rimandato**: ADR resta come documento storico della proposta; l'utente finale si arrangia con la waiting room attuale.

## Link di riferimento

- [WorkAdventure (GitHub)](https://github.com/thecodingmachine/workadventure) — Opzione A
- [Phaser 3 docs](https://phaser.io/phaser3) — Opzione B
- [Gather.town](https://www.gather.town/) — riferimento UX commerciale
- [ADR-011](./011-person-rubrica.md) — pattern per avatar persistente se/quando servirà
