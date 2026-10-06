/**
 * La foto profilo: quella che una persona sceglie di mostrare in sala al
 * posto delle iniziali, legata all'hash della sua email (vedi ProfilePhoto
 * nello schema). Qui: i limiti, il riconoscimento del formato, la
 * ricodifica, chi puo' caricarla e l'indirizzo da cui si serve.
 */

import { absoluteAppUrl } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db';

/** La foto arriva gia' ridimensionata dal browser (256x256): questo e' un
 *  tetto largo per un'immagine di quella misura, non la misura attesa. */
export const MAX_PHOTO_BYTES = 150_000;

/** Il lato della foto salvata, in pixel. */
export const PHOTO_SIDE = 256;

/** Oltre questi pixel l'immagine non si decodifica nemmeno: pochi KB di PNG
 *  possono dichiarare decine di milioni di pixel. */
const MAX_INPUT_PIXELS = 4096 * 4096;

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/**
 * Il formato dai primi byte, non dall'intestazione della richiesta: un file
 * che dice di essere un'immagine e non lo e' non si salva. SVG escluso di
 * proposito (puo' contenere script).
 */
export function sniffImageType(b: Uint8Array): PhotoType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * La foto come si salva: decodificata e ricodificata qui, qualunque cosa abbia
 * fatto il browser. Esce un JPEG di PHOTO_SIDE x PHOTO_SIDE ritagliato al
 * centro, solo il primo fotogramma, senza metadati (data, luogo, dispositivo).
 * Null se i byte non sono un JPEG, PNG o WebP leggibile.
 */
export async function normalizePhoto(input: Uint8Array): Promise<Buffer | null> {
  if (!sniffImageType(input)) return null;
  try {
    // Caricata solo qui: e' un modulo nativo, e chi entra in sala (il token di
    // Jitsi legge le foto da questo file) non deve dipendere da lei.
    const { default: sharp } = await import('sharp');
    return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      // L'orientamento EXIF si applica ai pixel prima che i metadati spariscano.
      .rotate()
      .resize(PHOTO_SIDE, PHOTO_SIDE, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    return null;
  }
}

/** Il percorso da cui si serve la foto. L'id cambia a ogni nuova foto: un
 *  indirizzo vecchio non mostra quella nuova. */
export function profilePhotoPath(photo: { id: string }): string {
  return `/api/avatar/photo/${photo.id}`;
}

/** L'indirizzo assoluto, per il token di Jitsi (la chiamata sta su un altro
 *  dominio). Null senza un indirizzo pubblico dell'app. */
export function profilePhotoUrl(photo: { id: string }): string | null {
  const base = absoluteAppUrl();
  return base ? `${base}${profilePhotoPath(photo)}` : null;
}

/** La foto di un'email, se c'e'. */
export async function findPhotoByEmailHash(emailHash: string) {
  return prisma.profilePhoto.findUnique({
    where: { emailHash },
    select: { id: true },
  });
}

export type PhotoOwner =
  | { kind: 'owner'; emailHash: string }
  /** L'iscrizione e' di questo browser, ma l'indirizzo non e' provato: serve
   *  aprire il link dell'email. */
  | { kind: 'needsEmailProof' };

/**
 * A chi appartiene la foto che si sta caricando: l'email dell'iscrizione di
 * chi presenta il token. Il link principale del moderatore, le concessioni
 * nominali e gli ospiti non caricano foto: l'indirizzo di una concessione lo
 * sceglie lo staff, e possederne il link non prova che l'indirizzo sia di chi
 * lo apre.
 *
 * La foto vale per l'indirizzo in tutti gli eventi, quindi chiede la prova
 * che l'indirizzo sia di chi la carica. Il link di un'iscrizione si puo'
 * inoltrare, e il modulo d'iscrizione accetta qualunque indirizzo: per
 * l'iscrizione serve il cookie firmato dell'evento, con lo stesso token e nato
 * dal link dell'email (`access`, letto dal chiamante: lib/event-session).
 */
export async function resolvePhotoOwner(
  eventId: string,
  token: string | null,
  access: { token: string; emailVerified: boolean } | null,
): Promise<PhotoOwner | null> {
  if (!token) return null;
  const reg = await prisma.registration.findUnique({
    where: { accessToken: token },
    select: { eventId: true, emailHash: true },
  });
  if (!reg || reg.eventId !== eventId || access?.token !== token) return null;
  return access.emailVerified ? { kind: 'owner', emailHash: reg.emailHash } : { kind: 'needsEmailProof' };
}
