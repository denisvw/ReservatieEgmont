'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const state = {
  user: null,
  parties: [],
  provider: 'none',
  month: startOfMonth(new Date()),
  reservations: [],
  lastMsgId: 0,
  unread: 0,
  editing: null,
};

// ---------- Hulpfuncties ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Fout ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

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
const nights = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);
const party = (key) => state.parties.find((p) => p.key === key) || { key, label: key, color: '#999' };
const canManage = (key) => state.user.is_admin || (key !== 'external' && key === state.user.party);

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

// ---------- Opstart ----------
async function boot() {
  try {
    const me = await api('/me');
    state.user = me.user;
    state.parties = me.parties;
    state.provider = me.whatsapp_provider;
  } catch (e) {
    if (e.status === 403) {
      show('change-pw');
      return;
    }
    show('login');
    return;
  }
  if (state.user.must_change_password) return show('change-pw');
  show('app');
  initApp();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#login-error').textContent = '';
  try {
    await api('/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
    f.reset();
    boot();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#force-pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/me/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
    f.reset();
    boot();
  } catch (err) {
    showError(f, err.message);
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST', body: {} }).catch(() => {});
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
  loadMessages(true);
  setInterval(() => loadMessages(false), 8000);
  setInterval(loadMonth, 60000);
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
});
const activeTab = () => $('#tabs button.active').dataset.tab;

// ---------- Kalender ----------
function renderLegend() {
  const lg = $('#legend');
  lg.replaceChildren(
    ...state.parties.map((p) =>
      el('span', { class: 'legend-item' }, el('span', { class: `swatch ${p.external ? 'ext' : ''}`, style: { background: p.color } }), p.external ? 'Externe verhuur' : p.label)
    )
  );
}

async function loadMonth() {
  const first = state.month;
  // Toon volledige weken (maandag t.e.m. zondag)
  const gridStart = addDays(first, -((first.getDay() + 6) % 7));
  const gridEnd = addDays(gridStart, 42);
  try {
    const [{ reservations }, all] = await Promise.all([
      api(`/reservations?from=${iso(gridStart)}&to=${iso(gridEnd)}`),
      api(`/reservations?from=${iso(new Date())}&to=9999-12-31`),
    ]);
    state.reservations = reservations;
    renderCalendar(gridStart);
    renderUpcoming(all.reservations);
  } catch (e) {
    if (e.status === 401) location.reload();
  }
}

function renderCalendar(gridStart) {
  const title = state.month.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
  $('#cal-title').textContent = title[0].toUpperCase() + title.slice(1);
  const grid = $('#cal-grid');
  const heads = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((d) => el('div', { class: 'cal-dow' }, d));
  const today = iso(new Date());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const ds = iso(d);
    const inMonth = d.getMonth() === state.month.getMonth();
    const cell = el('div', {
      class: `cal-day ${inMonth ? '' : 'other'} ${ds === today ? 'today' : ''} ${ds < today ? 'past' : ''}`,
      'data-date': ds,
    });
    cell.append(el('div', { class: 'num' }, String(d.getDate())));
    // Reservaties die deze nacht bezetten, en vertrekken op deze dag
    for (const r of state.reservations) {
      const p = party(r.party);
      const occupies = r.start_date <= ds && ds < r.end_date;
      const departs = r.end_date === ds;
      if (!occupies && !departs) continue;
      const isStart = r.start_date === ds;
      const classes = ['chip', p.external ? 'ext' : '', departs ? 'depart' : '', isStart ? 'start' : ''].join(' ');
      const label = departs ? `↦ vertrek` : isStart || d.getDay() === 1 ? p.external ? 'EXTERN' : p.label : '';
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
      if (ds < today) return;
      openReservation(null, ds);
    });
    cells.push(cell);
  }
  grid.replaceChildren(...heads, ...cells);
}

