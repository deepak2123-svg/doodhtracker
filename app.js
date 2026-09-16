import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, addDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAY_LABELS = ['S','M','T','W','T','F','S'];
const DEFAULT_QUICK_VALUES = ['2', '3', '4', '5']; // starter chips for a brand-new home; fully removable after

const today = new Date();
let year = today.getFullYear();
let month = today.getMonth();
let selectedDay = today.getDate();
let entries = {};
let rate = 60;
let rateHistory = []; // [{ date: 'YYYY-MM-DD', rate: number }, ...] sorted ascending by date
let dudhiyaName = '';
let quickValues = []; // this home's tappable litre chips — starts from DEFAULT_QUICK_VALUES, fully editable
let editingQuickValues = false;
let uid = null;
let activeTab = 'ledger';
let homes = [];
let currentHomeId = null;
let renamingHomeId = null;
let confirmDeleteHomeId = null;

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

// ---------- Homes ----------

function homeDocRef(homeId) { return doc(db, 'users', uid, 'homes', homeId); }
function homeMonthsCol(homeId) { return collection(db, 'users', uid, 'homes', homeId, 'months'); }
function homeMonthDocRef(homeId, y, m) { return doc(db, 'users', uid, 'homes', homeId, 'months', monthKey(y, m)); }

function getCurrentHome() { return homes.find((h) => h.id === currentHomeId) || homes[0]; }

function getStoredHomeId() {
  try { return localStorage.getItem('doodh-current-home'); } catch { return null; }
}
function setStoredHomeId(id) {
  try { localStorage.setItem('doodh-current-home', id); } catch { /* ignore */ }
}

async function migrateLegacyDataIfNeeded() {
  try {
    let legacyRate = 60;
    let legacyDudhiya = '';
    let legacyHistory = [];
    const legacySettingsSnap = await getDoc(doc(db, 'users', uid, 'settings', 'main'));
    if (legacySettingsSnap.exists()) {
      const d = legacySettingsSnap.data();
      if (typeof d.rate === 'number') legacyRate = d.rate;
      if (typeof d.dudhiyaName === 'string') legacyDudhiya = d.dudhiyaName;
      if (Array.isArray(d.rateHistory)) legacyHistory = d.rateHistory;
    }
    const newHomeRef = await addDoc(collection(db, 'users', uid, 'homes'), {
      name: 'My Home', dudhiyaName: legacyDudhiya, rate: legacyRate, rateHistory: legacyHistory,
      quickValues: DEFAULT_QUICK_VALUES.slice()
    });
    const legacyMonthsSnap = await getDocs(collection(db, 'users', uid, 'months'));
    for (const m of legacyMonthsSnap.docs) {
      await setDoc(doc(db, 'users', uid, 'homes', newHomeRef.id, 'months', m.id), m.data());
    }
  } catch {
    // best-effort migration; fall through to the empty-homes check below
  }
}

