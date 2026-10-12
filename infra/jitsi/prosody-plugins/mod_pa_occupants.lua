-- mod_pa_occupants.lua
--
-- Dice al portale chi c'è nella conferenza. Per ogni occupante entrato con un
-- token manda la stanza, l'endpoint del bridge (la risorsa del suo nick nella
-- stanza: lo stesso id con cui il bridge manda l'audio al servizio dei
-- sottotitoli e al registratore) e il posto del token (context.user.id del
-- JWT). Il portale lo usa per decidere, voce per voce, se tenere la
-- trascrizione dei suoi interventi secondo il consenso della persona.
--
-- Non manda nomi né indirizzi: il posto rimanda all'iscrizione, e il nome il
-- portale lo conosce già. Chi entra senza token (il registratore, Jicofo) non
-- si segnala.
--
-- A un ingresso, e ogni trenta secondi per le stanze con qualcuno dentro
-- (action "check"), il portale risponde, dove il servizio dei sottotitoli è
-- installato, se l'evento li vuole ({"captions": true|false}). Il modulo lo
-- passa a mod_pa_captions con l'evento 'pa-captions-wanted', che accende o
-- spegne la trascrizione delle stanze senza un moderatore.
--
-- Attivo solo con PA_PORTAL_URL (l'indirizzo interno del portale)
-- nell'ambiente di Prosody. Le notifiche sono firmate con il segreto dei token
-- della conferenza (JWT_APP_SECRET), che il portale conosce già: HMAC-SHA256
-- del corpo con una chiave derivata dal segreto, e l'ora di invio nel corpo
-- (app/src/lib/auth/prosody-signature.ts).

local http = require 'net.http';
local json = require 'cjson.safe';
local jid = require 'util.jid';
local hashes = require 'util.hashes';
local now = require 'util.time'.now;

local util = module:require 'util';
local is_healthcheck_room = util.is_healthcheck_room;
local is_admin = util.is_admin;

local portal = os.getenv('PA_PORTAL_URL');
local secret = os.getenv('JWT_APP_SECRET');
if not portal or portal == '' or not secret or secret == '' then
    module:log('info', 'Occupanti: PA_PORTAL_URL o JWT_APP_SECRET mancanti, il portale non saprà chi parla');
    return;
end
-- La chiave della firma, derivata dal segreto: la firma non vale come token.
local signing_key = hashes.hmac_sha256(secret, 'pa-occupants', false);
local url = portal:gsub('/+$', '') .. '/api/internal/jitsi/occupants';

-- Il token della persona dietro un occupante, se è entrata con un token.
local function context_user(occupant)
    local session = prosody.full_sessions[occupant.jid];
    local user = session and session.jitsi_meet_context_user;
    if type(user) == 'table' then
        return user;
    end
    return nil;
end

-- Manda al portale un corpo firmato; la risposta, se dice se l'evento vuole i
-- sottotitoli, va a mod_pa_captions.
local function post(room, fields, label)
    fields.room = jid.node(room.jid);
    -- L'id della riunione (mod_muc_meeting_id): il servizio dei sottotitoli
    -- lo riceve dal bridge, e il portale ne ricava l'evento.
    fields.meetingId = room._data and room._data.meetingId or nil;
    fields.ts = os.time();
    local body = json.encode(fields);
    -- Quando si è chiesto: una scelta fatta in sala dopo questo momento, o
    -- la risposta a una domanda fatta dopo, vale più di questa risposta.
    local chiesto = now();
    http.request(url, {
        method = 'POST';
        body = body;
        headers = {
            ['Content-Type'] = 'application/json';
            ['x-pa-signature'] = hashes.hmac_sha256(signing_key, body, true);
        };
    }, function(risposta, code)
        if label == 'check' and code == 404 then
            -- Non è la stanza di un evento, o il portale non ha il servizio
            -- dei sottotitoli: per questa stanza non si chiede più. Un altro
            -- errore (un portale che si sta aggiornando, un orologio fuori
            -- passo) non ferma le domande.
            room._pa_check_off = true;
            module:log('info', 'Occupanti: niente domande periodiche per %s', room.jid);
            return;
        end
        if code ~= 204 and code ~= 200 then
            module:log('warn', 'Occupanti: il portale ha risposto %s (%s)', tostring(code), label);
            return;
        end
        if code ~= 200 then
            return;
        end
        local dati = json.decode(risposta or '');
        if type(dati) == 'table' and type(dati.captions) == 'boolean' then
            module:fire_event('pa-captions-wanted', { room = room; on = dati.captions; asked_at = chiesto });
        end
    end);
end

local function notify(room, occupant, action)
    if is_healthcheck_room(room.jid) then
        return;
    end
    local user = context_user(occupant);
    if not user or type(user.id) ~= 'string' or user.id == '' then
        return;
    end
    local endpoint = jid.resource(occupant.nick);
    if not endpoint or endpoint == 'focus' then
        return;
    end
    post(room, { endpointId = endpoint; seatId = user.id; action = action }, action);
end

-- Il posto del registratore multitraccia (app/src/lib/recorder/seat.ts): da
-- solo in una stanza non c'è nessuno da sottotitolare.
local RECORDER_SEAT_PREFIX = 'rec-bot-';

-- Se chiedere per una stanza: c'è qualcuno con un token, registratore
-- escluso, e nessun moderatore (secondo il token), perché con un moderatore
-- decide la sua sala e mod_pa_captions non userebbe la risposta.
local function worth_asking(room)
    local people = false;
    for _, occupant in room:each_occupant() do
        local user = not is_admin(occupant.bare_jid) and context_user(occupant);
        if user then
            if user.affiliation == 'owner' then
                return false;
            end
            if type(user.id) == 'string'
                and user.id:sub(1, #RECORDER_SEAT_PREFIX) ~= RECORDER_SEAT_PREFIX then
                people = true;
            end
        end
    end
    return people;
end

-- Ogni CHECK_INTERVAL secondi, per ogni stanza aperta con qualcuno dentro,
-- si chiede al portale se l'evento vuole i sottotitoli: arrivano così anche
-- le decisioni che non nascono da un ingresso (la diretta che comincia,
-- l'interruttore cambiato dall'amministrazione). Solo dove i sottotitoli
-- sono installati: altrove la risposta non serve a niente.
local CHECK_INTERVAL = 30;

if os.getenv('PA_CAPTIONS_ENABLED') == 'true' then
    local muc_service = module:depends('muc');
    module:add_timer(CHECK_INTERVAL, function()
        for room in muc_service.live_rooms() do
            if not room._pa_check_off and not is_healthcheck_room(room.jid) and worth_asking(room) then
                post(room, { action = 'check' }, 'check');
            end
        end
        return CHECK_INTERVAL;
    end);
end

module:hook('muc-occupant-joined', function(event)
    notify(event.room, event.occupant, 'joined');
end, -1);

module:hook('muc-occupant-left', function(event)
    notify(event.room, event.occupant, 'left');
end, -1);
