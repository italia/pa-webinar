# Documentazione — PA Webinar

Indice dei documenti. Se stai arrivando ora, parti dal
[README del progetto](../README.md); qui c'è il dettaglio.

## Iniziare

| Documento | A cosa serve |
|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Ambiente locale, database, test, risoluzione problemi |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Flusso di contribuzione, convenzioni, controlli richiesti |
| [CONTRIBUTING-QUALITY.md](CONTRIBUTING-QUALITY.md) | Standard di qualità e cosa verifica la CI |

## Capire il sistema

| Documento | A cosa serve |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Progetto del sistema, modello dati, superficie API |
| [adr/](adr/) | Decisioni architetturali registrate |
| [ROADMAP.md](ROADMAP.md) | Cosa è stato rilasciato e cosa è pianificato |
| [../CHANGELOG.md](../CHANGELOG.md) | Storico dei rilasci |

## Installare e gestire

| Documento | A cosa serve |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Installazione con Helm (semplice / standard / completa), provider cloud |
| [CONFIGURATION.md](CONFIGURATION.md) | Variabili d'ambiente e impostazioni runtime |
| [POSTPROD.md](POSTPROD.md) | Pipeline di post-produzione (trascrizione, sottotitoli, doppiaggio) |
| [LOAD-TESTING.md](LOAD-TESTING.md) | Prove di carico |

## Conformità e sicurezza

| Documento | A cosa serve |
|---|---|
| [GDPR.md](GDPR.md) | Trattamenti, conservazione, diritti dell'interessato |
| [../SECURITY.md](../SECURITY.md) | Come segnalare una vulnerabilità, postura di sicurezza e supply chain |
| [SECURITY-CSP.md](SECURITY-CSP.md) | Content Security Policy |
| [SERVICE-INVENTORY.md](SERVICE-INVENTORY.md) | Inventario dei servizi pubblicato in `/service-inventory` |
| [SERVICE-INVENTORY-GENERATION.md](SERVICE-INVENTORY-GENERATION.md) | Come si genera e si tiene aggiornato quell'inventario |

## Riusare il software

Il progetto è rilasciato con licenza EUPL-1.2 ed è descritto in
[`publiccode.yml`](../publiccode.yml) secondo lo standard per il riuso nella PA.
Per installarlo nella tua amministrazione parti da
[DEPLOYMENT.md](DEPLOYMENT.md): il chart Helm prevede tre modalità, dalla demo
tutta in-cluster fino all'installazione con database gestito e registrazione.
