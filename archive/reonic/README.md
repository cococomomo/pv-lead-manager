# Reonic-Übertragung (archiviert)

Dieser Ordner ist nicht Teil des laufenden Servers. `src/server.js`, `src/sheets.js` und `public/index.html` importieren ihn nicht.

Enthalten ist die frühere Übertragung eines Leads als Reonic-Angebot (REST v2) plus der Verbindungstest:

- `reonic.js` — früher `src/integrations/reonic.js`
- `reonic-sync.js` — früher `src/reonic-sync.js` (`transferLeadToReonicById`)
- `offer-suggestion.js` — früher `reonicOfferSuggestionPayload` in `src/sheets.js` (setzte `reonicOfferSuggested` nach Status „Termin vereinbart“)
- `dashboard-prompts.js` — aus `public/index.html` entnommene Dialog-, Button- und Fetch-Funktionen

Abgeschaltet und nicht mehr registriert:

- Bestätigungsdialog `Kunde an Reonic übermitteln?` nach Status „Termin vereinbart“ (Detail und „Leads ohne Kartenpunkt“)
- Buttons `An Reonic senden` und `Verbindung testen` im Lead-Detail
- `POST /api/leads/reonic-offer`
- `POST /api/reonic/test`
- Session-Feld `reonicConfigured`

Die Spalten `reonic_synced`, `reonic_transferred`, `reonic_exported`, `reonic_status` und `reonic_id` bleiben im Schema und in der API. Das Listen-Häkchen „An Reonic übermittelt“ liest nur diese bestehenden Werte und startet keine Übertragung.
