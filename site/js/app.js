'use strict';

const cfg = window.EGMONT_CONFIG || {};
const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const state = {
  user: null, // eigen profiel
  parties: [],
  people: new Map(), // id -> profiel (naam, partij)
  month: startOfMonth(new Date()),
  reservations: [],
  holidays: [],
  year: new Date().getFullYear(),
  yearList: [],
  pick: null, // gekozen aankomstdag in het jaaroverzicht
  lastMsgId: 0,
  unread: 0,
  editing: null,
  recovery: false,
};

// ---------- Hulpfuncties ----------
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const fmt = (s) => parseIso(s).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = (s) => parseIso(s).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
const nights = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);
const party = (key) => state.parties.find((p) => p.key === key) || { key, label: key, color: '#999' };
const personName = (id) => state.people.get(id)?.name || '?';
const canManage = (key) => state.user.is_admin || (key === state.user.party && !party(key).external);

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) e.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), sv);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

function showError(form, msg) {
  const p = $('.error', form);
  if (p) p.textContent = msg || '';
}

function show(view) {
  for (const v of ['login', 'change-pw', 'app']) $(`#view-${v}`).hidden = v !== view;
}

// Vertaalt databankfouten naar begrijpelijke taal.
function friendly(error) {
  if (!error) return '';
  const m = error.message || String(error);
  if (error.code === '23P01') return 'Deze periode overlapt met een bestaande reservatie.';
  if (error.code === '42501' || /row-level security/i.test(m)) return 'Dit mag je niet doen met jouw account.';
  if (/max_120_nachten/.test(m)) return 'Een reservatie kan maximaal 120 nachten duren.';
  if (/vertrek_na_aankomst/.test(m)) return 'De vertrekdag moet na de aankomstdag liggen.';
  if (/Invalid login credentials/i.test(m)) return 'E-mailadres of paswoord is onjuist.';
  if (/should be different/i.test(m)) return 'Kies een ander paswoord dan het huidige.';
  if (/Password should be at least/i.test(m)) return 'Het paswoord is te kort.';
  return m;
}
async function check(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(friendly(error));
  return data;
}

async function callFunction(body) {
  const { data, error } = await db.functions.invoke('egmont', { body });
  if (error) {
    let msg = error.message;
    try {
      msg = (await error.context.json()).error || msg;
    } catch (_) { /* geen JSON */ }
    throw new Error(msg);
  }
  return data;
}

// ---------- Opstart en login ----------
async function boot() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return show('login');
  const { data: me } = await db.from('profiles').select('*').eq('id', session.user.id).single();
  if (!me || !me.active) {
    await db.auth.signOut();
    $('#login-error').textContent = 'Je account is (nog) niet actief. Vraag het aan de beheerder.';
    return show('login');
  }
  state.user = me;
  if (state.recovery || me.must_change_password) {
    $('#force-pw-intro').textContent = state.recovery
      ? 'Kies een nieuw paswoord (min. 8 tekens).'
      : 'Je bent ingelogd met een tijdelijk paswoord. Kies nu een eigen paswoord (min. 8 tekens).';
    return show('change-pw');
  }
  state.parties = await check(db.from('parties').select('*').order('sort'));
  state.holidays = (await db.from('holidays').select('*').order('start_date')).data || [];
  await loadPeople();
  show('app');
  initApp();
}

db.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    state.recovery = true;
    setTimeout(boot, 0);
  }
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#login-error').textContent = '';
  const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  if (error) {
    $('#login-error').textContent = friendly(error);
    return;
  }
  f.reset();
  boot();
});

$('#forgot').addEventListener('click', async () => {
  const email = $('#login-form').email.value.trim() || prompt('Je e-mailadres:');
  if (!email) return;
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  $('#login-error').textContent = error
    ? friendly(error)
    : 'Als dit adres bekend is, krijg je een mail met een link om een nieuw paswoord te kiezen.';
});

