-- AlterTable
ALTER TABLE "multitrack_consents" ADD COLUMN     "withdrawn_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "recording_consents" ADD COLUMN     "withdrawn_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "consent_multitrack_withdrawn_at" TIMESTAMP(3),
ADD COLUMN     "consent_recording_withdrawn_at" TIMESTAMP(3);
