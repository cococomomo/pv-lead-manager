# PV Lead Manager

Pipeline: IMAP → KI-Extraktion → Google Sheets → optional Google Kalender + Mailbestätigung → Web-Dashboard (Leaflet-Karte, CRM-Felder, Vertriebler per Klick, Status, Google-Kalender-Link).

## DNS ist da (z. B. wie beim Roof Identifier) – warum geht `pvl` trotzdem nicht?

**DNS** sagt nur: dieser Name → diese IP. **Roof Identifier** funktioniert, weil auf dem Server **etwas lauscht** (z. B. Nginx auf Port 80) und für **diese** Domain/Location auf den passenden Dienst zeigt.

Für **PV Lead Manager** brauchst du **denselben Server**, aber **eine eigene Kette**:

1. **Node** muss laufen und auf dem gewählten Port lauschen (Standard **3080**), z. B. `pm2 start src/server.js`.
2. **Nginx** (oder Caddy) braucht einen **eigenen** `server`-Block für `pvl.lifeco.at` mit `proxy_pass http://127.0.0.1:3080` – der Block vom Roof Identifier reicht nicht automatisch; ohne ihn antwortet auf `pvl` oft nichts Sinnvolles oder der Default-Server.

**Localhost** meint immer den **Rechner, auf dem der Browser bzw. der Befehl läuft**:

- Auf deinem **Entwicklungs-PC**: `npm start` im Projekt → `http://localhost:3080` (nur wenn Node dort läuft).
- Die **Installation auf Hetzner** erreichst du von deinem PC mit **`http://pvl.lifeco.at`** (besser HTTPS) – **nicht** mit `localhost` auf dem Laptop (das wäre dein eigener PC, nicht der Server).

## `.env` und Passwort – „verschlüsselt“?

- Die **`.env` auf dem Server** sollte nur für den Deploy-User lesbar sein (`chmod 600 .env`, Besitzer z. B. der PM2-User). **Normale Website-Besucher** können sie **nicht** auslesen; sie liegt nicht im Webroot.
- Trotzdem: **Kein Klartext-Passwort** in der `.env` auf Produktion. Stattdessen **bcrypt-Hash** nutzen:
  ```bash
  npm run hash-basic-password -- 'dein-passwort'
  ```
  Ausgabe in `.env` als `BASIC_AUTH_PASS_BCRYPT=...` eintragen, **`BASIC_AUTH_PASS` weglassen**. Login im Browser bleibt **Klartext** (cosimo / Passwort) – nur die **Speicherung** ist gehasht. HTTPS schützt die Übertragung.

## Kosten / KI

- **Anthropic (Claude):** weiterhin Standard (`LLM_PROVIDER=anthropic`). Für reine E-Mail-Extraktion reicht meist ein kleines Modell; Kosten bleiben überschaubar bei moderaten Mailvolumina.
- **DeepSeek & Co.:** günstige Alternative über dieselbe Chat-API wie OpenAI. In `.env` z. B.  
  `LLM_PROVIDER=openai-compatible`  
  `OPENAI_BASE_URL=https://api.deepseek.com`  
  `OPENAI_API_KEY=…`  
  `LLM_MODEL=deepseek-chat`  
  Es wird nur Text aus der Mail geschickt – kein großer Kontext, dadurch wenig Tokenverbrauch.
- **OpenRouter** o. Ä.: gleiches Schema, `OPENAI_BASE_URL` auf deren Base-URL setzen und passendes `LLM_MODEL` wählen.

## Setup

### 1. Node.js (LTS, Version 18+)

### 2. Abhängigkeiten

```bash
npm install
```

### 3. Konfiguration

```bash
cp .env.example .env
# Werte ausfüllen (nie committen)
```

Vertriebler-Namen (optional): `cp data/vertriebler.example.json data/vertriebler.json` und Datei bearbeiten, **oder** unter `/admin.html` speichern (nach Basic-Auth-Login am gleichen Host).

### 4. Google OAuth2