async function loadHomes() {
  let snap = await getDocs(collection(db, 'users', uid, 'homes'));
  if (snap.empty) {
    await migrateLegacyDataIfNeeded();
    snap = await getDocs(collection(db, 'users', uid, 'homes'));
  }
  if (snap.empty) {
    // No legacy data either — brand new user, create a starter home.
    await addDoc(collection(db, 'users', uid, 'homes'), {
      name: 'My Home', dudhiyaName: '', rate: 60, rateHistory: [], quickValues: DEFAULT_QUICK_VALUES.slice()
    });
    snap = await getDocs(collection(db, 'users', uid, 'homes'));
  }
  homes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function switchHome(homeId) {
  currentHomeId = homeId;
  setStoredHomeId(homeId);
  const home = getCurrentHome();
  rate = typeof home.rate === 'number' ? home.rate : 60;
  dudhiyaName = home.dudhiyaName || '';
  rateHistory = Array.isArray(home.rateHistory)
    ? home.rateHistory.slice().sort((a, b) => a.date.localeCompare(b.date))
    : [];
  quickValues = Array.isArray(home.quickValues) ? home.quickValues.slice() : DEFAULT_QUICK_VALUES.slice();
  selectedDay = isCurrentMonth() ? today.getDate() : 1;
  editingQuickValues = false;
  closeHomeMenu();
  renderHomeBar();
  await loadMonth(year, month);
  render();
}

async function addHome(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  vibrate(12);
  const ref = await addDoc(collection(db, 'users', uid, 'homes'), {
    name: trimmed, dudhiyaName: '', rate: 60, rateHistory: [], quickValues: DEFAULT_QUICK_VALUES.slice()
  });
  homes.push({ id: ref.id, name: trimmed, dudhiyaName: '', rate: 60, rateHistory: [], quickValues: DEFAULT_QUICK_VALUES.slice() });
  await switchHome(ref.id);
}

async function renameHome(homeId, newName) {
  const trimmed = newName.trim();
  if (!trimmed) { renamingHomeId = null; renderHomeMenu(); return; }
  try {
    await setDoc(homeDocRef(homeId), { name: trimmed }, { merge: true });
    showError('');
  } catch {
    showError("Couldn't rename this home. Try again.");
  }
  const home = homes.find((h) => h.id === homeId);
  if (home) home.name = trimmed;
  renamingHomeId = null;
  if (homeId === currentHomeId) renderHomeBar();
  renderHomeMenu();
}

async function deleteHome(homeId) {
  if (homes.length <= 1) {
    showError("You need at least one home — add another before deleting this one.");
    confirmDeleteHomeId = null;
    renderHomeMenu();
    return;
  }
  try {
    const monthsSnap = await getDocs(homeMonthsCol(homeId));
    for (const m of monthsSnap.docs) { await deleteDoc(m.ref); }
    await deleteDoc(homeDocRef(homeId));
    showError('');
  } catch {
    showError("Couldn't delete this home. Try again.");
    confirmDeleteHomeId = null;
    renderHomeMenu();
    return;
  }
  homes = homes.filter((h) => h.id !== homeId);
  confirmDeleteHomeId = null;
  if (currentHomeId === homeId) {
    await switchHome(homes[0].id);
    openHomeMenu();
  } else {
    renderHomeMenu();
  }
}

function renderHomeBar() {
  const home = getCurrentHome();
  el('home-switch-label').textContent = home ? home.name : 'Home';
}

function renderHomeMenu() {
  el('home-menu-list').innerHTML = homes.map((h) => {
    const active = h.id === currentHomeId;

    if (confirmDeleteHomeId === h.id) {
      return `<div class="home-menu-confirm">
        <span>Delete "${h.name}" and all its data?</span>
        <div class="home-menu-confirm-actions">
          <button class="home-menu-confirm-btn danger" data-confirm-delete="${h.id}">Delete</button>
          <button class="home-menu-confirm-btn" data-cancel-delete="${h.id}">Cancel</button>
        </div>
      </div>`;
    }

    if (renamingHomeId === h.id) {
      return `<div class="home-menu-rename">
        <input type="text" class="home-rename-input" data-rename-id="${h.id}" value="${h.name}" />
        <button class="home-menu-icon-btn confirm" data-save-rename="${h.id}" aria-label="Save name">&#10003;</button>
        <button class="home-menu-icon-btn" data-cancel-rename="${h.id}" aria-label="Cancel">&times;</button>
      </div>`;
    }

    return `<div class="home-menu-item${active ? ' active' : ''}" data-home-id="${h.id}">
      <button class="home-menu-select" data-select-home="${h.id}">
        <span>${h.name}</span>${active ? '<span class="check">&#10003;</span>' : ''}
      </button>
      <button class="home-menu-icon-btn" data-rename="${h.id}" aria-label="Rename">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
      </button>
      <button class="home-menu-icon-btn" data-delete="${h.id}" aria-label="Delete">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 7h12l-1 13.5a1.5 1.5 0 01-1.5 1.5h-7a1.5 1.5 0 01-1.5-1.5L6 7zm3-3h6l1 2H8l1-2z"/></svg>
      </button>
    </div>`;
  }).join('');

  el('home-menu-list').querySelectorAll('[data-select-home]').forEach((btn) => {
    btn.addEventListener('click', () => { vibrate(); switchHome(btn.dataset.selectHome); });
  });
  el('home-menu-list').querySelectorAll('[data-rename]').forEach((btn) => {
    btn.addEventListener('click', () => { vibrate(); renamingHomeId = btn.dataset.rename; renderHomeMenu(); });
  });
  el('home-menu-list').querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => { vibrate(); confirmDeleteHomeId = btn.dataset.delete; renderHomeMenu(); });
  });
  el('home-menu-list').querySelectorAll('[data-save-rename]').forEach((btn) => {
    btn.addEventListener('click', () => {
      vibrate();
      const input = document.querySelector(`.home-rename-input[data-rename-id="${btn.dataset.saveRename}"]`);
      renameHome(btn.dataset.saveRename, input.value);
    });
  });
  el('home-menu-list').querySelectorAll('[data-cancel-rename]').forEach((btn) => {
    btn.addEventListener('click', () => { vibrate(); renamingHomeId = null; renderHomeMenu(); });
  });
  el('home-menu-list').querySelectorAll('.home-rename-input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') renameHome(input.dataset.renameId, input.value);
      if (e.key === 'Escape') { renamingHomeId = null; renderHomeMenu(); }
    });
  });
  el('home-menu-list').querySelectorAll('[data-confirm-delete]').forEach((btn) => {
    btn.addEventListener('click', () => { vibrate(15); deleteHome(btn.dataset.confirmDelete); });
  });
  el('home-menu-list').querySelectorAll('[data-cancel-delete]').forEach((btn) => {
    btn.addEventListener('click', () => { vibrate(); confirmDeleteHomeId = null; renderHomeMenu(); });
  });
}

