/**
 * GET /api/internal/captions/context?room=<stanza>  (ADR-018)
 *
 * Il contesto di una stanza per il servizio dei sottotitoli live: se
 * trascrivere, in che lingua e con quale vocabolario (lib/captions/vocabulary).
 * La stanza arriva dal bridge come parametro dell'URL della trascrizione, che
 * Prosody mette nei metadati della stanza (Jitsi stable-10978 e successivi);
 * senza stanza valgono l'istanza e il suo glossario.
 *
 * Auth: CRON_API_KEY (header x-api-key), come gli altri endpoint /internal.
 */

import { glossaryForEvent, listGlossary } from '@/lib/ai/glossary';
import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { eventoDellaConferenza } from '@/lib/captions/room';
import { aliasRules, asrLanguage, buildPhrases, type CaptionsContext } from '@/lib/captions/vocabulary';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const settings = await getSettings();
  const language = asrLanguage(settings.defaultLocale);
  if (settings.liveCaptionsEnabled === false) {
    return Response.json({ enabled: false, language, phrases: [], aliases: [] } satisfies CaptionsContext);
  }

  const params = new URL(request.url).searchParams;
  const room = params.get('room')?.trim() || null;
  const meetingId = params.get('meetingId')?.trim() || null;
  // La stanza, quando il bridge la passa; altrimenti l'id della riunione, che
  // Prosody ha legato all'evento (lib/captions/room).
  const trovato = await eventoDellaConferenza({ room, meetingId });
  const event = trovato
    ? await prisma.event.findUnique({
        where: { id: trovato.id },
        select: {
          id: true,
          liveCaptionsEnabled: true,
          captionsTranscriptEnabled: true,
          organizerName: true,
          moderatorName: true,
          organizers: { select: { name: true }, orderBy: { sortOrder: 'asc' } },
          additionalMods: { where: { revokedAt: null }, select: { name: true } },
        },
      })
    : null;

  if (!event) {
    const glossary = await listGlossary(null);
    return Response.json({
      enabled: true,
      language,
      phrases: buildPhrases(glossary.map((e) => e.term)),
      aliases: aliasRules(glossary),
    } satisfies CaptionsContext);
  }

  const glossary = await glossaryForEvent(event.id);
  const context: CaptionsContext = {
    enabled: event.liveCaptionsEnabled,
    transcript: event.liveCaptionsEnabled && event.captionsTranscriptEnabled,
    language,
    // Prima i termini del glossario, poi enti e persone: con il limite di
    // frasi, quelle che contano di più restano.
    phrases: buildPhrases([
      ...glossary.map((e) => e.term),
      event.organizerName,
      ...event.organizers.map((o) => o.name),
      event.moderatorName,
      ...event.additionalMods.map((m) => tryDecryptPII(m.name) ?? null),
    ]),
    aliases: aliasRules(glossary),
  };
  return Response.json(context);
});
