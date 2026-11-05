// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { z } from 'zod';

/**
 * La CSP di produzione non ammette `new Function` (lib/security/script-src).
 * Senza questa riga zod lo prova comunque e il browser registra una violazione
 * a ogni pagina. Deve stare qui: zod decide quando crea gli schemi, quindi
 * prima di qualunque altro modulo del client.
 */
z.config({ jitless: true });
