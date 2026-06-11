#!/usr/bin/env python3
"""
Costruisce il payload finale e lo passa a `push_to_db.js` via stdin
attraverso `kubectl exec`. Carica anche i dubbed audio (per lingua) su
Azure Blob. Multi-lingua: legge `target_langs` da summary.json.

Output: db_push_payload.json (audit) + esecuzione effettiva.
"""
import json
import os
import subprocess as sp
import sys
from pathlib import Path

HERE = Path(__file__).parent
RECORDING_ID = os.environ.get("RECORDING_ID", "837f1334-1b31-4c9c-bca7-03908e47100e")
EVENT_ID = os.environ.get("EVENT_ID", "523a1fc3-e276-4826-9e42-a275fb3dca84")
SUMMARY_FILE = HERE / "summary.json"
TX_FILE = HERE / "transcript_diarized.json"


def md_summary(summary_obj, *, lang="it"):
    """Markdown leggibile dalle chiavi del summary."""
    sm = summary_obj or {}
    lines = []
    h_overall = "Sintesi generale" if lang == "it" else "Overall summary"
    h_dec = "Decisioni chiave" if lang == "it" else "Key decisions"
    h_act = "Azioni" if lang == "it" else "Action items"
    h_top = "Argomenti trattati" if lang == "it" else "Topics covered"
    lines.append(f"## {h_overall}\n")
    lines.append((sm.get("overall_summary") or "").strip() + "\n")
    if sm.get("key_decisions"):
        lines.append(f"\n## {h_dec}\n")
        for k in sm["key_decisions"]:
            lines.append(f"- {k}")
    if sm.get("action_items"):
        lines.append(f"\n## {h_act}\n")
        for k in sm["action_items"]:
            lines.append(f"- {k}")
    if sm.get("topics"):
        lines.append(f"\n## {h_top}\n")
        for t in sm["topics"]:
            ts = t.get("start_mmss", "")
            lines.append(f"\n### [{ts}] {t.get('title', '')}\n")
            lines.append((t.get("summary") or "").strip())
    return "\n".join(lines)


def build_pipeline_snapshot(tx: dict, sm: dict, target_langs: list, dub_langs: list) -> dict:
    """Fotografia canonica della pipeline (trasparenza AI Act Art. 50)."""
    speakers_named = sm.get("speakers_named") or {}
    voice_assignments = []
    for sp_ in tx.get("speakers", []):
        voice_assignments.append({
            "diarLabel": sp_.get("diarLabel"),
            "displayName": speakers_named.get(sp_.get("diarLabel")) or None,
            "totalSpeechSec": sp_.get("totalSpeechSec"),
        })
    return {
        "asr": {
            "engine": "faster-whisper",
            "model": "large-v3",
            "version": "5090-local",
            "initialPromptUsed": True,
            "hallucinationFiltering": "avg_logprob<-1.0 || no_speech_prob>0.6",
            "diarization": {
                "engine": "speechbrain ECAPA-TDNN",
                "model": "spkrec-ecapa-voxceleb",
                "method": tx.get("diarization", {}).get("method"),
                "k": tx.get("diarization", {}).get("k"),
                "silhouette": tx.get("diarization", {}).get("silhouette"),
            },
        },
        "llm": {
            "engine": os.environ.get("LLM_ENGINE", "ollama"),
            "model": sm.get("model") or "mistral-small3.2:24b",
            "vendor": "Mistral AI",
            "license": "Apache-2.0",
            "country": "FR",
        },
        "tts": {
            "engine": "piper-tts",
            "license": "MIT",
            "voiceAssignmentPolicy": "deterministic-by-speech-time, gender-aware",
        },
        "voiceAssignments": voice_assignments,
        "languages": {
            "source": tx.get("language") or "it",
            "translation": target_langs,
            "dubbing": dub_langs,
        },
        "runAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "pipelineVersion": os.environ.get("PIPELINE_VERSION", "local-rtx5090"),
    }


