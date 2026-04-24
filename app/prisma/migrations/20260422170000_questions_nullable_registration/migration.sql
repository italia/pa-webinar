-- Allow guest-authored questions by making the FK to Registration nullable.
-- `author_name` stays the authoritative display name; guests have null
-- registration_id and keep whatever name they typed in the waiting room.
ALTER TABLE "questions" ALTER COLUMN "registration_id" DROP NOT NULL;
