'use strict';
/* Dhismaha Maamul — frontend (vanilla JS) */

const EXPENSE_CATS = ['Alaab', 'Shaqaale', 'Gaadiid', 'Kiro', 'Kale'];

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'invoices', label: 'Invoice-yada', icon: '🧾' },
  { id: 'receivables', label: 'Lacag qabasho', icon: '⏳' },
  { id: 'payouts', label: 'Lacag bixin', icon: '💵' },
  { id: 'customers', label: 'Macaamiil', icon: '👥' },
  { id: 'items', label: 'Alaabta', icon: '🧱' },
  { id: 'expenses', label: 'Kharash', icon: '💸' },
  { id: 'reports', label: 'Xisaab', icon: '📊' },
  { id: 'settings', label: 'Settings', icon: '⚙️', admin: true },
  { id: 'users', label: 'Users', icon: '🛡️', admin: true }
];

const state = { token: localStorage.getItem('dh_token'), user: null, view: 'dashboard', custQuery: '' };

// CSS-ka invoice-ka daabacaadda. Waa in uu isku mid yahay styles.css-ka qaybta "Invoice".
const INV_CSS = `
.inv-head{background:var(--accent);color:#fff;padding:18px 22px;display:flex;justify-content:space-between;align-items:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.inv-head h2{margin:0;font-size:24px;letter-spacing:1px;color:#fff}
.inv-head small{color:rgba(255,255,255,.85)}
.inv-title{font-size:26px;font-weight:700;letter-spacing:2px}
.inv-meta{display:flex;justify-content:space-between;padding:16px 22px;gap:20px}
.inv-table{width:calc(100% - 44px);margin:0 22px;border-collapse:collapse}
.inv-table th{background:var(--accent);color:#fff;padding:8px;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.inv-table td{padding:8px;border-bottom:0}
.inv-table tbody tr:nth-child(even) td{background:rgba(46,61,130,.07);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.inv-totals{display:flex;flex-direction:column;align-items:flex-end;gap:6px;padding:14px 22px}
.inv-foot{display:flex;justify-content:space-between;gap:20px;padding:14px 22px;white-space:pre-line}
.inv-contact{background:var(--accent);color:#fff;padding:10px 22px;text-align:center;margin-top:18px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
`;

// ---------- Utils ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formData = f => Object.fromEntries(new FormData(f));
const sumOf = (list, fn) => list.reduce((s, x) => s + fn(x), 0);
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const pill = s => `<span class="pill-s ${s}">${s === 'paid' ? 'La bixiyay' : s === 'partial' ? 'Qayb' : 'Baaqi'}</span>`;
const kpi = (label, value, cls = '', icon = '') => `<div class="kpi ${cls}"><div class="kpi-txt"><small>${label}</small><strong>${value}</strong></div>${icon ? `<span class="kpi-ico">${icon}</span>` : ''}</div>`;

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  const box = $('#toasts');
  if (box) box.appendChild(t); else document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ---------- API ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token && !url.startsWith('/api/auth/')) forget();
  if (!res.ok) throw new Error(data.error || 'Khalad ayaa dhacay');
  return data;
}

// Ficil kasta: fal, fariin, kadibna dib u rendeer
async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    closeModal();
    render();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

function bindDel(root, base, msg, question = 'Tirtir?') {
  root.querySelectorAll('.del').forEach(b => b.onclick = () => {
    if (confirm(question)) act(() => api('DELETE', base + b.dataset.id), msg);
  });
}

function bindInvoiceLinks(root) {
  root.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => openInvoice(b.dataset.inv));
}

// ---------- Modal ----------
function openModal(html, cls = '') {
  closeModal();
  const o = document.createElement('div');
  o.id = 'modal';
  o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  o.onclick = e => { if (e.target === o) closeModal(); };
  o.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  document.body.appendChild(o);
  return o;
}
function closeModal() {
  const m = $('#modal');
  if (m) m.remove();
}

// ---------- Session ----------
function forget() {
  localStorage.removeItem('dh_token');
  state.token = null;
  state.user = null;
  renderAuth();
}
async function logout() {
  try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ }
  forget();
}

async function boot() {
  if (state.token) {
    try {
      state.user = (await api('GET', '/api/auth/me')).user;
      return renderShell();
    } catch { /* token dhacay */ }
  }
  renderAuth();
}

// ---------- Auth ----------
async function renderAuth() {
  let hasUsers = true;
  try { hasUsers = (await api('GET', '/api/auth/status')).hasUsers; } catch { /* ignore */ }
  const setup = !hasUsers;
  $('#app').innerHTML = `
  <div class="auth-wrap"><div class="auth-card">
    <div class="brand-mark">🏗️</div>
    <h1>Dhismaha Maamul</h1>
    <p class="muted">${setup ? 'Admin-ka ugu horreeya samee' : 'Gali akoonkaaga'}</p>
    <form id="authForm" class="form" style="margin-top:18px">
      ${setup ? '<input name="name" placeholder="Magaca admin-ka" required>' : ''}
      <input name="email" type="email" placeholder="Email" required>
      <input name="password" type="password" placeholder="Password (ugu yaraan 6)" required>
      <button class="btn primary block">${setup ? 'Samee admin' : 'Gali'}</button>
    </form>
  </div></div>`;

  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await api('POST', setup ? '/api/auth/setup' : '/api/auth/login', formData(e.target));
      state.token = r.token;
      state.user = r.user;
      localStorage.setItem('dh_token', r.token);
      renderShell();
    } catch (err) {
      toast(err.message, 'bad');
    }
  };
}

