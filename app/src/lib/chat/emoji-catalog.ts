/**
 * Le emoji del selettore della chat, con le parole per cercarle.
 *
 * Un elenco scelto a mano invece di una libreria: nessuna dipendenza in più,
 * nessun file da scaricare a ogni apertura della sala, e solo emoji adatte a
 * una riunione di lavoro. Le parole di ricerca sono in italiano e in inglese:
 * coprono la lingua predefinita dell'istanza e quella che quasi tutti usano
 * per cercare un'emoji.
 */

export interface EmojiEntry {
  emoji: string;
  /** Parole di ricerca, minuscole, separate da spazi. */
  keywords: string;
}

const E = (emoji: string, keywords: string): EmojiEntry => ({ emoji, keywords });

export const EMOJI_CATALOG: readonly EmojiEntry[] = [
  // Facce
  E('😀', 'sorriso felice contento smile happy grin'),
  E('😃', 'sorriso felice gioia smile happy'),
  E('😄', 'risata sorriso felice laugh smile'),
  E('😁', 'sorriso denti grin beaming'),
  E('😅', 'sudore sollievo risata sweat relief'),
  E('😂', 'lacrime risata ridere joy tears laugh lol'),
  E('🤣', 'rotolare ridere rofl laugh'),
  E('🙂', 'sorriso leggero slight smile'),
  E('😉', 'occhiolino wink'),
  E('😊', 'sorriso arrossito blush smile'),
  E('😇', 'angelo innocente angel innocent'),
  E('🥰', 'amore cuori affetto love hearts'),
  E('😍', 'occhi cuore amore heart eyes love'),
  E('🤩', 'stelle entusiasta wow star struck'),
  E('😎', 'occhiali sole cool sunglasses'),
  E('🤓', 'nerd secchione occhiali geek'),
  E('🧐', 'monocolo esaminare monocle curious'),
  E('🤔', 'pensare dubbio thinking hmm'),
  E('🤨', 'sopracciglio scettico raised eyebrow skeptical'),
  E('😐', 'neutro neutral'),
  E('😶', 'senza parole silenzio speechless'),
  E('🙄', 'occhi al cielo roll eyes'),
  E('😏', 'ammiccante smirk'),
  E('😬', 'smorfia imbarazzo grimace awkward'),
  E('😌', 'sollevato sereno relieved calm'),
  E('😴', 'sonno dormire sleep tired'),
  E('🥱', 'sbadiglio stanco yawn tired'),
  E('😷', 'mascherina malato mask sick'),
  E('🤯', 'mente esplosa sorpresa mind blown'),
  E('🥳', 'festa party celebrazione celebrate'),
  E('😮', 'sorpresa stupore wow surprised open mouth'),
  E('😲', 'stupito sbalordito astonished'),
  E('😳', 'imbarazzato arrossito flushed embarrassed'),
  E('🥺', 'supplica occhioni pleading'),
  E('😢', 'triste lacrima piangere sad cry tear'),
  E('😭', 'pianto disperato sob crying'),
  E('😤', 'sbuffo determinato huff triumph'),
  E('😠', 'arrabbiato angry'),
  E('😱', 'paura urlo scream fear'),
  E('🤗', 'abbraccio hug'),
  E('🤭', 'mano bocca risatina oops giggle'),
  E('🤫', 'silenzio zitto shush quiet'),
  E('🤐', 'bocca cucita segreto zipper secret'),
  E('😵', 'confuso stordito dizzy'),
  E('🙃', 'sottosopra ironia upside down'),
  // Mani e persone
  E('👍', 'pollice su ok bene approvo thumbs up like yes'),
  E('👎', 'pollice giu no non approvo thumbs down dislike'),
  E('👏', 'applauso bravo clap applause'),
  E('🙌', 'mani alzate evviva hooray raise hands'),
  E('👐', 'mani aperte open hands'),
  E('🤝', 'stretta di mano accordo handshake deal'),
  E('🙏', 'grazie preghiera per favore thanks please pray'),
  E('👋', 'ciao saluto mano wave hello bye'),
  E('✋', 'mano alzata stop raise hand'),
  E('🤚', 'dorso mano raised back hand'),
  E('🖐️', 'mano aperta cinque hand five'),
  E('👌', 'ok perfetto ok hand perfect'),
  E('🤌', 'ma che vuoi pizzico pinched fingers italian'),
  E('✌️', 'vittoria pace victory peace'),
  E('🤞', 'dita incrociate speranza fingers crossed luck'),
  E('🤟', 'ti voglio bene love you'),
  E('👉', 'indicare destra point right'),
  E('👈', 'indicare sinistra point left'),
  E('👆', 'indicare su point up'),
  E('👇', 'indicare giu point down'),
  E('☝️', 'indice attenzione index up'),
  E('✍️', 'scrivere nota writing'),
  E('💪', 'forza muscolo strong muscle'),
  E('🫡', 'saluto rispetto salute'),
  E('🫶', 'cuore mani heart hands'),
  E('👀', 'occhi guardare eyes look'),
  E('🧠', 'cervello idea brain'),
  E('🗣️', 'parlare voce speaking'),
  E('👤', 'persona utente person user'),
  E('👥', 'persone gruppo people group'),
  E('🙋', 'domanda mano alzata question raise hand'),
  E('🙆', 'ok gesto ok gesture'),
  E('🤷', 'non so boh shrug'),
  E('🤦', 'facepalm che disastro'),
  E('🧑‍💻', 'tecnico computer sviluppatore developer technologist'),
  E('🧑‍🏫', 'insegnante docente teacher'),
  E('🧑‍💼', 'ufficio lavoratore office worker'),
  // Cuori e simboli
  E('❤️', 'cuore rosso amore heart love red'),
  E('🧡', 'cuore arancione heart orange'),
  E('💛', 'cuore giallo heart yellow'),
  E('💚', 'cuore verde heart green'),
  E('💙', 'cuore blu heart blue'),
  E('💜', 'cuore viola heart purple'),
  E('🤍', 'cuore bianco heart white'),
  E('💯', 'cento perfetto hundred perfect'),
  E('✅', 'fatto spunta completato check done yes'),
  E('☑️', 'casella spuntata checkbox'),
  E('✔️', 'spunta check'),
  E('❌', 'croce no sbagliato cross wrong'),
  E('❗', 'esclamativo importante exclamation important'),
  E('❓', 'domanda punto interrogativo question'),
  E('⚠️', 'attenzione avviso warning'),
  E('🚫', 'vietato divieto forbidden'),
  E('⭐', 'stella preferito star favorite'),
  E('🌟', 'stella brillante glowing star'),
  E('✨', 'scintille magia sparkles'),
  E('🔥', 'fuoco forte top fire hot lit'),
  E('⚡', 'fulmine veloce energia lightning fast'),
  E('💡', 'idea lampadina idea bulb'),
  E('🎯', 'obiettivo centro target goal'),
  E('🏆', 'trofeo vittoria trophy win'),
  E('🥇', 'medaglia oro primo gold medal first'),
  E('🎉', 'festa coriandoli tada party congratulations'),
  E('🎊', 'coriandoli festa confetti'),
  E('🎈', 'palloncino balloon'),
  E('🎁', 'regalo gift present'),
  E('🔔', 'campanella notifica bell'),
  E('📣', 'megafono annuncio megaphone announcement'),
  E('📢', 'altoparlante annuncio loudspeaker'),
  E('💬', 'fumetto chat messaggio speech bubble'),
  E('💭', 'pensiero thought bubble'),
  E('🆗', 'ok'),
  E('🆕', 'nuovo new'),
  E('ℹ️', 'informazione info'),
  E('➡️', 'freccia destra avanti arrow right next'),
  E('⬅️', 'freccia sinistra indietro arrow left back'),
  E('⬆️', 'freccia su arrow up'),
  E('⬇️', 'freccia giu arrow down'),
  E('🔁', 'ripeti repeat'),
  E('🔄', 'aggiorna ricarica refresh'),
  E('➕', 'piu aggiungi plus add'),
  E('➖', 'meno minus'),
  // Lavoro e oggetti
  E('📌', 'puntina appunto pin'),
  E('📍', 'luogo posizione location pin'),
  E('📎', 'graffetta allegato paperclip attachment'),
  E('📝', 'nota appunti memo note'),
  E('📄', 'documento pagina document page'),
  E('📑', 'schede documenti bookmark tabs'),
  E('📊', 'grafico barre dati chart bar data'),
  E('📈', 'crescita grafico aumento chart up growth'),
  E('📉', 'calo grafico diminuzione chart down'),
  E('📅', 'calendario data calendar date'),
  E('🗓️', 'calendario agenda calendar'),
  E('⏰', 'sveglia orario alarm clock time'),
  E('⏳', 'clessidra attesa hourglass waiting'),
  E('⌛', 'tempo scaduto hourglass done'),
  E('🕒', 'orologio ora clock'),
  E('💻', 'computer portatile laptop'),
  E('🖥️', 'monitor desktop computer'),
  E('⌨️', 'tastiera keyboard'),
  E('🖱️', 'mouse'),
  E('📱', 'telefono cellulare mobile phone'),
  E('☎️', 'telefono phone'),
  E('🎧', 'cuffie audio headphones'),
  E('🎤', 'microfono parlare microphone mic'),
  E('🔇', 'muto silenzio mute'),
  E('🔊', 'volume audio alto speaker loud'),
  E('📷', 'fotocamera foto camera photo'),
  E('🎥', 'videocamera video camera'),
  E('📺', 'televisione schermo tv screen'),
  E('📶', 'segnale connessione rete signal network'),
  E('🔌', 'spina corrente plug'),
  E('🔋', 'batteria battery'),
  E('🔒', 'lucchetto sicurezza privacy lock security'),
  E('🔑', 'chiave password key'),
  E('🛠️', 'strumenti attrezzi tools'),
  E('⚙️', 'impostazioni ingranaggio settings gear'),
  E('🔍', 'lente cerca search magnifier'),
  E('📚', 'libri studio books'),
  E('📖', 'libro aperto lettura book read'),
  E('🎓', 'laurea formazione graduation education'),
  E('🏛️', 'istituzione pubblica amministrazione building government'),
  E('🏢', 'ufficio edificio office building'),
  E('🇮🇹', 'italia bandiera italy flag'),
  E('🇪🇺', 'europa unione europea bandiera eu europe flag'),
  E('🌍', 'mondo terra europa globe world'),
  E('🚀', 'razzo lancio partenza rocket launch'),
  E('🧩', 'puzzle pezzo soluzione puzzle'),
  E('🤖', 'robot automazione ai robot'),
  E('📦', 'pacco pacchetto rilascio package box'),
  E('🗂️', 'cartelle archivio folders'),
  E('✉️', 'email busta posta envelope mail'),
  E('📧', 'email posta elettronica e-mail'),
  E('🔗', 'link collegamento link chain'),
  // Natura, cibo, pause
  E('☀️', 'sole bel tempo sun sunny'),
  E('🌈', 'arcobaleno rainbow'),
  E('🌱', 'germoglio crescita seedling growth'),
  E('🌿', 'foglie pianta natura herb leaf'),
  E('🌸', 'fiore primavera flower blossom'),
  E('☕', 'caffe pausa coffee break'),
  E('🍵', 'te tea'),
  E('🥐', 'cornetto colazione croissant breakfast'),
  E('🍕', 'pizza'),
  E('🍝', 'pasta spaghetti'),
  E('🍰', 'torta dolce cake'),
  E('🥂', 'brindisi cin cin cheers toast'),
  E('🍀', 'quadrifoglio fortuna clover luck'),
  E('🐢', 'tartaruga lento turtle slow'),
  E('🐝', 'ape lavoro bee'),
  E('🦄', 'unicorno unicorn'),
];

/** Le emoji che corrispondono a tutte le parole cercate (prefissi), in ordine di catalogo. */
export function searchEmoji(query: string, catalog: readonly EmojiEntry[] = EMOJI_CATALOG): EmojiEntry[] {
  const words = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [...catalog];
  return catalog.filter((e) => {
    const kw = e.keywords.split(' ');
    return words.every((w) => kw.some((k) => k.startsWith(w)) || e.emoji === w);
  });
}

/** Chiave del browser per le emoji usate di recente. */
export const RECENT_EMOJI_KEY = 'pa-webinar.chat-emoji-recent';
const RECENT_MAX = 16;

/** Aggiunge un'emoji in testa alle recenti, senza doppioni, fino a 16. */
export function pushRecentEmoji(recent: readonly string[], emoji: string): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
}

/** Legge le recenti salvate; un valore rovinato vale come elenco vuoto. */
export function parseRecentEmoji(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
