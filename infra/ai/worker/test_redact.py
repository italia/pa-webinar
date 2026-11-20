# SPDX-License-Identifier: EUPL-1.2
# SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

"""Prove della rimozione da un video: i filtri di ffmpeg, la riga di comando,
il lavoro REDACT con un portale finto e, se ffmpeg c'e', un video vero di tre
secondi generato al volo."""

import base64
import json
import os
import shutil
import subprocess

import pytest

from . import redact as red

INFO = red.InfoVideo(duration=60.0, width=1280, height=720, has_video=True, has_audio=True)


def test_normalizza_ordina_unisce_e_taglia():
    intervalli = [
        {"start": 30, "end": 40},
        {"start": 5, "end": 10},
        {"start": 9.99, "end": 12},
        {"start": 55, "end": 90},
        {"start": 20, "end": 20},
        {"start": -3, "end": 1},
        {"inizio": 1},
    ]
    assert red.normalizza_intervalli(intervalli, 60.0) == [(0.0, 1.0), (5.0, 12.0), (30.0, 40.0), (55.0, 60.0)]


def test_normalizza_senza_durata_non_taglia_la_fine():
    assert red.normalizza_intervalli([{"start": 1, "end": 7200}], None) == [(1.0, 7200.0)]


def test_filtro_con_cartello_copre_e_silenzia_gli_stessi_intervalli():
    filtro = red.costruisci_filtro([(1.0, 2.5), (10.0, 12.0)], INFO, con_cartello=True)
    attivo = "between(t,1.000,2.500)+between(t,10.000,12.000)"
    assert "[1:v]scale=1280:720:force_original_aspect_ratio=decrease" in filtro
    assert f"[0:v][cartello]overlay=0:0:enable='{attivo}'" in filtro
    assert f"[0:a]volume=0:enable='{attivo}'[a]" in filtro
    # Niente tempi azzerati traccia per traccia: lo scarto fra audio e video resta.
    assert "setpts" not in filtro


def test_filtro_senza_cartello_usa_un_riquadro_pieno():
    filtro = red.costruisci_filtro([(1.0, 2.0)], INFO, con_cartello=False)
    assert "drawbox=x=0:y=0:w=iw:h=ih" in filtro
    assert "t=fill" in filtro
    assert "[1:v]" not in filtro


def test_filtro_solo_audio_e_niente_da_togliere():
    solo_audio = red.InfoVideo(duration=10.0, width=None, height=None, has_video=False, has_audio=True)
    filtro = red.costruisci_filtro([(1.0, 2.0)], solo_audio, con_cartello=True)
    assert filtro.startswith("[0:a]") and "[v]" not in filtro
    with pytest.raises(ValueError):
        red.costruisci_filtro([], INFO, con_cartello=True)


def test_comando_ricodifica_in_mp4_per_il_browser():
    cmd = red.costruisci_comando(
        sorgente="/w/in.mp4", uscita="/w/out.mp4", filtro="F", info=INFO, cartello="/w/card.png"
    )
    assert cmd[:6] == ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", "/w/in.mp4"]
    i = cmd.index("-loop")
    assert cmd[i : i + 6] == ["-loop", "1", "-t", "60.000", "-i", "/w/card.png"]
    assert cmd[cmd.index("-filter_complex") + 1] == "F"
    assert ["-map", "[v]"] == cmd[cmd.index("[v]") - 1 : cmd.index("[v]") + 1]
    assert "libx264" in cmd and "aac" in cmd and "+faststart" in cmd
    assert cmd[-1] == "/w/out.mp4"


def test_comando_senza_audio_ne_cartello():
    muto = red.InfoVideo(duration=None, width=640, height=360, has_video=True, has_audio=False)
    cmd = red.costruisci_comando(sorgente="a", uscita="b", filtro="F", info=muto, cartello=None)
    assert "-loop" not in cmd and "-an" in cmd and "[a]" not in cmd


