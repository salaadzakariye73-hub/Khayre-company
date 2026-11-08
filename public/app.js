'use strict';
/* Dhismaha Maamul — frontend (vanilla JS) */

const COMPANY = 'Shirkadda Dhismaha'; // magaca invoice-ka ku qoran (beddel halkan)
const EXPENSE_CATS = ['Alaab', 'Shaqaale', 'Gaadiid', 'Kiro', 'Kale'];

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'invoices', label: 'Invoice-yada', icon: '🧾' },
  { id: 'receivables', label: 'Lacag qabasho', icon: '⏳' },
  { id: 'payments', label: 'Lacag dhigasho', icon: '💵' },
  { id: 'customers', label: 'Macaamiil', icon: '👥' },
  { id: 'items', label: 'Alaabta', icon: '🧱' },
  { id: 'expenses', label: 'Kharash', icon: '💸' },
  { id: 'reports', label: 'Xisaab', icon: '📊' },
  { id: 'users', label: 'Users', icon: '🛡️', admin: true }
];

const state = { token: localStorage.getItem('dh_token'), user: null, view: 'dashboard' };

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
const kpi = (label, value, cls = '') => `<div class="kpi ${cls}"><small>${label}</small><strong>${value}</strong></div>`;

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
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
function openModal(html) {
  closeModal();
  const o = document.createElement('div');
  o.id = 'modal';
  o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal">${html}</div>`;
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
    <main class="main"><div id="view"></div></main>
  </div>`;

  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    state.view = b.dataset.view;
    renderShell();
  });
  $('#logoutBtn').onclick = logout;
  render();
}

const VIEWS = {
  dashboard: viewDashboard,
  invoices: viewInvoices,
  receivables: viewReceivables,
  payments: viewPayments,
  customers: viewCustomers,
  items: viewItems,
  expenses: viewExpenses,
  reports: viewReports,
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
      <td>${i.date}</td>
      <td class="r">${money(i.total)}</td>
      <td class="r ${i.remaining > 0 ? 'bad' : 'good'}">${money(i.remaining)}</td>
      <td>${pill(i.status)}</td>
      <td>${withBtn ? `<button class="link" data-inv="${i.id}">Fur</button>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

// ---------- Dashboard ----------
async function viewDashboard(el) {
  const d = await api('GET', '/api/dashboard');
  const maxM = Math.max(1, ...d.months.map(m => Math.max(m.sales, m.received, m.expenses)));
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Dashboard</h2><p class="muted">Xaaladda shirkadda · ${todayStr()}</p></div>
  </header>
  <section class="kpis">
    ${kpi('Iibka guud (Sales)', money(d.sales))}
    ${kpi('Lacag la helay', money(d.received), 'green')}
    ${kpi('Lacag qabasho (baaqi)', money(d.receivable), 'coral')}
    ${kpi('Kharashka guud', money(d.expenses), 'orange')}
  </section>
  <section class="grid-3">
    <div class="card">
      <h3>Iib, helay iyo kharash (6 bilood)</h3>
      <div class="chart">${d.months.map(m => `
        <div class="col">
          <div class="bars">
            <i class="bar-s" style="height:${(m.sales / maxM) * 100}%" title="Iib ${money(m.sales)}"></i>
            <i class="bar-r" style="height:${(m.received / maxM) * 100}%" title="Helay ${money(m.received)}"></i>
            <i class="bar-e" style="height:${(m.expenses / maxM) * 100}%" title="Kharash ${money(m.expenses)}"></i>
          </div>
          <small>${m.month.slice(5)}</small>
        </div>`).join('')}
      </div>
      <div class="legend"><span class="lg-s">Iib</span><span class="lg-r">Helay</span><span class="lg-e">Kharash</span></div>
    </div>
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
}

// ---------- Invoices ----------
async function viewInvoices(el) {
  const [{ invoices }, { customers }, { items }] = await Promise.all([
    api('GET', '/api/invoices'),
    api('GET', '/api/customers'),
    api('GET', '/api/items')
  ]);
  const canNew = customers.length && items.length;
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Invoice-yada</h2><p class="muted">Alaabta la iibiyay macaamiisha</p></div>
    <button class="btn primary" id="newInv" ${canNew ? '' : 'disabled'}>+ Invoice cusub</button>
  </header>
  ${!customers.length ? '<p class="muted">Marka hore macaamiil ku dar.</p>' : ''}
  ${!items.length ? '<p class="muted">Marka hore alaab ku dar.</p>' : ''}
  <section class="card">${invTable(invoices)}</section>`;
  if (canNew) $('#newInv').onclick = () => openInvoiceForm(customers, items);
  bindInvoiceLinks(el);
}

function openInvoiceForm(customers, items) {
  const o = openModal(`
    <div class="modal-head"><h3>Invoice cusub</h3><button class="link" data-close>✕</button></div>
    <form id="invForm" class="form">
      <div class="row">
        <select name="customerId" required>${customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <input name="date" type="date" value="${todayStr()}" required>
      </div>
      <div id="lines" class="form"></div>
      <button type="button" class="btn ghost-dark small" id="addLine" style="justify-self:start">+ Alaab ku dar</button>
      <div class="totalbar">Wadar: <b id="grand">$0.00</b></div>
      <button class="btn primary block">Samee invoice</button>
    </form>`);

  const linesEl = o.querySelector('#lines');
  const itemOpts = items.map(i => `<option value="${i.id}" data-price="${i.price}">${esc(i.name)} (stock ${i.stock} ${esc(i.unit)})</option>`).join('');

  const recalc = () => {
    let g = 0;
    linesEl.querySelectorAll('.line').forEach(r => {
      const t = (Number(r.querySelector('[name=qty]').value) || 0) * (Number(r.querySelector('[name=price]').value) || 0);
      r.querySelector('.ltotal').textContent = money(t);
      g += t;
    });
    o.querySelector('#grand').textContent = money(g);
  };

  const addRow = () => {
    const row = document.createElement('div');
    row.className = 'line';
    row.innerHTML = `
      <select name="itemId">${itemOpts}</select>
      <input name="qty" type="number" step="0.01" min="0.01" value="1" required>
      <input name="price" type="number" step="0.01" min="0" required>
      <b class="ltotal">$0.00</b>
      <button type="button" class="link danger">✕</button>`;
    const sel = row.querySelector('select');
    const price = row.querySelector('[name=price]');
    const setPrice = () => { price.value = sel.selectedOptions[0].dataset.price; recalc(); };
    sel.onchange = setPrice;
    row.querySelector('[name=qty]').oninput = recalc;
    price.oninput = recalc;
    row.querySelector('.danger').onclick = () => { row.remove(); recalc(); };
    linesEl.appendChild(row);
    setPrice();
  };

  o.querySelector('#addLine').onclick = addRow;
  addRow();

  o.querySelector('#invForm').onsubmit = e => {
    e.preventDefault();
    const fd = formData(e.target);
    const lines = [...linesEl.querySelectorAll('.line')].map(r => ({
      itemId: r.querySelector('select').value,
      qty: r.querySelector('[name=qty]').value,
      price: r.querySelector('[name=price]').value
    }));
    act(() => api('POST', '/api/invoices', { customerId: fd.customerId, date: fd.date, lines }), 'Invoice waa la sameeyey');
  };
}

async function openInvoice(id) {
  let inv;
  try { inv = await api('GET', '/api/invoices/' + id); }
  catch (e) { return toast(e.message, 'bad'); }
  openModal(`
    <div class="modal-head"><h3>${esc(inv.no)}</h3><button class="link" data-close>✕</button></div>
    <div class="actions no-print">
      <button class="btn primary" id="printBtn">🖨️ Daabac / PDF</button>
      ${inv.remaining > 0 ? '<button class="btn ghost-dark" id="payBtn">💵 Lacag ka qaado</button>' : ''}
      <button class="btn danger-dark" id="delInv">Tirtir</button>
    </div>
    <div id="printArea" class="print-area">
      <div class="inv-head">
        <div><h2>${esc(COMPANY)}</h2><small>INVOICE</small></div>
        <div class="r"><b>${esc(inv.no)}</b><br><small>Taariikh: ${inv.date}</small></div>
      </div>
      <p><b>Macmiilka:</b> ${esc(inv.customerName)}</p>
      <div class="table-wrap"><table class="inv-table">
        <thead><tr><th>Alaab</th><th>Tiro</th><th class="r">Qiime</th><th class="r">Wadar</th></tr></thead>
        <tbody>${inv.lines.map(l => `<tr>
          <td>${esc(l.name)}</td>
          <td>${l.qty} ${esc(l.unit)}</td>
          <td class="r">${money(l.price)}</td>
          <td class="r">${money(l.total)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="totals">
        <div>Wadar: <b>${money(inv.total)}</b></div>
        <div>La bixiyay: <b>${money(inv.paid)}</b></div>
        <div>Baaqi: <b>${money(inv.remaining)}</b></div>
      </div>
      <h4 style="margin-top:18px">Lacag bixinta</h4>
      ${inv.payments.length
        ? inv.payments.map(p => `<div class="list-row"><span>${p.date} ${esc(p.note)}</span><b class="good">${money(p.amount)}</b></div>`).join('')
        : '<p class="muted">Weli lacag ma bixin.</p>'}
    </div>`);

  $('#printBtn').onclick = () => window.print();
  if ($('#payBtn')) $('#payBtn').onclick = () => openPaymentForm(inv.id);
  $('#delInv').onclick = () => {
    if (confirm('Invoice-kan ma tirtirtaa? Alaabta stock-keeda waa la soo celinayaa.')) {
      act(() => api('DELETE', '/api/invoices/' + inv.id), 'Invoice-ka waa la tirtiray');
    }
  };
}

// ---------- Lacag qabasho (baaqa macaamiisha) ----------
async function viewReceivables(el) {
  const { invoices } = await api('GET', '/api/invoices');
  const open = invoices.filter(i => i.remaining > 0);
  const total = sumOf(open, i => i.remaining);
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Lacag qabasho</h2><p class="muted">Macaamiisha lacagta weli ku leh: <b class="bad">${money(total)}</b></p></div>
  </header>
  <section class="card">${open.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Macmiil</th><th>Invoice</th><th>Taariikh</th><th class="r">Baaqi</th><th></th></tr></thead>
        <tbody>${open.map(i => `<tr>
          <td>${esc(i.customerName)}</td>
          <td>${esc(i.no)}</td>
          <td>${i.date}</td>
          <td class="r bad">${money(i.remaining)}</td>
          <td><button class="btn small primary" data-pay="${i.id}">Lacag ka qaado</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<p class="muted">Baaqi ma jiro. ✅</p>'}
  </section>`;
  el.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => openPaymentForm(b.dataset.pay));
}

// ---------- Lacag dhigasho (lacagta la helay) ----------
async function viewPayments(el) {
  const { payments } = await api('GET', '/api/payments');
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Lacag dhigasho</h2><p class="muted">Lacagta macaamiisha ka timid</p></div>
    <button class="btn primary" id="newPay">+ Lacag cusub</button>
  </header>
  <section class="card"><div class="table-wrap"><table>
    <thead><tr><th>Taariikh</th><th>Macmiil</th><th>Invoice</th><th>Fiiro</th><th class="r">Lacag</th><th></th></tr></thead>
    <tbody>${payments.map(p => `<tr>
      <td>${p.date}</td>
      <td>${esc(p.customerName)}</td>
      <td>${esc(p.invoiceNo)}</td>
      <td>${esc(p.note)}</td>
      <td class="r good">${money(p.amount)}</td>
      <td><button class="link danger del" data-id="${p.id}">✕</button></td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">Lacag ma jirto.</td></tr>'}</tbody>
  </table></div></section>`;
  $('#newPay').onclick = () => openPaymentForm();
  bindDel(el, '/api/payments/', 'Lacagta waa la tirtiray');
}

async function openPaymentForm(preselectId) {
  let open;
  try {
    const { invoices } = await api('GET', '/api/invoices');
    open = invoices.filter(i => i.remaining > 0);
  } catch (e) { return toast(e.message, 'bad'); }
  if (!open.length) return toast('Invoice baaqi leh ma jiro', 'bad');
  const o = openModal(`
    <div class="modal-head"><h3>Lacag dhigasho</h3><button class="link" data-close>✕</button></div>
    <form id="payForm" class="form">
      <select name="invoiceId" required>${open.map(i => `<option value="${i.id}" ${i.id === preselectId ? 'selected' : ''}>${esc(i.no)} · ${esc(i.customerName)} · baaqi ${money(i.remaining)}</option>`).join('')}</select>
      <input name="amount" type="number" step="0.01" min="0.01" placeholder="Lacagta $" required>
      <input name="date" type="date" value="${todayStr()}" required>
      <input name="note" placeholder="Fiiro (ikhtiyaari)">
      <button class="btn primary block">Kaydi lacagta</button>
    </form>`);
  const sel = o.querySelector('[name=invoiceId]');
  const amt = o.querySelector('[name=amount]');
  const setAmount = () => {
    const inv = open.find(i => i.id === sel.value);
    if (!inv) return;
    amt.max = inv.remaining;
    amt.value = inv.remaining.toFixed(2);
  };
  sel.onchange = setAmount;
  setAmount();
  o.querySelector('#payForm').onsubmit = e => {
    e.preventDefault();
    const d = formData(e.target);
    act(() => api('POST', '/api/payments', { ...d, amount: Number(d.amount) }), 'Lacagta waa la diiwaangeliyay');
  };
}

// ---------- Macaamiil ----------
async function viewCustomers(el) {
  const { customers } = await api('GET', '/api/customers');
  el.innerHTML = `
  <header class="page-head">
    <div><h2>Macaamiil</h2><p class="muted">Macaamiil kasta iyo baaqigiisa</p></div>
  </header>
  <div class="grid-2">
    <form id="custForm" class="card form">
      <h3>Macmiil cusub</h3>
      <input name="name" placeholder="Magaca" required>
      <input name="phone" placeholder="Telefoon">
      <input name="address" placeholder="Cinwaan / goob">
      <button class="btn primary">Kaydi</button>
    </form>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Magaca</th><th class="r">Wadar</th><th class="r">Baaqi</th><th></th></tr></thead>
      <tbody>${customers.map(c => `<tr>
        <td>${esc(c.name)}<small class="block">${esc(c.phone)} ${esc(c.address)}</small></td>
        <td class="r">${money(c.total)}</td>
        <td class="r ${c.balance > 0 ? 'bad' : 'good'}">${money(c.balance)}</td>
        <td><button class="link danger del" data-id="${c.id}" ${c.invoices ? 'disabled' : ''}>✕</button></td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Macmiil ma jiro.</td></tr>'}</tbody>
    </table></div></div>
  </div>`;
  $('#custForm').onsubmit = e => {
    e.preventDefault();
    act(() => api('POST', '/api/customers', formData(e.target)), 'Macmiilka waa la kaydiyay');
  };
  bindDel(el, '/api/customers/', 'Macmiilka waa la tirtiray');
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
        <td>${x.date}</td>
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
        <td>${m.month}</td>
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

boot();
