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

  // Betrag: der letzte Betrag der Zeile; dahinter dürfen nur Steuerkennzeichen und Störzeichen stehen
  const PRICE_ALL = /(-|−)?\s?(\d{1,4}),(\d{2})\d?(?!\d)\s*(-)?/g;
  // Menge: „2 x 0,89“, „2 Stk x 0,89 1,78“, „3 * 1,29“
  const QTY = /^(\d{1,3})\s*(?:STK|ST|STUCK|STÜCK|STCK)?\.?\s*[xX×*]\.?\s*(\d{1,4},\d{2})(?:\s*(?:EUR|€))?(?:\s+(-?\d{1,4},\d{2}))?/i;
  const QTY_INLINE = /(?:^|\s)(\d{1,3})\s*(?:STK|ST)?\.?\s*[xX×*]\.?\s*(\d{1,4},\d{2})(?=\s|$)|^(\d{1,3})\s*[xX×*]\s+(?=[A-Za-zÄÖÜäöü])/i;
  // Gewicht: „0,512 kg x 2,99 EUR/kg“, „1,234 kg * 1,99 €/kg“
  const WEIGHT = /(\d{1,3}[,.]\d{1,3})\s*KG\s*[xX×*@]?\s*(\d{1,4},\d{2})\s*(?:EUR|€)?\s*\/\s*KG(?:\s+(-?\d{1,4},\d{2}))?/i;
  // Gewicht in der Artikelzeile ohne Kilopreis: „Bananen Bio 0,484 kg 0,77 B“
  const WEIGHT_INLINE = /\s(\d{1,3}[,.]\d{3})\s*kg\b/i;
  const HAND = /HANDEINGABE|HAND EINGABE|WAAGE|WAEGEN/i;

  const TOTAL_LIST = ['SUMME', 'GESAMTSUMME', 'GESAMT', 'ZU ZAHLEN', 'ZUZAHLEN', 'ENDBETRAG', 'TOTAL', 'GESAMTBETRAG', 'ENDSUMME', 'BETRAG'];
  const PAY_WORDS = /\b(KARTENZAHLUNG|KARTE|BAR|BARGELD|GEGEBEN|GEG|RUCKGELD|ZURUCK|EC|EC CASH|GIROCARD|GIRO|VISA|MASTERCARD|MAESTRO|VPAY|AMEX|KONTAKTLOS|APPLE PAY|GOOGLE PAY|PAYPAL|MWST|MW ST|UST|STEUER|NETTO|BRUTTO|KUNDENBELEG|HANDLERBELEG|TERMINAL)\b/;
  const SKIP_WORDS = /\b(MWST|MW ST|MWS|UST|STEUER|STEUERNR|NETTO|BRUTTO|BAR|GEGEBEN|GEG|RUCKGELD|ZURUCK|KARTE|KARTENZAHLUNG|EC|GIROCARD|GIRO|VISA|MASTERCARD|MAESTRO|VPAY|V PAY|AMEX|KONTAKTLOS|PAYBACK|DEUTSCHLANDCARD|PUNKTE|BONUS|TSE|TERMINAL|TRANSAKTION|KASSE|KASSIERER|BON NR|BONNR|BELEG|BELEGNR|ZWISCHENSUMME|POSTEN|ANZAHL|ARTIKELANZAHL|DATUM|UHRZEIT|ZAHLUNG|BEZAHLT|ENTGELT|TRINKGELD|AUTORISIERUNG|GENEHMIGUNG|KUNDENBELEG|HANDLERBELEG|SIGNATUR|SERIENNUMMER|VIELEN DANK|WWW|HTTP|TEL|FAX|OFFNUNGSZEITEN|USTID|UST ID|STEUERNUMMER|PREIS EUR|EUR)\b/;
  const DISCOUNT_WORDS = /\b(RABATT|PREISVORTEIL|VORTEIL|NACHLASS|COUPON|GUTSCHEIN|AKTION|ERMASSIGUNG|PREISREDUZ|REDUZIERT|SOFORTRABATT|MENGENRABATT|SPARPREIS|SIE SPAREN|LIDL PLUS|PREISABSCHRIFT)\b/;
  const TAX_TABLE = /^[A-D]\s*[=:]?\s*\d{1,2}[,.]\d{1,2}\s*%|\d{1,2}[,.]\d{1,2}\s*%\s+\d+,\d{2}\s+\d+,\d{2}/;

  // Summenwort auch dann erkennen, wenn die Texterkennung es verstümmelt („Sunne“, „SUmne“, „5umme“)
  function isTotalLine(n) {
    if (/ZWISCHEN/.test(n)) return false;
    const words = n.replace(/5/g, 'S').replace(/0/g, 'O').split(' ');
    for (let i = 0; i < Math.min(3, words.length); i++) {
      const wd = words[i], two = wd + ' ' + (words[i + 1] || '');
      for (const t of TOTAL_LIST) {
        const cand = t.includes(' ') ? two : wd;
        if (cand === t) return true;
        if (t.length >= 5 && Math.abs(cand.length - t.length) <= 1 && lev(cand, t, 2) <= (t.length >= 7 ? 2 : 1)) return true;
      }
    }
    return false;
  }

  // letzter Betrag einer Zeile; null, wenn hinter ihm noch echter Text steht
  function endPrice(line) {
    let m, last = null;
    PRICE_ALL.lastIndex = 0;
    while ((m = PRICE_ALL.exec(line))) last = { m, index: m.index, end: m.index + m[0].length };
    if (!last) return null;
    const tail = line.slice(last.end);
    // erlaubt: Steuerkennzeichen (A, B, 1, AW, *), EUR, € und bis zu vier Störzeichen
    const t = tail.replace(/\b(EUR|€)\b/g, '').replace(/^\s*([A-D]{1,2}\d?|\d|\*)(?=\s|$)/, '').replace(/\s+/g, '');
    if (t.length > 4 || /[A-Za-zÄÖÜäöü]{3,}/.test(t)) return null;
    const neg = !!(last.m[1] || last.m[4]);
    return { name: line.slice(0, last.index).replace(/[\s:]+$/, ''), price: toNum(last.m[2] + ',' + last.m[3]) * (neg ? -1 : 1) };
  }

  // Lesbarer Name: aus „BIO H-MILCH 1,5%“ wird „Bio H-Milch 1,5%“
  function cleanName(raw) {
    return String(raw || '').replace(/^(?:[^A-Za-zÄÖÜäöü0-9]+\s*|[A-Za-zÄÖÜäöü0-9]\s+(?=[A-Za-zÄÖÜäöü]{3}))+/, '').replace(/^\d{4,}\s+/, '').replace(/\s+\d{6,}$/, '').replace(/[|_~"'`´“”„]+/g, ' ')
      .replace(/(\d)\s?m[1lI]\b/g, '$1ml').replace(/(^|\s)[ıIl|](kg|g|l)\b/g, '$11$2').replace(/ı/g, 'i')
      .replace(/\s{2,}/g, ' ').replace(/^[\s.,:;\-*#=]+|[\s.,:;\-*#=]+$/g, '').trim();
  }
  function prettyName(raw) {
    let s = cleanName(raw);
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
        const n = norm(l);
        if (/BRUTTO|STEUER|MWST/.test(n)) continue;
        // ohne Leerzeichen vergleichen: „Kauf land“ ist Kaufland
        const c = n.replace(/ /g, ''), padded = ' ' + n + ' ';
        for (const [k, name] of D.STORES) {
          const kc = k.replace(/ /g, '');
          if (padded.includes(' ' + k + ' ') || (kc.length > 4 && c.includes(kc))) return name;
        }
      }
      return null;
    };
    const head = scan(lines.slice(0, 12));
    if (head) return head;
    return scan(lines);
  }

  function fixPart(str, min, max) {
    for (let i = 0; i < str.length; i++) for (const r of CONFUSE[str[i]] || '') {
      const v = +(str.slice(0, i) + r + str.slice(i + 1));
      if (v >= min && v <= max) return v;
    }
    return null;
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
        // „93.11.2026“: Tag oder Monat mit einer typisch verwechselten Ziffer reparieren
        if (d < 1 || d > 31) d = fixPart(m[1], 1, 31);
        if (mo < 1 || mo > 12) mo = fixPart(m[2], 1, 12);
        if (!d || !mo || y < 2000) continue;
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

  // ------------------------------------------------------------ Lesefehler erkennen
  // Wörter, die nach Lesefehlern aussehen: Buchstaben und Ziffern gemischt (außer Mengen wie 500g, 1,5l, 10er, 6x1,5l)
  const UNIT_TOKEN = /^\d+([,.]\d+)?(g|kg|ml|l|cl|st|stk|er|x|%|m|cm|w|v)?\.?$/i;
  const MULTI_TOKEN = /^\d+x\d+([,.]\d+)?(l|g|ml|kg|cl)?$/i;
  const tokensOf = name => name.split(/[\s.\/]+/).filter(Boolean);
  const mixed = t => /\d/.test(t) && /[A-Za-zÄÖÜäöüß]/.test(t) && !UNIT_TOKEN.test(t) && !MULTI_TOKEN.test(t);
  function suspicious(name) {
    const letters = (name.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
    const compact = name.replace(/\s/g, '');
    if (letters < 3 || letters / Math.max(1, compact.length) < .5) return true;
    if (/[^A-Za-zÄÖÜäöüß0-9 .,%&\/+\-()!:*]/.test(name)) return true;
    if (/(^|\s)[a-zäöü]{1,2}(\s|$)/.test(name) && /^[a-zäöü]/.test(name)) return true;
    return tokensOf(name).some(mixed);
  }

  // Wortschatz aus dem Wörterbuch und dem Gelernten, um verstümmelte Wörter zu reparieren („Brocco14“ → „Broccoli“)
  let VOCAB = null;
  function vocab(learned) {
    if (!VOCAB) {
      VOCAB = new Set();
      D.RULES.forEach(r => r.keys.forEach(k => { if (k.n.length >= 5 && !k.n.includes(' ')) VOCAB.add(k.n); }));
    }
    const v = new Set(VOCAB);
    if (learned) for (const k in learned) norm(learned[k].name).split(' ').forEach(w => { if (w.length >= 5) v.add(w); });
    return v;
  }
  const LOOK = { 0: 'O', 1: 'L', 4: 'A', 5: 'S', 8: 'B', 6: 'G', 3: 'B', 7: 'T', 2: 'Z' };
  function repairName(name, learned) {
    let changed = false;
    const V = vocab(learned);
    const out = name.split(/(\s+|\.)/).map(tok => {
      if (!mixed(tok) || tok.replace(/[^A-Za-zÄÖÜäöüß0-9]/g, '').length < 5) return tok;
      const lettersOnly = norm(tok.replace(/\d/g, d => LOOK[d] || d));
      const alt = lettersOnly.replace(/L/g, 'I');
      if (V.has(lettersOnly) || V.has(alt)) { changed = true; return cap(V.has(lettersOnly) ? lettersOnly : alt); }
      let best = null, bestD = 3, ties = 0;
      for (const w of V) {
        if (Math.abs(w.length - lettersOnly.length) > 1) continue;
        const d = lev(lettersOnly, w, 2);
        if (d < bestD) { bestD = d; best = w; ties = 0; } else if (d === bestD) ties++;
      }
      const lim = lettersOnly.length >= 8 ? 2 : 1;
      if (best && bestD <= lim && !ties) { changed = true; return cap(best); }
      return tok;
    }).join('');
    return { name: out, changed };
  }
  const cap = w => w.charAt(0) + w.slice(1).toLowerCase();

  // ------------------------------------------------------------ Bon auslesen
  // text: erkannter Text. opts.lines: Zeilen der Texterkennung mit Sicherheit (conf, minWord) und Lage (bbox).
  // Jeder Artikel bekommt check: Liste offener Punkte ('lesen' = unsicher gelesen, 'preis' = Preis fehlt oder angeglichen,
  // 'zuordnen' = Kategorie unbekannt). So kann die App ehrlich nachfragen statt zu raten.
  function parse(text, opts) {
    opts = opts || {};
    const src = opts.lines && opts.lines.length
      ? opts.lines.map(l => ({ raw: l.text || '', conf: l.conf, minWord: l.minWord, bbox: l.bbox }))
      : String(text || '').split(/\r?\n/).map(t => ({ raw: t }));
    const L = src.map((l, i) => Object.assign(l, { i, t: fixNumbers(l.raw.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim()) })).filter(l => l.t.length > 1);
    const lines = L.map(l => l.t);
    const items = [], unread = [];
    let total = null, totalFound = false;
    let pending = null, pendingQty = null;
    const running = () => round2(items.reduce((s, it) => s + (it.price || 0), 0));
    const last = () => items[items.length - 1];
    const letterCount = s => (s.match(/[A-Za-zÄÖÜäöü]/g) || []).length;
    const push = (lo, raw, price, extra) => {
      if (pending && pending !== lo && items.length) unread.push(pending);
      const it = Object.assign({ raw: cleanName(raw), name: prettyName(raw), price: round2(price), qty: 1, line: lo.i, conf: lo.conf, minWord: lo.minWord, bbox: lo.bbox }, extra || {});
      if (pendingQty && !pendingQty.kgOnly && !(extra && extra.qty)) { it.qty = pendingQty.qty; it.unit = pendingQty.unit; pendingQty = null; }
      items.push(it);
      pending = null;
      return it;
    };

    for (let k = 0; k < L.length; k++) {
      const lo = L[k], line = lo.t, n = norm(line);
      if (!n || TAX_TABLE.test(line)) continue;

      // Summe: danach kommen keine Artikel mehr
      if (isTotalLine(n)) {
        const ep = endPrice(line) || (L[k + 1] && /^(EUR|€)?\s*-?\d{1,4},\d{2}/.test(L[k + 1].t) ? endPrice('x ' + L[k + 1].t) : null);
        if (ep) { total = Math.abs(ep.price); totalFound = true; break; }
        continue;
      }
      // Zahlungsteil (Karte, Bar, Steuer …): Ende der Artikel
      if (items.length && PAY_WORDS.test(n)) {
        const ep = endPrice(line);
        if (ep && Math.abs(Math.abs(ep.price) - running()) < 0.011) { total = Math.abs(ep.price); totalFound = true; }
        break;
      }

      // Gewichtszeile mit Kilopreis
      const w = line.match(WEIGHT);
      if (w) {
        const kg = toNum(w[1]), perKg = toNum(w[2]), calc = round2(kg * perKg), Lx = last();
        if (w[3] && pending) { push(pending, pending.t, toNum(w[3]), { kg, perKg }); continue; }
        if (Lx && Math.abs(Lx.price - calc) < 0.03 && !Lx.kg) { Lx.kg = kg; Lx.perKg = perKg; continue; }
        const before = line.slice(0, w.index).trim();
        if (w[3] || letterCount(before) >= 3) { push(lo, before || (pending && pending.t) || 'Artikel', w[3] ? toNum(w[3]) : calc, { kg, perKg }); continue; }
        if (pending) { push(pending, pending.t, calc, { kg, perKg }); continue; }
        pendingQty = { kgOnly: true, kg, perKg };
        continue;
      }

      // reine Mengenzeile
      const q = line.match(QTY);
      if (q && letterCount(line.replace(q[0], '')) < 3) {
        const qty = +q[1], unit = toNum(q[2]);
        const tot = q[3] ? toNum(q[3]) : round2(qty * unit), Lx = last();
        if (pending) { push(pending, pending.t, tot, { qty, unit }); continue; }
        if (Lx && !Lx.qtySet && Math.abs(Lx.price - qty * unit) < 0.03) { Lx.qty = qty; Lx.unit = unit; Lx.qtySet = true; continue; }
        if (q[3] && Lx && !Lx.qtySet && (Lx.price === 0 || Math.abs(Lx.price - unit) < 0.03)) { Lx.price = tot; Lx.qty = qty; Lx.unit = unit; Lx.qtySet = true; continue; }
        pendingQty = { qty, unit };
        continue;
      }

      const ep = endPrice(line);
      if (!ep) {
        // Zeile ohne Betrag: Name, dessen Betrag in der nächsten Zeile steht – oder eine nicht verstandene Zeile
        const ok = letterCount(line) >= 3 && !SKIP_WORDS.test(n) && !/^\d{5}\s/.test(line);
        if (pending && items.length) unread.push(pending);
        pending = ok ? lo : null;
        continue;
      }
      let name = ep.name, price = ep.price;
      const nn = norm(name);
      if (SKIP_WORDS.test(nn) || !nn) { pending = null; continue; }
      if (HAND.test(name)) name = name.replace(HAND, '').trim();

      // Betrag ohne Namen: gehört zum Namen aus der Zeile davor
      if (letterCount(name) < 2) {
        if (pending) push(pending, pending.t, price);
        else if (last() && last().price === 0) last().price = round2(price);
        continue;
      }

      // Rabatt: mindert den Artikel davor
      if (DISCOUNT_WORDS.test(nn) && !/PFAND|LEERGUT/.test(nn)) {
        const Lx = last();
        let off = -Math.abs(price);
        if (Lx && -off >= Lx.price) { const alt = digitVariants(-off).find(v => v > 0 && v < Lx.price); if (alt != null) off = -alt; }
        if (Lx && -off < Lx.price) { Lx.price = round2(Lx.price + off); Lx.discount = round2((Lx.discount || 0) + off); }
        else push(lo, name, off);
        continue;
      }

      // Betrag gleich der Summe aller bisherigen Artikel und Name unbekannt: das ist die (verstümmelte) Summenzeile
      if (items.length >= 2 && Math.abs(price - running()) < 0.011 && (suspicious(name) || categorize(name).src === 'none')) {
        total = price; totalFound = true; break;
      }

      // Menge in der Zeile: „BANANE 2 X 1,29 2,58“ oder „2 X BANANE 2,58“
      const qi = name.match(QTY_INLINE);
      let extra = null;
      if (qi) {
        const qty = +(qi[1] || qi[3]), unit = qi[2] ? toNum(qi[2]) : round2(Math.abs(price) / qty);
        if (qty > 1 && (!qi[2] || Math.abs(qty * unit - Math.abs(price)) < 0.03)) {
          name = (name.slice(0, qi.index) + ' ' + name.slice(qi.index + qi[0].length)).trim();
          extra = { qty, unit };
        }
      }
      // Gewicht in der Zeile: „Bananen Bio 0,484 kg“
      const wi = name.match(WEIGHT_INLINE);
      if (wi) {
        extra = Object.assign(extra || {}, { kg: toNum(wi[1]) });
        extra.perKg = round2(Math.abs(price) / extra.kg);
        name = (name.slice(0, wi.index) + name.slice(wi.index + wi[0].length)).trim();
      }
      if (/PFAND|LEERGUT/.test(nn) && /LEERGUT|RUCKGABE|RUECKGABE/.test(nn)) price = -Math.abs(price);
      const it = push(lo, name, price, extra);
      if (pendingQty && pendingQty.kgOnly && !it.kg) { it.kg = pendingQty.kg; it.perKg = pendingQty.perKg; pendingQty = null; }
    }
    if (pending && items.length) unread.push(pending);

    items.forEach(it => { delete it.qtySet; });
    let sum = running();
    // keine Summenzeile gelesen: steht die Summe der Artikel woanders auf dem Bon (Zahlung, Steuertabelle, „EUR 13,22“)?
    if (!totalFound && items.length >= 2) {
      const amounts = lines.join(' ').match(/\d{1,4},\d{2}/g) || [];
      if (amounts.some(a => Math.abs(toNum(a) - sum) < 0.005)) { total = sum; totalFound = true; }
    }
    // Summe passt nicht: gibt es genau einen (oder genau ein Paar) Preis, bei dem eine typische Ziffernverwechslung die Differenz erklärt?
    if (total != null && Math.abs(sum - total) >= 0.01) {
      const diff = round2(sum - total);
      const hits = items.filter(it => digitVariants(it.price).some(v => Math.abs(v - (it.price - diff)) < 0.005));
      if (hits.length === 1) { hits[0].price = round2(hits[0].price - diff); hits[0].fixed = true; }
      else if (!hits.length && items.length <= 60) {
        const opts2 = items.map(it => digitVariants(it.price).map(v => ({ it, v, delta: round2(it.price - v) })));
        const sols = [];
        for (let a = 0; a < opts2.length && sols.length < 2; a++) for (let b = a + 1; b < opts2.length && sols.length < 2; b++)
          for (const x of opts2[a]) for (const y of opts2[b]) if (Math.abs(x.delta + y.delta - diff) < 0.005) sols.push([x, y]);
        if (sols.length === 1) sols[0].forEach(o => { o.it.price = o.v; o.it.fixed = true; });
      }
      sum = running();
    }

    // Zeilen, die zwischen den Artikeln stehen, aber nicht verstanden wurden: als Artikel ohne Preis aufnehmen
    unread.forEach(lo => {
      const it = { raw: cleanName(lo.t), name: prettyName(lo.t), price: null, qty: 1, line: lo.i, conf: lo.conf, minWord: lo.minWord, bbox: lo.bbox, unreadable: true };
      const at = items.findIndex(x => x.line > lo.i);
      items.splice(at < 0 ? items.length : at, 0, it);
    });

    const out = [];
    for (const it of items) {
      // verstümmelte Wörter mit dem Wörterbuch reparieren, aber als geraten kennzeichnen
      let guessed = false;
      if (suspicious(it.name)) {
        const r = repairName(it.name, opts.learned);
        if (r.changed) { it.raw = cleanName(r.name).toUpperCase(); it.name = prettyName(r.name); guessed = true; }
      }
      const c = categorize(it.raw, opts.learned);
      if (c.ignore) continue;
      Object.assign(it, c);
      const check = [];
      const lowConf = it.conf != null && (it.conf < 78 || (it.minWord != null && it.minWord < 55));
      if (c.src !== 'learned' && (guessed || lowConf || suspicious(it.name) || it.unreadable)) check.push('lesen');
      if (it.price == null || it.fixed) check.push('preis');
      if (it.cat === 'unbekannt') check.push('zuordnen');
      if (check.length) it.check = check;
      if (guessed) it.guessed = true;
      out.push(it);
    }
    return {
      store: findStore(lines),
      date: findDate(lines, opts.now),
      total: totalFound ? total : null,
      totalFound,
      sum: round2(out.reduce((s, it) => s + (it.price || 0), 0)),
      items: out
    };
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
      if (learned[k].ignore) continue;
      const d = lev(key, k, max);
      if (d < bestD) { bestD = d; best = learned[k]; }
    }
    return best;
  }

  const catByKey = k => D.CATS.find(c => c.k === k) || D.CATS[D.CATS.length - 1];

  function categorize(raw, learned) {
    const key = learnKey(raw);
    const hit = findLearned(key, learned);
    if (hit && hit.ignore) return { ignore: true };
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
    if (out.src === 'dict' && !['pflanzlich', 'obst', 'fisch', 'fleisch'].includes(out.cat)) {
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
