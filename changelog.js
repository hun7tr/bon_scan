'use strict';
/* Änderungen je Version, neueste oben. Bei jedem Update ergänzen. */
window.CHANGELOG = [
  {
    v: '0.4', date: '2026-11-18',
    title: 'Mit 100 Testbons trainiert: Produkt-Wörterbuch, gelernte Lesefehler und bessere Bildaufbereitung.',
    added: [
      'Produkt-Wörterbuch mit über 800 gängigen Supermarktprodukten: verstümmelt gelesene Namen werden erkannt und richtig zugeordnet',
      'Tabelle typischer Lesefehler, gelernt aus 100 Bons mit bekannter Lösung (z. B. 1 und I, 5 und S)',
      'Unbekannter Markt: die erste Kopfzeile wird als Name übernommen',
      'Preise unsicher gelesener Zeilen werden zum Prüfen markiert, außer die Summe des Bons bestätigt sie'
    ],
    changed: [
      'Begradigen dreht schräge Bons jetzt in die richtige Richtung und misst die Schräglage nur an der Schrift',
      'Papiererkennung robust gegen Schatten, Preisspalte und Zeilenanfänge werden nicht mehr abgeschnitten',
      'Alle Textblöcke bleiben erhalten, auch Summe und Datum unter den Artikeln',
      'Kleine Fotos werden stärker vergrößert, das kontrastverstärkte Graubild wird zuerst gelesen',
      'Trennlinien und Datumszeilen beenden die Artikelliste, Fußzeilen werden nicht mehr als Artikel gezählt',
      'Lesemüll fällt weg, wenn die Bonsumme das bestätigt'
    ],
    removed: []
  },
  {
    v: '0.3', date: '2026-11-17',
    title: 'Fehlende Artikel direkt auf dem Bon antippen, Rückgängig und Zuordnungen exportieren.',
    added: [
      'Artikel hinzufügen zeigt den bearbeiteten Bon: erfasste Zeilen sind grün markiert, eine fehlende Zeile antippen übernimmt Name und Preis',
      'Anzeige, wie viel bis zur Summe laut Bon noch fehlt',
      '„Kein Artikel“ und Entfernen lassen sich rückgängig machen',
      'Gelernte Zuordnungen exportieren und importieren',
      'Speicherstatus in den Einstellungen (dauerhaft oder nicht, belegter Platz)'
    ],
    changed: [
      'Gelernte Zuordnungen sind nach Kategorien sortiert, „Kein Artikel“ steht gesammelt am Ende und lässt sich wieder aufheben',
      'Das bearbeitete Bild jedes Scans wird mit dem Bon gespeichert und ist im Backup enthalten'
    ],
    removed: []
  },
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