async function setPassword(form) {
  const next = form.next.value;
  if (next.length < 8) throw new Error('Het paswoord moet minstens 8 tekens hebben.');
  if (next !== form.repeat.value) throw new Error('De twee paswoorden zijn niet gelijk.');
  await check(db.auth.updateUser({ password: next }));
  await check(db.rpc('password_changed'));
}

$('#force-pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await setPassword(f);
    f.reset();
    state.recovery = false;
    if (location.hash) history.replaceState(null, '', location.pathname);
    boot();
  } catch (err) {
    showError(f, err.message);
  }
});

$('#logout').addEventListener('click', async () => {
  await db.auth.signOut();
  location.reload();
});

let appInitialized = false;
function initApp() {
  $('#who-name').textContent = state.user.name;
  $('#tab-admin').hidden = !state.user.is_admin;
  renderLegend();
  fillPartySelects();
  fillProfile();
  if (appInitialized) return;
  appInitialized = true;
  loadMonth();
  loadYear();
  loadMessages(true);
  // Live bijwerken; als reserve ook af en toe zelf kijken.
  db.channel('live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => loadMessages(false))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
      loadMonth();
      if (activeTab() === 'year') loadYear();
    })
    .subscribe();
  setInterval(() => loadMessages(false), 30000);
  setInterval(loadMonth, 120000);
}

async function loadPeople() {
  const people = await check(db.from('profiles').select('id, name, party, email, phone, is_admin, active, must_change_password, notify_whatsapp, notify_email_reservations, notify_email_chat').order('name'));
  state.people = new Map(people.map((p) => [p.id, p]));
  return people;
}

// ---------- Tabs ----------
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tab').forEach((t) => (t.hidden = t.id !== `tab-${b.dataset.tab}`));
  if (b.dataset.tab === 'chat') {
    state.unread = 0;
    updateBadge();
    scrollChat();
  }
  if (b.dataset.tab === 'admin') loadUsers();
  if (b.dataset.tab === 'year') loadYear();
});
const activeTab = () => $('#tabs button.active').dataset.tab;

// ---------- Kalender ----------
function legendItems() {
  return [
    ...state.parties.map((p) =>
      el('span', { class: 'legend-item' }, el('span', { class: `swatch ${p.external ? 'ext' : ''}`, style: { background: p.color } }), p.external ? 'Externe verhuur' : p.label)
    ),
    el('span', { class: 'legend-item' }, el('span', { class: 'swatch school' }), 'Schoolvakantie'),
    el('span', { class: 'legend-item' }, el('span', { class: 'swatch feest' }, '★'), 'Feestdag'),
  ];
}
function renderLegend() {
  $('#legend').replaceChildren(...legendItems());
  $('#year-legend').replaceChildren(...legendItems());
}

// Verlofdagen op een datum (YYYY-MM-DD)
const schoolHoliday = (ds) => state.holidays.find((h) => h.kind === 'school' && h.start_date <= ds && ds <= h.end_date);
const feestdag = (ds) => state.holidays.find((h) => h.kind === 'feestdag' && h.start_date === ds);

async function loadMonth() {
  const first = state.month;
  const gridStart = addDays(first, -((first.getDay() + 6) % 7)); // maandag
  const gridEnd = addDays(gridStart, 42);
  try {
    const [inGrid, upcoming] = await Promise.all([
      check(db.from('reservations').select('*').gt('end_date', iso(gridStart)).lt('start_date', iso(gridEnd)).order('start_date')),
      check(db.from('reservations').select('*').gt('end_date', iso(new Date())).order('start_date').limit(30)),
    ]);
    state.reservations = inGrid;
    renderCalendar(gridStart);
    renderUpcoming(upcoming);
  } catch (e) {
    console.error(e);
  }
}

