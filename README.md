# PV Lead Manager

Pipeline: IMAP → KI-Extraktion → Google Sheets → optional Google Kalender + Mailbestätigung → Web-Dashboard (Leaflet-Karte, CRM-Felder, Vertriebler per Klick, Status, Google-Kalender-Link).

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

Vertriebler-Namen (optional): `cp data/vertriebler.example.json data/vertriebler.json` und Datei bearbeiten, **oder** später unter `/admin.html` mit `ADMIN_TOKEN` speichern.

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

## Hetzner / Domain (z. B. pvl.lifeco.at)

1. DNS **A-Record** `pvl` → Server-IPv4 (oder AAAA für IPv6).  
2. Auf dem Server einen Reverse-Proxy mit TLS (z. B. **Caddy** oder **Nginx** + Let’s Encrypt).  
3. Proxy auf `http://127.0.0.1:3080` (oder den gewählten `PORT`).

**Nginx** (Auszug):

```nginx
server {
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

`/admin.html` ist nur durch Geheimnis geschützt, wenn du `ADMIN_TOKEN` setzt – zusätzlich Zugriff per Firewall / VPN empfehlenswert.

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
