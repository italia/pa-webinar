-- mod_pa_media_lock.lua
--
-- Blocca davvero microfono, videocamera e condivisione dello schermo dei
-- partecipanti quando l'evento non li concede. Senza questo modulo il limite
-- vive solo nell'interfaccia (pulsanti tolti dalla barra, ingresso a microfono
-- spento): chi apre la sala fuori dal portale li riaccende.
--
-- Il modulo accende la moderazione audio/video di Jitsi (il componente
-- av_moderation) al primo ingresso nella sala, senza aspettare un moderatore,
-- e ammette subito chi il token dichiara esente. Jicofo la applica sul bridge:
-- chi non è ammesso resta silenziato anche se il suo client prova ad accendere.
--
-- Il portale scrive nel token di ogni persona dell'evento:
--   context.user.mediaLock   = { audio = bool, video = bool, desktop = bool }
--                              cosa l'evento NON concede ai partecipanti;
--   context.user.mediaExempt = true per chi ha audio e video pieni senza
--                              moderare (i relatori).
-- I moderatori (owner) sono ammessi anche loro: Jicofo controlla solo
-- l'elenco, non il ruolo.
--
-- Il blocco si accende una volta per sala, al primo ingresso che lo chiede: se
-- un moderatore poi toglie la moderazione, resta tolta finché la sala non si
-- svuota e viene ricreata.
--
-- Lo stato è quello del componente (room.av_moderation e
-- room.av_moderation_actors) e i messaggi partono a nome del componente,
-- perché client e Jicofo li accettano solo da lì.
--
-- L'autore dichiarato dell'accensione è Jicofo stesso (il focus della sala),
-- mai chi entra: Jicofo ammette l'autore, e un ospite indicato come autore
-- potrebbe parlare con un client che ignora la moderazione.
--
-- Il componente aggiunge agli ammessi chiunque diventi owner e non lo toglie
-- quando torna member. Dove Jicofo promuove per un istante chi entra (con la
-- sua autenticazione accesa, e token_affiliation che poi riporta il ruolo
-- del token) ogni partecipante resterebbe ammesso: chi perde il ruolo di
-- moderatore esce dagli ammessi, salvo gli esenti, che restano una volta sola.
--
-- Quando un moderatore riaccende la moderazione dalla sala, il componente
-- riparte da un elenco con i soli moderatori: il modulo vi riaggiunge gli
-- esenti presenti.
--
-- Il modulo replica parti interne del componente (stato della sala e forma
-- dei messaggi): a ogni aggiornamento di Jitsi va riprovato
-- (docs/architecture/jitsi-integration.md, checklist di aggiornamento).

local array = require 'util.array';
local json = require 'cjson.safe';
local st = require 'util.stanza';

local timer = require 'util.timer';

local util = module:require 'util';
local get_room_by_name_and_subdomain = util.get_room_by_name_and_subdomain;
local process_host_module = util.process_host_module;
local is_admin = util.is_admin;
local is_healthcheck_room = util.is_healthcheck_room;
local internal_room_jid_match_rewrite = util.internal_room_jid_match_rewrite;
local table_shallow_copy = util.table_shallow_copy;

local MEDIA_TYPES = { 'audio', 'video', 'desktop' };

local main_domain = module:get_option_string('muc_mapper_domain_base');
local av_host = module:get_option_string(
    'pa_av_moderation_component', main_domain and ('avmoderation.' .. main_domain) or nil);
if not av_host then
    module:log('warn', 'Manca muc_mapper_domain_base: il blocco di audio e video resta spento');
    return;
end

