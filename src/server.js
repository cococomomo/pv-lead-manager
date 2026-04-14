'use strict';

require('./load-env');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const { generateCalendarLink } = require('./calendar-links');
const {
  getAllLeads,
  updateLeadField,
  updateLeadFieldsBulk,
  archiveLead,
  restoreArchivedLead,
  getLeadsSheetDebug,
  setLeadStatus,
  getLeadByEmail,
  setLeadAssignedToUserId,
  countLeadsMissingMapCoords,
  getLeadsMissingMapCoordsList,
  updateLeadStreetPlzOrtById,
  updateLeadAddressAndGeocodeById,
  setLeadStatusByDbId,
  buildLeadsExportCsv,
  regeocodeLeadByEmail,
} = require('./sheets');
const {
  verifyLogin,
  readUsers,
  createUser,
  updateUserAdminFields,
  deleteUser,
  userCount,
  resetUserPassword,
  getUserPublic,
  getUserRole,
  listUsersAdminDetail,
  updateCalendarPreference,
} = require('./users');
const { sendLoginCredentialsEmail, sendNoortecWelcomeOnboardingEmail } = require('./mail-welcome');
const { getDb } = require('./database');
const { sendAppointmentConfirmationEmail, buildLeadAddressLine, formatTerminDe, looksLikeEmail } = require('./mail-appointment-confirm');
const { canSendMail, verifySmtpInline, verifySavedUserSmtp } = require('./mail-transport');
const { resolveBetreuerContact } = require('./sales-contact');
const { upsertProfile, ensureSqliteUserStub } = require('./user-profile');
const { getDashboardStats } = require('./stats');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3080;
const DATA_DIR = path.join(__dirname, '../data');
app.set('trust proxy', 1);

const SESSION_SECRET = process.env.SESSION_SECRET;
const sessionOn = !!(SESSION_SECRET && String(SESSION_SECRET).length >= 16);

