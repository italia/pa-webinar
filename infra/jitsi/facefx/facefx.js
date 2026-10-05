/**
 * paFaceFx — PoC "fase 1" di miglioramento volti SENZA ML e senza licenze:
 * auto-esposizione (levels da istogramma luma), gamma adattiva, white balance
 * gray-world e un filo di vibrance, applicati in un singolo pass WebGL2 sul
 * flusso della webcam via Insertable Streams.
 *
 * COME SI INIETTA: incollato dentro `_custom_config_js` del container web
 * Jitsi (values Helm, come già facciamo per STUN/TURN). config.js viene
 * eseguito PRIMA di lib-jitsi-meet, quindi il monkey-patch di getUserMedia
 * è in piedi prima che Jitsi chieda la camera. Fonte di verità: QUESTO file
 * nel repo; la copia nei values va tenuta in sync (PoC).
 *
 * OPT-IN (default: spento, nessun effetto per gli altri utenti del tenant):
 *   - hash dell'iframe: l'app aggiunge `paFaceFx: true` al configOverwrite
 *     (finisce nel fragment dell'URL iframe), oppure
 *   - localStorage.paFaceFx = '1' nell'origin Jitsi (per prove manuali).
 *
 * SOLO Chromium (MediaStreamTrackProcessor/Generator): altrove è un no-op
 * totale. Qualunque errore a runtime degrada a passthrough dei frame
 * originali — mai una call rotta per colpa del filtro.
 *
 * NON tocca: getDisplayMedia (screenshare), tracce audio.
 */
