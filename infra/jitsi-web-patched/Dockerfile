# Patched jitsi/web — forces the rnnoise noise-suppression AudioContext to 48 kHz.
#
# WHY (F18): jitsi/web:stable-10741 creates the noise-suppression AudioContext
# with no explicit sampleRate, so it adopts the hardware default rate. When that
# is not 48 kHz (e.g. 44.1 kHz), the NON-resampling rnnoise worklet processes the
# samples as if they were 48 kHz and garbles / SILENCES the microphone. The bug
# persists in every upstream tag and on master, so a plain image bump does not
# fix it — we patch the built bundle in place. Forcing the context to 48 kHz makes
# the Web Audio graph resample the mic input to 48 kHz, giving the worklet the
# exact rate it assumes.
#
# The surgical edit in app.bundle.min.js (minified var `Xy` = the noise-
# suppression context; `Xy.audioWorklet.addModule('.../noise-suppressor-worklet…')`):
#   Xy||(Xy=new AudioContext)  ->  Xy||(Xy=new AudioContext({sampleRate:48000}))
# It inserts a balanced `({sampleRate:48000})` and is the ONLY AudioContext touched
# — the separate local audio-mixer context (`this.audioContext=new AudioContext`)
# is intentionally left alone. The build FAILS unless the target appears EXACTLY
# once before and the patched form exactly once (with the unpatched form gone)
# after — guarding against both a missing target (base tag changed) and an
# ambiguous over-patch that would silently ship a broken bundle.
#
# Base tag is PINNED to the exact prod-served build so the minified identifiers,
# and prosody/jicofo/jvb compatibility, are unchanged. Bump both the FROM tag and
# the image tag together when the served jitsi/web version changes.
FROM jitsi/web:stable-10741

# hadolint ignore=DL4006
# Count OCCURRENCES with `grep -oF … | wc -l` (NOT `grep -c`, which counts
# matching LINES — always 1 on this single-line minified bundle). -F pins the
# needle as a literal so the `(){}` are not regex. The target must appear EXACTLY
# once (0 = base changed / already patched; >1 = ambiguous, refuse to guess), and
# after the single (non-global) sed the unpatched form must be gone and the
# patched form present exactly once.
RUN set -eu; \
    B=/usr/share/jitsi-meet/libs/app.bundle.min.js; \
    cnt() { grep -oF "$1" "$B" | wc -l | tr -d ' '; }; \
    before="$(cnt 'Xy=new AudioContext)')"; \
    [ "$before" = "1" ] || { echo "FATAL: expected exactly 1 rnnoise patch target in $B, found $before (base image changed?)"; exit 1; }; \
    sed -i 's/Xy=new AudioContext)/Xy=new AudioContext({sampleRate:48000}))/' "$B"; \
    after="$(cnt 'Xy=new AudioContext({sampleRate:48000}))')"; \
    remaining="$(cnt 'Xy=new AudioContext)')"; \
    { [ "$after" = "1" ] && [ "$remaining" = "0" ]; } || { echo "FATAL: rnnoise patch verification failed (patched=$after, unpatched-remaining=$remaining)"; exit 1; }; \
    echo "OK: rnnoise noise-suppression AudioContext forced to 48 kHz (1 site)"