function renderCalendar(gridStart) {
  const title = state.month.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
  $('#cal-title').textContent = title[0].toUpperCase() + title.slice(1);
  const heads = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((d) => el('div', { class: 'cal-dow' }, d));
  const today = iso(new Date());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const ds = iso(d);
    const inMonth = d.getMonth() === state.month.getMonth();
    const school = schoolHoliday(ds);
    const feest = feestdag(ds);
    const cell = el('div', {
      class: `cal-day ${inMonth ? '' : 'other'} ${ds === today ? 'today' : ''} ${ds < today ? 'past' : ''} ${school ? 'school' : ''}`,
    });
    // Naam van de vakantie op de eerste dag en op elke maandag; feestdag altijd.
    const holidayLabel = feest
      ? el('span', { class: 'feest-label', title: feest.label }, `★ ${feest.label}`)
      : school && (school.start_date === ds || d.getDay() === 1)
        ? el('span', { class: 'school-label', title: school.label }, school.label)
        : null;
    cell.append(el('div', { class: 'num' }, String(d.getDate()), holidayLabel));
    for (const r of state.reservations) {
      const p = party(r.party);
      const occupies = r.start_date <= ds && ds < r.end_date;
      const departs = r.end_date === ds;
      if (!occupies && !departs) continue;
      const isStart = r.start_date === ds;
      const classes = ['chip', p.external ? 'ext' : '', departs ? 'depart' : '', isStart ? 'start' : ''].join(' ');
      const label = departs ? '↦ vertrek' : isStart || d.getDay() === 1 ? (p.external ? 'EXTERN' : p.label) : '';
      cell.append(
        el(
          'button',
          {
            class: classes,
            style: { '--c': p.color },
            title: `${p.label}: ${fmt(r.start_date)} → ${fmt(r.end_date)}${r.note ? '\n' + r.note : ''}`,
            onclick: (ev) => {
              ev.stopPropagation();
              openReservation(r);
            },
          },
          label || ' '
        )
      );
    }
    cell.addEventListener('click', () => {
      if (ds >= today) openReservation(null, ds);
    });
    cells.push(cell);
  }
  $('#cal-grid').replaceChildren(...heads, ...cells);
}

function renderUpcoming(list) {
  const ul = $('#upcoming');
  if (!list.length) {
    ul.replaceChildren(el('li', { class: 'muted' }, 'Nog geen komende reservaties.'));
    return;
  }
  ul.replaceChildren(
    ...list.map((r) => {
      const p = party(r.party);
      return el(
        'li',
        { class: p.external ? 'ext' : '', style: { '--c': p.color }, onclick: () => openReservation(r) },
        el('span', { class: `swatch ${p.external ? 'ext' : ''}`, style: { background: p.color } }),
        el('b', {}, p.external ? 'Externe verhuur' : p.label),
        el('span', {}, ` ${fmt(r.start_date)} → ${fmt(r.end_date)} · ${nights(r.start_date, r.end_date)} n.`),
        r.note ? el('span', { class: 'muted' }, ` — ${r.note}`) : null
      );
    })
  );
}

function goMonth(delta) {
  state.month = delta === 0 ? startOfMonth(new Date()) : new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
  loadMonth();
}
$('#cal-prev').addEventListener('click', () => goMonth(-1));
$('#cal-next').addEventListener('click', () => goMonth(1));
$('#cal-today').addEventListener('click', () => goMonth(0));
$('#new-res').addEventListener('click', () => openReservation(null, iso(new Date())));

// ---------- Reservatie-dialoog ----------
function fillPartySelects() {
  const allowed = state.parties.filter((p) => canManage(p.key));
  $('#res-party').replaceChildren(...allowed.map((p) => el('option', { value: p.key }, p.external ? 'EXTERNAL (externe verhuur)' : p.label)));
  for (const sel of $$('.party-select-family')) {
    sel.replaceChildren(
      el('option', { value: '' }, '— geen —'),
      ...state.parties.filter((p) => !p.external).map((p) => el('option', { value: p.key }, p.label))
    );
  }
}

