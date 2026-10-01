/**
 * ARCHIV — kein Script-Tag, public/index.html lädt diese Datei nicht.
 * Vollständiger Auszug der früheren Dashboard-Funktionen (Confirm, Detail-Buttons, Fetch).
 * Freie Namen (apiFetch, showToast, allLeads, …) kamen aus dem umgebenden Dashboard-Script.
 *
 * Live verdrahtet waren maybeOfferReonicTransfer (nach Status „Termin vereinbart“
 * im Detail und im Modal „Leads ohne Kartenpunkt“) und syncReonicDetailUi.
 */

/** Nach „Termin vereinbart“: optional Reonic-Übertragung (nur bei Bestätigung). */
async function maybeOfferReonicTransfer(j, ctx) {
  if (!j || !j.reonicOfferSuggested || !j.pvlDbId) return;
  const msg = 'Kunde an Reonic übermitteln?';
  if (!window.confirm(msg)) return;
  try {
    const r = await apiFetch('/api/leads/reonic-offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbId: j.pvlDbId }),
    });
    const jr = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(jr.error || 'Reonic-Übertragung fehlgeschlagen', 'err');
      return;
    }
    showToast('Erfolgreich an Reonic übertragen', 'ok');
    const key = ctx && ctx.leadKeyStr;
    if (key) {
      const lead = allLeads.find((l) => leadKey(l) === key);
      if (lead) {
        lead.reonic_status = 'success';
        if (jr.reonicId) lead.reonic_id = String(jr.reonicId);
        lead.reonic_exported = 1;
        lead.reonic_transferred = 1;
        lead.reonic_synced = 1;
      }
    } else if (ctx && ctx.pvlDbId != null) {
      const lead = allLeads.find((l) => Number(l.pvlDbId) === Number(ctx.pvlDbId));
      if (lead) {
        lead.reonic_status = 'success';
        if (jr.reonicId) lead.reonic_id = String(jr.reonicId);
        lead.reonic_exported = 1;
        lead.reonic_transferred = 1;
        lead.reonic_synced = 1;
      }
    }
    syncReonicDetailUi();
    renderList();
    renderMarkers();
  } catch (e) {
    showToast(e.message || String(e), 'err');
  }
}

function syncReonicDetailUi(lead) {
  const rowLead = lead || (activeLeadKeyStr ? allLeads.find((l) => leadKey(l) === activeLeadKeyStr) : null);
  const wrap = document.getElementById('sd-reonic-wrap');
  const btnSend = document.getElementById('btn-reonic-send');
  const btnTest = document.getElementById('btn-reonic-test');
  const hintSent = document.getElementById('sd-reonic-sent-hint');
  const hintCfg = document.getElementById('sd-reonic-disabled-hint');
  const actions = document.getElementById('sd-reonic-actions');
  if (!wrap || !btnSend || !btnTest) return;
  const st = normalizeStatusDisplay(detailCurrentStatus);
  const session = window.__pvlSessionUser || {};
  const configured = session.reonicConfigured === true;
  const termin = st === 'Termin vereinbart';
  const readOnly = !rowLead || rowLead.__pvlLegacy || isCrmArchived(rowLead);
  if (!termin || readOnly) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  if (hintCfg) hintCfg.style.display = configured ? 'none' : 'block';
  if (actions) actions.style.display = 'flex';
  btnTest.disabled = activeIsLegacy;
  const transferred = rowLead && isLeadReonicTransferred(rowLead);
  btnSend.style.display = transferred || !configured ? 'none' : 'inline-flex';
  btnSend.disabled = !configured || activeIsLegacy || transferred;
  if (!configured) {
    if (hintSent) hintSent.style.display = 'none';
    return;
  }
  if (hintSent) {
    if (transferred) {
      hintSent.style.display = 'block';
      const rid = rowLead && String(rowLead.reonic_id || '').trim();
      hintSent.textContent = rid
        ? 'Bereits an Reonic übermittelt (ID: ' + rid.slice(0, 80) + ').'
        : 'Bereits an Reonic übermittelt.';
    } else {
      hintSent.style.display = 'none';
      hintSent.textContent = '';
    }
  }
}

async function sendReonicFromDetail() {
  if (activeIsLegacy) {
    showToast('Legacy-Lead: Reonic nicht verfügbar.', 'info');
    return;
  }
  const rowLead = allLeads.find((l) => leadKey(l) === activeLeadKeyStr);
  if (!rowLead || isCrmArchived(rowLead)) return;
  if (!rowLead.pvlDbId) {
    showToast('Keine Datenbank-ID für diesen Lead.', 'err');
    return;
  }
  if (isLeadReonicTransferred(rowLead)) return;
  try {
    const r = await apiFetch('/api/leads/reonic-offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbId: rowLead.pvlDbId }),
    });
    const jr = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(jr.error || 'Reonic-Übertragung fehlgeschlagen', 'err');
      return;
    }
    showToast('Erfolgreich an Reonic übertragen', 'ok');
    rowLead.reonic_status = 'success';
    if (jr.reonicId) rowLead.reonic_id = String(jr.reonicId);
    rowLead.reonic_exported = 1;
    rowLead.reonic_transferred = 1;
    rowLead.reonic_synced = 1;
    syncReonicDetailUi(rowLead);
    renderList();
    renderMarkers();
    await refreshDashboardStatsBar();
  } catch (e) {
    showToast(e.message || String(e), 'err');
  }
}

async function testReonicConnectionFromUi() {
  try {
    const r = await apiFetch('/api/reonic/test', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(j.error || 'Reonic-Test fehlgeschlagen', 'err');
      return;
    }
    showToast(j.message || 'Verbindung OK', 'ok');
  } catch (e) {
    showToast(e.message || String(e), 'err');
  }
}
