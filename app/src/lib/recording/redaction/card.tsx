// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il cartello che copre a schermo pieno gli intervalli tolti da un video:
 * «contenuto rimosso su richiesta», nella lingua della registrazione.
 *
 * Lo disegna il portale, che ha i testi in tutte le lingue e il carattere del
 * design system, e lo passa al worker con il lavoro (PNG in base64): il worker
 * non porta caratteri ne' testi, e ffmpeg lo scala sul formato del video. Se
 * il disegno non riesce il worker copre gli intervalli con un riquadro scuro
 * senza testo: la rimozione non dipende da un carattere che manca.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';

export const LARGHEZZA_CARTELLO = 1280;
export const ALTEZZA_CARTELLO = 720;

/** Le stesse cartelle in cui la scheda di anteprima cerca il carattere (api/og). */
const CARTELLE_FONT = [
  path.join(process.cwd(), 'node_modules/bootstrap-italia/src/fonts/Titillium_Web'),
  path.join(process.cwd(), '../node_modules/bootstrap-italia/src/fonts/Titillium_Web'),
  path.join(process.cwd(), '../../node_modules/bootstrap-italia/src/fonts/Titillium_Web'),
];

async function carattere(peso: 'regular' | '600'): Promise<ArrayBuffer | null> {
  const nome = `titillium-web-v10-latin-ext_latin-${peso}.ttf`;
  for (const cartella of CARTELLE_FONT) {
    try {
      const buf = await readFile(path.join(cartella, nome));
      return new Uint8Array(buf).buffer as ArrayBuffer;
    } catch {
      /* cartella successiva */
    }
  }
  return null;
}

/** I testi del cartello nella lingua data. */
export async function testiDelCartello(
  lingua: string
): Promise<{ titolo: string; corpo: string }> {
  const t = await getTranslations({ locale: lingua, namespace: 'recordingRemoval' });
  return { titolo: t('cardTitle'), corpo: t('cardBody') };
}

/** Il cartello in PNG, in base64; null se non si riesce a disegnarlo. */
export async function cartelloRimozione(lingua: string): Promise<string | null> {
  try {
    const { titolo, corpo } = await testiDelCartello(lingua);
    const [regular, semibold] = await Promise.all([
      carattere('regular'),
      carattere('600'),
    ]);
    const fonts = [
      {
        name: 'Titillium Web',
        data: regular,
        weight: 400 as const,
        style: 'normal' as const,
      },
      {
        name: 'Titillium Web',
        data: semibold,
        weight: 600 as const,
        style: 'normal' as const,
      },
    ].filter((f): f is typeof f & { data: ArrayBuffer } => f.data !== null);
    const immagine = new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#17324D',
          color: '#ffffff',
          fontFamily: 'Titillium Web',
          padding: '0 120px',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 600, lineHeight: 1.2 }}>
          {titolo}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 32,
            fontSize: 32,
            lineHeight: 1.4,
            color: '#D9E4EF',
          }}
        >
          {corpo}
        </div>
      </div>,
      {
        width: LARGHEZZA_CARTELLO,
        height: ALTEZZA_CARTELLO,
        ...(fonts.length > 0 ? { fonts } : {}),
      }
    );
    return Buffer.from(await immagine.arrayBuffer()).toString('base64');
  } catch (err) {
    console.warn(
      '[recording-redaction] removal card not drawn',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
