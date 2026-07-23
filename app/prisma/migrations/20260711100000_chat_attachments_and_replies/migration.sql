-- Chat: optional single attachment + reply/quote self-reference (additive).
ALTER TABLE "chat_messages"
  ADD COLUMN "reply_to_id" UUID,
  ADD COLUMN "attachment_blob_path" TEXT,
  ADD COLUMN "attachment_name" TEXT,
  ADD COLUMN "attachment_mime" TEXT,
  ADD COLUMN "attachment_size" BIGINT;

-- Reply parent: keep replies when the parent is deleted (dangling reply
-- renders as "removed" in the UI) rather than cascading the delete.
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_reply_to_id_fkey"
  FOREIGN KEY ("reply_to_id") REFERENCES "chat_messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "chat_messages_reply_to_id_idx" ON "chat_messages"("reply_to_id");
