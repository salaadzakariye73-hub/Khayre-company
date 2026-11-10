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
  invoices: [], payments: [], payouts: [], creditUses: [], expenses: [],
  counters: { invoice: 0 },
  settings: {
    company: 'Shirkadda Dhismaha', slogan: '', phone: '', email: '',
    website: '', address: '', bankName: '', bankAccount: '', terms: '',
    accent: '#0f3d2e', vatRate: 5
  }
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
const paidFor = invId => sum([
  ...db.payments.filter(p => p.invoiceId === invId).map(p => p.amount),
  ...db.creditUses.filter(c => c.invoiceId === invId).map(c => c.amount)
]);
// Akoonka macaamiilka = lacag cusub oo akoon ah − lacagta la qaaday − akoonka loo isticmaalay invoice
const akoonOf = custId => round2(
  sum(db.payments.filter(p => p.customerId === custId && !p.invoiceId).map(p => p.amount))
  - sum(db.payouts.filter(p => p.customerId === custId).map(p => p.amount))
  - sum(db.creditUses.filter(c => c.customerId === custId).map(c => c.amount))
);
const custName = id => (db.customers.find(c => c.id === id) || {}).name || '—';

function invView(inv) {
  const paid = paidFor(inv.id);
  const remaining = round2(inv.total - paid);
  return {
    ...inv, customerName: custName(inv.customerId), paid, remaining,
    status: remaining <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
  };
}
const custType = v => (v === 'milkiile' ? 'milkiile' : 'macaamiil');
function guarantorOf(g) {
  if (!g || typeof g !== 'object') return null;
  const name = str(g.name, 'Magaca damiinka', 80, false);
  const phone = str(g.phone, 'Telefoonka damiinka', 30, false);
  const address = str(g.address, 'Goobta damiinka', 160, false);
  if (!name && !phone && !address) return null;
  if (!name || !phone || !address) fail(400, 'Damiinka magaca, telefoonka iyo goobta oo dhan waa in la buuxiyo');
  return { name, phone, address };
}
const hasGuarantor = g => !!(g && g.name && g.phone && g.address);
function custView(c) {
  const invs = db.invoices.filter(i => i.customerId === c.id);
  const total = sum(invs.map(i => i.total));
  const paid = sum(invs.map(i => paidFor(i.id)));
  return {
    ...c, type: custType(c.type), guarantor: c.guarantor || null,
    invoices: invs.length, total, paid, balance: round2(total - paid), akoon: akoonOf(c.id)
  };
}
// Telefoon gaar ah: laba macmiil isku telefoon ma lahaan karaan
function assertPhoneFree(phone, exceptId) {
  if (!phone) return;
  if (db.customers.some(x => x.phone === phone && x.id !== exceptId)) {
    fail(409, 'Telefoonkan macmiil ayaa hore u diiwaangashan');
  }
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

// ---- Settings (xogta shirkadda: invoice-ka iyo muuqaalkiisa)
route('GET', '/api/settings', async ({ req }) => {
  requireAuth(req);
  return { body: { settings: db.settings } };
});

route('PUT', '/api/settings', async ({ req, body }) => {
  requireAdmin(req);
  db.settings = {
    company: str(body.company, 'Magaca shirkadda', 80),
    slogan: str(body.slogan, 'Slogan', 80, false),
    phone: str(body.phone, 'Telefoonka', 30, false),
    email: str(body.email, 'Emailka', 120, false),
    website: str(body.website, 'Website-ka', 120, false),
    address: str(body.address, 'Cinwaanka', 160, false),
    bankName: str(body.bankName, 'Magaca bangiga', 80, false),
    bankAccount: str(body.bankAccount, 'Lambarka account-ka', 60, false),
    terms: str(body.terms, 'Terms', 1000, false),
    vatRate: Math.min(100, Math.max(0, optNum(body.vatRate, 'VAT', 5))),
    accent: /^#[0-9a-f]{6}$/i.test(body.accent) ? body.accent : '#0f3d2e'
  };
  return { body: { settings: db.settings } };
});

// ---- Customers (macaamiil)
route('GET', '/api/customers', async ({ req }) => {
  requireAuth(req);
  return { body: { customers: db.customers.map(custView) } };
});

route('POST', '/api/customers', async ({ req, body }) => {
  requireAuth(req);
  const phone = str(body.phone, 'Telefoonka', 30, false);
  assertPhoneFree(phone, null);
  const c = {
    id: uid(),
    name: str(body.name, 'Magaca', 80),
    phone,
    address: str(body.address, 'Cinwaanka', 160, false),
    type: custType(body.type),
    guarantor: guarantorOf(body.guarantor),
    createdAt: nowIso()
  };
  db.customers.push(c);
  return { status: 201, body: { customer: custView(c) } };
});

route('PUT', '/api/customers/:id', async ({ req, body, params }) => {
  requireAuth(req);
  const c = findById(db.customers, params.id, 'Macmiilka');
  if (body.name !== undefined) c.name = str(body.name, 'Magaca', 80);
  if (body.phone !== undefined) {
    const phone = str(body.phone, 'Telefoonka', 30, false);
    assertPhoneFree(phone, c.id);
    c.phone = phone;
  }
  if (body.address !== undefined) c.address = str(body.address, 'Cinwaanka', 160, false);
  // Telefoon lagu diiwaangeliyay = macmiil rasmi ah, wuu deyn qaadan karaa
  if (c.phone) c.isNew = false;
  if (body.type !== undefined) c.type = custType(body.type);
  if (body.guarantor !== undefined) c.guarantor = guarantorOf(body.guarantor);
  return { body: { customer: custView(c) } };
});

route('DELETE', '/api/customers/:id', async ({ req, params }) => {
  requireAuth(req);
  findById(db.customers, params.id, 'Macmiilka');
  if (db.invoices.some(i => i.customerId === params.id)) {
    fail(400, 'Macmiilkan invoice ayuu leeyahay. Marka hore invoice-yada tirtir');
  }
  if (db.payments.some(p => p.customerId === params.id) || db.payouts.some(p => p.customerId === params.id)
    || db.creditUses.some(c => c.customerId === params.id)) {
    fail(400, 'Macmiilkan lacag xisaab ah ayuu leeyahay, looma tirtiri karo');
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
  const date = dateStr(body.date);
  // Macmiil jira: customerId. Macmiil cusub: magaca oo keliya, wuu diiwaangelinayaa (haddii magacu jiro, wuu isticmaalayaa)
  let customer;
  if (body.customerId) {
    customer = findById(db.customers, str(body.customerId, 'Macmiilka'), 'Macmiilka');
  } else {
    const name = str(body.customerName, 'Magaca macmiilka', 80);
    customer = db.customers.find(c => c.name.trim().toLowerCase() === name.toLowerCase());
    if (!customer) {
      customer = { id: uid(), name, phone: '', address: '', type: 'macaamiil', guarantor: null, isNew: true, createdAt: nowIso() };
      db.customers.push(customer);
    }
  }
  if (!Array.isArray(body.lines) || !body.lines.length) fail(400, 'Ugu yaraan hal alaab ku dar');

  const lines = body.lines.map(l => {
    const typed = str(l.itemName, 'Magaca alaabta', 100, false);
    const item = l.itemId
      ? findById(db.items, l.itemId, 'Alaabta')
      : db.items.find(i => i.name.trim().toLowerCase() === typed.toLowerCase()) || null;
    const name = item ? item.name : typed;
    if (!name) fail(400, 'Magaca alaabta waa lagama maarmaan');
    const qty = num(l.qty, 'Tirada');
    if (qty <= 0) fail(400, 'Tirada waa inay ka weyn tahay 0');
    const price = (l.price === '' || l.price === undefined || l.price === null)
      ? (item ? item.price : fail(400, 'Qiimaha alaabta cusub waa lagama maarmaan'))
      : num(l.price, 'Qiimaha');
    if (price < 0) fail(400, 'Qiimuhu ma noqon karo mid taban');
    return { itemId: item ? item.id : null, name, unit: item ? item.unit : 'pcs', qty, price, total: round2(qty * price) };
  });

  // Wadarta alaabta (subtotal) + VAT oo boqolkiiba ku qoran settings-ka (tusaale: 100 + 5% = 105)
  const subtotal = sum(lines.map(l => l.total));
  const vatRate = Number(db.settings.vatRate) || 0;
  const vat = round2(subtotal * vatRate / 100);
  const total = round2(subtotal + vat);

  // Macmiil cusub (invoice ugu horeeya) lacagta oo dhan hadda ayuu bixiyaa

  // Stock-ka iska hubi (alaab isku mid ah oo lagu soo daray laba jeer ayaa lagu wada geeyaa)
  const need = {};
  lines.filter(l => l.itemId).forEach(l => { need[l.itemId] = round2((need[l.itemId] || 0) + l.qty); });
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
    subtotal,
    vatRate,
    vat,
    total,
    createdAt: nowIso()
  };
  db.invoices.push(inv);
  // Macmiil cusub (telefoon aan lagu diiwaangelin) deyn ma qaadan karo: lacagta oo dhan hadda ayuu bixiyaa
  if (customer.isNew) {
    db.payments.push({
      id: uid(), invoiceId: inv.id, customerId: customer.id,
      amount: total, date, note: 'Macmiil cusub — lacag dhan', createdAt: nowIso()
    });
  }
  return { status: 201, body: { invoice: invView(inv) } };
});

route('DELETE', '/api/invoices/:id', async ({ req, params }) => {
  requireAuth(req);
  const inv = findById(db.invoices, params.id, 'Invoice-ka');
  if (db.payments.some(p => p.invoiceId === inv.id) || db.creditUses.some(c => c.invoiceId === inv.id)) {
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
  const rows = [
    ...db.payments.map(p => ({ ...p, kind: 'lacag' })),
    ...db.creditUses.map(c => ({ ...c, kind: 'akoon' }))
  ]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .map(p => {
      const inv = db.invoices.find(i => i.id === p.invoiceId) || {};
      return { ...p, invoiceNo: inv.no || '—', customerName: custName(p.customerId) };
    });
  return { body: { payments: rows } };
});

// Lacag qabasho: invoice ayaa lagu xiraa, ama akoon ayuu u gelaa.
// source='akoon' → akoonka macaamiilka ayaa invoice-ka lagu bixiyaa (lacag cusub ma imaanayso).
route('POST', '/api/payments', async ({ req, body }) => {
  requireAuth(req);
  const amount = num(body.amount, 'Lacagta');
  if (amount <= 0) fail(400, 'Lacagtu waa inay ka weyn tahay 0');
  const date = dateStr(body.date);
  const note = str(body.note, 'Fiiradda', 160, false);
  const useAkoon = body.source === 'akoon';

  if (body.invoiceId) {
    const inv = findById(db.invoices, str(body.invoiceId, 'Invoice-ka'), 'Invoice-ka');
    const remaining = round2(inv.total - paidFor(inv.id));
    if (amount > remaining) fail(400, `Lacagta ka badan baaqiga (${remaining} USD)`);
    if (useAkoon) {
      const akoon = akoonOf(inv.customerId);
      if (amount > akoon) fail(400, `Akoonka macaamiilka ma filna (akoon: ${akoon} USD)`);
      const c = { id: uid(), customerId: inv.customerId, invoiceId: inv.id, amount, date, note, createdAt: nowIso() };
      db.creditUses.push(c);
      return { status: 201, body: { payment: c } };
    }
    const p = { id: uid(), invoiceId: inv.id, customerId: inv.customerId, amount, date, note, createdAt: nowIso() };
    db.payments.push(p);
    return { status: 201, body: { payment: p } };
  }

  if (useAkoon) fail(400, 'Akoonka ka qaadasho waa in invoice la doortaa');
  const customer = findById(db.customers, str(body.customerId, 'Macmiilka'), 'Macmiilka');
  const p = { id: uid(), invoiceId: null, customerId: customer.id, amount, date, note, createdAt: nowIso() };
  db.payments.push(p);
  return { status: 201, body: { payment: p } };
});

route('DELETE', '/api/payments/:id', async ({ req, params }) => {
  requireAuth(req);
  if (db.payments.some(p => p.id === params.id)) {
    db.payments = db.payments.filter(p => p.id !== params.id);
  } else {
    findById(db.creditUses, params.id, 'Lacagta');
    db.creditUses = db.creditUses.filter(c => c.id !== params.id);
  }
  return { body: { ok: true } };
});

// ---- Payouts (lacag bixin: macaamiilka akoonkiisa ka qaadanaya)
route('GET', '/api/payouts', async ({ req }) => {
  requireAuth(req);
  const payouts = [...db.payouts]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .map(p => {
      const c = db.customers.find(x => x.id === p.customerId) || {};
      return { ...p, customerName: custName(p.customerId), customerType: custType(c.type) };
    });
  return { body: { payouts } };
});

route('POST', '/api/payouts', async ({ req, body }) => {
  requireAuth(req);
  const c = findById(db.customers, str(body.customerId, 'Macmiilka'), 'Macmiilka');
  const amount = num(body.amount, 'Lacagta');
  if (amount <= 0) fail(400, 'Lacagtu waa inay ka weyn tahay 0');
  const after = round2(akoonOf(c.id) - amount);
  // Amaah (akoon ka badan) waxaa loo ogol yahay macaamiil damiin leh oo keliya; milkiilayaasha xaddi looma yeelo
  if (after < 0 && c.type !== 'milkiile' && !hasGuarantor(c.guarantor)) {
    fail(400, 'Amaah looma oggola: macaamiilka damiin (magaca, telefoonka, goobta) ma lahan');
  }
  const p = {
    id: uid(), customerId: c.id, amount, date: dateStr(body.date),
    note: str(body.note, 'Fiiradda', 160, false), createdAt: nowIso()
  };
  db.payouts.push(p);
  return { status: 201, body: { payout: p, akoon: after } };
});

route('DELETE', '/api/payouts/:id', async ({ req, params }) => {
  requireAuth(req);
  findById(db.payouts, params.id, 'Lacag bixinta');
  db.payouts = db.payouts.filter(p => p.id !== params.id);
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
  const received = round2(sum(db.payments.map(p => p.amount)) - sum(db.payouts.map(p => p.amount)));
  // Lacagta invoice-yada loo bixiyay (akoonka iyo cash labadaba), si ururinta looga qiyaaso iibka
  const collectedOnInvoices = sum(db.invoices.map(i => paidFor(i.id)));
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
      receivable: round2(sales - sum(db.invoices.map(i => paidFor(i.id)))),
      expenses,
      profit: round2(received - expenses),
      rate: sales ? Math.min(100, Math.round((collectedOnInvoices / sales) * 100)) : 0,
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
  // Hubi in faylka uu ku jiro folder-ka public oo keliya (ma aha "public-xxx")
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
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

  // Snapshot xogta kahor qorista: haddii handler-ka ama saveDb fashilmo, xogta dib ayaa loo soo celinayaa
  const snapshot = req.method === 'GET' ? null : JSON.stringify(db);
  try {
    const body = req.method === 'GET' ? {} : await readBody(req);
    const result = (await match.handler({
      req, body, params: match.params, query: url.searchParams
    })) || {};
    if (req.method !== 'GET') await saveDb();
    send(res, result.status || 200, result.body !== undefined ? result.body : { ok: true });
  } catch (err) {
    if (snapshot !== null) db = JSON.parse(snapshot);
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
