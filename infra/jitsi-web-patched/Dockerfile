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
FROM jitsi/web:stable-10741 AS base

# "Nascondi la tua immagine" is a one-way trap for anyone already caught by it
# (live report: a participant saw everyone but himself, while everyone saw him).
#
# WHY A PATCH: the app already sets `disableSelfViewSettings: true`, which hides
# the control so nobody NEW can get stuck — but it does nothing for a browser
# where the flag was already stored. Jitsi keeps that choice in localStorage
# (`features/base/settings`, origin = the Jitsi host, so the embedding app cannot
# reach it), and the selector ORs the two sources:
#
#   config.disableSelfView || settings.disableSelfView || isVisitor
#
# so `configOverwrite.disableSelfView = false` cannot win — the stored `true`
# still hides the tile, with no UI left to undo it. Only an incognito window or
# clearing that origin's site data rescued the user.
#
# The patch makes an EXPLICIT `config.disableSelfView === false` authoritative
# over the stored setting, leaving the visitor rule untouched (a visitor must
# still not get a self view). The app then pins the flag to false and every
# stuck browser recovers on its next join.
#
# Done in a node stage rather than with `sed`: the needle is full of regex and
# replacement metacharacters (`.`, `[`, `]`, `&&`), and node does a literal,
# assertion-checked replacement with nothing to escape. The base image is a
# static-file nginx image with no scripting runtime of its own.
FROM node:20-alpine AS patcher
COPY --from=base /usr/share/jitsi-meet/libs/app.bundle.min.js /work/app.bundle.min.js
RUN node -e "\
const fs = require('fs'); \
const p = '/work/app.bundle.min.js'; \
const OLD = 'e[\"features/base/config\"].disableSelfView||e[\"features/base/settings\"].disableSelfView||e9(e)'; \
const NEW = '(!1!==e[\"features/base/config\"].disableSelfView&&(e[\"features/base/config\"].disableSelfView||e[\"features/base/settings\"].disableSelfView))||e9(e)'; \
const src = fs.readFileSync(p, 'utf8'); \
const n = src.split(OLD).length - 1; \
if (n !== 1) { console.error('FATAL: expected exactly 1 self-view selector, found ' + n + ' (base image changed?)'); process.exit(1); } \
const out = src.replace(OLD, NEW); \
if (out.split(NEW).length - 1 !== 1 || out.includes(OLD)) { console.error('FATAL: self-view patch verification failed'); process.exit(1); } \
fs.writeFileSync(p, out); \
console.log('OK: an explicit config.disableSelfView=false now overrides the stored setting'); \
"

FROM base
COPY --from=patcher /work/app.bundle.min.js /usr/share/jitsi-meet/libs/app.bundle.min.js

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

# Flying reaction emoji must not swallow clicks on the toolbar (live feedback #3).
#
# WHY: `.reactions-animations-container` is rendered as a SIBLING of
# `#videoconference_page` (Conference.render mounts it after the page div), and
# `#videoconference_page` has `transform: translate3d(0,0,0)` — a stacking
# context that traps `.new-toolbox { z-index: 252 }` inside it. The sibling
# therefore paints ABOVE the toolbar regardless of that 252, and
# `.reaction-emoji` ships with no `pointer-events`, so a 32x32 emoji drifting
# across the control bar eats the click under it. That is the original #3 report
# ("in vista mosaico non si riesce a cliccare nessun pulsante"), which moved
# inside the iframe when we switched to NATIVE reactions — out of reach of the
# app's own stylesheet, hence this patch.
#
# The emoji are pure decoration: nothing in them is clickable, so disabling
# pointer events costs no behaviour. Appending (rather than sed-ing a rule we do
# not control) survives upstream CSS reshuffles. The guards are fail-loud, not
# idempotent-retry: a marker already present means the base image is not the
# pristine upstream one we think it is, and appending a second copy would hide
# that — so the build stops instead.
RUN set -eu; \
    C=/usr/share/jitsi-meet/css/all.css; \
    [ -f "$C" ] || { echo "FATAL: $C not found (base image layout changed?)"; exit 1; }; \
    grep -qF 'pa-webinar reactions overlay' "$C" && { echo "FATAL: patch already present"; exit 1; }; \
    grep -qF '.reactions-animations-container' "$C" || { echo "FATAL: .reactions-animations-container missing from $C (reactions UI changed?)"; exit 1; }; \
    printf '\n/* pa-webinar reactions overlay: flying emoji must never intercept toolbar clicks (feedback #3) */\n.reactions-animations-container,.reactions-animations-container *{pointer-events:none!important}\n' >> "$C"; \
    grep -qF 'pa-webinar reactions overlay' "$C" || { echo "FATAL: append did not land in $C"; exit 1; }; \
    echo "OK: reaction emoji overlay set to pointer-events:none"
