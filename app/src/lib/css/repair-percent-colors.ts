/**
 * Rimette la percentuale agli zeri dentro `rgb()`/`rgba()`, DOPO la
 * minificazione del CSS.
 *
 * IL DIFETTO. Sass serializza in percentuali i colori con canali frazionari
 * calcolati dalle funzioni di Bootstrap Italia (schiarite, scurite, mescolanze):
 * `rgb(0%, 35%, 70%)`. È CSS valido. Il minificatore di Next (cssnano-simple)
 * però toglie l'unità agli zeri — lecito per una lunghezza, non qui: dentro
 * `rgb()` storico i tre canali devono essere o tutti numeri o tutte percentuali.
 * Il risultato, `rgb(0,35%,70%)`, è invalido e il browser scarta l'intera
 * dichiarazione.
 *
 * COSA COLPISCE. Ogni colore con un canale a zero, cioè la famiglia del blu
 * istituzionale (canale rosso 0), a partire dallo sfondo della fascia in cima
 * al sito, che senza questa riparazione si vede bianca.
 *
 * PERCHÉ NON SI VINCOLA LA VERSIONE DI SASS. Le percentuali sono la forma in cui
 * Sass serializza i colori con canali frazionari: è output legittimo, ed è il
 * minificatore a trattarlo male. Le versioni precedenti emettevano esadecimali
 * o numeri interi, forme che il minificatore non può rovinare — restare
 * indietro sarebbe solo rimandare.
 *
 * PERCHÉ SI RIPARA QUI E NON PRIMA. Le alternative a monte costano molto di più:
 * inseguire la serializzazione di Sass a ogni aggiornamento, oppure aggiungere
 * un `postcss.config` — che però SOSTITUISCE la configurazione PostCSS di Next
 * invece di estenderla, e replicarla a mano significa perdere la lista di
 * browser che Next passa ad autoprefixer (misurato: 34 prefissi `-webkit-` in
 * meno su tutto il design system). Riparare l'asset dopo la minificazione ha
 * come raggio d'azione le sole dichiarazioni rotte.
 *
 * LA RIPARAZIONE NON PERDE NULLA: `0` e `0%` sono lo stesso valore, quindi si
 * rimette l'unità senza arrotondare né cambiare colore.
 *
 * DUE LIMITI DA SAPERE. Lavora sul testo dell'asset, quindi toccherebbe anche un
 * colore scritto dentro una stringa CSS (`content: "rgb(0,35%,70%)"`): nel
 * progetto non ce ne sono, e il caso non vale il costo di un parser. Ed è
 * agganciata al build webpack — quello che il progetto usa; con turbopack non
 * girerebbe e i colori tornerebbero rotti.
 *
 * QUANDO SI PUÒ CANCELLARE: quando `repaired` resta a zero su un build di
 * produzione, cioè quando la catena di Next non rompe più questi valori.
 */

/**
 * Una chiamata `rgb()`/`rgba()` che non contiene altre parentesi: un valore con
 * `var()` o `calc()` dentro non viene intercettato, ed è giusto — non lo si può
 * riparare senza conoscerne il risultato.
 */
const RGB_CALL = /\brgba?\(([^()]*)\)/gi;

/**
 * Una percentuale semplice. Ammette anche la forma senza zero iniziale
 * (`.4%`): è come il minificatore accorcia i decimali, e non riconoscerla
 * lascerebbe irreparabili proprio le tinte più scure.
 */
const PERCENTAGE = /^(?:\d+(?:\.\d+)?|\.\d+)%$/;

/** Uno zero senza unità: l'unico danno che il minificatore produce. */
const UNITLESS_ZERO = /^0(?:\.0+)?$/;

export interface RepairResult {
  css: string;
  /** Quante chiamate di colore sono state riparate. */
  repaired: number;
}

/**
 * Separa i canali. Accetta le virgole (la forma che esce dal minificatore) e
 * anche spazi e barra della sintassi moderna, per non lasciare scoperto il caso
 * se un domani cambiasse la serializzazione.
 */
function channels(inside: string): string[] {
  return inside.split(/\s*[,/]\s*|\s+/).filter(Boolean);
}

export function repairPercentColors(css: string): RepairResult {
  let repaired = 0;

  const out = css.replace(RGB_CALL, (match, inside: string) => {
    const parts = channels(inside);
    // Tre canali, più l'eventuale alfa.
    if (parts.length < 3 || parts.length > 4) return match;

    const rgb = parts.slice(0, 3);
    const zeros = rgb.filter((channel) => UNITLESS_ZERO.test(channel));
    const percentages = rgb.filter((channel) => PERCENTAGE.test(channel));

    // Si ripara SOLO la forma che sappiamo riconoscere: percentuali più zeri
    // senza unità. Qualsiasi altra forma mista è scritta così nel sorgente, e
    // indovinare cosa intendesse non tocca a noi.
    if (zeros.length === 0 || percentages.length === 0) return match;
    if (zeros.length + percentages.length !== rgb.length) return match;

    repaired += 1;
    const fixed = rgb.map((channel) => (UNITLESS_ZERO.test(channel) ? '0%' : channel));
    // L'alfa non ha questo problema (accetta sia numero sia percentuale): passa
    // come sta.
    const name = match.slice(0, match.indexOf('('));
    return `${name}(${[...fixed, ...parts.slice(3)].join(',')})`;
  });

  return { css: out, repaired };
}
