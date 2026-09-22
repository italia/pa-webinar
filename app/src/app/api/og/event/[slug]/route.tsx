/**
 * Scheda di anteprima per i link condivisi (OpenGraph).
 *
 * PERCHE' GENERARLA: finora un link a un evento mostrava la locandina cosi'
 * com'e', o il logo del sito quando la locandina non c'era. Chi riceve il link
 * in chat vede quindi un'immagine muta: niente titolo leggibile, niente data,
 * niente di chi parla. La scheda mette quelle informazioni DENTRO l'immagine,
 * che e' l'unica cosa che molte applicazioni mostrano davvero.
 *
 * COSA ENTRARCI lo decide l'amministrazione (`SiteSetting.og*`): cambia da ente
 * a ente, e un'anteprima con un campo sempre vuoto e' peggio che senza.
 *
 * E' una rotta e non il file convenzionale `opengraph-image`, perche' la pagina
 * evento dichiara gia' il proprio blocco `openGraph` e Next non lo fonde: la
 * pagina deve poter scegliere fra questa scheda e l'immagine grezza a seconda
 * dell'impostazione, e per farlo le serve un indirizzo da nominare.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ImageResponse } from 'next/og';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { appBaseUrl } from '@/lib/env';
import { NotFoundError, RateLimitError } from '@/lib/errors';
import { isEventPageVisible } from '@/lib/events/visibility';
import { contenutoScheda, origineLocandina } from '@/lib/og-card';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { getSettings } from '@/lib/settings';
import { locales, defaultLocale } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LARGHEZZA = 1200;
const ALTEZZA = 630;

/** Titillium Web arriva dal pacchetto del design system, gia' fra le
 *  dipendenze: il generatore di immagini non legge i woff2 che il sito serve
 *  al browser, e duplicare i file font nel repo significherebbe due copie da
 *  tenere allineate.
 *
 *  Il percorso si cerca, non si risolve con `require.resolve`: il bundler lo
 *  sostituisce con il proprio identificativo numerico del modulo, e a runtime
 *  arriva un numero dove serve un percorso. L'albero delle dipendenze puo'
 *  essere sollevato alla radice o restare nel workspace, e nell'immagine
 *  finale la cartella di lavoro e' quella dell'applicazione. */
const CARTELLE_FONT = [
  path.join(process.cwd(), 'node_modules/bootstrap-italia/src/fonts/Titillium_Web'),
  path.join(process.cwd(), '../node_modules/bootstrap-italia/src/fonts/Titillium_Web'),
  path.join(process.cwd(), '../../node_modules/bootstrap-italia/src/fonts/Titillium_Web'),
];

async function carattere(peso: 'regular' | '600' | '700'): Promise<ArrayBuffer | null> {
  const nome = `titillium-web-v10-latin-ext_latin-${peso}.ttf`;
  for (const cartella of CARTELLE_FONT) {
    try {
      const buf = await readFile(path.join(cartella, nome));
      return new Uint8Array(buf).buffer as ArrayBuffer;
    } catch {
      /* percorso successivo */
    }
  }
  // Nessun 500 per un font: il disegnatore ha il proprio carattere di scorta e
  // un'anteprima fuori marchio vale infinitamente piu' di un link senza
  // anteprima. Vale anche per un'installazione che ha sfoltito le dipendenze.
  return null;
}

/** Il segno del prodotto, inlineato: la scheda viene disegnata dal server, che
 *  non deve dipendere dal poter raggiungere se stesso in rete. */
async function segnoDataUri(): Promise<string | null> {
  try {
    const file = path.join(process.cwd(), 'public/images/logo/pa-webinar-mark-white.png');
    const buf = await readFile(file);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    // Un marchio che manca — installazione in bianco, cartella pubblica
    // montata sopra — e' una decorazione in meno, non una risposta in meno.
    return null;
  }
}

/**
 * La locandina, letta QUI e non lasciata scaricare al disegnatore.
 *
 * Tre motivi: un percorso relativo (com'e' quasi sempre, per un file caricato
 * dall'amministrazione) non e' scaricabile da un processo che non sa su quale
 * origine risolverlo; un fallimento dentro il disegnatore fa cadere l'intera
 * risposta, e un'anteprima senza sfondo e' molto meglio di un link senza
 * anteprima; e cosi' la richiesta in uscita ha un tetto di tempo e di peso
 * invece di essere illimitata.
 *
 * L'indirizzo lo decide l'amministrazione, non chi chiama: e' lo stesso
 * indirizzo che l'applicazione serve gia' come copertina dell'evento.
 */
