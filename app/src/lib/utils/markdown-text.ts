/**
 * Il testo di una descrizione scritta in Markdown, senza la sintassi.
 *
 * Serve dove il testo esce come testo semplice: l'anteprima di un link
 * condiviso (OpenGraph), il `<meta name="description">`, i dati strutturati,
 * il calendario. Li' gli asterischi del grassetto, i cancelletti dei titoli e
 * gli indirizzi dei link si vedrebbero cosi' come sono. Si usa lo stesso
 * lettore della pagina (marked, con gli a capo come nella pagina), cosi' cio'
 * che e' testo per la pagina e' testo anche qui.
 */
import { Lexer, type Token, type Tokens } from 'marked';

/** Fra un blocco (paragrafo, titolo, elenco) e il successivo. */
const BLOCCO = '\u0000';
/** Prima di una voce d'elenco puntato. */
const VOCE = '\u0001';
/** Prima di una voce d'elenco numerato (il numero e' gia' nel testo). */
const VOCE_NUMERATA = '\u0002';
/** Un a capo dentro un paragrafo. */
const A_CAPO = '\u0003';

/** Script, stili e commenti scritti a mano: la pagina non li mostra, e il
 *  lettore li spezzerebbe in tag e testo. Si tolgono prima di leggere. */
function senzaScriptEStili(markdown: string): string {
  return markdown
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

/** Il testo di un pezzo di HTML scritto a mano: niente tag. */
function testoHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

/** `annidato`: dentro una voce d'elenco, dove i blocchi non si separano. */
function testoDi(tokens: readonly Token[], annidato = false): string[] {
  const parti: string[] = [];
  const fineBlocco = () => {
    if (!annidato) parti.push(BLOCCO);
  };
  for (const token of tokens) {
    switch (token.type) {
      case 'space':
      case 'hr':
      case 'def':
        fineBlocco();
        break;
      case 'br':
        parti.push(A_CAPO);
        break;
      case 'html':
        parti.push(testoHtml(token.text));
        break;
      case 'image':
        if (token.text) parti.push(token.text);
        break;
      case 'list': {
        const inizio = typeof token.start === 'number' ? token.start : 1;
        token.items.forEach((voce: Tokens.ListItem, i: number) => {
          parti.push(
            token.ordered ? `${VOCE_NUMERATA}${inizio + i}. ` : VOCE,
            testoDi(voce.tokens, true).join(''),
          );
        });
        fineBlocco();
        break;
      }
      case 'table':
        for (const cella of token.header) parti.push(testoDi(cella.tokens, true).join(''), ' ');
        for (const riga of token.rows) {
          parti.push(VOCE);
          for (const cella of riga) parti.push(testoDi(cella.tokens, true).join(''), ' ');
        }
        fineBlocco();
        break;
      default: {
        const conFigli = token as Token & { tokens?: Token[]; text?: string };
        if (conFigli.tokens && conFigli.tokens.length > 0) {
          parti.push(testoDi(conFigli.tokens, annidato).join(''));
        } else if (typeof conFigli.text === 'string') {
          parti.push(conFigli.text);
        }
        if (['paragraph', 'heading', 'blockquote', 'code'].includes(token.type)) fineBlocco();
      }
    }
  }
  return parti;
}

/** Le entita' piu' comuni in un testo italiano o europeo scritto a mano. */
const ENTITA: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  agrave: 'à', aacute: 'á', egrave: 'è', eacute: 'é', igrave: 'ì', iacute: 'í',
  ograve: 'ò', oacute: 'ó', ugrave: 'ù', uacute: 'ú', Agrave: 'À', Egrave: 'È',
  Eacute: 'É', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù', ccedil: 'ç', ntilde: 'ñ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', hellip: '…', ndash: '–',
  mdash: '—', euro: '€', middot: '·', deg: '°', copy: '©', reg: '®',
};

function decodificaEntita(testo: string): string {
  return testo.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (intera, nome: string) => {
    if (nome.startsWith('#')) {
      const codice = nome[1] === 'x' || nome[1] === 'X' ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return Number.isFinite(codice) && codice > 0 && codice <= 0x10ffff ? String.fromCodePoint(codice) : intera;
    }
    return ENTITA[nome] ?? intera;
  });
}

const spazi = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Una voce d'elenco nella resa per esteso. */
function voce(riga: string): string {
  if (riga.startsWith(VOCE_NUMERATA)) return spazi(riga.slice(1));
  if (riga.startsWith(VOCE)) return `- ${spazi(riga.slice(1))}`;
  return spazi(riga);
}

/**
 * Il testo, su una riga sola (per un'anteprima) o, con `paragrafi`, per
 * esteso: i paragrafi separati da una riga vuota, gli a capo e le voci
 * d'elenco su righe proprie (per il calendario).
 */
export function markdownToPlainText(
  markdown: string | null | undefined,
  { paragrafi = false }: { paragrafi?: boolean } = {},
): string {
  if (!markdown) return '';
  let grezzo: string;
  try {
    const tokens = new Lexer({ gfm: true, breaks: true }).lex(senzaScriptEStili(markdown));
    grezzo = decodificaEntita(testoDi(tokens).join(''));
  } catch {
    // Un testo che il lettore non digerisce resta com'e'.
    return paragrafi ? markdown.trim() : spazi(markdown);
  }
  const blocchi = grezzo.split(BLOCCO);

  if (!paragrafi) {
    // Su una riga: le voci d'elenco separate da virgole, e un punto fra un
    // blocco e l'altro quando manca (un titolo seguito dal suo paragrafo).
    const righe = blocchi
      .map((blocco) => {
        const [testa = '', ...voci] = blocco
          .replaceAll(A_CAPO, ' ')
          .split(/[\u0001\u0002]/)
          .map(spazi);
        return [testa, voci.filter((v) => v !== '').join(', ')].filter((p) => p !== '').join(' ');
      })
      .filter((blocco) => blocco !== '');
    return righe
      .map((blocco, i) => (i < righe.length - 1 && !/[.!?:;…]$/.test(blocco) ? `${blocco}.` : blocco))
      .join(' ');
  }

  return blocchi
    .map((blocco) =>
      blocco
        .replace(/(?=[\u0001\u0002])/g, A_CAPO)
        .split(A_CAPO)
        .map(voce)
        .filter((riga) => riga !== '' && riga !== '-')
        .join('\n'),
    )
    .filter((blocco) => blocco !== '')
    .join('\n\n');
}
