# Remove [EXTERN] Prefix – Thunderbird Add-on

Entfernt automatisch das **[EXTERN]**-Präfix aus E-Mail-Betreffs.

## Beispiel

| Vorher                          | Nachher                |
| ------------------------------- | ---------------------- |
| `[EXTERN] Re: Raumreservierung` | `Re: Raumreservierung` |
| `[EXTERN] Neue Projektanfrage`  | `Neue Projektanfrage`  |
| `[EXTERN] AW: [EXTERN] Termin`  | `AW: Termin`           |

## Funktionsweise

1. **Automatisch:** Bei jeder eingehenden E-Mail wird geprüft, ob der Betreff `[EXTERN]` enthält. Falls ja, wird der Betreff bereinigt.
2. **Manuell:** Rechtsklick auf eine oder mehrere Nachrichten in der Nachrichtenliste → _„[EXTERN] Präfix entfernen"_.

### Technisch

- Die Extension nutzt den von Thunderbird **bereits dekodierten** Betreff (`message.subject`) für die Erkennung, was alle Zeichensätze und RFC-2047-Kodierungen abdeckt.
- In der Roh-Nachricht wird der gesamte `Subject:`-Header durch den bereinigten Betreff ersetzt (bei Bedarf als RFC 2047 Q-Encoding neu kodiert).
- Um einen Duplikat-Fehler beim Import zu vermeiden, wird das **Original zuerst in den Papierkorb verschoben**, dann die bereinigte Version importiert. Falls der Import fehlschlägt, wird die Originalnachricht automatisch wiederhergestellt.
- Nachrichteneigenschaften (gelesen, markiert, Tags, Junk) werden übernommen.

## Voraussetzungen

- **Thunderbird 115+** (ESR) oder neuer

## Installation

### Variante 1: Aus Ordner (Entwicklermodus)

1. In Thunderbird: **Extras → Add-ons und Themes** (oder `Ctrl+Shift+A`)
2. Zahnrad-Symbol ⚙ → **Add-on aus Datei installieren...**
3. Die Datei `manifest.json` aus diesem Ordner auswählen
   - _Alternativ:_ Zahnrad → **Debug Add-ons** → **Temporäres Add-on laden** → `manifest.json` auswählen

### Variante 2: Als .xpi-Paket

1. Den gesamten Ordner als ZIP-Datei packen:
   ```bash
   cd thunderbird-remove-extern
   zip -r ../remove-extern-prefix.xpi *
   ```
2. Die `.xpi`-Datei in Thunderbird per Drag & Drop installieren,
   oder über **Extras → Add-ons → Add-on aus Datei installieren...**

## Konfiguration anpassen

Die zu entfernenden Muster können in [background.js](background.js) angepasst werden:

```javascript
const PATTERNS_TO_REMOVE = [
  /\[EXTERN\][ \t]*/gi,
  // Weitere Muster aktivieren:
  // /\[EXTERNAL\][ \t]*/gi,
  // /\[EXT\][ \t]*/gi,
];
```

## Berechtigungen

| Berechtigung     | Grund                                            |
| ---------------- | ------------------------------------------------ |
| `messagesRead`   | Roh-Nachrichten lesen, neue Nachrichten erkennen |
| `messagesImport` | Bereinigte Nachricht importieren                 |
| `messagesDelete` | Originalnachricht in Papierkorb verschieben      |
| `messagesMove`   | Nachrichtenverwaltung                            |
| `messagesUpdate` | Nachrichteneigenschaften übernehmen              |
| `accountsRead`   | Ordnerzugriff                                    |
| `menus`          | Kontextmenü-Eintrag                              |

## Bekannte Einschränkungen

- **Bereits vorhandene Nachrichten:** Werden nur über das Kontextmenü verarbeitet (Rechtsklick → _[EXTERN] Präfix entfernen_).

## FairEmail-Sortierung anpassen (Mobile)

Wenn du FairEmail auf Android verwendest, kann die Nachrichtensortierung durch die Betreffänderung durcheinandergeraten, da FairEmail standardmäßig nach dem Server-Empfangsdatum sortiert. Da diese Extension die Nachricht neu importiert, wird sie als "geändert" erkannt.

**Lösung:** Stelle FairEmail so ein, dass es nach dem Sendedatum (Date-Header) sortiert statt nach dem Empfangsdatum. Dieser Header wird von der Extension nicht verändert.

### Schritt-für-Schritt

1. FairEmail öffnen → Hamburger-Menü (☰) → **Einstellungen**
2. **Manuelle Einrichtung und Kontooptionen** antippen
3. **Konten** antippen
4. Dein IMAP-Konto auswählen
5. Nach unten scrollen und **Erweitert** antippen
6. Bei der Zeitstempel-Option **"Date-Kopfzeile verwenden (Sendezeit)"** wählen statt "Empfangszeit verwenden (Server)" oder "Received-Kopfzeile verwenden"
7. **Prüfen** antippen zum Speichern

### Lokale Nachrichten neu synchronisieren

Damit die Änderung auch für bereits heruntergeladene Nachrichten gilt:

1. Zurück zur Ordnerliste deines Kontos
2. Lange auf den **Posteingang** drücken
3. **"Gelöschte Nachrichten auf Server belassen"** aktivieren
4. Dann **"Lokale Nachrichten löschen"** wählen (keine Sorge, sie werden nur lokal gelöscht!)
5. Anschließend **"Jetzt synchronisieren"** oder warten, bis FairEmail automatisch synchronisiert

Danach sortiert FairEmail alle Mails nach dem originalen Sendedatum, unabhängig davon ob der Betreff durch die Extension geändert wurde.

## Debugging

Falls die Extension nicht funktioniert, kannst du die Logausgaben prüfen:

1. **Thunderbird** → **Extras** → **Entwicklerwerkzeuge** → **Fehlerkonsole** (oder `Ctrl+Shift+J`)
2. Nach `[Remove EXTERN]` filtern
3. Dort siehst du genau, welche Schritte durchlaufen oder fehlgeschlagen sind

## Lizenz

MIT
