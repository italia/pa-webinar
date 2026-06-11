/**
 * Costruzione del `Recording.pipelineSnapshot` — fotografia degli
 * engine/modelli/voci/lingue usati dalla pipeline AI, per la trasparenza
 * AI Act Art. 50 (esposta nella card "Trasparenza del processing").
 *
 * Derivato dagli artefatti realmente prodotti (modelId/modelVersion/
 * watermarkType) + dagli Speaker, quando il Recording raggiunge
 * POSTPROD_DONE/PARTIAL. Prima era sempre `{}` per le run in-cluster
 * (solo la pipeline locale lo popolava).
 */

export interface SnapshotArtifact {
  type: string;
  language: string | null;
  modelId: string | null;
  modelVersion: string | null;
  watermarkType: string | null;
}

export interface SnapshotSpeaker {
  diarLabel: string;
  displayName: string | null;
  totalSpeechSec: number;
}

export function buildPipelineSnapshot(
  artifacts: SnapshotArtifact[],
  speakers: SnapshotSpeaker[],
  sourceLanguage: string | null,
  runAtIso: string,
): Record<string, unknown> {
  const first = (t: string) => artifacts.find((a) => a.type === t) ?? null;
  const distinctLangs = (t: string) =>
    Array.from(
      new Set(
        artifacts
          .filter((a) => a.type === t && a.language)
          .map((a) => a.language as string),
      ),
    );

  const transcript = first('TRANSCRIPT_JSON');
  const summary = first('SUMMARY_JSON') ?? first('SUMMARY_MD');
  const dub = first('DUBBED_AUDIO');
  const isMultitrack = transcript?.modelId === 'multitrack';
  const watermarks = Array.from(
    new Set(artifacts.map((a) => a.watermarkType).filter((w): w is string => !!w)),
  );

  return {
    asr: {
      engine: 'whisperx',
      model: transcript?.modelId ?? 'large-v3',
      version: transcript?.modelVersion ?? null,
    },
    diarization: {
      engine: isMultitrack ? 'multitrack-recorder' : 'pyannote.audio',
      method: isMultitrack ? 'per-participant-track' : 'blind-diarization',
    },
    llm: { engine: 'vllm', model: summary?.modelId ?? null, vendor: 'Mistral AI', license: 'Apache-2.0' },
    tts: dub
      ? { engine: 'piper', voice: dub.modelId ?? null, version: dub.modelVersion ?? null, license: 'MIT' }
      : null,
    watermark: watermarks.length ? watermarks : null,
    speakers: speakers.map((s) => ({
      diarLabel: s.diarLabel,
      displayName: s.displayName ?? null,
      totalSpeechSec: s.totalSpeechSec,
    })),
    languages: {
      source: sourceLanguage ?? 'it',
      translation: distinctLangs('TRANSLATION_VTT'),
      dubbing: distinctLangs('DUBBED_AUDIO'),
    },
    runAt: runAtIso,
    pipelineVersion: process.env.GIT_SHA ?? process.env.NEXT_PUBLIC_APP_VERSION ?? 'cluster',
  };
}
