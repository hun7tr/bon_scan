# Erwartete Werte aus dem Bontext (ground_truth) ableiten
import re, json, sys, os
def amt(s): return round(float(s.replace('.', '').replace(',', '.')), 2)
def parse(txt):
    L = txt.split('\n'); items = []; total = None; pend = {}
    for l in L:
        s = l.strip()
        m = re.match(r'^(\d+) x ([\d.,]+)$', s)
        if m: pend = {'qty': int(m.group(1))}; continue
        m = re.match(r'^([\d,]+) kg x ([\d,]+) EUR/kg$', s)
        if m: pend = {'kg': amt(m.group(1))}; continue
        m = re.match(r'^SUMME EUR\s+(-?[\d.,]+)$', s)
        if m: total = amt(m.group(1)); break
        m = re.match(r'^Rabatt\s+-([\d.,]+) [AB]$', s)
        if m and items: items[-1]['price'] = round(items[-1]['price'] - amt(m.group(1)), 2); items[-1]['discount'] = True; continue
        m = re.match(r'^(.*?)\s+(-?[\d.]*\d,\d\d) ([AB])$', s)
        if m: it = {'name': m.group(1).strip(), 'price': amt(m.group(2))}; it.update(pend); pend = {}; items.append(it)
    date = re.search(r'(\d\d\.\d\d\.\d{4})\s+\d\d:\d\d\s+Bon', txt).group(1)
    return {'store': L[0].strip(), 'date': date, 'total': total, 'items': items}
d = sys.argv[1]
out = {}
for f in sorted(os.listdir(os.path.join(d, 'ground_truth'))):
    out[f.replace('.txt', '')] = parse(open(os.path.join(d, 'ground_truth', f)).read())
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=0)
# Plausibilität: Summe der Artikel = Summe
bad = [k for k, v in out.items() if abs(sum(i['price'] for i in v['items']) - v['total']) > 0.011]
print(len(out), 'Bons, Summenabweichung bei', bad[:10])
