#!/usr/bin/env python3
"""
Speaker diarization SENZA pyannote (no HF gating).

Strategia:
1. Carico l'audio mono 16k (audio.wav).
2. Carico i segmenti VAD-filtrati di faster-whisper da transcript_raw.json.
3. Per ogni segmento (>=1s) estraggo embedding ECAPA-TDNN (speechbrain,
   modello pubblico non gated, 7M parametri).
4. Stimo il numero di speaker via Silhouette score 2..6.
5. Agglomerative clustering cosine sui vettori → label SPEAKER_xx.
6. Riscrivo i segmenti con campo "speaker".

Output: transcript_diarized.json
"""
from __future__ import annotations
import json
import time
import numpy as np
import soundfile as sf
import torch
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import normalize
from speechbrain.inference.speaker import EncoderClassifier

import os
AUDIO = "audio.wav"
TRANSCRIPT_IN = "transcript_raw.json"
TRANSCRIPT_OUT = "transcript_diarized.json"
MIN_SEG_DURATION = 1.0
# Quando l'admin conosce il numero (Event.expectedSpeakers), forziamo k:
# evita gli outlier (cluster da 1-5 sec). Env override per test locale.
EXPECTED_SPEAKERS = int(os.environ.get("EXPECTED_SPEAKERS", "0")) or None
MAX_SPEAKERS = 6

print("Loading ECAPA-TDNN…")
t0 = time.time()
enc = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    run_opts={"device": "cuda"},
    savedir="/tmp/ecapa-cache",
)
print(f"  loaded in {time.time()-t0:.1f}s")

print(f"Loading {AUDIO}…")
wav, sr = sf.read(AUDIO)
assert sr == 16000
wav = wav.astype(np.float32)

with open(TRANSCRIPT_IN) as f:
    tx = json.load(f)
segs = tx["segments"]
print(f"Transcript: {len(segs)} segments, dur={tx['duration']:.0f}s")

# 1) embed per segmento (centrato, almeno MIN_SEG_DURATION)
embeds = []
seg_ix = []
for i, s in enumerate(segs):
    s0, s1 = s["start"], s["end"]
    if s1 - s0 < MIN_SEG_DURATION:
        # estendi il segmento di centro ± min/2
        c = 0.5 * (s0 + s1)
        s0 = max(0, c - MIN_SEG_DURATION / 2)
        s1 = min(tx["duration"], c + MIN_SEG_DURATION / 2)
    a = wav[int(s0 * sr) : int(s1 * sr)]
    if len(a) < int(0.3 * sr):
        continue
    with torch.no_grad():
        emb = enc.encode_batch(torch.from_numpy(a).unsqueeze(0).cuda()).squeeze().cpu().numpy()
    embeds.append(emb)
    seg_ix.append(i)
print(f"Embedded {len(embeds)} segments")
X = normalize(np.stack(embeds))  # L2 → cosine = dot

# 2) k: forzato se EXPECTED_SPEAKERS (admin lo sa), altrimenti via silhouette
if EXPECTED_SPEAKERS:
    best_k = max(2, min(EXPECTED_SPEAKERS, len(X) // 2))
    clu = AgglomerativeClustering(n_clusters=best_k, metric="cosine", linkage="average")
    best_labels = clu.fit_predict(X)
    try:
        best_score = silhouette_score(X, best_labels, metric="cosine")
    except Exception:
        best_score = -1
    print(f"-> forced k={best_k} (silhouette={best_score:.3f})")
else:
    best_k, best_score, best_labels = 1, -1.0, np.zeros(len(X), dtype=int)
    for k in range(2, min(MAX_SPEAKERS, len(X)) + 1):
        if len(X) < k * 2:
            break
        clu = AgglomerativeClustering(n_clusters=k, metric="cosine", linkage="average")
        labels = clu.fit_predict(X)
        try:
            score = silhouette_score(X, labels, metric="cosine")
        except Exception:
            score = -1
        print(f"  k={k} silhouette={score:.3f}")
        if score > best_score:
            best_k, best_score, best_labels = k, score, labels
    print(f"-> chosen k={best_k} (silhouette={best_score:.3f})")

# 3) mappa segmenti → label
seg_speaker = {i: f"SPEAKER_{l:02d}" for i, l in zip(seg_ix, best_labels)}
# segmenti scartati (troppo brevi) → eredità dal precedente
last_sp = "SPEAKER_00"
for i, s in enumerate(segs):
    if i in seg_speaker:
        last_sp = seg_speaker[i]
    s["speaker"] = seg_speaker.get(i, last_sp)

# 4) speech time per speaker
times = {}
for s in segs:
    times[s["speaker"]] = times.get(s["speaker"], 0.0) + (s["end"] - s["start"])
speakers = [
    {"diarLabel": l, "totalSpeechSec": round(t, 1)} for l, t in sorted(times.items())
]
print("Speech by speaker:")
for sp in speakers:
    print(f"  {sp['diarLabel']}: {sp['totalSpeechSec']:.0f}s")

tx["speakers"] = speakers
tx["diarization"] = {"k": int(best_k), "silhouette": float(best_score), "method": "ecapa-tdnn+agglo"}
with open(TRANSCRIPT_OUT, "w") as f:
    json.dump(tx, f, indent=2, ensure_ascii=False)
print(f"Saved {TRANSCRIPT_OUT}")
