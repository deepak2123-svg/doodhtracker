import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAY_LABELS = ['S','M','T','W','T','F','S'];
const QUICK_VALUES = ['2', '3', '4', '5'];

const today = new Date();
let year = today.getFullYear();
let month = today.getMonth();
let selectedDay = today.getDate();
let entries = {};
let rate = 60;
let uid = null;

const el = (id) => document.getElementById(id);

function pad(n) { return String(n).padStart(2, '0'); }
function monthKey(y, m) { return `${y}-${pad(m + 1)}`; }
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function fmtRupees(n) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}
function fmtLitres(n) {
  const r = Math.round((n || 0) * 100) / 100;
  return r % 1 === 0 ? String(r) : r.toFixed(2);
}
function weekdayShort(y, m, d) {
  return new Date(y, m, d).toLocaleDateString('en-IN', { weekday: 'short' });
}
function isCurrentMonth() { return year === today.getFullYear() && month === today.getMonth(); }
function isToday(d) { return isCurrentMonth() && d === today.getDate(); }

function showError(msg) { el('error').textContent = msg || ''; }
function showLoading(v) { el('loading').style.display = v ? 'block' : 'none'; }

// ---------- Firestore access ----------

async function loadRate() {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'settings', 'main'));
    if (snap.exists() && typeof snap.data().rate === 'number') {
      rate = snap.data().rate;
    }
  } catch {
    showError("Couldn't load your rate. Check your connection.");
  }
}

async function saveRate(val) {
  try {
    await setDoc(doc(db, 'users', uid, 'settings', 'main'), { rate: val }, { merge: true });
    showError('');
  } catch {
    showError("Couldn't save rate. Try again.");
  }
}

async function loadMonth(y, m) {
  showLoading(true);
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'months', monthKey(y, m)));
    entries = snap.exists() ? (snap.data().entries || {}) : {};
  } catch {
    entries = {};
    showError("Couldn't load this month. Check your connection.");
  }
  showLoading(false);
}

async function saveMonth(y, m) {
  try {
    await setDoc(doc(db, 'users', uid, 'months', monthKey(y, m)), { entries }, { merge: false });
    showError('');
  } catch {
    showError("Couldn't save. Try again.");
  }
}

// ---------- Rendering ----------

function render() {
  el('month-label').textContent = `${MONTH_NAMES[month]} ${year}`;

  el('weekday-row').innerHTML = WEEKDAY_LABELS.map((w) => `<div>${w}</div>`).join('');

  const totalDays = daysInMonth(year, month);
  const firstWeekday = new Date(year, month, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push('<div></div>');
  for (let d = 1; d <= totalDays; d++) {
    const classes = ['day-cell'];
    if (entries[d]) classes.push('has-entry');
    if (isToday(d)) classes.push('is-today');
    if (d === selectedDay) classes.push('selected');
    cells.push(`<button class="${classes.join(' ')}" data-day="${d}">${d}</button>`);
  }
  el('calendar').innerHTML = cells.join('');
  el('calendar').querySelectorAll('.day-cell').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedDay = parseInt(btn.dataset.day, 10);
      render();
    });
  });

  const selectedValue = entries[selectedDay];
  el('day-label').textContent = `${pad(selectedDay)} ${weekdayShort(year, month, selectedDay)}` +
    (selectedValue ? ` — ${fmtLitres(parseFloat(selectedValue))} L logged` : '');

  const chipParts = QUICK_VALUES.map((v) => {
    const active = selectedValue && parseFloat(selectedValue) === parseFloat(v);
    return `<button class="chip${active ? ' active' : ''}" data-value="${v}">${v} L</button>`;
  });
  if (selectedValue) chipParts.push(`<button class="chip-clear" id="clear-day">clear</button>`);
  chipParts.push(`<button class="chip other" id="other-btn">other</button>`);
  el('quick-values').innerHTML = chipParts.join('');

  el('quick-values').querySelectorAll('.chip[data-value]').forEach((btn) => {
    btn.addEventListener('click', () => applyValue(btn.dataset.value));
  });
  const clearBtn = el('clear-day');
  if (clearBtn) clearBtn.addEventListener('click', () => applyValue(''));
  el('other-btn').addEventListener('click', showManualInput);

  el('rate-display').textContent = `Rate: \u20B9${fmtLitres(rate)} / litre \u00B7 edit`;

  renderInvoice();
}

