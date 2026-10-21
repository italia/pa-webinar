-- CreateEnum
CREATE TYPE "RecordingAudience" AS ENUM ('PUBLIC', 'REGISTRANTS');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "recording_audience" "RecordingAudience" NOT NULL DEFAULT 'PUBLIC';