def test_info_da_ffprobe():
    info = red.info_da_ffprobe(
        {
            "streams": [{"codec_type": "audio"}, {"codec_type": "video", "width": 1920, "height": 1080}],
            "format": {"duration": "12.5"},
        }
    )
    assert info == red.InfoVideo(duration=12.5, width=1920, height=1080, has_video=True, has_audio=True)
    assert red.info_da_ffprobe({}).has_video is False


def test_secondi_da_progresso():
    assert red.secondi_da_progresso("out_time_us=2500000\n") == 2.5
    assert red.secondi_da_progresso("out_time_ms=1000000") == 1.0
    assert red.secondi_da_progresso("frame=12") is None
    assert red.secondi_da_progresso("out_time_us=N/A") is None


def _lavoro(**redaction):
    from . import client as cli

    return cli.ClaimResponse(
        jobId="j",
        recordingId=None,
        kind="REDACT",
        payload={"intervals": [{"start": 1, "end": 2}]},
        attempts=2,
        leaseExpiresAt="2026-01-01T00:00:00Z",
        sourceDownloadUrl="https://storage.example/in.mp4",
        uploadTargets={
            "redactedVideo": {
                "url": "https://storage.example/put",
                "blobKey": "recordings/redacted/e/r/q.mp4",
                "contentType": "video/mp4",
            }
        },
        inputs=[],
        redaction=redaction or None,
        providerHints=cli.ProviderHints(),
    )


class _App:
    def __init__(self, consegna=None, stato=None):
        self.passi = []
        self.consegne = []
        self._consegna = consegna or {"ok": True}
        self._stato = stato or {"status": "RUNNING"}

    def progress(self, job_id, status, attempt=None, **_):
        assert attempt == 2
        self.passi.append(status)
        return self._stato

    def deliver_redaction(self, **kw):
        self.consegne.append(kw)
        return self._consegna


def _finto_storage(monkeypatch, tmp_path, scrivi=b"video"):
    from . import client as cli

    caricati = []

    def scarica(url, dest, **_):
        with open(dest, "wb") as f:
            f.write(b"sorgente")

    def carica(url, src, *, content_type):
        caricati.append((url, os.path.getsize(src), content_type))

    monkeypatch.setattr(cli, "download_to_file", scarica)
    monkeypatch.setattr(cli, "upload_from_file", carica)
    return caricati


def test_run_redact_ricodifica_carica_e_consegna(monkeypatch, tmp_path):
    from . import main

    caricati = _finto_storage(monkeypatch, tmp_path)
    visti = {}

    def rimuovi(sorgente, uscita, intervalli, *, cartello=None, avanzamento=None):
        visti["intervalli"] = intervalli
        visti["cartello"] = open(cartello, "rb").read() if cartello else None
        avanzamento(0.5)
        with open(uscita, "wb") as f:
            f.write(b"ripulito!")
        return red.InfoVideo(duration=12.5, width=1, height=1, has_video=True, has_audio=True)

    monkeypatch.setattr(red, "rimuovi_intervalli", rimuovi)
    app = _App()
    main.run_redact(app, _lavoro(intervals=[{"start": 3, "end": 4}], card=base64.b64encode(b"PNG").decode()))
    assert visti == {"intervalli": [{"start": 3, "end": 4}], "cartello": b"PNG"}
    assert caricati == [("https://storage.example/put", 9, "video/mp4")]
    assert app.consegne == [
        {"job_id": "j", "blob_key": "recordings/redacted/e/r/q.mp4", "size_bytes": 9, "attempt": 2, "duration_sec": 12.5}
    ]


def test_run_redact_si_ferma_se_un_altro_tentativo_ha_gia_consegnato(monkeypatch, tmp_path):
    from . import main

    _finto_storage(monkeypatch, tmp_path)
    monkeypatch.setattr(
        red, "rimuovi_intervalli", lambda s, u, i, **_: open(u, "wb").write(b"x")
    )
    with pytest.raises(main.LavoroChiuso):
        main.run_redact(_App(consegna={"ok": False, "superseded": True}), _lavoro())


def test_run_redact_si_ferma_se_il_lavoro_e_stato_chiuso(monkeypatch, tmp_path):
    from . import main

    _finto_storage(monkeypatch, tmp_path)
    app = _App(stato={"status": "FAILED"})
    with pytest.raises(main.LavoroChiuso):
        main.run_redact(app, _lavoro())
    assert app.consegne == []