local function ends_with(s, suffix)
    return suffix == '' or s:sub(-#suffix) == suffix;
end

local function remove_all(list, value)
    local removed = false;
    for i = #list, 1, -1 do
        if list[i] == value then
            table.remove(list, i);
            removed = true;
        end
    end
    return removed;
end

local function contains(list, value)
    for _, v in ipairs(list) do
        if v == value then
            return true;
        end
    end
    return false;
end

local function send_json(to_jid, payload)
    local body, err = json.encode(payload);
    if not body then
        module:log('error', 'Messaggio non codificabile per %s: %s', to_jid, err);
        return;
    end
    module:send(st.message({ from = av_host; to = to_jid; })
        :tag('json-message', { xmlns = 'http://jitsi.org/jitmeet' }):text(body):up());
end

-- Come notify_occupants_enable del componente: a tutti, Jicofo compreso.
local function notify_enabled(room, actor_nick, media_type)
    local payload = {
        type = 'av_moderation';
        enabled = true;
        room = internal_room_jid_match_rewrite(room.jid);
        actor = internal_room_jid_match_rewrite(actor_nick);
        mediaType = media_type;
    };
    for _, occupant in room:each_occupant() do
        send_json(occupant.jid, payload);
    end
end

-- Come notify_whitelist_change del componente: l'elenco a chi modera (Jicofo
-- compreso), e «ammesso» alla sola persona appena aggiunta.
local function notify_whitelist(room, media_type, approved_jid)
    local whitelists = table_shallow_copy(room.av_moderation);
    for _, m in ipairs(MEDIA_TYPES) do
        if whitelists[m] and #whitelists[m] == 0 then
            whitelists[m] = nil;
        end
    end
    local room_jid = internal_room_jid_match_rewrite(room.jid);
    local for_moderators = {
        type = 'av_moderation'; room = room_jid; whitelists = whitelists; mediaType = media_type;
    };
    local for_approved = {
        type = 'av_moderation'; room = room_jid; mediaType = media_type; approved = true;
    };
    for _, occupant in room:each_occupant() do
        if room:get_role(occupant.nick) == 'moderator' then
            send_json(occupant.jid, for_moderators);
        elseif approved_jid and occupant.jid == approved_jid then
            send_json(occupant.jid, for_approved);
        end
    end
end

-- Come start_av_moderation del componente. Falso se la moderazione di quel
-- tipo era già accesa.
local function start_lock(room, media_type, actor_nick)
    if not room.av_moderation then
        room.av_moderation = {};
        room.av_moderation_actors = {};
    end
    if room.av_moderation[media_type] then
        return false;
    end
    local whitelist = array();
    for _, occupant in room:each_occupant() do
        if room:get_role(occupant.nick) == 'moderator' and not ends_with(occupant.nick, '/focus') then
            whitelist:push(internal_room_jid_match_rewrite(occupant.nick));
        end
    end
    room.av_moderation[media_type] = whitelist;
    room.av_moderation_actors[media_type] = actor_nick;
    -- Chi entra dopo parte silenziato: Jicofo legge startMuted dai metadati.
    if room.jitsiMetadata then
        local start_muted = room.jitsiMetadata.startMuted or {};
        local restore = room.av_moderation_startMuted_restore or {};
        restore[media_type] = start_muted[media_type];
        room.av_moderation_startMuted_restore = restore;
        start_muted[media_type] = true;
        room.jitsiMetadata.startMuted = start_muted;
    end
    return true;
end

-- Il token della persona dietro un occupante, se è entrata con un token.
local function context_user(occupant)
    local session = prosody.full_sessions[occupant.jid];
    local user = session and session.jitsi_meet_context_user;
    if type(user) == 'table' then
        return user;
    end
    return nil;
end

local function is_exempt(user)
    return user ~= nil and user.mediaExempt == true;
end

-- Mette l'occupante tra gli ammessi di ogni tipo moderato, una volta sola.
local function admit(room, occupant, why)
    if not room.av_moderation then
        return;
    end
    local nick = internal_room_jid_match_rewrite(occupant.nick);
    for _, m in ipairs(MEDIA_TYPES) do
        local whitelist = room.av_moderation[m];
        if whitelist and not contains(whitelist, nick) then
            whitelist:push(nick);
            notify_whitelist(room, m, occupant.jid);
            module:log('info', 'Ammesso %s (%s) per %s in %s', nick, why, m, room.jid);
        end
    end
