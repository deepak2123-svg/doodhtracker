import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs
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
let rateHistory = []; // [{ date: 'YYYY-MM-DD', rate: number }, ...] sorted ascending by date
let dudhiyaName = '';
let uid = null;
let activeTab = 'ledger';

const el = (id) => document.getElementById(id);

function vibrate(ms = 8) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// ---------- Theme (light / dark / system) ----------

function applyTheme(pref) {
  if (pref === 'light' || pref === 'dark') {
    document.documentElement.setAttribute('data-theme', pref);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  document.querySelectorAll('.theme-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === pref);
  });
  const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = pref === 'dark' || (pref === 'system' && systemDark);
  const metaTags = document.querySelectorAll('meta[name="theme-color"]');
  metaTags.forEach((tag) => { tag.content = isDark ? '#1D2B29' : '#FFFFFF'; });
}

function getStoredTheme() {
  try { return localStorage.getItem('doodh-theme') || 'system'; } catch { return 'system'; }
}

function setStoredTheme(pref) {
  try { localStorage.setItem('doodh-theme', pref); } catch { /* storage unavailable, ignore */ }
}

applyTheme(getStoredTheme());

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
function dateStr(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function fmtDateReadable(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function entryForDate(iso) {
  let applicable = null;
  for (const entry of rateHistory) {
    if (entry.date <= iso && (!applicable || entry.date > applicable.date)) {
      applicable = entry;
    }
  }
  return applicable;
}

function rateForDate(iso) {
  const entry = entryForDate(iso);
  return entry ? entry.rate : rate;
}

function currentRate() {
  return rateForDate(dateStr(today.getFullYear(), today.getMonth(), today.getDate()));
}
function isCurrentMonth() { return year === today.getFullYear() && month === today.getMonth(); }
function isToday(d) { return isCurrentMonth() && d === today.getDate(); }

function showError(msg) { el('error').textContent = msg || ''; }
function showLoading(v) { el('loading').style.display = v ? 'block' : 'none'; }

// ---------- Undo toast ----------

let toastTimer = null;
function showToast(message, onUndo) {
  clearTimeout(toastTimer);
  el('toast-msg').textContent = message;
  el('toast').style.display = 'flex';
  const undoBtn = el('toast-undo');
  undoBtn.onclick = () => {
    clearTimeout(toastTimer);
    el('toast').style.display = 'none';
    onUndo();
  };
  toastTimer = setTimeout(() => { el('toast').style.display = 'none'; }, 5000);
}

// ---------- Firestore access ----------

async function loadRate() {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'settings', 'main'));
    if (snap.exists()) {
      const data = snap.data();
      if (typeof data.rate === 'number') rate = data.rate;
      if (typeof data.dudhiyaName === 'string') dudhiyaName = data.dudhiyaName;
      if (Array.isArray(data.rateHistory)) {
        rateHistory = data.rateHistory.slice().sort((a, b) => a.date.localeCompare(b.date));
      }
    }
  } catch {
    showError("Couldn't load your rate. Check your connection.");
  }
}

