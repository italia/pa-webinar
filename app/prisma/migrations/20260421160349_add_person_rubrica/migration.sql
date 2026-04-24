-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "person_id" UUID;

-- CreateTable
CREATE TABLE "persons" (
    "id" UUID NOT NULL,
    "email_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "organization" TEXT,
    "organization_role" TEXT,
    "organization_type" "OrganizationType",
    "opted_in_to_address_book" BOOLEAN NOT NULL DEFAULT false,
    "opted_in_at" TIMESTAMP(3),
    "opted_out_at" TIMESTAMP(3),
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retention_months" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "persons_email_hash_key" ON "persons"("email_hash");

-- CreateIndex
CREATE INDEX "persons_opted_in_to_address_book_last_active_at_idx" ON "persons"("opted_in_to_address_book", "last_active_at");

-- CreateIndex
CREATE INDEX "registrations_person_id_idx" ON "registrations"("person_id");

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
