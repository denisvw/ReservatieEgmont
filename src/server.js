const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, PARTIES, PARTY_KEYS, partyLabel } = require('./db');
const { notify, PROVIDER } = require('./whatsapp');

const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = 30;
const COOKIE = 'sid';
const SECURE_COOKIE = process.env.NODE_ENV === 'production';

// ---------- Eerste beheerder aanmaken ----------
function seedAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('Nog geen gebruikers. Start met ADMIN_EMAIL en ADMIN_PASSWORD om de beheerder aan te maken.');
    return;
  }
  db.prepare(
    `INSERT INTO users (email, name, party, is_admin, password_hash, must_change_password)
     VALUES (?, ?, ?, 1, ?, 0)`
  ).run(email.trim(), process.env.ADMIN_NAME || 'Beheerder', process.env.ADMIN_PARTY || null, bcrypt.hashSync(password, 10));
  console.log(`Beheerder ${email} aangemaakt.`);
}
seedAdmin();

// ---------- Helpers ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
  });
  next();
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    party: u.party,
    is_admin: !!u.is_admin,
    active: !!u.active,
    must_change_password: !!u.must_change_password,
    phone: u.phone || '',
    has_callmebot_key: !!u.callmebot_key,
    notify_whatsapp: !!u.notify_whatsapp,
  };
}

function auth(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`
      )
      .get(token, Date.now());
    if (row) {
      req.user = row;
      req.sessionToken = token;
    }
  }
  next();
}
app.use(auth);

// Zuivere JSON-API: weiger andere content-types bij schrijfacties (CSRF-bescherming;
// DELETE kan cross-site niet zonder CORS-preflight)
// in combinatie met SameSite-cookies).
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type moet application/json zijn' });
  }
  next();
});

function requireUser(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Niet ingelogd'));
  // Wie een tijdelijk paswoord heeft, mag enkel het paswoord wijzigen.
  if (req.user.must_change_password && !/^\/api\/(me|logout)(\/|$)/.test(req.originalUrl.split('?')[0])) {
    return next(new HttpError(403, 'Wijzig eerst je paswoord'));
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return next(new HttpError(403, 'Enkel voor beheerders'));
  next();
}

function setSessionCookie(res, token) {
  res.set(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${SECURE_COOKIE ? '; Secure' : ''}`
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const fmtDate = (s) => {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};
const nights = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function tempPassword() {
  return crypto.randomBytes(6).toString('base64url');
}

function postSystemMessage(text) {
  db.prepare('INSERT INTO messages (user_id, body) VALUES (NULL, ?)').run(text);
}

// ---------- Login ----------
const loginAttempts = new Map(); // ip -> { n, until }
app.post(
  '/api/login',
  wrap(async (req, res) => {
    const ip = req.ip;
    const a = loginAttempts.get(ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) throw new HttpError(429, 'Te veel pogingen, probeer binnen enkele minuten opnieuw');
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').trim());
    const ok = user && (await bcrypt.compare(String(password || ''), user.password_hash));
    if (!ok) {
      a.n += 1;
      if (a.n >= 8) Object.assign(a, { n: 0, until: Date.now() + 10 * 60 * 1000 });
      loginAttempts.set(ip, a);
      throw new HttpError(401, 'E-mailadres of paswoord is onjuist');
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
      token,
      user.id,
      Date.now() + SESSION_DAYS * 86400000
    );
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    setSessionCookie(res, token);
    res.json({ user: publicUser(user) });
  })
);

app.post('/api/logout', (req, res) => {
  if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

// ---------- Eigen profiel ----------
app.get('/api/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user), parties: PARTIES, whatsapp_provider: PROVIDER });
});

app.post(
  '/api/me/password',
  requireUser,
  wrap(async (req, res) => {
    const { current, next: nextPw } = req.body || {};
    if (!(await bcrypt.compare(String(current || ''), req.user.password_hash))) {
      throw new HttpError(400, 'Huidig paswoord is onjuist');
    }
    if (typeof nextPw !== 'string' || nextPw.length < 8) throw new HttpError(400, 'Nieuw paswoord moet minstens 8 tekens hebben');
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
      await bcrypt.hash(nextPw, 10),
      req.user.id
    );
    // Andere sessies afmelden
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.sessionToken);
    res.json({ ok: true });
  })
);