function openHomeMenu() {
  renamingHomeId = null;
  confirmDeleteHomeId = null;
  renderHomeMenu();
  el('home-menu').style.display = 'block';
}
function closeHomeMenu() {
  renamingHomeId = null;
  confirmDeleteHomeId = null;
  el('home-menu').style.display = 'none';
}
function toggleHomeMenu() {
  const isOpen = el('home-menu').style.display === 'block';
  if (isOpen) closeHomeMenu(); else openHomeMenu();
}

// ---------- Firestore access (scoped to current home) ----------

async function addRateChange(newRate, effectiveDate, dudhiyaVal) {
  const next = rateHistory.filter((e) => e.date !== effectiveDate);
  next.push({ date: effectiveDate, rate: newRate });
  next.sort((a, b) => a.date.localeCompare(b.date));
  rateHistory = next;
  rate = newRate; // fallback / most-recent value for legacy display
  dudhiyaName = dudhiyaVal;
  const home = getCurrentHome();
  if (home) { home.rate = newRate; home.dudhiyaName = dudhiyaVal; home.rateHistory = next; }
  try {
    await setDoc(homeDocRef(currentHomeId), {
      rate: newRate, dudhiyaName: dudhiyaVal, rateHistory: next
    }, { merge: true });
    showError('');
  } catch {
    showError("Couldn't save settings. Try again.");
  }
}

function getAllQuickValues() {
  return quickValues.slice().sort((a, b) => parseFloat(a) - parseFloat(b));
}

async function saveQuickValues() {
  const home = getCurrentHome();
  if (home) home.quickValues = quickValues;
  try {
    await setDoc(homeDocRef(currentHomeId), { quickValues }, { merge: true });
  } catch {
    showError("Couldn't save your quick options. Try again.");
  }
}

async function addQuickValue(value) {
  const cleaned = String(value).replace(/[^0-9.]/g, '');
  if (cleaned === '' || parseFloat(cleaned) <= 0) return;
  const already = quickValues.some((v) => parseFloat(v) === parseFloat(cleaned));
  if (!already) {
    quickValues.push(cleaned);
    await saveQuickValues();
  }
  applyValue(cleaned);
}

async function removeQuickValue(value) {
  quickValues = quickValues.filter((v) => parseFloat(v) !== parseFloat(value));
  await saveQuickValues();
  render();
}

async function loadMonth(y, m) {
  showLoading(true);
  try {
    const snap = await getDoc(homeMonthDocRef(currentHomeId, y, m));
    entries = snap.exists() ? (snap.data().entries || {}) : {};
  } catch {
    entries = {};
    showError("Couldn't load this month. Check your connection.");
  }
  showLoading(false);
}

