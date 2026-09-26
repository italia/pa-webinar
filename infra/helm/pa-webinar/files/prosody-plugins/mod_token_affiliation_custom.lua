-- mod_token_affiliation_custom.lua
--
-- Forces XMPP room affiliation based on the JWT context.user.affiliation
-- field. This is a safety net: if the built-in token_affiliation module
-- doesn't pick up the claim, this plugin explicitly reads it and sets
-- the occupant's affiliation before they join the MUC.
--
-- Expected JWT structure:
--   context.user.affiliation = "owner"  → MUC owner (moderator)
--   context.user.affiliation = "member" → MUC member (participant)
--   (anything else / missing)           → MUC member (participant)

local log = module._log;

module:hook("muc-occupant-pre-join", function (event)
    local dominated = event.stanza:get_child("x", "http://jabber.org/protocol/muc");
    local session = event.origin;

    if session.jitsi_meet_context_user then
        local affiliation = session.jitsi_meet_context_user.affiliation;
        if affiliation == "owner" then
            event.room:set_affiliation(true, event.stanza.attr.from, "owner");
            log("info", "Set affiliation to owner for %s", event.stanza.attr.from);
        else
            event.room:set_affiliation(true, event.stanza.attr.from, "member");
            log("info", "Set affiliation to member for %s", event.stanza.attr.from);
        end
    else
        event.room:set_affiliation(true, event.stanza.attr.from, "member");
        log("info", "No JWT context — forcing member affiliation for %s", event.stanza.attr.from);
    end
end, 100);
