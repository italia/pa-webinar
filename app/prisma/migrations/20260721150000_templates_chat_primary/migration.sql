-- Chat is the primary interaction channel (live feedback #10).
--
-- WHY: v0.8.0 changed the blank-event default to chat-on / Q&A-off
-- (defaultMatrix()), but that default is only reached when the admin skips the
-- template picker — and the picker is shown first whenever templates exist.
-- Every system template still carried the OLD combination, so creating an event
-- from "Webinar" or "Presentazione pubblica" reproduced exactly the incoherence
-- the feedback reported: the admin sees a Q&A flag, the room shows only chat.
--
-- Scope: system templates the admin has never touched. `is_system` alone is not
-- enough — the admin UI edits system templates exactly like custom ones (no
-- isSystem guard on PUT /api/admin/templates), so a deployment that deliberately
-- turned Q&A on for its "Webinar" template would have had that silently
-- reverted. `updated_at = created_at` is the precise "still as shipped"
-- predicate: Prisma stamps updated_at on every write through the app, while raw
-- SQL migrations like this one leave it alone.
-- Q&A is not removed — it stays a per-event toggle a moderator can switch on.
UPDATE "event_templates"
SET "chat_enabled" = true,
    "qa_enabled" = false
WHERE "is_system" = true
  -- A one-second tolerance rather than strict equality: rows seeded by an
  -- earlier raw-SQL migration or by `prisma db seed` can carry timestamps that
  -- differ by microseconds, and a strict `=` would make this a silent no-op on
  -- those deployments. An admin edit is always minutes or more away.
  AND "updated_at" <= "created_at" + interval '1 second';

-- Same rationale for the column defaults, so a template row inserted without an
-- explicit value (admin form, future migrations) starts chat-primary too.
ALTER TABLE "event_templates" ALTER COLUMN "chat_enabled" SET DEFAULT true;
ALTER TABLE "event_templates" ALTER COLUMN "qa_enabled" SET DEFAULT false;

-- Events keep their historical column defaults untouched on purpose: existing
-- rows are records of how a past event actually ran, and the creation path
-- always writes both flags explicitly from the wizard.
