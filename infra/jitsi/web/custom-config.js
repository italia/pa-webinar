// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// Configurazione della conferenza nello stack locale (docker-compose):
// nessun logo predefinito. L'immagine jitsi/web aggiunge questo file in coda
// al suo config.js all'avvio del contenitore.
config.defaultLogoUrl = '';

// La sessione del registratore (Jibri) non vede chi non ha un consenso valido:
// mod_pa_media_lock lo dice nella presenza, e per tutti gli altri il video resta
// com'e'.
config.hiddenFromRecorderFeatureEnabled = true;