(function () {
  'use strict';

  var TAG = '[paFaceFx]';

  function isEnabled() {
    try {
      if (window.localStorage && localStorage.getItem('paFaceFx') === '1') return true;
      // Il fragment IFrame API serializza configOverwrite: cerchiamo la chiave
      // in modo permissivo (URL-encoding possibile: %22paFaceFx%22:true).
      var h = String(window.location.hash || '');
      return /paFaceFx(%22)?[=:](%22)?(true|1)/i.test(h);
    } catch (e) {
      return false;
    }
  }

  var supported =
    typeof window.MediaStreamTrackProcessor === 'function' &&
    typeof window.MediaStreamTrackGenerator === 'function' &&
    typeof window.OffscreenCanvas === 'function' &&
    typeof window.VideoFrame === 'function' &&
    // Contesti senza mediaDevices (origin non sicuri, iframe sandbox):
    // il patch non ha niente da avvolgere — no-op, mai un throw al load.
    !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');

  if (!supported) return;

  // ── Analisi frame (CPU, su thumbnail 64×36 ogni STATS_EVERY frame) ────────
  var STATS_W = 64;
  var STATS_H = 36;
  var STATS_EVERY = 12; // ~2,5 volte/s a 30fps
  var EMA_ALPHA = 0.18; // smoothing dei parametri: ~1s per convergere, niente pumping

  function makeAnalyzer() {
    var canvas = new OffscreenCanvas(STATS_W, STATS_H);
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    return function analyze(frame) {
      ctx.drawImage(frame, 0, 0, STATS_W, STATS_H);
      var data = ctx.getImageData(0, 0, STATS_W, STATS_H).data;
      var hist = new Uint32Array(256);
      var rSum = 0;
      var gSum = 0;
      var bSum = 0;
      var n = STATS_W * STATS_H;
      for (var i = 0; i < data.length; i += 4) {
        var r = data[i];
        var g = data[i + 1];
        var b = data[i + 2];
        rSum += r;
        gSum += g;
        bSum += b;
        hist[(0.2126 * r + 0.7152 * g + 0.0722 * b) | 0]++;
      }
      // Percentili 2/98 e mediana dall'istogramma luma.
      var p2 = 0;
      var p50 = 0;
      var p98 = 255;
      var acc = 0;
      var t2 = n * 0.02;
      var t50 = n * 0.5;
      var t98 = n * 0.98;
      var seen2 = false;
      var seen50 = false;
      for (var v = 0; v < 256; v++) {
        acc += hist[v];
        if (!seen2 && acc >= t2) { p2 = v; seen2 = true; }
        if (!seen50 && acc >= t50) { p50 = v; seen50 = true; }
        if (acc >= t98) { p98 = v; break; }
      }
      return {
        p2: p2 / 255,
        p50: p50 / 255,
        p98: p98 / 255,
        rMean: rSum / n / 255,
        gMean: gSum / n / 255,
        bMean: bSum / n / 255,
      };
    };
  }

  // Dai numeri grezzi ai target dei parametri shader, con clamp prudenti:
  // meglio correggere poco che produrre facce "sparate".
  function computeTargets(s) {
    var black = Math.min(s.p2, 0.20);
    var white = Math.max(s.p98, black + 0.35, 0.75);
    var span = white - black;
    var medLin = Math.min(Math.max((s.p50 - black) / span, 0.02), 0.98);
    // gamma > 1 schiarisce: porta la mediana verso 0.5. Clamp [0.75, 1.9]:
    // sotto-esposizioni tipiche da webcam senza mai "bruciare" scene già ok.
    var gamma = Math.log(medLin) / Math.log(0.5);
    gamma = Math.min(Math.max(gamma, 0.75), 1.9);
    // Gray-world white balance: gain per canale verso la media di luminanza,
    // clampati ±20% (le dominanti forti di solito sono la stanza, non un errore).
    var lum = 0.2126 * s.rMean + 0.7152 * s.gMean + 0.0722 * s.bMean;
    var eps = 1e-4;
    function gain(ch) {
      return Math.min(Math.max(lum / Math.max(ch, eps), 0.8), 1.2);
    }
    return {
      black: black,
      white: white,
      gamma: gamma,
      wbR: gain(s.rMean),
      wbG: gain(s.gMean),
      wbB: gain(s.bMean),
    };
  }

  // ── Pipeline WebGL2: un pass fullscreen, uniforms dai target EMA ─────────
  var VS =
    '#version 300 es\n' +
    'const vec2 P[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));' +
    'out vec2 v_uv;' +
    'void main(){vec2 p=P[gl_VertexID];v_uv=vec2((p.x+1.)*.5,1.-(p.y+1.)*.5);gl_Position=vec4(p,0.,1.);}';

  var FS =
    '#version 300 es\n' +
    'precision mediump float;' +
    'uniform sampler2D u_tex;' +
    'uniform float u_black,u_white,u_gamma,u_strength;' +
    'uniform vec3 u_wb;' +
    'in vec2 v_uv;out vec4 o;' +
    'void main(){' +
    '  vec4 src=texture(u_tex,v_uv);' +
    '  vec3 c=src.rgb*u_wb;' +                                  // white balance
    '  c=clamp((c-u_black)/max(u_white-u_black,1e-3),0.,1.);' + // levels
    '  c=pow(c,vec3(1.0/u_gamma));' +                           // gamma adattiva
    '  float l=dot(c,vec3(.2126,.7152,.0722));' +
    '  c=mix(vec3(l),c,1.06);' +                                // vibrance leggera
    '  o=vec4(mix(src.rgb,c,u_strength),src.a);' +
    '}';

  function makeRenderer() {
    var canvas = new OffscreenCanvas(2, 2);
    var gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      desynchronized: true,
    });
    if (!gl) return null;

    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('shader: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var U = {
      black: gl.getUniformLocation(prog, 'u_black'),
      white: gl.getUniformLocation(prog, 'u_white'),
      gamma: gl.getUniformLocation(prog, 'u_gamma'),
      strength: gl.getUniformLocation(prog, 'u_strength'),
      wb: gl.getUniformLocation(prog, 'u_wb'),
    };
    gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);

    return {
      render: function (frame, w, h, p) {
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          gl.viewport(0, 0, w, h);
        }
        gl.uniform1f(U.black, p.black);
        gl.uniform1f(U.white, p.white);
        gl.uniform1f(U.gamma, p.gamma);
        gl.uniform1f(U.strength, p.strength);
        gl.uniform3f(U.wb, p.wbR, p.wbG, p.wbB);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return canvas;
      },
      isLost: function () {
        return gl.isContextLost();
      },
    };
  }

  /**
   * Avvolge una MediaStreamTrack video: ritorna la track processata.
   * Facade: settings/constraints/capabilities/stop sono delegati alla
   * sorgente così Jitsi (risoluzione, device switching, mute-che-stoppa)
   * continua a funzionare come se avesse la track originale in mano.
   */
  function createFxTrack(srcTrack) {
    var processor = new MediaStreamTrackProcessor({ track: srcTrack });
    var generator = new MediaStreamTrackGenerator({ kind: 'video' });
    var reader = processor.readable.getReader();
    var writer = generator.writable.getWriter();
    var renderer = makeRenderer();
    var analyze = makeAnalyzer();

    // Parametri correnti (EMA) — partono neutri: i primi frame passano
    // praticamente invariati mentre l'analisi converge.
    var params = { black: 0, white: 1, gamma: 1, wbR: 1, wbG: 1, wbB: 1, strength: 1 };
    var frameCount = 0;
    var bypass = !renderer;
    var stopped = false;
    var consecutiveErrors = 0;

    function teardown() {
      if (stopped) return;
      stopped = true;
      try { reader.cancel(); } catch (e) { /* già chiuso */ }
      try { writer.close(); } catch (e) { /* già chiuso */ }
    }

    async function pump() {
      for (;;) {
        var res;
        try {
          res = await reader.read();
        } catch (e) {
          break;
        }
        if (res.done || stopped) break;
        var frame = res.value;
        var out = null;
        if (!bypass) {
          try {
            if (frameCount % STATS_EVERY === 0) {
              var t = computeTargets(analyze(frame));
              params.black += (t.black - params.black) * EMA_ALPHA;
              params.white += (t.white - params.white) * EMA_ALPHA;
              params.gamma += (t.gamma - params.gamma) * EMA_ALPHA;
              params.wbR += (t.wbR - params.wbR) * EMA_ALPHA;
              params.wbG += (t.wbG - params.wbG) * EMA_ALPHA;
              params.wbB += (t.wbB - params.wbB) * EMA_ALPHA;
            }
            frameCount++;
            var w = frame.displayWidth;
            var h = frame.displayHeight;
            var canvas = renderer.render(frame, w, h, params);
            out = new VideoFrame(canvas, {
              timestamp: frame.timestamp,
              duration: frame.duration || undefined,
            });
            consecutiveErrors = 0;
          } catch (e) {
            out = null;
            consecutiveErrors++;
            if (consecutiveErrors >= 5 || (renderer && renderer.isLost())) {
              bypass = true; // degradazione permanente a passthrough
              console.warn(TAG, 'render in errore, passthrough permanente:', e);
            }
          }
        }
        try {
          if (out) {
            frame.close();
            await writer.write(out); // il sink chiude out
          } else {
            await writer.write(frame); // passthrough: il sink chiude frame
          }
        } catch (e) {
          try { frame.close(); } catch (e2) { /* già trasferito */ }
          break;
        }
      }
      teardown();
    }

    pump();

    // ── Facade verso Jitsi ──
    generator.getSettings = function () { return srcTrack.getSettings(); };
    generator.getConstraints = function () { return srcTrack.getConstraints(); };
    if (srcTrack.getCapabilities) {
      generator.getCapabilities = function () { return srcTrack.getCapabilities(); };
    }
    generator.applyConstraints = function (c) { return srcTrack.applyConstraints(c); };
    var generatorStop = generator.stop.bind(generator);
    generator.stop = function () {
      teardown();
      try { srcTrack.stop(); } catch (e) { /* già ferma */ }
      generatorStop();
    };
    srcTrack.addEventListener('ended', function () {
      teardown();
      generatorStop();
    });

    return generator;
  }

  // ── Monkey-patch di getUserMedia ──────────────────────────────────────────
  var origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    var stream = await origGUM(constraints);
    try {
      if (!constraints || !constraints.video || !isEnabled()) return stream;
      var videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) return stream;
      var fxTrack = createFxTrack(videoTrack);
      var out = new MediaStream();
      out.addTrack(fxTrack);
      stream.getAudioTracks().forEach(function (t) { out.addTrack(t); });
      console.info(TAG, 'attivo su', videoTrack.label || 'camera');
      return out;
    } catch (e) {
      console.warn(TAG, 'init fallita, stream originale:', e);
      return stream;
    }
  };

  // Hook di debug/test (usato dall'harness Playwright).
  window.__paFaceFx = {
    createFxTrack: createFxTrack,
    isEnabled: isEnabled,
    version: 'poc-1',
  };
})();