function openReservation(r, startDate, endDate) {
  const f = $('#res-form');
  showError(f, '');
  if (!r && !state.parties.some((p) => canManage(p.key))) {
    alert('Je account is nog niet aan een partij gekoppeld. Vraag het aan de beheerder.');
    return;
  }
  state.editing = r;
  const editable = r ? canManage(r.party) : true;
  $('#res-title').textContent = r ? (editable ? 'Reservatie wijzigen' : 'Reservatie') : 'Nieuwe reservatie';
  const sel = $('#res-party');
  if (r && !editable) sel.replaceChildren(el('option', { value: r.party }, party(r.party).label));
  else fillPartySelects();
  sel.value = r ? r.party : canManage(state.user.party) ? state.user.party : sel.options[0]?.value;
  f.start_date.value = r ? r.start_date : startDate;
  f.end_date.value = r ? r.end_date : endDate || iso(addDays(parseIso(startDate), 7));
  f.note.value = r ? r.note || '' : '';
  for (const inp of [sel, f.start_date, f.end_date, f.note]) inp.disabled = !editable;
  $('#res-save').hidden = !editable;
  $('#res-delete').hidden = !(r && editable);
  $('#res-meta').textContent = r
    ? `Ingegeven door ${personName(r.created_by)}` + (r.updated_at !== r.created_at ? ` · laatst gewijzigd door ${personName(r.updated_by)}` : '')
    : '';
  updateNights();
  $('#res-dialog').showModal();
}

function updateNights() {
  const f = $('#res-form');
  const a = f.start_date.value;
  const b = f.end_date.value;
  $('#res-nights').textContent = a && b && b > a ? `${nights(a, b)} nacht(en)` : '';
}
$('#res-form').start_date.addEventListener('change', (e) => {
  const f = $('#res-form');
  if (f.end_date.value <= e.target.value) f.end_date.value = iso(addDays(parseIso(e.target.value), 1));
  updateNights();
});
$('#res-form').end_date.addEventListener('change', updateNights);
$('#res-cancel').addEventListener('click', () => $('#res-dialog').close());

$('#res-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const row = { party: f.party.value, start_date: f.start_date.value, end_date: f.end_date.value, note: f.note.value.trim() };
  try {
    if (row.end_date <= row.start_date) throw new Error('De vertrekdag moet na de aankomstdag liggen.');
    // Vooraf kijken met wie het botst, voor een duidelijke melding.
    let q = db.from('reservations').select('party, start_date, end_date').lt('start_date', row.end_date).gt('end_date', row.start_date).limit(1);
    if (state.editing) q = q.neq('id', state.editing.id);
    const [clash] = await check(q);
    if (clash) {
      throw new Error(`Overlapt met ${party(clash.party).label} (${fmtShort(clash.start_date)} – ${fmtShort(clash.end_date)}).`);
    }
    if (state.editing) await check(db.from('reservations').update(row).eq('id', state.editing.id).select().single());
    else await check(db.from('reservations').insert(row).select().single());
    $('#res-dialog').close();
    loadMonth();
    if (activeTab() === 'year') loadYear();
    loadMessages(false);
  } catch (err) {
    showError(f, err.message);
  }
});

$('#res-delete').addEventListener('click', async () => {
  if (!state.editing || !confirm('Deze reservatie verwijderen?')) return;
  try {
    await check(db.from('reservations').delete().eq('id', state.editing.id));
    $('#res-dialog').close();
    loadMonth();
    if (activeTab() === 'year') loadYear();
    loadMessages(false);
  } catch (err) {
    showError($('#res-form'), err.message);
  }
});

// ---------- Chat ----------
function scrollChat() {
  const log = $('#chat-log');
  log.scrollTop = log.scrollHeight;
}
function updateBadge() {
  const b = $('#chat-badge');
  b.hidden = !state.unread;
  b.textContent = state.unread;
}

