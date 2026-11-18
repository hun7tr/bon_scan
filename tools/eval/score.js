// Auswertung: gespeicherte OCR-Zeilen → Parser der App → Vergleich mit der Lösung
global.window = global;
const APP = process.env.APP || require('path').resolve(__dirname, '../..');
require(APP + '/data.js'); if (require('fs').existsSync(APP + '/products.js')) require(APP + '/products.js');
const P = require(APP + '/parser.js');
const fs = require('fs');
const [,, ocrFile, gtFile, verbose] = process.argv;
const OCR = JSON.parse(fs.readFileSync(ocrFile)), GT = JSON.parse(fs.readFileSync(gtFile));
const NOW = new Date(2026, 10, 18).getTime();
function bestParse(results) {
  const scored = results.map(res => {
    const text = res.lines.map(l => l.text).join('\n');
    const parsed = P.parse(text, { lines: res.lines, now: NOW, years: 3 });
    const checks = parsed.items.filter(i => i.check && i.check.includes('lesen')).length;
    const fits = parsed.totalFound && Math.abs(parsed.sum - parsed.total) < 0.01;
    return { res, parsed, score: (fits ? 1000 : 0) + (parsed.totalFound ? 200 : 0) + parsed.items.length * 10 - checks * 4 + res.conf / 10 };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (scored[1]) {
    const A = best.parsed.items, B = scored[1].parsed.items;
    if (A.length === B.length && A.every((x, i) => x.price === B[i].price)) A.forEach((x, i) => { const y = B[i], bad = z => (z.check || []).length * 100 - (z.conf || 0); if (bad(y) < bad(x)) A[i] = y; });
  }
  return best.parsed;
}
const norm = P.norm;
function sim(a, b) { a = norm(a); b = norm(b); if (!a && !b) return 1; const d = lev(a, b); return 1 - d / Math.max(a.length, b.length); }
function lev(a, b) { const m = []; for (let i = 0; i <= a.length; i++) { m[i] = [i]; for (let j = 1; j <= b.length; j++) m[i][j] = i ? Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) : j; } return m[a.length][b.length]; }
// Artikel in Reihenfolge zuordnen (DP), Treffer = Name ähnlich ≥ .6 oder Preis gleich
function align(E, Pr) {
  const n = E.length, m = Pr.length, S = [...Array(n + 1)].map(() => Array(m + 1).fill(0)), B = [...Array(n + 1)].map(() => Array(m + 1).fill(0));
  const w = (e, p) => { const s = sim(e.name, p.name), pr = Math.abs((p.price ?? -99) - e.price) < 0.005; return (s >= .6 || pr) ? s + (pr ? 1 : 0) : -1; };
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const opts = [[S[i - 1][j], 1], [S[i][j - 1], 2]], ww = w(E[i - 1], Pr[j - 1]);
    if (ww > 0) opts.push([S[i - 1][j - 1] + ww, 3]);
    const best = opts.reduce((a, b) => b[0] > a[0] ? b : a); S[i][j] = best[0]; B[i][j] = best[1];
  }
  const pairs = []; let i = n, j = m;
  while (i > 0 && j > 0) { if (B[i][j] === 3) { pairs.push([E[i - 1], Pr[j - 1]]); i--; j--; } else if (B[i][j] === 1) i--; else j--; }
  return pairs.reverse();
}
const T = { bons: 0, total: 0, store: 0, date: 0, exp: 0, found: 0, priceOk: 0, nameOk: 0, fullOk: 0, extra: 0, wrong: 0, wrongFlagged: 0, rightFlagged: 0, right: 0, catKnown: 0, perfect: 0 };
const rows = [];
for (const k of Object.keys(GT)) {
  if (!OCR[k]) continue;
  const g = GT[k], p = bestParse(process.env.PASS ? OCR[k].slice(+process.env.PASS, +process.env.PASS + 1) : OCR[k]);
  T.bons++;
  const tOk = p.total != null && Math.abs(p.total - g.total) < 0.005; T.total += tOk;
  const sOk = p.store && norm(p.store) === norm(g.store); T.store += !!sOk;
  const dOk = p.date && new Date(p.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) === g.date; T.date += !!dOk;
  const pairs = align(g.items, p.items);
  T.exp += g.items.length; T.found += pairs.length; T.extra += p.items.length - pairs.length;
  let allOk = tOk && pairs.length === g.items.length && p.items.length === g.items.length;
  const flagged = it => !!(it.check && (it.check.includes('lesen') || it.check.includes('preis')));
  for (const [e, q] of pairs) {
    const pOk = q.price != null && Math.abs(q.price - e.price) < 0.005, nOk = norm(q.name) === norm(e.name) || sim(q.name, e.name) >= .9;
    T.priceOk += pOk; T.nameOk += nOk;
    if (pOk && nOk) { T.fullOk++; T.right++; T.rightFlagged += flagged(q); } else { T.wrong++; T.wrongFlagged += flagged(q); allOk = false; }
    if (q.cat && q.cat !== 'unbekannt') T.catKnown++;
  }
  // zusätzliche (erfundene) Artikel zählen als falsch; markiert?
  const matched = new Set(pairs.map(x => x[1]));
  p.items.filter(x => !matched.has(x)).forEach(x => { T.wrong++; T.wrongFlagged += flagged(x); });
  T.perfect += allOk;
  rows.push({ k, ok: pairs.filter(([e, q]) => q.price != null && Math.abs(q.price - e.price) < 0.005 && (norm(q.name) === norm(e.name) || sim(q.name, e.name) >= .9)).length, exp: g.items.length });
  rows.push({ k, tOk, sOk: !!sOk, exp: g.items.length, got: p.items.length, hit: pairs.length });
  if (verbose && (verbose === 'all' || verbose === k)) {
    console.log('==', k, 'Summe', p.total, '/', g.total, '| Markt', p.store, '/', g.store, '| Datum', dOk);
    pairs.forEach(([e, q]) => console.log('  ', (Math.abs((q.price ?? -1) - e.price) < .005 ? ' ' : 'P'), (sim(q.name, e.name) >= .9 ? ' ' : 'N'), e.name.padEnd(24), String(e.price).padStart(6), '|', String(q.name).padEnd(26), q.price, (q.check || []).join(',')));
    p.items.filter(x => !matched.has(x)).forEach(x => console.log('   + EXTRA', x.name, x.price, (x.check || []).join(',')));
  }
}
const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + ' %';
console.log(`Bons ${T.bons} | fehlerfrei ${pc(T.perfect, T.bons)} | Summe ${pc(T.total, T.bons)} | Markt ${pc(T.store, T.bons)} | Datum ${pc(T.date, T.bons)}`);
console.log(`Artikel: gefunden ${pc(T.found, T.exp)} | Preis richtig ${pc(T.priceOk, T.exp)} | Name richtig ${pc(T.nameOk, T.exp)} | ganz richtig ${pc(T.fullOk, T.exp)} | erfunden ${T.extra}`);
console.log(`Ehrlichkeit: falsche Artikel markiert ${pc(T.wrongFlagged, T.wrong)} (${T.wrong}) | richtige unnötig markiert ${pc(T.rightFlagged, T.right)} | Kategorie bekannt ${pc(T.catKnown, T.found)}`);
if (process.env.ROWS) fs.writeFileSync(process.env.ROWS, JSON.stringify(rows.filter(r => 'ok' in r)));
if (process.env.WORST) console.log(rows.sort((a, b) => (a.hit / a.exp) - (b.hit / b.exp)).slice(0, 15).map(r => r.k + ' ' + r.hit + '/' + r.exp + (r.tOk ? '' : ' S✗')).join(' · '));