1. [Google Cloud Console](https://console.cloud.google.com) – Projekt, **Gmail API**, **Google Sheets API**, **Google Calendar API** aktivieren  
2. OAuth-Client (Desktop) → `auth/google-credentials.json`  
3. Einmaliger OAuth-Flow → `auth/google-token.json` (z. B. `node scripts/oauth-setup.js` falls vorhanden)

### 5. Google Sheet

- Tabellen-ID in `GOOGLE_SPREADSHEET_ID` (und ggf. `GOOGLE_ARCHIVE_SPREADSHEET_ID` für Archiv).
- Im **Leads**-Tab (Standard im Code: `Tabellenblatt2`) diese **Spaltenüberschriften** ergänzen, damit CRM & Kalender sauber speichern:
  - `Status` (z. B. Neu, Angerufen, Nachfassen, Termin, Verloren)
  - `Nachfass bis` (Datum)
  - `Termin` (Datum/Uhrzeit, Freitext oder `YYYY-MM-DDTHH:mm`)

### 6. IMAP

Ordner z. B. `INBOX.Leads` / `Leads` je nach Server; in `.env` `IMAP_FOLDER` setzen.

## Lokal starten

Standardport ist **3080** (weil 3000 oft schon belegt ist), über `PORT` in `.env` änderbar.

```bash
npm start
# → http://localhost:3080
```

Poller (E-Mail), zweimal täglich um 08:00 und 18:00 plus einmal beim Start:

```bash
npm run poll
```

**PM2** (empfohlen auf dem Server):

```bash
pm2 start src/server.js --name pv-lead-web
pm2 start src/poller.js --name pv-lead-poll
pm2 save
```

## Livegang: warum `pvl.lifeco.at` noch leer ist

Typisch fehlt **mindestens eines** von: DNS, Firewall, laufender Node-Prozess, Reverse-Proxy. Abhaken:

1. **DNS** beim Domain-Anbieter: Host `pvl` (oder `@` wenn Subdomain anders) als **A-Record** auf die **öffentliche IPv4** des Hetzner-Servers. Warten bis `nslookup pvl.lifeco.at` die richtige IP zeigt (oft wenige Minuten bis Stunden).
2. **Firewall** (z. B. `ufw allow 80` und `ufw allow 443` / Hetzner Cloud Firewall): Traffic zum Webserver erlauben.
3. **App auf dem Server**: Repo klonen oder deployen, `npm ci`, `.env` ausfüllen (inkl. Google `auth/`-Dateien), `PORT=3080`.
4. **Passwortschutz (HTTP Basic Auth)** in `.env` auf dem Server (nicht ins Git):  
   `BASIC_AUTH_USER=cosimo`  
   Passwort **gehasht**: `npm run hash-basic-password -- '…'` → Zeile `BASIC_AUTH_PASS_BCRYPT=…` in die `.env`, **`BASIC_AUTH_PASS` auf Produktion weglassen**.  
   Nur für lokale Tests ohne Hash: `BASIC_AUTH_USER` + `BASIC_AUTH_PASS`.  
   Ohne User+Passwort/Hash ist die App **ohne** Login erreichbar.
5. **Prozesse**: `pm2 start src/server.js --name pv-lead-web` und `pm2 start src/poller.js --name pv-lead-poll` (Poller für E-Mail), `pm2 save`.
6. **Reverse-Proxy** (Nginx/Caddy) mit `server_name pvl.lifeco.at` → `http://127.0.0.1:3080`. Erst danach ist die Domain von außen nutzbar, wenn der Node-Dienst läuft.
7. **HTTPS empfohlen**: Ohne TLS sieht jemand im Netz mit, welche Seiten du aufrufst; Basic-Auth-Passwort wäre mitlesbar. Let’s Encrypt (Certbot oder Caddy automatisch) einrichten.

**Nginx** (HTTP, Auszug – TLS später mit Certbot ergänzen):

```nginx
server {
  listen 80;
  server_name pvl.lifeco.at;
  location / {
    proxy_pass http://127.0.0.1:3080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

`/admin.html` nutzt dieselbe Basic-Auth-Session wie die Karte (`credentials: 'same-origin'`). Optional bleibt `ADMIN_TOKEN` für Spezialfälle ohne Basic Auth.

## Dashboard (Kurz)

- Karte: Leads mit Status **Termin** oder **Verloren** erscheinen nicht (keine Doppel-Anrufe). Optional: Checkbox „Abgeschlossene anzeigen“ in der Liste.
- **tel:**-Links für Android (und andere) zum Wählen.
- **Google Kalender …** öffnet die Google-„Termin anlegen“-Maske im **eingeloggten** Google-Konto (mit Adresse, Maps-Link im Text).
- Vertriebler: Chips aus `/api/vertriebler` – Pflege unter `/admin.html`.

## Projektstruktur

```
pv-lead-manager/
├── src/
│   ├── poller.js
│   ├── extractor.js   # anthropic oder openai-compatible (DeepSeek, …)
│   ├── sheets.js
│   ├── calendar.js
│   └── server.js
├── public/
│   ├── index.html
│   └── admin.html
├── data/               # vertriebler.json (lokal, gitignored)
├── auth/               # nur lokal, gitignored
├── .env.example
└── package.json
```