let loadingMessages = false;
async function loadMessages(initial) {
  if (loadingMessages) return;
  loadingMessages = true;
  try {
    let messages;
    if (initial) {
      messages = (await check(db.from('messages').select('*').order('id', { ascending: false }).limit(200))).reverse();
    } else {
      messages = await check(db.from('messages').select('*').gt('id', state.lastMsgId).order('id'));
    }
    if (!messages.length) return;
    const log = $('#chat-log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    for (const m of messages) {
      if (m.id <= state.lastMsgId) continue;
      if (m.user_id && !state.people.has(m.user_id)) await loadPeople();
      log.append(renderMessage(m));
      state.lastMsgId = m.id;
      if (!initial && m.user_id !== state.user.id && m.actor_id !== state.user.id && activeTab() !== 'chat') state.unread++;
    }
    updateBadge();
    if (initial || atBottom) scrollChat();
  } catch (e) {
    console.error(e);
  } finally {
    loadingMessages = false;
  }
}

function renderMessage(m) {
  const when = new Date(m.created_at).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (m.is_system) {
    return el('div', { class: 'msg system' }, el('div', { class: 'body' }, m.body), el('div', { class: 'time' }, when));
  }
  const author = state.people.get(m.user_id);
  const p = author?.party ? party(author.party) : null;
  return el(
    'div',
    { class: `msg ${m.user_id === state.user.id ? 'mine' : ''}`, style: { '--c': p ? p.color : '#888' } },
    el('div', { class: 'author' }, author?.name || 'Verwijderde gebruiker', p ? el('span', { class: 'muted' }, ` · ${p.label}`) : null),
    el('div', { class: 'body' }, m.body),
    el('div', { class: 'time' }, when)
  );
}

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = f.body.value.trim();
  if (!body) return;
  f.body.disabled = true;
  try {
    await check(db.from('messages').insert({ body }));
    f.body.value = '';
    await loadMessages(false);
    scrollChat();
  } catch (err) {
    alert(err.message);
  } finally {
    f.body.disabled = false;
    f.body.focus();
  }
});
$('#chat-form').body.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#chat-form').requestSubmit();
  }
});

// ---------- Profiel ----------
async function fillProfile() {
  const f = $('#profile-form');
  const u = state.user;
  f.name.value = u.name;
  f.phone.value = u.phone || '';
  f.notify_whatsapp.checked = u.notify_whatsapp;
  f.notify_email_reservations.checked = u.notify_email_reservations;
  f.notify_email_chat.checked = u.notify_email_chat;
  $('#profile-email').textContent = u.email;
  f.callmebot_key.value = '';
  const { data: key } = await db.from('whatsapp_keys').select('user_id').eq('user_id', u.id).maybeSingle();
  f.callmebot_key.placeholder = key ? 'ingesteld – laat leeg om te behouden' : 'nog niet ingesteld';
  $('#profile-party').textContent = u.party ? `Partij: ${party(u.party).label}` : 'Nog niet aan een partij gekoppeld.';
}

$('#profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const name = f.name.value.trim().slice(0, 80);
    if (!name) throw new Error('Naam is verplicht.');
    const user = await check(
      db.from('profiles')
        .update({
          name,
          phone: f.phone.value.trim() || null,
          notify_whatsapp: f.notify_whatsapp.checked,
          notify_email_reservations: f.notify_email_reservations.checked,
          notify_email_chat: f.notify_email_chat.checked,
        })
        .eq('id', state.user.id).select().single()
    );
    const key = f.callmebot_key.value.trim();
    if (key === '-') await check(db.from('whatsapp_keys').delete().eq('user_id', user.id));
    else if (key) await check(db.from('whatsapp_keys').upsert({ user_id: user.id, callmebot_key: key }));
    state.user = user;
    state.people.set(user.id, user);
    $('#who-name').textContent = user.name;
    await fillProfile();
    showError(f, '');
    alert('Gegevens opgeslagen.');
  } catch (err) {
    showError(f, err.message);
  }
});

$('#pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await setPassword(f);
    f.reset();
    showError(f, '');
    alert('Paswoord gewijzigd.');
  } catch (err) {
    showError(f, err.message);
  }
});

