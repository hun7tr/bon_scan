'use strict';
/* Bon_Scan – liest den erkannten Text eines Kassenbons aus: Markt, Datum, Summe, Artikel mit Preis, Menge, Gewicht.
   Danach ordnet categorize() jedem Artikel Kategorie, Ernährung, Convenience und Gesund zu:
   zuerst aus dem Gelernten (Korrekturen des Nutzers), sonst aus dem Wörterbuch in data.js. */
(function (root) {
  const D = root.BON_DATA;
  const norm = D.norm;

  // ------------------------------------------------------------ Hilfen
  const round2 = n => Math.round(n * 100) / 100;
  const toNum = s => parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));

  // typische Lesefehler in Zahlen: O statt 0, l/I statt 1, S statt 5, Leerzeichen um das Komma
  function fixNumbers(line) {
    return line
      .replace(/(\d)\s+,\s*(\d{2})\b/g, '$1,$2').replace(/(\d),\s+(\d{2})\b/g, '$1,$2')
      .replace(/(\d)\.(\d{2})(\s*(?:[A-Z]{1,2}\d?|\d|\*)?\s*)$/, '$1,$2$3')
      .replace(/(^|[\s\-−])([\dOoIlS]{1,4}),([\dOoIlS]{2})(?=\s|$|-)/g, (m, p, a, b) => {
        if (!/\d/.test(a + b)) return m;
        const f = x => x.replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5');
        return p + f(a) + ',' + f(b);
      });
  }

  // Betrag am Zeilenende: „BANANE 1,29 A“, „PFAND -0,25 B“, „RABATT 0,50-“, „SUMME EUR 12,34“
  const END_PRICE = /^(.*?)[\s:]*(-|−)?\s*(\d{1,4}),(\d{2})\s*(-)?\s*(?:€|EUR)?\s*(?:[A-Z]{1,2}\d?|\d|\*)?\s*\*?$/;
  // Menge: „2 x 0,89“, „2 Stk x 0,89 1,78“, „3 * 1,29“
  const QTY = /^(\d{1,3})\s*(?:STK|ST|STUCK|STÜCK|STCK)?\.?\s*[xX×*]\.?\s*(\d{1,4},\d{2})(?:\s*(?:EUR|€))?(?:\s+(-?\d{1,4},\d{2}))?/i;
  const QTY_INLINE = /(?:^|\s)(\d{1,3})\s*(?:STK|ST)?\.?\s*[xX×*]\.?\s*(\d{1,4},\d{2})(?=\s|$)|^(\d{1,3})\s*[xX×*]\s+(?=[A-Za-zÄÖÜäöü])/i;
  // Gewicht: „0,512 kg x 2,99 EUR/kg“, „1,234 kg * 1,99 €/kg“
  const WEIGHT = /(\d{1,3}[,.]\d{1,3})\s*KG\s*[xX×*@]?\s*(\d{1,4},\d{2})\s*(?:EUR|€)?\s*\/\s*KG(?:\s+(-?\d{1,4},\d{2}))?/i;
  const HAND = /HANDEINGABE|HAND EINGABE|WAAGE|WAEGEN/i;

  const TOTAL_WORDS = /\b(SUMME|GESAMTSUMME|GESAMT|ZU ZAHLEN|ZUZAHLEN|ENDBETRAG|TOTAL|GESAMTBETRAG|SUM)\b/;
  const SKIP_WORDS = /\b(MWST|MW ST|MWS|UST|STEUER|STEUERNR|NETTO|BRUTTO|BAR|GEGEBEN|GEG|RUCKGELD|ZURUCK|KARTE|KARTENZAHLUNG|EC|GIROCARD|GIRO|VISA|MASTERCARD|MAESTRO|VPAY|V PAY|AMEX|KONTAKTLOS|PAYBACK|DEUTSCHLANDCARD|PUNKTE|BONUS|TSE|TERMINAL|TRANSAKTION|KASSE|KASSIERER|BON NR|BONNR|BELEG|BELEGNR|ZWISCHENSUMME|POSTEN|ANZAHL|ARTIKELANZAHL|DATUM|UHRZEIT|ZAHLUNG|BEZAHLT|ENTGELT|TRINKGELD|AUTORISIERUNG|GENEHMIGUNG|KUNDENBELEG|HANDLERBELEG|SIGNATUR|SERIENNUMMER|VIELEN DANK|WWW|HTTP|TEL|FAX|OFFNUNGSZEITEN|USTID|UST ID|STEUERNUMMER)\b/;
  const DISCOUNT_WORDS = /\b(RABATT|PREISVORTEIL|VORTEIL|NACHLASS|COUPON|GUTSCHEIN|AKTION|ERMASSIGUNG|PREISREDUZ|REDUZIERT|SOFORTRABATT|MENGENRABATT|SPARPREIS|SIE SPAREN|LIDL PLUS|PREISABSCHRIFT)\b/;
  const TAX_TABLE = /^[A-D]\s*[=:]?\s*\d{1,2}[,.]\d{1,2}\s*%/;

  // Lesbarer Name: aus „BIO H-MILCH 1,5%“ wird „Bio H-Milch 1,5%“
  function prettyName(raw) {
    let s = raw.replace(/^\d{4,}\s+/, '').replace(/\s+\d{6,}$/, '').replace(/[|_~]+/g, ' ')
      .replace(/\s{2,}/g, ' ').replace(/^[\s.,:;\-*#]+|[\s.,:;\-*#]+$/g, '').trim();
    if (s && s === s.toUpperCase()) {
      s = s.toLowerCase().replace(/(^|[\s\-/(.])([a-zäöüß])/g, (m, a, b) => a + b.toUpperCase());
    }
    return s;
  }

  // Ziffern, die die Texterkennung oft verwechselt; liefert alle Beträge mit genau einer vertauschten Ziffer
  const CONFUSE = { 0: '869', 1: '74', 2: '7', 3: '8', 4: '1', 5: '68', 6: '508', 7: '12', 8: '03569', 9: '08' };
  function digitVariants(v) {
    const neg = v < 0, s = Math.abs(v).toFixed(2), out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (!CONFUSE[c]) continue;
      for (const r of CONFUSE[c]) out.push(round2((neg ? -1 : 1) * parseFloat(s.slice(0, i) + r + s.slice(i + 1))));
    }
    return out.sort((a, b) => Math.abs(a) - Math.abs(b));
  }

  // ------------------------------------------------------------ Markt und Datum
  function findStore(lines) {
    const scan = list => {
      for (const l of list) {
        const n = ' ' + norm(l) + ' ';
        for (const [k, name] of D.STORES) if (n.includes(' ' + k + ' ') || (k.length > 4 && n.includes(k))) return name;
      }
      return null;
    };
    const head = scan(lines.slice(0, 10));
    if (head) return head;
    const all = scan(lines);
    if (all) return all;
    const first = lines.slice(0, 5).find(l => (l.match(/[A-Za-zÄÖÜäöü]/g) || []).length >= 4 && !/\d{2,}/.test(l));
    return first ? prettyName(first).slice(0, 40) : null;
  }

  function findDate(lines, now) {
    now = now || Date.now();
    const re = /(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{4}|\d{2})(?!\d)/g;
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li];
      const fixed = l.replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0');
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(fixed))) {
        let d = +m[1], mo = +m[2], y = +m[3];
        if (y < 100) y += 2000;
        if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000) continue;
        const timeRe = /(\d{1,2})\s*:\s*(\d{2})/;
        const tm = fixed.slice(m.index + m[0].length).match(timeRe) || fixed.match(timeRe) || (lines[li + 1] || '').match(timeRe) || (lines[li - 1] || '').match(timeRe);
        const hh = tm && +tm[1] < 24 ? +tm[1] : 12, mm = tm && +tm[2] < 60 ? +tm[2] : 0;
        const ms = new Date(y, mo - 1, d, hh, mm).getTime();
        if (ms > now + 2 * 864e5 || ms < now - 5 * 365 * 864e5) continue;
        return ms;
      }
    }
    return null;
  }

  // ------------------------------------------------------------ Bon auslesen
  function parse(text, opts) {
    opts = opts || {};
    const lines = String(text || '').split(/\r?\n/).map(l => fixNumbers(l.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim())).filter(l => l.length > 1);
    const items = [];
    let total = null, totalAt = -1;

    // Summe: erste Zeile mit Summenwort und Betrag; danach kommen keine Artikel mehr
    for (let i = 0; i < lines.length; i++) {
      const n = norm(lines[i]);
      if (TOTAL_WORDS.test(n) && !/ZWISCHEN/.test(n)) {
        const m = lines[i].match(END_PRICE) || (lines[i + 1] || '').match(/^(?:EUR|€)?\s*()(-)?(\d{1,4}),(\d{2})/);
        if (m) { total = toNum(m[3] + ',' + m[4]); totalAt = i; break; }
      }
    }
    const end = totalAt >= 0 ? totalAt : lines.length;

    let pendingName = null, pendingQty = null;
    const last = () => items[items.length - 1];
    const push = (raw, price, extra) => {
      const it = Object.assign({ raw: raw.trim(), name: prettyName(raw), price: round2(price), qty: 1 }, extra || {});
      if (pendingQty && !extra) { it.qty = pendingQty.qty; it.unit = pendingQty.unit; pendingQty = null; }
      items.push(it);
      pendingName = null;
      return it;
    };

    for (let i = 0; i < end; i++) {
      const line = lines[i];
      const n = norm(line);
      if (!n || TAX_TABLE.test(line)) continue;

      // Gewichtszeile
      const w = line.match(WEIGHT);
      if (w) {
        const kg = toNum(w[1]), perKg = toNum(w[2]);
        const calc = round2(kg * perKg);
        const L = last();
        if (w[3] && pendingName) { push(pendingName, toNum(w[3]), { kg, perKg }); continue; }
        if (L && Math.abs(L.price - calc) < 0.03 && !L.kg) { L.kg = kg; L.perKg = perKg; continue; }
        const before = line.slice(0, w.index).trim();
        if (w[3] || before.replace(/[^A-Za-zÄÖÜäöü]/g, '').length >= 3) { push(before || pendingName || 'Artikel', w[3] ? toNum(w[3]) : calc, { kg, perKg }); continue; }
        pendingQty = null;
        if (pendingName) { push(pendingName, calc, { kg, perKg }); continue; }
        // Gewicht steht vor dem Artikel: der nächste Artikel bekommt es
        pendingQty = { kgOnly: true, kg, perKg };
        continue;
      }

      // reine Mengenzeile
      const q = line.match(QTY);
      if (q && line.replace(q[0], '').replace(/[^A-Za-zÄÖÜäöü]/g, '').length < 3) {
        const qty = +q[1], unit = toNum(q[2]);
        const tot = q[3] ? toNum(q[3]) : round2(qty * unit);
        const L = last();
        if (pendingName) { push(pendingName, tot, { qty, unit }); continue; }
        if (L && !L.qtySet && Math.abs(L.price - qty * unit) < 0.03) { L.qty = qty; L.unit = unit; L.qtySet = true; continue; }
        if (q[3] && L && !L.qtySet && (L.price === 0 || Math.abs(L.price - unit) < 0.03)) { L.price = tot; L.qty = qty; L.unit = unit; L.qtySet = true; continue; }
        pendingQty = { qty, unit };
        continue;
      }

      const m = line.match(END_PRICE);
      if (!m) {
        // Zeile ohne Betrag: möglicher Artikelname, wenn der Betrag in der nächsten Zeile steht
        const letters = (line.match(/[A-Za-zÄÖÜäöü]/g) || []).length;
        pendingName = letters >= 3 && !SKIP_WORDS.test(n) && !TOTAL_WORDS.test(n) && !/^\d{5}\s/.test(line) ? line : null;
        continue;
      }
      let name = m[1].trim();
      const neg = !!(m[2] || m[5]);
      let price = toNum(m[3] + ',' + m[4]) * (neg ? -1 : 1);
      const nn = norm(name);
      if (SKIP_WORDS.test(nn) || nn === 'EUR' || /^(EUR|€)$/.test(name)) { pendingName = null; continue; }
      if (HAND.test(name)) name = name.replace(HAND, '').trim();

      // Betrag ohne Namen: gehört zum Namen aus der Zeile davor
      if (name.replace(/[^A-Za-zÄÖÜäöü]/g, '').length < 2) {
        if (pendingName) push(pendingName, price);
        else if (last() && last().price === 0) last().price = round2(price);
        continue;
      }

      // Rabatt: mindert den Artikel davor
      if (DISCOUNT_WORDS.test(nn) && !/PFAND|LEERGUT/.test(nn)) {
        const L = last();
        let off = -Math.abs(price);
        // Rabatt größer als der Artikel: vermutlich falsch gelesene Ziffer („-8,30“ statt „-0,30“)
        if (L && -off >= L.price) {
          const alt = digitVariants(-off).find(v => v > 0 && v < L.price);
          if (alt != null) off = -alt;
        }
        if (L && -off < L.price) { L.price = round2(L.price + off); L.discount = round2((L.discount || 0) + off); }
        else push(name, off, { cat: 'unbekannt' });
        continue;
      }

      // Menge mitten in der Zeile: „BANANE 2 X 1,29 2,58“ oder „2 X BANANE 2,58“
      const qi = name.match(QTY_INLINE);
      let extra = null;
      if (qi) {
        const qty = +(qi[1] || qi[3]), unit = qi[2] ? toNum(qi[2]) : round2(Math.abs(price) / qty);
        if (qty > 1 && (!qi[2] || Math.abs(qty * unit - Math.abs(price)) < 0.03)) {
          name = (name.slice(0, qi.index) + ' ' + name.slice(qi.index + qi[0].length)).trim();
          extra = { qty, unit };
        }
      }
      if (/PFAND|LEERGUT/.test(nn) && /LEERGUT|RUCKGABE|RUECKGABE/.test(nn)) price = -Math.abs(price);
      const it = push(name, price, extra);
      if (!extra && pendingQty && pendingQty.kgOnly) { it.kg = pendingQty.kg; it.perKg = pendingQty.perKg; pendingQty = null; }
    }

    items.forEach(it => { delete it.qtySet; });
    let sum = round2(items.reduce((s, it) => s + it.price, 0));
    // Summe passt nicht: gibt es genau einen Preis, bei dem eine typische Verwechslung (8/0, 1/7 …) die Differenz erklärt?
    if (total != null && Math.abs(sum - total) >= 0.01) {
      const diff = round2(sum - total);
      const hits = items.filter(it => digitVariants(it.price).some(v => Math.abs(v - (it.price - diff)) < 0.005));
      if (hits.length === 1) { hits[0].price = round2(hits[0].price - diff); hits[0].fixed = true; sum = round2(total); }
    }
    const res = {
      store: findStore(lines),
      date: findDate(lines, opts.now),
      total: total != null ? total : (items.length ? sum : null),
      totalFound: total != null,
      sum,
      items: items.map(it => Object.assign(it, categorize(it.raw, opts.learned)))
    };
    return res;
  }

  // ------------------------------------------------------------ Zuordnung
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // Schlüssel fürs Gelernte: normalisierter Name ohne Mengen- und Gewichtsangaben
  const learnKey = raw => norm(String(raw || '').replace(/\d+[,.]?\d*\s*(%|G|KG|L|ML|STK|ST)\b/gi, ' ')).replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim();

  function findLearned(key, learned) {
    if (!learned || !key) return null;
    if (learned[key]) return learned[key];
    if (key.length < 5) return null;
    const max = Math.max(1, Math.floor(key.length / 8));
    let best = null, bestD = max + 1;
    for (const k in learned) {
      const d = lev(key, k, max);
      if (d < bestD) { bestD = d; best = learned[k]; }
    }
    return best;
  }

  const catByKey = k => D.CATS.find(c => c.k === k) || D.CATS[D.CATS.length - 1];

  function categorize(raw, learned) {
    const key = learnKey(raw);
    const hit = findLearned(key, learned);
    if (hit) return { cat: hit.cat, diet: hit.diet, conv: !!hit.conv, health: hit.health, name: hit.name || prettyName(raw), src: 'learned' };

    const n = ' ' + norm(raw) + ' ';
    const has = k => k.word ? n.includes(' ' + k.n + ' ') : k.edge ? (n.includes(' ' + k.n) || n.includes(k.n + ' ')) : n.includes(k.n);
    const matches = D.RULES.filter(r => r.keys.some(has));
    let out;
    if (!matches.length) {
      out = { cat: 'unbekannt', diet: null, conv: false, health: null, src: 'none' };
    } else {
      const first = matches[0], cat = catByKey(first.c);
      out = { cat: cat.k, diet: cat.d == null ? null : cat.d, conv: !!cat.v, health: cat.h == null ? null : cat.h, src: 'dict' };
      // spätere Regeln derselben Kategorie verfeinern Ernährung, Gesund und Convenience
      for (const r of matches) {
        if (r.c !== first.c) continue;
        if (r.d !== undefined) out.diet = r.d;
        if (r.h !== undefined) out.health = r.h;
        if (r.v !== undefined) out.conv = r.v;
      }
    }
    // zusammengesetzte Produkte: „Pizza Salami“ ist Fleisch, „Eiernudeln“ vegetarisch
    if (out.src === 'dict' && out.cat !== 'pflanzlich' && out.cat !== 'obst') {
      const cats = new Set(matches.map(r => r.c));
      if (cats.has('fleisch')) out.diet = 'fleisch';
      else if (cats.has('fisch')) out.diet = 'fisch';
      else if (cats.has('milch') && out.diet !== 'vegetarisch' && ['fertig', 'tk', 'brot', 'vorrat', 'wuerz', 'suess', 'unbekannt'].includes(out.cat) && !/KOKOS|HAFER|SOJA|MANDEL|DRINK|ERDNUSSBUTTER|KAKAOBUTTER|NUSSBUTTER/.test(n)) out.diet = 'vegetarisch';
    }
    // Hinweise im Namen schlagen das Wörterbuch
    if (/ VEGAN/.test(n) || /PLANT BASED|PFLANZLICH/.test(n)) out.diet = 'vegan';
    else if (/VEGGIE|VEGETAR| VEG /.test(n)) out.diet = 'vegetarisch';
    if (out.diet && / VEG(AN|GIE|ETAR)?/.test(n) && out.cat === 'fleisch') out.cat = 'pflanzlich';
    if (catByKey(out.cat).food === false) { out.diet = null; out.health = null; out.conv = false; }
    return out;
  }

  const api = { parse, categorize, learnKey, prettyName, norm };
  root.BonParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
