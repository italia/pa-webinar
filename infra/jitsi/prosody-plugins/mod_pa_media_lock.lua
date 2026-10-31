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
--                              moderare (i relatori);
--   context.user.mediaAdmit  = { audio = bool, video = bool, desktop = bool }
--                              i mezzi per cui la persona è ammessa senza
--                              aspettare chi modera (chi partecipa avendo
--                              dato il consenso alla registrazione, per ciò
--                              che l'evento concede);
--   context.user.consentLock = true in ogni token di un evento con il solo
--                              ascolto: la moderazione non si spegne;
--   context.user.listenOnly  = true per chi è entrato in solo ascolto (non
--                              ha dato il consenso alla registrazione): mai
--                              tra gli ammessi, nemmeno se un moderatore gli
--                              dà la parola. Per parlare rientra con il
--                              consenso (il portale gli dà un token nuovo).
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
-- Jicofo apre la sessione di ciascuno solo quando nella sala ci sono almeno
-- due persone, e la riapre a chi resta solo e la perde. Con la moderazione
-- accesa, chi non modera nasce chiuso sul bridge anche se è tra gli ammessi, e
-- il client non lo sa: chiede di essere aperto una volta sola, alla prima
-- accensione del microfono, e se in quel momento era solo nella sala Jicofo
-- non aveva ancora una sessione a cui applicarla. Un relatore che ha aperto il
-- microfono da solo resterebbe muto per tutti con il microfono aperto davanti.
-- A ogni sessione che Jicofo offre a un ammesso che non modera, il modulo
-- ripete a suo nome quella richiesta: Jicofo la accoglie perché è tra gli
-- ammessi, e i client non vedono niente.
--
-- Il modulo replica parti interne del componente (stato della sala e forma
-- dei messaggi): a ogni aggiornamento di Jitsi va riprovato
-- (docs/architecture/jitsi-integration.md, checklist di aggiornamento).

local array = require 'util.array';
local json = require 'cjson.safe';
local st = require 'util.stanza';

local timer = require 'util.timer';

local jid_bare = require 'util.jid'.bare;
local uuid = require 'util.uuid'.generate;

local util = module:require 'util';
local get_room_by_name_and_subdomain = util.get_room_by_name_and_subdomain;
local get_room_from_jid = util.get_room_from_jid;
local process_host_module = util.process_host_module;
local is_admin = util.is_admin;
local is_healthcheck_room = util.is_healthcheck_room;
local internal_room_jid_match_rewrite = util.internal_room_jid_match_rewrite;
local room_jid_match_rewrite = util.room_jid_match_rewrite;
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

local function is_listen_only(user)
    return user ~= nil and user.listenOnly == true;
end

-- Ammesso per quel mezzo senza aspettare chi modera: l'esente per tutti, chi
-- ha mediaAdmit per i mezzi che vi sono indicati; chi è in solo ascolto mai.
local function admitted_for(user, media_type)
    if user == nil or is_listen_only(user) then
        return false;
    end
    if user.mediaExempt == true then
        return true;
    end
    local admit = user.mediaAdmit;
    return type(admit) == 'table' and admit[media_type] == true;
end

local function admitted_for_any(user)
    for _, m in ipairs(MEDIA_TYPES) do
        if admitted_for(user, m) then
            return true;
        end
    end
    return false;
end

-- «Ammesso» alla sola persona: l'elenco ai moderatori parte a parte.
local function notify_approved(room, media_type, approved_jid)
    send_json(approved_jid, {
        type = 'av_moderation';
        room = internal_room_jid_match_rewrite(room.jid);
        mediaType = media_type;
        approved = true;
    });
end

-- Mette l'occupante tra gli ammessi dei tipi moderati, una volta sola: tutti,
-- o quelli per cui `solo` dice di sì.
local function admit(room, occupant, why, solo)
    if not room.av_moderation then
        return;
    end
    local nick = internal_room_jid_match_rewrite(occupant.nick);
    for _, m in ipairs(MEDIA_TYPES) do
        local whitelist = room.av_moderation[m];
        if whitelist and (solo == nil or solo(m)) and not contains(whitelist, nick) then
            whitelist:push(nick);
            notify_whitelist(room, m, occupant.jid);
            module:log('info', 'Ammesso %s (%s) per %s in %s', nick, why, m, room.jid);
        end
    end
end

-- Accende il blocco prima che chi entra sia nella sala, all'ingresso del
-- primo che lo porta nel token. Chi entra trova la moderazione già accesa,
-- come chi entra dopo un moderatore: parte col microfono chiuso e, se è
-- ammesso, riaprendolo si sente. La moderazione non si accende mai mentre
-- l'ingresso di qualcuno nella conferenza è in corso: un relatore col
-- microfono aperto resterebbe muto sul bridge con il client che lo mostra
-- aperto.
--
-- Chi entra, se esente o moderatore, è tra gli ammessi già all'accensione:
-- Jicofo, quando la moderazione si accende, silenzia sul bridge chi non
-- trova nell'elenco.
local function on_occupant_pre_join(event)
    local room, occupant, session = event.room, event.occupant, event.origin;
    if room._data.pa_media_lock_applied or is_healthcheck_room(room.jid)
        or (occupant and is_admin(occupant.bare_jid)) then
        return;
    end
    local user = session and session.jitsi_meet_context_user;
    local lock = type(user) == 'table' and user.mediaLock or nil;
    if type(lock) ~= 'table' then
        return;
    end
    room._data.pa_media_lock_applied = true;
    -- Un evento con il solo ascolto lo dice in ogni token (consentLock): i
    -- blocchi della sala non si tolgono.
    if user.consentLock == true then
        room._data.pa_listen_only_room = true;
    end
    local actor = room.jid .. '/focus';
    local nick = occupant and internal_room_jid_match_rewrite(occupant.nick);
    for _, m in ipairs(MEDIA_TYPES) do
        if lock[m] == true and start_lock(room, m, actor) then
            if (admitted_for(user, m) or (user.affiliation == 'owner' and not is_listen_only(user))) and nick
                and not contains(room.av_moderation[m], nick) then
                room.av_moderation[m]:push(nick);
            end
            notify_whitelist(room, m);
            notify_enabled(room, actor, m);
            module:log('info', 'Moderazione %s accesa in %s', m, room.jid);
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

    if room:get_role(occupant.nick) == 'moderator' then
        if not is_listen_only(user) then
            admit(room, occupant, 'moderatore');
        end
    elseif admitted_for_any(user) then
        -- Già tra gli ammessi se è stato lui ad accendere il blocco: il
        -- componente, al suo ingresso, gli ha detto che la moderazione è
        -- accesa, e manca solo il suo «ammesso». Per gli altri tipi lo manda
        -- admit.
        local nick = internal_room_jid_match_rewrite(occupant.nick);
        if room.av_moderation then
            for _, m in ipairs(MEDIA_TYPES) do
                local whitelist = room.av_moderation[m];
                if whitelist and contains(whitelist, nick) then
                    notify_approved(room, m, occupant.jid);
                end
            end
        end
        admit(room, occupant, 'ammesso dal token', function(m) return admitted_for(user, m) end);
    end
end

-- Solo chi perde davvero il ruolo di owner: le riassegnazioni di member a chi
-- era già member (token_affiliation le ripete per qualche secondo dopo
-- l'ingresso) non toccano le ammissioni date da un moderatore.
local function on_affiliation_changed(event)
    local room = event.room;
    if not room.av_moderation or is_healthcheck_room(room.jid) or is_admin(event.jid) then
        return;
    end
    -- Chi e' in solo ascolto resta fuori dagli ammessi anche se diventa
    -- moderatore: il componente aggiunge gli owner, qui si tolgono.
    if event.affiliation == 'owner' then
        for _, occupant in room:each_occupant() do
            if occupant.bare_jid == event.jid and is_listen_only(context_user(occupant)) then
                local nick = internal_room_jid_match_rewrite(occupant.nick);
                for _, m in ipairs(MEDIA_TYPES) do
                    local whitelist = room.av_moderation[m];
                    if whitelist and remove_all(whitelist, nick) then
                        module:log('info', 'Tolto %s (in solo ascolto) dagli ammessi per %s in %s', nick, m, room.jid);
                        notify_whitelist(room, m);
                    end
                end
            end
        end
        return;
    end
    if event.previous_affiliation ~= 'owner' then
        return;
    end
    for _, occupant in room:each_occupant() do
        if occupant.bare_jid == event.jid then
            local user = context_user(occupant);
            local nick = internal_room_jid_match_rewrite(occupant.nick);
            for _, m in ipairs(MEDIA_TYPES) do
                local whitelist = room.av_moderation[m];
                if whitelist and remove_all(whitelist, nick) then
                    if admitted_for(user, m) then
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
    if not command or not session or not session.jitsi_web_query_room then
        return;
    end
    local room = get_room_by_name_and_subdomain(session.jitsi_web_query_room, session.jitsi_web_query_prefix);
    if not room then
        return;
    end
    -- «Dai la parola» a chi è in solo ascolto: non si ammette. Ha scelto di
    -- non essere registrato; per parlare rientra dando il consenso (la sala
    -- glielo propone). Il comando si ferma qui, prima del componente.
    local target = command.attr.jidToWhitelist;
    if target then
        local occupant = room:get_occupant_by_nick(room_jid_match_rewrite(target));
        if occupant and is_listen_only(context_user(occupant)) then
            module:log('info', 'Non ammesso %s: in solo ascolto, in %s', target, room.jid);
            return true;
        end
        return;
    end
    -- Nelle sale con il solo ascolto la moderazione resta accesa: toglierla
    -- aprirebbe i mezzi a chi non ha dato il consenso alla registrazione.
    if command.attr.enable == 'false' and room._data.pa_listen_only_room then
        module:log('info', 'Moderazione non spenta in %s: sala con il solo ascolto', room.jid);
        return true;
    end
    if command.attr.enable ~= 'true' then
        return;
    end
    timer.add_task(0, function()
        for _, occupant in room:each_occupant() do
            local user = context_user(occupant);
            if admitted_for_any(user) and room:get_role(occupant.nick) ~= 'moderator' then
                admit(room, occupant, 'ammesso dal token, moderazione riaccesa',
                    function(m) return admitted_for(user, m) end);
            end
        end
    end);
end

-- Jicofo deve aver registrato sul bridge la sessione appena offerta prima che
-- le si chieda di aprirla.
local APERTURA_S = 1;

-- La richiesta che il client manda a Jicofo quando accende un mezzo dopo che
-- Jicofo lo ha chiuso: «apri me» per ogni tipo moderato in cui la persona è
-- tra gli ammessi. Passa dalla sala, che la consegna a Jicofo come se venisse
-- dall'occupante; la risposta torna al client, che la ignora.
local function request_open(room, nick)
    local occupant = room.av_moderation and room:get_occupant_by_nick(nick);
    if not occupant or room:get_role(nick) == 'moderator' then
        return;
    end
    local listed = internal_room_jid_match_rewrite(nick);
    for _, m in ipairs(MEDIA_TYPES) do
        local whitelist = room.av_moderation[m];
        if whitelist and contains(whitelist, listed) then
            module:send(st.iq({ type = 'set'; from = occupant.jid; to = room.jid .. '/focus'; id = uuid(); })
                :tag('mute', { xmlns = 'http://jitsi.org/jitmeet/' .. m; jid = nick; }):text('false'):up());
            module:log('info', 'Aperto sul bridge %s (ammesso, nuova sessione) per %s in %s', listed, m, room.jid);
        end
    end
end

-- Jicofo offre una sessione (nuova, o su un altro bridge) a chi è nella sala.
local function on_iq_to_occupant(event)
    local stanza = event.stanza;
    if stanza.attr.type ~= 'set' then
        return;
    end
    local jingle = stanza:get_child('jingle', 'urn:xmpp:jingle:1');
    local action = jingle and jingle.attr.action;
    if action ~= 'session-initiate' and action ~= 'transport-replace' then
        return;
    end
    local room = get_room_from_jid(jid_bare(stanza.attr.to));
    if not room or not room.av_moderation then
        return;
    end
    local sender = room:get_occupant_jid(stanza.attr.from);
    if not sender or not ends_with(sender, '/focus') then
        return;
    end
    local nick = stanza.attr.to;
    timer.add_task(APERTURA_S, function()
        request_open(room, nick);
    end);
end

-- Dopo i moduli dei token, che hanno già letto il token di chi entra, e dopo
-- i controlli della stanza (password -20, stanza chiusa -30), che possono
-- ancora rifiutare l'ingresso: qui si accende la prima volta, prima che entri.
module:hook('muc-occupant-pre-join', on_occupant_pre_join, -40);
-- Dopo il componente av_moderation (-2), che informa chi entra dello stato già
-- acceso: qui si ammettono moderatori ed esenti.
module:hook('muc-occupant-joined', on_occupant_joined, -3);
-- Dopo il componente (-1), che sull'owner aggiunge agli ammessi.
module:hook('muc-set-affiliation', on_affiliation_changed, -2);
-- Prima della MUC, che inoltra la stanza a chi è nella sala.
module:hook('iq/full', on_iq_to_occupant, 10);
-- Prima del componente, che ferma l'evento quando lo gestisce.
process_host_module(av_host, function(host_module)
    host_module:hook('message/host', on_av_command, 10);
end);