// ---------- Beheer ----------
async function loadUsers() {
  const users = await loadPeople();
  $('#users-table tbody').replaceChildren(
    ...users.map((u) => {
      const isMe = u.id === state.user.id;
      return el(
        'tr',
        { class: u.active ? '' : 'inactive' },
        el('td', {}, u.name, u.must_change_password ? el('span', { class: 'tag' }, 'tijdelijk pw') : null),
        el('td', {}, u.email),
        el(
          'td',
          {},
          el(
            'select',
            { onchange: (e) => updateUser(u.id, { party: e.target.value || null }) },
            el('option', { value: '' }, '— geen —'),
            ...state.parties.filter((p) => !p.external).map((p) => el('option', { value: p.key, selected: p.key === u.party }, p.label))
          )
        ),
        el('td', {}, el('input', { type: 'checkbox', checked: u.is_admin, disabled: isMe, onchange: (e) => updateUser(u.id, { is_admin: e.target.checked }) })),
        el('td', {}, el('input', { type: 'checkbox', checked: u.active, disabled: isMe, onchange: (e) => updateUser(u.id, { active: e.target.checked }) })),
        el('td', { class: 'small' }, [
          u.notify_email_reservations ? 'mail' : null,
          u.notify_email_chat ? 'mail chat' : null,
          u.phone && u.notify_whatsapp ? 'WhatsApp' : null,
        ].filter(Boolean).join(', ') || 'geen'),
        el(
          'td',
          { class: 'nowrap' },
          el('button', { class: 'ghost small', onclick: () => resetPassword(u) }, 'Reset paswoord'),
          isMe ? null : el('button', { class: 'danger small', onclick: () => deleteUser(u) }, 'Verwijder')
        )
      );
    })
  );
}

async function updateUser(id, patch) {
  try {
    await check(db.from('profiles').update(patch).eq('id', id));
  } catch (err) {
    alert(err.message);
  }
  loadUsers();
}

async function resetPassword(u) {
  if (!confirm(`Nieuw tijdelijk paswoord aanmaken voor ${u.name}?`)) return;
  try {
    const { temp_password } = await callFunction({ action: 'reset-password', id: u.id });
    prompt(`Tijdelijk paswoord voor ${u.name} (geef dit door):`, temp_password);
  } catch (err) {
    alert(err.message);
  }
  loadUsers();
}

async function deleteUser(u) {
  if (!confirm(`${u.name} definitief verwijderen? (Tijdelijk uitschakelen kan ook via "Actief".)`)) return;
  try {
    await callFunction({ action: 'delete-user', id: u.id });
  } catch (err) {
    alert(err.message);
  }
  loadUsers();
}

