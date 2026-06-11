/**
 * Inserisce nel DB di test (videocall-test) gli artifact prodotti
 * localmente. Lanciato da package_and_push.py via kubectl exec.
 *
 * stdin JSON:
 *   {
 *     recordingId, sourceLanguage,
 *     summaryIt, summaryMdIt, speakersNamed, transcriptJson,
 *     transcriptVttIt, transcriptTxtIt, transcriptSrtIt,
 *     translations: [ { lang, vtt, srt, summaryMd, summaryJson, dubbedBlobKey } ],
 *     pipelineSnapshot, publishRecording
 *   }
 *
 * Nota: inlineBody salvato in CHIARO (shortcut test; tryDecryptPII lato
 * app degrada a plaintext su decrypt-failure). Non usare per dati reali
 * in prod.
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
    summaryMdIt,
    speakersNamed,
    transcriptJson,
    transcriptVttIt,
    transcriptTxtIt,
    translations = [],
    publishRecording = true,
  } = input;

  const rec = await p.recording.findUnique({ where: { id: recordingId } });
  if (!rec) throw new Error('recording not found');
  console.log('rec:', rec.id, 'eventId:', rec.eventId);

  // Idempotenza: pulisci lo stato precedente.
  await p.postprodArtifact.deleteMany({ where: { recordingId } });
  await p.speaker.deleteMany({ where: { recordingId } });
  await p.postprodJob.deleteMany({ where: { recordingId } });

  const jobByKind = {};
  for (const kind of ['TRANSCRIBE', 'SUMMARIZE', 'TRANSLATE', 'DUB']) {
    const payload = { runId: rec.id, sourceLanguage, source: 'local-pipeline' };
    const idemRaw = `${rec.id}|${kind}|${rec.runCount}|local`;
    const idempotencyKey = crypto.createHash('sha256').update(idemRaw).digest('hex').slice(0, 40);
    const j = await p.postprodJob.create({
      data: { recordingId, kind, payload, idempotencyKey, status: 'DONE', attempts: 1, completedAt: new Date() },
      select: { id: true },
    });
    jobByKind[kind] = j.id;
  }
  console.log('jobs DONE:', Object.keys(jobByKind));

  const blobKey = (kind, lang) =>
    `postprod/${rec.eventId}/${rec.id}/run-${rec.runCount}/${kind}${lang ? '-' + lang : ''}`;
  const sha = (b) => crypto.createHash('sha256').update(b || '').digest('hex');

  const rows = [];
  const push = (type, language, body, mime, jobKind) => {
    rows.push({
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

  // ── Source language (IT) ───────────────────────────────────────
  push('TRANSCRIPT_JSON', null, JSON.stringify(transcriptJson), 'application/json', 'TRANSCRIBE');
  push('TRANSCRIPT_VTT', sourceLanguage, transcriptVttIt, 'text/vtt', 'TRANSCRIBE');
  push('TRANSCRIPT_TXT', sourceLanguage, transcriptTxtIt, 'text/plain', 'TRANSCRIBE');
  if (summaryMdIt) push('SUMMARY_MD', sourceLanguage, summaryMdIt, 'text/markdown', 'SUMMARIZE');
  if (summaryIt) push('SUMMARY_JSON', sourceLanguage, JSON.stringify(summaryIt), 'application/json', 'SUMMARIZE');

  // ── Una set di artifact per ogni lingua target ─────────────────
  for (const t of translations) {
    if (t.vtt) push('TRANSLATION_VTT', t.lang, t.vtt, 'text/vtt', 'TRANSLATE');
    if (t.summaryMd) push('TRANSLATION_MD', t.lang, t.summaryMd, 'text/markdown', 'TRANSLATE');
    if (t.summaryJson) push('SUMMARY_JSON', t.lang, JSON.stringify(t.summaryJson), 'application/json', 'TRANSLATE');
    if (t.dubbedBlobKey) {
      rows.push({
        recordingId,
        jobId: jobByKind['DUB'],
        type: 'DUBBED_AUDIO',
        language: t.lang,
        blobKey: t.dubbedBlobKey,
        inlineBody: null,
        mimeType: 'audio/mp4',
        sizeBytes: null,
        contentHash: sha(t.dubbedBlobKey),
        isSynthetic: true,
      });
    }
  }

  const created = await p.postprodArtifact.createMany({ data: rows });
  console.log('artifacts created:', created.count, '(langs: it +', translations.map((t) => t.lang).join(',') + ')');

  const speakerRows = (transcriptJson.speakers || []).map((sp) => ({
    recordingId,
    diarLabel: sp.diarLabel,
    displayName: (speakersNamed || {})[sp.diarLabel] || null,
    totalSpeechSec: Math.round(sp.totalSpeechSec || 0),
  }));
  if (speakerRows.length) {
    const cSp = await p.speaker.createMany({ data: speakerRows });
    console.log('speakers created:', cSp.count);
  }

  await p.recording.update({
    where: { id: recordingId },
    data: {
      status: 'POSTPROD_DONE',
      sourceLanguage,
      ...(input.pipelineSnapshot ? { pipelineSnapshot: input.pipelineSnapshot } : {}),
    },
  });
  console.log('recording → POSTPROD_DONE');

  if (publishRecording) {
    await p.event.update({
      where: { id: rec.eventId },
      data: { recordingPublished: true, recordingPublishedAt: new Date() },
    });
    console.log('event.recordingPublished → true');
  }

  await p.siteSetting.update({ where: { id: 'singleton' }, data: { aiPipelineEnabled: true } });

  await p.$disconnect();
  console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