const PESO_MASSIMO_LOCANDINA = 4_000_000;

async function locandinaInline(raw: string | null): Promise<string | null> {
  const origine = origineLocandina(
    raw,
    appBaseUrl()?.toString() ?? null,
    process.env.PORT || '3000',
  );
  if (!origine) return null;

  try {
    const res = await fetch(origine.url, {
      signal: AbortSignal.timeout(4000),
      // Una locandina non ha motivo di rimbalzare: seguire i rimandi
      // riaprirebbe dall'interno la porta che `origineLocandina` ha chiuso.
      redirect: 'error',
    });
    if (!res.ok) return null;
    const tipo = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!tipo.startsWith('image/')) return null;

    // Il tetto si applica PRIMA di tenere in memoria: dichiarato quando c'e',
    // e comunque contando i pezzi mentre arrivano. Un file enorme dietro un
    // indirizzo raggiungibile, moltiplicato per le richieste in parallelo dei
    // vari servizi che generano anteprime, e' memoria che il pod non ha.
    const dichiarato = Number(res.headers.get('content-length') ?? '0');
    if (dichiarato > PESO_MASSIMO_LOCANDINA) return null;
    if (!res.body) return null;

    const pezzi: Uint8Array[] = [];
    let totale = 0;
    for await (const pezzo of res.body as unknown as AsyncIterable<Uint8Array>) {
      totale += pezzo.byteLength;
      if (totale > PESO_MASSIMO_LOCANDINA) return null;
      pezzi.push(pezzo);
    }
    return `data:${tipo};base64,${Buffer.concat(pezzi).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Le schede gia' disegnate, per questo processo.
 *
 * Disegnarne una costa una lettura al database, una richiesta per la
 * locandina, tre font e un rendering: e' la risposta piu' cara che
 * l'applicazione serva senza autenticazione. Chi condivide un link fa
 * chiedere la stessa immagine a ogni servizio che mostra l'anteprima, e
 * spesso piu' volte. La chiave contiene il momento dell'ultima modifica di
 * evento e impostazioni, quindi non esiste una scheda vecchia da invalidare:
 * cambia la chiave.
 */
const SCHEDE = new Map<string, Buffer>();
const SCHEDE_MASSIME = 40;

function ricorda(chiave: string, png: Buffer): void {
  if (SCHEDE.size >= SCHEDE_MASSIME) {
    const piuVecchia = SCHEDE.keys().next().value;
    if (piuVecchia !== undefined) SCHEDE.delete(piuVecchia);
  }
  SCHEDE.set(chiave, png);
}

function rispostaPng(png: Buffer, cache: 'HIT' | 'MISS'): Response {
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      // I servizi che mostrano le anteprime la richiedono ogni volta che il
      // link viene incollato. L'indirizzo porta il momento dell'ultima
      // modifica, quindi tenerla a lungo non fa mostrare una scheda vecchia.
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'X-Og-Cache': cache,
    },
  });
}

export const GET = withErrorHandling(async (request, context) => {
  const { slug } = (await context.params) as { slug: string };
  const url = new URL(request.url);
  // La lingua si valida contro quelle che esistono: un valore libero
  // significa una scheda diversa per ogni stringa inventata, cioe' un modo
  // per far ridisegnare all'infinito la risposta piu' cara che serviamo.
  const richiesta = url.searchParams.get('locale') ?? '';
  const locale = (locales as readonly string[]).includes(richiesta)
    ? richiesta
    : defaultLocale;

  // Stesso freno delle altre rotte pubbliche. Qui pero' non protegge un dato
  // ma il processore: disegnare una scheda e' l'operazione piu' cara che
  // l'applicazione faccia senza autenticazione, e sta sullo stesso pod della
  // sala live.
  const freno = rateLimit(`og:${getClientIp(request)}`, { limit: 60, windowMs: 60_000 });
  if (!freno.allowed) {
    throw new RateLimitError((freno.resetAt - Date.now()) / 1000);
  }

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      eventType: true,
      imageUrl: true,
      coverImageUrl: true,
      speakersInfo: true,
      organizerName: true,
      postEventPublic: true,
      postEventPublicUntil: true,
      updatedAt: true,
    },
  });
  // Stesso giudizio della pagina: un evento che non ha una scheda pubblica non
  // deve avere nemmeno un'anteprima da cui dedurne titolo, data e relatori.
  if (!event || !isEventPageVisible(event)) throw new NotFoundError('Event');

  const settings = await getSettings();
  // Spenta la scheda, non si disegna piu': l'interruttore dice "genera
  // l'anteprima", e lasciarla generabile a richiesta vorrebbe dire continuare
  // a pagarne il costo per chiunque conosca l'indirizzo. I link gia'
  // condivisi mostrano l'immagine che i servizi hanno gia' in cache, e le
  // nuove condivisioni tornano alla locandina.
  if (!settings.ogCardEnabled) throw new NotFoundError('Event');

  const chiave = `${slug}|${locale}|${event.updatedAt.getTime()}|${settings.updatedAt.getTime()}`;
  const gia = SCHEDE.get(chiave);
  if (gia) return rispostaPng(gia, 'HIT');

  const { titolo, ente, data, relatori, colore: primario } = contenutoScheda(
    event,
    settings,
    locale,
  );
  const locandina = settings.ogShowPoster
    ? await locandinaInline(event.coverImageUrl ?? event.imageUrl ?? null)
    : null;

  const [regular, semibold, bold, segno] = await Promise.all([
    carattere('regular'),
    carattere('600'),
    carattere('700'),
    segnoDataUri(),
  ]);

  const fonts = [
    { name: 'Titillium Web', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'Titillium Web', data: semibold, weight: 600 as const, style: 'normal' as const },
    { name: 'Titillium Web', data: bold, weight: 700 as const, style: 'normal' as const },
  ].filter((f): f is typeof f & { data: ArrayBuffer } => f.data !== null);

  const immagine = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          position: 'relative',
          backgroundColor: primario,
          fontFamily: 'Titillium Web',
          color: '#ffffff',
        }}
      >
        {/* La locandina riempie la scheda; sopra ci va una velatura, altrimenti
            il testo bianco sparisce su un'immagine chiara. Senza locandina
            resta il colore istituzionale, che e' comunque riconoscibile. */}
        {locandina && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={locandina}
            alt=""
            width={LARGHEZZA}
            height={ALTEZZA}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: LARGHEZZA,
              height: ALTEZZA,
              objectFit: 'cover',
            }}
          />
        )}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: LARGHEZZA,
            height: ALTEZZA,
            display: 'flex',
            background: locandina
              ? 'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.88) 100%)'
              : 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 100%)',
          }}
        />

        {/* Il segno del prodotto sta in alto e non ingombra: senza locandina
            e' l'unica cosa che dice di chi e' questa pagina. */}
        {segno && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={segno}
            alt=""
            height={64}
            style={{ position: 'absolute', top: 56, left: 64, height: 64 }}
          />
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            padding: '0 64px 56px',
            gap: 16,
          }}
        >
          {ente !== '' && (
            <div
              style={{
                display: 'flex',
                fontSize: 26,
                fontWeight: 600,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                opacity: 0.92,
              }}
            >
              {ente}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              fontSize: titolo.length > 70 ? 56 : 68,
              fontWeight: 700,
              lineHeight: 1.12,
            }}
          >
            {titolo}
          </div>

          {(data !== '' || relatori !== '') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data !== '' && (
                <div style={{ display: 'flex', fontSize: 30, fontWeight: 600 }}>{data}</div>
              )}
              {relatori !== '' && (
                <div style={{ display: 'flex', fontSize: 27, opacity: 0.92 }}>
                  {relatori}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Filo di colore istituzionale in basso: tiene insieme la scheda anche
            quando la locandina e' di tutt'altra palette. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: LARGHEZZA,
            height: 12,
            backgroundColor: primario,
          }}
        />
      </div>
    ),
    {
      width: LARGHEZZA,
      height: ALTEZZA,
      // Vuoto quando i font non ci sono: il disegnatore usa il proprio.
      ...(fonts.length > 0 ? { fonts } : {}),
    },
  );

  const png = Buffer.from(await immagine.arrayBuffer());
  ricorda(chiave, png);
  return rispostaPng(png, 'MISS');
});