app.put('/api/me', requireUser, (req, res) => {
  const { name, phone, callmebot_key, notify_whatsapp } = req.body || {};
  const u = req.user;
  const newName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : u.name;
  const newPhone = typeof phone === 'string' ? phone.trim().slice(0, 30) : u.phone;
  // Lege string = sleutel behouden; "-" = sleutel wissen
  let newKey = u.callmebot_key;
  if (typeof callmebot_key === 'string' && callmebot_key.trim()) {
    newKey = callmebot_key.trim() === '-' ? null : callmebot_key.trim().slice(0, 64);
  }
  const newNotify = typeof notify_whatsapp === 'boolean' ? (notify_whatsapp ? 1 : 0) : u.notify_whatsapp;
  db.prepare('UPDATE users SET name = ?, phone = ?, callmebot_key = ?, notify_whatsapp = ? WHERE id = ?').run(
    newName,
    newPhone,
    newKey,
    newNotify,
    u.id
  );
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

// ---------- Reservaties ----------
const RES_SELECT = `
  SELECT r.*, cu.name AS created_by_name, uu.name AS updated_by_name
  FROM reservations r
  LEFT JOIN users cu ON cu.id = r.created_by
  LEFT JOIN users uu ON uu.id = r.updated_by`;

app.get('/api/reservations', requireUser, (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (validDate(from) && validDate(to)) {
    rows = db.prepare(`${RES_SELECT} WHERE r.end_date > ? AND r.start_date < ? ORDER BY r.start_date`).all(from, to);
  } else {
    rows = db.prepare(`${RES_SELECT} ORDER BY r.start_date`).all();
  }
  res.json({ reservations: rows });
});

function canManageParty(user, party) {
  if (user.is_admin) return true;
  return party !== 'external' && user.party === party;
}

function validateReservation(body, user, ignoreId) {
  const party = body.party;
  const start = body.start_date;
  const end = body.end_date;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  if (!PARTY_KEYS.includes(party)) throw new HttpError(400, 'Onbekende partij');
  if (!canManageParty(user, party)) {
    throw new HttpError(403, party === 'external' ? 'Enkel de beheerder kan externe verhuur ingeven' : 'Je kan enkel voor je eigen partij reserveren');
  }
  if (!validDate(start) || !validDate(end)) throw new HttpError(400, 'Ongeldige datum');
  if (end <= start) throw new HttpError(400, 'Vertrekdatum moet na de aankomstdatum liggen');
  if (nights(start, end) > 120) throw new HttpError(400, 'Een reservatie kan maximaal 120 nachten duren');
  const clash = db
    .prepare('SELECT * FROM reservations WHERE end_date > ? AND start_date < ? AND id IS NOT ? LIMIT 1')
    .get(start, end, ignoreId ?? null);
  if (clash) {
    throw new HttpError(
      409,
      `Overlapt met ${partyLabel(clash.party)} (${fmtDate(clash.start_date)} – ${fmtDate(clash.end_date)})`
    );
  }
  return { party, start, end, note };
}

const describe = (r) =>
  `${partyLabel(r.party)}: ${fmtDate(r.start_date || r.start)} → ${fmtDate(r.end_date || r.end)}` +
  ` (${nights(r.start_date || r.start, r.end_date || r.end)} nachten)`;

app.post('/api/reservations', requireUser, (req, res) => {
  const v = validateReservation(req.body || {}, req.user);
  const info = db
    .prepare(
      `INSERT INTO reservations (party, start_date, end_date, note, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(v.party, v.start, v.end, v.note, req.user.id, req.user.id);
  const text = `🏖️ Nieuwe reservatie door ${req.user.name}\n${describe(v)}${v.note ? `\n„${v.note}”` : ''}`;
  postSystemMessage(text);
  notify(text, { excludeUserId: req.user.id });
  res.status(201).json({ reservation: db.prepare(`${RES_SELECT} WHERE r.id = ?`).get(info.lastInsertRowid) });
});

app.put('/api/reservations/:id', requireUser, (req, res) => {
  const existing = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!existing) throw new HttpError(404, 'Reservatie niet gevonden');
  if (!canManageParty(req.user, existing.party)) throw new HttpError(403, 'Je kan deze reservatie niet wijzigen');
  const v = validateReservation(req.body || {}, req.user, existing.id);
  db.prepare(
    `UPDATE reservations SET party = ?, start_date = ?, end_date = ?, note = ?, updated_by = ?,
       updated_at = datetime('now') WHERE id = ?`
  ).run(v.party, v.start, v.end, v.note, req.user.id, existing.id);
  const text = `✏️ Reservatie gewijzigd door ${req.user.name}\nWas: ${describe(existing)}\nNu: ${describe(v)}${v.note ? `\n„${v.note}”` : ''}`;
  postSystemMessage(text);
  notify(text, { excludeUserId: req.user.id });
  res.json({ reservation: db.prepare(`${RES_SELECT} WHERE r.id = ?`).get(existing.id) });
});

app.delete('/api/reservations/:id', requireUser, (req, res) => {
  const existing = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!existing) throw new HttpError(404, 'Reservatie niet gevonden');
  if (!canManageParty(req.user, existing.party)) throw new HttpError(403, 'Je kan deze reservatie niet verwijderen');
  db.prepare('DELETE FROM reservations WHERE id = ?').run(existing.id);
  const text = `🗑️ Reservatie geannuleerd door ${req.user.name}\n${describe(existing)}`;
  postSystemMessage(text);
  notify(text, { excludeUserId: req.user.id });
  res.json({ ok: true });
});

// ---------- Chat ----------
const MSG_SELECT = `SELECT m.id, m.body, m.created_at, m.user_id, u.name AS user_name, u.party AS user_party
  FROM messages m LEFT JOIN users u ON u.id = m.user_id`;

app.get('/api/messages', requireUser, (req, res) => {
  const after = Number(req.query.after) || 0;
  const rows = after
    ? db.prepare(`${MSG_SELECT} WHERE m.id > ? ORDER BY m.id`).all(after)
    : db.prepare(`SELECT * FROM (${MSG_SELECT} ORDER BY m.id DESC LIMIT 200) ORDER BY id`).all();
  res.json({ messages: rows });
});

app.post('/api/messages', requireUser, (req, res) => {
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) throw new HttpError(400, 'Leeg bericht');
  if (body.length > 2000) throw new HttpError(400, 'Bericht is te lang (max. 2000 tekens)');
  const info = db.prepare('INSERT INTO messages (user_id, body) VALUES (?, ?)').run(req.user.id, body);
  notify(`💬 ${req.user.name}: ${body}`, { excludeUserId: req.user.id });
  res.status(201).json({ message: db.prepare(`${MSG_SELECT} WHERE m.id = ?`).get(info.lastInsertRowid) });
});

// ---------- Beheer ----------
app.get('/api/admin/users', requireUser, requireAdmin, (req, res) => {
  res.json({ users: db.prepare('SELECT * FROM users ORDER BY name').all().map(publicUser) });
});

app.post('/api/admin/users', requireUser, requireAdmin, (req, res) => {
  const { email, name, party, is_admin, phone } = req.body || {};
  const em = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new HttpError(400, 'Ongeldig e-mailadres');
  if (!String(name || '').trim()) throw new HttpError(400, 'Naam is verplicht');
  if (party && (!PARTY_KEYS.includes(party) || party === 'external')) throw new HttpError(400, 'Ongeldige partij');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(em)) throw new HttpError(409, 'Dit e-mailadres bestaat al');
  const pw = tempPassword();
  const info = db
    .prepare(
      `INSERT INTO users (email, name, party, is_admin, password_hash, must_change_password, phone)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    )
    .run(em, String(name).trim().slice(0, 80), party || null, is_admin ? 1 : 0, bcrypt.hashSync(pw, 10), (phone || '').trim() || null);
  res.status(201).json({
    user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)),
    temp_password: pw,
  });
});