$('#new-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  showError(f, '');
  const btn = $('button.primary', f);
  btn.disabled = true;
  try {
    const user = await callFunction({
      action: 'create-user',
      name: f.name.value,
      email: f.email.value,
      party: f.party.value || null,
      is_admin: f.is_admin.checked,
    });
    const box = $('#new-user-result');
    box.hidden = false;
    box.replaceChildren(
      el('b', {}, `${user.name} aangemaakt.`),
      el('br'),
      'Geef deze gegevens door:',
      el('pre', {}, `Site: ${location.origin}\nE-mail: ${user.email}\nTijdelijk paswoord: ${user.temp_password}`)
    );
    f.reset();
    loadUsers();
  } catch (err) {
    showError(f, err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#mail-test').addEventListener('click', async () => {
  const out = $('#wa-test-result');
  out.textContent = 'Bezig…';
  try {
    await callFunction({ action: 'mail-test' });
    out.textContent = `Testmail verstuurd naar ${state.user.email}. Kijk ook in je spam.`;
  } catch (err) {
    out.textContent = err.message;
  }
});

$('#wa-test').addEventListener('click', async () => {
  const out = $('#wa-test-result');
  out.textContent = 'Bezig…';
  try {
    const { provider, sent } = await callFunction({ action: 'whatsapp-test' });
    out.textContent =
      provider === 'none'
        ? 'WHATSAPP_PROVIDER staat op "none": het bericht staat enkel in de log van de Edge Function.'
        : `Verstuurd via ${provider} naar ${sent} persoon/personen.`;
  } catch (err) {
    out.textContent = err.message;
  }
});

// ---------- Jaaroverzicht ----------
async function loadYear() {
  const y = state.year;
  $('#year-title').textContent = String(y);
  try {
    const list = await check(
      db.from('reservations').select('*').lt('start_date', `${y + 1}-01-01`).gt('end_date', `${y}-01-01`).order('start_date')
    );
    renderYear(y, list);
  } catch (e) {
    console.error(e);
  }
}

function renderYear(y, list) {
  state.yearList = list;
  updateYearHint();
  const today = iso(new Date());
  const months = [];
  for (let m = 0; m < 12; m++) {
    const first = new Date(y, m, 1);
    const name = first.toLocaleDateString('nl-BE', { month: 'long' });
    const grid = el('div', { class: 'mini-grid' }, ...['m', 'd', 'w', 'd', 'v', 'z', 'z'].map((d) => el('div', { class: 'mini-dow' }, d)));
    for (let i = 0; i < (first.getDay() + 6) % 7; i++) grid.append(el('div'));
    for (let d = first; d.getMonth() === m; d = addDays(d, 1)) {
      const ds = iso(d);
      // r = wie die nacht in het appartement slaapt; dep = wie die dag vertrekt.
      const r = list.find((x) => x.start_date <= ds && ds < x.end_date);
      const dep = list.find((x) => x.end_date === ds);
      const p = r ? party(r.party) : null;
      const pd = dep ? party(dep.party) : null;
      const arrives = r && r.start_date === ds;
      const school = schoolHoliday(ds);
      const feest = feestdag(ds);
      const plabel = (x) => (x.external ? 'Externe verhuur' : x.label);
      const title = [
        fmt(ds),
        pd ? `${plabel(pd)}: vertrek` : null,
        p ? `${plabel(p)}${arrives ? ': aankomst' : ''}` : null,
        school?.label,
        feest ? `★ ${feest.label}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      const style = {};
      if (p) style['--c'] = p.color;
      if (pd) style['--d'] = pd.color;
      grid.append(
        el(
          'button',
          {
            class: [
              'mini-day',
              state.pick === ds ? 'picked' : '',
              p ? 'busy' : '',
              arrives ? 'arr' : '',
              pd ? 'dep' : '',
              p?.external && !arrives ? 'ext' : '',
              school ? 'school' : '',
              feest ? 'feest' : '',
              ds === today ? 'today' : '',
              ds < today ? 'past' : '',
            ].join(' '),
            style,
            title,
            'data-date': ds,
            // Een vertrekdag is vrij als aankomstdag voor iemand anders.
            onclick: () => yearDayClick(ds, r),
            onmouseenter: () => previewRange(ds),
          },
          String(d.getDate())
        )
      );
    }
    months.push(
      el(
        'div',
        { class: 'mini-month' },
        el('div', { class: 'mini-title' }, name[0].toUpperCase() + name.slice(1)),
        grid
      )
    );
  }
  $('#year-grid').replaceChildren(...months);
  // Op gsm staan de maanden onder elkaar: spring bij het openen naar de huidige maand.
  if (!state.yearScrolled && y === new Date().getFullYear() && window.innerWidth < 700) {
    state.yearScrolled = true;
    months[new Date().getMonth()].scrollIntoView({ block: 'start' });
  }

  // Nachten per partij in dit jaar (enkel de nachten binnen het jaar tellen)
  const yStart = `${y}-01-01`;
  const yEnd = `${y + 1}-01-01`;
  const totals = new Map();
  for (const r of list) {
    const a = r.start_date > yStart ? r.start_date : yStart;
    const b = r.end_date < yEnd ? r.end_date : yEnd;
    const t = totals.get(r.party) || { nights: 0, count: 0 };
    t.nights += nights(a, b);
    t.count += 1;
    totals.set(r.party, t);
  }
  const daysInYear = nights(yStart, yEnd);
  const free = daysInYear - [...totals.values()].reduce((n, t) => n + t.nights, 0);
  $('#year-totals tbody').replaceChildren(
    ...state.parties.map((p) => {
      const t = totals.get(p.key) || { nights: 0, count: 0 };
      return el(
        'tr',
        {},
        el('td', {}, el('span', { class: `swatch ${p.external ? 'ext' : ''}`, style: { background: p.color } }), ' ', p.external ? 'Externe verhuur' : p.label),
        el('td', { class: 'num-col' }, String(t.count)),
        el('td', { class: 'num-col' }, String(t.nights))
      );
    }),
    el('tr', { class: 'muted' }, el('td', {}, 'Vrij'), el('td', {}, ''), el('td', { class: 'num-col' }, String(free)))
  );
}

// Reservatie maken in het jaaroverzicht: eerst aankomst-, dan vertrekdag kiezen.
const occupiedBy = (ds) => state.yearList.find((x) => x.start_date <= ds && ds < x.end_date);
// Zijn alle nachten van a tot (niet met) b nog vrij?
const rangeFree = (a, b) => !state.yearList.some((x) => x.start_date < b && x.end_date > a);

function yearDayClick(ds, r) {
  const today = iso(new Date());
  if (state.pick) {
    if (ds === state.pick) return cancelPick();
    if (ds > state.pick) {
      if (!rangeFree(state.pick, ds)) {
        updateYearHint('Die periode overlapt met een bestaande reservatie. Kies een vroegere vertrekdag.');
        return;
      }
      const start = state.pick;
      cancelPick();
      openReservation(null, start, ds);
      return;
    }
    // Een vroegere dag: opnieuw beginnen vanaf die dag.
  } else if (r) {
    return openReservation(r);
  }
  if (ds < today || occupiedBy(ds)) return;
  if (!state.parties.some((p) => canManage(p.key))) {
    alert('Je account is nog niet aan een partij gekoppeld. Vraag het aan de beheerder.');
    return;
  }
  state.pick = ds;
  clearPickMarks();
  $(`#year-grid .mini-day[data-date="${ds}"]`)?.classList.add('picked');
  updateYearHint();
}

function clearPickMarks() {
  for (const b of $$('#year-grid .mini-day')) {
    b.classList.toggle('picked', false);
    b.classList.toggle('in-range', false);
    b.classList.toggle('bad', false);
  }
}

function cancelPick() {
  state.pick = null;
  clearPickMarks();
  updateYearHint();
}

function previewRange(ds) {
  if (!state.pick) return;
  const ok = ds > state.pick && rangeFree(state.pick, ds);
  for (const b of $$('#year-grid .mini-day')) {
    const d = b.dataset.date;
    const inRange = ds > state.pick && d > state.pick && d <= ds;
    b.classList.toggle('in-range', inRange);
    b.classList.toggle('bad', inRange && !ok);
  }
}

function updateYearHint(error) {
  const h = $('#year-hint');
  h.classList.toggle('error-hint', !!error);
  h.textContent =
    error ||
    (state.pick
      ? `Aankomst ${fmt(state.pick)}. Klik nu op de vertrekdag, de dag dat je weggaat (of nog eens op de aankomstdag om te annuleren).`
      : 'Nieuwe reservatie: klik op een vrije dag voor de aankomst en daarna op de vertrekdag. Klik op een gekleurde dag om een reservatie te bekijken.');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.pick) cancelPick();
});
$('#year-new').addEventListener('click', () => {
  const today = iso(new Date());
  const first = `${state.year}-01-01`;
  openReservation(null, first > today ? first : today);
});

$('#year-prev').addEventListener('click', () => {
  state.year -= 1;
  loadYear();
});
$('#year-next').addEventListener('click', () => {
  state.year += 1;
  loadYear();
});
$('#year-today').addEventListener('click', () => {
  state.year = new Date().getFullYear();
  loadYear();
});

boot();
