#!/bin/sh
# Recorder entrypoint (ADR-013).
#
# Best-effort virtual audio SINK so headless Chrome's WebRTC AudioDeviceModule
# runs a real playout thread. Together with the per-track hidden <audio>
# element in capture.ts, this makes Chrome DECODE remote audio instead of
# rendering pure silence (the -91 dB / empty-transcript bug). Headless Chrome
# has no audio output device by default, so its ADM decodes remote RTP to a
# null device and the WebAudio graph emits zeros.
#
# CRITICAL: this is NEVER fatal. If PulseAudio can't start (unprivileged uid,
# missing machine-id, etc.) we still exec the recorder — the media-element
# route may suffice, and we must not turn a silent-capture bug into a
# no-capture regression. Every step is guarded with `|| true`.
set -u

export HOME="${HOME:-/tmp}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime}"
mkdir -p "$XDG_RUNTIME_DIR" 2>/dev/null || true
chmod 700 "$XDG_RUNTIME_DIR" 2>/dev/null || true

if command -v pulseaudio >/dev/null 2>&1; then
  pulseaudio --daemonize=yes --exit-idle-time=-1 --disallow-exit=false >/dev/null 2>&1 \
    || echo "[entrypoint] pulseaudio failed to start — continuing without virtual sink"
  if command -v pactl >/dev/null 2>&1; then
    i=0
    while [ "$i" -lt 5 ]; do
      pactl info >/dev/null 2>&1 && break
      i=$((i + 1))
      sleep 1
    done
    pactl load-module module-null-sink sink_name=vsink >/dev/null 2>&1 || true
    pactl set-default-sink vsink >/dev/null 2>&1 || true
    echo "[entrypoint] virtual audio sink: $(pactl info >/dev/null 2>&1 && echo ready || echo unavailable)"
  fi
else
  echo "[entrypoint] pulseaudio not installed — continuing without virtual sink"
fi

exec node dist/index.js
