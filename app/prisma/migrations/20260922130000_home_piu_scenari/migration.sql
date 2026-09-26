-- Due impianti di home in piu' fra cui scegliere. Chi riusa la piattaforma
-- parla a pubblici diversi: la landing che racconta il progetto a chi lavora
-- nel digitale e' la pagina sbagliata per un ente che pubblica gli incontri
-- con i cittadini.
--
-- Additiva: nessuna installazione cambia comportamento, il valore predefinito
-- resta quello di prima.
ALTER TYPE "HomePageMode" ADD VALUE IF NOT EXISTS 'LANDING_ISTITUZIONALE';
ALTER TYPE "HomePageMode" ADD VALUE IF NOT EXISTS 'LANDING_SEMPLICE';