app.put('/api/admin/users/:id', requireUser, requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'Gebruiker niet gevonden');
  const { name, party, is_admin, active, phone } = req.body || {};
  if (party !== undefined && party !== null && party !== '' && (!PARTY_KEYS.includes(party) || party === 'external')) {
    throw new HttpError(400, 'Ongeldige partij');
  }
  if (u.id === req.user.id && (active === false || is_admin === false)) {
    throw new HttpError(400, 'Je kan jezelf niet deactiveren of je beheerdersrechten afnemen');
  }
  db.prepare('UPDATE users SET name = ?, party = ?, is_admin = ?, active = ?, phone = ? WHERE id = ?').run(
    typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : u.name,
    party === undefined ? u.party : party || null,
    is_admin === undefined ? u.is_admin : is_admin ? 1 : 0,
    active === undefined ? u.active : active ? 1 : 0,
    phone === undefined ? u.phone : String(phone).trim() || null,
    u.id
  );
  if (active === false) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

app.post('/api/admin/users/:id/reset-password', requireUser, requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'Gebruiker niet gevonden');
  const pw = tempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(bcrypt.hashSync(pw, 10), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  res.json({ temp_password: pw });
});

app.delete('/api/admin/users/:id', requireUser, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'Je kan jezelf niet verwijderen');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/admin/whatsapp-test', requireUser, requireAdmin, (req, res) => {
  notify(`✅ Testbericht van de reservatiesite (verstuurd door ${req.user.name})`);
  res.json({ ok: true, provider: PROVIDER });
});

// ---------- Statische bestanden & fouten ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Niet gevonden' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
app.use((req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Serverfout' : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Reservatiesite draait op http://localhost:${PORT} (WhatsApp: ${PROVIDER})`));
}

module.exports = app;
