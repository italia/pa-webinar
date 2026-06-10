#!/usr/bin/env python3
"""
Genera i file WebVTT compatibili con <track> del VideoPlayer:
- transcript_it.vtt   (sottotitoli IT, lingua sorgente)
- transcript_en.vtt   (sottotitoli EN, traduzione)
- transcript_named.json (versione con nomi reali se disponibili)

Anche un transcript_pretty.txt per i download .txt del player.
"""
import json


def fmt(t: float) -> str:
    h, rem = divmod(int(t), 3600)
    m, s = divmod(rem, 60)
    ms = int((t - int(t)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def write_vtt(segments, key, path, *, speaker_names=None):
    """Genera un file WebVTT con:
      - voice tag `<v Name>` per la semantica (screen reader, JS API)
      - prefisso "Name:" inline nel testo per la VISIBILITÀ. Il browser
        HTML5 ignora il `<v>` di default; aggiungere il nome al testo
        garantisce che chi guarda i sottotitoli sappia chi parla anche
        senza CSS `::cue(v)` (che è inconsistent cross-browser).
      - separatore in nuova riga: il nome è su una riga, il testo sotto.
        L'overlay sottotitoli mostra entrambi in posizioni stabili.
    """
    with open(path, "w") as f:
        f.write("WEBVTT\n\n")
        for i, s in enumerate(segments, 1):
            speaker = s.get("speaker", "")
            label = speaker_names.get(speaker) if speaker_names and speaker in speaker_names else speaker
            text = s.get(key, "").strip()
            if not text:
                continue
            # `<v Label>` per semantica + prefisso testuale per visibilità
            cue = f"<v {label}>{label}: {text}" if label else text
            f.write(f"{i}\n{fmt(s['start'])} --> {fmt(s['end'])}\n{cue}\n\n")


def main():
    with open("transcript_diarized.json") as f:
        tx = json.load(f)
    with open("summary.json") as f:
        sm = json.load(f)

    # Mapping nomi: gli speaker_named possono avere None values
    names_raw = sm.get("speakers_named") or {}
    names = {k: v for k, v in names_raw.items() if isinstance(v, str) and v.strip()}

    # IT (segmenti originali)
    write_vtt(tx["segments"], "text", "transcript_it.vtt", speaker_names=names)
    print(f"transcript_it.vtt  ({len(tx['segments'])} cues)")

    # Traduzioni: una VTT per ciascuna lingua target.
    target_langs = sm.get("target_langs") or ["en"]
    tr_by_lang = {}
    for lang in target_langs:
        segs_l = sm.get(f"transcript_{lang}", [])
        tr_by_lang[lang] = segs_l
        write_vtt(segs_l, f"text_{lang}", f"transcript_{lang}.vtt", speaker_names=names)
        print(f"transcript_{lang}.vtt  ({len(segs_l)} cues)")

    # Versione "named": riscrivo i segmenti applicando il mapping
    def apply_names(segs):
        out = []
        for s in segs:
            ss = dict(s)
            if ss.get("speaker") in names:
                ss["speaker_name"] = names[ss["speaker"]]
            out.append(ss)
        return out

    named = {
        "language": tx.get("language", "it"),
        "duration": tx["duration"],
        "speakers": tx.get("speakers", []),
        "speakers_named": names,
        "segments": apply_names(tx["segments"]),
        **{f"segments_{lang}": apply_names(tr_by_lang[lang]) for lang in target_langs},
    }
    with open("transcript_named.json", "w") as f:
        json.dump(named, f, indent=2, ensure_ascii=False)
    print("transcript_named.json")

    # Plain text dump: "MM:SS - Nome: testo"
    def mmss(t):
        m, s = divmod(int(t), 60)
        return f"{m:02d}:{s:02d}"

    with open("transcript_pretty.txt", "w") as f:
        last_sp = None
        for s in tx["segments"]:
            sp = s.get("speaker", "")
            label = names.get(sp, sp)
            line = s["text"].strip()
            if not line:
                continue
            if sp != last_sp:
                f.write(f"\n[{mmss(s['start'])}] {label}:\n")
                last_sp = sp
            f.write(f"  {line}\n")
    print("transcript_pretty.txt")

    # SRT (per chi preferisce SRT — il player ha già download .srt)
    def fmt_srt(t):
        h, rem = divmod(int(t), 3600)
        m, s = divmod(rem, 60)
        ms = int((t - int(t)) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    srt_targets = [("it", tx["segments"], "text")] + [
        (lang, tr_by_lang[lang], f"text_{lang}") for lang in target_langs
    ]
    for lang, segs, key in srt_targets:
        with open(f"transcript_{lang}.srt", "w") as f:
            for i, s in enumerate(segs, 1):
                text = s.get(key, "").strip()
                if not text:
                    continue
                sp = s.get("speaker", "")
                label = names.get(sp, sp)
                line = f"{label}: {text}" if label else text
                f.write(f"{i}\n{fmt_srt(s['start'])} --> {fmt_srt(s['end'])}\n{line}\n\n")
        print(f"transcript_{lang}.srt")


if __name__ == "__main__":
    main()
