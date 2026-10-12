-- CreateTable
CREATE TABLE "multitrack_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "jitsi_user_id" VARCHAR(80) NOT NULL,
    "display_name" TEXT NOT NULL,
    "registration_id" UUID,
    "locale" VARCHAR(8),
    "consented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multitrack_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "multitrack_consents_event_id_idx" ON "multitrack_consents"("event_id");

-- CreateIndex
CREATE INDEX "multitrack_consents_registration_id_idx" ON "multitrack_consents"("registration_id");

-- AddForeignKey
ALTER TABLE "multitrack_consents" ADD CONSTRAINT "multitrack_consents_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multitrack_consents" ADD CONSTRAINT "multitrack_consents_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

