# Bon_Scan

Browser-App (PWA) fürs iPhone: Kassenbons fotografieren, auf dem Gerät auslesen, Artikel zuordnen und auswerten. Statische Dateien, kein Build-Schritt, läuft über GitHub Pages vom Branch `main`. Design nach dem Design-Leitfaden aus Film_Log (Projekt-Dokument `claude/design-leitfaden.md`), vorerst nur Deutsch.

## Dateien

- `app.js` – Oberfläche (Scan, Bons, Auswertung, Einstellungen), Speicher (IndexedDB), Lernen von Korrekturen
- `ocr.js` – Kamera, Bildaufbereitung (Zuschnitt, Bradley-Schwelle), Tesseract.js-Worker (deutsch, PSM 6)
- `parser.js` – liest Markt, Datum, Summe und Artikel aus dem Text; `categorize()` ordnet zu
- `data.js` – Kategorien, Ernährung, Gesund, Stichwort-Regeln, Märkte. Erste passende Regel gewinnt, spätere Regeln derselben Kategorie verfeinern.
- `vendor/` – wird von `.github/workflows/vendor.yml` befüllt (Tesseract.js, Kern, deu.traineddata). Nicht von Hand ändern.

## Bei jedem Update

1. `VERSION` in `app.js` erhöhen (Anzeige „Alpha x.y“).
2. `CACHE` in `sw.js` erhöhen, neue Dateien in `ASSETS` eintragen.
3. In `changelog.js` oben einen Eintrag ergänzen: `title`, darunter `added`, `changed`, `removed`.
4. Parser-Änderungen mit echten Bon-Texten prüfen (Node: `global.window = global; require('./data.js'); require('./parser.js').parse(text)`).
