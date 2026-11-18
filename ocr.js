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
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300', tessedit_char_blacklist: '|{}[]<>@©®“”„‘’»«~^_\\' });
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

  // Papier vom Hintergrund trennen, robust gegen Schatten: je Spalte zählt die Helligkeit des hellsten Viertels
  // (ein Schatten deckt selten die ganze Spalte), die Schwelle zwischen Papier und Hintergrund kommt aus Otsu.
  function findPaper(src) {
    const sw = 200, sh = Math.max(40, Math.round(src.height * sw / src.width));
    const c = canvasOf(sw, sh), x = c.getContext('2d', { willReadFrequently: true });
    x.filter = 'blur(1.5px)';
    x.drawImage(src, 0, 0, sw, sh);
    const g = toGray(x, sw, sh);
    const pctOf = (vals, q) => { vals.sort((p, r) => p - r); return vals[Math.floor((vals.length - 1) * q)]; };
    const otsuArr = arr => { const a = new Uint8ClampedArray(arr.length); arr.forEach((v, i) => { a[i] = v; }); return otsu(a); };
    const span = (ok, n) => {
      const mid = Math.floor(n / 2);
      let c0 = mid;
      if (!ok(mid)) { let best = -1; for (let i = 0; i < n; i++) if (ok(i) && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i; if (best < 0) return null; c0 = best; }
      let a = c0, b = c0;
      const okg = i => ok(i) || (i > 0 && i < n - 1 && (ok(i - 1) || ok(i - 2)) && (ok(i + 1) || ok(i + 2)));
      while (a > 0 && okg(a - 1)) a--;
      while (b < n - 1 && okg(b + 1)) b++;
      return [a, b];
    };
    const col = [];
    for (let xx = 0; xx < sw; xx++) { const v = []; for (let y = 0; y < sh; y++) v.push(g[y * sw + xx]); col.push(pctOf(v, .75)); }
    const tc = otsuArr(col);
    const cs = span(i => col[i] > tc, sw);
    if (!cs) return null;
    const row = [];
    for (let y = 0; y < sh; y++) { const v = []; for (let xx = cs[0]; xx <= cs[1]; xx++) v.push(g[y * sw + xx]); row.push(pctOf(v, .75)); }
    const tr = otsuArr(row);
    // Zeilen: wenn der Bon fast das ganze Bild füllt, liefert Otsu keine sinnvolle Grenze → ganze Höhe
    const rs = Math.max(...row) - Math.min(...row) < 30 ? [0, sh - 1] : span(i => row[i] > tr, sh);
    if (!rs) return null;
    const fx = src.width / sw, fy = src.height / sh;
    const box = { x: cs[0] * fx, y: rs[0] * fy, w: (cs[1] - cs[0] + 1) * fx, h: (rs[1] - rs[0] + 1) * fy };
    if (box.w * box.h < src.width * src.height * .06) return null;
    // großzügiger Rand: ein Schatten am Papierrand darf keine Preise oder Zeilenanfänge abschneiden;
    // den genauen Textbereich bestimmt danach textRegion()
    const mx = Math.round(box.w * .2), my = Math.round(box.h * .04);
    box.x = Math.max(0, box.x - mx); box.y = Math.max(0, box.y - my);
    box.w = Math.min(src.width - box.x, box.w + 2 * mx); box.h = Math.min(src.height - box.y, box.h + 2 * my);
    return box;
  }

  // Schräglage schätzen: nur Schriftpixel (lokale Schwelle, Randflächen entfernt), bei richtigem Winkel bilden
  // die Textzeilen scharfe Spitzen im Zeilenprofil. Erst grob in 0,5°-Schritten, dann fein in 0,1°-Schritten.
  function estimateSkew(src, bx) {
    const sw = 600, sh = Math.max(40, Math.round(bx.h * sw / bx.w));
    const c = canvasOf(sw, sh), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, bx.x, bx.y, bx.w, bx.h, 0, 0, sw, sh);
    const g = toGray(x, sw, sh);
    const bin = sauvola(g, sw, sh, 31, .3);
    clearBorder(bin, sw, sh);
    const pts = [];
    for (let y = 0; y < sh; y++) for (let xx = 0; xx < sw; xx++) if (bin[y * sw + xx] === 0) pts.push(xx - sw / 2, y);
    if (pts.length < 300) return 0;
    const score = a => {
      const tan = Math.tan(a * Math.PI / 180), off = Math.ceil(sw / 2 * Math.abs(Math.tan(12 * Math.PI / 180))) + 2, hist = new Float32Array(sh + 2 * off);
      for (let i = 0; i < pts.length; i += 2) { const yy = Math.round(pts[i + 1] + pts[i] * tan) + off; if (yy >= 0 && yy < hist.length) hist[yy]++; }
      let s = 0;
      for (let i = 1; i < hist.length; i++) { const d = hist[i] - hist[i - 1]; s += d * d; }
      return s;
    };
    let best = 0, bs = -1;
    for (let a = -12; a <= 12.001; a += .5) { const v = score(a); if (v > bs) { bs = v; best = a; } }
    const coarse = best;
    for (let a = coarse - .5; a <= coarse + .501; a += .1) { const v = score(a); if (v > bs) { bs = v; best = a; } }
    return Math.round(best * 10) / 10;
  }

  // Beleuchtung schätzen: hellster Wert je Block (das Papier), geglättet und wieder auf volle Größe gebracht
  function background(g, w, h) {
    const B = 24, gw = Math.ceil(w / B), gh = Math.ceil(h / B);
    let grid = new Float32Array(gw * gh);
    for (let by = 0; by < gh; by++) for (let bxx = 0; bxx < gw; bxx++) {
      // 95. Perzentil statt Maximum, damit einzelne Glanzpunkte nicht stören
      const vals = [];
      for (let y = by * B; y < Math.min(h, by * B + B); y += 2) for (let xx = bxx * B; xx < Math.min(w, bxx * B + B); xx += 2) vals.push(g[y * w + xx]);
      vals.sort((p, q) => p - q);
      grid[by * gw + bxx] = vals[Math.floor(vals.length * .95)] || 255;
    }
    // Blöcke ohne Papier (nur Schrift) mit dem hellsten Nachbarn füllen, dann glätten
    for (let pass = 0; pass < 2; pass++) {
      const n = new Float32Array(grid.length);
      for (let y = 0; y < gh; y++) for (let xx = 0; xx < gw; xx++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xc = xx + dx; if (yy >= 0 && yy < gh && xc >= 0 && xc < gw) m = Math.max(m, grid[yy * gw + xc]); }
        n[y * gw + xx] = m;
      }
      grid = n;
    }
    for (let pass = 0; pass < 3; pass++) {
      const n = new Float32Array(grid.length);
      for (let y = 0; y < gh; y++) for (let xx = 0; xx < gw; xx++) {
        let s = 0, k = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xc = xx + dx; if (yy >= 0 && yy < gh && xc >= 0 && xc < gw) { s += grid[yy * gw + xc]; k++; } }
        n[y * gw + xx] = s / k;
      }
      grid = n;
    }
    const bg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = Math.min(gh - 1.001, Math.max(0, y / B - .5)), y0 = Math.floor(fy), ty = fy - y0, y1 = Math.min(gh - 1, y0 + 1);
      for (let xx = 0; xx < w; xx++) {
        const fx = Math.min(gw - 1.001, Math.max(0, xx / B - .5)), x0 = Math.floor(fx), tx = fx - x0, x1 = Math.min(gw - 1, x0 + 1);
        const a = grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx, b = grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx;
        bg[y * w + xx] = a * (1 - ty) + b * ty;
      }
    }
    return bg;
  }

  // Sauvola-Schwelle über Integralbilder: T = m · (1 + k · (s / 128 − 1))
  function sauvola(g, w, h, win, k) {
    const W = w + 1, I = new Float64Array(W * (h + 1)), Q = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let r = 0, rq = 0;
      for (let xx = 0; xx < w; xx++) { const v = g[y * w + xx]; r += v; rq += v * v; I[(y + 1) * W + xx + 1] = I[y * W + xx + 1] + r; Q[(y + 1) * W + xx + 1] = Q[y * W + xx + 1] + rq; }
    }
    const out = new Uint8Array(w * h), s = win >> 1;
    for (let y = 0; y < h; y++) {
      const y1 = Math.max(0, y - s), y2 = Math.min(h - 1, y + s);
      for (let xx = 0; xx < w; xx++) {
        const x1 = Math.max(0, xx - s), x2 = Math.min(w - 1, xx + s), n = (x2 - x1 + 1) * (y2 - y1 + 1);
        const a = (y2 + 1) * W + x2 + 1, b = y1 * W + x2 + 1, c = (y2 + 1) * W + x1, d = y1 * W + x1;
        const m = (I[a] - I[b] - I[c] + I[d]) / n, v = Math.max(0, (Q[a] - Q[b] - Q[c] + Q[d]) / n - m * m);
        out[y * w + xx] = g[y * w + xx] > m * (1 + k * (Math.sqrt(v) / 128 - 1)) ? 255 : 0;
      }
    }
    return out;
  }

  function boxBlur(a, w, h, r) {
    const t = new Float32Array(w * h), o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { t[y * w + x] = s / (2 * r + 1); s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { o[y * w + x] = s / (2 * r + 1); s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; } }
    return o;
  }

  // schwarze Flächen, die den Bildrand berühren (Tisch, Hand, Schatten am Rand), entfernen
  function clearBorder(bin, w, h) {
    const stack = new Int32Array(w * h);
    let sp = 0;
    const push = i => { if (bin[i] === 0) { bin[i] = 255; stack[sp++] = i; } };
    for (let xx = 0; xx < w; xx++) { push(xx); push((h - 1) * w + xx); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
      const i = stack[--sp], xx = i % w;
      if (xx > 0) push(i - 1);
      if (xx < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < w * (h - 1)) push(i + w);
    }
  }

  // Textbereich finden: zusammenhängende schwarze Flächen, die wie Buchstaben aussehen (ähnliche Höhe, Nachbarn auf
  // derselben Grundlinie), bilden Zeilen. Krümel vom Boden, Hand oder Tisch haben solche Nachbarn nicht.
  function textRegion(bin, w, h) {
    const lab = new Int32Array(w * h), stack = new Int32Array(w * h), comps = [];
    for (let i0 = 0; i0 < bin.length; i0++) {
      if (bin[i0] !== 0 || lab[i0]) continue;
      const id = comps.length + 1;
      let sp = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
      stack[sp++] = i0; lab[i0] = id;
      while (sp) {
        const i = stack[--sp], xx = i % w, y = (i - xx) / w;
        n++;
        if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (xx > 0 && bin[i - 1] === 0 && !lab[i - 1]) { lab[i - 1] = id; stack[sp++] = i - 1; }
        if (xx < w - 1 && bin[i + 1] === 0 && !lab[i + 1]) { lab[i + 1] = id; stack[sp++] = i + 1; }
        if (y > 0 && bin[i - w] === 0 && !lab[i - w]) { lab[i - w] = id; stack[sp++] = i - w; }
        if (y < h - 1 && bin[i + w] === 0 && !lab[i + w]) { lab[i + w] = id; stack[sp++] = i + w; }
      }
      comps.push({ x0, y0, x1, y1, n, cw: x1 - x0 + 1, ch: y1 - y0 + 1 });
    }
    const cand = comps.filter(c => c.ch >= 10 && c.ch <= 140 && c.cw <= c.ch * 2.5 && c.n >= 25 && c.n <= c.cw * c.ch * .9);
    if (cand.length < 20) return null;
    // Raster zum schnellen Finden von Nachbarn
    const G = 64, gw = Math.ceil(w / G), grid = new Map();
    cand.forEach((c, i) => { const k = Math.floor(c.y0 / G) * gw + Math.floor(c.x0 / G); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
    const texty = cand.filter(c => {
      const gx = Math.floor(c.x0 / G), gy = Math.floor(c.y0 / G);
      let found = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) for (const j of grid.get((gy + dy) * gw + gx + dx) || []) {
        const d = cand[j];
        if (d === c) continue;
        const r = d.ch / c.ch, cy = Math.abs((d.y1) - (c.y1)), gap = Math.max(d.x0 - c.x1, c.x0 - d.x1);
        if (r > .6 && r < 1.6 && cy < c.ch * .35 && gap < c.ch * 1.6) found++;
      }
      return found >= 2;
    });
    if (texty.length < 15) return null;
    // Dichte je Zelle, größte zusammenhängende Gruppe von Zellen ist der Bon
    const hs = texty.map(c => c.ch).sort((a, b) => a - b), h0 = hs[hs.length >> 1];
    const C = Math.max(20, h0 * 3), cw2 = Math.ceil(w / C), chh = Math.ceil(h / C), dens = new Uint16Array(cw2 * chh);
    texty.forEach(c => dens[Math.floor((c.y0 + c.y1) / 2 / C) * cw2 + Math.floor((c.x0 + c.x1) / 2 / C)]++);
    const seen = new Uint8Array(dens.length), clusters = [];
    let best = null;
    for (let s0 = 0; s0 < dens.length; s0++) {
      if (dens[s0] < 2 || seen[s0]) continue;
      const q = [s0]; seen[s0] = 1;
      let cnt = 0, x0 = cw2, y0 = chh, x1 = 0, y1 = 0;
      while (q.length) {
        const i = q.pop(), cx = i % cw2, cy = (i - cx) / cw2;
        cnt += dens[i];
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        // Lücke von bis zu zwei Zellen überbrücken (Leerzeilen, eingerückte Zeilen)
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cw2 || ny >= chh) continue;
          const j = ny * cw2 + nx;
          if (!seen[j] && dens[j] >= 2) { seen[j] = 1; q.push(j); }
        }
      }
      clusters.push({ cnt, x0, y0, x1, y1 });
      if (!best || cnt > best.cnt) best = { cnt, x0, y0, x1, y1 };
    }
    if (!best) return null;
    // ein Bon hat mehrere Textblöcke (Kopf, Artikel, Summe, Steuer, Datum): alle nennenswerten Blöcke vereinen
    const big = clusters.filter(c => c.cnt >= Math.max(6, best.cnt * .08));
    best = { cnt: best.cnt, x0: Math.min(...big.map(c => c.x0)), y0: Math.min(...big.map(c => c.y0)), x1: Math.max(...big.map(c => c.x1)), y1: Math.max(...big.map(c => c.y1)) };
    // Spalten nebeneinander (Name links, Preis rechts) gehören dazu: alle Textzellen in derselben Höhe einschließen
    for (let cy = best.y0; cy <= best.y1; cy++) for (let cx = 0; cx < cw2; cx++) if (dens[cy * cw2 + cx] >= 1) { best.x0 = Math.min(best.x0, cx); best.x1 = Math.max(best.x1, cx); }
    const m = Math.round(h0 * 1.2);
    const r = { x: Math.max(0, best.x0 * C - m), y: Math.max(0, best.y0 * C - m) };
    r.w = Math.min(w, (best.x1 + 1) * C + m) - r.x;
    r.h = Math.min(h, (best.y1 + 1) * C + m) - r.y;
    // Flächen außerhalb, die nicht wie Schrift aussehen, sind nun abgeschnitten; innerhalb große Kleckse entfernen
    comps.forEach((c, i) => {
      if (c.ch > h0 * 6 && c.cw > h0 * 6 && c.n > c.cw * c.ch * .5) {
        for (let y = c.y0; y <= c.y1; y++) for (let xx = c.x0; xx <= c.x1; xx++) if (lab[y * w + xx] === i + 1) bin[y * w + xx] = 255;
      }
    });
    return r;
  }

  // Aufbereitung für die Texterkennung:
  // 1. Bon ausschneiden, 2. begradigen, 3. Graustufen, 4. Beleuchtung ausgleichen (durch geschätzten Hintergrund teilen),
  // 5. Kontrast stark spreizen, 6. Sauvola-Schwelle (Schwarz-Weiß), 7. Ränder säubern.
  // mode 'gray' liefert das kontrastverstärkte Graubild (Stufe 5) als zweiten Versuch.
  function prepare(src, opts) {
    opts = opts || {};
    const box = opts.noTrim ? null : findPaper(src);
    const bx = box || { x: 0, y: 0, w: src.width, h: src.height };
    const angle = opts.noDeskew ? 0 : estimateSkew(src, bx);
    let scale = (opts.targetW || 1400) / bx.w;
    scale = Math.max(.35, Math.min(opts.maxUp || 4, scale));
    if (bx.h * scale > 9000) scale = 9000 / bx.h;
    const w = Math.round(bx.w * scale), h = Math.round(bx.h * scale);
    const c = canvasOf(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff';
    x.fillRect(0, 0, w, h);
    x.imageSmoothingQuality = 'high';
    x.translate(w / 2, h / 2);
    x.rotate(angle * Math.PI / 180);
    x.drawImage(src, bx.x, bx.y, bx.w, bx.h, -w / 2, -h / 2, w, h);
    x.setTransform(1, 0, 0, 1, 0, 0);
    const g = toGray(x, w, h);

    // Beleuchtungsausgleich: Schatten und Verläufe verschwinden, Papier wird gleichmäßig hell
    const bg = background(g, w, h);
    const n = new Uint8ClampedArray(w * h);
    for (let i = 0; i < n.length; i++) n[i] = Math.min(255, g[i] * 255 / Math.max(8, bg[i]));
    // Kontrast spreizen: dunkelste 0,5 % → Schwarz, Papier → Weiß; Gamma dunkelt blasse Schrift nach
    const hist = new Uint32Array(256);
    for (let i = 0; i < n.length; i++) hist[n[i]]++;
    const pct = q => { let acc = 0; const lim = n.length * q; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= lim) return v; } return 255; };
    const lo = pct(.005), hi = Math.max(lo + 20, pct(.5) - 6);
    const lut = new Uint8ClampedArray(256);
    const gamma = opts.gamma || 1.6;
    for (let v = 0; v < 256; v++) { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); lut[v] = Math.round(255 * Math.pow(t, gamma)); }
    for (let i = 0; i < n.length; i++) n[i] = lut[n[i]];
    // Schärfen (Unschärfemaske): hilft bei verwackelten und hochskalierten Fotos
    if (opts.sharpen) {
      const r = Math.max(1, Math.round(w / 500)), bl = boxBlur(n, w, h, r), amt = opts.sharpen;
      for (let i = 0; i < n.length; i++) n[i] = n[i] + amt * (n[i] - bl[i]);
    }

    // Fenster etwa zwei Zeichenhöhen; Zeichen sind bei 1400 px Bonbreite rund 30 px hoch
    const bin = sauvola(n, w, h, Math.max(25, Math.round(w / 22)) | 1, opts.k || .2);
    clearBorder(bin, w, h);
    let reg = opts.noRegion ? null : textRegion(bin.slice(), w, h);
    // nur übernehmen, wenn der Textbereich den Großteil des Bons umfasst (sonst wurde z. B. nur eine Trennlinie gefunden)
    if (reg && (reg.h < h * .5 || reg.w < w * .55)) reg = null;
    const out = opts.mode === 'gray' ? n : bin;
    const img = x.createImageData(w, h), o = img.data;
    for (let i = 0, j = 0; i < out.length; i++, j += 4) { o[j] = o[j + 1] = o[j + 2] = out[i]; o[j + 3] = 255; }
    x.putImageData(img, 0, 0);
    if (reg && reg.w * reg.h < w * h * .97) {
      const c2 = canvasOf(reg.w, reg.h);
      c2.getContext('2d').drawImage(c, reg.x, reg.y, reg.w, reg.h, 0, 0, reg.w, reg.h);
      c2.angle = angle;
      return c2;
    }
    c.angle = angle;
    return c;
  }

  // ------------------------------------------------------------ Erkennen
  // Ergebnis mit Zeilen: Text, Sicherheit (0–100) und Lage im aufbereiteten Bild, damit unsichere Zeilen gezeigt werden können
  async function runOcr(w, img) {
    const r = await w.recognize(img, {}, { text: true, blocks: true });
    const lines = [];
    for (const b of r.data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
      const words = l.words || [];
      lines.push({
        text: (l.text || '').replace(/\n/g, ' ').trim(),
        conf: Math.round(l.confidence || 0),
        minWord: words.length ? Math.round(Math.min(...words.map(x => x.confidence))) : 0,
        bbox: l.bbox
      });
    }
    const good = lines.filter(l => l.text);
    const conf = good.length ? good.reduce((s, l) => s + l.conf * l.text.length, 0) / good.reduce((s, l) => s + l.text.length, 0) : 0;
    return { lines: good, text: good.map(l => l.text).join('\n'), confidence: Math.round(conf), image: img };
  }

  // Zwei Durchgänge: Schwarz-Weiß-Bild und kontrastverstärktes Graubild. Die App wählt danach das Ergebnis,
  // das besser zum Bon passt (Summe stimmt, weniger unsichere Zeilen), und kann beide Zeile für Zeile vergleichen.
  async function recognize(src, onProgress) {
    const w = await getWorker();
    let step = 0;
    jobLogger = p => onProgress && onProgress(Math.min(1, (step + p) / 2));
    try {
      // zuerst das kontrastverstärkte Graubild (im Test mit 100 Bons das bessere), dann Schwarz-Weiß
      const a = await runOcr(w, prepare(src, { mode: 'gray' }));
      step = 1;
      if (a.confidence >= 90) { onProgress && onProgress(1); return [a]; }
      const b = await runOcr(w, prepare(src));
      return [a, b];
    } finally { jobLogger = null; }
  }

  // Ausschnitt einer Zeile als kleines Bild (für die Rückfrage beim Nutzer)
  function lineCrop(img, bbox) {
    if (!img || !bbox) return null;
    const pad = 6, x0 = Math.max(0, bbox.x0 - pad), y0 = Math.max(0, bbox.y0 - pad);
    const x1 = Math.min(img.width, bbox.x1 + pad), y1 = Math.min(img.height, bbox.y1 + pad);
    const sc = Math.min(1, 700 / (x1 - x0));
    const c = canvasOf((x1 - x0) * sc, (y1 - y0) * sc);
    c.getContext('2d').drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
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
    _run: async img => runOcr(await getWorker(), img),
    _variants: async (src, list) => { const w = await getWorker(); const out = []; for (const o of list) { const r = await runOcr(w, prepare(src, o)); out.push({ conf: r.confidence, lines: r.lines }); } return out; },
    recognize, prepare, lineCrop, startCamera, stopCamera, captureFrame, fileToCanvas, thumbBlob, torchSupported, setTorch
  };
})();
