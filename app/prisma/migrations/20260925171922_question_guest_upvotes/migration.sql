-- Pollice in su alle domande anche per chi non ha una registrazione (ospiti,
-- relatori, moderatori), con l'identificativo stabile del browser come nei
-- sondaggi e nella nuvola di parole. Tabella nuova invece di una colonna in
-- più su "question_upvotes": là "registration_id" resta NOT NULL, quindi una
-- versione precedente dell'app, durante il rilascio graduale o dopo un
-- rollback, legge quella tabella senza mai trovare un voto senza registrazione.
-- Il voto se ne va con la domanda (ON DELETE CASCADE).

-- CreateTable
CREATE TABLE "question_guest_upvotes" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "guest_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_guest_upvotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "question_guest_upvotes_question_id_guest_id_key" ON "question_guest_upvotes"("question_id", "guest_id");

-- AddForeignKey
ALTER TABLE "question_guest_upvotes" ADD CONSTRAINT "question_guest_upvotes_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

