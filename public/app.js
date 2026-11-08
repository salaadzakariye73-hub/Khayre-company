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
