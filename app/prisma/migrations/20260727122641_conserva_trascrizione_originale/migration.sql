-- AlterTable
ALTER TABLE "postprod_artifacts" ADD COLUMN     "revised_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "postprod_original_bodies" (
    "id" UUID NOT NULL,
    "artifact_id" UUID NOT NULL,
    "recording_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" "PostprodArtifactType" NOT NULL,
    "language" VARCHAR(8),
    "body" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "size_bytes" BIGINT,
    "model_id" VARCHAR(120),
    "model_version" VARCHAR(80),
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "postprod_original_bodies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "postprod_original_bodies_artifact_id_key" ON "postprod_original_bodies"("artifact_id");

-- CreateIndex
CREATE INDEX "postprod_original_bodies_recording_id_idx" ON "postprod_original_bodies"("recording_id");

-- CreateIndex
CREATE INDEX "postprod_original_bodies_event_id_idx" ON "postprod_original_bodies"("event_id");

-- AddForeignKey
ALTER TABLE "postprod_original_bodies" ADD CONSTRAINT "postprod_original_bodies_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "postprod_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