// ---------- Shell ----------
// Muuqaalka: default cad (isku mid telefon iyo kombiyuutar). Badhanka ayaa mugdi u beddela, doorashadana waa la xasuustaa.
const THEME_KEY = 'dh_theme';
function applyTheme() {
  let t = 'light';
  try { t = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { /* ignore */ }
  document.documentElement.dataset.theme = t;
}
const themeIcon = () => (document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙');
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  applyTheme();
  const b = $('#themeBtn');
  if (b) b.textContent = themeIcon();
}

function topbarHtml() {
  const initials = esc((state.user.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  return `<header class="topbar">
    <div class="search"><span>🔍</span><input id="globalSearch" placeholder="Raadi invoice (INV-0001) ama macmiil" autocomplete="off"></div>
    <div class="top-right"><span class="bell" title="Ogeysiisyo">🔔</span><button class="theme-btn" id="themeBtn" title="Beddel muuqaalka">${themeIcon()}</button><span class="avatar">${initials}</span></div>
  </header>`;
}
async function searchEnter(e) {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  try {
    const [{ invoices }, { customers }] = await Promise.all([api('GET', '/api/invoices'), api('GET', '/api/customers')]);
    const invHit = invoices.find(i => i.no.toLowerCase() === q) || invoices.find(i => i.no.toLowerCase().includes(q));
    if (invHit) return openInvoice(invHit.id);
    if (customers.some(c => custMatches(c, q))) {
      state.custQuery = q;
      state.view = 'customers';
      return renderShell();
    }
    toast('Ma helin: ' + q, 'bad');
  } catch (err) { toast(err.message, 'bad'); }
}
// Macaamiil waxaa la raadiyaa magaca, telefoonka, cinwaanka, iyo xogta damiinka
function custMatches(c, q) {
  const g = c.guarantor || {};
  return [c.name, c.phone, c.address, g.name, g.phone, g.address]
    .some(v => String(v || '').toLowerCase().includes(q));
}

function renderShell() {
  const nav = NAV.filter(n => !n.admin || state.user.role === 'admin');
  if (!nav.some(n => n.id === state.view)) state.view = 'dashboard';
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="logo">🏗️ Dhismaha</div>
      <nav>
        ${nav.map(n => `<button class="nav-btn ${state.view === n.id ? 'active' : ''}" data-view="${n.id}"><span class="ico">${n.icon}</span>${n.label}</button>`).join('')}
      </nav>
      <div class="me">
        <div><strong>${esc(state.user.name)}</strong><br><small>${esc(state.user.role)}</small></div>
        <button class="btn ghost-dark small" id="logoutBtn">Ka bax</button>
      </div>
    </aside>
    <main class="main">${topbarHtml()}<div id="view"></div></main>
  </div>`;

  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    state.view = b.dataset.view;
    state.custQuery = '';
    renderShell();
  });
  $('#logoutBtn').onclick = logout;
  $('#globalSearch').onkeydown = searchEnter;
  $('#themeBtn').onclick = toggleTheme;
  render();
}

const VIEWS = {
  dashboard: viewDashboard,
  invoices: viewInvoices,
  receivables: viewReceivables,
  payouts: viewPayouts,
  customers: viewCustomers,
  items: viewItems,
  expenses: viewExpenses,
  reports: viewReports,
  settings: viewSettings,
  users: viewUsers
};

async function render() {
  const el = $('#view');
  if (!el) return;
  el.innerHTML = '<p class="muted">Wuu soo raraya...</p>';
  try {
    await VIEWS[state.view](el);
  } catch (e) {
    el.innerHTML = `<div class="card"><p class="bad">${esc(e.message)}</p></div>`;
  }
}

function invTable(list, withBtn = true) {
  if (!list.length) return '<p class="muted">Invoice ma jiro.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>No</th><th>Macmiil</th><th>Taariikh</th><th class="r">Wadar</th><th class="r">Baaqi</th><th>Xaalad</th><th></th></tr></thead>
    <tbody>${list.map(i => `<tr>
      <td><b>${esc(i.no)}</b></td>
      <td>${esc(i.customerName)}</td>
      <td>${esc(i.date)}</td>
      <td class="r">${money(i.total)}</td>
      <td class="r ${i.remaining > 0 ? 'bad' : 'good'}">${money(i.remaining)}</td>
      <td>${pill(i.status)}</td>
      <td>${withBtn ? `<button class="link" data-inv="${i.id}">Fur</button>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

// ---------- Dashboard ----------
function lineChart(months) {
  const W = 640, H = 230, P = 26;
  const max = Math.max(1, ...months.flatMap(m => [m.sales, m.received, m.expenses]));
  const x = i => P + (i * (W - 2 * P)) / Math.max(1, months.length - 1);
  const y = v => H - P - (v / max) * (H - 2 * P);
  const path = key => months.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(m[key]).toFixed(1)}`).join(' ');
  const area = key => `${path(key)} L${x(months.length - 1).toFixed(1)},${H - P} L${x(0).toFixed(1)},${H - P} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const yy = (H - P - f * (H - 2 * P)).toFixed(1);
    return `<line x1="${P}" x2="${W - P}" y1="${yy}" y2="${yy}" class="gl"/>`;
  }).join('');
  const labels = months.map((m, i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ax">${m.month.slice(5)}</text>`).join('');
  return `<div class="linewrap"><svg viewBox="0 0 ${W} ${H}" class="linechart" role="img" aria-label="Iib, helay iyo kharash">
    ${grid}
    <path d="${area('sales')}" class="ar-s"/>
    <path d="${path('sales')}" class="ln ln-s"/>
    <path d="${path('received')}" class="ln ln-r"/>
    <path d="${path('expenses')}" class="ln ln-e"/>
    ${labels}
  </svg></div>`;
}

// Task-yada: browser-ka kaliya (localStorage)
const TASK_KEY = 'dh_tasks';
function loadTasks() {
  try { return JSON.parse(localStorage.getItem(TASK_KEY)) || []; } catch { return []; }
}
function saveTasks(t) {
  try { localStorage.setItem(TASK_KEY, JSON.stringify(t)); } catch { /* browser-ka xog kaydin ma oggola */ }
}
function tasksHtml() {
  const t = loadTasks();
  return `<div class="tasks">
    ${t.length ? t.map((x, i) => `<div class="task ${x.done ? 'done' : ''}">
      <input type="checkbox" data-task="${i}" ${x.done ? 'checked' : ''}>
      <span>${esc(x.text)}</span>
      <button class="link danger" data-deltask="${i}" title="Tirtir">✕</button>
    </div>`).join('') : '<p class="muted">Task ma jiro.</p>'}
    <form id="taskForm" class="task-add"><input name="text" placeholder="+ Task cusub" required></form>
  </div>`;
}
function bindTasks(el) {
  el.querySelectorAll('[data-task]').forEach(c => c.onchange = () => {
    const t = loadTasks(); t[c.dataset.task].done = c.checked; saveTasks(t); render();
  });
  el.querySelectorAll('[data-deltask]').forEach(b => b.onclick = () => {
    const t = loadTasks(); t.splice(Number(b.dataset.deltask), 1); saveTasks(t); render();
  });
  const f = el.querySelector('#taskForm');
  if (f) f.onsubmit = e => {
    e.preventDefault();
    const text = formData(e.target).text.trim();
    if (!text) return;
    const t = loadTasks(); t.push({ text, done: false }); saveTasks(t); render();
  };
}

async function viewDashboard(el) {
  const d = await api('GET', '/api/dashboard');
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Dashboard</h2><p class="muted">Xaaladda shirkadda · ${todayStr()}</p></div>
  </header>
  <section class="kpis">
    ${kpi('Iibka guud (Sales)', money(d.sales), '', '🧾')}
    ${kpi('Lacag la helay', money(d.received), 'green', '💰')}
    ${kpi('Lacag qabasho (baaqi)', money(d.receivable), 'coral', '⏳')}
    ${kpi('Kharashka guud', money(d.expenses), 'orange', '💸')}
  </section>
  <section class="grid-split">
    <div class="card">
      <h3>Iib, helay iyo kharash (6 bilood)</h3>
      ${lineChart(d.months)}
      <div class="legend"><span class="lg-s">Iib</span><span class="lg-r">Helay</span><span class="lg-e">Kharash</span></div>
    </div>
    <div class="card">
      <h3>Task</h3>
      ${tasksHtml()}
    </div>
  </section>
  <section class="grid-2">
    <div class="card ring-card">
      <h3>Ururinta lacagta</h3>
      <div class="ring" style="--p:${d.rate}"><span>${d.rate}%</span></div>
      <p class="muted">Faa'iido (cash): <b class="${d.profit >= 0 ? 'good' : 'bad'}">${money(d.profit)}</b></p>
    </div>
    <div class="card">
      <h3>Alaabta hoose (≤ 5)</h3>
      ${d.lowStock.length
        ? d.lowStock.map(i => `<div class="list-row"><span>${esc(i.name)}</span><b class="bad">${i.stock} ${esc(i.unit)}</b></div>`).join('')
        : '<p class="muted">Stock-ku waa ku filan.</p>'}
    </div>
  </section>
  <section class="card">
    <h3>Invoice-yadii ugu dambeeyay</h3>
    ${invTable(d.recent)}
  </section>`;
  bindInvoiceLinks(el);
  bindTasks(el);
}

// ---------- Invoices ----------
async function viewInvoices(el) {
  const [{ invoices }, { customers }, { items }, { settings }] = await Promise.all([
    api('GET', '/api/invoices'),
    api('GET', '/api/customers'),
    api('GET', '/api/items'),
    api('GET', '/api/settings')
  ]);
  const canNew = items.length > 0;
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Invoice-yada</h2><p class="muted">Alaabta la iibiyay macaamiisha</p></div>
    <button class="btn primary" id="newInv" ${canNew ? '' : 'disabled'}>+ Invoice cusub</button>
  </header>
  ${!items.length ? '<p class="muted">Marka hore alaab ku dar.</p>' : ''}
  <section class="card">${invTable(invoices)}</section>`;
  if (canNew) $('#newInv').onclick = () => openInvoiceForm(customers, items, settings);
  bindInvoiceLinks(el);
}

// Foomka invoice-ka: sida naqshadda "Create New Invoice" — bidix foom, midig preview
function openInvoiceForm(customers, items, settings) {
  const rate = Number(settings.vatRate) || 0;
  const itemList = items.map(i => `<option value="${esc(i.name)}"></option>`).join('');

  const o = openModal(`
    <div class="inv-page-head">
      <button type="button" class="link" data-close>← Back</button>
      <h2>Create New Invoice</h2>
      <button type="button" class="link" data-close>✕</button>
    </div>
    <div class="inv-builder">
      <form id="invForm" class="inv-panel form">
        <h4 class="panel-title">Invoice Details</h4>

        <div class="form-section">
          <span class="form-label">Customer *</span>
          <input name="customerName" id="custName" list="custList" placeholder="Qor ama dooro magaca macmiilka" autocomplete="off" required>
          <datalist id="custList">${customers.map(c => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>
          <small id="custHint" class="hint-line"></small>
        </div>

        <div class="form-section">
          <span class="form-label">Billing Address</span>
          <input id="billAddr" readonly placeholder="Cinwaanka macmiilka (macmiil jira)">
        </div>

        <div class="form-section">
          <span class="form-label">Issue Date *</span>
          <input name="date" id="dateIn" type="date" value="${todayStr()}" required>
        </div>

        <div class="form-section">
          <span class="form-label">Items Details *</span>
          <div class="items-head"><span>Item</span><span>Qty</span><span>Cost ($)</span><span class="r">Amount</span><span></span></div>
          <datalist id="itemList">${itemList}</datalist>
          <div id="lines" class="form"></div>
          <button type="button" class="btn ghost-dark small" id="addLine" style="justify-self:start">+ Add Item</button>
        </div>

        <div class="inv-summary">
          <div class="srow"><span>Subtotal</span><b id="sub">$0.00</b></div>
          <div class="srow"><span>VAT (${rate}%)</span><b id="vat">$0.00</b></div>
          <div class="srow grand"><span>Total</span><b id="grand">$0.00</b></div>
        </div>

        <button class="btn primary block">Send Invoice</button>
      </form>

      <div class="inv-panel">
        <h4 class="panel-title">Preview</h4>
        <div id="invPreview" class="inv-preview"></div>
      </div>
    </div>`, 'wide');

  const linesEl = o.querySelector('#lines');
  const custInput = o.querySelector('#custName');
  const custHint = o.querySelector('#custHint');
  const billAddr = o.querySelector('#billAddr');
  const dateIn = o.querySelector('#dateIn');
  const previewEl = o.querySelector('#invPreview');

  // Magaca la qoray ayaa macmiil jira ah ka raadiya (xarfaha weyn/yar ma kala sooci karo)
  const findCust = name => {
    const n = String(name || '').trim().toLowerCase();
    return n ? customers.find(c => c.name.trim().toLowerCase() === n) : undefined;
  };

  // Alaabta magaceeda la qoray: haddii ay hore u jirto, qiimaha iyo stock-ka ayaa la isticmaalaa
  const findItem = name => {
    const n = String(name || '').trim().toLowerCase();
    return n ? items.find(i => i.name.trim().toLowerCase() === n) : undefined;
  };

  const updateCust = () => {
    const name = custInput.value.trim();
    const c = findCust(name);
    billAddr.value = c ? (c.address || '') : '';
    custHint.textContent = !name ? '' : c
      ? `Macmiil jira · Baaqi: ${money(c.balance)} · Akoon: ${money(c.akoon)}`
      : 'Macmiil cusub — waa la diiwaangelinayaa.';
  };

  // Preview-ka: wuxuu u eg yahay invoice-ka dhab ah, wuxuuna toos u beddelaa
  const renderPreview = (lines, sub, vat, total) => {
    const name = custInput.value.trim() || '—';
    const rowsHtml = lines.length
      ? lines.map(l => `<tr>
          <td>${esc(l.name)}</td>
          <td>${l.qty}</td>
          <td class="r">${money(l.price)}</td>
          <td class="r">${money(l.total)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="muted">Alaab ku dar</td></tr>';
    previewEl.innerHTML = `
      ${invHeadHtml(settings)}
      <div class="inv-meta">
        <div><small>Macmiilka</small><br><b>${esc(name)}</b></div>
        <div class="r"><b>Invoice cusub</b><br><small>${esc(dateIn.value)}</small></div>
      </div>
      <table class="inv-table">
        <thead><tr><th>Alaab</th><th>Tiro</th><th class="r">Qiime</th><th class="r">Wadar</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="inv-totals">
        <div>Subtotal: <b>${money(sub)}</b></div>
        <div>VAT (${rate}%): <b>${money(vat)}</b></div>
        <div class="inv-grand">Wadar: <b>${money(total)}</b></div>
      </div>
      ${invFootHtml(settings)}`;
  };

  const recalc = () => {
    const lines = [];
    let g = 0;
    linesEl.querySelectorAll('.item-row').forEach(r => {
      const q = Number(r.querySelector('[name=qty]').value) || 0;
      const p = Number(r.querySelector('[name=price]').value) || 0;
      const t = q * p;
      r.querySelector('.ltotal').textContent = money(t);
      lines.push({ name: r.querySelector('[name=itemName]').value.trim(), qty: q, price: p, total: t });
      g += t;
    });
    // VAT: g * rate / 100 (cents-ka oo la wareejiyay)
    const vat = Math.round(g * rate) / 100;
    const total = g + vat;
    o.querySelector('#sub').textContent = money(g);
    o.querySelector('#vat').textContent = money(vat);
    o.querySelector('#grand').textContent = money(total);
    updateCust();
    renderPreview(lines, g, vat, total);
  };

  custInput.oninput = recalc;
  dateIn.onchange = recalc;

  const addRow = () => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <input name="itemName" list="itemList" placeholder="Magaca alaabta" autocomplete="off" required>
      <input name="qty" type="number" step="0.01" min="0.01" value="1" required>
      <input name="price" type="number" step="0.01" min="0" required>
      <b class="ltotal">$0.00</b>
      <button type="button" class="link danger" title="Tirtir">🗑</button>`;
    const nameIn = row.querySelector('[name=itemName]');
    const price = row.querySelector('[name=price]');
    const onName = () => {
      const it = findItem(nameIn.value);
      if (it && price.dataset.touched !== '1') price.value = it.price;
      recalc();
    };
    nameIn.oninput = onName;
    nameIn.onchange = onName;
    row.querySelector('[name=qty]').oninput = recalc;
    price.oninput = () => { price.dataset.touched = '1'; recalc(); };
    row.querySelector('.danger').onclick = () => { row.remove(); recalc(); };
    linesEl.appendChild(row);
  };

  o.querySelector('#addLine').onclick = addRow;
  addRow();

  o.querySelector('#invForm').onsubmit = e => {
    e.preventDefault();
    const fd = formData(e.target);
    const lines = [...linesEl.querySelectorAll('.item-row')].map(r => ({
      itemName: r.querySelector('[name=itemName]').value,
      qty: r.querySelector('[name=qty]').value,
      price: r.querySelector('[name=price]').value
    }));
    const c = findCust(fd.customerName);
    act(() => api('POST', '/api/invoices', {
      customerId: c ? c.id : '',
      customerName: fd.customerName.trim(),
      date: fd.date,
      lines
    }), 'Invoice waa la sameeyay');
  };
}

// Madhan invoice-ka: shirkadda, bangiga, terms, footer (settings-ka ayaa ka imanaya)
const invHeadHtml = s => `<div class="inv-head" style="--accent:${esc(s.accent)}">
  <div><h2>${esc(s.company)}</h2><small>${esc(s.slogan)}</small></div>
  <div class="inv-title">INVOICE</div>
</div>`;

const invFootHtml = s => `<div class="inv-foot">
  <div><b>PAYMENT METHOD</b><br>${esc(s.bankName)}<br>${esc(s.bankAccount)}</div>
  <div><b>TERMS &amp; CONDITIONS</b><br>${esc(s.terms)}</div>
</div>
<div class="inv-contact">${[s.email, s.phone, s.website].filter(Boolean).map(v => esc(v)).join(' · ')}</div>`;

// Invoice-ka bog cusub ayaa lagu daabacaa (browser-ka desktop-ka iyo telefoonka way shaqeeyaan)
function printInvoice() {
  const area = $('#printArea');
  if (!area) return;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return toast('Popup-ka browser-ka xidhay. Ogolow popup si aad u daabacdo', 'bad');
  w.document.write(`<!doctype html><html lang="so"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Invoice</title>
    <style>
      @page { size: A4; margin: 0; }
      body { margin: 0; font-family: "Segoe UI", system-ui, Arial, sans-serif; color: #111; }
      ${INV_CSS}
    </style></head><body><div style="${area.getAttribute('style') || ''}">${area.innerHTML}</div></body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 300);
}

async function openInvoice(id) {
  let inv, s;
  try {
    [inv, { settings: s }] = await Promise.all([
      api('GET', '/api/invoices/' + id),
      api('GET', '/api/settings')
    ]);
  } catch (e) { return toast(e.message, 'bad'); }

  openModal(`
    <div class="modal-head"><h3>${esc(inv.no)}</h3><button class="link" data-close>✕</button></div>
    <div class="actions no-print">
      <button class="btn primary" id="printBtn">🖨️ Daabac / PDF</button>
      ${inv.remaining > 0 ? '<button class="btn ghost-dark" id="payBtn">💵 Lacag ka qaado</button>' : ''}
      <button class="btn danger-dark" id="delInv">Tirtir</button>
    </div>
    <div id="printArea" class="print-area" style="--accent:${esc(s.accent)}">
      ${invHeadHtml(s)}
      <div class="inv-meta">
        <div><small>Macmiilka</small><br><b>${esc(inv.customerName)}</b></div>
        <div class="r"><b>${esc(inv.no)}</b><br><small>Taariikh: ${esc(inv.date)}</small></div>
      </div>
      <table class="inv-table">
        <thead><tr><th>Alaab</th><th>Tiro</th><th class="r">Qiime</th><th class="r">Wadar</th></tr></thead>
        <tbody>${inv.lines.map(l => `<tr>
          <td>${esc(l.name)}</td>
          <td>${l.qty}</td>
          <td class="r">${money(l.price)}</td>
          <td class="r">${money(l.total)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="inv-totals">
        <div>Subtotal: <b>${money(inv.subtotal ?? inv.total)}</b></div>
        <div>VAT (${inv.vatRate ?? 0}%): <b>${money(inv.vat ?? 0)}</b></div>
        <div>Wadar: <b>${money(inv.total)}</b></div>
      </div>
      ${invFootHtml(s)}
    </div>
    <h4 class="no-print" style="margin-top:6px">Lacag bixinta</h4>
    <div class="no-print">${inv.payments.length
      ? inv.payments.map(p => `<div class="list-row"><span>${esc(p.date)} ${esc(p.note)}</span><b class="good">${money(p.amount)}</b></div>`).join('')
      : '<p class="muted">Weli lacag ma bixin.</p>'}</div>`, '');

  $('#printBtn').onclick = printInvoice;
  if ($('#payBtn')) $('#payBtn').onclick = () => openPaymentForm(inv.id);
  $('#delInv').onclick = () => {
    if (confirm('Invoice-kan ma tirtirtaa? Alaabta stock-keeda waa la soo celinayaa.')) {
      act(() => api('DELETE', '/api/invoices/' + inv.id), 'Invoice-ka waa la tirtiray');
    }
  };
}

// ---------- Lacag qabasho (lacagta macaamiilka ka timaadda) ----------
function receiptsTable(list) {
  if (!list.length) return '<p class="muted">Lacag ma jirto.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Taariikh</th><th>Macmiil</th><th>Invoice</th><th>Nooca</th><th>Fiiro</th><th class="r">Lacag</th><th></th></tr></thead>
    <tbody>${list.map(p => `<tr>
      <td>${esc(p.date)}</td>
      <td>${esc(p.customerName)}</td>
      <td>${esc(p.invoiceNo)}</td>
      <td>${p.kind === 'akoon' ? 'Akoon' : 'Lacag cusub'}</td>
      <td>${esc(p.note)}</td>
      <td class="r good">${money(p.amount)}</td>
      <td><button class="link danger del" data-id="${p.id}">✕</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

async function viewReceivables(el) {
  const [{ invoices }, { payments }, { customers }] = await Promise.all([
    api('GET', '/api/invoices'),
    api('GET', '/api/payments'),
    api('GET', '/api/customers')
  ]);
  const open = invoices.filter(i => i.remaining > 0);
  const total = sumOf(open, i => i.remaining);
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Lacag qabasho</h2><p class="muted">Macaamiisha lacagta weli ku leh: <b class="bad">${money(total)}</b></p></div>
    <button class="btn primary" id="newRec" ${customers.length ? '' : 'disabled'}>+ Lacag qabasho</button>
  </header>
  <section class="card">${open.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Macmiil</th><th>Invoice</th><th>Taariikh</th><th class="r">Baaqi</th><th></th></tr></thead>
        <tbody>${open.map(i => `<tr>
          <td>${esc(i.customerName)}</td>
          <td>${esc(i.no)}</td>
          <td>${esc(i.date)}</td>
          <td class="r bad">${money(i.remaining)}</td>
          <td><button class="btn small primary" data-pay="${i.id}">Lacag ka qaado</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<p class="muted">Baaqi ma jiro. ✅</p>'}
  </section>
  <section class="card"><h3>Lacag qabashada</h3>${receiptsTable(payments)}</section>`;
  $('#newRec').onclick = () => openPaymentForm();
  el.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => openPaymentForm(b.dataset.pay));
  bindDel(el, '/api/payments/', 'Lacagta waa la tirtiray');
}

async function openPaymentForm(preInvoiceId) {
  let invoices, customers;
  try {
    ({ invoices } = await api('GET', '/api/invoices'));
    ({ customers } = await api('GET', '/api/customers'));
  } catch (e) { return toast(e.message, 'bad'); }
  if (!customers.length) return toast('Marka hore macaamiil ku dar', 'bad');
  const pre = invoices.find(i => i.id === preInvoiceId);
  const preCust = pre ? pre.customerId : customers[0].id;
  const o = openModal(`
    <div class="modal-head"><h3>Lacag qabasho</h3><button class="link" data-close>✕</button></div>
    <form id="payForm" class="form">
      <select name="customerId" required>${customers.map(c => `<option value="${c.id}" ${c.id === preCust ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select name="invoiceId"></select>
      <select name="source">
        <option value="cash">Lacag cusub (cash)</option>
        <option value="akoon">Akoonka macaamiilka</option>
      </select>
      <input name="amount" type="number" step="0.01" min="0.01" placeholder="Lacagta $" required>
      <input name="date" type="date" value="${todayStr()}" required>
      <input name="note" placeholder="Fiiro (ikhtiyaari)">
      <p class="muted" id="payHint"></p>
      <button class="btn primary block">Kaydi lacagta</button>
    </form>`);
  const cust = o.querySelector('[name=customerId]');
  const invSel = o.querySelector('[name=invoiceId]');
  const src = o.querySelector('[name=source]');
  const amt = o.querySelector('[name=amount]');
  const hint = o.querySelector('#payHint');

  const syncInvoice = () => {
    const inv = invoices.find(i => i.id === invSel.value);
    const c = customers.find(x => x.id === cust.value);
    src.style.display = inv ? '' : 'none';
    if (inv) {
      amt.max = inv.remaining;
      amt.value = inv.remaining.toFixed(2);
      hint.textContent = `Baaqi: ${money(inv.remaining)} · Akoon: ${money(c.akoon)}`;
    } else {
      amt.removeAttribute('max');
      hint.textContent = 'Lacagtan waxay u gelaysaa akoonka macaamiilka.';
    }
  };
  const fillInvoices = () => {
    const list = invoices.filter(i => i.customerId === cust.value && i.remaining > 0);
    invSel.innerHTML = `<option value="">— Invoice la'aan (akoon) —</option>` + list.map(i =>
      `<option value="${i.id}" ${i.id === preInvoiceId ? 'selected' : ''}>${esc(i.no)} · baaqi ${money(i.remaining)}</option>`).join('');
    syncInvoice();
  };
  cust.onchange = fillInvoices;
  invSel.onchange = syncInvoice;
  fillInvoices();

  o.querySelector('#payForm').onsubmit = e => {
    e.preventDefault();
    const d = formData(e.target);
    const body = {
      customerId: d.customerId,
      invoiceId: d.invoiceId || '',
      source: d.invoiceId ? d.source : 'cash',
      amount: Number(d.amount),
      date: d.date,
      note: d.note || ''
    };
    act(() => api('POST', '/api/payments', body), 'Lacagta waa la diiwaangeliyay');
  };
}

// ---------- Lacag bixin (macaamiilka akoonkiisa ka qaadanaya) ----------
function payoutsTable(list) {
  if (!list.length) return '<p class="muted">Lacag bixin ma jirto.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Taariikh</th><th>Macmiil</th><th>Nooca</th><th>Fiiro</th><th class="r">Lacag</th><th></th></tr></thead>
    <tbody>${list.map(p => `<tr>
      <td>${esc(p.date)}</td>
      <td>${esc(p.customerName)}</td>
      <td>${p.customerType === 'milkiile' ? 'Milkiile' : 'Macaamiil'}</td>
      <td>${esc(p.note)}</td>
      <td class="r bad">${money(p.amount)}</td>
      <td><button class="link danger del" data-id="${p.id}">✕</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

async function viewPayouts(el) {
  const [{ payouts }, { customers }] = await Promise.all([
    api('GET', '/api/payouts'),
    api('GET', '/api/customers')
  ]);
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Lacag bixin</h2><p class="muted">Lacagta macaamiilka ama milkiilaha ka qaadanaya akoonkooda</p></div>
    <button class="btn primary" id="newPout" ${customers.length ? '' : 'disabled'}>+ Lacag bixin</button>
  </header>
  <section class="card">${payoutsTable(payouts)}</section>`;
  $('#newPout').onclick = () => openPayoutForm(customers);
  bindDel(el, '/api/payouts/', 'Lacag bixinta waa la tirtiray');
}

function openPayoutForm(customers) {
  const o = openModal(`
    <div class="modal-head"><h3>Lacag bixin</h3><button class="link" data-close>✕</button></div>
    <form id="poutForm" class="form">
      <select name="customerId" required>${customers.map(c => `<option value="${c.id}">${esc(c.name)} · akoon ${money(c.akoon)}</option>`).join('')}</select>
      <input name="amount" type="number" step="0.01" min="0.01" placeholder="Lacagta $" required>
      <input name="date" type="date" value="${todayStr()}" required>
      <input name="note" placeholder="Fiiro (ikhtiyaari)">
      <p class="muted" id="poutHint"></p>
      <button class="btn primary block">Kaydi lacagta</button>
    </form>`);
  const sel = o.querySelector('[name=customerId]');
  const hint = o.querySelector('#poutHint');
  const updateHint = () => {
    const c = customers.find(x => x.id === sel.value);
    if (!c) return;
    const needG = c.type !== 'milkiile' && !(c.guarantor && c.guarantor.name && c.guarantor.phone && c.guarantor.address);
    hint.textContent = needG ? 'Macaamiilkan damiin ma leh: amaah looma oggola ilaa damiin la diiwaangeliyo.' : '';
  };
  sel.onchange = updateHint;
  updateHint();
  o.querySelector('#poutForm').onsubmit = e => {
    e.preventDefault();
    const d = formData(e.target);
    act(() => api('POST', '/api/payouts', { customerId: d.customerId, amount: Number(d.amount), date: d.date, note: d.note || '' }),
      'Lacagta waa la bixiyay');
  };
}

// ---------- Macaamiil (iyo milkiilayaasha) ----------
const customerBody = d => ({
  name: d.name,
  type: d.type,
  phone: d.phone || '',
  address: d.address || '',
  guarantor: { name: d.gName || '', phone: d.gPhone || '', address: d.gAddress || '' }
});

async function viewCustomers(el) {
  const { customers: all } = await api('GET', '/api/customers');
  const q = (state.custQuery || '').toLowerCase();
  const customers = q ? all.filter(c => custMatches(c, q)) : all;
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Macaamiil</h2><p class="muted">Macaamiil iyo milkiilayaasha, baaqigooda iyo akoonkooda</p></div>
    ${q ? `<button class="btn ghost-dark small" id="clearCust">Raadin: "${esc(q)}" · Tirtir ✕</button>` : ''}
  </header>
  <div class="grid-2">
    <form id="custForm" class="card form">
      <h3>Macmiil cusub</h3>
      <input name="name" placeholder="Magaca" required>
      <select name="type">
        <option value="macaamiil">Macaamiil</option>
        <option value="milkiile">Milkiile (milkiilaha shirkada)</option>
      </select>
      <input name="phone" placeholder="Telefoon">
      <input name="address" placeholder="Cinwaan / goob">
      <h4 style="margin-top:6px">Damiin (amaah qaadanaya)</h4>
      <input name="gName" placeholder="Magaca damiinka">
      <input name="gPhone" placeholder="Telefoonka damiinka">
      <input name="gAddress" placeholder="Goobta damiinka">
      <button class="btn primary">Kaydi</button>
    </form>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Magaca</th><th class="r">Baaqi</th><th class="r">Akoon</th><th></th></tr></thead>
      <tbody>${customers.map(c => `<tr>
        <td>${esc(c.name)} ${c.type === 'milkiile' ? '<small>(milkiile)</small>' : ''}<small class="block">${esc(c.phone)} ${esc(c.address)}</small></td>
        <td class="r ${c.balance > 0 ? 'bad' : 'good'}">${money(c.balance)}</td>
        <td class="r ${c.akoon < 0 ? 'bad' : 'good'}">${c.akoon < 0 ? 'Amaah ' + money(-c.akoon) : money(c.akoon)}</td>
        <td>
          <button class="link" data-edit="${c.id}">Wax ka beddel</button>
          <button class="link danger del" data-id="${c.id}" ${c.invoices ? 'disabled' : ''}>✕</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Macmiil ma jiro.</td></tr>'}</tbody>
    </table></div></div>
  </div>`;
  $('#custForm').onsubmit = e => {
    e.preventDefault();
    act(() => api('POST', '/api/customers', customerBody(formData(e.target))), 'Macmiilka waa la kaydiyay');
  };
  const clr = $('#clearCust');
  if (clr) clr.onclick = () => { state.custQuery = ''; render(); };
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
    openCustomerEdit(customers.find(c => c.id === b.dataset.edit)));
  bindDel(el, '/api/customers/', 'Macmiilka waa la tirtiray');
}

function openCustomerEdit(c) {
  const g = c.guarantor || {};
  const o = openModal(`
    <div class="modal-head"><h3>Wax ka beddel: ${esc(c.name)}</h3><button class="link" data-close>✕</button></div>
    <form id="custEdit" class="form">
      <input name="name" value="${esc(c.name)}" required>
      <select name="type">
        <option value="macaamiil" ${c.type !== 'milkiile' ? 'selected' : ''}>Macaamiil</option>
        <option value="milkiile" ${c.type === 'milkiile' ? 'selected' : ''}>Milkiile</option>
      </select>
      <input name="phone" value="${esc(c.phone)}" placeholder="Telefoon">
      <input name="address" value="${esc(c.address)}" placeholder="Cinwaan / goob">
      <h4 style="margin-top:6px">Damiin</h4>
      <input name="gName" value="${esc(g.name || '')}" placeholder="Magaca damiinka">
      <input name="gPhone" value="${esc(g.phone || '')}" placeholder="Telefoonka damiinka">
      <input name="gAddress" value="${esc(g.address || '')}" placeholder="Goobta damiinka">
      <button class="btn primary block">Kaydi isbeddelka</button>
    </form>`);
  o.querySelector('#custEdit').onsubmit = e => {
    e.preventDefault();
    act(() => api('PUT', '/api/customers/' + c.id, customerBody(formData(e.target))), 'Macmiilka waa la cusboonaysiiyay');
  };
}

// ---------- Alaabta ----------
async function viewItems(el) {
  const { items } = await api('GET', '/api/items');
  const value = sumOf(items, i => i.price * i.stock);
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Alaabta (Stock)</h2><p class="muted">Qiimaha stock-ka guud: <b>${money(value)}</b></p></div>
  </header>
  <div class="grid-2">
    <form id="itemForm" class="card form">
      <h3>Alaab cusub</h3>
      <input name="name" placeholder="Magaca (tusaale: Shamiito)" required>
      <div class="row">
        <input name="unit" placeholder="Unug (bac, tan, m³)">
        <input name="price" type="number" step="0.01" min="0" placeholder="Qiimaha $" required>
      </div>
      <input name="stock" type="number" step="0.01" min="0" placeholder="Stock-ka bilowga">
      <button class="btn primary">Kaydi</button>
    </form>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Alaab</th><th class="r">Qiime</th><th class="r">Stock</th><th></th></tr></thead>
      <tbody>${items.map(i => `<tr>
        <td>${esc(i.name)}<small class="block">${esc(i.unit)}</small></td>
        <td class="r">${money(i.price)}</td>
        <td class="r ${i.stock <= 5 ? 'bad' : ''}">${i.stock}</td>
        <td>
          <button class="link stock" data-id="${i.id}" data-stock="${i.stock}">Stock</button>
          <button class="link danger del" data-id="${i.id}">✕</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Alaab ma jirto.</td></tr>'}</tbody>
    </table></div></div>
  </div>`;
  $('#itemForm').onsubmit = e => {
    e.preventDefault();
    act(() => api('POST', '/api/items', formData(e.target)), 'Alaabta waa la kaydiyay');
  };
  el.querySelectorAll('.stock').forEach(b => b.onclick = () => {
    const v = prompt('Stock-ka cusub (tirada guud):', b.dataset.stock);
    if (v !== null) act(() => api('PUT', '/api/items/' + b.dataset.id, { stock: v }), 'Stock-ka waa la beddelay');
  });
  bindDel(el, '/api/items/', 'Alaabta waa la tirtiray');
}

// ---------- Kharash ----------
async function viewExpenses(el) {
  const { expenses } = await api('GET', '/api/expenses');
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Kharashka</h2><p class="muted">Kharashyada shirkadda</p></div>
  </header>
  <div class="grid-2">
    <form id="expForm" class="card form">
      <h3>Kharash cusub</h3>
      <input name="title" placeholder="Sharaxaad (tusaale: Gaadiid)" required>
      <div class="row">
        <select name="category">${EXPENSE_CATS.map(c => `<option>${c}</option>`).join('')}</select>
        <input name="amount" type="number" step="0.01" min="0.01" placeholder="Qadarka $" required>
      </div>
      <input name="date" type="date" value="${todayStr()}" required>
      <button class="btn primary">Kaydi</button>
    </form>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Taariikh</th><th>Sharaxaad</th><th class="r">Qadar</th><th></th></tr></thead>
      <tbody>${expenses.map(x => `<tr>
        <td>${esc(x.date)}</td>
        <td>${esc(x.title)}<small class="block">${esc(x.category)}</small></td>
        <td class="r bad">${money(x.amount)}</td>
        <td><button class="link danger del" data-id="${x.id}">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Kharash ma jiro.</td></tr>'}</tbody>
    </table></div></div>
  </div>`;
  $('#expForm').onsubmit = e => {
    e.preventDefault();
    act(() => api('POST', '/api/expenses', formData(e.target)), 'Kharashka waa la kaydiyay');
  };
  bindDel(el, '/api/expenses/', 'Kharashka waa la tirtiray');
}

// ---------- Xisaab ----------
async function viewReports(el) {
  const r = await api('GET', '/api/reports');
  const tot = r.monthly.reduce((a, m) => ({
    sales: a.sales + m.sales, received: a.received + m.received, expenses: a.expenses + m.expenses
  }), { sales: 0, received: 0, expenses: 0 });
  el.innerHTML = `
  <div id="printArea">
    <header class="page-head">
      <div><h2>Xisaabta</h2><p class="muted">Warbixin bishiiba iyo macaamiisha baaqa leh</p></div>
      <button class="btn ghost-dark no-print" id="printRep">🖨️ PDF / Daabac</button>
    </header>
    <section class="kpis">
      ${kpi('Iib guud', money(tot.sales))}
      ${kpi('Lacag la helay', money(tot.received), 'green')}
      ${kpi('Kharash guud', money(tot.expenses), 'orange')}
      ${kpi("Faa'iido (cash)", money(tot.received - tot.expenses), tot.received - tot.expenses >= 0 ? 'green' : 'coral')}
    </section>
    <section class="card"><h3>Bishiiba</h3><div class="table-wrap"><table>
      <thead><tr><th>Bisha</th><th class="r">Iib</th><th class="r">Helay</th><th class="r">Kharash</th><th class="r">Faa'iido</th></tr></thead>
      <tbody>${r.monthly.map(m => `<tr>
        <td>${esc(m.month)}</td>
        <td class="r">${money(m.sales)}</td>
        <td class="r">${money(m.received)}</td>
        <td class="r">${money(m.expenses)}</td>
        <td class="r ${m.profit >= 0 ? 'good' : 'bad'}">${money(m.profit)}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Xog ma jirto.</td></tr>'}</tbody>
    </table></div></section>
    <section class="card"><h3>Macaamiisha baaqa leh</h3>
      ${r.customers.length
        ? r.customers.map(c => `<div class="list-row"><span>${esc(c.name)}</span><b class="bad">${money(c.balance)}</b></div>`).join('')
        : '<p class="muted">Macaamiil baaqa leh ma jiro.</p>'}
    </section>
  </div>`;
  $('#printRep').onclick = () => window.print();
}

// ---------- Settings (admin): xogta shirkadda iyo muuqaalka invoice-ka ----------
async function viewSettings(el) {
  const { settings: s } = await api('GET', '/api/settings');
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Settings</h2><p class="muted">Xogta shirkadda invoice-ka ku jirta iyo muuqaalkiisa</p></div>
  </header>
  <div class="grid-2">
    <form id="setForm" class="card form">
      <h3>Xogta shirkadda</h3>
      <input name="company" value="${esc(s.company)}" placeholder="Magaca shirkadda" required>
      <input name="slogan" value="${esc(s.slogan)}" placeholder="Slogan">
      <div class="row">
        <input name="phone" value="${esc(s.phone)}" placeholder="Telefoon">
        <input name="email" value="${esc(s.email)}" placeholder="Email">
      </div>
      <input name="website" value="${esc(s.website)}" placeholder="Website">
      <input name="address" value="${esc(s.address)}" placeholder="Cinwaan">
      <h3>Bangiga</h3>
      <div class="row">
        <input name="bankName" value="${esc(s.bankName)}" placeholder="Magaca bangiga">
        <input name="bankAccount" value="${esc(s.bankAccount)}" placeholder="Lambarka account-ka">
      </div>
      <h3>Terms &amp; Conditions</h3>
      <textarea name="terms" rows="4" placeholder="Shuruudaha lacag bixinta">${esc(s.terms)}</textarea>
      <input name="vatRate" type="number" step="0.01" min="0" max="100" value="${esc(s.vatRate ?? 5)}" placeholder="VAT %">
      <label class="row" style="align-items:center">Midabka invoice-ka
        <input name="accent" type="color" value="${esc(s.accent)}">
      </label>
      <button class="btn primary block">Kaydi settings-ka</button>
    </form>
    <div class="card">
      <h3>Preview</h3>
      <div id="setPreview" class="print-area"></div>
    </div>
  </div>`;

  const form = $('#setForm');
  const showPreview = () => {
    const d = formData(form);
    $('#setPreview').innerHTML = invHeadHtml(d) + invFootHtml(d);
  };
  form.oninput = showPreview;
  showPreview();

  form.onsubmit = e => {
    e.preventDefault();
    act(() => api('PUT', '/api/settings', formData(e.target)), 'Settings-ka waa la kaydiyay');
  };
}

// ---------- Users (admin) ----------
async function viewUsers(el) {
  const { users } = await api('GET', '/api/users');
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Users</h2><p class="muted">Admin ayaa isticmaalayaasha maamula. Dhammaan users-ku xog isku mid ah ayay arkaan.</p></div>
  </header>
  <div class="grid-2">
    <form id="userForm" class="card form">
      <h3>User cusub</h3>
      <input name="name" placeholder="Magaca" required>
      <input name="email" type="email" placeholder="Email" required>
      <input name="password" type="password" placeholder="Password (ugu yaraan 6)" required>
      <select name="role"><option value="user">User (shaqaale)</option><option value="admin">Admin</option></select>
      <button class="btn primary">Abuur</button>
    </form>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Magaca</th><th>Doorka</th><th>Xaalad</th><th></th></tr></thead>
      <tbody>${users.map(u => {
        const me = u.id === state.user.id;
        return `<tr>
          <td>${esc(u.name)}<small class="block">${esc(u.email)}</small></td>
          <td><select data-role="${u.id}" ${me ? 'disabled' : ''}>
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select></td>
          <td><button class="pill-s ${u.active ? 'paid' : 'unpaid'}" data-active="${u.id}" data-val="${!u.active}" ${me ? 'disabled' : ''}>${u.active ? 'Firfircoon' : 'Joogsan'}</button></td>
          <td><button class="link danger del" data-id="${u.id}" ${me ? 'disabled' : ''}>✕</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>
  </div>`;

  $('#userForm').onsubmit = e => {
    e.preventDefault();
    act(() => api('POST', '/api/users', formData(e.target)), 'Isticmaalaha waa la abuuray');
  };
  el.querySelectorAll('[data-role]').forEach(s => s.onchange = () =>
    act(() => api('PATCH', '/api/users/' + s.dataset.role, { role: s.value }), 'Doorka waa la beddelay'));
  el.querySelectorAll('[data-active]').forEach(b => b.onclick = () =>
    act(() => api('PATCH', '/api/users/' + b.dataset.active, { active: b.dataset.val === 'true' }), 'Xaaladda waa la beddelay'));
  bindDel(el, '/api/users/', 'Isticmaalaha waa la tirtiray');
}

applyTheme();
boot();
