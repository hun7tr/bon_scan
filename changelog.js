'use strict';
/* Änderungen je Version, neueste oben. Bei jedem Update ergänzen. */
window.CHANGELOG = [
  {
    v: '0.2', date: '2026-11-17',
    title: 'Deutlich zuverlässigere Erkennung, und wo die App unsicher ist, fragt sie nach.',
    added: [
      'Prüfen Schritt für Schritt: unsicher gelesene, unbekannte und unvollständige Artikel werden mit dem Ausschnitt vom Bon gezeigt und abgefragt',
      '„Kein Artikel“ entfernt eine falsch erkannte Zeile und überspringt sie künftig',
      'Bons mit offenen Punkten sind in der Liste markiert',
      'Bildaufbereitung: Bon und Textbereich werden ausgeschnitten und begradigt, Schatten und Lichtverläufe ausgeglichen, Kontrast stark verstärkt',
      'Zwei Lesedurchgänge (Schwarz-Weiß und kontrastverstärktes Graubild), das zum Bon passende Ergebnis gewinnt',
      'Verstümmelte Wörter werden mit dem Wörterbuch repariert und als geraten markiert'
    ],
    changed: [
      'Summe wird auch erkannt, wenn das Wort verstümmelt gelesen wird, und nicht mehr als Artikel gezählt',
      'Zahlungs- und Steuerzeilen beenden die Artikelliste',
      'Störzeichen hinter dem Preis werden ignoriert, Gewicht in der Artikelzeile wird erkannt',
      'Markt wird auch erkannt, wenn der Name getrennt gelesen wird (z. B. „Kauf land“)',
      'Fehlt die Summe, wird sie nicht mehr erfunden, sondern abgefragt'
    ],
    removed: []
  },
  {
    v: '0.1', date: '2026-11-17',
    title: 'Erste Version: Bons fotografieren, auslesen, zuordnen und auswerten.',
    added: [
      'Kamera öffnet sich direkt beim Start, Bon in den Rahmen halten und auslösen',
      'Texterkennung auf dem Gerät, funktioniert ohne Internet',
      'Markt, Datum, Summe, Artikel, Mengen, Gewichte, Rabatte und Pfand werden erkannt',
      'Wörterbuch ordnet Artikel Kategorie, Ernährung (vegan, vegetarisch, Fisch, Fleisch), Convenience und Gesund zu',
      'Korrekturen werden gemerkt und auf frühere und künftige Bons angewendet',
      'Lange Bons in mehreren Abschnitten scannen, Fotos aus der Mediathek laden',
      'Auswertung nach Zeitraum und Markt: Ausgaben, Verlauf, Kategorien, Ernährung, Convenience, Gesund, häufigste Produkte',
      'Artikeltabelle mit Filtern, Export als CSV-Tabelle',
      'Papierkorb für 30 Tage, Backup und Wiederherstellen',
      'Themen Hell und Dunkel'
    ],
    changed: [],
    removed: []
  }
];