async function saveMonth(y, m) {
  try {
    await setDoc(homeMonthDocRef(currentHomeId, y, m), { entries }, { merge: false });
    showError('');
  } catch {
    showError("Couldn't save. Try again.");
  }
}

async function loadAllTimeStats() {
  try {
    const snapshot = await getDocs(homeMonthsCol(currentHomeId));
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
  ['ledger', 'profile'].forEach((t) => {
    el(`tab-${t}`).style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
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
    if (isToday(d)) classes.push('is-today');
    if (d === selectedDay) classes.push('selected');
    let dotClass = '';
    if (entries[d] !== undefined) {
      dotClass = parseFloat(entries[d]) > 0 ? 'day-dot milk' : 'day-dot no-milk';
    }
    cells.push(`<button class="${classes.join(' ')}" data-day="${d}">${d}<span class="${dotClass || 'day-dot'}"></span></button>`);
  }
  el('calendar').innerHTML = cells.join('');
  el('calendar').querySelectorAll('.day-cell').forEach((btn) => {
    btn.addEventListener('click', () => {
      vibrate();
      selectedDay = parseInt(btn.dataset.day, 10);
      editingQuickValues = false;
      render();
    });
  });

  const selectedValue = entries[selectedDay];
  const isNoMilkSelected = selectedValue !== undefined && parseFloat(selectedValue) === 0;
  let statusText = '';
  if (selectedValue !== undefined) {
    statusText = isNoMilkSelected ? ' — No milk' : ` — ${fmtLitres(parseFloat(selectedValue))} L logged`;
  }
  el('day-label').innerHTML = `<span>${pad(selectedDay)} ${weekdayShort(year, month, selectedDay)}${statusText}</span> ` +
    `<button id="edit-quick-toggle" class="edit-toggle">${editingQuickValues ? 'Done' : 'Edit options'}</button>`;
  el('edit-quick-toggle').addEventListener('click', () => {
    vibrate();
    editingQuickValues = !editingQuickValues;
    render();
  });

  const allValues = getAllQuickValues();
  const chipParts = allValues.map((v) => {
    const active = !editingQuickValues && selectedValue !== undefined && parseFloat(selectedValue) === parseFloat(v);
    if (editingQuickValues) {
      return `<span class="chip-editable">
        <button class="chip chip-quick" data-value="${v}">${fmtLitres(parseFloat(v))} L</button>
        <button class="chip-remove-x" data-remove="${v}" aria-label="Remove">&times;</button>
      </span>`;
    }
    return `<button class="chip chip-quick${active ? ' active' : ''}" data-value="${v}">${fmtLitres(parseFloat(v))} L</button>`;
  });
  if (!editingQuickValues) {
    chipParts.push(`<button class="chip no-milk${isNoMilkSelected ? ' active' : ''}" id="no-milk-btn">No milk</button>`);
    if (selectedValue !== undefined) chipParts.push(`<button class="chip-clear" id="clear-day">clear</button>`);
    chipParts.push(`<button class="chip other" id="other-btn">other</button>`);
  }
  chipParts.push(`<button class="chip add-quick" id="add-quick-btn">+ Add</button>`);
  el('quick-values').innerHTML = chipParts.join('');

  if (editingQuickValues) {
    el('quick-values').querySelectorAll('.chip-remove-x').forEach((btn) => {
      btn.addEventListener('click', () => { vibrate(15); removeQuickValue(btn.dataset.remove); });
    });
  } else {
    el('quick-values').querySelectorAll('.chip[data-value]').forEach((btn) => {
      btn.addEventListener('click', () => { vibrate(); applyValue(btn.dataset.value); });
    });
    el('no-milk-btn').addEventListener('click', () => { vibrate(); applyValue('0'); });
    const clearBtn = el('clear-day');
    if (clearBtn) clearBtn.addEventListener('click', () => { vibrate(); applyValue(''); });
    el('other-btn').addEventListener('click', () => { vibrate(); showManualInput(); });
  }
  el('add-quick-btn').addEventListener('click', () => { vibrate(); showAddQuickInput(); });

  renderInvoice();
}

function showAddQuickInput() {
  el('quick-values').insertAdjacentHTML('beforeend',
    `<input id="add-quick-input" type="text" inputmode="decimal" placeholder="litres" />`);
  const input = el('add-quick-input');
  input.focus();
  const commit = () => {
    if (input.value !== '') addQuickValue(input.value);
    else render();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
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
    .filter((d) => entries[d] !== undefined)
    .sort((a, b) => a - b);

  let totalLitres = 0;
  let totalAmount = 0;
  let milkDaysCount = 0;
  const ratesUsed = new Set();
  const rows = days.map((d) => {
    const litres = parseFloat(entries[d]);
    const isNoMilk = litres === 0;
    const dayRate = rateForDate(dateStr(year, month, d));
    const amount = litres * dayRate;
    totalLitres += litres;
    totalAmount += amount;
    if (!isNoMilk) { milkDaysCount += 1; ratesUsed.add(dayRate); }
    const rowClass = isNoMilk ? ' class="invoice-row-zero"' : '';
    const rateCell = isNoMilk ? '\u2014' : `&#8377;${fmtLitres(dayRate)}`;
    const litresCell = isNoMilk ? 'No milk' : `${fmtLitres(litres)} L`;
    return `<tr${rowClass}><td>${pad(d)} ${weekdayShort(year, month, d)}</td><td>${litresCell}</td><td>${rateCell}</td><td>${fmtRupees(amount)}</td></tr>`;
  });

  el('invoice-body').innerHTML = rows.join('');
  el('invoice-empty').style.display = days.length === 0 ? 'block' : 'none';
  el('invoice-total-litres').textContent = `${fmtLitres(totalLitres)} L`;
  el('invoice-total-amount').textContent = fmtRupees(totalAmount);

  const totalDaysInMonth = daysInMonth(year, month);
  const noMilkCount = days.length - milkDaysCount;
  const avg = milkDaysCount > 0 ? totalLitres / milkDaysCount : 0;
  el('invoice-days-logged').textContent = `${days.length} of ${totalDaysInMonth} days logged` +
    (noMilkCount > 0 ? ` (${noMilkCount} no milk)` : '');
  el('invoice-avg').textContent = milkDaysCount > 0 ? `Average ${fmtLitres(avg)} L / milk day` : '';
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

  if (cleaned === '' && wasSet !== undefined) {
    const dayLabel = `${pad(selectedDay)} ${weekdayShort(year, month, selectedDay)}`;
    const clearedLabel = parseFloat(wasSet) > 0 ? `${fmtLitres(parseFloat(wasSet))} L` : 'the no-milk mark';
    showToast(`Cleared ${clearedLabel} on ${dayLabel}`, () => {
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
  editingQuickValues = false;
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
    .filter((d) => entries[d] !== undefined)
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
    const isNoMilk = litres === 0;
    const dayRate = rateForDate(dateStr(year, month, d));
    const amount = litres * dayRate;
    totalLitres += litres;
    totalAmount += amount;
    rows.push([`${pad(d)} ${weekdayShort(year, month, d)}`, isNoMilk ? 'No milk' : litres, isNoMilk ? '' : dayRate, Math.round(amount)]);
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
  renderPricing();
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

el('home-switch-btn').addEventListener('click', (e) => { e.stopPropagation(); vibrate(); toggleHomeMenu(); });
el('home-add-btn').addEventListener('click', () => {
  const input = el('home-add-input');
  addHome(input.value);
  input.value = '';
});
el('home-add-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addHome(e.target.value);
    e.target.value = '';
  }
});
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.home-switch-wrap');
  if (wrap && !wrap.contains(e.target)) closeHomeMenu();
});

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
    await loadHomes();
    const storedId = getStoredHomeId();
    const initialId = (storedId && homes.some((h) => h.id === storedId)) ? storedId : homes[0].id;
    await switchHome(initialId);
    switchTab('ledger');
  } else {
    uid = null;
    homes = [];
    currentHomeId = null;
    el('app').style.display = 'none';
    el('signed-out').style.display = 'block';
  }
});
