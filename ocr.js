'use strict';
/* Bon_Scan – Kamera, Bildaufbereitung und Texterkennung.
   Die Texterkennung läuft vollständig auf dem Gerät (Tesseract.js, deutsches Sprachmodell).
   Die Dateien liegen nach dem ersten Deploy unter vendor/ (siehe .github/workflows/vendor.yml) und werden vom
   Service Worker gespeichert. Fehlen sie, wird einmalig das CDN benutzt, danach ist alles offline verfügbar. */
(function () {
  const TJS_VERSION = '7.0.0';
  const LOCAL = {
    script: 'vendor/tesseract/tesseract.min.js',
    worker: 'vendor/tesseract/worker.min.js',
    core: 'vendor/tesseract-core',
    lang: 'vendor/lang'
  };
  const CDN = {
    script: 'https://cdn.jsdelivr.net/npm/tesseract.js@' + TJS_VERSION + '/dist/tesseract.min.js',
    worker: 'https://cdn.jsdelivr.net/npm/tesseract.js@' + TJS_VERSION + '/dist/worker.min.js',
    core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@' + TJS_VERSION,
    lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu/4.0.0_best_int'
  };

  const listeners = new Set();
  const state = { status: 'idle', progress: 0, source: null, error: null };
  const emit = () => listeners.forEach(fn => { try { fn(Object.assign({}, state)); } catch (e) {} });
  const set = o => { Object.assign(state, o); emit(); };

  // ------------------------------------------------------------ Tesseract laden
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => { s.remove(); rej(new Error('script ' + src)); };
      document.head.append(s);
    });
  }
  async function localAvailable() {
    try { const r = await fetch(LOCAL.worker, { method: 'HEAD', cache: 'no-store' }); if (r.ok) return true; } catch (e) {}
    try { const c = await caches.match(LOCAL.worker); return !!c; } catch (e) { return false; }
  }

  let workerPromise = null, worker = null, jobLogger = null;
  function getWorker() {
    if (workerPromise) return workerPromise;
    workerPromise = (async () => {
      set({ status: 'loading', progress: 0, error: null });
      const local = await localAvailable();
      const P = local ? LOCAL : CDN;
      if (!window.Tesseract) await loadScript(P.script);
      const base = new URL('.', location.href).href;
      const abs = p => /^https?:/.test(p) ? p : base + p;
      const w = await window.Tesseract.createWorker('deu', 1, {
        workerPath: abs(P.worker),
        corePath: abs(P.core),
        langPath: abs(P.lang),
        workerBlobURL: !local,
        gzip: true,
        logger: m => {
          if (jobLogger && m.status === 'recognizing text') { jobLogger(m.progress); return; }
          if (state.status === 'loading' && typeof m.progress === 'number') set({ progress: m.progress });
        },
        errorHandler: e => console.warn('ocr', e)
      });
      // Bons sind eine einzige Textspalte: Zeilen mit Name links und Preis rechts zusammenhalten (PSM 6)
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' });
      worker = w;
      set({ status: 'ready', progress: 1, source: local ? 'lokal' : 'cdn' });
      return w;
    })().catch(e => {
      workerPromise = null;
      set({ status: 'error', error: String(e && e.message || e) });
      throw e;
    });
    return workerPromise;
  }

  // ------------------------------------------------------------ Bildaufbereitung
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

  function toGray(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data, g = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    return g;
  }

  function otsu(g) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = g.length - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }

  // Papier (hell) vom Hintergrund trennen: Spalten und Zeilen mit überwiegend hellen Pixeln bilden den Bon
  function findPaper(src) {
    const sw = 160, sh = Math.max(40, Math.round(src.height * sw / src.width));
    const c = canvasOf(sw, sh), x = c.getContext('2d', { willReadFrequently: true });
    x.filter = 'blur(2px)';
    x.drawImage(src, 0, 0, sw, sh);
    const g = toGray(x, sw, sh), t = otsu(g);
    const colFrac = new Array(sw).fill(0), rowFrac = new Array(sh).fill(0);
    for (let y = 0; y < sh; y++) for (let xx = 0; xx < sw; xx++) if (g[y * sw + xx] > t) { colFrac[xx]++; rowFrac[y]++; }
    const span = (arr, n, lim) => {
      const mid = Math.floor(arr.length / 2);
      let a = mid, b = mid;
      if (arr[mid] / n < lim) {
        let best = -1; arr.forEach((v, i) => { if (v / n >= lim && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i; });
        if (best < 0) return null;
        a = b = best;
      }
      while (a > 0 && arr[a - 1] / n >= lim) a--;
      while (b < arr.length - 1 && arr[b + 1] / n >= lim) b++;
      return [a, b];
    };
    const cs = span(colFrac, sh, .45), rs = span(rowFrac, sw, .25);
    if (!cs || !rs) return null;
    const fx = src.width / sw, fy = src.height / sh;
    const box = { x: cs[0] * fx, y: rs[0] * fy, w: (cs[1] - cs[0] + 1) * fx, h: (rs[1] - rs[0] + 1) * fy };
    // zu klein oder fast das ganze Bild: nicht zuschneiden
    if (box.w * box.h < src.width * src.height * .12) return null;
    const m = Math.round(Math.min(box.w, box.h) * .02);
    box.x = Math.max(0, box.x - m); box.y = Math.max(0, box.y - m);
    box.w = Math.min(src.width - box.x, box.w + 2 * m); box.h = Math.min(src.height - box.y, box.h + 2 * m);
    return box;
  }

  // Ergebnis: Schwarz-Weiß-Bild, Bonbreite etwa 1400 px, ungleichmäßiges Licht ausgeglichen (Bradley-Schwelle)
  function prepare(src, opts) {
    opts = opts || {};
    const box = opts.noTrim ? null : findPaper(src);
    const bx = box || { x: 0, y: 0, w: src.width, h: src.height };
    let scale = 1400 / bx.w;
    scale = Math.max(.35, Math.min(2.2, scale));
    if (bx.h * scale > 9000) scale = 9000 / bx.h;
    const w = Math.round(bx.w * scale), h = Math.round(bx.h * scale);
    const c = canvasOf(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, bx.x, bx.y, bx.w, bx.h, 0, 0, w, h);
    const g = toGray(x, w, h);
    const integ = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let xx = 0; xx < w; xx++) { row += g[y * w + xx]; integ[(y + 1) * (w + 1) + xx + 1] = integ[y * (w + 1) + xx + 1] + row; }
    }
    const s = Math.max(15, Math.round(w / 14)) >> 1, T = .14;
    const out = x.createImageData(w, h), o = out.data;
    for (let y = 0; y < h; y++) {
      const y1 = Math.max(0, y - s), y2 = Math.min(h - 1, y + s);
      for (let xx = 0; xx < w; xx++) {
        const x1 = Math.max(0, xx - s), x2 = Math.min(w - 1, xx + s);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum = integ[(y2 + 1) * (w + 1) + x2 + 1] - integ[y1 * (w + 1) + x2 + 1] - integ[(y2 + 1) * (w + 1) + x1] + integ[y1 * (w + 1) + x1];
        const v = g[y * w + xx] * count <= sum * (1 - T) ? 0 : 255;
        const i = (y * w + xx) * 4;
        o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255;
      }
    }
    x.putImageData(out, 0, 0);
    return c;
  }

  // ------------------------------------------------------------ Erkennen
  async function recognize(src, onProgress) {
    const prepared = prepare(src);
    const w = await getWorker();
    jobLogger = p => onProgress && onProgress(p);
    try {
      const r = await w.recognize(prepared);
      return { text: r.data.text || '', confidence: r.data.confidence };
    } finally { jobLogger = null; }
  }

  // ------------------------------------------------------------ Kamera
  let stream = null;
  async function startCamera(video) {
    if (stream && stream.active) { if (video.srcObject !== stream) video.srcObject = stream; await video.play().catch(() => {}); return stream; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }
    });
    const track = stream.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.srcObject = stream;
    await video.play().catch(() => {});
    return stream;
  }
  function stopCamera(video) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (video) video.srcObject = null;
  }
  function torchSupported() {
    try { const t = stream && stream.getVideoTracks()[0]; return !!(t && t.getCapabilities && t.getCapabilities().torch); } catch (e) { return false; }
  }
  async function setTorch(on) {
    try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: !!on }] }); return true; } catch (e) { return false; }
  }

  // Ausschnitt des Rahmens aus dem Videobild; das Video füllt seine Fläche wie object-fit: cover
  function captureFrame(video, guide) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const r = video.getBoundingClientRect();
    const sc = Math.max(r.width / vw, r.height / vh);
    const ox = (r.width - vw * sc) / 2, oy = (r.height - vh * sc) / 2;
    let x = 0, y = 0, w = vw, h = vh;
    if (guide) {
      const g = guide.getBoundingClientRect();
      // etwas Rand über den Rahmen hinaus, falls der Bon nicht genau sitzt
      const mx = g.width * .06, my = g.height * .03;
      x = Math.max(0, (g.left - r.left - mx - ox) / sc);
      y = Math.max(0, (g.top - r.top - my - oy) / sc);
      w = Math.min(vw - x, (g.width + 2 * mx) / sc);
      h = Math.min(vh - y, (g.height + 2 * my) / sc);
    }
    const c = canvasOf(w, h);
    c.getContext('2d').drawImage(video, x, y, w, h, 0, 0, c.width, c.height);
    return c;
  }

  function fileToCanvas(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const c = canvasOf(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        res(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
      img.src = url;
    });
  }

  // kleines JPEG des Bons zum Nachsehen
  function thumbBlob(src, maxW) {
    const sc = Math.min(1, (maxW || 900) / src.width);
    const c = canvasOf(src.width * sc, src.height * sc);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', .72));
  }

  window.BonOCR = {
    get state() { return Object.assign({}, state); },
    onState(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    warmup: () => getWorker().catch(() => {}),
    recognize, prepare, startCamera, stopCamera, captureFrame, fileToCanvas, thumbBlob, torchSupported, setTorch
  };
})();