if (sessionOn) {
  app.use(session({
    store: new FileStore({
      path: path.join(DATA_DIR, 'sessions'),
      ttl: 86400 * 14,
      retries: 0,
      logFn: () => {},
    }),
    name: 'pvl.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.SESSION_COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  }));
}

function safeEqStr(expected, received) {
  try {
    const a = Buffer.from(String(expected), 'utf8');
    const b = Buffer.from(String(received), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function parseBasicAuth(header) {
  if (!header || !header.startsWith('Basic ')) return null;
  try {
    const raw = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = raw.indexOf(':');
    if (i < 0) return null;
    return { user: raw.slice(0, i), pass: raw.slice(i + 1) };
  } catch {
    return null;
  }
}

function basicAuthConfigured() {
  const u = process.env.BASIC_AUTH_USER;
  const plain = process.env.BASIC_AUTH_PASS;
  const hashed = (process.env.BASIC_AUTH_PASS_BCRYPT || '').trim();
  return !!(u && (plain || hashed));
}

function verifyBasicCreds(creds) {
  if (!creds) return false;
  const u = process.env.BASIC_AUTH_USER;
  if (!u || !safeEqStr(u, creds.user)) return false;
  const hash = (process.env.BASIC_AUTH_PASS_BCRYPT || '').trim();
  if (hash) {
    try {
      return bcrypt.compareSync(creds.pass, hash);
    } catch {
      return false;
    }
  }
  const plain = process.env.BASIC_AUTH_PASS;
  if (plain) return safeEqStr(plain, creds.pass);
  return false;
}

function formatLeadsApiError(err) {
  return (err && err.message) ? String(err.message) : String(err);
}

/** Query-Parameter `includeArchived` robust auswerten (String, Array, Großschreibung). */
function parseIncludeArchivedFlag(req) {
  const raw = req.query && req.query.includeArchived;
  const parts = Array.isArray(raw) ? raw : [raw];
  for (const p of parts) {
    const s = String(p == null ? '' : p).trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  }
  return false;
}

function basicAuthMiddleware(req, res, next) {
  if (sessionOn) return next();
  if (!basicAuthConfigured()) return next();
  const creds = parseBasicAuth(req.headers.authorization);
  if (!verifyBasicCreds(creds)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="NOORTEC Vertriebs-Dashboard"');
    return res.status(401).send('Authentifizierung erforderlich');
  }
  next();
}

function allowAdmin(req) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return true;
  const token = process.env.ADMIN_TOKEN;
  if (token && req.headers.authorization === `Bearer ${token}`) return true;
  if (!sessionOn && basicAuthConfigured()) {
    const creds = parseBasicAuth(req.headers.authorization);
    if (verifyBasicCreds(creds)) return true;
  }
  return false;
}

/** Setter oder Admin: Lead einem Vertriebler (sales) zuweisen. */
function allowSalesAssign(req) {
  if (!sessionOn || !req.session?.user) return false;
  if (req.session.user.role === 'setter' || req.session.user.role === 'admin') return true;
  return false;
}

/** Termin-Mail / Kalender: bei zugewiesenem Vertriebler dessen Login nutzen, sonst Session-User. */
async function resolveActingSalesUsername(lead, sessionUsername) {
  const raw = lead && lead.assigned_to_user_id;
  const id = raw == null || raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(id) || id < 1) return String(sessionUsername || '').trim();
  const db = getDb();
  const urow = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  if (!urow || !urow.username) return String(sessionUsername || '').trim();
  const role = await getUserRole(String(urow.username).trim());
  if (role === 'sales' || role === 'admin') return String(urow.username).trim();
  return String(sessionUsername || '').trim();
}

function requireApiSession(req, res, next) {
  if (!sessionOn) return next();
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'login_required' });
}

function requireWebSession(req, res, next) {
  if (!sessionOn) return next();
  if (req.session && req.session.user) return next();
  const q = req.originalUrl && req.originalUrl !== '/' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
  return res.redirect(302, `/login.html${q}`);
}

app.use(basicAuthMiddleware);
app.use(express.json({ limit: '128kb' }));

app.get('/profil.html', (req, res) => {
  res.redirect(302, req.originalUrl.replace(/\/profil\.html/i, '/profile'));
});

app.get('/profile.html', (req, res) => {
  const i = req.originalUrl.indexOf('?');
  const q = i >= 0 ? req.originalUrl.slice(i) : '';
  res.redirect(302, `/profile${q}`);
});

// ── Auth (öffentlich wenn Session aktiv) ───────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  if (!sessionOn) {
    return res.status(503).json({ error: 'SESSION_SECRET nicht gesetzt (mind. 16 Zeichen)' });
  }
  const { username, password } = req.body || {};
  const user = await verifyLogin(username, password);
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });
  req.session.user = { username: user.username, role: user.role };
  try {
    const full = await getUserPublic(user.username);
    res.json({ ok: true, user: full || { username: user.username, role: user.role, calendarPreference: user.calendarPreference || 'google', profileComplete: false } });
  } catch (e) {
    res.json({
      ok: true,
      user: {
        username: user.username,
        role: user.role,
        calendarPreference: user.calendarPreference || 'google',
        profileComplete: false,
      },
    });
  }
});

app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) console.error('session destroy:', err.message);
      res.json({ ok: true });
    });
  } else {
    res.json({ ok: true });
  }
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session || !req.session.user) return res.json({ user: null });
  try {
    const user = await getUserPublic(req.session.user.username);
    res.json({ user: user || { username: req.session.user.username, role: req.session.user.role, calendarPreference: 'google' } });
  } catch (err) {
    console.error('GET /api/auth/me error:', err.message);
    res.status(500).json({ user: null, error: err.message });
  }
});

