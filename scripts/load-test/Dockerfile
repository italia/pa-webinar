# Image pre-built per eseguire jitsi-meet-torture in locale contro un deploy
# eventi-dtd. Include: OpenJDK 17, Maven, Google Chrome stable, chromedriver
# matched, xvfb, jitsi-meet-torture clonato. Il JWT viene generato ogni volta
# dall'entrypoint leggendo le env JITSI_JWT_*.
#
# Build:
#   docker build -t eventi-dtd-load-test scripts/load-test/
#   # oppure con podman
#   podman build -t eventi-dtd-load-test scripts/load-test/
#
# Run: vedi scripts/load-test/run-local.sh
FROM docker.io/library/maven:3.9-eclipse-temurin-17

ENV DEBIAN_FRONTEND=noninteractive

# Base deps + xvfb (Chrome 147+ ha rimosso l'headless legacy)
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends -qq \
      git ca-certificates curl gnupg unzip python3 xvfb jq openssl \
      fonts-liberation libnss3 libxss1 libatk-bridge2.0-0 \
      libgtk-3-0 libgbm1 libxkbcommon0 xdg-utils \
 && (apt-get install -y --no-install-recommends -qq libasound2t64 || \
     apt-get install -y --no-install-recommends -qq libasound2) \
 && rm -rf /var/lib/apt/lists/*

# Google Chrome stable dal repo ufficiale (Ubuntu's chromium è uno snap wrapper
# che non funziona in container)
RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update -qq \
 && apt-get install -y --no-install-recommends -qq google-chrome-stable \
 && rm -rf /var/lib/apt/lists/*

# chromedriver matched con Chrome tramite il Chrome for Testing JSON API
RUN set -eux; \
    CFT_VERSION=$(curl -fsSL https://googlechromelabs.github.io/chrome-for-testing/LATEST_RELEASE_STABLE); \
    curl -fsSL "https://storage.googleapis.com/chrome-for-testing-public/${CFT_VERSION}/linux64/chromedriver-linux64.zip" \
      -o /tmp/chromedriver.zip; \
    unzip -q /tmp/chromedriver.zip -d /tmp/; \
    install -m 0755 /tmp/chromedriver-linux64/chromedriver /usr/bin/chromedriver; \
    rm -rf /tmp/chromedriver.zip /tmp/chromedriver-linux64; \
    /usr/bin/chromedriver --version

# Clone jitsi-meet-torture e pre-fetch dipendenze Maven, così al primo run
# non servono 2+ minuti di download dalla rete
RUN git clone --depth=1 https://github.com/jitsi/jitsi-meet-torture.git /torture
WORKDIR /torture
RUN mvn -q -B dependency:go-offline || true

# Fix upstream Malleus bug #1: la costante INPUT_VIDEO_FILE hardcoded a
# "resources/FourPeople_1280x720_30.y4m" ma il file presente nel repo è
# "fakeVideoStream.y4m" a 320x180@5fps. Jitsi Meet richiede ~1280x720@30,
# altrimenti getUserMedia fallisce con "Constraint could not be satisfied".
# Usiamo ffmpeg per transcodificare il y4m bundled a 1280x720@30 e salvarlo
# come FourPeople_1280x720_30.y4m (lo stesso path hardcoded da Malleus).
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends -qq ffmpeg \
 && ffmpeg -nostdin -loglevel error -i /torture/resources/fakeVideoStream.y4m \
      -vf "scale=1280:720:flags=lanczos" -r 30 -pix_fmt yuv420p \
      /torture/resources/FourPeople_1280x720_30.y4m \
 && head -c 80 /torture/resources/FourPeople_1280x720_30.y4m | head -1 \
 && ls -la /torture/resources/FourPeople_1280x720_30.y4m

# Fix upstream Malleus bug #2: rimuove l'append di
# "config.prejoinConfig.enabled=false" dalla URL di join. Il codice di
# jitsi-meet/conference.js (react/features/base/config/functions.any.ts:387)
# forza `config.disableInitialGUM = true` quando la URL contiene quel
# parametro E il client non è embedded. Risultato: createInitialLocalTracks
# ritorna 0 tracce, nessun media, nessuna pubblicazione.
# Rimuovendo la riga, la guardia di Jitsi Meet non scatta.
# Il deploy di destinazione deve comunque avere ENABLE_PREJOIN_PAGE=false
# per evitare che compaia la schermata di prejoin.
RUN sed -i 's|+ "&config.prejoinConfig.enabled=false"||' \
      /torture/src/test/java/org/jitsi/meet/test/web/WebParticipant.java \
 && ! grep -q "config.prejoinConfig.enabled=false" /torture/src/test/java/org/jitsi/meet/test/web/WebParticipant.java \
 && echo "prejoin patch applied"

COPY mint-jwt.sh /usr/local/bin/mint-jwt.sh
COPY run-torture-local.sh /usr/local/bin/run-torture-local.sh
RUN chmod +x /usr/local/bin/mint-jwt.sh /usr/local/bin/run-torture-local.sh

ENTRYPOINT ["/usr/local/bin/run-torture-local.sh"]
