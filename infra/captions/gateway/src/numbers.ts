/**
 * I numeri in cifre, per l'italiano.
 *
 * Il modello scrive i numeri in lettere ("duemilaventisei") e il motore non
 * ha una normalizzazione inversa per l'italiano. Qui si riscrivono con le
 * convenzioni dei sottotitoli: in lettere fino a dieci, in cifre da undici in
 * su; sempre in cifre nelle percentuali, nei decimali, nei giorni del mese e
 * nelle ore. È deterministico e lavora solo su parole che sono numeri: tutto
 * il resto passa com'è.
 *
 * Restano in lettere, apposta:
 * - «mille» da solo («mille grazie»); con un numero dopo diventa cifre;
 * - «un» e «una», che sono quasi sempre articoli («un ottobre difficile»);
 *   diventano 1 solo davanti a «per cento»;
 * - un numero fino a dieci dopo «alle», «dalle», «sono le» o «ore» quando
 *   nulla dice che è un'ora: «alle tre colleghe» resta, «alle tre e mezza» diventa
 *   «alle 3 e mezza», «alle tre.» diventa «alle 3.»;
 * - una parola con la maiuscola a metà frase, che è un nome (un cognome come
 *   Trenta);
 * - i numeri detti cifra per cifra (un telefono, un codice), che sono tutti
 *   sotto il dieci;
 * - le frazioni e i multipli in parola («e mezza», «un quarto», «milioni»):
 *   «venti milioni» diventa «20 milioni».
 *
 * Le regole leggono parole, non significati: «venti» è sempre 20, anche
 * quando sono i venti che soffiano; un numero tondo seguito da uno più
 * piccolo diventa uno solo («duemila e venti persone» → «2020 persone»); dopo
 * un'ora, «e» e un numero sono i minuti («alle sei e trenta persone» →
 * «alle 6:30 persone»); in un intervallo di percentuali solo l'ultimo numero
 * diventa percentuale («tra il tre e il cinque per cento» → «tra il tre e il
 * 5%»).
 */

const UNITS = [
  'zero',
  'uno',
  'due',
  'tre',
  'quattro',
  'cinque',
  'sei',
  'sette',
  'otto',
  'nove',
];
const TEENS = [
  'dieci',
  'undici',
  'dodici',
  'tredici',
  'quattordici',
  'quindici',
  'sedici',
  'diciassette',
  'diciotto',
  'diciannove',
];
const TENS = [
  'venti',
  'trenta',
  'quaranta',
  'cinquanta',
  'sessanta',
  'settanta',
  'ottanta',
  'novanta',
];
const MONTHS = new Set([
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
]);
/**
 * Le parole prima di un'ora: «alle dieci», «dalle nove», «ore quindici»,
 * «sono le tre». «le» da solo no: «tra le due e tre settimane» non è un'ora.
 * Le usano sia le ore in parola sia quelle già in cifre (DIGIT_TIME).
 */
const HOUR_INTRO = ['alle', 'dalle', 'ore', 'sono le'];
/** Dopo «di», «del» o «della»: «alle tre del pomeriggio». */
const DAY_PARTS = new Set(['mattina', 'mattino', 'pomeriggio', 'sera', 'notte']);

/** Le forme di un numero sotto il cento, senza accenti («ventitre» per «ventitré»). */
function below100(n: number): string[] {
  if (n < 10) return [UNITS[n]!];
  if (n < 20) return [TEENS[n - 10]!];
  const tens = TENS[Math.floor(n / 10) - 2]!;
  const unit = n % 10;
  if (unit === 0) return [tens];
  // La vocale finale cade davanti a «uno» e «otto»: ventuno, trentotto.
  const cut = tens.slice(0, -1);
  if (unit === 1) return [`${cut}uno`, `${cut}un`, `${cut}una`];
  if (unit === 8) return [`${cut}otto`];
  return [tens + UNITS[unit]!];
}

