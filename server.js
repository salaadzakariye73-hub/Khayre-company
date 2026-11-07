'use strict';
/**
 * Dhismaha Maamul — backend (zero-dependency Node.js)
 * Xogta: data/db.json, ama MongoDB haddii MONGODB_URI la dejiyo.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const MONGO_URI = process.env.MONGODB_URI;
const MONGO_DB = process.env.MONGODB_DB || 'dhismaha';
const SESSION_DAYS = 7;
const MAX_BODY = 1024 * 1024;

let mongoCol = null;
let db = null;

const emptyDb = () => ({
  users: [], sessions: {}, customers: [], items: [],
  invoices: [], payments: [], expenses: [], counters: { invoice: 0 }
});

function loadFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(emptyDb(), null, 2));
  return { ...emptyDb(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
}

async function initStorage() {
  if (!MONGO_URI) return loadFile();
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  mongoCol = client.db(MONGO_DB).collection('appdata');
  const doc = await mongoCol.findOne({ _id: 'main' });
  if (!doc) return emptyDb();
  delete doc._id;
  return { ...emptyDb(), ...doc };
}

async function saveDb() {
  if (mongoCol) {
    await mongoCol.replaceOne({ _id: 'main' }, db, { upsert: true });
    return;
  }
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------------------------------------------------------------- Helpers
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const todayStr = () => new Date().toISOString().slice(0, 10);
const round2 = n => Math.round(n * 100) / 100;
const sum = arr => round2(arr.reduce((s, x) => s + x, 0));
const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt);
const monthKeyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function str(v, label, max = 120, required = true) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) fail(400, `${label} waa lagama maarmaan`);
  if (s.length > max) fail(400, `${label} aad bay u dheer tahay`);
  return s;
}
function num(v, label) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) fail(400, `${label} waa tiro sax ah`);
  return round2(n);
}
function optNum(v, label, def = 0) {
  if (v === '' || v === null || v === undefined) return def;
  return num(v, label);
}
function dateStr(v) {
  const s = v ? String(v) : todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(400, 'Taariikhda qaabkeeda waa YYYY-MM-DD');
  return s;
}
function findById(list, id, label) {
  const x = list.find(i => i.id === id);
  if (!x) fail(404, `${label} lama helin`);
  return x;
}

// ---------------------------------------------------------------- Auth
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  const exp = Buffer.from(hash, 'hex');
  return exp.length === test.length && crypto.timingSafeEqual(test, exp);
}
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active });

function createUser({ name, email, password, role }) {
  const n = str(name, 'Magaca', 60);
  const e = str(email, 'Emailka', 120).toLowerCase();
  const pw = String(password || '');
  if (!/^\S+@\S+\.\S+$/.test(e)) fail(400, 'Emailka sax ma aha');
  if (pw.length < 6) fail(400, 'Password-ku ugu yaraan 6 xaraf ah');
  if (db.users.some(u => u.email === e)) fail(409, 'Emailkan hore ayaa jira');
  const user = {
    id: uid(), name: n, email: e, passwordHash: hashPassword(pw),
    role: role === 'admin' ? 'admin' : 'user', active: true, createdAt: nowIso()
  };
  db.users.push(user);
  return user;
}
function createSession(user) {
  const t = crypto.randomBytes(32).toString('hex');
  db.sessions[t] = { userId: user.id, createdAt: Date.now() };
  return t;
}
function killSessions(userId) {
  for (const [t, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[t];
}
function getAuth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token || !db.sessions[token]) return null;
  const s = db.sessions[token];
  if (Date.now() - s.createdAt > SESSION_DAYS * 864e5) { delete db.sessions[token]; return null; }
  const user = db.users.find(u => u.id === s.userId);
  if (!user || !user.active) return null;
  return { user, token };
}
function requireAuth(req) {
  const a = getAuth(req);
  if (!a) fail(401, 'Fadlan soo gal');
  return a;
}
function requireAdmin(req) {
  const a = requireAuth(req);
  if (a.user.role !== 'admin') fail(403, 'Kaliya admin ayaa ogol');
  return a;
}

// ---------------------------------------------------------------- Views (xisaab)
const paidFor = invId => sum(db.payments.filter(p => p.invoiceId === invId).map(p => p.amount));
const custName = id => (db.customers.find(c => c.id === id) || {}).name || '—';

function invView(inv) {
  const paid = paidFor(inv.id);
  const remaining = round2(inv.total - paid);
  return {
    ...inv, customerName: custName(inv.customerId), paid, remaining,
    status: remaining <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
  };
}
function custView(c) {
  const invs = db.invoices.filter(i => i.customerId === c.id);
  const total = sum(invs.map(i => i.total));
  const paid = sum(invs.map(i => paidFor(i.id)));
  return { ...c, invoices: invs.length, total, paid, balance: round2(total - paid) };
}

// ---------------------------------------------------------------- Router
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const src = '^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$';
  routes.push({ method, re: new RegExp(src), keys, handler });
}
function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
  }
  return null;
}

// ---- Auth
route('GET', '/api/auth/status', async () => ({ body: { hasUsers: db.users.length > 0 } }));

route('POST', '/api/auth/setup', async ({ body }) => {
  if (db.users.length) fail(400, 'Admin hore ayaa loo sameeyay');
  const user = createUser({ ...body, role: 'admin' });
  return { status: 201, body: { token: createSession(user), user: publicUser(user) } };
});

route('POST', '/api/auth/login', async ({ body }) => {
  const email = str(body.email, 'Emailka', 120).toLowerCase();
  const user = db.users.find(u => u.email === email);
  if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) {
    fail(401, 'Email ama password khalad ah');
  }
  if (!user.active) fail(403, 'Akoonkaaga waa la joojiyay');
  return { body: { token: createSession(user), user: publicUser(user) } };
});

route('POST', '/api/auth/logout', async ({ req }) => {
  const a = requireAuth(req);
  delete db.sessions[a.token];
  return { body: { ok: true } };
});

route('GET', '/api/auth/me', async ({ req }) => ({ body: { user: publicUser(requireAuth(req).user) } }));

// ---- Customers (macaamiil)
route('GET', '/api/customers', async ({ req }) => {
  requireAuth(req);
  return { body: { customers: db.customers.map(custView) } };
});

route('POST', '/api/customers', async ({ req, body }) => {
  requireAuth(req);
  const c = {
    id: uid(),
    name: str(body.name, 'Magaca', 80),
    phone: str(body.phone, 'Telefoonka', 30, false),
    address: str(body.address, 'Cinwaanka', 160, false),
    createdAt: nowIso()
  };
  db.customers.push(c);
  return { status: 201, body: { customer: custView(c) } };
});

route('PUT', '/api/customers/:id', async ({ req, body, params }) => {
  requireAuth(req);
  const c = findById(db.customers, params.id, 'Macmiilka');
  if (body.name !== undefined) c.name = str(body.name, 'Magaca', 80);
  if (body.phone !== undefined) c.phone = str(body.phone, 'Telefoonka', 30, false);
  if (body.address !== undefined) c.address = str(body.address, 'Cinwaanka', 160, false);
  return { body: { customer: custView(c) } };
});

route('DELETE', '/api/customers/:id', async ({ req, params }) => {
  requireAuth(req);
  findById(db.customers, params.id, 'Macmiilka');
  if (db.invoices.some(i => i.customerId === params.id)) {
    fail(400, 'Macmiilkan invoice ayuu leeyahay. Marka hore invoice-yada tirtir');
  }
  db.customers = db.customers.filter(c => c.id !== params.id);
  return { body: { ok: true } };
});

// ---- Items (alaabta / stock)
route('GET', '/api/items', async ({ req }) => {
  requireAuth(req);
  return { body: { items: db.items } };
});

route('POST', '/api/items', async ({ req, body }) => {
  requireAuth(req);
  const it = {
    id: uid(),
    name: str(body.name, 'Magaca alaabta', 100),
    unit: str(body.unit || 'pcs', 'Unugga', 20, false) || 'pcs',
    price: num(body.price, 'Qiimaha'),
    stock: optNum(body.stock, 'Stock-ka'),
    createdAt: nowIso()
  };
  if (it.price < 0 || it.stock < 0) fail(400, 'Qiimaha iyo stock-ku ma noqon karaan kuwo taban');
  db.items.push(it);
  return { status: 201, body: { item: it } };
});

route('PUT', '/api/items/:id', async ({ req, body, params }) => {
  requireAuth(req);
  const it = findById(db.items, params.id, 'Alaabta');
  if (body.name !== undefined) it.name = str(body.name, 'Magaca alaabta', 100);
  if (body.unit !== undefined) it.unit = str(body.unit, 'Unugga', 20, false) || 'pcs';
  if (body.price !== undefined) {
    const p = num(body.price, 'Qiimaha');
    if (p < 0) fail(400, 'Qiimuhu ma noqon karo mid taban');
    it.price = p;
  }
  if (body.stock !== undefined) {
    const s = num(body.stock, 'Stock-ka');
    if (s < 0) fail(400, 'Stock-ku ma noqon karo mid taban');
    it.stock = s;
  }
  return { body: { item: it } };
});

route('DELETE', '/api/items/:id', async ({ req, params }) => {
  requireAuth(req);
  findById(db.items, params.id, 'Alaabta');
  if (db.invoices.some(inv => inv.lines.some(l => l.itemId === params.id))) {
    fail(400, 'Alaabtan invoice ayay ku jirtaa, looma tirtiri karo');
  }
  db.items = db.items.filter(i => i.id !== params.id);
  return { body: { ok: true } };
});

// ---- Invoices (invoice-yada)
route('GET', '/api/invoices', async ({ req, query }) => {
  requireAuth(req);
  const cid = query.get('customerId');
  const list = db.invoices
    .filter(i => !cid || i.customerId === cid)
    .sort(byNewest)
    .map(invView);
  return { body: { invoices: list } };
});

route('GET', '/api/invoices/:id', async ({ req, params }) => {
  requireAuth(req);
  const inv = findById(db.invoices, params.id, 'Invoice-ka');
  const payments = db.payments
    .filter(p => p.invoiceId === inv.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  return { body: { ...invView(inv), payments } };
});

route('POST', '/api/invoices', async ({ req, body }) => {
  requireAuth(req);
  const customer = findById(db.customers, str(body.customerId, 'Macmiilka'), 'Macmiilka');
  const date = dateStr(body.date);
  if (!Array.isArray(body.lines) || !body.lines.length) fail(400, 'Ugu yaraan hal alaab ku dar');

  const lines = body.lines.map(l => {
    const item = findById(db.items, l.itemId, 'Alaabta');
    const qty = num(l.qty, 'Tirada');
    if (qty <= 0) fail(400, 'Tirada waa inay ka weyn tahay 0');
    const price = (l.price === '' || l.price === undefined || l.price === null)
      ? item.price
      : num(l.price, 'Qiimaha');
    if (price < 0) fail(400, 'Qiimuhu ma noqon karo mid taban');
    return { itemId: item.id, name: item.name, unit: item.unit, qty, price, total: round2(qty * price) };
  });

  // Stock-ka iska hubi (alaab isku mid ah oo lagu soo daray laba jeer ayaa lagu wada geeyaa)
  const need = {};
  lines.forEach(l => { need[l.itemId] = round2((need[l.itemId] || 0) + l.qty); });
  for (const [id, q] of Object.entries(need)) {
    const it = db.items.find(i => i.id === id);
    if (it.stock < q) fail(400, `Stock-ka "${it.name}" ma filna (waxa jira ${it.stock} ${it.unit})`);
  }
  for (const [id, q] of Object.entries(need)) {
    const it = db.items.find(i => i.id === id);
    it.stock = round2(it.stock - q);
  }

  db.counters.invoice += 1;
  const inv = {
    id: uid(),
    no: `INV-${String(db.counters.invoice).padStart(4, '0')}`,
    customerId: customer.id,
    date,
    lines,
    total: sum(lines.map(l => l.total)),
    createdAt: nowIso()
  };
  db.invoices.push(inv);
  return { status: 201, body: { invoice: invView(inv) } };
});

route('DELETE', '/api/invoices/:id', async ({ req, params }) => {
  requireAuth(req);
  const inv = findById(db.invoices, params.id, 'Invoice-ka');
  if (db.payments.some(p => p.invoiceId === inv.id)) {
    fail(400, 'Invoice-kan lacag ayaa laga bixiyay. Marka hore lacagta tirtir');
  }
  for (const l of inv.lines) {
    const it = db.items.find(i => i.id === l.itemId);
    if (it) it.stock = round2(it.stock + l.qty);
  }
  db.invoices = db.invoices.filter(i => i.id !== inv.id);
  return { body: { ok: true } };
});

// ---- Payments (lacag dhigasho)
route('GET', '/api/payments', async ({ req }) => {
  requireAuth(req);
  const payments = [...db.payments]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .map(p => {
      const inv = db.invoices.find(i => i.id === p.invoiceId) || {};
      return { ...p, invoiceNo: inv.no || '—', customerName: custName(p.customerId) };
    });
  return { body: { payments } };
});

route('POST', '/api/payments', async ({ req, body }) => {
  requireAuth(req);
  const inv = findById(db.invoices, str(body.invoiceId, 'Invoice-ka'), 'Invoice-ka');
  const amount = num(body.amount, 'Lacagta');
  if (amount <= 0) fail(400, 'Lacagtu waa inay ka weyn tahay 0');
  const remaining = round2(inv.total - paidFor(inv.id));
  if (amount > remaining) fail(400, `Lacagta ka badan baaqiga (${remaining} USD)`);
  const p = {
    id: uid(), invoiceId: inv.id, customerId: inv.customerId, amount,
    date: dateStr(body.date), note: str(body.note, 'Fiiradda', 160, false), createdAt: nowIso()
  };
  db.payments.push(p);
  return { status: 201, body: { payment: p } };
});

route('DELETE', '/api/payments/:id', async ({ req, params }) => {
  requireAuth(req);
  findById(db.payments, params.id, 'Lacagta');
  db.payments = db.payments.filter(p => p.id !== params.id);
  return { body: { ok: true } };
});

// ---- Expenses (kharash)
route('GET', '/api/expenses', async ({ req }) => {
  requireAuth(req);
  const expenses = [...db.expenses].sort((a, b) => b.date.localeCompare(a.date));
  return { body: { expenses } };
});

route('POST', '/api/expenses', async ({ req, body }) => {
  requireAuth(req);
  const x = {
    id: uid(),
    title: str(body.title, 'Sharaxaadda', 120),
    category: str(body.category || 'Kale', 'Qaybta', 40, false) || 'Kale',
    amount: num(body.amount, 'Qadarka'),
    date: dateStr(body.date),
    createdAt: nowIso()
  };
  if (x.amount <= 0) fail(400, 'Qadarku waa inuu ka weyn yahay 0');
  db.expenses.push(x);
  return { status: 201, body: { expense: x } };
});

route('DELETE', '/api/expenses/:id', async ({ req, params }) => {
  requireAuth(req);
  findById(db.expenses, params.id, 'Kharashka');
  db.expenses = db.expenses.filter(x => x.id !== params.id);
  return { body: { ok: true } };
});

// ---- Dashboard
route('GET', '/api/dashboard', async ({ req }) => {
  requireAuth(req);
  const sales = sum(db.invoices.map(i => i.total));
  const received = sum(db.payments.map(p => p.amount));
  const expenses = sum(db.expenses.map(e => e.amount));

  const months = [];
  const now = new Date();
  for (let k = 5; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const key = monthKeyOf(d);
    months.push({
      month: key,
      sales: sum(db.invoices.filter(i => i.date.startsWith(key)).map(i => i.total)),
      received: sum(db.payments.filter(p => p.date.startsWith(key)).map(p => p.amount)),
      expenses: sum(db.expenses.filter(e => e.date.startsWith(key)).map(e => e.amount))
    });
  }

  return {
    body: {
      sales,
      received,
      receivable: round2(sales - received),
      expenses,
      profit: round2(received - expenses),
      rate: sales ? Math.round((received / sales) * 100) : 0,
      months,
      lowStock: db.items.filter(i => i.stock <= 5).slice(0, 8),
      recent: [...db.invoices].sort(byNewest).slice(0, 5).map(invView)
    }
  };
});

// ---- Reports (xisaab)
route('GET', '/api/reports', async ({ req }) => {
  requireAuth(req);
  const keys = new Set([
    ...db.invoices.map(i => i.date.slice(0, 7)),
    ...db.payments.map(p => p.date.slice(0, 7)),
    ...db.expenses.map(e => e.date.slice(0, 7))
  ]);
  const monthly = [...keys].sort().reverse().map(key => {
    const sales = sum(db.invoices.filter(i => i.date.startsWith(key)).map(i => i.total));
    const received = sum(db.payments.filter(p => p.date.startsWith(key)).map(p => p.amount));
    const exp = sum(db.expenses.filter(e => e.date.startsWith(key)).map(e => e.amount));
    return { month: key, sales, received, expenses: exp, profit: round2(received - exp) };
  });
  const customers = db.customers.map(custView)
    .filter(c => c.balance !== 0)
    .sort((a, b) => b.balance - a.balance);
  return { body: { monthly, customers } };
});

// ---- Users (admin kaliya)
route('GET', '/api/users', async ({ req }) => {
  requireAdmin(req);
  return { body: { users: db.users.map(publicUser) } };
});

route('POST', '/api/users', async ({ req, body }) => {
  requireAdmin(req);
  const u = createUser(body);
  return { status: 201, body: { user: publicUser(u) } };
});

route('PATCH', '/api/users/:id', async ({ req, body, params }) => {
  const me = requireAdmin(req).user;
  const t = findById(db.users, params.id, 'Isticmaalaha');
  if (body.role !== undefined) {
    if (t.id === me.id && body.role !== 'admin') fail(400, 'Adigu ma beddeli kartid doorkaaga');
    t.role = body.role === 'admin' ? 'admin' : 'user';
  }
  if (body.active !== undefined) {
    if (t.id === me.id && !body.active) fail(400, 'Adigu ma joojin kartid akoonkaaga');
    t.active = !!body.active;
    if (!t.active) killSessions(t.id);
  }
  return { body: { user: publicUser(t) } };
});

route('DELETE', '/api/users/:id', async ({ req, params }) => {
  const me = requireAdmin(req).user;
  if (params.id === me.id) fail(400, 'Adigu ma tirtiri kartid akoonkaaga');
  findById(db.users, params.id, 'Isticmaalaha');
  killSessions(params.id);
  db.users = db.users.filter(u => u.id !== params.id);
  return { body: { ok: true } };
});

// ---------------------------------------------------------------- HTTP
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Xogta aad soo dirtay way weyn tahay'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'JSON khalad ayaa ku jira')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function serveStatic(res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  const file = decoded === '/' ? '/index.html' : decoded;
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, buf) => {
    if (err) {
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);

  const match = matchRoute(req.method, url.pathname);
  if (!match) return send(res, 404, { error: 'Route ma jiro' });

  try {
    const body = req.method === 'GET' ? {} : await readBody(req);
    const result = (await match.handler({
      req, body, params: match.params, query: url.searchParams
    })) || {};
    if (req.method !== 'GET') await saveDb();
    send(res, result.status || 200, result.body !== undefined ? result.body : { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'Server-ka wax ayaa khaldamay' });
  }
});

(async () => {
  try {
    db = await initStorage();
  } catch (err) {
    console.error('Database-ka lama xiriiri karin:', err.message);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`Dhismaha Maamul waa shaqeynayaa: http://localhost:${PORT}`);
    console.log(mongoCol ? 'Xogta: MongoDB' : 'Xogta: data/db.json');
  });
})();