async function addRateChange(newRate, effectiveDate, dudhiyaVal) {
  const next = rateHistory.filter((e) => e.date !== effectiveDate);
  next.push({ date: effectiveDate, rate: newRate });
  next.sort((a, b) => a.date.localeCompare(b.date));
  rateHistory = next;
  rate = newRate; // fallback / most-recent value for legacy display
  dudhiyaName = dudhiyaVal;
  try {
    await setDoc(doc(db, 'users', uid, 'settings', 'main'), {
      rate: newRate, dudhiyaName: dudhiyaVal, rateHistory: next
    }, { merge: true });
    showError('');
  } catch {
    showError("Couldn't save settings. Try again.");
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

async function loadAllTimeStats() {
  try {
    const snapshot = await getDocs(collection(db, 'users', uid, 'months'));
    let litres = 0;
    let amount = 0;
    const byMonth = {}; // { 'YYYY-MM': { litres, amount } }
    snapshot.forEach((docSnap) => {
      const [y, m] = docSnap.id.split('-').map(Number);
      const monthEntries = docSnap.data().entries || {};
      let mLitres = 0;
      let mAmount = 0;
      Object.entries(monthEntries).forEach(([dayStr, v]) => {
        const n = parseFloat(v);
        if (!isNaN(n) && n > 0) {
          const a = n * rateForDate(dateStr(y, m - 1, parseInt(dayStr, 10)));
          litres += n;
          amount += a;
          mLitres += n;
          mAmount += a;
        }
      });
      byMonth[docSnap.id] = { litres: mLitres, amount: mAmount };
    });
    return { litres, amount, byMonth };
  } catch {
    return { litres: 0, amount: 0, byMonth: {} };
  }
}

// ---------- Tab switching ----------

function switchTab(tab) {
  activeTab = tab;
  ['ledger', 'pricing', 'profile'].forEach((t) => {
    el(`tab-${t}`).style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if (tab === 'pricing') renderPricing();
  if (tab === 'profile') renderProfile();
}

// ---------- Rendering: Ledger ----------

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
      vibrate();
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
    btn.addEventListener('click', () => { vibrate(); applyValue(btn.dataset.value); });
  });
  const clearBtn = el('clear-day');
  if (clearBtn) clearBtn.addEventListener('click', () => { vibrate(); applyValue(''); });
  el('other-btn').addEventListener('click', () => { vibrate(); showManualInput(); });

  renderInvoice();
}

function renderInvoice() {
  el('invoice-title').textContent = `${MONTH_NAMES[month]} ${year}`;

  const user = auth.currentUser;
  el('meta-customer').textContent = (user && (user.displayName || user.email)) || '—';
  el('meta-dudhiya').textContent = dudhiyaName || '—';
  el('meta-period').textContent = `${MONTH_NAMES[month]} ${year}`;
  el('meta-generated').textContent = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const days = Object.keys(entries)
    .map(Number)
    .filter((d) => parseFloat(entries[d]) > 0)
    .sort((a, b) => a - b);

  let totalLitres = 0;
  let totalAmount = 0;
  const ratesUsed = new Set();
  const rows = days.map((d) => {
    const litres = parseFloat(entries[d]);
    const dayRate = rateForDate(dateStr(year, month, d));
    const amount = litres * dayRate;
    totalLitres += litres;
    totalAmount += amount;
    ratesUsed.add(dayRate);
    return `<tr><td>${pad(d)} ${weekdayShort(year, month, d)}</td><td>${fmtLitres(litres)} L</td><td>&#8377;${fmtLitres(dayRate)}</td><td>${fmtRupees(amount)}</td></tr>`;
  });

  el('invoice-body').innerHTML = rows.join('');
  el('invoice-empty').style.display = days.length === 0 ? 'block' : 'none';
  el('invoice-total-litres').textContent = `${fmtLitres(totalLitres)} L`;
  el('invoice-total-amount').textContent = fmtRupees(totalAmount);

  const totalDaysInMonth = daysInMonth(year, month);
  const avg = days.length > 0 ? totalLitres / days.length : 0;
  el('invoice-days-logged').textContent = `${days.length} of ${totalDaysInMonth} days logged`;
  el('invoice-avg').textContent = days.length > 0 ? `Average ${fmtLitres(avg)} L / logged day` : '';
  el('invoice-rate').textContent = ratesUsed.size > 1
    ? `Rate changed mid-month \u2014 see per-day rate above`
    : `Rate: \u20B9${fmtLitres(currentRate())} / litre`;
  el('progress-fill').style.width = `${Math.min(100, (days.length / totalDaysInMonth) * 100)}%`;
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

function applyValue(value) {
  const cleaned = String(value).replace(/[^0-9.]/g, '');
  const wasSet = entries[selectedDay];
  if (cleaned === '') delete entries[selectedDay];
  else entries[selectedDay] = cleaned;
  saveMonth(year, month);
  render();

  if (cleaned === '' && wasSet) {
    const dayLabel = `${pad(selectedDay)} ${weekdayShort(year, month, selectedDay)}`;
    showToast(`Cleared ${fmtLitres(parseFloat(wasSet))} L on ${dayLabel}`, () => {
      entries[selectedDay] = wasSet;
      saveMonth(year, month);
      render();
    });
  }
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
  const actions = document.querySelector('.invoice-header-actions');
  actions.style.visibility = 'hidden';
  window.html2pdf().from(el('invoice-panel')).set({
    filename,
    margin: 12,
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).save().then(() => {
    actions.style.visibility = 'visible';
  });
}

function exportExcel() {
  const days = Object.keys(entries)
    .map(Number)
    .filter((d) => parseFloat(entries[d]) > 0)
    .sort((a, b) => a - b);

  const user = auth.currentUser;
  const rows = [
    ['Doodh Ka Hisaab \u2014 Milk Invoice'],
    ['Billed to', (user && (user.displayName || user.email)) || ''],
    ['Dudhiya', dudhiyaName || ''],
    ['Period', `${MONTH_NAMES[month]} ${year}`],
    ['Generated', new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })],
    [],
    ['Date', 'Litres', 'Rate (\u20B9/L)', 'Amount (\u20B9)'],
  ];

  let totalLitres = 0;
  let totalAmount = 0;
  days.forEach((d) => {
    const litres = parseFloat(entries[d]);
    const dayRate = rateForDate(dateStr(year, month, d));
    const amount = litres * dayRate;
    totalLitres += litres;
    totalAmount += amount;
    rows.push([`${pad(d)} ${weekdayShort(year, month, d)}`, litres, dayRate, Math.round(amount)]);
  });

  rows.push([]);
  rows.push(['Total', totalLitres, '', Math.round(totalAmount)]);

  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Invoice');
  window.XLSX.writeFile(wb, `milk-invoice-${monthKey(year, month)}.xlsx`);
}

// ---------- Rendering: Pricing ----------

function renderPricing() {
  el('pricing-rate-value').textContent = fmtLitres(currentRate());
  el('rate-input').value = '';
  const todayIso = dateStr(today.getFullYear(), today.getMonth(), today.getDate());
  el('rate-effective-date').value = todayIso;
  el('rate-effective-date').max = todayIso;
  el('dudhiya-input').value = dudhiyaName;

  const sorted = rateHistory.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) {
    el('rate-history-list').innerHTML = `<div class="timeline-item"><div class="timeline-date">Start</div><div class="timeline-dot"></div><div class="timeline-rate">&#8377;${fmtLitres(rate)}</div></div>`;
  } else {
    const currentEntry = entryForDate(todayIso);
    el('rate-history-list').innerHTML = sorted.map((e) => {
      const isCurrent = currentEntry && e.date === currentEntry.date;
      return `<div class="timeline-item${isCurrent ? ' current' : ''}">
        <div class="timeline-date">${fmtDateReadable(e.date)}</div>
        <div class="timeline-dot"></div>
        <div class="timeline-rate">&#8377;${fmtLitres(e.rate)}</div>
      </div>`;
    }).join('');
  }
}

