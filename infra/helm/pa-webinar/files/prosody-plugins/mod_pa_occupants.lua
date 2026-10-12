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
-- Attivo solo con PA_PORTAL_URL (l'indirizzo interno del portale)
-- nell'ambiente di Prosody. Le notifiche sono firmate con il segreto dei token
-- della conferenza (JWT_APP_SECRET), che il portale conosce già: HMAC-SHA256
-- del corpo con una chiave derivata dal segreto, e l'ora di invio nel corpo
-- (app/src/lib/auth/prosody-signature.ts).

local http = require 'net.http';
local json = require 'cjson.safe';
local jid = require 'util.jid';
local hashes = require 'util.hashes';

local util = module:require 'util';
local is_healthcheck_room = util.is_healthcheck_room;

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
    local body = json.encode({
        room = jid.node(room.jid);
        -- L'id della riunione (mod_muc_meeting_id): il servizio dei
        -- sottotitoli lo riceve dal bridge, e il portale ne ricava l'evento.
        meetingId = room._data and room._data.meetingId or nil;
        endpointId = endpoint;
        seatId = user.id;
        action = action;
        ts = os.time();
    });
    http.request(url, {
        method = 'POST';
        body = body;
        headers = {
            ['Content-Type'] = 'application/json';
            ['x-pa-signature'] = hashes.hmac_sha256(signing_key, body, true);
        };
    }, function(_, code)
        if code ~= 204 and code ~= 200 then
            module:log('warn', 'Occupanti: il portale ha risposto %s (%s)', tostring(code), action);
        end
    end);
end

module:hook('muc-occupant-joined', function(event)
    notify(event.room, event.occupant, 'joined');
end, -1);

module:hook('muc-occupant-left', function(event)
    notify(event.room, event.occupant, 'left');
end, -1);
