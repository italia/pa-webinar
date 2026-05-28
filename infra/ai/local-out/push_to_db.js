/**
 * Inserisce nel DB di test (videocall-test) gli artifact prodotti
 * localmente. Da lanciare via:
 *   kubectl exec deploy/videocall-test-eventi-dtd -c eventi-dtd -- node -
 *
 * Lo script riceve via stdin un JSON con:
 *   {
 *     recordingId: '...',
 *     sourceLanguage: 'it',
 *     summaryIt:    { overall_summary, topics, key_decisions, action_items },
 *     summaryEn:    { ... },
 *     speakersNamed: { 'SPEAKER_00': 'Alex', ... },
 *     transcriptJson: {...},          // raw faster-whisper + diarization
 *     transcriptVttIt: '...',
 *     transcriptVttEn: '...',
 *     transcriptTxtIt: '...',
 *     transcriptSrtIt: '...',
 *     transcriptSrtEn: '...',
 *     summaryMdIt: '...',             // markdown
 *     summaryMdEn: '...',
 *     dubbedAudioBlobKey: 'postprod/.../dubbed_en.m4a' (opzionale),
 *   }
 *
 * Crea:
 *   - 1 PostprodArtifact per ciascun tipo
 *   - 1 Speaker row per ciascuno speaker (con displayName se mapped)
 *   - aggiorna Recording.status = POSTPROD_DONE
 *   - aggiorna Event.recordingPublished = true (se richiesto)
 */
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const p = new PrismaClient();

  const {
    recordingId,
    sourceLanguage,
    summaryIt,
    summaryEn,
    speakersNamed,
    transcriptJson,
    transcriptVttIt,
    transcriptVttEn,
    transcriptTxtIt,
    transcriptSrtIt,
    transcriptSrtEn,
    summaryMdIt,
    summaryMdEn,
    dubbedAudioBlobKey,
    publishRecording = true,
  } = input;

  const rec = await p.recording.findUnique({ where: { id: recordingId } });
  if (!rec) throw new Error('recording not found');
  console.log('rec:', rec.id, 'eventId:', rec.eventId);

  // Wipe stato precedente (idempotenza)
  await p.postprodArtifact.deleteMany({ where: { recordingId } });
  await p.speaker.deleteMany({ where: { recordingId } });
  await p.postprodJob.deleteMany({ where: { recordingId } });

  // 4 job DONE — uno per kind. Servono come FK per gli artifact.
  const jobByKind = {};
  for (const kind of ['TRANSCRIBE', 'SUMMARIZE', 'TRANSLATE', 'DUB']) {
    const payload = { runId: rec.id, sourceLanguage, source: 'local-pipeline' };
    const idemRaw = `${rec.id}|${kind}|${rec.runCount}|local`;
    const idempotencyKey = crypto.createHash('sha256').update(idemRaw).digest('hex').slice(0, 40);
    const j = await p.postprodJob.create({
      data: {
        recordingId,
        kind,
        payload,
        idempotencyKey,
        status: 'DONE',
        attempts: 1,
        completedAt: new Date(),
      },
      select: { id: true, kind: true },
    });
    jobByKind[kind] = j.id;
  }
  console.log('jobs DONE:', Object.keys(jobByKind));

  const blobKey = (kind, lang) =>
    `postprod/${rec.eventId}/${rec.id}/run-${rec.runCount}/${kind}${lang ? '-' + lang : ''}`;
  const sha = (b) => crypto.createHash('sha256').update(b || '').digest('hex');

  const artifactRows = [];
  const push = (type, language, body, mime, jobKind) => {
    artifactRows.push({
      recordingId,
      jobId: jobByKind[jobKind],
      type,
      language,
      blobKey: blobKey(type.toLowerCase(), language),
      inlineBody: body,
      mimeType: mime,
      sizeBytes: BigInt(Buffer.byteLength(body || '')),
      contentHash: sha(body || ''),
      isSynthetic: true,
    });
  };

  // TRANSCRIPT_SRT non esiste nell'enum — il player lo costruisce al volo
  // dall'endpoint download/[file].
  push('TRANSCRIPT_JSON', null, JSON.stringify(transcriptJson), 'application/json', 'TRANSCRIBE');
  push('TRANSCRIPT_VTT', sourceLanguage, transcriptVttIt, 'text/vtt', 'TRANSCRIBE');
  push('TRANSCRIPT_TXT', sourceLanguage, transcriptTxtIt, 'text/plain', 'TRANSCRIBE');
  push('TRANSLATION_VTT', 'en', transcriptVttEn, 'text/vtt', 'TRANSLATE');
  push('SUMMARY_MD', sourceLanguage, summaryMdIt, 'text/markdown', 'SUMMARIZE');
  push('TRANSLATION_MD', 'en', summaryMdEn, 'text/markdown', 'TRANSLATE');

  if (dubbedAudioBlobKey) {
    artifactRows.push({
      recordingId,
      jobId: jobByKind['DUB'],
      type: 'DUBBED_AUDIO',
      language: 'en',
      blobKey: dubbedAudioBlobKey,
      inlineBody: null,
      mimeType: 'audio/mp4',
      sizeBytes: null,
      contentHash: sha(dubbedAudioBlobKey),
      isSynthetic: true,
    });
  }

  const created = await p.postprodArtifact.createMany({ data: artifactRows });
  console.log('artifacts created:', created.count);

  // Speakers (basato sul totalSpeechSec calcolato in transcriptJson.speakers)
  const speakerRows = (transcriptJson.speakers || []).map((sp) => ({
    recordingId,
    diarLabel: sp.diarLabel,
    displayName: speakersNamed[sp.diarLabel] || null,
    totalSpeechSec: sp.totalSpeechSec || 0,
  }));
  if (speakerRows.length) {
    const cSp = await p.speaker.createMany({ data: speakerRows });
    console.log('speakers created:', cSp.count);
  }

  await p.recording.update({
    where: { id: recordingId },
    data: { status: 'POSTPROD_DONE', sourceLanguage },
  });
  console.log('recording → POSTPROD_DONE');

  if (publishRecording) {
    await p.event.update({
      where: { id: rec.eventId },
      data: { recordingPublished: true, recordingPublishedAt: new Date() },
    });
    console.log('event.recordingPublished → true');
  }

  // Auto-flag SiteSetting per essere sicuri (kill-switch on)
  await p.siteSetting.update({
    where: { id: 'singleton' },
    data: { aiPipelineEnabled: true },
  });

  await p.$disconnect();
  console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