def test_run_redact_senza_intervalli_fallisce():
    from . import main

    lavoro = _lavoro()
    lavoro.payload = {}
    with pytest.raises(RuntimeError):
        main.run_redact(_App(), lavoro)


def test_deliver_redaction_manda_chiave_dimensione_e_claim():
    import httpx

    from . import client as cli

    ricevute = []

    def gestore(req: httpx.Request) -> httpx.Response:
        ricevute.append((req.url.path, json.loads(req.content)))
        return httpx.Response(200, json={"ok": True, "rerun": True})

    app = cli.AppClient(base_url="http://portale", api_key="k", worker_id="w")
    app._client = httpx.Client(base_url="http://portale", transport=httpx.MockTransport(gestore))
    esito = app.deliver_redaction(job_id="j", blob_key="recordings/redacted/a.mp4", size_bytes=10, attempt=3)
    assert esito == {"ok": True, "rerun": True}
    assert ricevute == [
        (
            "/api/internal/recording-redaction",
            {"jobId": "j", "attempt": 3, "blobKey": "recordings/redacted/a.mp4", "sizeBytes": 10},
        )
    ]


SENZA_FFMPEG = shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None


def _genera(cartella):
    """Tre secondi di barre colorate e un tono, e un cartello rosso."""
    video = os.path.join(cartella, "in.mp4")
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=3",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video,
        ],
        check=True,
    )
    cartello = os.path.join(cartella, "card.png")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=128x72", "-frames:v", "1", cartello],
        check=True,
    )
    return video, cartello


def _volume_massimo(percorso, da, a):
    out = subprocess.run(
        ["ffmpeg", "-v", "info", "-ss", str(da), "-to", str(a), "-i", percorso, "-af", "volumedetect", "-f", "null", "-"],
        check=True,
        capture_output=True,
        text=True,
    ).stderr
    riga = next(r for r in out.splitlines() if "max_volume" in r)
    return float(riga.split("max_volume:")[1].split("dB")[0])


def _pixel_medio(percorso, istante):
    rgb = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-ss", str(istante), "-i", percorso,
            "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        check=True,
        capture_output=True,
    ).stdout
    return tuple(rgb[:3])


@pytest.mark.skipif(SENZA_FFMPEG, reason="ffmpeg non installato")
def test_video_vero_cartello_e_audio_muto_solo_nell_intervallo(tmp_path):
    video, cartello = _genera(str(tmp_path))
    uscita = os.path.join(str(tmp_path), "out.mp4")
    red.rimuovi_intervalli(video, uscita, [{"start": 1.0, "end": 2.0}], cartello=cartello)

    prima = red.analizza(video)
    dopo = red.analizza(uscita)
    assert dopo.has_video and dopo.has_audio
    assert (dopo.width, dopo.height) == (prima.width, prima.height)
    assert abs((dopo.duration or 0) - (prima.duration or 0)) < 0.2

    r, g, b = _pixel_medio(uscita, 1.5)
    assert r > 200 and g < 60 and b < 60
    assert _pixel_medio(uscita, 0.4) != (r, g, b)
    assert _volume_massimo(uscita, 1.2, 1.8) < -80
    assert _volume_massimo(uscita, 0.2, 0.8) > -30
    assert _volume_massimo(uscita, 2.2, 2.8) > -30


@pytest.mark.skipif(SENZA_FFMPEG, reason="ffmpeg non installato")
def test_video_vero_senza_cartello_copre_con_un_riquadro_scuro(tmp_path):
    video, _ = _genera(str(tmp_path))
    uscita = os.path.join(str(tmp_path), "out.mp4")
    red.rimuovi_intervalli(video, uscita, [{"start": 0.5, "end": 1.5}])
    r, g, b = _pixel_medio(uscita, 1.0)
    # Il blu scuro del design system (0x17324D), a meno della compressione.
    assert abs(r - 0x17) < 20 and abs(g - 0x32) < 20 and abs(b - 0x4D) < 20
