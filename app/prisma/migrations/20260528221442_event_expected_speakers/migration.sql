-- Numero di parlanti attesi: forza k nella diarization quando noto.
ALTER TABLE "events"
ADD COLUMN "expected_speakers" INTEGER;
