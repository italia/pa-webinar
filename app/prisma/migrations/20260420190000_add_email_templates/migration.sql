-- CreateTable
CREATE TABLE "email_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "subject" TEXT,
    "heading" TEXT,
    "bodyIntro" TEXT,
    "ctaLabel" TEXT,
    "infoNote" TEXT,
    "footerNote" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_key_locale_key" ON "email_templates"("key", "locale");