async function saveRateFromPricing() {
  vibrate(15);
  const cleaned = el('rate-input').value.replace(/[^0-9.]/g, '');
  if (cleaned === '') { showError('Enter a rate before saving.'); return; }
  const val = parseFloat(cleaned);
  const effectiveDate = el('rate-effective-date').value || dateStr(today.getFullYear(), today.getMonth(), today.getDate());
  const dudhiyaVal = el('dudhiya-input').value.trim();
  await addRateChange(val, effectiveDate, dudhiyaVal);
  renderPricing();
  renderInvoice();
}

// ---------- Rendering: Profile ----------

function renderProfile() {
  const user = auth.currentUser;
  if (!user) return;
  el('profile-photo').src = user.photoURL || '';
  el('profile-name').textContent = user.displayName || 'Milk ledger user';
  el('profile-email').textContent = user.email || '';
  el('profile-total-litres').textContent = '…';
  el('profile-total-amount').textContent = '…';
  el('months-chart').innerHTML = '';
  loadAllTimeStats().then(({ litres, amount, byMonth }) => {
    el('profile-total-litres').textContent = `${fmtLitres(litres)} L`;
    el('profile-total-amount').textContent = fmtRupees(amount);
    renderMonthsChart(byMonth);
  });
}

function renderMonthsChart(byMonth) {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    let m = today.getMonth() - i;
    let y = today.getFullYear();
    while (m < 0) { m += 12; y -= 1; }
    const key = monthKey(y, m);
    const data = byMonth[key] || { litres: 0, amount: 0 };
    months.push({ key, y, m, amount: data.amount, litres: data.litres });
  }
  const max = Math.max(1, ...months.map((mo) => mo.amount));
  el('months-chart').innerHTML = months.map((mo) => {
    const heightPct = Math.max(2, (mo.amount / max) * 100);
    const isCurrent = mo.y === today.getFullYear() && mo.m === today.getMonth();
    const shortLabel = MONTH_NAMES[mo.m].slice(0, 3);
    return `<div class="month-bar-col${isCurrent ? ' is-current' : ''}">
      <span class="month-bar-value">${mo.amount > 0 ? fmtRupees(mo.amount) : ''}</span>
      <div class="month-bar" style="height:${heightPct}%"></div>
      <span class="month-bar-label">${shortLabel}</span>
      <span class="month-bar-litres">${mo.litres > 0 ? `${fmtLitres(mo.litres)} L` : ''}</span>
    </div>`;
  }).join('');
}

// ---------- Wiring ----------

document.querySelectorAll('.nav-tab').forEach((btn) => {
  btn.addEventListener('click', () => { vibrate(); switchTab(btn.dataset.tab); });
});

document.querySelectorAll('.theme-option').forEach((btn) => {
  btn.addEventListener('click', () => {
    vibrate();
    applyTheme(btn.dataset.theme);
    setStoredTheme(btn.dataset.theme);
  });
});

el('prev-month').addEventListener('click', () => goToMonth(-1));
el('next-month').addEventListener('click', () => goToMonth(1));
el('export-pdf-btn').addEventListener('click', exportPdf);
el('export-excel-btn').addEventListener('click', exportExcel);
el('save-rate-btn').addEventListener('click', saveRateFromPricing);
el('rate-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveRateFromPricing(); });
el('dudhiya-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveRateFromPricing(); });

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
    switchTab('ledger');
  } else {
    uid = null;
    el('app').style.display = 'none';
    el('signed-out').style.display = 'block';
  }
});
