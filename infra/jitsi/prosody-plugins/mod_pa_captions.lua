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
-- Il metadato da solo non trascrive niente: la trascrizione parte quando la
-- stanza scrive recording.isTranscribingEnabled. Lo scrivono due strade:
--   - la sala di un moderatore, con il comando `setSubtitles` dell'IFrame API
--     (anche quando si cambia l'interruttore durante l'evento);
--   - questo modulo, a ogni ingresso in una stanza senza moderatore, con la
--     risposta del portale a mod_pa_occupants (l'evento li vuole o no): così
--     partono anche senza un moderatore in sala. Con un moderatore decide la
--     sua sala; una scelta fatta in sala dopo la domanda al portale vale più
--     della risposta, che arriva dopo.
--
-- Attivo solo con PA_CAPTIONS_ENABLED=true nell'ambiente di Prosody. Il chart
-- e lo stack Docker Compose lo impostano insieme all'indirizzo del servizio in
-- Jicofo: senza il servizio, una stanza che si dichiara trascrivibile
-- lascerebbe senza risposta la richiesta del moderatore.

local jid_node = require 'util.jid'.node;
local now = require 'util.time'.now;

local util = module:require 'util';
local is_healthcheck_room = util.is_healthcheck_room;
local get_room_from_jid = util.get_room_from_jid;
local table_shallow_copy = util.table_shallow_copy;
-- Un moderatore in sala secondo il token (il ruolo nella sala, appena
-- entrati, può essere quello che Jicofo dà per un istante a tutti): allora
-- decide la sua sala.
local function has_moderator(room)
    for _, occupant in room:each_occupant() do
        local session = prosody.full_sessions[occupant.jid];
        local user = session and session.jitsi_meet_context_user;
        if type(user) == 'table' and user.affiliation == 'owner' then
            return true;
        end
    end
    return false;
end

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

-- L'ultima volta che un client ha scritto la trascrizione della stanza (la
-- sala di un moderatore). Lo annuncia il componente dei metadati.
module:hook('jitsi-metadata-updated', function(event)
    if event.key == 'recording' and event.room then
        event.room._pa_captions_client_at = now();
    end
end);

-- Il portale ha detto, a un ingresso, se l'evento vuole i sottotitoli
-- (mod_pa_occupants). Decide solo nelle stanze senza un moderatore: con un
-- moderatore in sala decide la sua sala, all'ingresso e a ogni cambio
-- dell'interruttore, e due padroni della stessa scelta si contraddirebbero.
module:hook('pa-captions-wanted', function(event)
    local room = event.room;
    if not room or is_healthcheck_room(room.jid) or get_room_from_jid(room.jid) ~= room then
        return;
    end
    if has_moderator(room) then
        return;
    end
    -- Vale la decisione più recente: una scelta fatta in sala dopo la domanda,
    -- o la risposta a una domanda fatta dopo, arrivata prima di questa.
    local client_at = room._pa_captions_client_at;
    if client_at and client_at >= event.asked_at then
        return;
    end
    local answer_at = room._pa_captions_answer_at;
    if answer_at and answer_at > event.asked_at then
        return;
    end
    room._pa_captions_answer_at = event.asked_at;
    room.jitsiMetadata = room.jitsiMetadata or {};
    local recording = room.jitsiMetadata.recording;
    local acceso = type(recording) == 'table' and recording.isTranscribingEnabled == true;
    if acceso == event.on then
        return;
    end
    local nuovo = type(recording) == 'table' and table_shallow_copy(recording) or {};
    nuovo.isTranscribingEnabled = event.on;
    room.jitsiMetadata.recording = nuovo;
    module:log('info', 'Sottotitoli %s nella stanza %s, come vuole l\'evento',
        event.on and 'accesi' or 'spenti', jid_node(room.jid));
    -- Il componente dei metadati lo manda a tutti, Jicofo compreso.
    module:fire_event('room-metadata-changed', { room = room });
end);
