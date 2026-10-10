-- mod_pa_captions.lua
--
-- Rende possibili i sottotitoli live nelle sale della conferenza. Jitsi
-- trascrive "dal bridge" solo le stanze che portano nei metadati la chiave
-- `asyncTranscription`: quando la trascrizione viene accesa, Jicofo chiede al
-- bridge di aprire una WebSocket verso il servizio dei sottotitoli
-- (`jicofo.transcription.url-template`) e di mandargli l'audio di chi parla.
--
-- Il modulo scrive due chiavi nei metadati di ogni stanza appena creata:
--   asyncTranscription = true
--       la stanza ammette la trascrizione dal bridge. La decide il server:
--       le versioni recenti di Jitsi rifiutano questa chiave se a scriverla è
--       un client, moderatore compreso, quindi può metterla solo un modulo;
--   transcription.urlParams.room = <nome della stanza>
--       Jicofo aggiunge questi parametri all'indirizzo della WebSocket (da
--       stable-10978): il servizio sa di quale stanza è l'audio e chiede al
--       portale lingua e vocabolario dell'evento. Le versioni precedenti li
--       ignorano, e il servizio usa la sua lingua predefinita.
--
-- Il metadato da solo non trascrive niente: la trascrizione parte quando un
-- moderatore la chiede dalla sala (recording.isTranscribingEnabled) e si
-- ferma quando la spegne.
--
-- Attivo solo con PA_CAPTIONS_ENABLED=true nell'ambiente di Prosody. Il chart
-- e lo stack Docker Compose lo impostano insieme all'indirizzo del servizio in
-- Jicofo: senza il servizio, una stanza che si dichiara trascrivibile
-- lascerebbe senza risposta la richiesta del moderatore.

local jid_node = require 'util.jid'.node;

local util = module:require 'util';
local is_healthcheck_room = util.is_healthcheck_room;

if os.getenv('PA_CAPTIONS_ENABLED') ~= 'true' then
    module:log('info', 'Sottotitoli live spenti: PA_CAPTIONS_ENABLED non è "true"');
    return;
end

local function on_room_created(event)
    local room = event.room;
    if is_healthcheck_room(room.jid) then
        return;
    end
    room.jitsiMetadata = room.jitsiMetadata or {};
    room.jitsiMetadata.asyncTranscription = true;
    local transcription = room.jitsiMetadata.transcription or {};
    local params = transcription.urlParams or {};
    params.room = jid_node(room.jid);
    transcription.urlParams = params;
    room.jitsiMetadata.transcription = transcription;
end

-- Dopo il componente dei metadati (-1), che crea room.jitsiMetadata: qui si
-- aggiungono le chiavi. Jicofo le riceve quando entra nella stanza, subito
-- dopo la creazione.
module:hook('muc-room-created', on_room_created, -2);
