-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "answered_at" TIMESTAMP(3),
ADD COLUMN     "dismissed_at" TIMESTAMP(3),
ADD COLUMN     "is_question" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "moderated_by" TEXT;

-- CreateIndex
CREATE INDEX "chat_messages_event_id_is_question_created_at_idx" ON "chat_messages"("event_id", "is_question", "created_at");
