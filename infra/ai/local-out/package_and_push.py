#!/usr/bin/env python3
"""
Costruisce il payload finale e lo passa a `push_to_db.js` via stdin
attraverso `kubectl exec`. Carica anche il dubbed audio su Azure Blob.

Output: db_push_payload.json (per audit) + esecuzione effettiva.
"""
import json
import os
import subprocess as sp
import sys
from pathlib import Path

HERE = Path(__file__).parent
RECORDING_ID = "696e0be6-d4cd-4ccc-97bd-72edddcaec8f"
EVENT_ID = "5ecf7a8c-bb0e-4b81-b7a6-453b5f831fd1"
DUBBED_LOCAL = HERE / "dubbed_en.m4a"
SUMMARY_FILE = HERE / "summary.json"
TX_FILE = HERE / "transcript_diarized.json"


def md_summary(summary_obj, *, lang="it"):
    """Costruisce un markdown leggibile dalle chiavi del summary."""
    sm = summary_obj
    lines = []
    h_overall = "Sintesi generale" if lang == "it" else "Overall summary"
    h_dec = "Decisioni chiave" if lang == "it" else "Key decisions"
    h_act = "Azioni" if lang == "it" else "Action items"
    h_top = "Argomenti trattati" if lang == "it" else "Topics covered"
    lines.append(f"## {h_overall}\n")
    lines.append(sm.get("overall_summary", "").strip() + "\n")
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
            lines.append(t.get("summary", "").strip())
    return "\n".join(lines)


def main():
    with open(SUMMARY_FILE) as f:
        sm = json.load(f)
    with open(TX_FILE) as f:
        tx = json.load(f)

    # Speaker map → applicalo nei segmenti per il transcript_json
    names = {k: v for k, v in (sm.get("speakers_named") or {}).items() if isinstance(v, str) and v.strip()}

    # Costruisco il transcript_json "canonico" — quello che il worker
    # tipicamente persiste come TRANSCRIPT_JSON.
    transcript_json = {
        "language": tx.get("language", "it"),
        "duration": tx["duration"],
        "model_id": "faster-whisper/large-v3",
        "model_version": "5090-local",
        "diarization": tx.get("diarization", {}),
        "speakers": tx.get("speakers", []),
        "segments": [
            {
                "start": s["start"],
                "end": s["end"],
                "text": s["text"],
                "speaker": s.get("speaker"),
                "words": s.get("words"),
            }
            for s in tx["segments"]
        ],
    }

    # File built da build_vtt.py
    def read(p):
        return (HERE / p).read_text()

    summary_md_it = md_summary(sm["summary_it"], lang="it")
    summary_md_en = md_summary(sm["summary_en"], lang="en")

    # 1) upload dubbed audio su Azure Blob (storage account developersitaliarec, container recordings, prefisso postprod/)
    blob_key = None
    if DUBBED_LOCAL.exists():
        # Mantieni stesso pattern di blobKey che il worker userebbe
        blob_key = f"postprod/{EVENT_ID}/{RECORDING_ID}/run-1/dubbed_audio-en.m4a"
        print(f"Uploading dubbed audio to blob: {blob_key}")
        # SAS via az storage account key (riuso il key trovato)
        key = os.environ.get("AZURE_KEY") or sp.run(
            ["az", "storage", "account", "keys", "list",
             "--account-name", "developersitaliarec",
             "--query", "[0].value", "-o", "tsv"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        sp.run(
            [
                "az", "storage", "blob", "upload",
                "--account-name", "developersitaliarec",
                "--account-key", key,
                "--container-name", "recordings",
                "--name", blob_key,
                "--file", str(DUBBED_LOCAL),
                "--overwrite",
                "--no-progress",
            ],
            check=True,
            capture_output=True,
        )
        print(f"  uploaded")
    else:
        print(f"Dubbed audio not found: {DUBBED_LOCAL}")

    payload = {
        "recordingId": RECORDING_ID,
        "sourceLanguage": tx.get("language", "it"),
        "summaryIt": sm["summary_it"],
        "summaryEn": sm["summary_en"],
        "speakersNamed": sm.get("speakers_named", {}),
        "transcriptJson": transcript_json,
        "transcriptVttIt": read("transcript_it.vtt"),
        "transcriptVttEn": read("transcript_en.vtt"),
        "transcriptTxtIt": read("transcript_pretty.txt"),
        "transcriptSrtIt": read("transcript_it.srt"),
        "transcriptSrtEn": read("transcript_en.srt"),
        "summaryMdIt": summary_md_it,
        "summaryMdEn": summary_md_en,
        "dubbedAudioBlobKey": blob_key,
        "publishRecording": True,
    }

    (HERE / "db_push_payload.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Payload saved: db_push_payload.json ({len(json.dumps(payload))} chars)")

    # 2) trova un pod dell'app, copia push_to_db.js, esegui via kubectl
    pod = sp.run(
        ["kubectl", "get", "pods", "-n", "videocall-test",
         "-l", "app.kubernetes.io/name=eventi-dtd",
         "--field-selector=status.phase=Running",
         "-o", "jsonpath={.items[0].metadata.name}"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    print(f"Pod: {pod}")
    sp.run(["kubectl", "cp", "-n", "videocall-test", "-c", "eventi-dtd",
            "push_to_db.js", f"{pod}:/tmp/push.js"], check=True)
    print("Pushing to DB via kubectl exec…")
    # NODE_PATH=/app/node_modules per risolvere @prisma/client dai
    # node_modules dell'app (il filesystem /app è read-only ma è
    # leggibile, basta puntare il loader lì).
    result = sp.run(
        ["kubectl", "exec", "-i", "-n", "videocall-test", pod,
         "-c", "eventi-dtd", "--",
         "sh", "-c", "cd /app && NODE_PATH=/app/node_modules node /tmp/push.js"],
        input=json.dumps(payload).encode(),
        capture_output=True,
    )
    print("STDOUT:", result.stdout.decode())
    if result.returncode != 0:
        print("STDERR:", result.stderr.decode())
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
