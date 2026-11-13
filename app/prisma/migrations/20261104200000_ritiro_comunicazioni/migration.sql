-- Quando sono state ritirate le comunicazioni future: la prova del ritiro.
ALTER TABLE "registrations" ADD COLUMN "consent_future_communications_withdrawn_at" TIMESTAMP(3);