function renderInvoice() {
  el('invoice-title').textContent = `${MONTH_NAMES[month]} ${year}`;

  const days = Object.keys(entries)
    .map(Number)
    .filter((d) => parseFloat(entries[d]) > 0)
    .sort((a, b) => a - b);

  let totalLitres = 0;
  const rows = days.map((d) => {
    const litres = parseFloat(entries[d]);
    totalLitres += litres;
    const amount = litres * rate;
    return `<tr><td>${pad(d)} ${weekdayShort(year, month, d)}</td><td>${fmtLitres(litres)} L</td><td>${fmtRupees(amount)}</td></tr>`;
  });

  el('invoice-body').innerHTML = rows.join('');
  el('invoice-empty').style.display = days.length === 0 ? 'block' : 'none';
  el('invoice-total-litres').textContent = `${fmtLitres(totalLitres)} L`;
  el('invoice-total-amount').textContent = fmtRupees(totalLitres * rate);
  el('invoice-rate').textContent = `At \u20B9${fmtLitres(rate)} / litre`;
}

function showManualInput() {
  const selectedValue = entries[selectedDay] || '';
  el('quick-values').insertAdjacentHTML('beforeend',
    `<input id="manual-input" type="text" inputmode="decimal" placeholder="litres" value="${selectedValue}" />`);
  const input = el('manual-input');
  input.focus();
  input.select();
  const commit = () => {
    if (input.value !== '') applyValue(input.value);
    else render();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
}

// ---------- Actions ----------

function applyValue(value) {
  const cleaned = String(value).replace(/[^0-9.]/g, '');
  if (cleaned === '') delete entries[selectedDay];
  else entries[selectedDay] = cleaned;
  saveMonth(year, month);
  render();
}

async function goToMonth(delta) {
  let m = month + delta;
  let y = year;
  if (m < 0) { m = 11; y -= 1; }
  if (m > 11) { m = 0; y += 1; }
  month = m;
  year = y;
  selectedDay = isCurrentMonth() ? today.getDate() : 1;
  await loadMonth(year, month);
  render();
}

function exportPdf() {
  const filename = `milk-invoice-${monthKey(year, month)}.pdf`;
  window.html2pdf().from(el('invoice-panel')).set({
    filename,
    margin: 12,
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).save();
}

// ---------- Wiring ----------

el('prev-month').addEventListener('click', () => goToMonth(-1));
el('next-month').addEventListener('click', () => goToMonth(1));
el('export-pdf-btn').addEventListener('click', exportPdf);

el('rate-display').addEventListener('click', () => {
  el('rate-display').style.display = 'none';
  el('rate-edit').style.display = 'inline';
  const input = el('rate-input');
  input.value = String(rate);
  input.focus();
  input.select();
});

el('rate-input').addEventListener('blur', async () => {
  const cleaned = el('rate-input').value.replace(/[^0-9.]/g, '');
  const val = cleaned === '' ? 0 : parseFloat(cleaned);
  rate = val;
  await saveRate(val);
  el('rate-edit').style.display = 'none';
  el('rate-display').style.display = 'inline';
  render();
});
el('rate-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') el('rate-input').blur(); });

el('sign-in-btn').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch {
    showError("Sign-in failed. Try again.");
  }
});

el('sign-out-btn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    uid = user.uid;
    el('signed-out').style.display = 'none';
    el('app').style.display = 'block';
    await loadRate();
    await loadMonth(year, month);
    render();
  } else {
    uid = null;
    el('app').style.display = 'none';
    el('signed-out').style.display = 'block';
  }
});
