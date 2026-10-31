# Shorty – Anleitung

## Was liegt wo?

| Ordner/Datei | Wofür |
|---|---|
| `extension/` | Das Add-on selbst |
| `Shorty-1.2.0.zip` | Diese Datei lädst du im Chrome Web Store hoch |
| `store/` | Bilder, Texte und Datenschutzseite für den Store |

---

## 1. Selbst ausprobieren (ohne Store)

1. In Chrome `chrome://extensions` öffnen.
2. Oben rechts **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** klicken und den Ordner `clip-lader/extension` auswählen.
4. Auf das Puzzle-Symbol oben rechts klicken und Shorty anpinnen.
5. Einen Twitch-Clip öffnen, auf das Shorty-Symbol klicken, Einstellungen wählen und auf **Herunterladen** klicken.

---

## 2. Im Chrome Web Store veröffentlichen

### Einmalig: Entwicklerkonto anlegen
1. <https://chrome.google.com/webstore/devconsole> öffnen und mit deinem Google-Konto anmelden.
2. Die einmalige Gebühr von **5 US-Dollar** bezahlen.
3. Bestätigen, dass dein Konto die Bestätigung in zwei Schritten (2FA) nutzt (Pflicht).

### Datenschutzseite online stellen
Der Store verlangt eine Internetadresse für die Datenschutzerklärung.
1. In `store/datenschutz.html` die beiden Stellen `[DEINE-E-MAIL]` durch deine Kontakt-E-Mail ersetzen.
2. Die Datei irgendwo öffentlich erreichbar machen, z. B. als zusätzliche Seite auf deiner Webseite oder kostenlos über GitHub Pages.

### Add-on hochladen
1. Im Developer Dashboard auf **Neues Element** klicken und `Shorty-1.2.0.zip` hochladen.
2. **Store-Eintrag:** Texte aus `store/STORE-TEXTE.md` einfügen, dazu Symbol, die 4 Screenshots und die Promo-Kachel aus dem Ordner `store/` hochladen.
3. **Datenschutz:** Die Angaben aus dem Abschnitt „Datenschutz-Tab“ in `STORE-TEXTE.md` übernehmen und die Adresse deiner Datenschutzseite eintragen.
4. **Vertrieb:** Sichtbarkeit „Öffentlich“, alle Regionen.
5. **Zur Überprüfung einreichen.** Die Prüfung dauert meist ein paar Tage, manchmal bis zu 2–3 Wochen.

Danach kann jeder das Add-on im Store mit **Hinzufügen** installieren.

---

## 3. Neue Version veröffentlichen

1. In `extension/manifest.json` die Versionsnummer erhöhen (z. B. `1.2.0` → `1.2.1`).
2. Den Inhalt von `extension/` neu als ZIP packen.
3. Im Dashboard unter **Paket** die neue ZIP hochladen und erneut einreichen.

---

## Gut zu wissen

- **Twitch-Schnittstelle:** Shorty nutzt dieselbe Schnittstelle wie die Twitch-Webseite. Twitch hat dafür keine offizielle Dokumentation und kann sie jederzeit ändern. Falls das Add-on irgendwann keine Clips mehr findet, muss es angepasst werden.
- **Prüfung im Store:** Google kann das Add-on wegen der Download-Funktion ablehnen. Andere Twitch-Clip-Downloader sind im Store zwar zugelassen, eine Garantie gibt es aber nicht. Bei einer Ablehnung nennt Google den Grund, und meist reicht eine kleine Änderung.
- **Nutzungsrechte:** Die Clips gehören den Streamern bzw. Twitch. Der Hinweis dazu steht bereits in der Store-Beschreibung.
