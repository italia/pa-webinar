# Licenze di terze parti — eventi-dtd

Questo documento elenca tutte le dipendenze utilizzate dal progetto e le relative licenze, ai fini della trasparenza e della conformità con la licenza EUPL-1.2.

## Compatibilità licenze

La licenza EUPL-1.2 è compatibile con le seguenti licenze (Art. 5 EUPL):
- MIT, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD
- Apache-2.0
- CC0-1.0
- LGPL-2.1+ (con limitazioni)
- MPL-2.0

## Riepilogo licenze (tutte le dipendenze)

| Licenza | Conteggio |
|---------|-----------|
| MIT | 457 |
| Apache-2.0 | 53 |
| ISC | 13 |
| BSD-2-Clause | 10 |
| BSD-3-Clause | 8 |
| MPL-2.0 | 4 |
| MIT-0 | 3 |
| LGPL-3.0-or-later | 2 |
| Apache-2.0 AND MIT | 2 |
| CC0-1.0 | 2 |
| BlueOak-1.0.0 | 2 |
| Python-2.0 | 1 |
| CC-BY-4.0 | 1 |
| 0BSD | 1 |

## Dipendenze dirette di produzione

| Pacchetto | Versione | Licenza | Compatibile EUPL | Repository |
|-----------|----------|---------|-------------------|------------|
| @fullcalendar/core | 6.1.20 | MIT | ✅ | https://github.com/fullcalendar/fullcalendar |
| @fullcalendar/daygrid | 6.1.20 | MIT | ✅ | https://github.com/fullcalendar/fullcalendar |
| @fullcalendar/interaction | 6.1.20 | MIT | ✅ | https://github.com/fullcalendar/fullcalendar |
| @fullcalendar/list | 6.1.20 | MIT | ✅ | https://github.com/fullcalendar/fullcalendar |
| @fullcalendar/multimonth | 6.1.20 | MIT | ✅ | https://github.com/fullcalendar/fullcalendar |
| @fullcalendar/react | 6.1.20 | MIT | ✅ | https://github.com/fullcalendar/fullcalendar |
| @fullcalendar/timegrid | 6.1.20 | MIT | ✅ | https://github.com/fullcalendar/fullcalendar |
| @prisma/client | 6.19.2 | Apache-2.0 | ✅ | https://github.com/prisma/prisma |
| @splidejs/splide | 4.1.4 | MIT | ✅ | https://github.com/Splidejs/splide |
| bootstrap-italia | 2.18.0 | BSD-3-Clause | ✅ | https://github.com/italia/bootstrap-italia |
| date-fns | 4.1.0 | MIT | ✅ | https://github.com/date-fns/date-fns |
| design-react-kit | 5.10.0 | BSD-3-Clause | ✅ | https://github.com/italia/design-react-kit |
| ical-generator | 8.1.1 | MIT | ✅ | https://github.com/sebbo2002/ical-generator |
| jose | 6.2.2 | MIT | ✅ | https://github.com/panva/jose |
| nanoid | 5.1.7 | MIT | ✅ | https://github.com/ai/nanoid |
| next | 15.5.14 | MIT | ✅ | https://github.com/vercel/next.js |
| next-intl | 4.8.3 | MIT | ✅ | https://github.com/amannn/next-intl |
| nodemailer | 7.0.13 | MIT-0 | ✅ | https://github.com/nodemailer/nodemailer |
| prom-client | 15.1.3 | Apache-2.0 | ✅ | https://github.com/siimon/prom-client |
| react | 19.2.4 | MIT | ✅ | https://github.com/facebook/react |
| react-dom | 19.2.4 | MIT | ✅ | https://github.com/facebook/react |
| swr | 2.4.1 | MIT | ✅ | https://github.com/vercel/swr |
| zod | 3.25.76 | MIT | ✅ | https://github.com/colinhacks/zod |

## Dipendenze con licenze da verificare

| Pacchetto | Versione | Licenza | Note |
|-----------|----------|---------|------|
| @img/sharp-libvips-linux-x64 | 1.2.4 | LGPL-3.0-or-later | ⚠️ Dipendenza transitiva di `sharp` (image processing di Next.js). Libreria C usata come shared library — linking dinamico compatibile con EUPL. |
| @img/sharp-libvips-linuxmusl-x64 | 1.2.4 | LGPL-3.0-or-later | ⚠️ Come sopra, variante musl per Alpine Linux. |
| axe-core | 4.11.1 | MPL-2.0 | ⚠️ Dipendenza di dev (accessibility testing). MPL-2.0 è compatibile con EUPL-1.2 (Art. 5). |
| lightningcss | 1.32.0 | MPL-2.0 | ⚠️ CSS minifier usato da Next.js. MPL-2.0 è compatibile con EUPL-1.2 (Art. 5). |
| lightningcss-linux-x64-gnu | 1.32.0 | MPL-2.0 | ⚠️ Binario nativo, stessa licenza. |
| lightningcss-linux-x64-musl | 1.32.0 | MPL-2.0 | ⚠️ Binario nativo, stessa licenza. |

**Nessuna dipendenza con licenza incompatibile (GPL-2.0-only, GPL-3.0-only, AGPL-3.0, SSPL) è stata rilevata.**

### Valutazione LGPL-3.0-or-later (sharp-libvips)

Le librerie `@img/sharp-libvips-*` sono binding nativi per la libreria C `libvips`, utilizzati da `sharp` che è a sua volta una dipendenza di `next` per l'ottimizzazione delle immagini. La LGPL-3.0 consente l'uso in software proprietario e con licenze copyleft deboli (come EUPL) a condizione che la libreria LGPL sia usata come shared library (linking dinamico). Questo è il caso: `sharp` carica `libvips` come libreria condivisa tramite binding nativi precompilati. **Compatibilità confermata.**

### Valutazione MPL-2.0 (lightningcss, axe-core)

La MPL-2.0 è esplicitamente elencata come licenza compatibile nell'Art. 5 della EUPL-1.2. **Compatibilità confermata.**

## Componenti infrastrutturali

| Componente | Licenza | Note |
|------------|---------|------|
| Jitsi Meet | Apache-2.0 | ✅ Motore video |
| Prosody | MIT | ✅ Server XMPP |
| PostgreSQL | PostgreSQL License (BSD-like) | ✅ Database |
| Node.js | MIT | ✅ Runtime |
| Alpine Linux | GPL-2.0 (OS, non linked) | ✅ Base image |

## Aggiornamento

Questo file viene aggiornato ad ogni release. Per rigenerare:

```bash
cd eventi-dtd && npx license-checker --summary
cd eventi-dtd && npx license-checker --json --out license-report.json
```

## CI

La pipeline CI include un check automatico che verifica che nessuna nuova dipendenza abbia una licenza incompatibile con EUPL-1.2. Vedi `.github/workflows/ci.yml`, job `license-check`.
