# PV Lead Manager

Pipeline: IMAP → KI-Extraktion → **SQLite** (`data/leads.db`) → Web-Dashboard (Leaflet-Karte, CRM-Felder, „Betreut durch“ aus Benutzernamen, Status). Ausgehende Mails (Zugangsdaten, Kundenbestätigung) per **SMTP**.

## DNS ist da (z. B. wie beim Roof Identifier) – warum geht `pvl` trotzdem nicht?

**DNS** sagt nur: dieser Name → diese IP. **Roof Identifier** funktioniert, weil auf dem Server **etwas lauscht** (z. B. Nginx auf Port 80) und für **diese** Domain/Location auf den passenden Dienst zeigt.

Für **PV Lead Manager** brauchst du **denselben Server**, aber **eine eigene Kette**:

1. **Node** muss laufen und auf dem gewählten Port lauschen (Standard **3080**), z. B. `pm2 start src/server.js`.
2. **Nginx** (oder Caddy) braucht einen **eigenen** `server`-Block für `pvl.lifeco.at` mit `proxy_pass http://127.0.0.1:3080` – der Block vom Roof Identifier reicht nicht automatisch; ohne ihn antwortet auf `pvl` oft nichts Sinnvolles oder der Default-Server.

**Localhost** meint immer den **Rechner, auf dem der Browser bzw. der Befehl läuft**:

- Auf deinem **Entwicklungs-PC**: `npm start` im Projekt → `http://localhost:3080` (nur wenn Node dort läuft).
- Die **Installation auf Hetzner** erreichst du von deinem PC mit `**http://pvl.lifeco.at`** (besser HTTPS) – **nicht** mit `localhost` auf dem Laptop (das wäre dein eigener PC, nicht der Server).

## `.env` und Passwort – „verschlüsselt“?

- Die `**.env` auf dem Server** sollte nur für den Deploy-User lesbar sein (`chmod 600 .env`, Besitzer z. B. der PM2-User). **Normale Website-Besucher** können sie **nicht** auslesen; sie liegt nicht im Webroot.
- **Benutzer-Passwörter** (Vertriebler-Logins) werden in `data/users.json` als **bcrypt-Hash** gespeichert — nicht in der `.env`.

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

### 3b. Benutzer-Logins (Session über `/login.html`)

1. In `.env` `**SESSION_SECRET**` setzen (mind. 16 zufällige Zeichen, empfohlen: länger). Fehlt der Wert, generiert der Server beim Start ein **temporäres** Secret (Warnung im Log — nach jedem Neustart sind alle Sessions ungültig). Optional `**SESSION_COOKIE_SECURE=1**` hinter HTTPS.
2. `**APP_BASE_URL**` z. B. `https://pvl.lifeco.at` (für Links in Einladungs-Mails).
3. **Ersten Admin** anlegen:
  - **A)** Einmalig `SETUP_TOKEN` in `.env`, dann auf `/login.html` unten „Erstes Admin-Konto“ ausfüllen, **oder**
  - **B)** Auf dem Server: `npm run create-admin -- <user> <passwort> [email]`
4. Weitere Nutzer: als Admin einloggen → `**/admin.html`**. Optional **E-Mail senden**: **SMTP** (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, optional `MAIL_FROM`).
5. Für Admin-API ohne Browser-Session optional `**ADMIN_TOKEN**` (Bearer) in der `.env`.

Benutzerdatei: `data/users.json` (nicht im Git). Vorlage: `data/users.example.json`.

### 4. Leads-Datenbank (SQLite)

- Datei: `**data/leads.db`** (anlegbar per erstem Serverstart oder Import). Optional `**SQLITE_LEADS_DB**` in der `.env` für einen absoluten Pfad.
- **Schema** entspricht der Export-CSV (Spalten u. a. `anfrage`, `namen`, `telefon`, `email`, …, `col_14` für eine leere Kopfspalte) plus CRM-Felder `status`, `nachfass_bis`, `termin` und `archived_at` für Archivieren in der App.
- **CSV-Import** (Duplikate nach `anfrage` werden ignoriert):
  ```bash
  npm run import-leads-csv -- "pfad/zur/datei.csv"
  ```
  Optional `--dry-run` nur prüfen. Umgebungsvariable **`LEADS_CSV_PATH`** statt Argument möglich.
- Diagnose: `**/api/debug/leads-sheet`** (Name aus Kompatibilität) liefert u. a. `backend: sqlite`, `dbPath`, Zeilenanzahlen.

### 5. IMAP (nur **Empfang** für den Poller)

Ordner z. B. `INBOX.Leads` / `Leads` je nach Server; in `.env` `IMAP_FOLDER` setzen. **Ausgehende** Mails gehen über **SMTP** (siehe `.env.example`).

## Deploy (GitHub → Server, live)

Von hier aus gibt es **keinen direkten Zugriff** auf `pvl.lifeco.at` — du führst die Schritte per **SSH auf dem Server** aus.

1. **Code:** Lokal committen/pushen (`git push origin master` o. Ä.).
2. **Server (SSH):** ins Projektverzeichnis, dann
  `chmod +x scripts/on-server-update.sh && ./scripts/on-server-update.sh`  
   Das Skript macht `git pull`, `npm ci`, `**pm2 restart`** für `pv-lead-manager` (oder älter `pvl-manager`) und `**pv-lead-poll**`, sonst `**pm2 start ecosystem.config.cjs**` (liegt im Repo-Root).
