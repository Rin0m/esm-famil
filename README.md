# اسم فامیل – Esm Famil (Stadt, Land, Fluss) online

Echtzeit-Spiel für 2–12 Leute im Browser. Kostenlos, ohne Anmeldung, Oberfläche auf Persisch, Deutsch und Englisch.

## Ablauf
1. Jemand erstellt einen Raum und wird damit Gastgeber. Den Link schickt er an die anderen.
2. Der Gastgeber stellt **Zeit**, **Kategorien** und **Buchstaben** ein. Alles ist frei änderbar.
3. Er startet die Runde, und ein zufälliger Buchstabe wird gezogen (keiner kommt doppelt, bis alle durch sind).
4. Alle schreiben gleichzeitig. Wer alle Felder ausgefüllt hat, kann **Stopp** drücken. Sonst endet die Runde, wenn der Timer abläuft.
5. Auswertung: **10 Punkte** für ein Wort, das nur du hast, **5 Punkte** wenn jemand dasselbe hat, **0 Punkte** für leere Felder oder einen falschen Anfangsbuchstaben.
   Der Gastgeber kann jede Antwort antippen und sie damit für gültig oder ungültig erklären.

## Admin-Passwort
Nur wer das Admin-Passwort kennt, kann einen Raum erstellen und Gastgeber werden. Alle anderen treten nur über Link oder Code bei.
- **Render:** Dashboard → dein Service → **Environment** → **Add Environment Variable**. Key `ADMIN_PASSWORD`, Value = dein Passwort → **Save**. Render startet den Dienst danach neu.
- **Lokal:** `ADMIN_PASSWORD=meinPasswort npm start`
- Ist kein Passwort gesetzt, darf jeder Räume erstellen.

Der Gastgeber kann die Rolle in der Lobby mit **„Zum Gastgeber“** an jemand anderen weitergeben. Verliert er die Verbindung, wartet der Raum 60 Sekunden auf ihn. Erst danach übernimmt automatisch ein anderer Spieler.

## Designs
Über den Knopf **🎨 Design** oben wählt jeder Spieler sein eigenes Teppich-Design: Kaschan, Täbris, Maschhad, Isfahan, Heris, Ghom, Termeh oder Schiras. Die Auswahl wird im Browser gespeichert.
Eigene Designs ergänzt du in `public/index.html` in der Liste `THEMES`: Kopiere eine Zeile und ändere die Farben.

## Lokal starten (zum Testen)
```bash
npm install
npm start
```
Dann http://localhost:3000 öffnen. Im selben WLAN können die anderen über deine lokale IP mitspielen.

## Kostenlos online stellen (Render.com)
1. Lade den Ordner in ein GitHub-Repo hoch (ohne `node_modules`).
2. Geh auf https://render.com, erstell ein kostenloses Konto und wähle **New → Web Service**. Verbinde dein Repo.
3. Trag als Build Command `npm install` und als Start Command `npm start` ein. Wähle den Plan **Free**.
4. Nach ein paar Minuten bekommst du einen Link wie `https://esm-famil.onrender.com`. Den schickst du an deine Freunde.

Hinweis: Im Free-Plan schläft der Server nach etwa 15 Minuten ohne Nutzung ein. Der erste Aufruf dauert danach ungefähr 30–60 Sekunden.

## Dateien
- `server.js`: Server (Räume, Timer, Punkte)
- `public/index.html`: komplette Oberfläche mit allen drei Sprachen
- `test/sim.js`: automatischer Test mit 3 simulierten Spielern (läuft gegen einen Server auf Port 3999: `PORT=3999 ADMIN_PASSWORD=geheim npm start`, dann `npm test`)

Schrift: Vazirmatn (SIL Open Font License).
