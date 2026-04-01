# Come contribuire / How to contribute

## Italiano

Grazie per il tuo interesse nel contribuire a **eventi-dtd**!

### Segnalazione bug

Apri una [issue](https://github.com/italia/eventi-dtd/issues) descrivendo:
- Cosa ti aspettavi
- Cosa e successo effettivamente
- Passi per riprodurre il problema
- Versione del browser e sistema operativo

### Proporre una modifica

1. Fai un fork del repository
2. Crea un branch per la tua modifica: `git checkout -b feature/nome-modifica`
3. Assicurati che il codice compili senza errori: `npm run build`
4. Assicurati che il linter non segnali nuovi problemi: `npm run lint`
5. Apri una Pull Request verso il branch `main`

### Requisiti per le Pull Request

- Il codice deve compilare senza errori TypeScript (`npx tsc --noEmit`)
- Le stringhe UI devono essere localizzate in italiano e inglese (file in `app/src/i18n/messages/`)
- I componenti UI devono usare [design-react-kit](https://italia.github.io/design-react-kit/) e seguire le [Linee guida di design](https://designers.italia.it/)
- Le API devono validare l'input con Zod e non esporre dati sensibili nelle risposte

### Stile del codice

- TypeScript strict mode
- ESLint con la configurazione del progetto
- Preferire Server Components dove possibile
- Nomi di variabili e commenti in inglese, stringhe utente in italiano e inglese

### Licenza

Contribuendo a questo progetto, accetti che il tuo contributo sia rilasciato sotto la licenza [EUPL-1.2](LICENSE).

---

## English

Thank you for your interest in contributing to **eventi-dtd**!

### Reporting bugs

Open an [issue](https://github.com/italia/eventi-dtd/issues) describing:
- What you expected
- What actually happened
- Steps to reproduce
- Browser version and operating system

### Proposing a change

1. Fork the repository
2. Create a branch: `git checkout -b feature/change-name`
3. Make sure the code builds without errors: `npm run build`
4. Make sure the linter reports no new issues: `npm run lint`
5. Open a Pull Request against the `main` branch

### Pull Request requirements

- Code must compile without TypeScript errors (`npx tsc --noEmit`)
- UI strings must be localized in Italian and English (`app/src/i18n/messages/`)
- UI components must use [design-react-kit](https://italia.github.io/design-react-kit/) and follow the [Italian design guidelines](https://designers.italia.it/)
- APIs must validate input with Zod and must not expose sensitive data in responses

### Code style

- TypeScript strict mode
- ESLint with the project configuration
- Prefer Server Components where possible
- Variable names and comments in English, user-facing strings in Italian and English

### License

By contributing to this project, you agree that your contribution will be released under the [EUPL-1.2](LICENSE) license.
