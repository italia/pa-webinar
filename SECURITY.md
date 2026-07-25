# Security Policy / Politica di sicurezza

## Italiano

### Versioni supportate

Riceve correzioni di sicurezza l'ultima versione minore rilasciata.

| Versione | Supportata |
| -------- | ---------- |
| 0.8.x    | Sì         |
| < 0.8    | No         |

### Segnalare una vulnerabilità

Se hai trovato una vulnerabilità di sicurezza in questo progetto, **non aprire una issue pubblica**.

Usa la segnalazione privata di GitHub: apri la scheda **Security** del repository e seleziona **"Report a vulnerability"** (Private Vulnerability Reporting). La segnalazione resta visibile solo ai manutentori.

Includi nella segnalazione:
- Descrizione della vulnerabilità
- Passi per riprodurla
- Possibile impatto
- Suggerimento per la correzione (se possibile)

Ci impegniamo a:
- Confermare la ricezione entro 3 giorni lavorativi
- Fornire una valutazione iniziale entro 10 giorni lavorativi
- Mantenere riservata la segnalazione fino alla pubblicazione della correzione

---

## English

### Supported versions

The latest released minor version receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.8.x   | Yes       |
| < 0.8   | No        |

### Reporting a vulnerability

If you have found a security vulnerability in this project, **do not open a public issue**.

Use GitHub private reporting: open the repository's **Security** tab and choose **"Report a vulnerability"** (Private Vulnerability Reporting). The report stays visible only to the maintainers.

Include in your report:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if possible)

We commit to:
- Acknowledge receipt within 3 business days
- Provide an initial assessment within 10 business days
- Keep the report confidential until a fix is published

---

## Supply chain e CI / Supply chain and CI

Scelte in vigore, verificabili nei workflow di questo repository.

**Le pull request non girano nell'infrastruttura di produzione.** La CI usa
runner self-hosted dentro il cluster solo per gli eventi fidati (push, tag,
dispatch); le PR — comprese quelle da fork — girano su runner GitHub-hosted
effimeri (`runs-on` condizionale in `.github/workflows/ci.yml`). Inoltre ogni PR
da un contributor esterno richiede l'approvazione di un manutentore prima di
eseguire qualunque workflow.

**Action bloccate a un commit.** Tutte le GitHub Action di terze parti sono
referenziate per SHA completo (non per tag mobile), con il tag in commento;
Dependabot aggiorna SHA e commento insieme.

**Dipendenze.** `.github/dependabot.yml` copre npm (app, radice, recorder,
recorder-controller), pip (worker AI), immagini Docker e GitHub Actions. Gli
aggiornamenti *major* delle dipendenze di runtime sono esclusi dagli update di
routine — si fanno come upgrade dedicati — ma questo **non** silenzia gli avvisi
di sicurezza: per una CVE Dependabot apre comunque la pull request.

**Scanner attivi.** Trivy su filesystem e immagine (`ci.yml`, blocca su
CRITICAL/HIGH), CodeQL (`codeql.yml`), OpenSSF Scorecard (`scorecard.yml`).

**SBOM.** Ogni release pubblica un SBOM SPDX come asset della GitHub Release; è
consultabile anche dall'interno dell'applicazione, dalla pagina `/changelog`.

**Segreti.** Nel repository non ci sono credenziali: in produzione arrivano da
External Secrets Operator + Azure Key Vault. I valori nei file di esempio sono
fittizi e la cifratura dei dati personali li **rifiuta** in produzione
(`app/src/lib/crypto/pii.ts`).
