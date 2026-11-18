'use strict';
/* Bon_Scan – gelernte Verwechslungen der Texterkennung (aus 100 Bons mit bekannter Lösung, 3206 Zeilenpaare).
   Je Zeichenpaar die Kosten beim fehlertoleranten Vergleich mit dem Produkt-Wörterbuch: 1 = normaler Fehler,
   kleiner = häufige Verwechslung (z. B. 1 und I), daher billiger. Erzeugt mit eval/confusions.py. */
(function (root) {
  root.BON_CONFUSIONS = {"06": 0.85, "08": 0.78, "09": 0.9, "0O": 0.84, "13": 0.92, "1I": 0.3, "27": 0.84, "2Z": 0.68, "4A": 0.88, "56": 0.89, "5S": 0.67, "AE": 0.94, "BD": 0.86, "BH": 0.94, "EA": 0.9, "EO": 0.92, "FL": 0.94, "FT": 0.92, "G0": 0.9, "G9": 0.77, "GC": 0.91, "HM": 0.92, "JS": 0.86, "LI": 0.85, "LT": 0.94, "MA": 0.8, "MN": 0.53, "MS": 0.91, "OA": 0.88, "S5": 0.92, "SA": 0.92, "SN": 0.92, "VY": 0.78, "WU": 0.6, "WV": 0.7, "XZ": 0.62, "ZB": 0.89, "ZR": 0.87, "ZS": 0.92};
})(typeof window !== 'undefined' ? window : globalThis);
