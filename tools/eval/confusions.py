# Verwechslungen der Texterkennung lernen: erkannte Artikelzeilen gegen die Lösung ausrichten und
# Ersetzungen Zeichen für Zeichen zählen (nur Artikelnamen, normalisiert wie in der App)
import json, re, sys, unicodedata
from collections import Counter
ocr = json.load(open(sys.argv[1])); gt = json.load(open(sys.argv[2]))
def norm(s):
    s = s.upper().replace('Ä','A').replace('Ö','O').replace('Ü','U').replace('ß','SS')
    s = s.replace('AE','A').replace('OE','O').replace('UE','U')
    return re.sub(r'[^A-Z0-9 ]+', ' ', s).strip()
def align(a, b):
    n, m = len(a), len(b); D = [[0]*(m+1) for _ in range(n+1)]
    for i in range(n+1): D[i][0] = i
    for j in range(m+1): D[0][j] = j
    for i in range(1, n+1):
        for j in range(1, m+1):
            D[i][j] = min(D[i-1][j]+1, D[i][j-1]+1, D[i-1][j-1]+(a[i-1]!=b[j-1]))
    i, j, ops = n, m, []
    while i > 0 or j > 0:
        if i and j and D[i][j] == D[i-1][j-1]+(a[i-1]!=b[j-1]): ops.append((a[i-1], b[j-1])); i-=1; j-=1
        elif i and D[i][j] == D[i-1][j]+1: ops.append((a[i-1], '')); i-=1
        else: ops.append(('', b[j-1])); j-=1
    return ops[::-1]
sub = Counter(); tot = Counter(); pairs = 0
for k, g in gt.items():
    if k not in ocr: continue
    names = [norm(it['name']) for it in g['items']]
    for res in ocr[k]:
        for l in res['lines']:
            t = norm(re.sub(r'-?\d+,\d\d.*$', '', l['text']))
            if len(t) < 4: continue
            # passenden Lösungsnamen suchen (ähnlichster)
            best, bd = None, 9
            for nm in names:
                ops = align(nm, t); d = sum(1 for x, y in ops if x != y)
                if d < bd: bd, best = d, (nm, ops)
            if best and bd <= max(2, len(best[0]) * .45):
                pairs += 1
                for x, y in best[1]:
                    if x and x != ' ': tot[x] += 1
                    if x != y: sub[(x, y)] += 1
print(pairs, 'Zeilenpaare')
# Kosten: häufige Verwechslungen werden billig (0,3 … 1)
costs = {}
for (x, y), c in sub.most_common():
    if not x or not y or x == ' ' or y == ' ': continue
    p = c / max(1, tot[x])
    if c >= 3 and p >= .01: costs[x + y] = round(max(.3, 1 - p * 6), 2)
print(len(costs), 'Verwechslungen'); print(sorted(costs.items(), key=lambda kv: kv[1])[:40])
ins = {y: c for (x, y), c in sub.items() if not x and y and y != ' '}
dele = {x: c for (x, y), c in sub.items() if x and not y and x != ' '}
print('häufig eingefügt', sorted(ins.items(), key=lambda kv: -kv[1])[:10]); print('häufig verloren', sorted(dele.items(), key=lambda kv: -kv[1])[:10])
json.dump({'sub': costs, 'pairs': pairs}, open(sys.argv[3], 'w'))