app.patch('/api/auth/profile', async (req, res) => {
  if (!sessionOn || !req.session?.user) return res.status(401).json({ error: 'login_required' });
  const { calendarPreference } = req.body || {};
  if (calendarPreference === undefined) {
    return res.status(400).json({ error: 'calendarPreference erforderlich (google|outlook|apple)' });
  }
  try {
    await updateCalendarPreference(req.session.user.username, calendarPreference);
    const user = await getUserPublic(req.session.user.username);
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/auth/contact-profile', async (req, res) => {
  if (!sessionOn || !req.session?.user) return res.status(401).json({ error: 'login_required' });
  const b = req.body || {};
  try {
    upsertProfile(req.session.user.username, {
      voller_name: b.voller_name,
      telefon: b.telefon,
      email_kontakt: b.email_kontakt,
      smtp_host: b.smtp_host,
      smtp_port: b.smtp_port,
      smtp_user: b.smtp_user,
      smtp_pass: b.smtp_pass,
    });
    const user = await getUserPublic(req.session.user.username);
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/smtp-test', async (req, res) => {
  if (!sessionOn || !req.session?.user) return res.status(401).json({ error: 'login_required' });
  const body = req.body || {};
  try {
    if (body.useSaved) {
      await verifySavedUserSmtp(req.session.user.username);
    } else {
      await verifySmtpInline({
        host: body.smtp_host,
        port: body.smtp_port || 587,
        user: body.smtp_user,
        pass: body.smtp_pass,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

// Geschützte API + HTML (Session ODER nur Basic ohne Session)
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    if (req.path === '/api/auth/login' && req.method === 'POST') return next();
    if (req.path === '/api/auth/logout' && req.method === 'POST') return next();
    if (req.path === '/api/auth/bootstrap-admin' && req.method === 'POST') return next();
    if (req.path === '/api/auth/reset-password' && req.method === 'POST') return next();
    if (req.path === '/api/auth/me') return next();
    if (!sessionOn) return next();
    return requireApiSession(req, res, next);
  }
  if (req.path === '/login.html' || req.path === '/login') return next();
  if (!sessionOn) return next();
  return requireWebSession(req, res, next);
});

app.get('/api/leads', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    const includeArchived = parseIncludeArchivedFlag(req);
    const leads = await getAllLeads({ includeArchived });
    if (leads.length === 0) {
      try {
        const dbg = await getLeadsSheetDebug();
        if ((dbg.totalRowCount || 0) > 0) {
          console.warn('GET /api/leads: leere Antwort obwohl SQLite Zeilen hat', {
            includeArchived,
            totalRowCount: dbg.totalRowCount,
            activeRowCount: dbg.activeRowCount,
            archivedRowCount: dbg.archivedRowCount,
            dbPath: dbg.dbPath,
          });
        }
      } catch (_) { /* ignore */ }
    }
    res.json(leads);
  } catch (err) {
    console.error('GET /api/leads error:', err.message);
    res.status(500).json({ error: formatLeadsApiError(err) });
  }
});

/** NOORTEC: IMAP → SQLite, einmal pro Aufruf (nur mit Session-Login). */
app.post('/api/sync-leads', async (req, res) => {
  if (!sessionOn || !req.session?.user) {
    return res.status(401).json({ error: 'login_required' });
  }
  try {
    const { pollEmails } = require('./poller');
    const { importedCount } = await pollEmails();
    res.json({ success: true, count: importedCount });
  } catch (err) {
    console.error('POST /api/sync-leads:', err && err.message ? err.message : err);
    res.status(500).json({
      success: false,
      count: 0,
      error: (err && err.message) ? String(err.message) : String(err),
    });
  }
});

app.get('/api/leads/missing-coords/count', (req, res) => {
  try {
    res.json({ count: countLeadsMissingMapCoords() });
  } catch (err) {
    console.error('GET missing-coords count:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leads/missing-coords', (req, res) => {
  try {
    res.json(getLeadsMissingMapCoordsList());
  } catch (err) {
    console.error('GET missing-coords:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Adresse korrigieren + sofort Geocoding (Nominatim-Kaskade AT). */
app.post('/api/lead-rows/:id/address-geocode', async (req, res) => {
  const { strasse, plz, ort } = req.body || {};
  try {
    await updateLeadStreetPlzOrtById(req.params.id, strasse, plz, ort);
    const out = await updateLeadAddressAndGeocodeById(req.params.id);
    res.json(out);
  } catch (err) {
    console.error('POST address-geocode:', err.message);
    res.status(400).json({ error: err.message || String(err) });
  }
});

/** Status oder Archivieren per SQLite-Zeilen-ID (ohne E-Mail). */
app.post('/api/lead-rows/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status erforderlich' });
  try {
    const result = await setLeadStatusByDbId(req.params.id, status);
    res.json(result);
  } catch (err) {
    console.error('POST lead-rows status:', err.message);
    res.status(400).json({ error: err.message || String(err) });
  }
});

app.get('/api/export/leads.csv', (req, res) => {
  try {
    const csv = buildLeadsExportCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads_export.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('GET export leads.csv:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    res.json(getDashboardStats());
  } catch (err) {
    console.error('GET /api/stats error:', err.message);
    res.status(500).json({ error: err.message || String(err) });
  }
});

async function sendLeadsStorageDebug(req, res) {
  try {
    const dbg = await getLeadsSheetDebug();
    const leads = await getAllLeads({ includeArchived: true });
    res.json({ ...dbg, leadRowCount: leads.length });
  } catch (err) {
    console.error('GET leads storage debug error:', err.message);
    let dbg = {};
    try {
      dbg = await getLeadsSheetDebug();
    } catch (_) { /* ignore */ }
    res.status(500).json({ ...dbg, error: formatLeadsApiError(err) });
  }
}

/** Diagnose: SQLite `leads` (Pfad, Zeilen). */
app.get('/api/debug/leads-db', sendLeadsStorageDebug);
/** @deprecated Name — identisch zu `/api/debug/leads-db`. */
app.get('/api/debug/leads-sheet', sendLeadsStorageDebug);

app.patch('/api/leads/:email/field', async (req, res) => {
  const { column, value } = req.body;
  if (!column) return res.status(400).json({ error: 'column is required' });
  try {
    const extra = await updateLeadField(decodeURIComponent(req.params.email), column, value ?? '');
    res.json({ ok: true, ...(extra && typeof extra === 'object' ? extra : {}) });
  } catch (err) {
    console.error('PATCH field error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Mehrere Felder (Kontakt & Adresse) in einem Request; `email` ist die aktuelle Lead-E-Mail zum Auffinden der Zeile. */
app.post('/api/leads/update', async (req, res) => {
  const { email, updates } = req.body || {};
  if (!email || typeof updates !== 'object' || updates == null) {
    return res.status(400).json({ error: 'email und updates (Objekt) erforderlich' });
  }
  try {
    const extra = await updateLeadFieldsBulk(String(email).trim(), updates);
    res.json({ ok: true, ...(extra && typeof extra === 'object' ? extra : {}) });
  } catch (err) {
    console.error('POST /api/leads/update error:', err.message);
    res.status(400).json({ error: err.message || String(err) });
  }
});

app.post('/api/leads/:email/status', async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status is required' });
  try {
    const result = await setLeadStatus(decodeURIComponent(req.params.email), status);
    res.json(result);
  } catch (err) {
    console.error('POST status error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/leads/:email/regeocode', async (req, res) => {
  try {
    const out = await regeocodeLeadByEmail(decodeURIComponent(req.params.email));
    res.json(out);
  } catch (err) {
    console.error('POST regeocode:', err.message);
    res.status(400).json({ error: err.message || String(err) });
  }
});

app.post('/api/calendar/build', async (req, res) => {
  try {
    const { email, start, end, terminTyp, meetLink } = req.body || {};
    if (!email || !start) return res.status(400).json({ error: 'email und start erforderlich' });
    const lead = await getLeadByEmail(String(email));
    if (!lead) return res.status(404).json({ error: 'Lead nicht gefunden' });
    const startD = new Date(start);
    const endD = end ? new Date(end) : new Date(startD.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(startD.getTime()) || Number.isNaN(endD.getTime())) {
      return res.status(400).json({ error: 'Ungültiges Datum' });
    }
    let partnerName = process.env.MY_NAME || 'Vertrieb';
    const actingCal = await resolveActingSalesUsername(lead, req.session?.user?.username || '');
    try {
      const pubA = actingCal ? await getUserPublic(actingCal) : null;
      if (pubA) {
        partnerName = String(pubA.voller_name || '').trim() || pubA.username || partnerName;
      }
    } catch (_) { /* ignore */ }
    const leadForCal = { ...lead };
    if (meetLink != null) leadForCal['Meet-Link'] = String(meetLink || '').trim();
    const assignedContact = await resolveBetreuerContact(lead['Betreut Durch'] || lead.betreuer || '');
    const payload = generateCalendarLink(leadForCal, partnerName, startD, endD, {
      terminTyp,
      assignedContact,
    });
    res.json({
      googleUrl: payload.googleUrl,
      outlookUrl: payload.outlookUrl,
      icsContent: payload.icsContent,
      icsFilename: payload.icsFilename,
    });
  } catch (err) {
    console.error('POST /api/calendar/build error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leads/:email/notify-appointment', async (req, res) => {
  if (!sessionOn || !req.session?.user) return res.status(401).json({ error: 'login_required' });
  try {
    const lead = await getLeadByEmail(decodeURIComponent(req.params.email));
    if (!lead) return res.status(404).json({ error: 'Lead nicht gefunden' });
    const actingUn = await resolveActingSalesUsername(lead, req.session.user.username);
    const pub = await getUserPublic(actingUn);
    if (!pub || !pub.profileComplete) {
      return res.status(400).json({
        error: 'Profil unvollständig: zugewiesener Vertriebler (oder Sie) braucht Name, Telefon und Kontakt-E-Mail unter /profile.',
      });
    }
    const to = String(lead['E-Mail'] || '').trim();
    if (!looksLikeEmail(to)) return res.status(400).json({ error: 'Lead ohne gültige E-Mail' });
    if (!canSendMail(actingUn)) {
      return res.status(503).json({ error: 'Kein Versand möglich: SMTP des zugewiesenen Vertrieblers oder zentraler SMTP in der .env (NOORTEC).' });
    }
    const body = req.body || {};
    const terminRaw = String(body.termin != null ? body.termin : lead.Termin || '').trim();
    if (!terminRaw) return res.status(400).json({ error: 'Bitte zuerst Termin (Datum & Uhrzeit) setzen.' });
    const terminTypRaw = body.terminTyp != null ? body.terminTyp : (lead.Termintyp || lead.termin_typ || 'vor_ort');
    const terminTyp = String(terminTypRaw).toLowerCase() === 'online' ? 'online' : 'vor_ort';
    const meetUrl = String(body.meetUrl != null ? body.meetUrl : (lead['Meet-Link'] || '')).trim();
    const { dateStr, timeStr } = formatTerminDe(terminRaw);
    const kunde = String(lead['Nachname + Vorname'] || '').trim() || to.split('@')[0];
    const addressLine = buildLeadAddressLine(lead);
    const sigFooter = String(process.env.EMAIL_SIGNATURE || '').trim();
    await sendAppointmentConfirmationEmail({
      to,
      customerName: kunde,
      terminTyp,
      dateStr,
      timeStr,
      userName: String(pub.voller_name || pub.username || '').trim(),
      userTel: String(pub.telefon || '').trim(),
      userEmail: String(pub.email_kontakt || '').trim(),
      addressLine,
      meetUrl: terminTyp === 'online' ? meetUrl : '',
      smtpUsername: actingUn,
      footerLine: sigFooter || undefined,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST notify-appointment:', err.message);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/leads/:email/archive', async (req, res) => {
  try {
    await archiveLead(decodeURIComponent(req.params.email));
    res.json({ ok: true });
  } catch (err) {
    console.error('POST archive error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leads/:email/restore', async (req, res) => {
  try {
    const out = await restoreArchivedLead(decodeURIComponent(req.params.email));
    if (!out.ok) return res.status(404).json({ error: 'Archivierter Lead nicht gefunden' });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST restore error:', err.message);
    res.status(400).json({ error: err.message || String(err) });
  }
});

/** Namen für „Betreut durch“-Chips: Login-Namen von Vertrieb & Admin (ohne Setter), sortiert */
async function readBetreutChipNames() {
  try {
    const users = await readUsers();
    const names = [...new Set(
      users
        .filter((u) => {
          const r = String(u.role || 'sales').toLowerCase();
          return r === 'sales' || r === 'admin';
        })
        .map((u) => String(u.username || '').trim())
        .filter(Boolean),
    )];
    names.sort((a, b) => a.localeCompare(b, 'de'));
    return names;
  } catch {
    return [];
  }
}

app.get('/api/vertriebler', async (req, res) => {
  try {
    res.json(await readBetreutChipNames());
  } catch (err) {
    console.error('GET /api/vertriebler error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Setter: Quick-Chips — nur `sales`, mit SQLite-`users.id` für Zuweisung. */
app.get('/api/sales-assignees', async (req, res) => {
  if (!sessionOn || !req.session?.user) return res.status(401).json({ error: 'login_required' });
  try {
    const db = getDb();
    const users = await readUsers();
    const out = [];
    for (const u of users) {
      if (String(u.role || 'sales').toLowerCase() !== 'sales') continue;
      const un = String(u.username || '').trim();
      if (!un) continue;
      ensureSqliteUserStub(un);
      const row = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(un);
      if (row && row.id != null) out.push({ id: Number(row.id), username: un });
    }
    out.sort((a, b) => a.username.localeCompare(b.username, 'de'));
    res.json(out);
  } catch (err) {
    console.error('GET /api/sales-assignees:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leads/:email/assign-sales', async (req, res) => {
  if (!allowSalesAssign(req)) return res.status(403).json({ error: 'Forbidden' });
  const body = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(body, 'assignedToUserId')) {
    return res.status(400).json({ error: 'assignedToUserId erforderlich (Zahl oder null)' });
  }
  try {
    const out = await setLeadAssignedToUserId(
      decodeURIComponent(req.params.email),
      body.assignedToUserId,
    );
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/users', async (req, res) => {
  if (!allowAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ users: await listUsersAdminDetail() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users', async (req, res) => {
  if (!allowAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const b = req.body || {};
  const {
    username, password, email, role, voller_name, telefon, email_kontakt, sendWelcomeEmail,
  } = b;
  const skipMail = sendWelcomeEmail === false;
  try {
    await createUser({
      username,
      password,
      email,
      role,
      voller_name,
      telefon,
      email_kontakt,
    });
    const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
    const toMail = String(email_kontakt || email || '').trim();
    if (!skipMail && toMail) {
      try {
        await sendNoortecWelcomeOnboardingEmail({
          toEmail: toMail,
          appUrl: base || 'https://pvl.lifeco.at',
          loginUrl: `${base}/login.html`,
          username,
          passwordPlain: password,
        });
      } catch (e) {
        console.error('Welcome mail failed:', e.message);
        return res.status(201).json({
          ok: true,
          warning: `Benutzer angelegt, Willkommens-E-Mail fehlgeschlagen: ${e.message}`,
        });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/users', async (req, res) => {
  if (!allowAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const b = req.body || {};
  const { username, email, role, voller_name, telefon, email_kontakt } = b;
  if (!username) return res.status(400).json({ error: 'username erforderlich' });
  try {
    await updateUserAdminFields(username, { email, role, voller_name, telefon, email_kontakt });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/users/reset-password', async (req, res) => {
  if (!allowAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { username, newPassword } = req.body || {};
  try {
    await resetUserPassword(username, newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/users/delete', async (req, res) => {
  if (!allowAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { username } = req.body || {};
  const actor = req.session?.user?.username || 'token';
  try {
    await deleteUser(username, actor);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/bootstrap-admin', async (req, res) => {
  if (!sessionOn) return res.status(503).json({ error: 'SESSION_SECRET fehlt' });
  const n = await userCount();
  if (n > 0) return res.status(403).json({ error: 'Bereits Benutzer vorhanden' });
  const { username, password, email, setupToken } = req.body || {};
  if (!setupToken || setupToken !== process.env.SETUP_TOKEN) {
    return res.status(403).json({ error: 'Ungültiges Setup-Token' });
  }
  try {
    await createUser({ username, password, email, role: 'admin' });
    const name = String(username).trim();
    req.session.user = { username: name, role: 'admin' };
    const full = await getUserPublic(name);
    res.json({ ok: true, user: full });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Passwort zurücksetzen ohne Login: PASSWORD_RESET_TOKEN in .env (mind. 16 Zeichen), gleicher Wert im Formular. */
app.post('/api/auth/reset-password', async (req, res) => {
  const token = String(process.env.PASSWORD_RESET_TOKEN || '').trim();
  if (!token || token.length < 16) {
    return res.status(503).json({ error: 'PASSWORD_RESET_TOKEN nicht konfiguriert (mind. 16 Zeichen in .env)' });
  }
  const { username, newPassword, resetToken } = req.body || {};
  if (!resetToken || resetToken !== token) {
    return res.status(403).json({ error: 'Ungültiges Reset-Token' });
  }
  try {
    await resetUserPassword(username, newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get(['/profile', '/profile/'], (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.sendFile(path.join(__dirname, '../public/profile.html'));
});

app.get(['/admin/users', '/admin/users/'], (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
  },
}));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  res.set('Cache-Control', 'no-store, max-age=0');
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  const parts = [];
  if (sessionOn) parts.push('Session-Login');
  if (!sessionOn && basicAuthConfigured()) parts.push('Basic-Auth');
  const pub = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  const local = `http://127.0.0.1:${PORT}`;
  if (pub) {
    console.log(`NOORTEC Vertriebs-Dashboard listening ${local}${parts.length ? ` (${parts.join(', ')})` : ''} · live ${pub}`);
  } else {
    console.log(`NOORTEC Vertriebs-Dashboard ${local}${parts.length ? ` (${parts.join(', ')})` : ''} — set APP_BASE_URL=https://pvl.lifeco.at for production links`);
  }
});

module.exports = app;
