'use strict';
(function () {

  // ------------------------------------------------------------ Konstanten
  const VERSION = '0.4';
  const THEMES = { hell: { bar: '#F0EEE9', name: 'Hell' }, dunkel: { bar: '#161617', name: 'Dunkel' } };
  const D = window.BON_DATA, P = window.BonParser, OCR = window.BonOCR;
  const TRASH_DAYS = 30, DAY = 864e5, HOLD_MS = 1000;
  const RANGES = [
    ['week', 'Diese Woche'], ['month', 'Dieser Monat'], ['lastmonth', 'Letzter Monat'], ['3m', 'Letzte 3 Monate'],
    ['year', 'Dieses Jahr'], ['all', 'Alles'], ['custom', 'Eigener Zeitraum …']
  ];

  const S = { receipts: [], learned: {}, settings: { theme: 'hell', keepPhotos: true, range: 'month', store: null, from: null, to: null } };

  // ------------------------------------------------------------ Helfer
  // null und false in Kinderlisten überspringen (sonst erscheint „null“ als Text)
  ['append', 'replaceChildren'].forEach(fn => {
    const orig = Element.prototype[fn];
    Element.prototype[fn] = function (...a) { return orig.apply(this, a.filter(x => x != null && x !== false)); };
  });
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    text: '<path d="M5 6h14M5 10h14M5 14h10M5 18h7"/>',
    share: '<path d="M12 3v12M8 7l4-4 4 4M5 13v7h14v-7"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
    tabScan: '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 12h10"/>',
    tabBons: '<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    tabStats: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
    tabSettings: '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.5"/><circle cx="8" cy="17" r="2.5"/>'
  };
  function icon(name) {
    const s = h('span', { class: 'ico', 'aria-hidden': 'true' });
    s.style.display = 'contents';
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
    return s;
  }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const pad2 = n => String(n).padStart(2, '0');
  const round2 = n => Math.round(n * 100) / 100;
  const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  const fmtEur = n => n == null || isNaN(n) ? '–' : EUR.format(n);
  const fmtNum = n => n == null || isNaN(n) ? '' : n.toFixed(2).replace('.', ',');
  const fmtPct = n => Math.round(n * 100) + ' %';
  const fmtDate = ms => ms == null ? '' : new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(ms));
  const fmtMonth = ms => new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(ms));
  const toDateInput = ms => { if (ms == null) return ''; const d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const fromDateInput = (v, keep) => {
    if (!v) return null;
    const [y, m, d] = v.split('-').map(Number), k = keep != null ? new Date(keep) : null;
    return new Date(y, m - 1, d, k ? k.getHours() : 12, k ? k.getMinutes() : 0).getTime();
  };
  const parseEuro = v => { const n = parseFloat(String(v || '').replace(/[^\d,.\-−]/g, '').replace('−', '-').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')); return isNaN(n) ? null : round2(n); };
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  const catOf = k => D.CATS.find(c => c.k === k) || D.CATS[D.CATS.length - 1];
  const isFood = it => catOf(it.cat).food !== false;
  const dietName = k => (D.DIETS.find(x => x.k === (k || null)) || D.DIETS[D.DIETS.length - 1]).name;
  const healthName = k => (D.HEALTH.find(x => x.k === (k || null)) || D.HEALTH[D.HEALTH.length - 1]).name;
  const rDate = r => r.date || r.createdAt;
  const live = () => S.receipts.filter(r => !r.deletedAt);
  const itemSum = items => round2(items.reduce((s, it) => s + (Number(it.price) || 0), 0));
  const keyOf = it => P.learnKey(it.raw || it.name);

  let toastTimer;
  // Kurzmeldung; mit undo erscheint daneben „Rückgängig“ und die Meldung bleibt etwas länger stehen
  function toast(msg, undo) {
    const el = document.getElementById('toast');
    el.replaceChildren(h('span', null, msg));
    el.classList.toggle('has-action', !!undo);
    if (undo) el.append(h('button', { class: 'toast-action', 'data-act': 'undo', onclick: () => { el.classList.remove('show'); clearTimeout(toastTimer); haptic(); undo(); } }, 'Rückgängig'));
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 6000 : 2200);
  }

  // leichtes haptisches Feedback: Vibration auf Android, auf dem iPhone über einen unsichtbaren Schalter
  function haptic() {
    try {
      if (navigator.vibrate) { navigator.vibrate(10); return; }
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      label.append(input);
      document.head.append(label);
      label.click();
      label.remove();
    } catch (e) {}
  }

  // ------------------------------------------------------------ Speicher (IndexedDB)
  const DB = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('bon-scan', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('receipts')) d.createObjectStore('receipts', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('learned')) d.createObjectStore('learned', { keyPath: 'key' });
        };
        r.onsuccess = () => { DB.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    run(stores, mode, fn) {
      return new Promise((res, rej) => {
        if (!DB.db) return rej(new Error('no db'));
        const tx = DB.db.transaction(stores, mode);
        const r = fn(tx);
        tx.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
        tx.onerror = tx.onabort = () => rej(tx.error);
      });
    },
    all: store => DB.run(store, 'readonly', tx => tx.objectStore(store).getAll()),
    get: (store, id) => DB.run(store, 'readonly', tx => tx.objectStore(store).get(id)),
    put: (store, val) => DB.run(store, 'readwrite', tx => { tx.objectStore(store).put(val); }),
    del: (store, id) => DB.run(store, 'readwrite', tx => { tx.objectStore(store).delete(id); })
  };

  // Fotos als ArrayBuffer speichern: Blobs in IndexedDB sind in älteren Safari-Versionen unzuverlässig
  async function putPhoto(blob) {
    const id = uid();
    await DB.put('media', { id, type: blob.type || 'image/jpeg', buf: await blob.arrayBuffer() });
    return id;
  }
  const urls = new Map();
  async function photoUrl(id) {
    if (urls.has(id)) return urls.get(id);
    const m = await DB.get('media', id);
    if (!m) return null;
    const u = URL.createObjectURL(new Blob([m.buf], { type: m.type }));
    urls.set(id, u);
    return u;
  }
  async function dropPhotos(ids) {
    for (const id of ids || []) { if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); } try { await DB.del('media', id); } catch (e) {} }
  }

  // ------------------------------------------------------------ Lernen
  // Korrektur eines Artikels merken und auf alle gespeicherten Artikel mit demselben Namen anwenden
  async function learn(it, skipReceiptId) {
    const key = keyOf(it);
    if (!key) return 0;
    const rec = { key, cat: it.cat, diet: it.diet || null, conv: !!it.conv, health: it.health || null, name: it.name, at: Date.now() };
    S.learned[key] = rec;
    try { await DB.put('learned', rec); } catch (e) {}
    let n = 0;
    for (const r of S.receipts) {
      if (r.id === skipReceiptId) continue;
      let changed = false;
      for (const x of r.items) {
        if (x === it || keyOf(x) !== key) continue;
        if (x.cat !== rec.cat || (x.diet || null) !== rec.diet || !!x.conv !== rec.conv || (x.health || null) !== rec.health || x.name !== rec.name) {
          Object.assign(x, { cat: rec.cat, diet: rec.diet, conv: rec.conv, health: rec.health, name: rec.name, src: 'learned' });
          changed = true; n++;
        }
      }
      if (changed) { try { await DB.put('receipts', r); } catch (e) {} }
    }
    return n;
  }
  function applyLearnedTo(items, key) {
    const rec = S.learned[key];
    if (!rec) return;
    items.forEach(x => { if (keyOf(x) === key) Object.assign(x, { cat: rec.cat, diet: rec.diet, conv: rec.conv, health: rec.health, name: rec.name, src: 'learned' }); });
  }

  // ------------------------------------------------------------ Fenster
  const layers = document.getElementById('layers');
  const stack = [];

  function openSheet(opts) {
    const sheet = { closed: false, render: null };
    const title = h('div', { class: 'sheet-title' });
    const right = h('div', { class: 'sheet-right' });
    const head = h('header', { class: 'sheet-head' },
      h('div', { class: 'grab' }),
      h('button', { class: 'icon-btn', 'aria-label': 'Schließen', 'data-act': 'close', onclick: () => sheet.requestClose() }, icon('close')),
      title, right);
    const body = h('div', { class: 'sheet-body' });
    const foot = h('footer', { class: 'sheet-foot' });
    const el = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, head, body, foot);
    const layer = h('div', { class: 'layer' }, h('div', { class: 'backdrop', onclick: () => sheet.requestClose() }), el);

    Object.assign(sheet, { el, head, body, foot, layer });
    sheet.setTitle = v => title.replaceChildren(...(Array.isArray(v) ? v : [v == null ? '' : v]));
    sheet.setRight = v => right.replaceChildren(...(v ? [v] : []));
    sheet.close = () => {
      if (sheet.closed) return;
      sheet.closed = true;
      const i = stack.indexOf(sheet);
      if (i >= 0) stack.splice(i, 1);
      el.style.transform = '';
      layer.classList.remove('open');
      setTimeout(() => layer.remove(), 340);
      if (opts.onClosed) opts.onClosed();
      cameraCheck();
    };
    let asking = false;
    sheet.requestClose = async () => {
      if (sheet.closed || asking) return false;
      if (opts.beforeClose) {
        asking = true;
        let ok = false;
        try { ok = await opts.beforeClose(); } finally { asking = false; }
        if (!ok) { el.style.transform = ''; return false; }
      }
      sheet.close();
      return true;
    };

    // nach unten ziehen zum Schließen; greift nur an der Kopfzeile, damit Listen frei scrollen
    let startY = null, dy = 0, dragging = false;
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button,input,select,a')) return;
      startY = e.clientY; dy = 0; dragging = false;
      try { head.setPointerCapture(e.pointerId); } catch (err) {}
    });
    head.addEventListener('pointermove', e => {
      if (startY == null) return;
      dy = Math.max(0, e.clientY - startY);
      if (dy > 6) dragging = true;
      if (dragging) { el.style.transition = 'none'; el.style.transform = 'translateY(' + dy + 'px)'; }
    });
    const end = () => {
      if (startY == null) return;
      startY = null;
      el.style.transition = '';
      if (dragging && dy > 110) sheet.requestClose();
      else el.style.transform = '';
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);

    if (opts.title != null) sheet.setTitle(opts.title);
    layers.append(layer);
    stack.push(sheet);
    cameraCheck();
    void layer.offsetHeight;
    layer.classList.add('open');
    return sheet;
  }
  const okButton = (onTap, act) => h('button', { class: 'icon-btn ok', 'aria-label': 'Sichern', 'data-act': act || 'ok', onclick: onTap }, icon('check'));

  // Rückfragen im Stil der iOS-Systemabfragen. buttons: [{label, value, kind: 'bold' | 'danger', act, onTap}]
  function alertBox(o) {
    const stacked = o.buttons.length > 2 || o.buttons.some(b => b.label.length > 13);
    if (stacked && o.buttons.length === 2) o = Object.assign({}, o, { buttons: o.buttons.slice().reverse() });
    return new Promise(resolve => {
      let done = false;
      const finish = v => {
        if (done) return;
        done = true;
        layer.classList.remove('open');
        setTimeout(() => layer.remove(), 200);
        resolve(v);
      };
      const btns = o.buttons.map((b, i) => h('button', { class: b.kind || null, 'data-act': b.act || 'alert-' + i, onclick: () => { if (b.onTap) b.onTap(); finish(b.value); } }, b.label));
      if (o.input) o.input.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = o.buttons.find(x => x.kind === 'bold'); if (b) finish(b.value); } });
      const layer = h('div', { class: 'alert-layer' },
        h('div', { class: 'alert', role: 'alertdialog', 'aria-modal': 'true' },
          h('div', { class: 'alert-text' },
            h('p', { class: 'alert-title' }, o.title),
            o.message ? h('p', { class: 'alert-msg' }, o.message) : null,
            o.input || null),
          h('div', { class: 'alert-btns' + (stacked ? ' stack' : '') }, btns)));
      layers.append(layer);
      void layer.offsetHeight;
      layer.classList.add('open');
      if (o.input) setTimeout(() => o.input.focus(), 220);
    });
  }
  const confirmDelete = (message, okLabel) => alertBox({ title: message, buttons: [
    { label: 'Abbrechen', value: false, act: 'alert-cancel' },
    { label: okLabel || 'Löschen', value: true, kind: 'danger', act: 'alert-ok' }] });
  const askSave = msg => alertBox({ title: msg, buttons: [
    { label: 'Sichern', value: 'save', kind: 'bold', act: 'alert-save' },
    { label: 'Verwerfen', value: 'discard', kind: 'danger', act: 'alert-discard' },
    { label: 'Abbrechen', value: null, act: 'alert-cancel' }] });
  async function askText(title, initial, placeholder) {
    const input = h('input', { type: 'text', class: 'alert-input', placeholder, value: initial || '', autocomplete: 'off', enterkeyhint: 'done', 'data-field': 'ask-text' });
    const ok = await alertBox({ title, input, buttons: [
      { label: 'Abbrechen', value: false, act: 'alert-cancel' },
      { label: 'Sichern', value: true, kind: 'bold', act: 'alert-ok' }] });
    return ok ? input.value.trim() || null : null;
  }

  // ------------------------------------------------------------ Aufklappmenü und Halten
  let pointerDown = false;
  window.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  window.addEventListener('pointerup', () => { pointerDown = false; }, true);
  window.addEventListener('pointercancel', () => { pointerDown = false; }, true);

  function popMenu(anchor, items, title) {
    items = items.filter(Boolean);
    return new Promise(resolve => {
      let done = false, armed = !pointerDown;
      const finish = v => {
        if (done) return;
        done = true;
        layer.classList.remove('open');
        setTimeout(() => layer.remove(), 220);
        resolve(v);
      };
      const hasCheck = items.some(i => i.checked != null);
      const menu = h('div', { class: 'pop', role: 'menu' },
        title ? h('div', { class: 'pop-title' }, title) : null,
        items.map(i => h('button', { class: 'pop-item' + (i.danger ? ' danger' : ''), role: 'menuitem', 'data-value': String(i.value), onclick: () => { if (!armed) return; finish(i.value); } },
          hasCheck ? h('span', { class: 'pop-check' }, i.checked ? icon('check') : null) : null,
          h('span', { class: 'pop-label' }, i.label), i.icon ? icon(i.icon) : null)));
      const layer = h('div', { class: 'pop-layer', onclick: e => { if (e.target === layer && armed) finish(undefined); } }, menu);
      layers.append(layer);
      const ar = anchor && anchor.isConnected && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      const r = ar && ar.width ? ar : { left: innerWidth / 2 - 125, right: innerWidth / 2 + 125, top: innerHeight / 3, bottom: innerHeight / 3 };
      const w = menu.offsetWidth, hh = menu.offsetHeight;
      let top = r.bottom + 8, above = false;
      if (top + hh > innerHeight - 20) { top = Math.max(50, r.top - hh - 8); above = true; }
      menu.style.top = top + 'px';
      menu.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.right - w)) + 'px';
      menu.style.transformOrigin = (above ? 'bottom' : 'top') + ' right';
      const on = hasCheck && menu.querySelector('.pop-check svg');
      if (on) { const it = on.closest('.pop-item'); menu.scrollTop = Math.max(0, it.offsetTop - (menu.clientHeight - it.offsetHeight) / 2); }
      void layer.offsetHeight;
      layer.classList.add('open');
      if (!armed) window.addEventListener('pointerup', () => setTimeout(() => { armed = true; }, 80), { once: true });
    });
  }

  // Einträge mit data-drag: eine Sekunde halten öffnet das Menü
  function holdable(box, onHold) {
    let st = null;
    const stop = () => { if (!st) return; clearTimeout(st.t1); clearTimeout(st.t2); st.el.classList.remove('holding'); st = null; };
    box.addEventListener('pointerdown', e => {
      const el = e.target.closest('[data-drag]');
      if (!el || !box.contains(el) || st) return;
      const s = { el, x: e.clientX, y: e.clientY, id: e.pointerId };
      s.t1 = setTimeout(() => el.classList.add('holding'), 350);
      s.t2 = setTimeout(() => {
        if (st !== s) return;
        stop();
        el._noClickUntil = Infinity;
        window.addEventListener('pointerup', () => { el._noClickUntil = Date.now() + 400; }, { once: true });
        haptic();
        onHold(el.dataset.drag, el);
      }, HOLD_MS);
      st = s;
    });
    box.addEventListener('pointermove', e => { if (st && e.pointerId === st.id && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) stop(); });
    box.addEventListener('pointerup', stop);
    box.addEventListener('pointercancel', stop);
    box.addEventListener('contextmenu', e => { if (st) e.preventDefault(); });
    box.addEventListener('click', e => {
      const el = e.target.closest('[data-drag]');
      if (el && el._noClickUntil > Date.now()) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  // ------------------------------------------------------------ Gruppen und Zeilen wie in den iOS-Einstellungen
  const group = (...kids) => h('div', { class: 'group' }, kids);
  const line = (label, control, attrs) => h('label', Object.assign({ class: 'line' }, attrs || {}), h('span', { class: 'line-label' }, label), control);
  const lineBtn = (label, value, onTap, attrs) => h('button', Object.assign({ class: 'line', onclick: onTap }, attrs || {}),
    h('span', { class: 'line-label' }, label), value == null ? null : (value.nodeType ? value : h('span', { class: 'line-value' }, value)), icon('chev'));
  const lineSwitch = (label, on, onChange, field) => line(label, h('input', { type: 'checkbox', class: 'switch', role: 'switch', 'data-field': field, checked: on ? true : null, onchange: e => onChange(e.target.checked) }));
  const sectionLabel = txt => h('div', { class: 'section-label' }, txt);
  const note = txt => h('p', { class: 'group-note' }, txt);
  const euroInput = (value, onChange, field) => h('input', {
    type: 'text', inputmode: 'decimal', class: 'num', placeholder: '0,00', autocomplete: 'off', enterkeyhint: 'done', 'data-field': field,
    value: value == null ? '' : fmtNum(value),
    onchange: e => { const n = parseEuro(e.target.value); e.target.value = n == null ? '' : fmtNum(n); onChange(n); }
  });

  // Datei auswählen; muss direkt im Antippen starten, sonst blockiert Safari
  function pickFile(accept, capture) {
    return new Promise(resolve => {
      const input = h('input', { type: 'file', accept, capture: capture ? 'environment' : null, style: 'position:fixed;left:-999px;opacity:0' });
      input.addEventListener('change', () => { resolve(input.files && input.files[0] || null); input.remove(); }, { once: true });
      document.body.append(input);
      input.click();
    });
  }

  // ------------------------------------------------------------ Seiten mit Tab-Leiste
  const home = document.getElementById('home');
  const TABS = [['scan', 'Scan', 'tabScan'], ['bons', 'Bons', 'tabBons'], ['stats', 'Auswertung', 'tabStats'], ['settings', 'Einstellungen', 'tabSettings']];
  let page = null, tabName = 'scan';
  const tabbar = h('nav', { class: 'tabbar' });
  const tabLens = h('div', { class: 'tab-lens' });
  const tabBtns = TABS.map(([key, label, ic]) => h('button', { class: 'tab', 'data-nav': key, onclick: e => { if (e.detail === 0 && key !== tabName) showTab(key); } }, icon(ic), h('span', { class: 'tab-label' }, label)));
  tabbar.append(tabLens, ...tabBtns);
  const moveLens = (x, w, lift) => { tabLens.style.width = w + 'px'; tabLens.style.transform = 'translateX(' + x + 'px)' + (lift ? ' scale(1.12)' : ''); };
  function placeLens() {
    const b = tabBtns[TABS.findIndex(x => x[0] === tabName)];
    if (b && b.offsetWidth) moveLens(b.offsetLeft, b.offsetWidth, false);
  }
  function followLens(clientX) {
    const r = tabbar.getBoundingClientRect(), w = tabBtns[0].offsetWidth;
    const min = tabBtns[0].offsetLeft, max = tabBtns[tabBtns.length - 1].offsetLeft;
    const x = Math.max(min, Math.min(max, clientX - r.left - w / 2));
    moveLens(x, w, true);
    const idx = Math.round((x - min) / ((max - min) / (tabBtns.length - 1)));
    tabBtns.forEach((b, i) => b.classList.toggle('near', i === idx));
    return idx;
  }
  let lensDrag = null;
  tabbar.addEventListener('pointerdown', e => {
    lensDrag = { id: e.pointerId, idx: 0 };
    try { tabbar.setPointerCapture(e.pointerId); } catch (err) {}
    tabbar.classList.add('pressing');
    lensDrag.idx = followLens(e.clientX);
  });
  tabbar.addEventListener('pointermove', e => {
    if (!lensDrag || e.pointerId !== lensDrag.id) return;
    const idx = followLens(e.clientX);
    if (idx !== lensDrag.idx) { lensDrag.idx = idx; haptic(); }
  });
  const lensEnd = (e, commit) => {
    if (!lensDrag || e.pointerId !== lensDrag.id) return;
    const idx = lensDrag.idx;
    lensDrag = null;
    tabbar.classList.remove('pressing');
    tabBtns.forEach(b => b.classList.remove('near'));
    if (commit && TABS[idx][0] !== tabName) { haptic(); showTab(TABS[idx][0]); }
    else placeLens();
  };
  tabbar.addEventListener('pointerup', e => lensEnd(e, true));
  tabbar.addEventListener('pointercancel', e => lensEnd(e, false));
  tabbar.addEventListener('touchmove', e => { if (lensDrag) e.preventDefault(); }, { passive: false });
  window.addEventListener('resize', placeLens);

  function renderTabbar() {
    tabBtns.forEach((b, i) => {
      const on = TABS[i][0] === tabName;
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    placeLens();
    requestAnimationFrame(() => tabbar.classList.add('ready'));
  }

  function showTab(name) {
    if (page && page.leave) page.leave();
    tabName = name;
    const title = h('h1', { class: 'page-title' });
    const left = h('div', { class: 'page-side' }), right = h('div', { class: 'page-side' });
    const body = h('div', { class: 'page-body' });
    const foot = h('footer', { class: 'page-foot' });
    page = {
      closed: false, isPage: true, body, foot, render: null, leave: null, name,
      setTitle: v => { title.textContent = v == null ? '' : v; title.hidden = !v; },
      setLeft: v => left.replaceChildren(...(v ? [v] : [])),
      setRight: v => right.replaceChildren(...(v ? [v] : [])),
      close: () => {}
    };
    home.className = 'tab-' + name;
    home.replaceChildren(h('header', { class: 'page-head' }, left, h('div', { class: 'page-brand' }, h('b', null, 'Bon_Scan'), h('span', { 'data-version': '' }, 'Alpha ' + VERSION)), right), title, body, foot, tabbar);
    renderTabbar();
    if (name === 'scan') openScan(page);
    else if (name === 'bons') openBons(page);
    else if (name === 'stats') openStats(page);
    else openSettings(page);
  }

  function refreshAll() {
    if (page && page.render) page.render();
    stack.slice().forEach(s => { if (s.render && !s.closed) s.render(); });
  }

  // ------------------------------------------------------------ Scan: Kamera direkt beim Öffnen
  let cam = null;
  function cameraCheck() {
    if (!cam) return;
    const want = tabName === 'scan' && !stack.length && document.visibilityState === 'visible';
    if (want) cam.start(); else cam.stop();
  }
  document.addEventListener('visibilitychange', cameraCheck);

  function openScan(pg) {
    pg.setTitle('');
    pg.body.classList.add('cam-body');
    const video = h('video', { class: 'cam-video', playsinline: true, muted: true, autoplay: true });
    const guide = h('div', { class: 'cam-guide' }, h('i'), h('i'), h('i'), h('i'));
    const msg = h('div', { class: 'cam-msg', hidden: true });
    const flash = h('div', { class: 'cam-flash' });
    let busy = false;
    const shutter = h('button', { class: 'shutter cam-shutter', 'aria-label': 'Auslösen', 'data-act': 'shutter', onclick: shoot });
    const finder = h('div', { class: 'cam' }, video, guide, flash, msg, shutter);
    pg.body.append(finder);

    let torchOn = false;
    const torchBtn = h('button', { class: 'icon-btn', 'aria-label': 'Licht', 'data-act': 'torch', hidden: true, onclick: async () => { torchOn = !torchOn; if (await OCR.setTorch(torchOn)) { torchBtn.classList.toggle('ok', torchOn); haptic(); } } }, icon('bolt'));
    pg.setLeft(h('button', { class: 'icon-btn', 'aria-label': 'Foto aus der Mediathek', 'data-act': 'import', onclick: importPhoto }, icon('image')));
    pg.setRight(torchBtn);

    let running = false, failed = false;
    cam = {
      start: async () => {
        if (running || failed) return;
        running = true;
        try {
          await OCR.startCamera(video);
          msg.hidden = true;
          torchBtn.hidden = !OCR.torchSupported();
        } catch (e) {
          running = false; failed = true;
          showNoCam();
        }
      },
      stop: () => { if (!running) return; running = false; torchOn = false; torchBtn.classList.remove('ok'); OCR.stopCamera(video); }
    };
    function showNoCam() {
      msg.hidden = false;
      msg.replaceChildren(icon('camera'), h('p', null, 'Kamera nicht verfügbar'),
        h('button', { class: 'btn primary', 'data-act': 'cam-native', onclick: nativePhoto }, 'Foto aufnehmen'),
        h('button', { class: 'btn ghost', 'data-act': 'cam-retry', onclick: () => { failed = false; cameraCheck(); } }, 'Erneut versuchen'));
    }
    async function shoot() {
      if (busy) return;
      haptic();
      if (failed || !running) { nativePhoto(); return; }
      const canvas = OCR.captureFrame(video, guide);
      if (!canvas) { toast('Kamera ist noch nicht bereit'); return; }
      busy = true;
      flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
      setTimeout(() => { busy = false; }, 600);
      startReceipt(canvas);
    }
    async function nativePhoto() {
      const f = await pickFile('image/*', true);
      if (f) startReceipt(await OCR.fileToCanvas(f));
    }
    async function importPhoto() {
      const f = await pickFile('image/*', false);
      if (f) startReceipt(await OCR.fileToCanvas(f));
    }
    pg.leave = () => { if (cam) cam.stop(); cam = null; };
    cameraCheck();
  }

  // ------------------------------------------------------------ Neuer Bon: erkennen, prüfen, sichern
  function emptyReceipt() {
    return { id: uid(), store: null, date: null, total: null, items: [], photoIds: [], text: '', createdAt: Date.now() };
  }

  function startReceipt(canvas) {
    const d = emptyReceipt();
    d.date = Date.now();
    const ctx = { isNew: true, reading: true, progress: 0, phase: 'prep', photos: [], scans: [], error: null, canvas };
    openReceipt(d, ctx);
  }

  // Aus beiden Durchgängen der Texterkennung das Ergebnis wählen, das am besten zum Bon passt.
  // Haben beide dieselben Artikel (gleiche Preise in gleicher Reihenfolge), gewinnt je Artikel die sicherer gelesene Zeile.
  function bestParse(results) {
    const scored = results.map(res => {
      const parsed = P.parse(res.text, { lines: res.lines, learned: S.learned });
      const checks = parsed.items.filter(i => i.check && i.check.includes('lesen')).length;
      const fits = parsed.totalFound && Math.abs(parsed.sum - parsed.total) < 0.01;
      parsed.items.forEach(i => { i._img = res.image; });
      return { res, parsed, score: (fits ? 1000 : 0) + (parsed.totalFound ? 200 : 0) + parsed.items.length * 10 - checks * 4 + res.confidence / 10 };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (scored[1]) {
      const A = best.parsed.items, B = scored[1].parsed.items;
      if (A.length === B.length && A.every((x, i) => x.price === B[i].price)) {
        A.forEach((x, i) => {
          const y = B[i], bad = z => (z.check || []).length * 100 - (z.conf || 0);
          if (bad(y) < bad(x)) A[i] = y;
        });
      }
    }
    return best;
  }

  // Texterkennung für ein Bild; Ergebnis wird an den Entwurf angehängt (für lange Bons in Abschnitten)
  async function readInto(d, ctx, canvas, sheet) {
    ctx.reading = true; ctx.error = null; ctx.progress = 0;
    ctx.phase = OCR.state.status === 'ready' ? 'read' : 'prep';
    sheet.render();
    const off = OCR.onState(st => { if (ctx.phase === 'prep') { ctx.progress = st.progress || 0; sheet.render(); } });
    try {
      if (S.settings.keepPhotos) { const b = await OCR.thumbBlob(canvas, 1000); if (b) ctx.photos.push(b); }
      const results = await OCR.recognize(canvas, p => { ctx.phase = 'read'; ctx.progress = p; sheet.render(); });
      const { parsed, res } = bestParse(results);
      d.text = (d.text ? d.text + '\n\n' : '') + res.text.trim();
      // das bearbeitete Bild mit allen erkannten Zeilen aufheben: damit sieht man später, was noch fehlt
      const si = (d.scans || []).length + ctx.scans.length;
      const sc = Math.min(1, 1000 / res.image.width);
      const box = b => b ? [b.x0, b.y0, b.x1, b.y1].map(v => Math.round(v * sc)) : null;
      ctx.scans.push({
        blob: await OCR.thumbBlob(res.image, 1000),
        w: Math.round(res.image.width * sc), h: Math.round(res.image.height * sc),
        lines: res.lines.map(l => ({ t: l.text, b: box(l.bbox) }))
      });
      if (!d.store && parsed.store) d.store = parsed.store;
      if (parsed.date && (!d.date || ctx.firstScan !== false)) d.date = parsed.date;
      if (parsed.totalFound) d.total = parsed.total;
      parsed.items.forEach(it => {
        it.id = uid();
        // Zeilenausschnitt nur für Artikel, bei denen der Nutzer nachsehen soll
        if (it.check && it.check.includes('lesen') || it.check && it.check.includes('preis')) it.crop = OCR.lineCrop(it._img || res.image, it.bbox);
        it.si = si; it.b = box(it.bbox);
        ['bbox', 'line', 'minWord', 'conf', 'unreadable', '_img'].forEach(k => delete it[k]);
        d.items.push(it);
      });
      ctx.firstScan = false;
      if (!d.items.length) toast('Keine Artikel erkannt');
      else haptic();
    } catch (e) {
      ctx.error = OCR.state.status === 'error'
        ? 'Die Texterkennung konnte nicht geladen werden. Öffne die App einmal mit Internetverbindung, danach funktioniert sie offline.'
        : 'Der Bon konnte nicht gelesen werden.';
    } finally {
      off();
      ctx.reading = false;
      if (!sheet.closed) sheet.render();
    }
  }

  function openReceipt(src, ctx) {
    ctx = ctx || { isNew: false };
    ctx.scans = ctx.scans || [];
    const d = ctx.isNew ? src : JSON.parse(JSON.stringify(src));
    const startJson = ctx.isNew ? null : JSON.stringify(d);
    let dirty = () => ctx.isNew ? !ctx.reading : JSON.stringify(d) !== startJson;

    const sheet = openSheet({
      beforeClose: async () => {
        if (ctx.reading) return !!(await confirmDelete('Scan abbrechen?', 'Abbrechen')) || false;
        if (!dirty()) return true;
        const a = await askSave(ctx.isNew ? 'Bon sichern?' : 'Änderungen sichern?');
        if (a === 'save') { await save(); return false; }
        return a === 'discard';
      }
    });

    async function save() {
      if (ctx.reading) return;
      d.open = openChecks(d).length + (d.total == null && d.items.length ? 1 : 0);
      for (const b of ctx.photos || []) { try { d.photoIds.push(await putPhoto(b)); } catch (e) {} }
      ctx.photos = [];
      for (const sc of ctx.scans) { try { (d.scans = d.scans || []).push({ id: await putPhoto(sc.blob), w: sc.w, h: sc.h, lines: sc.lines }); } catch (e) {} }
      ctx.scans = [];
      d.updatedAt = Date.now();
      try { await DB.put('receipts', d); } catch (e) { toast('Speichern fehlgeschlagen'); return; }
      const i = S.receipts.findIndex(r => r.id === d.id);
      if (i >= 0) S.receipts[i] = d; else S.receipts.unshift(d);
      haptic();
      sheet.close();
      refreshAll();
      toast('Gespeichert');
    }

    const editItem = (it, anchor) => openItem(it, {
      onSave: async (next, classChanged) => {
        Object.assign(it, next);
        delete it.check; delete it.guessed;
        let n = 0;
        if (classChanged || it.cat !== 'unbekannt') {
          n = await learn(it, d.id);
          const key = keyOf(it);
          d.items.forEach(x => { if (x !== it && keyOf(x) === key) { Object.assign(x, { cat: it.cat, diet: it.diet, conv: it.conv, health: it.health, name: it.name, src: 'learned' }); n++; } });
        }
        sheet.render();
        if (n) toast('Gemerkt · ' + n + ' weitere ' + (n === 1 ? 'Artikel' : 'Artikel') + ' angepasst');
      },
      onDelete: () => removeItem(it)
    });

    async function itemMenu(id, el) {
      const it = d.items.find(x => x.id === id);
      if (!it) return;
      const a = await popMenu(el, [
        { label: 'Bearbeiten', value: 'edit', icon: 'pencil' },
        { label: 'Löschen', value: 'delete', icon: 'trash', danger: true }
      ], it.name);
      if (a === 'edit') editItem(it);
      else if (a === 'delete') removeItem(it);
    }
    function removeItem(it) {
      const at = d.items.indexOf(it);
      d.items = d.items.filter(x => x !== it);
      sheet.render();
      toast('Entfernt', () => { d.items.splice(Math.min(at, d.items.length), 0, it); sheet.render(); });
    }

    async function pickStore(e) {
      const known = [...new Set(S.receipts.map(r => r.store).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
      const a = await popMenu(e.currentTarget, [
        ...known.map(s => ({ label: s, value: s, checked: s === d.store })),
        { label: 'Anderer Name …', value: '__new', icon: 'pencil' }
      ], 'Markt');
      if (a === '__new') { const n = await askText('Markt', d.store, 'Name'); if (n) d.store = n; }
      else if (a) d.store = a;
      sheet.render();
    }

    async function addSection() {
      const f = await pickFile('image/*', true);
      if (!f) return;
      ctx.firstScan = false;
      readInto(d, ctx, await OCR.fileToCanvas(f), sheet);
    }

    const itemRows = h('div', { class: 'group items' });
    holdable(itemRows, itemMenu);

    sheet.render = () => {
      sheet.setTitle(ctx.isNew ? 'Neuer Bon' : (d.store || 'Bon'));
      sheet.setRight(ctx.reading ? null : okButton(save));
      const kids = [];
      if (ctx.reading) {
        const label = ctx.phase === 'prep' ? 'Texterkennung wird vorbereitet' : 'Bon wird gelesen';
        kids.push(h('div', { class: 'reading' },
          h('div', { class: 'reading-title' }, label),
          h('div', { class: 'meter' }, h('i', { style: 'width:' + Math.round((ctx.progress || 0) * 100) + '%' })),
          h('div', { class: 'reading-pct num' }, Math.round((ctx.progress || 0) * 100) + ' %')));
        if (!d.items.length) { sheet.body.replaceChildren(...kids); return; }
      }
      if (ctx.error) kids.push(h('div', { class: 'error-box' }, h('p', null, ctx.error),
        ctx.canvas ? h('button', { class: 'btn primary', 'data-act': 'retry', onclick: () => readInto(d, ctx, ctx.canvas, sheet) }, 'Erneut versuchen') : null));

      const sum = itemSum(d.items);
      const diff = d.total == null ? 0 : round2(sum - d.total);
      const open = openChecks(d);
      if (open.length || (d.items.length && d.total == null)) {
        const parts = [];
        const n = k => open.filter(it => it.check.includes(k)).length;
        if (n('lesen')) parts.push(n('lesen') + ' unsicher gelesen');
        if (n('preis')) parts.push(n('preis') + ' Preis prüfen');
        if (n('zuordnen')) parts.push(n('zuordnen') + ' nicht zugeordnet');
        if (d.total == null) parts.push('Summe nicht erkannt');
        kids.push(h('div', { class: 'help-card' },
          h('div', { class: 'help-title' }, open.length ? (open.length === 1 ? '1 Artikel braucht deine Hilfe' : open.length + ' Artikel brauchen deine Hilfe') : 'Die Summe braucht deine Hilfe'),
          h('div', { class: 'help-sub' }, parts.join(' · ')),
          h('button', { class: 'btn primary', 'data-act': 'check', onclick: () => openCheck(d, sheet) }, 'Jetzt prüfen')));
      }
      kids.push(group(
        lineBtn('Markt', d.store || 'Wählen', pickStore, { 'data-act': 'store' }),
        line('Datum', h('input', { type: 'date', 'data-field': 'date', value: toDateInput(d.date), onchange: e => { d.date = fromDateInput(e.target.value, d.date); } })),
        line('Summe laut Bon', h('span', { class: 'euro-field' + (d.total == null && d.items.length ? ' missing' : '') }, euroInput(d.total, n => { d.total = n; sheet.render(); }, 'total'), h('span', null, '€'))),
        line('Summe der Artikel', h('span', { class: 'line-value num' + (Math.abs(diff) >= 0.01 ? ' warn' : '') }, fmtEur(sum)))
      ));
      if (d.items.length && Math.abs(diff) >= 0.01) kids.push(note('Differenz ' + fmtEur(Math.abs(diff)) + (diff > 0 ? ' zu viel' : ' zu wenig') + '. Fehlt ein Artikel oder ist ein Preis falsch gelesen?'));

      kids.push(sectionLabel('Artikel' + (d.items.length ? ' (' + d.items.length + ')' : '')));
      itemRows.replaceChildren(...d.items.map(it => itemRow(it, () => editItem(it))));
      if (!d.items.length) itemRows.append(h('div', { class: 'line muted-line' }, 'Keine Artikel'));
      kids.push(itemRows);
      kids.push(group(h('button', { class: 'line action', 'data-act': 'add-item', onclick: () => openAddItem(d, ctx, sheet) }, icon('plus'), 'Artikel hinzufügen')));

      kids.push(sectionLabel('Bon'));
      kids.push(group(
        lineBtn('Weiteren Teil scannen', null, addSection, { 'data-act': 'add-section' }),
        (d.photoIds.length || (ctx.photos || []).length) ? lineBtn('Foto', String(d.photoIds.length + (ctx.photos || []).length), () => openPhotos(d, ctx)) : null,
        d.text ? lineBtn('Erkannter Text', null, () => openText(d.text)) : null
      ));
      if (!ctx.isNew) kids.push(group(h('button', { class: 'line danger', 'data-act': 'delete-receipt', onclick: async () => {
        if (!(await confirmDelete('Bon „' + (src.store || 'Bon') + '“ in den Papierkorb verschieben?'))) return;
        await trashReceipt(src);
        dirty = () => false;
        sheet.close();
        refreshAll();
        toast('In den Papierkorb verschoben');
      } }, 'Bon löschen')));
      sheet.body.replaceChildren(...kids);
    };
    sheet.render();
    if (ctx.canvas && ctx.isNew) readInto(d, ctx, ctx.canvas, sheet);
    return sheet;
  }

  const CHECK_TEXT = { lesen: 'Unsicher gelesen', preis: 'Preis prüfen', zuordnen: 'Nicht zugeordnet' };
  const openChecks = d => d.items.filter(it => it.check && it.check.length);
  function itemMeta(it) {
    const parts = [];
    if (it.check && it.check.length) return it.check.map(k => CHECK_TEXT[k]).join(' · ');
    if (it.kg) parts.push(String(it.kg).replace('.', ',') + ' kg × ' + fmtEur(it.perKg) + '/kg');
    else if (it.qty > 1) parts.push(it.qty + ' × ' + fmtEur(it.unit != null ? it.unit : it.price / it.qty));
    const c = catOf(it.cat);
    parts.push(c.name);
    if (c.food !== false && it.cat !== 'unbekannt') {
      if (it.diet) parts.push(dietName(it.diet));
      if (it.conv) parts.push('Convenience');
    }
    if (it.discount) parts.push('Rabatt ' + fmtEur(it.discount));
    if (it.fixed) parts.push('Preis an Summe angeglichen');
    return parts.join(' · ');
  }
  function itemRow(it, onTap, extra) {
    const open = it.check && it.check.length;
    return h('button', { class: 'line item-row' + (open ? ' needs-check' : it.cat === 'unbekannt' ? ' unknown' : ''), 'data-drag': it.id, onclick: onTap },
      open ? h('span', { class: 'check-mark', 'aria-label': 'Prüfen' }, '?') : h('span', { class: 'diet-dot', style: 'background:' + dietColor(it) }),
      h('span', { class: 'line-label two' }, h('b', null, it.name || 'Ohne Namen'), h('small', null, extra || itemMeta(it))),
      h('span', { class: 'line-value num' }, it.price == null ? '–' : fmtEur(it.price)));
  }
  function dietColor(it) {
    if (!isFood(it)) return 'transparent';
    return (D.DIETS.find(x => x.k === (it.diet || null)) || D.DIETS[D.DIETS.length - 1]).color;
  }

  // ------------------------------------------------------------ Prüfen: Schritt für Schritt durch alles, was unsicher ist
  async function learnIgnore(it) {
    const key = keyOf(it);
    if (!key || key.length < 3) return;
    const rec = { key, ignore: true, name: it.name || it.raw, at: Date.now() };
    S.learned[key] = rec;
    try { await DB.put('learned', rec); } catch (e) {}
  }

  function openCheck(d, parent) {
    const steps = openChecks(d).map(it => ({ it, dr: { name: it.name || '', price: it.price, cat: it.cat, diet: it.diet || null, conv: !!it.conv, health: it.health || null, catTouched: it.cat !== 'unbekannt' } }));
    if (d.total == null && d.items.length) steps.push({ total: true, dr: { total: null } });
    if (!steps.length) return;
    let k = 0;
    const sheet = openSheet({ title: 'Prüfen', onClosed: () => parent.render() });
    const finish = () => {
      sheet.close();
      const left = openChecks(d).length + (d.total == null ? 1 : 0);
      toast(left ? left + ' Punkte noch offen' : 'Alles geprüft');
    };
    async function apply(st) {
      const it = st.it, dr = st.dr;
      if (st.total) { if (dr.total != null) d.total = dr.total; return; }
      if (!dr.name.trim()) return;
      Object.assign(it, { name: dr.name.trim(), price: dr.price, cat: dr.cat, diet: dr.diet, conv: dr.conv, health: dr.health, src: 'user' });
      if (it.qty > 1 && it.price != null) it.unit = round2(it.price / it.qty);
      delete it.check; delete it.guessed; delete it.fixed;
      // Gemerkt wird unter dem gelesenen Text: liest die Erkennung dieselbe Zeile wieder so, kommt der richtige Name heraus
      if (it.cat !== 'unbekannt') {
        await learn(it, d.id);
        applyLearnedTo(d.items.filter(x => x !== it), keyOf(it));
      }
    }
    const next = async skip => {
      const st = steps[k];
      if (!skip) {
        if (st.it && !st.dr.name.trim()) { toast('Name fehlt'); return; }
        if (st.it && st.dr.price == null) { toast('Preis fehlt'); return; }
        await apply(st);
      }
      haptic();
      if (k < steps.length - 1) { k++; sheet.render(); } else finish();
    };
    const pick = async (e, st, key, list, title) => {
      const a = await popMenu(e.currentTarget, list.map(x => ({ label: x.name, value: x.k == null ? '__null' : x.k, checked: (st.dr[key] || null) === (x.k || null) })), title);
      if (a === undefined) return;
      const v = a === '__null' ? null : a;
      if (key === 'cat') {
        const c = catOf(v);
        st.dr.cat = v; st.dr.catTouched = true;
        if (c.food === false) { st.dr.diet = null; st.dr.health = null; st.dr.conv = false; }
        else { if (c.d !== undefined) st.dr.diet = c.d; if (c.h !== undefined) st.dr.health = c.h; st.dr.conv = !!c.v; }
      } else st.dr[key] = v;
      sheet.render();
    };
    sheet.render = () => {
      const st = steps[k];
      sheet.setTitle('Prüfen ' + (k + 1) + ' von ' + steps.length);
      const kids = [h('div', { class: 'progress' }, steps.map((_, i) => h('i', { class: i < k ? 'done' : i === k ? 'on' : null })))];
      if (st.total) {
        kids.push(h('div', { class: 'step-title' }, 'Wie hoch ist die Summe?'));
        kids.push(group(line('Summe laut Bon', h('span', { class: 'euro-field' }, euroInput(st.dr.total, n => { st.dr.total = n; }, 'check-total'), h('span', null, '€')))));
        kids.push(note('Summe der erkannten Artikel: ' + fmtEur(itemSum(d.items))));
      } else {
        const it = st.it, dr = st.dr, c = it.check || [];
        const title = c.includes('lesen') ? 'Was steht hier?' : c.includes('preis') ? 'Stimmt der Preis?' : 'Was ist das?';
        kids.push(h('div', { class: 'step-title' }, title));
        if (it.crop) kids.push(h('img', { class: 'line-crop', src: it.crop, alt: 'Ausschnitt vom Bon' }));
        else if (it.raw) kids.push(h('div', { class: 'raw-text' }, it.raw));
        const why = [];
        if (it.guessed) why.push('Name geraten');
        if (c.includes('lesen') && !it.guessed) why.push('Schrift unsicher gelesen');
        if (it.fixed) why.push('Preis an die Summe angeglichen');
        if (it.price == null) why.push('Preis nicht gelesen');
        if (c.includes('zuordnen')) why.push('Produkt unbekannt');
        kids.push(note(why.join(' · ')));
        const food = catOf(dr.cat).food !== false;
        kids.push(group(
          line('Name', h('input', { type: 'text', 'data-field': 'check-name', value: dr.name, placeholder: 'Wie heißt das Produkt?', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'next',
            oninput: e => { dr.name = e.target.value; },
            onchange: e => {
              // Kategorie vorschlagen, solange der Nutzer keine gewählt hat
              if (dr.catTouched) return;
              const g = P.categorize(e.target.value, S.learned);
              if (!g.ignore && g.cat !== 'unbekannt') { Object.assign(dr, { cat: g.cat, diet: g.diet, conv: g.conv, health: g.health }); sheet.render(); }
            } })),
          line('Preis', h('span', { class: 'euro-field' }, euroInput(dr.price, n => { dr.price = n; }, 'check-price'), h('span', null, '€')))
        ));
        kids.push(group(
          lineBtn('Kategorie', dr.cat === 'unbekannt' ? 'Wählen' : catOf(dr.cat).name, e => pick(e, st, 'cat', D.CATS.filter(x => x.k !== 'unbekannt'), 'Kategorie'), { 'data-act': 'check-cat' }),
          food && dr.cat !== 'unbekannt' ? lineBtn('Ernährung', dietName(dr.diet), e => pick(e, st, 'diet', D.DIETS, 'Ernährung'), { 'data-act': 'check-diet' }) : null,
          food && dr.cat !== 'unbekannt' ? lineSwitch('Convenience', dr.conv, v => { dr.conv = v; }, 'check-conv') : null
        ));
        kids.push(group(h('button', { class: 'line danger', 'data-act': 'not-item', onclick: async () => {
          const at = d.items.indexOf(it), stepAt = k, prev = S.learned[keyOf(it)];
          d.items = d.items.filter(x => x !== it);
          await learnIgnore(it);
          steps.splice(k, 1);
          // Rückgängig: Artikel, Schritt und vorherige Zuordnung wiederherstellen
          const undo = async () => {
            d.items.splice(Math.min(at, d.items.length), 0, it);
            const key = keyOf(it);
            if (prev) { S.learned[key] = prev; try { await DB.put('learned', prev); } catch (e) {} }
            else { delete S.learned[key]; try { await DB.del('learned', key); } catch (e) {} }
            steps.splice(Math.min(stepAt, steps.length), 0, st);
            parent.render();
            if (sheet.closed) { toast('Wiederhergestellt'); return; }
            k = Math.min(stepAt, steps.length - 1);
            sheet.render();
          };
          toast('Kein Artikel', undo);
          parent.render();
          if (!steps.length) { sheet.close(); return; }
          if (k >= steps.length) k = steps.length - 1;
          sheet.render();
        } }, 'Kein Artikel')));
      }
      sheet.body.replaceChildren(...kids);
      sheet.foot.className = 'sheet-foot three';
      sheet.foot.replaceChildren(
        h('button', { class: 'btn ghost', 'data-act': 'check-back', style: k ? null : 'visibility:hidden', onclick: () => { if (k) { k--; sheet.render(); } } }, 'Zurück'),
        h('button', { class: 'btn ghost', 'data-act': 'check-skip', onclick: () => next(true) }, 'Überspringen'),
        h('button', { class: 'btn primary', 'data-act': 'check-next', onclick: () => next(false) }, k < steps.length - 1 ? 'Weiter' : 'Fertig'));
    };
    sheet.render();
  }

  // ------------------------------------------------------------ Artikel hinzufügen mit Blick auf den Bon
  // Oben der bearbeitete Bon: erfasste Zeilen sind markiert, eine fehlende Zeile antippen übernimmt Name und Preis.
  function openAddItem(d, ctx, parent) {
    const dr = { name: '', price: null, qty: 1, cat: 'unbekannt', diet: null, conv: false, health: null, catTouched: false, raw: '' };
    const sheet = openSheet({
      title: 'Artikel hinzufügen',
      beforeClose: async () => {
        if (!dr.name.trim() && dr.price == null) return true;
        const a = await askSave('Artikel hinzufügen?');
        if (a === 'save') { await add(); return false; }
        return a === 'discard';
      }
    });
    async function add() {
      if (!dr.name.trim()) { toast('Name fehlt'); return; }
      if (dr.price == null) { toast('Preis fehlt'); return; }
      const it = { id: uid(), raw: (dr.raw || dr.name).trim(), name: dr.name.trim(), price: dr.price, qty: dr.qty, cat: dr.cat, diet: dr.diet, conv: dr.conv, health: dr.health, src: 'user' };
      if (dr.si != null) { it.si = dr.si; it.b = dr.b; }
      if (it.qty > 1) it.unit = round2(it.price / it.qty);
      // an der Stelle einsortieren, an der die Zeile auf dem Bon steht
      let at = d.items.length;
      if (it.b) { const j = d.items.findIndex(x => (x.si || 0) > it.si || ((x.si || 0) === it.si && x.b && x.b[1] > it.b[1])); if (j >= 0) at = j; }
      d.items.splice(at, 0, it);
      if (it.cat !== 'unbekannt') await learn(it, d.id);
      haptic();
      sheet.close();
      parent.render();
      toast('Hinzugefügt');
    }
    const scans = () => [
      ...(d.scans || []).map((sc, i) => ({ sc, i, url: () => photoUrl(sc.id) })),
      ...ctx.scans.map((sc, j) => ({ sc, i: (d.scans || []).length + j, url: async () => URL.createObjectURL(sc.blob) }))
    ];
    const overlap = (a, b) => a && b && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > Math.min(a[3] - a[1], b[3] - b[1]) * .5;
    const view = h('div', { class: 'bon-view' });
    async function buildView() {
      const list = scans();
      if (!list.length) {
        // ältere Bons ohne bearbeitetes Bild: Foto zeigen, falls vorhanden
        for (const id of d.photoIds || []) { const u = await photoUrl(id); if (u) view.append(h('img', { src: u, alt: '' })); }
        for (const b of ctx.photos || []) view.append(h('img', { src: URL.createObjectURL(b), alt: '' }));
        if (!view.children.length) view.remove();
        return;
      }
      for (const { sc, i, url } of list) {
        const u = await url();
        const wrap = h('div', { class: 'bon-scan', style: 'aspect-ratio:' + sc.w + '/' + sc.h }, h('img', { src: u, alt: '' }));
        sc.lines.forEach(l => {
          if (!l.b) return;
          const done = d.items.some(it => it.si === i && overlap(it.b, l.b));
          const pct = (v, m) => (v / m * 100) + '%';
          wrap.append(h('button', {
            class: 'bon-line' + (done ? ' done' : ''), 'aria-label': l.t,
            style: 'left:' + pct(l.b[0], sc.w) + ';top:' + pct(l.b[1], sc.h) + ';width:' + pct(l.b[2] - l.b[0], sc.w) + ';height:' + pct(l.b[3] - l.b[1], sc.h),
            onclick: e => {
              view.querySelectorAll('.bon-line.on').forEach(x => x.classList.remove('on'));
              e.currentTarget.classList.add('on');
              haptic();
              if (done) { toast('Diese Zeile ist schon erfasst'); return; }
              const g = P.guessLine(l.t, S.learned);
              Object.assign(dr, { name: g.name, raw: g.raw, price: g.price, si: i, b: l.b });
              if (!dr.catTouched && g.cat !== 'unbekannt') Object.assign(dr, { cat: g.cat, diet: g.diet, conv: g.conv, health: g.health });
              renderForm();
            }
          }));
        });
        view.append(wrap);
      }
      // zum Anfang der Artikel springen statt zum Kopf des Bons
      requestAnimationFrame(() => {
        const first = view.querySelector('.bon-line.done');
        if (first) view.scrollTop = Math.max(0, first.offsetTop - 60);
      });
    }
    const form = h('div', { class: 'add-form' });
    const pick = async (e, key, list, title) => {
      const a = await popMenu(e.currentTarget, list.map(x => ({ label: x.name, value: x.k == null ? '__null' : x.k, checked: (dr[key] || null) === (x.k || null) })), title);
      if (a === undefined) return;
      const v = a === '__null' ? null : a;
      if (key === 'cat') {
        const c = catOf(v);
        dr.cat = v; dr.catTouched = true;
        if (c.food === false) { dr.diet = null; dr.health = null; dr.conv = false; }
        else { if (c.d !== undefined) dr.diet = c.d; if (c.h !== undefined) dr.health = c.h; dr.conv = !!c.v; }
      } else dr[key] = v;
      renderForm();
    };
    function renderForm() {
      const sum = itemSum(d.items), miss = d.total == null ? null : round2(d.total - sum);
      const food = catOf(dr.cat).food !== false;
      form.replaceChildren(
        miss != null && Math.abs(miss) >= 0.01 ? note(miss > 0 ? 'Es fehlen noch ' + fmtEur(miss) + ' bis zur Summe laut Bon.' : 'Die Artikel liegen ' + fmtEur(-miss) + ' über der Summe laut Bon.') : null,
        group(
          line('Name', h('input', { type: 'text', 'data-field': 'add-name', value: dr.name, placeholder: 'Wie heißt das Produkt?', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'next',
            oninput: e => { dr.name = e.target.value; },
            onchange: e => {
              if (dr.catTouched) return;
              const g = P.categorize(e.target.value, S.learned);
              if (!g.ignore && g.cat !== 'unbekannt') { Object.assign(dr, { cat: g.cat, diet: g.diet, conv: g.conv, health: g.health }); renderForm(); }
            } })),
          line('Preis', h('span', { class: 'euro-field' }, euroInput(dr.price, n => { dr.price = n; }, 'add-price'), h('span', null, '€'))),
          line('Menge', h('span', { class: 'stepper-s' },
            h('button', { type: 'button', 'aria-label': 'Weniger', onclick: e => { e.preventDefault(); if (dr.qty > 1) { dr.qty--; renderForm(); } } }, '−'),
            h('span', { class: 'step-num' }, dr.qty),
            h('button', { type: 'button', 'aria-label': 'Mehr', onclick: e => { e.preventDefault(); dr.qty++; renderForm(); } }, '+')))
        ),
        group(
          lineBtn('Kategorie', dr.cat === 'unbekannt' ? 'Wählen' : catOf(dr.cat).name, e => pick(e, 'cat', D.CATS.filter(x => x.k !== 'unbekannt'), 'Kategorie'), { 'data-act': 'add-cat' }),
          food && dr.cat !== 'unbekannt' ? lineBtn('Ernährung', dietName(dr.diet), e => pick(e, 'diet', D.DIETS, 'Ernährung'), { 'data-act': 'add-diet' }) : null,
          food && dr.cat !== 'unbekannt' ? lineSwitch('Convenience', dr.conv, v => { dr.conv = v; }, 'add-conv') : null
        )
      );
    }
    sheet.setRight(okButton(add, 'add-ok'));
    const hasView = (d.scans || []).length || ctx.scans.length;
    sheet.body.append(view, hasView ? note('Markierte Zeilen sind erfasst. Tippe auf eine Zeile, die fehlt.') : null, form);
    renderForm();
    buildView();
  }

  // ------------------------------------------------------------ Artikel bearbeiten
  function openItem(it, ctx) {
    const d = { name: it.name || '', price: it.price, qty: it.qty || 1, cat: it.cat, diet: it.diet || null, conv: !!it.conv, health: it.health || null };
    const start = JSON.stringify(d);
    const dirty = () => JSON.stringify(d) !== start;
    const sheet = openSheet({
      beforeClose: async () => {
        if (!dirty()) return true;
        const a = await askSave('Änderungen am Artikel sichern?');
        if (a === 'save') { await save(); return false; }
        return a === 'discard';
      }
    });
    async function save() {
      if (!d.name.trim()) { toast('Name fehlt'); return; }
      const classChanged = ['cat', 'diet', 'conv', 'health', 'name'].some(k => JSON.stringify(d[k]) !== JSON.stringify(JSON.parse(start)[k]));
      const next = Object.assign({}, d, { name: d.name.trim(), src: classChanged ? 'user' : it.src });
      if (next.qty > 1 && next.price != null) next.unit = round2(next.price / next.qty);
      sheet.close();
      await ctx.onSave(next, classChanged);
    }
    const pick = async (e, key, list, title) => {
      const a = await popMenu(e.currentTarget, list.map(x => ({ label: x.name, value: x.k == null ? '__null' : x.k, checked: (d[key] || null) === (x.k || null) })), title);
      if (a === undefined) return;
      const v = a === '__null' ? null : a;
      if (key === 'cat' && v !== d.cat) {
        const c = catOf(v);
        d.cat = v;
        if (c.food === false) { d.diet = null; d.health = null; d.conv = false; }
        else { if (c.d !== undefined) d.diet = c.d; if (c.h !== undefined) d.health = c.h; d.conv = !!c.v; }
      } else d[key] = v;
      sheet.render();
    };
    sheet.render = () => {
      sheet.setTitle(ctx.isNew ? 'Neuer Artikel' : 'Artikel');
      sheet.setRight(okButton(save, 'item-ok'));
      const food = catOf(d.cat).food !== false;
      const kids = [
        it.crop ? h('img', { class: 'line-crop', src: it.crop, alt: 'Ausschnitt vom Bon' }) : null,
        group(
          line('Name', h('input', { type: 'text', 'data-field': 'name', value: d.name, placeholder: 'Name', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done', oninput: e => { d.name = e.target.value; } })),
          line('Preis', h('span', { class: 'euro-field' }, euroInput(d.price, n => { d.price = n; }, 'price'), h('span', null, '€'))),
          line('Menge', h('span', { class: 'stepper-s' },
            h('button', { type: 'button', 'aria-label': 'Weniger', onclick: e => { e.preventDefault(); if (d.qty > 1) { d.qty--; sheet.render(); } } }, '−'),
            h('span', { class: 'step-num' }, d.qty),
            h('button', { type: 'button', 'aria-label': 'Mehr', onclick: e => { e.preventDefault(); d.qty++; sheet.render(); } }, '+')))
        ),
        group(
          lineBtn('Kategorie', catOf(d.cat).name, e => pick(e, 'cat', D.CATS, 'Kategorie'), { 'data-act': 'cat' }),
          food ? lineBtn('Ernährung', dietName(d.diet), e => pick(e, 'diet', D.DIETS, 'Ernährung'), { 'data-act': 'diet' }) : null,
          food ? lineBtn('Gesund', healthName(d.health), e => pick(e, 'health', D.HEALTH, 'Gesund'), { 'data-act': 'health' }) : null,
          food ? lineSwitch('Convenience', d.conv, v => { d.conv = v; }, 'conv') : null
        ),
        note('Zuordnung und Name werden für diesen Artikel gemerkt.')
      ];
      if (it.raw && it.raw !== d.name) kids.push(note('Auf dem Bon: ' + it.raw));
      if (ctx.onDelete) kids.push(group(h('button', { class: 'line danger', 'data-act': 'delete-item', onclick: async () => {
        if (!(await confirmDelete('Artikel „' + (it.name || '') + '“ entfernen?', 'Entfernen'))) return;
        sheet.close(); ctx.onDelete();
      } }, 'Artikel entfernen')));
      sheet.body.replaceChildren(...kids);
    };
    sheet.render();
  }

  // ------------------------------------------------------------ Foto und erkannter Text
  async function openPhotos(d, ctx) {
    const sheet = openSheet({ title: 'Foto' });
    const box = h('div', { class: 'photos' });
    sheet.body.append(box);
    for (const id of d.photoIds) { const u = await photoUrl(id); if (u) box.append(h('img', { src: u, alt: '' })); }
    for (const b of (ctx && ctx.photos) || []) box.append(h('img', { src: URL.createObjectURL(b), alt: '' }));
  }
  function openText(text) {
    const sheet = openSheet({ title: 'Erkannter Text' });
    sheet.body.append(h('pre', { class: 'ocr-text' }, text));
  }

  // ------------------------------------------------------------ Papierkorb
  async function trashReceipt(r) {
    const x = S.receipts.find(y => y.id === r.id);
    if (!x) return;
    x.deletedAt = Date.now();
    await DB.put('receipts', x);
  }
  async function purgeReceipt(r) {
    await dropPhotos((r.photoIds || []).concat((r.scans || []).map(x => x.id)));
    await DB.del('receipts', r.id);
    S.receipts = S.receipts.filter(x => x.id !== r.id);
  }
  function openTrash() {
    const sheet = openSheet({ title: 'Papierkorb' });
    const box = h('div', { class: 'group' });
    holdable(box, (id, el) => menu(id, el));
    async function menu(id, el) {
      const r = S.receipts.find(x => x.id === id);
      if (!r) return;
      const a = await popMenu(el, [
        { label: 'Wiederherstellen', value: 'restore', icon: 'undo' },
        { label: 'Endgültig löschen', value: 'purge', icon: 'trash', danger: true }
      ], r.store || 'Bon');
      if (a === 'restore') { delete r.deletedAt; await DB.put('receipts', r); refreshAll(); toast('Wiederhergestellt'); }
      else if (a === 'purge') {
        if (!(await confirmDelete('Bon „' + (r.store || 'Bon') + '“ endgültig löschen?'))) return;
        await purgeReceipt(r); refreshAll();
      }
    }
    sheet.render = () => {
      const list = S.receipts.filter(r => r.deletedAt).sort((a, b) => a.deletedAt - b.deletedAt);
      if (!list.length) { sheet.body.replaceChildren(h('div', { class: 'empty' }, 'Der Papierkorb ist leer.')); return; }
      box.replaceChildren(...list.map(r => {
        const left = Math.max(1, TRASH_DAYS - Math.floor((Date.now() - r.deletedAt) / DAY));
        return h('button', { class: 'line', 'data-drag': r.id, onclick: e => menu(r.id, e.currentTarget) },
          h('span', { class: 'line-label two' }, h('b', null, r.store || 'Bon'), h('small', null, fmtDate(rDate(r)) + ' · noch ' + left + (left === 1 ? ' Tag' : ' Tage'))),
          h('span', { class: 'line-value num' }, fmtEur(r.total)));
      }));
      sheet.body.replaceChildren(box);
    };
    sheet.render();
  }

  // ------------------------------------------------------------ Bons
  function openBons(pg) {
    pg.setTitle('Bons');
    const box = h('div', { class: 'list' });
    holdable(box, async (id, el) => {
      const r = S.receipts.find(x => x.id === id);
      if (!r) return;
      const a = await popMenu(el, [
        { label: 'Bearbeiten', value: 'edit', icon: 'pencil' },
        r.photoIds && r.photoIds.length ? { label: 'Foto', value: 'photo', icon: 'image' } : null,
        { label: 'Löschen', value: 'delete', icon: 'trash', danger: true }
      ], r.store || 'Bon');
      if (a === 'edit') openReceipt(r);
      else if (a === 'photo') openPhotos(r);
      else if (a === 'delete') {
        if (!(await confirmDelete('Bon „' + (r.store || 'Bon') + '“ in den Papierkorb verschieben?'))) return;
        await trashReceipt(r); refreshAll(); toast('In den Papierkorb verschoben');
      }
    });
    pg.render = () => {
      const list = live().sort((a, b) => rDate(b) - rDate(a));
      if (!list.length) {
        pg.body.replaceChildren(h('div', { class: 'empty' }, 'Noch keine Bons.', h('div', null, h('button', { class: 'btn primary', 'data-act': 'go-scan', onclick: () => showTab('scan') }, icon('tabScan'), 'Bon scannen'))));
        return;
      }
      const months = new Map();
      list.forEach(r => { const d = new Date(rDate(r)), k = d.getFullYear() + '-' + d.getMonth(); if (!months.has(k)) months.set(k, []); months.get(k).push(r); });
      const kids = [];
      months.forEach(rs => {
        kids.push(h('div', { class: 'section-label month-label' }, h('span', null, cap(fmtMonth(rDate(rs[0])))), h('span', { class: 'num' }, fmtEur(rs.reduce((s, r) => s + (r.total || 0), 0)))));
        kids.push(h('div', { class: 'group' }, rs.map(r => {
          const unk = r.items.filter(i => i.cat === 'unbekannt').length;
          return h('button', { class: 'line', 'data-drag': r.id, onclick: () => openReceipt(r) },
            h('span', { class: 'line-label two' }, h('b', null, r.store || 'Bon'),
              h('small', null, fmtDate(rDate(r)) + ' · ' + r.items.length + ' Artikel', r.open ? h('span', { class: 'open-count' }, ' · ' + r.open + ' offen') : (unk ? ' · ' + unk + ' nicht zugeordnet' : ''))),
            h('span', { class: 'line-value num big' }, fmtEur(r.total)));
        })));
      });
      box.replaceChildren(...kids);
      pg.body.replaceChildren(box);
    };
    pg.render();
  }

  // ------------------------------------------------------------ Zeitraum und Filter
  function rangeBounds() {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    switch (S.settings.range) {
      case 'week': { const d = new Date(y, m, now.getDate() - ((now.getDay() + 6) % 7)); return [d.getTime(), null]; }
      case 'month': return [new Date(y, m, 1).getTime(), null];
      case 'lastmonth': return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
      case '3m': return [new Date(y, m - 2, 1).getTime(), null];
      case 'year': return [new Date(y, 0, 1).getTime(), null];
      case 'custom': return [S.settings.from, S.settings.to != null ? S.settings.to + DAY : null];
      default: return [null, null];
    }
  }
  function rangeLabel() {
    if (S.settings.range === 'custom') return (S.settings.from ? fmtDate(S.settings.from) : '…') + ' – ' + (S.settings.to ? fmtDate(S.settings.to) : '…');
    return (RANGES.find(r => r[0] === S.settings.range) || RANGES[1])[1];
  }
  function inRange() {
    const [from, to] = rangeBounds();
    return live().filter(r => {
      const t = rDate(r);
      return (from == null || t >= from) && (to == null || t < to) && (!S.settings.store || r.store === S.settings.store);
    });
  }
  const flat = rs => rs.flatMap(r => r.items.map(it => ({ it, r })));

  async function pickRange(anchor) {
    const a = await popMenu(anchor, RANGES.map(([k, l]) => ({ label: l, value: k, checked: S.settings.range === k })), 'Zeitraum');
    if (!a) return;
    if (a === 'custom') { openCustomRange(); return; }
    S.settings.range = a; saveSettings(); refreshAll();
  }
  function openCustomRange() {
    const d = { from: S.settings.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(), to: S.settings.to || Date.now() };
    const sheet = openSheet({ title: 'Zeitraum' });
    sheet.setRight(okButton(() => {
      S.settings.range = 'custom'; S.settings.from = d.from; S.settings.to = d.to;
      if (d.from && d.to && d.from > d.to) [S.settings.from, S.settings.to] = [d.to, d.from];
      saveSettings(); sheet.close(); refreshAll();
    }, 'range-ok'));
    sheet.body.append(group(
      line('Von', h('input', { type: 'date', value: toDateInput(d.from), 'data-field': 'from', onchange: e => { d.from = fromDateInput(e.target.value); if (d.from) d.from = new Date(new Date(d.from).setHours(0, 0, 0, 0)).getTime(); } })),
      line('Bis', h('input', { type: 'date', value: toDateInput(d.to), 'data-field': 'to', onchange: e => { d.to = fromDateInput(e.target.value); if (d.to) d.to = new Date(new Date(d.to).setHours(0, 0, 0, 0)).getTime(); } }))
    ));
  }
  async function pickStoreFilter(anchor) {
    const stores = [...new Set(live().map(r => r.store).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
    const a = await popMenu(anchor, [{ label: 'Alle Märkte', value: '__all', checked: !S.settings.store }, ...stores.map(s => ({ label: s, value: s, checked: S.settings.store === s }))], 'Markt');
    if (a === undefined) return;
    S.settings.store = a === '__all' ? null : a;
    saveSettings(); refreshAll();
  }

  // ------------------------------------------------------------ Auswertung
  function stackBar(parts, total) {
    return h('div', { class: 'stack-bar' }, parts.filter(p => p.v > 0).map(p => h('i', { style: 'flex:' + p.v + ';background:' + p.color, title: p.name })));
  }
  function legendRow(p, total, onTap) {
    return h('button', { class: 'line legend', onclick: onTap },
      h('span', { class: 'diet-dot', style: 'background:' + p.color }),
      h('span', { class: 'line-label' }, p.name),
      h('span', { class: 'line-value num' }, fmtEur(p.v) + '  ', h('b', null, total ? fmtPct(p.v / total) : '0 %')), icon('chev'));
  }

  function openStats(pg) {
    pg.setTitle('Auswertung');
    pg.setRight(h('button', { class: 'icon-btn', 'aria-label': 'Tabelle exportieren', 'data-act': 'export', onclick: () => exportCsv(inRange(), true) }, icon('share')));
    pg.render = () => {
      const rs = inRange();
      const all = flat(rs);
      const food = all.filter(x => isFood(x.it) && x.it.price > 0);
      const total = itemSum(all.map(x => x.it));
      const foodTotal = itemSum(food.map(x => x.it));
      const kids = [];
      kids.push(group(
        lineBtn('Zeitraum', rangeLabel(), e => pickRange(e.currentTarget), { 'data-act': 'range' }),
        lineBtn('Markt', S.settings.store || 'Alle', e => pickStoreFilter(e.currentTarget), { 'data-act': 'store-filter' })
      ));
      if (!rs.length) {
        kids.push(h('div', { class: 'empty small' }, live().length ? 'Keine Bons in diesem Zeitraum.' : 'Noch keine Bons.'));
        pg.body.replaceChildren(...kids);
        return;
      }
      // Summe
      kids.push(h('div', { class: 'card hero' },
        h('div', { class: 'hero-num num' }, fmtEur(total)),
        h('div', { class: 'hero-sub' }, rs.length + (rs.length === 1 ? ' Bon' : ' Bons') + ' · ' + all.length + ' Artikel · Ø ' + fmtEur(total / rs.length) + ' pro Bon')));

      // Verlauf
      const bars = buckets(rs);
      if (bars.length > 1) {
        const max = Math.max(...bars.map(b => b.v), 0.01);
        kids.push(sectionLabel('Verlauf'));
        kids.push(h('div', { class: 'card' }, h('div', { class: 'bars' }, bars.map(b => h('div', { class: 'bar-col', title: fmtEur(b.v) },
          h('span', { class: 'bar-val num' }, b.v ? Math.round(b.v) + ' €' : ''),
          h('i', { style: 'height:' + Math.max(b.v ? 3 : 0, b.v / max * 100) + '%' }),
          h('span', { class: 'bar-lbl' }, b.label))))));
      }

      if (food.length) {
        // Ernährung
        const diet = D.DIETS.map(x => ({ k: x.k, name: x.name, color: x.color, v: round2(food.filter(f => (f.it.diet || null) === x.k).reduce((s, f) => s + f.it.price, 0)) }));
        kids.push(sectionLabel('Ernährung'));
        kids.push(h('div', { class: 'group' }, h('div', { class: 'bar-wrap' }, stackBar(diet, foodTotal)),
          diet.filter(p => p.v > 0).map(p => legendRow(p, foodTotal, () => openArticles({ diet: p.k == null ? '__null' : p.k })))));
        // Convenience
        const conv = round2(food.filter(f => f.it.conv).reduce((s, f) => s + f.it.price, 0));
        kids.push(sectionLabel('Convenience'));
        kids.push(h('div', { class: 'group' },
          h('div', { class: 'bar-wrap' }, h('div', { class: 'meter big' }, h('i', { style: 'width:' + (foodTotal ? conv / foodTotal * 100 : 0) + '%' }))),
          h('button', { class: 'line legend', 'data-act': 'conv', onclick: () => openArticles({ conv: 'yes' }) },
            h('span', { class: 'line-label' }, 'Convenience'),
            h('span', { class: 'line-value num' }, fmtEur(conv) + '  ', h('b', null, foodTotal ? fmtPct(conv / foodTotal) : '0 %')), icon('chev'))));
        // Gesund
        const hl = D.HEALTH.map(x => ({ k: x.k, name: x.name, color: x.color, v: round2(food.filter(f => (f.it.health || null) === x.k).reduce((s, f) => s + f.it.price, 0)) }));
        kids.push(sectionLabel('Gesund'));
        kids.push(h('div', { class: 'group' }, h('div', { class: 'bar-wrap' }, stackBar(hl, foodTotal)),
          hl.filter(p => p.v > 0).map(p => legendRow(p, foodTotal, () => openArticles({ health: p.k == null ? '__null' : p.k })))));
        kids.push(note('Anteile beziehen sich auf Lebensmittel (' + fmtEur(foodTotal) + '), ohne Drogerie, Haushalt und Pfand.'));
      }

      // Kategorien
      const cats = D.CATS.map(c => ({ c, v: round2(all.filter(x => x.it.cat === c.k).reduce((s, x) => s + (x.it.price || 0), 0)), n: all.filter(x => x.it.cat === c.k).length }))
        .filter(x => x.n).sort((a, b) => b.v - a.v);
      const cmax = Math.max(...cats.map(x => Math.abs(x.v)), 0.01);
      kids.push(sectionLabel('Kategorien'));
      kids.push(h('div', { class: 'group' }, cats.map(x => h('button', { class: 'line cat-row', 'data-cat': x.c.k, onclick: () => openArticles({ cat: x.c.k }) },
        h('span', { class: 'cat-main' }, h('span', { class: 'cat-name' }, x.c.name), h('span', { class: 'cat-bar' }, h('i', { style: 'width:' + Math.max(0, x.v) / cmax * 100 + '%' }))),
        h('span', { class: 'line-value num' }, fmtEur(x.v)), icon('chev')))));

      // häufigste Produkte
      const top = aggregate(all).sort((a, b) => b.n - a.n || b.v - a.v).slice(0, 8);
      if (top.length) {
        kids.push(sectionLabel('Häufig gekauft'));
        kids.push(h('div', { class: 'group' }, top.map(t => h('button', { class: 'line', onclick: () => openArticles({ key: t.key, keyName: t.name }) },
          h('span', { class: 'line-label two' }, h('b', null, t.name), h('small', null, t.n + ' × · ' + catOf(t.cat).name)),
          h('span', { class: 'line-value num' }, fmtEur(t.v)), icon('chev')))));
      }
      kids.push(group(lineBtn('Alle Artikel', String(all.length), () => openArticles({}), { 'data-act': 'all-items' })));
      pg.body.replaceChildren(...kids);
    };
    pg.render();
  }

  function buckets(rs) {
    const [from] = rangeBounds();
    const times = rs.map(rDate);
    const start = from != null ? from : Math.min(...times), end = Date.now();
    const weekly = end - start <= 70 * DAY;
    const keyFn = t => {
      const d = new Date(t);
      if (!weekly) return d.getFullYear() * 12 + d.getMonth();
      const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      return mon.getTime();
    };
    const map = new Map();
    // leere Abschnitte mit anzeigen
    if (weekly) { for (let t = keyFn(start); t <= end; t += 7 * DAY) map.set(keyFn(t), 0); }
    else { const a = keyFn(start), b = keyFn(end); for (let k = a; k <= b; k++) map.set(k, 0); }
    rs.forEach(r => { const k = keyFn(rDate(r)); map.set(k, (map.get(k) || 0) + (r.total || itemSum(r.items))); });
    const out = [...map.entries()].sort((a, b) => a[0] - b[0]).slice(-12).map(([k, v]) => {
      let label;
      if (weekly) { const d = new Date(k); label = d.getDate() + '.' + (d.getMonth() + 1) + '.'; }
      else label = new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(new Date(Math.floor(k / 12), k % 12, 1)).replace('.', '');
      return { label, v: round2(v) };
    });
    return out;
  }

  function aggregate(all) {
    const map = new Map();
    all.forEach(({ it, r }) => {
      const k = keyOf(it);
      if (!k || it.cat === 'pfand') return;
      const a = map.get(k) || { key: k, name: it.name, cat: it.cat, n: 0, v: 0, last: 0 };
      a.n += it.qty || 1; a.v = round2(a.v + (it.price || 0));
      if (rDate(r) >= a.last) { a.last = rDate(r); a.name = it.name; a.cat = it.cat; }
      map.set(k, a);
    });
    return [...map.values()];
  }

  // ------------------------------------------------------------ Artikeltabelle mit Filtern
  function openArticles(init) {
    const f = Object.assign({ cat: null, diet: undefined, conv: null, health: undefined, q: '', key: null, keyName: null, grouped: false }, init || {});
    const sheet = openSheet({ title: 'Artikel' });
    const list = h('div', { class: 'group' });
    holdable(list, async (id, el) => {
      const hit = flat(inRange()).find(x => x.it.id === id);
      if (!hit) return;
      const a = await popMenu(el, [
        { label: 'Artikel bearbeiten', value: 'item', icon: 'pencil' },
        { label: 'Bon öffnen', value: 'bon', icon: 'tabBons' }
      ], hit.it.name);
      if (a === 'item') edit(hit);
      else if (a === 'bon') openReceipt(hit.r);
    });
    const edit = ({ it, r }) => openItem(it, {
      onSave: async (next, classChanged) => {
        Object.assign(it, next);
        delete it.check; delete it.guessed;
        r.open = openChecks(r).length + (r.total == null && r.items.length ? 1 : 0);
        await DB.put('receipts', r);
        let n = 0;
        if (classChanged) n = await learn(it);
        refreshAll();
        toast(n ? 'Gemerkt · ' + n + ' weitere Artikel angepasst' : 'Gespeichert');
      }
    });
    const optName = (list, v) => v === undefined ? 'Alle' : (list.find(x => (x.k == null ? '__null' : x.k) === v) || {}).name || 'Alle';
    const choose = async (e, key, list, title) => {
      const a = await popMenu(e.currentTarget, [{ label: 'Alle', value: '__all', checked: f[key] === undefined || f[key] === null },
        ...list.map(x => ({ label: x.name, value: x.k == null ? '__null' : x.k, checked: f[key] === (x.k == null ? '__null' : x.k) }))], title);
      if (a === undefined) return;
      f[key] = a === '__all' ? (key === 'cat' ? null : undefined) : a;
      sheet.render();
    };
    const search = h('input', { type: 'search', 'data-field': 'search', placeholder: 'Suchen', autocomplete: 'off', enterkeyhint: 'search', oninput: e => { f.q = e.target.value; renderList(); } });
    const summary = h('div', { class: 'section-label' });
    const seg = h('div', { class: 'segc' });

    function filtered() {
      const q = P.norm(f.q);
      return flat(inRange()).filter(({ it }) =>
        (!f.cat || it.cat === f.cat) &&
        (f.diet === undefined || (isFood(it) && (it.diet || null) === (f.diet === '__null' ? null : f.diet))) &&
        (f.health === undefined || (isFood(it) && (it.health || null) === (f.health === '__null' ? null : f.health))) &&
        (!f.conv || (f.conv === 'yes' ? it.conv : !it.conv && isFood(it))) &&
        (!f.key || keyOf(it) === f.key) &&
        (!q || P.norm(it.name + ' ' + (it.raw || '')).includes(q)))
        .sort((a, b) => rDate(b.r) - rDate(a.r));
    }
    function renderList() {
      const rows = filtered();
      summary.textContent = rows.length + ' Artikel · ' + fmtEur(itemSum(rows.map(x => x.it)));
      seg.replaceChildren(...[['Einzeln', false], ['Zusammengefasst', true]].map(([l, v]) => h('button', { class: f.grouped === v ? 'on' : null, onclick: () => { f.grouped = v; renderList(); } }, l)));
      if (!rows.length) { list.replaceChildren(h('div', { class: 'line muted-line' }, 'Keine Artikel')); return; }
      if (f.grouped) {
        list.replaceChildren(...aggregate(rows).sort((a, b) => b.v - a.v).map(t => h('button', { class: 'line', onclick: () => { f.key = t.key; f.keyName = t.name; f.grouped = false; sheet.render(); } },
          h('span', { class: 'line-label two' }, h('b', null, t.name), h('small', null, t.n + ' × · ' + catOf(t.cat).name)),
          h('span', { class: 'line-value num' }, fmtEur(t.v)), icon('chev'))));
      } else {
        list.replaceChildren(...rows.slice(0, 400).map(x => itemRow(x.it, () => edit(x), fmtDate(rDate(x.r)) + ' · ' + (x.r.store || 'Bon') + ' · ' + catOf(x.it.cat).name)));
      }
    }
    sheet.render = () => {
      sheet.setTitle(f.keyName || 'Artikel');
      sheet.setRight(h('button', { class: 'icon-btn', 'aria-label': 'Exportieren', 'data-act': 'export-filtered', onclick: () => exportCsv(null, false, filtered()) }, icon('share')));
      search.value = f.q;
      sheet.body.replaceChildren(
        group(
          lineBtn('Zeitraum', rangeLabel(), e => pickRange(e.currentTarget)),
          f.key ? h('button', { class: 'line', onclick: () => { f.key = null; f.keyName = null; sheet.render(); } }, h('span', { class: 'line-label' }, 'Produkt'), h('span', { class: 'line-value' }, f.keyName + '  ✕')) : null,
          lineBtn('Kategorie', f.cat ? catOf(f.cat).name : 'Alle', e => choose(e, 'cat', D.CATS, 'Kategorie'), { 'data-act': 'f-cat' }),
          lineBtn('Ernährung', optName(D.DIETS, f.diet), e => choose(e, 'diet', D.DIETS, 'Ernährung'), { 'data-act': 'f-diet' }),
          lineBtn('Gesund', optName(D.HEALTH, f.health), e => choose(e, 'health', D.HEALTH, 'Gesund'), { 'data-act': 'f-health' }),
          lineBtn('Convenience', f.conv === 'yes' ? 'Nur Convenience' : f.conv === 'no' ? 'Ohne Convenience' : 'Alle', async e => {
            const a = await popMenu(e.currentTarget, [{ label: 'Alle', value: '__all', checked: !f.conv }, { label: 'Nur Convenience', value: 'yes', checked: f.conv === 'yes' }, { label: 'Ohne Convenience', value: 'no', checked: f.conv === 'no' }], 'Convenience');
            if (a === undefined) return;
            f.conv = a === '__all' ? null : a; sheet.render();
          }, { 'data-act': 'f-conv' }),
          h('label', { class: 'line' }, search)
        ),
        seg, summary, list);
      renderList();
    };
    sheet.render();
  }

  // ------------------------------------------------------------ Export und Backup
  function shareFile(file) {
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch(e => { if (e && e.name !== 'AbortError') downloadFile(file); });
        return;
      }
    } catch (e) {}
    downloadFile(file);
  }
  function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: file.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  // Teilen muss direkt im Antippen starten, sonst lehnt Safari es ab
  const offerFile = (msg, file) => alertBox({ title: msg, message: file.name, buttons: [
    { label: 'Schließen', value: null, act: 'alert-cancel' },
    { label: 'Teilen', value: true, kind: 'bold', act: 'alert-ok', onTap: () => shareFile(file) }] });

  // CSV mit Semikolon und Dezimalkomma, öffnet sich direkt in Excel und Numbers
  function exportCsv(rs, ranged, rows) {
    rows = rows || flat(rs || live());
    if (!rows.length) { toast('Keine Artikel zum Exportieren'); return; }
    const esc = v => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ['Datum', 'Markt', 'Artikel', 'Text auf dem Bon', 'Menge', 'Gewicht kg', 'Preis', 'Kategorie', 'Ernährung', 'Convenience', 'Gesund', 'Lebensmittel'];
    const lines = [head.join(';')].concat(rows.slice().sort((a, b) => rDate(a.r) - rDate(b.r)).map(({ it, r }) => [
      toDateInput(rDate(r)), r.store || '', it.name, it.raw || '', it.qty || 1, it.kg ? String(it.kg).replace('.', ',') : '', fmtNum(it.price),
      catOf(it.cat).name, isFood(it) ? dietName(it.diet) : '', isFood(it) ? (it.conv ? 'ja' : 'nein') : '', isFood(it) ? healthName(it.health) : '', isFood(it) ? 'ja' : 'nein'
    ].map(esc).join(';')));
    const name = 'bon_scan_' + (ranged ? rangeLabel().toLowerCase().replace(/[^a-z0-9äöü]+/g, '-').replace(/^-|-$/g, '') + '_' : '') + toDateInput(Date.now()) + '.csv';
    offerFile('Tabelle bereit', new File(['﻿' + lines.join('\r\n')], name, { type: 'text/csv' }));
  }

  async function makeBackup() {
    const media = [];
    for (const r of S.receipts) for (const id of (r.photoIds || []).concat((r.scans || []).map(x => x.id))) {
      const m = await DB.get('media', id);
      if (m) media.push({ id, type: m.type, data: btoa(new Uint8Array(m.buf).reduce((s, b) => s + String.fromCharCode(b), '')) });
    }
    const data = { app: 'bon_scan', version: 1, created: Date.now(), receipts: S.receipts, learned: Object.values(S.learned), media };
    offerFile('Backup bereit', new File([JSON.stringify(data)], 'bon_scan_backup_' + toDateInput(Date.now()) + '.json', { type: 'application/json' }));
  }
  async function restoreBackup() {
    const f = await pickFile('application/json,.json', false);
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); if (data.app !== 'bon_scan') throw new Error(); } catch (e) { toast('Keine gültige Backup-Datei'); return; }
    const ok = await alertBox({ title: 'Backup einspielen?', message: (data.receipts || []).length + ' Bons. Vorhandene Bons bleiben erhalten, gleiche werden ersetzt.', buttons: [
      { label: 'Abbrechen', value: false, act: 'alert-cancel' }, { label: 'Einspielen', value: true, kind: 'bold', act: 'alert-ok' }] });
    if (!ok) return;
    for (const m of data.media || []) {
      const bin = atob(m.data), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      await DB.put('media', { id: m.id, type: m.type, buf: buf.buffer });
    }
    for (const r of data.receipts || []) {
      await DB.put('receipts', r);
      const i = S.receipts.findIndex(x => x.id === r.id);
      if (i >= 0) S.receipts[i] = r; else S.receipts.push(r);
    }
    for (const l of data.learned || []) { S.learned[l.key] = l; await DB.put('learned', l); }
    refreshAll();
    toast('Backup eingespielt');
  }

  // ------------------------------------------------------------ Einstellungen
  function loadSettings() {
    try { Object.assign(S.settings, JSON.parse(localStorage.getItem('bonscan.settings') || '{}')); } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem('bonscan.settings', JSON.stringify(S.settings)); } catch (e) {}
  }
  function applySettings() {
    const th = THEMES[S.settings.theme] ? S.settings.theme : 'hell';
    document.documentElement.dataset.theme = th;
    document.documentElement.style.colorScheme = th === 'dunkel' ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEMES[th].bar);
  }

  function ocrStatus() {
    const st = OCR.state;
    if (st.status === 'ready') return 'Bereit';
    if (st.status === 'loading') return 'Wird geladen … ' + Math.round((st.progress || 0) * 100) + ' %';
    if (st.status === 'error') return 'Nicht geladen';
    return 'Noch nicht geladen';
  }

  function openSettings(pg) {
    pg.setTitle('Einstellungen');
    const off = OCR.onState(() => { if (page === pg && pg.render) pg.render(); });
    pg.leave = off;
    pg.render = () => {
      const trashN = S.receipts.filter(r => r.deletedAt).length;
      const learnedN = Object.keys(S.learned).length;
      pg.body.replaceChildren(...[
        sectionLabel('Darstellung'),
        group(lineBtn('Thema', THEMES[S.settings.theme] ? THEMES[S.settings.theme].name : 'Hell', async e => {
          const a = await popMenu(e.currentTarget, Object.keys(THEMES).map(k => ({ label: THEMES[k].name, value: k, checked: S.settings.theme === k })), 'Thema');
          if (!a) return;
          S.settings.theme = a; saveSettings(); applySettings(); pg.render();
        }, { 'data-act': 'theme' })),
        sectionLabel('Scannen'),
        group(
          lineBtn('Texterkennung', ocrStatus(), () => { if (OCR.state.status !== 'ready') OCR.warmup(); }, { 'data-act': 'ocr' }),
          lineSwitch('Fotos der Bons behalten', S.settings.keepPhotos, v => { S.settings.keepPhotos = v; saveSettings(); }, 'keep-photos')
        ),
        OCR.state.status === 'error' ? note('Die Texterkennung wird einmalig aus dem Internet geladen und danach auf dem Gerät gespeichert.') : null,
        sectionLabel('Daten'),
        group(
          lineBtn('Gelernte Zuordnungen', learnedN ? String(learnedN) : null, openLearned, { 'data-act': 'learned' }),
          lineBtn('Zuordnungen exportieren', null, exportLearned, { 'data-act': 'learned-export' }),
          lineBtn('Tabelle exportieren', null, () => exportCsv(null, false), { 'data-act': 'csv-all' }),
          lineBtn('Backup erstellen', null, makeBackup, { 'data-act': 'backup' }),
          lineBtn('Backup einspielen', null, restoreBackup, { 'data-act': 'restore' }),
          lineBtn('Papierkorb', trashN ? String(trashN) : null, openTrash, { 'data-act': 'trash' })
        ),
        sectionLabel('Speicher'),
        group(line('Speicher auf dem iPhone', h('span', { class: 'line-value', 'data-field': 'persist' }, storageInfo.persisted == null ? '…' : storageInfo.persisted ? 'Dauerhaft' : 'Nicht dauerhaft')),
          storageInfo.usage != null ? line('Belegt', h('span', { class: 'line-value num' }, (storageInfo.usage / 1048576).toFixed(1).replace('.', ',') + ' MB')) : null),
        storageInfo.persisted === false ? note('iOS kann die Daten löschen, wenn die App lange nicht benutzt wird oder der Speicher knapp ist. Regelmäßig ein Backup erstellen.') : null,
        sectionLabel('Info'),
        group(
          lineBtn('Changelog', null, openChangelog, { 'data-act': 'changelog' }),
          line('Version', h('span', { class: 'line-value' }, 'Alpha ' + VERSION))
        )
      ].filter(Boolean));
    };
    pg.render();
  }

  function openLearned() {
    const sheet = openSheet({ title: 'Gelernte Zuordnungen' });
    const del = async key => {
      const rec = S.learned[key];
      if (!rec || !(await confirmDelete(rec.ignore ? '„' + rec.name + '“ wieder als Artikel erkennen?' : 'Zuordnung für „' + rec.name + '“ vergessen?', rec.ignore ? 'Ja' : 'Vergessen'))) return;
      delete S.learned[key];
      await DB.del('learned', key);
      sheet.render();
    };
    const onHold = async (key, el) => {
      const rec = S.learned[key] || {};
      const a = await popMenu(el, [rec.ignore ? null : { label: 'Bearbeiten', value: 'edit', icon: 'pencil' }, { label: rec.ignore ? 'Wieder erkennen' : 'Vergessen', value: 'delete', icon: rec.ignore ? 'undo' : 'trash', danger: !rec.ignore }], rec.name);
      if (a === 'edit') edit(key); else if (a === 'delete') del(key);
    };
    const edit = key => {
      const rec = S.learned[key];
      if (rec.ignore) { del(key); return; }
      const it = { raw: key, name: rec.name, price: null, qty: 1, cat: rec.cat, diet: rec.diet, conv: rec.conv, health: rec.health };
      openItem(it, { onSave: async next => { Object.assign(it, next); const n = await learn(it); sheet.render(); refreshAll(); toast(n ? n + ' Artikel angepasst' : 'Gespeichert'); }, onDelete: () => { delete S.learned[key]; DB.del('learned', key); sheet.render(); } });
    };
    sheet.setRight(h('button', { class: 'icon-btn', 'aria-label': 'Exportieren oder importieren', 'data-act': 'learned-io', onclick: async e => {
      const a = await popMenu(e.currentTarget, [
        { label: 'Exportieren', value: 'export', icon: 'share' },
        { label: 'Importieren', value: 'import', icon: 'undo' }
      ], 'Zuordnungen');
      if (a === 'export') exportLearned();
      else if (a === 'import') { await importLearned(); sheet.render(); }
    } }, icon('share')));
    sheet.render = () => {
      const all = Object.values(S.learned);
      if (!all.length) { sheet.body.replaceChildren(h('div', { class: 'empty' }, 'Noch nichts gelernt.')); return; }
      const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'de');
      const row = r => h('button', { class: 'line', 'data-drag': r.key, onclick: () => edit(r.key) },
        h('span', { class: 'line-label two' }, h('b', null, r.name || r.key), h('small', null, r.ignore ? 'Wird übersprungen' : [catOf(r.cat).food !== false && r.diet ? dietName(r.diet) : null, r.conv ? 'Convenience' : null, r.health && catOf(r.cat).food !== false ? healthName(r.health) : null].filter(Boolean).join(' · ') || catOf(r.cat).name)), icon('chev'));
      const kids = [];
      // nach Kategorien gruppiert, in der Reihenfolge der Kategorien; „Kein Artikel“ am Ende
      for (const c of D.CATS) {
        const list = all.filter(r => !r.ignore && (r.cat || 'unbekannt') === c.k).sort(byName);
        if (!list.length) continue;
        kids.push(h('div', { class: 'section-label month-label' }, h('span', null, c.name), h('span', { class: 'num' }, String(list.length))));
        const g = h('div', { class: 'group' }, list.map(row));
        holdable(g, onHold);
        kids.push(g);
      }
      const ign = all.filter(r => r.ignore).sort(byName);
      if (ign.length) {
        kids.push(h('div', { class: 'section-label month-label' }, h('span', null, 'Kein Artikel'), h('span', { class: 'num' }, String(ign.length))));
        const g = h('div', { class: 'group' }, ign.map(row));
        holdable(g, onHold);
        kids.push(g);
        kids.push(note('Diese Zeilen werden beim Scannen übersprungen. Antippen, um das rückgängig zu machen.'));
      }
      sheet.body.replaceChildren(...kids);
    };
    sheet.render();
  }

  function exportLearned() {
    const list = Object.values(S.learned);
    if (!list.length) { toast('Noch nichts gelernt'); return; }
    const data = { app: 'bon_scan', type: 'zuordnungen', version: 1, created: Date.now(), learned: list };
    offerFile('Zuordnungen bereit', new File([JSON.stringify(data, null, 1)], 'bon_scan_zuordnungen_' + toDateInput(Date.now()) + '.json', { type: 'application/json' }));
  }
  // Import führt zusammen: bei gleichem Eintrag gewinnt der neuere
  async function importLearned() {
    const f = await pickFile('application/json,.json', false);
    if (!f) return;
    let list;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'bon_scan') throw new Error();
      list = data.learned || [];
    } catch (e) { toast('Keine gültige Datei'); return; }
    let n = 0;
    for (const l of list) {
      if (!l || !l.key) continue;
      const cur = S.learned[l.key];
      if (cur && (cur.at || 0) >= (l.at || 0)) continue;
      S.learned[l.key] = l; n++;
      try { await DB.put('learned', l); } catch (e) {}
    }
    refreshAll();
    toast(n ? n + ' Zuordnungen übernommen' : 'Nichts Neues');
  }

  function openChangelog() {
    const sheet = openSheet({ title: 'Changelog' });
    const open = new Set([(window.CHANGELOG[0] || {}).v]);
    const grp = (label, list) => list && list.length ? [h('div', { class: 'cl-group' }, label), h('ul', { class: 'cl-list' }, list.map(x => h('li', null, x)))] : null;
    sheet.render = () => {
      sheet.body.replaceChildren(...window.CHANGELOG.map(e => h('div', { class: 'cl-entry' + (open.has(e.v) ? ' open' : '') },
        h('button', { class: 'cl-head', onclick: () => { open.has(e.v) ? open.delete(e.v) : open.add(e.v); sheet.render(); } },
          h('span', { class: 'cl-version' }, 'Alpha ' + e.v), h('span', { class: 'cl-date' }, fmtDate(new Date(e.date).getTime())), h('span', { class: 'cl-title' }, e.title)),
        open.has(e.v) ? h('div', { class: 'cl-body' }, grp('Neu', e.added), grp('Geändert', e.changed), grp('Entfernt', e.removed)) : null)));
    };
    sheet.render();
  }

  // dauerhaften Speicher anfordern: Daten werden dann nicht automatisch von iOS geräumt
  const storageInfo = { persisted: null, usage: null };
  async function checkStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) storageInfo.persisted = await navigator.storage.persisted() || await navigator.storage.persist();
      if (navigator.storage && navigator.storage.estimate) storageInfo.usage = (await navigator.storage.estimate()).usage;
    } catch (e) {}
    if (page && page.name === 'settings' && page.render) page.render();
  }

  // ------------------------------------------------------------ Start
  async function init() {
    loadSettings();
    applySettings();
    showTab('scan');
    try {
      await DB.open();
      S.receipts = await DB.all('receipts');
      (await DB.all('learned')).forEach(l => { S.learned[l.key] = l; });
    } catch (e) { toast('Speicher nicht verfügbar'); }
    // Papierkorb: was länger als 30 Tage liegt, endgültig entfernen
    for (const r of S.receipts.filter(x => x.deletedAt && Date.now() - x.deletedAt > TRASH_DAYS * DAY)) { try { await purgeReceipt(r); } catch (e) {} }
    refreshAll();
    await checkStorage();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    // Texterkennung im Hintergrund vorbereiten, damit der erste Scan schnell geht
    setTimeout(() => OCR.warmup(), 1200);
  }
  window.BonApp = { S, showTab, openReceipt, startReceipt, parseText: t => P.parse(t, { learned: S.learned }) };
  init();
})();