function below1000(n: number): string[] {
  if (n < 100) return below100(n);
  const hundreds = Math.floor(n / 100);
  const prefix = hundreds === 1 ? 'cento' : `${UNITS[hundreds]!}cento`;
  const rest = n % 100;
  if (rest === 0) return [prefix];
  const forms: string[] = [];
  for (const word of below100(rest)) {
    forms.push(prefix + word);
    // «centotto», «centottanta» accanto a «centootto».
    if (word.startsWith('o')) forms.push(prefix.slice(0, -1) + word);
  }
  return forms;
}

const LEXICON: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>([
    ['un', 1],
    ['una', 1],
  ]);
  for (let n = 0; n < 1000; n++) for (const word of below1000(n)) map.set(word, n);
  return map;
})();

/** «un» e «una» sono numeri solo accanto a «per cento»: altrove sono articoli. */
function isArticle(folded: string): boolean {
  return folded === 'un' || folded === 'una';
}

function fold(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Il valore di una parola che è un numero intero sotto il milione, o null. */
export function parseNumberWord(word: string): number | null {
  const w = fold(word);
  const direct = LEXICON.get(w);
  if (direct !== undefined) return direct;
  const rest = (from: string): number | null => {
    if (from === '') return 0;
    const value = LEXICON.get(from);
    return value === undefined || value === 0 ? null : value;
  };
  if (w.startsWith('mille')) {
    const r = rest(w.slice(5));
    return r === null ? null : 1000 + r;
  }
  const at = w.indexOf('mila');
  if (at > 0) {
    const thousands = LEXICON.get(w.slice(0, at));
    const r = rest(w.slice(at + 4));
    if (thousands !== undefined && thousands >= 2 && r !== null)
      return thousands * 1000 + r;
  }
  return null;
}

/** Le cifre all'italiana: il separatore delle migliaia da 10.000 in su, come gli anni restano 2026. */
function digits(n: number): string {
  const plain = String(n);
  return n < 10_000 ? plain : plain.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

interface Word {
  raw: string;
  folded: string;
  start: number;
  end: number;
}

export function numbersToDigits(text: string): string {
  const words: Word[] = [...text.matchAll(/\p{L}+/gu)].map((m) => ({
    raw: m[0],
    folded: fold(m[0]),
    start: m.index,
    end: m.index + m[0].length,
  }));
  if (words.length === 0) return text;

  /** La parola `i + 1` segue la `i` separata solo da spazi. */
  const joined = (i: number): boolean =>
    i + 1 < words.length && /^\s+$/.test(text.slice(words[i]!.end, words[i + 1]!.start));
  const next = (i: number): string | null => (joined(i) ? words[i + 1]!.folded : null);
  /** Dopo la parola `i` viene la congiunzione «e»: sul testo vero, perché «è» senza accento sarebbe lo stesso. */
  const andAfter = (i: number): boolean =>
    joined(i) && words[i + 1]!.raw.toLowerCase() === 'e';
  /** Il testo subito dopo la parola `i`. */
  const after = (i: number): string => text.slice(words[i]!.end);
  /** Maiuscola a metà frase: un nome, non un numero. */
  const isName = (i: number): boolean => {
    if (!/^\p{Lu}/u.test(words[i]!.raw) || i === 0) return false;
    return !/[.!?…]\s*$/.test(text.slice(words[i - 1]!.end, words[i]!.start));
  };
  const numberAt = (i: number): number | null =>
    i < words.length && !isName(i) ? parseNumberWord(words[i]!.raw) : null;
  /** Prima della parola `i` ci sono le parole che introducono un'ora. */
  const afterHourIntro = (i: number): boolean =>
    HOUR_INTRO.some((intro) => {
      const parts = intro.split(' ');
      const from = i - parts.length;
      return (
        from >= 0 &&
        parts.every((part, k) => words[from + k]!.folded === part && joined(from + k))
      );
    });
  /** Un numero vero, non un articolo. */
  const countAt = (i: number): number | null =>
    i < words.length && isArticle(words[i]!.folded) ? null : numberAt(i);
  /** Dopo la parola `i` vengono una durata o una percentuale: non sono minuti di un'ora. */
  const durationAfter = (i: number): boolean => {
    const n = next(i);
    return (
      (n !== null &&
        (n.startsWith('minut') || n.startsWith('second') || n === 'percento')) ||
      (n === 'per' && next(i + 1) === 'cento') ||
      /^\s*%/.test(after(i))
    );
  };
  /** I minuti dopo «e», in parola: «alle dieci e trenta». */
  const minutesAt = (i: number): number | null => {
    const m = countAt(i);
    return m !== null && m >= 1 && m <= 59 && !durationAfter(i) ? m : null;
  };
  /** Ciò che dice che il numero `end` è un'ora e non una quantità. */
  const looksLikeTime = (i: number, end: number): boolean => {
    const n = next(end);
    if (andAfter(end)) {
      const m = next(end + 1);
      if (m === 'mezza' || m === 'mezzo' || (m === 'un' && next(end + 2) === 'quarto'))
        return true;
      if (joined(end + 1) && minutesAt(end + 2) !== null) return true;
      return /^\s+e\s+\d{1,2}(?![\d.,%])/u.test(after(end));
    }
    if (n === 'meno') return true;
    if (n === 'in' && next(end + 1) === 'punto') return true;
    if (
      (n === 'di' || n === 'del' || n === 'della') &&
      DAY_PARTS.has(next(end + 1) ?? '')
    )
      return true;
    if (words[i - 1]!.folded === 'dalle' && (n === 'alle' || n === 'fino')) return true;
    // Fine della frase o dell'inciso: «ci vediamo alle tre.». Non la fine del
    // testo: un provvisorio che finisce con «alle tre» può continuare con
    // «colleghe», e il sottotitolo passerebbe dalle cifre alle lettere.
    return /^\s*[.,;:!?…]/u.test(after(end));
  };

  let out = '';
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    // «per cento» dopo una parola che resta in lettere («alcuni punti per
    // cento») o dopo cifre («30 per cento», lo fa digitPercents): mai 100.
    if (
      words[i]!.folded === 'cento' &&
      i > 0 &&
      words[i - 1]!.folded === 'per' &&
      joined(i - 1)
    )
      continue;
    const first = numberAt(i);
    if (first === null) continue;
    let value = first;
    let end = i;
    const article = isArticle(words[i]!.folded);

    if (!article) {
      // «due mila»: le migliaia staccate.
      if (next(end) === 'mila' && value >= 2 && value < 1000) {
        value *= 1000;
        end += 1;
      }
      // Un numero detto in più parole. Solo dalle centinaia: «venti tre»
      // resta com'è (salvo davanti a un mese, sotto).
      let lastPart = value;
      for (;;) {
        const at =
          andAfter(end) && joined(end + 1) ? end + 2 : joined(end) ? end + 1 : -1;
        const r = at > 0 ? countAt(at) : null;
        if (r === null || r === 0) break;
        const round =
          value >= 1000 && value % 1000 === 0
            ? 1000
            : value >= 100 && value % 100 === 0
              ? 100
              : 0;
        if (round > 0 && r < round) {
          // «duemila ventisei», «mille e cinquecento», «cento venti»: un numero
          // tondo, poi uno più piccolo dei suoi zeri finali.
          value += r;
        } else if (
          value >= 100 &&
          value < 1000 &&
          value % 100 === 0 &&
          r % 1000 === 0 &&
          r / 1000 < 100
        ) {
          // «duecento cinquantamila»: centinaia, poi migliaia sotto le cento.
          value = (value + r / 1000) * 1000;
        } else if (
          value >= 100 &&
          at === end + 1 &&
          lastPart >= 20 &&
          lastPart < 100 &&
          lastPart % 10 === 0 &&
          r < 10
        ) {
          // «trecento quaranta cinque»: dopo le decine, l'unità staccata.
          value += r;
        } else {
          break;
        }
        lastPart = r;
        end = at;
      }
      // «il venti sei ottobre»: decine e unità staccate davanti a un mese.
      if (end === i && (value === 20 || value === 30) && joined(end)) {
        const unit = countAt(end + 1);
        if (
          unit !== null &&
          unit >= 1 &&
          value + unit <= 31 &&
          MONTHS.has(next(end + 1) ?? '')
        ) {
          value += unit;
          end += 1;
        }
      }
    }
    const alone = end === i;

    // «tre virgola cinque», «tre virgola quattordici», «zero virgola zero due».
    let decimals: string | null = null;
    if (!article && next(end) === 'virgola' && joined(end + 1)) {
      const from = end + 2;
      const first = countAt(from);
      if (first !== null && first <= 9) {
        // Una cifra dopo l'altra: «virgola uno cinque» è 15, non 1 e poi 5.
        let ds = '';
        let last = -1;
        for (let k = from; k < words.length; k++) {
          if (k > from && !joined(k - 1)) break;
          const d = countAt(k);
          if (d === null || d > 9) break;
          ds += String(d);
          last = k;
        }
        decimals = ds;
        end = last;
      } else if (first !== null) {
        decimals = String(first);
        end = from;
      }
    }
    let rendered = digits(value) + (decimals === null ? '' : `,${decimals}`);

    let use = !article && value >= 11 && !(alone && words[i]!.folded === 'mille');
    if (decimals !== null) use = true;
    // «cinque per cento», «tre virgola due percento», «un per cento».
    if (next(end) === 'percento') {
      rendered += '%';
      end += 1;
      use = true;
    } else if (next(end) === 'per' && next(end + 1) === 'cento') {
      rendered += '%';
      end += 2;
      use = true;
    } else if (article || decimals !== null) {
      // Un articolo non è un giorno né un'ora; un decimale nemmeno.
    } else if (value >= 1 && value <= 31 && MONTHS.has(next(end) ?? '')) {
      use = true;
    } else if (value <= 24 && afterHourIntro(i)) {
      // Fino a dieci serve un segno che sia un'ora; da undici le cifre ci sono comunque.
      if (value >= 11 || looksLikeTime(i, end)) {
        use = true;
        // «alle dieci e trenta» → «alle 10:30»; «e mezza» e «e un quarto» restano.
        if (andAfter(end) && joined(end + 1)) {
          const minutes = minutesAt(end + 2);
          if (minutes !== null) {
            rendered += `:${String(minutes).padStart(2, '0')}`;
            end += 2;
          }
        }
      }
    }
    if (!use) continue;

    out += text.slice(cursor, words[i]!.start) + rendered;
    cursor = words[end]!.end;
    i = end;
  }
  return digitPercents(digitTimes(out + text.slice(cursor)));
}

/** «30 per cento» quando il modello ha scritto il numero in cifre. */
function digitPercents(text: string): string {
  return text.replace(/(\d)\s+(?:per\s+cento|percento)(?![\p{L}\p{N}])/giu, '$1%');
}

/**
 * Le ore che il modello scrive già in cifre, o che lo sono diventate qui solo
 * a metà: «alle 10 e 30» → «alle 10:30». Non se dopo vengono minuti o una
 * percentuale («alle 3 e 20 minuti» è una durata).
 */
const DIGIT_TIME = new RegExp(
  `(?<![\\p{L}\\p{N}])((?:${HOUR_INTRO.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\s+)` +
    `(\\d{1,2})\\s+e\\s+(\\d{1,2})(?![\\p{L}\\p{N}:%]|[.,]\\d|\\s+(?:minut|second|per\\s+cento|percento|%))`,
  'giu'
);

function digitTimes(text: string): string {
  return text.replace(DIGIT_TIME, (all, before: string, h: string, m: string) => {
    const hour = Number(h);
    const minutes = Number(m);
    return hour <= 24 && minutes >= 1 && minutes <= 59
      ? `${before}${hour}:${String(minutes).padStart(2, '0')}`
      : all;
  });
}