3. `**.env` auf dem Server:** u. a. `**APP_BASE_URL=https://pvl.lifeco.at`**, bei HTTPS `**SESSION_COOKIE_SECURE=1**`, `SESSION_SECRET`, SMTP/IMAP, optional `SQLITE_LEADS_DB`.
4. **Nginx:** `server_name pvl.lifeco.at` → `proxy_pass http://127.0.0.1:3080` (Port wie `PORT` in `.env`, Standard **3080**), danach `**sudo nginx -t && sudo systemctl reload nginx`**.
5. **HTTPS:** z. B. Certbot für `pvl.lifeco.at` — erst dann Login/Session sinnvoll mit `SESSION_COOKIE_SECURE=1`.
6. **Smoke-Test:** `https://pvl.lifeco.at` öffnen, Login, Karte; optional `curl -I https://pvl.lifeco.at/api/stats` (mit Session-Cookie).

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
3. **App auf dem Server**: Repo klonen oder deployen, `npm ci`, `.env` ausfüllen, Leads per `**npm run import-leads-csv`** einspielen, `PORT=3080`.
4. **Zugang:** Die App ist **nur mit Session-Login** (`/login.html`) erreichbar — `SESSION_SECRET` und Benutzer anlegen (siehe Abschnitt 3b).
5. **Prozesse**: `pm2 start src/server.js --name pv-lead-web` und `pm2 start src/poller.js --name pv-lead-poll` (Poller für E-Mail), `pm2 save`.
6. **Reverse-Proxy** (Nginx/Caddy) mit `server_name pvl.lifeco.at` → `http://127.0.0.1:3080`. Erst danach ist die Domain von außen nutzbar, wenn der Node-Dienst läuft.
7. **HTTPS empfohlen**: Ohne TLS sind Session-Cookies und Logins mitlesbar. Let’s Encrypt (Certbot oder Caddy automatisch) einrichten.

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

`/admin.html` nutzt dieselbe **Session** wie das Dashboard (`credentials: 'include'`). Optional: `ADMIN_TOKEN` (Bearer) für Admin-API ohne Browser.

## Dashboard (Kurz)

- Karte: Leads mit Status **Termin** oder **Verloren** erscheinen nicht (keine Doppel-Anrufe). Optional: Checkbox „Abgeschlossene anzeigen“ in der Liste.
- **Warn-Badge** (gelb): Leads ohne gültigen Kartenpunkt (Koordinaten NULL oder 0) — Klick öffnet die Verwaltungsliste mit Adresse korrigieren, **Geocoding**, **tel:** und Status/Archiv.
- **CSV Export** (Header-Link): `GET /api/export/leads.csv` — alle Zeilen inkl. Archiv (`leads_export.csv`).
- **tel:**-Links in Liste, Popup und Detailansicht.
- **Google Kalender …** (Button): sofortiger Google-Link (Standardslot), ohne Pflicht auf Terminfelder.
- „Betreut durch“-Chips: `**/api/vertriebler`** (= Benutzer-Logins), Pflege unter `**/admin.html**`.

## Deploy-Routine (Server)

1. **CSV vs. SQLite:** `npm run compare-csv-sqlite -- "pfad/leads.csv"` — vergleicht nicht-leere CSV-Zeilen mit der Zeilenanzahl in `leads` (Hinweis im Log).
2. **Re-Geocoding:** `npm run geocode-leads-db` — Nominatim-Kaskade (AT, 1,5 s Pause) für aktive Leads ohne Koordinaten. Archivierte mit einbeziehen: `node scripts/geocode-leads-db.js --include-archived`
  Zielkorrektur nur fehlende Punkte (Nominatim, ohne städtischen Fallback): `**npm run fix-missing-coords`** (`scripts/fix-missing-coords.js`, optional `--dry-run` / `--include-archived`). Alte Stephansplatz-Fallback-Zeilen: `**npm run clear-wien-fallback-geocoords**` (optional `--dry-run`).
3. **SQL-Schnellcheck (latitude):** `sqlite3 data/leads.db "SELECT COUNT(*) FROM leads WHERE latitude IS NULL OR latitude = 0;"` — Ziel **0** (Hinweis: die App prüft zusätzlich **longitude**).
4. **Checks:** `npm run deploy-check`
5. **Neustart:** `pm2 restart pvl-manager --update-env`

## Projektstruktur

```
pv-lead-manager/
├── src/
│   ├── poller.js
│   ├── extractor.js   # anthropic oder openai-compatible (DeepSeek, …)
│   ├── database.js     # SQLite data/leads.db
│   ├── sheets.js     # Leads aus SQLite (API wie zuvor)
│   ├── calendar.js   # nur noch Mail-Hinweis nach neuem Lead (SMTP)
│   └── server.js
├── ecosystem.config.cjs   # PM2: pv-lead-manager + pv-lead-poll
├── scripts/
│   ├── import-csv.js
│   ├── geocode-leads-db.js
│   ├── fix-missing-coords.js
│   ├── compare-csv-sqlite.js
│   └── on-server-update.sh
├── public/
│   ├── index.html
│   └── admin.html
├── data/               # users.json, leads.db, sessions/ (lokal, gitignored)
├── .env.example
└── package.json
```

