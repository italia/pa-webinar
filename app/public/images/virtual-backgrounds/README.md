# Sfondi virtuali

Immagini proposte nella sala d'attesa e applicate all'ingresso in conferenza
(vedi `app/src/lib/jitsi/virtual-background.ts`).

Sono sfumature astratte generate a mano per questo repository: nessuna
fotografia, nessun marchio, nessun contenuto di terzi. Seguono quindi la
licenza del repository e non portano vincoli propri di attribuzione.

Perche' astratte e non fotografie: una fotografia dietro il volto di chi parla
sposta l'attenzione, invecchia, e in un prodotto in riuso costringerebbe ogni
ente a verificare la licenza di un'immagine che non ha scelto. Le sfumature
non hanno nessuno di questi problemi e restano leggibili dietro una persona.

Formato: JPEG 1280x720, che e' la proporzione della traccia video.

Per aggiungerne uno: mettere il file qui e aggiungere la voce in
`SFONDI_VIRTUALI`, con la traduzione del nome in `deviceCheck.background` per
tutte le lingue. Un identificativo tolto dall'elenco torna automaticamente a
«nessuno» per chi lo aveva scelto.