end

local function on_occupant_joined(event)
    local room, occupant, session = event.room, event.occupant, event.origin;
    if is_healthcheck_room(room.jid) or is_admin(occupant.bare_jid) then
        return;
    end
    local user = session and session.jitsi_meet_context_user;
    if type(user) ~= 'table' then
        return;
    end

    local lock = user.mediaLock;
    if type(lock) == 'table' and not room._data.pa_media_lock_applied then
        room._data.pa_media_lock_applied = true;
        local actor = room.jid .. '/focus';
        for _, m in ipairs(MEDIA_TYPES) do
            if lock[m] == true and start_lock(room, m, actor) then
                notify_enabled(room, actor, m);
                notify_whitelist(room, m);
                module:log('info', 'Moderazione %s accesa in %s', m, room.jid);
            end
        end
    end

    if room:get_role(occupant.nick) == 'moderator' then
        admit(room, occupant, 'moderatore');
    elseif is_exempt(user) then
        admit(room, occupant, 'esente');
    end
end

-- Solo chi perde davvero il ruolo di owner: le riassegnazioni di member a chi
-- era già member (token_affiliation le ripete per qualche secondo dopo
-- l'ingresso) non toccano le ammissioni date da un moderatore.
local function on_affiliation_changed(event)
    local room = event.room;
    if not room.av_moderation or event.previous_affiliation ~= 'owner' or event.affiliation == 'owner'
        or is_healthcheck_room(room.jid) or is_admin(event.jid) then
        return;
    end
    for _, occupant in room:each_occupant() do
        if occupant.bare_jid == event.jid then
            local exempt = is_exempt(context_user(occupant));
            local nick = internal_room_jid_match_rewrite(occupant.nick);
            for _, m in ipairs(MEDIA_TYPES) do
                local whitelist = room.av_moderation[m];
                if whitelist and remove_all(whitelist, nick) then
                    if exempt then
                        -- L'esente resta, una volta sola: con due voci, la revoca di
                        -- un moderatore ne toglierebbe una e lo lascerebbe ammesso.
                        whitelist:push(nick);
                    else
                        module:log('info', 'Tolto %s dagli ammessi per %s in %s', nick, m, room.jid);
                    end
                    notify_whitelist(room, m);
                end
            end
        end
    end
end

-- Un moderatore riaccende la moderazione dalla sala: il componente riparte da
-- un elenco di soli moderatori. Dopo che l'ha elaborato, si riammettono gli
-- esenti. Il comando arriva al componente, non alla sala: si guarda passare
-- con priorità più alta e si agisce al giro successivo.
local function on_av_command(event)
    local session, stanza = event.origin, event.stanza;
    local command = stanza and stanza:get_child('av_moderation');
    if not command or command.attr.enable ~= 'true' or not session or not session.jitsi_web_query_room then
        return;
    end
    local room = get_room_by_name_and_subdomain(session.jitsi_web_query_room, session.jitsi_web_query_prefix);
    if not room then
        return;
    end
    timer.add_task(0, function()
        for _, occupant in room:each_occupant() do
            if is_exempt(context_user(occupant)) and room:get_role(occupant.nick) ~= 'moderator' then
                admit(room, occupant, 'esente, moderazione riaccesa');
            end
        end
    end);
end

-- Dopo il componente av_moderation (-2), che informa chi entra dello stato già
-- acceso: qui si accende la prima volta e si ammettono gli esenti.
module:hook('muc-occupant-joined', on_occupant_joined, -3);
-- Dopo il componente (-1), che sull'owner aggiunge agli ammessi.
module:hook('muc-set-affiliation', on_affiliation_changed, -2);
-- Prima del componente, che ferma l'evento quando lo gestisce.
process_host_module(av_host, function(host_module)
    host_module:hook('message/host', on_av_command, 10);
end);
