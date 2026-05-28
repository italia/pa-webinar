"""Re-trascrive audio.wav con initial_prompt + hallucination filter.

Salva transcript_raw.json (sovrascrive). Da rilanciare ogni volta che
cambiamo il prompt o i filtri."""
import json, time
from faster_whisper import WhisperModel

INITIAL_PROMPT = (
    "Riunione interna del Dipartimento per la Trasformazione Digitale (DTD). "
    "Partecipanti: Raffaele Vitiello, Alex, Paolo, Marco. "
    "Argomenti trattati: piattaforma video eventi-dtd, Jitsi Meet, "
    "Kubernetes, cluster Azure, PCM, OVH, Teams, registrazione delle call, "
    "calendario, moderazione, qualità della connessione, codec, "
    "certificazione dell'accessibilità."
)
AVG_LOGPROB_TH = -1.0
NO_SPEECH_TH = 0.6

print("Loading large-v3…")
m = WhisperModel('large-v3', device='cuda', compute_type='float16')
print(f"Transcribing with initial_prompt ({len(INITIAL_PROMPT)} chars)…")
t0 = time.time()
segments, info = m.transcribe(
    'audio.wav',
    language='it',
    word_timestamps=True,
    beam_size=5,
    vad_filter=True,
    initial_prompt=INITIAL_PROMPT,
)

raw = list(segments)
kept, dropped = [], 0
for s in raw:
    if s.avg_logprob is not None and s.avg_logprob < AVG_LOGPROB_TH:
        dropped += 1; continue
    if s.no_speech_prob is not None and s.no_speech_prob > NO_SPEECH_TH:
        dropped += 1; continue
    kept.append(s)
print(f"Done in {time.time()-t0:.1f}s — kept {len(kept)}, dropped {dropped} (hallucination filter)")

out = {
    'language': info.language,
    'duration': info.duration,
    'segments': [{
        'start': s.start, 'end': s.end, 'text': s.text.strip(),
        'avg_logprob': s.avg_logprob,
        'no_speech_prob': s.no_speech_prob,
        'words': [{'start': w.start, 'end': w.end, 'word': w.word, 'prob': w.probability}
                  for w in (s.words or [])],
    } for s in kept],
}
json.dump(out, open('transcript_raw.json','w'), indent=2, ensure_ascii=False)
print(f"Saved transcript_raw.json ({len(out['segments'])} segments)")