function renderUpcoming(list) {
  const ul = $('#upcoming');
  if (!list.length) {
    ul.replaceChildren(el('li', { class: 'muted' }, 'Nog geen komende reservaties.'));
    return;
  }
  ul.replaceChildren(
    ...list.slice(0, 30).map((r) => {
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

$('#cal-prev').addEventListener('click', () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
  loadMonth();
});
$('#cal-next').addEventListener('click', () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
  loadMonth();
});
$('#cal-today').addEventListener('click', () => {
  state.month = startOfMonth(new Date());
  loadMonth();
});
$('#new-res').addEventListener('click', () => openReservation(null, iso(new Date())));

// ---------- Reservatie-dialoog ----------
function fillPartySelects() {
  const resSel = $('#res-party');
  const allowed = state.parties.filter((p) => canManage(p.key));
  resSel.replaceChildren(...allowed.map((p) => el('option', { value: p.key }, p.external ? 'EXTERNAL (externe verhuur)' : p.label)));
  for (const sel of $$('.party-select-family')) {
    sel.replaceChildren(
      el('option', { value: '' }, '— geen —'),
      ...state.parties.filter((p) => !p.external).map((p) => el('option', { value: p.key }, p.label))
    );
  }
}

function openReservation(r, startDate) {
  const dlg = $('#res-dialog');
  const f = $('#res-form');
  showError(f, '');
  state.editing = r;
  const editable = r ? canManage(r.party) : true;
  if (!r && !state.parties.some((p) => canManage(p.key))) {
    alert('Je account is nog niet aan een partij gekoppeld. Vraag het aan de beheerder.');
    return;
  }
  $('#res-title').textContent = r ? (editable ? 'Reservatie wijzigen' : 'Reservatie') : 'Nieuwe reservatie';
  const sel = $('#res-party');
  // Bij bekijken van andermans reservatie: toon die partij als enige optie
  if (r && !editable) {
    sel.replaceChildren(el('option', { value: r.party }, party(r.party).label));
  } else {
    fillPartySelects();
  }
  sel.value = r ? r.party : state.user.party && canManage(state.user.party) ? state.user.party : sel.options[0]?.value;
  f.start_date.value = r ? r.start_date : startDate;
  f.end_date.value = r ? r.end_date : iso(addDays(parseIso(startDate), 7));
  f.note.value = r ? r.note || '' : '';
  for (const inp of [sel, f.start_date, f.end_date, f.note]) inp.disabled = !editable;
  $('#res-save').hidden = !editable;
  $('#res-delete').hidden = !(r && editable);
  $('#res-meta').textContent = r
    ? `Ingegeven door ${r.created_by_name || '?'}` + (r.updated_at !== r.created_at ? ` · laatst gewijzigd door ${r.updated_by_name || '?'}` : '')
    : '';
  updateNights();
  dlg.showModal();
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
  const body = { party: f.party.value, start_date: f.start_date.value, end_date: f.end_date.value, note: f.note.value };
  try {
    if (state.editing) await api(`/reservations/${state.editing.id}`, { method: 'PUT', body });
    else await api('/reservations', { method: 'POST', body });
    $('#res-dialog').close();
    loadMonth();
    loadMessages(false);
  } catch (err) {
    showError(f, err.message);
  }
});

$('#res-delete').addEventListener('click', async () => {
  if (!state.editing || !confirm('Deze reservatie verwijderen?')) return;
  try {
    await api(`/reservations/${state.editing.id}`, { method: 'DELETE' });
    $('#res-dialog').close();
    loadMonth();
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

async function loadMessages(initial) {
  try {
    const { messages } = await api(`/messages${initial ? '' : `?after=${state.lastMsgId}`}`);
    if (!messages.length) return;
    const log = $('#chat-log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    for (const m of messages) {
      log.append(renderMessage(m));
      state.lastMsgId = Math.max(state.lastMsgId, m.id);
      if (!initial && m.user_id !== state.user.id && activeTab() !== 'chat') state.unread++;
    }
    updateBadge();
    if (initial || atBottom) scrollChat();
  } catch (e) {
    if (e.status === 401) location.reload();
  }
}

function renderMessage(m) {
  const when = new Date(m.created_at.replace(' ', 'T') + 'Z').toLocaleString('nl-BE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (!m.user_id) {
    return el('div', { class: 'msg system' }, el('div', { class: 'body' }, m.body), el('div', { class: 'time' }, when));
  }
  const mine = m.user_id === state.user.id;
  const p = m.user_party ? party(m.user_party) : null;
  return el(
    'div',
    { class: `msg ${mine ? 'mine' : ''}`, style: { '--c': p ? p.color : '#888' } },
    el('div', { class: 'author' }, m.user_name || 'Verwijderde gebruiker', p ? el('span', { class: 'muted' }, ` · ${p.label}`) : null),
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
    await api('/messages', { method: 'POST', body: { body } });
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
function fillProfile() {
  const f = $('#profile-form');
  const u = state.user;
  f.name.value = u.name;
  f.phone.value = u.phone;
  f.notify_whatsapp.checked = u.notify_whatsapp;
  f.callmebot_key.value = '';
  f.callmebot_key.placeholder = u.has_callmebot_key ? 'ingesteld – laat leeg om te behouden' : 'nog niet ingesteld';
  $('#callmebot-block').hidden = state.provider !== 'callmebot';
  $('#profile-party').textContent = u.party ? `Partij: ${party(u.party).label}` : 'Nog niet aan een partij gekoppeld.';
}

$('#profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const { user } = await api('/me', {
      method: 'PUT',
      body: { name: f.name.value, phone: f.phone.value, callmebot_key: f.callmebot_key.value, notify_whatsapp: f.notify_whatsapp.checked },
    });
    state.user = user;
    fillProfile();
    $('#who-name').textContent = user.name;
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
    await api('/me/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
    f.reset();
    showError(f, '');
    alert('Paswoord gewijzigd.');
  } catch (err) {
    showError(f, err.message);
  }
});

// ---------- Beheer ----------
async function loadUsers() {
  $('#wa-provider').textContent = state.provider;
  const { users } = await api('/admin/users');
  const tbody = $('#users-table tbody');
  tbody.replaceChildren(
    ...users.map((u) => {
      const partySel = el(
        'select',
        {
          onchange: (e) => updateUser(u.id, { party: e.target.value || null }),
        },
        el('option', { value: '' }, '— geen —'),
        ...state.parties.filter((p) => !p.external).map((p) => el('option', { value: p.key, selected: p.key === u.party }, p.label))
      );
      const isMe = u.id === state.user.id;
      return el(
        'tr',
        { class: u.active ? '' : 'inactive' },
        el('td', {}, u.name, u.must_change_password ? el('span', { class: 'tag' }, 'tijdelijk pw') : null),
        el('td', {}, u.email),
        el('td', {}, partySel),
        el('td', {}, el('input', { type: 'checkbox', checked: u.is_admin, disabled: isMe, onchange: (e) => updateUser(u.id, { is_admin: e.target.checked }) })),
        el('td', {}, el('input', { type: 'checkbox', checked: u.active, disabled: isMe, onchange: (e) => updateUser(u.id, { active: e.target.checked }) })),
        el('td', { class: 'small' }, u.phone ? `${u.phone}${u.notify_whatsapp ? '' : ' (uit)'}` : '—'),
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
    await api(`/admin/users/${id}`, { method: 'PUT', body: patch });
  } catch (err) {
    alert(err.message);
  }
  loadUsers();
}

async function resetPassword(u) {
  if (!confirm(`Nieuw tijdelijk paswoord aanmaken voor ${u.name}?`)) return;
  const { temp_password } = await api(`/admin/users/${u.id}/reset-password`, { method: 'POST', body: {} });
  prompt(`Tijdelijk paswoord voor ${u.name} (geef dit door):`, temp_password);
  loadUsers();
}

async function deleteUser(u) {
  if (!confirm(`${u.name} definitief verwijderen? (Deactiveren kan ook via "Actief".)`)) return;
  await api(`/admin/users/${u.id}`, { method: 'DELETE' }).catch((e) => alert(e.message));
  loadUsers();
}

$('#new-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  showError(f, '');
  try {
    const { user, temp_password } = await api('/admin/users', {
      method: 'POST',
      body: { name: f.name.value, email: f.email.value, party: f.party.value || null, phone: f.phone.value, is_admin: f.is_admin.checked },
    });
    const box = $('#new-user-result');
    box.hidden = false;
    box.replaceChildren(
      el('b', {}, `${user.name} aangemaakt.`),
      el('br'),
      'Geef deze gegevens door:',
      el('pre', {}, `Site: ${location.origin}\nE-mail: ${user.email}\nTijdelijk paswoord: ${temp_password}`)
    );
    f.reset();
    loadUsers();
  } catch (err) {
    showError(f, err.message);
  }
});

$('#wa-test').addEventListener('click', async () => {
  const { provider } = await api('/admin/whatsapp-test', { method: 'POST', body: {} });
  $('#wa-test-result').textContent =
    provider === 'none' ? 'Provider is "none": het bericht staat enkel in de serverlog.' : 'Verstuurd naar alle gebruikers met een ingesteld GSM-nummer.';
});

boot();