def main():
    with open(SUMMARY_FILE) as f:
        sm = json.load(f)
    with open(TX_FILE) as f:
        tx = json.load(f)

    target_langs = sm.get("target_langs") or ["en"]

    def read(p):
        return (HERE / p).read_text() if (HERE / p).exists() else ""

    transcript_json = {
        "language": tx.get("language", "it"),
        "duration": tx["duration"],
        "model_id": "faster-whisper/large-v3",
        "model_version": "5090-local",
        "diarization": tx.get("diarization", {}),
        "speakers": tx.get("speakers", []),
        "segments": [
            {
                "start": s["start"], "end": s["end"], "text": s["text"],
                "speaker": s.get("speaker"), "words": s.get("words"),
                "avg_logprob": s.get("avg_logprob"), "no_speech_prob": s.get("no_speech_prob"),
            }
            for s in tx["segments"]
        ],
    }

    # Azure storage key (una volta) per gli upload dubbed.
    az_key = os.environ.get("AZURE_KEY") or sp.run(
        ["az", "storage", "account", "keys", "list", "--account-name", "developersitaliarec",
         "--query", "[0].value", "-o", "tsv"], capture_output=True, text=True, check=True,
    ).stdout.strip()

    translations = []
    dub_langs = []
    for lang in target_langs:
        sm_lang = sm.get(f"summary_{lang}")
        dub_local = HERE / f"dubbed_{lang}.m4a"
        dub_blob = None
        if dub_local.exists():
            dub_blob = f"postprod/{EVENT_ID}/{RECORDING_ID}/run-1/dubbed_audio-{lang}.m4a"
            print(f"Uploading dubbed {lang} -> {dub_blob}")
            sp.run(["az", "storage", "blob", "upload", "--account-name", "developersitaliarec",
                    "--account-key", az_key, "--container-name", "recordings", "--name", dub_blob,
                    "--file", str(dub_local), "--overwrite", "--no-progress"],
                   check=True, capture_output=True)
            dub_langs.append(lang)
        else:
            print(f"dubbed_{lang}.m4a not found — no dub for {lang}")
        translations.append({
            "lang": lang,
            "vtt": read(f"transcript_{lang}.vtt"),
            "srt": read(f"transcript_{lang}.srt"),
            "summaryMd": md_summary(sm_lang, lang=lang) if sm_lang else "",
            "summaryJson": sm_lang,
            "dubbedBlobKey": dub_blob,
        })

    payload = {
        "recordingId": RECORDING_ID,
        "sourceLanguage": tx.get("language", "it"),
        "summaryIt": sm["summary_it"],
        "summaryMdIt": md_summary(sm["summary_it"], lang="it"),
        "speakersNamed": sm.get("speakers_named", {}),
        "transcriptJson": transcript_json,
        "transcriptVttIt": read("transcript_it.vtt"),
        "transcriptTxtIt": read("transcript_pretty.txt"),
        "transcriptSrtIt": read("transcript_it.srt"),
        "translations": translations,
        "pipelineSnapshot": build_pipeline_snapshot(tx, sm, target_langs, dub_langs),
        "publishRecording": True,
    }

    (HERE / "db_push_payload.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Payload saved; langs: it + {target_langs}; dub: {dub_langs}")

    pod = sp.run(
        ["kubectl", "get", "pods", "-n", "videocall-test", "-l", "app.kubernetes.io/name=pa-webinar",
         "--field-selector=status.phase=Running", "-o", "jsonpath={.items[0].metadata.name}"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    print(f"Pod: {pod}")
    sp.run(["kubectl", "cp", "-n", "videocall-test", "-c", "pa-webinar",
            str(HERE / "push_to_db.js"), f"{pod}:/tmp/push.js"], check=True)
    print("Pushing to DB via kubectl exec…")
    result = sp.run(
        ["kubectl", "exec", "-i", "-n", "videocall-test", pod, "-c", "pa-webinar", "--",
         "sh", "-c", "cd /app && NODE_PATH=/app/node_modules node /tmp/push.js"],
        input=json.dumps(payload).encode(), capture_output=True,
    )
    print("STDOUT:", result.stdout.decode())
    if result.returncode != 0:
        print("STDERR:", result.stderr.decode())
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
