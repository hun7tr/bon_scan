# Bon_Scan

Browser-App (PWA) fürs iPhone: Kassenbons fotografieren, auf dem Gerät auslesen, Artikel zuordnen und auswerten. Statische Dateien, kein Build-Schritt, läuft über GitHub Pages vom Branch `main`. Design nach dem Design-Leitfaden aus Film_Log (Projekt-Dokument `claude/design-leitfaden.md`), vorerst nur Deutsch.

## Dateien

- `app.js` – Oberfläche (Scan, Bons, Auswertung, Einstellungen), Speicher (IndexedDB), Lernen von Korrekturen
- `ocr.js` – Kamera, Bildaufbereitung (Zuschnitt, Bradley-Schwelle), Tesseract.js-Worker (deutsch, PSM 6)
- `parser.js` – liest Markt, Datum, Summe und Artikel aus dem Text; `categorize()` ordnet zu
- `products.js` – Produkt-Wörterbuch (Bon-Schreibweise je Kategorie); parser.js sucht verstümmelte Namen hier fehlertolerant.
- `confusions.js` – gelernte Lesefehler der Texterkennung (Kosten je Zeichenpaar), erzeugt mit `tools/eval/confusions.py`.
- `data.js` – Kategorien, Ernährung, Gesund, Stichwort-Regeln, Märkte. Erste passende Regel gewinnt, spätere Regeln derselben Kategorie verfeinern.
- `vendor/` – wird von `.github/workflows/vendor.yml` befüllt (Tesseract.js, Kern, deu.traineddata). Nicht von Hand ändern.

## Bei jedem Update

1. `VERSION` in `app.js` erhöhen (Anzeige „Alpha x.y“).
2. `CACHE` in `sw.js` erhöhen, neue Dateien in `ASSETS` eintragen.
3. In `changelog.js` oben einen Eintrag ergänzen: `title`, darunter `added`, `changed`, `removed`.
4. Parser-Änderungen mit echten Bon-Texten prüfen (Node: `global.window = global; require('./data.js'); require('./parser.js').parse(text)`).

## Erkennung messen und neu trainieren (`tools/eval/`)

1. Datensatz: Ordner mit `images/` und `ground_truth/` (wie `kassenbons_ocr.zip`), z. B. unter `/home/claude/ds_train`.
2. `python3 tools/eval/gt.py <datensatz> gt.json` – erwartete Werte aus dem Bontext.
3. App lokal ausliefern (`python3 -m http.server 8765` im Ordner über dem Repo), dann `python3 tools/eval/ocr_dump.py <datensatz-ordnername> ocr.json` – echte Pipeline im Headless-Chrome.
4. `node tools/eval/score.js ocr.json gt.json [bon_xxx|all]` – Kennzahlen; der Parser lässt sich ohne neue Texterkennung beliebig oft neu bewerten.
5. `python3 tools/eval/confusions.py ocr.json gt.json confusions.json` und daraus `confusions.js` neu schreiben.
Immer auch mit neu erzeugten Bons (anderer Seed) gegenprüfen, damit nichts auswendig gelernt wird.
