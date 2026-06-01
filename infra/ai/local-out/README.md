# Pipeline AI postprod — esecuzione locale

Scripts per girare la pipeline AI postprod **fuori dal cluster** — utile
per dry-run su singolo evento, smoke test di un nuovo modello, debug del
flusso senza spendere quota A100.

Lo schema è lo stesso del worker production (`infra/ai/worker/main.py`)
ma in 3 step shell-friendly + un push finale che simula
l'orchestratore inserendo gli artifact direttamente nel DB.

## Prerequisiti

- GPU NVIDIA con almeno ~24GB VRAM (testato su RTX 5090 32GB).
- Python 3.12, `ffmpeg`, `az` CLI.
- Ollama in locale (`ollama serve`) con almeno un modello compatibile.
  Default usato qui: `mistral-small3.2:24b` (15GB Q4_K_M).
- Accesso allo storage Azure dove vivono i `recordings/`.

## Setup una tantum

```sh
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install torch>=2.7 torchaudio --index-url https://download.pytorch.org/whl/cu128
uv pip install faster-whisper soundfile speechbrain scikit-learn requests piper-tts

# Voci Piper (commercial-safe, Apache 2.0):
mkdir -p piper-voices
for v in en/en_US/lessac/medium/en_US-lessac-medium it/it_IT/paola/medium/it_IT-paola-medium; do
  for ext in onnx onnx.json; do
    curl -sSL -o "piper-voices/$(basename $v).$ext" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/$v.$ext"
  done
done

# Ollama model — pull una volta:
ollama pull mistral-small3.2:24b
```

## Flusso (per evento)

```sh
# 0) scarica MP4 dal blob (serve account key)
az storage blob download \
  --account-name developersitaliarec \
  --account-key "$AZURE_KEY" \
  --container-name recordings \
  --name "recordings/<filename>.mp4" \
  --file source.mp4

# 1) audio mono 16k per WhisperX
ffmpeg -y -i source.mp4 -ar 16000 -ac 1 audio.wav

# 2) trascrizione con faster-whisper (large-v3 fp16) — produce transcript_raw.json
python -c "
from faster_whisper import WhisperModel
import json
m = WhisperModel('large-v3', device='cuda', compute_type='float16')
segments, info = m.transcribe('audio.wav', language='it', word_timestamps=True, vad_filter=True)
segs = list(segments)
out = {'language': info.language, 'duration': info.duration,
       'segments': [{'start': s.start, 'end': s.end, 'text': s.text.strip(),
                     'words': [{'start': w.start,'end': w.end,'word': w.word,'prob': w.probability} for w in (s.words or [])]} for s in segs]}
json.dump(out, open('transcript_raw.json','w'), ensure_ascii=False, indent=2)
"

# 3) diarization SENZA pyannote (no HF gating) — produce transcript_diarized.json
python diarize.py

# 4) sintesi + topic segmentation + traduzione EN — produce summary.json
LLM_MODEL=mistral-small3.2:24b python summarize.py

# 5) build dei file di delivery (VTT, SRT, TXT, named JSON)
python build_vtt.py

# 6) doppiaggio EN sintetico (Piper voce neutra) — produce dubbed_en.m4a
python dub.py

# 7) push al DB di test + upload dubbed audio su Azure
AZURE_KEY=… python package_and_push.py
```

Dopo lo step 7, l'evento è visibile sul player pubblico:
`https://videocall-test.innovazione.gov.it/it/eventi/<slug>` con
trascrizione cliccabile (08:50 - Raffaele: …), sintesi multilingua,
sottotitoli IT/EN, doppiaggio EN.

## Differenze con il worker in cluster

| Aspetto | Worker in cluster | Locale (questo) |
|---|---|---|
| ASR | WhisperX large-v3 + pyannote 3.1 (gated, HF_TOKEN) | faster-whisper large-v3 |
| Diarization | pyannote 3.1 | ECAPA-TDNN (speechbrain) + AgglomerativeClustering |
| LLM | vLLM Mistral-Small-3.2 fp16 | Ollama Mistral-Small-3.2 Q4_K_M (stesso modello, peso minore) |
| TTS | Piper (uguale) | Piper (uguale) |
| Storage artifact | object storage + DB | DB inline (push_to_db.js) + blob solo per audio |
| Trigger | webhook Jibri-finalize | manuale |

La qualità dell'output è confrontabile per le call brevi (<1h). Per
audio molto pulito il diarization custom è un po' più rumoroso del
pyannote 3.1 (silhouette 0.28 vs ~0.45) — ma si correggono i SPEAKER_xx
spuri a mano nella UI admin.

## Note operative

- Il push allo stesso `recordingId` è idempotente: cancella job/speaker/artifact
  precedenti e ricrea da zero. Safe per re-run.
- Il transcript inline ha contentHash sha256 (cache invalidation).
- Tutti gli artifact `isSynthetic=true` (AI Act Art. 50).
- I file > 64KB (es. dubbed audio) sono persistiti come blob; il resto
  va in `inlineBody` (cifrato col helper PII in produzione, in chiaro
  in questa shortcut locale — solo test, non usarla per dati reali).
