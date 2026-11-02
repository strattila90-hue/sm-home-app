/* SM home dekor Planner – app logika
   Helyi mentés (offline is működik) + Supabase felhős szinkron, ha a config.js ki van töltve. */
(function () {
"use strict";

/* ---------- Alapok ---------- */
const CFG = window.SMHD_CONFIG || {};
const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const LS_KEY = "smhd-store-v2", LS_UI = "smhd-ui-v2";
const STATUSES = ["Megrendelve", "Elkészült", "Teljesítve"];
const PAY = ["Készpénz", "Bankkártya", "Átutalás", "Utánvét", "Egyéb"];
const DOC_LABELS = ["Vállalkozói nyilvántartás / igazolvány", "NAV adószám-igazolás", "Bejelentkezési nyomtatvány", "Szerződés", "Számla, bizonylat", "Egyéb dokumentum"];
const MON = ["jan", "feb", "márc", "ápr", "máj", "jún", "júl", "aug", "szept", "okt", "nov", "dec"];
const ROMAN = ["I.", "II.", "III.", "IV."];
const DEF = {
  types: [
    { name: "Falikárpit", price: 0, cost: 0, hours: 0 }, { name: "Növénytartó", price: 0, cost: 0, hours: 0 },
    { name: "Lámpabúra", price: 0, cost: 0, hours: 0 }, { name: "Tükörkeret", price: 0, cost: 0, hours: 0 },
    { name: "Kulcstartó", price: 0, cost: 0, hours: 0 }, { name: "Táska", price: 0, cost: 0, hours: 0 },
    { name: "Függöny", price: 0, cost: 0, hours: 0 }, { name: "Egyedi rendelés", price: 0, cost: 0, hours: 0 }],
  expCats: ["Könyvelő", "Fonal", "Nyersanyag", "Energia", "Csomagolás", "Posta, szállítás", "Marketing", "Egyéb"],
  channels: ["Instagram", "Facebook", "Webshop", "Személyes", "Vásár", "Egyéb"],
  prodCats: ["Fülbevalók", "Táskák", "Egyedi termékek"],
  fixed: [], target: 0, taxPct: 0, deductMaterial: true
};
const BIZ_DEF = {
  name: "SM home dekor", owner: "", address: "", taxNo: "", evNo: "", statNo: "", teaor: "",
  taxMode: "Átalányadó", vat: "aam", started: "", bank: "", email: "", phone: "",
  accountant: "", accountantContact: "", note: ""
};
const TAX_MODES = ["Átalányadó", "Vállalkozói jövedelem szerinti adózás", "KATA", "Egyéb"];

const clone = (o) => JSON.parse(JSON.stringify(o));
const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
let TODAY = dstr(new Date());
const ymOf = (ds) => ds.slice(0, 7);
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".").replace(/\s/g, "")); return isFinite(n) ? n : 0; };
const huf = (n) => Math.round(n || 0).toLocaleString("hu-HU") + " Ft";
const hrs = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString("hu-HU") + " ó";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const monthLabel = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("hu-HU", { year: "numeric", month: "long" }); };
const dayLabel = (ds) => new Date(ds + "T12:00").toLocaleDateString("hu-HU", { month: "long", day: "numeric" });
const fullDate = (ds) => ds ? new Date(ds + "T12:00").toLocaleDateString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit" }) : "";
const weekday = (ds) => new Date(ds + "T12:00").toLocaleDateString("hu-HU", { weekday: "long" });
const shiftMonth = (ym, k) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); };
const shiftDay = (ds, k) => { const d = new Date(ds + "T12:00"); d.setDate(d.getDate() + k); return dstr(d); };
const short = (v) => { const a = Math.abs(v); if (a >= 1e6) return (v / 1e6).toLocaleString("hu-HU", { maximumFractionDigits: 1 }) + " M"; if (a >= 1e3) return Math.round(v / 1e3) + "e"; return String(Math.round(v)); };
const fmtSize = (b) => b > 1048576 ? (b / 1048576).toLocaleString("hu-HU", { maximumFractionDigits: 1 }) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
function mergeDef(s) { const o = Object.assign(clone(DEF), s || {}); ["types", "expCats", "channels", "fixed", "prodCats"].forEach((k) => { if (!Array.isArray(o[k])) o[k] = clone(DEF[k]); }); return o; }
function normOrder(o) {
  o = Object.assign({}, o);
  if (o.status === "Átadva") o.status = "Teljesítve";
  if (!STATUSES.includes(o.status)) o.status = STATUSES[0];
  if (o.paid === undefined) o.paid = o.status === "Teljesítve" || !!o.payDate;
  return o;
}
/* Rendelés állapota a színekhez: lemaradt > nem fizetett > folyamatban > kész */
const STATE = {
  late: { label: "Lemaradt", rank: 3 }, unpaid: { label: "Nem fizetett", rank: 2 },
  open: { label: "Folyamatban", rank: 1 }, done: { label: "Kész, fizetve", rank: 0 }
};
function orderState(o) {
  if (o.status === "Megrendelve" && o.deadline && o.deadline < TODAY) return "late";
  if (o.status !== "Megrendelve" && !o.paid) return "unpaid";
  if (o.status === "Teljesítve" && o.paid) return "done";
  return "open";
}

/* ---------- Helyi tár ---------- */
const store = { recs: {}, dirty: {}, lastSync: null, uid: null };
try { const s = JSON.parse(localStorage.getItem(LS_KEY) || "null"); if (s && s.recs) Object.assign(store, s); } catch (e) { /* üres indulás */ }
let ver = 0;
let persistT = null;
function persist() { clearTimeout(persistT); try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { toast("Megtelt a telefon tárhelye, a legutóbbi módosítás nem mentődött."); } }
function persistSoon() { clearTimeout(persistT); persistT = setTimeout(persist, 300); }
window.addEventListener("pagehide", persist);
function resetStore() { store.recs = {}; store.dirty = {}; store.lastSync = null; ver++; persist(); }

let ui = { tab: "home", month: ymOf(TODAY), day: TODAY, year: +TODAY.slice(0, 4), rep: { year: +TODAY.slice(0, 4), kind: "q", n: Math.floor((+TODAY.slice(5, 7) - 1) / 3) + 1 }, auth: "login", recovery: false };
try { const u = JSON.parse(localStorage.getItem(LS_UI) || "null"); if (u && ["home", "log", "new", "exp", "more", "prod", "stock", "nav", "biz", "motiv", "draw", "set"].includes(u.tab)) ui.tab = u.tab; if (u) { if (u.prodSort) ui.prodSort = u.prodSort; if (u.prodCat) ui.prodCat = u.prodCat; } } catch (e) {}
function saveUi() { try { localStorage.setItem(LS_UI, JSON.stringify({ tab: ui.tab, prodSort: ui.prodSort, prodCat: ui.prodCat })); } catch (e) {} }

function setRec(id, kind, data, opts) {
  const prev = store.recs[id];
  store.recs[id] = { kind, data, deleted: false, updated_at: prev ? prev.updated_at : null };
  if (CLOUD) store.dirty[id] = (store.dirty[id] || 0) + 1;
  ver++; persistSoon(); flushSoon();
  if (!(opts && opts.quiet)) render(); else paintStatus();
}
function delRec(id, opts) {
  const r = store.recs[id]; if (!r) return;
  r.deleted = true;
  if (CLOUD) store.dirty[id] = (store.dirty[id] || 0) + 1; else delete store.recs[id];
  ver++; persistSoon(); flushSoon();
  if (!(opts && opts.quiet)) render();
}

/* ---------- Felhő (Supabase) ---------- */
let sb = null;
const sync = { state: "idle", err: "", firstDone: false };
const auth = { ready: false, email: "", msg: "", busy: false };
let flushing = false, pulling = false, flushT = null;
const online = () => navigator.onLine !== false;
function flushSoon() { if (!CLOUD) return; clearTimeout(flushT); flushT = setTimeout(flush, 1200); }

async function flush() {
  if (!sb || !store.uid || flushing || !online()) { paintStatus(); return; }
  const ids = Object.keys(store.dirty).filter((id) => store.recs[id]);
  Object.keys(store.dirty).forEach((id) => { if (!store.recs[id]) delete store.dirty[id]; });
  if (!ids.length) { paintStatus(); return; }
  flushing = true; sync.state = "sync"; paintStatus();
  const sent = {}; ids.forEach((id) => { sent[id] = store.dirty[id]; });
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200).map((id) => { const r = store.recs[id]; return { id, user_id: store.uid, kind: r.kind, data: r.data, deleted: !!r.deleted }; });
      const { data, error } = await sb.from("records").upsert(chunk, { onConflict: "user_id,id" }).select("id,updated_at");
      if (error) throw error;
      (data || []).forEach((x) => { const r = store.recs[x.id]; if (r) r.updated_at = x.updated_at; });
      chunk.forEach((c) => { if (store.dirty[c.id] === sent[c.id]) { delete store.dirty[c.id]; if (store.recs[c.id] && store.recs[c.id].deleted) delete store.recs[c.id]; } });
    }
    sync.state = "ok"; sync.err = "";
  } catch (e) {
    sync.state = "err"; sync.err = (e && e.message) || "ismeretlen hiba";
  } finally {
    flushing = false; persist(); paintStatus();
    if (sync.state === "ok" && Object.keys(store.dirty).length) flushSoon();
  }
}

async function pull() {
  if (!sb || !store.uid || pulling || !online()) { paintStatus(); return; }
  pulling = true; if (!flushing) { sync.state = "sync"; paintStatus(); }
  try {
    const since = store.lastSync || "1970-01-01T00:00:00Z";
    let from = 0, changed = false, maxTs = store.lastSync;
    for (;;) {
      const { data, error } = await sb.from("records").select("id,kind,data,deleted,updated_at")
        .gte("updated_at", since).order("updated_at", { ascending: true }).order("id", { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      for (const row of data) {
        if (!maxTs || row.updated_at > maxTs) maxTs = row.updated_at;
        if (store.dirty[row.id]) continue;
        const cur = store.recs[row.id];
        if (cur && cur.updated_at === row.updated_at) continue;
        if (row.deleted) { if (cur) { delete store.recs[row.id]; changed = true; } continue; }
        store.recs[row.id] = { kind: row.kind, data: row.data, deleted: false, updated_at: row.updated_at };
        changed = true;
      }
      if (data.length < 1000) break;
      from += 1000;
    }
    store.lastSync = maxTs; sync.state = "ok"; sync.err = "";
    persist();
    if (changed) { ver++; render(); }
  } catch (e) {
    sync.state = "err"; sync.err = (e && e.message) || "ismeretlen hiba";
  } finally { pulling = false; paintStatus(); }
}
async function syncNow() { await flush(); await pull(); migrateProdPhotos(); if (!sync.firstDone) { sync.firstDone = true; render(); } }

function applySession(s) {
  const id = (s && s.user && s.user.id) || null;
  auth.email = (s && s.user && s.user.email) || "";
  auth.ready = true;
  if (id && store.uid && store.uid !== id) resetStore();
  const changedUser = store.uid !== id;
  store.uid = id; persist();
  if (id && (changedUser || !sync.firstDone)) syncNow();
  render();
}
async function initCloud() {
  if (!window.supabase || !window.supabase.createClient) { auth.ready = true; sync.state = "offline"; render(); return; }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === "PASSWORD_RECOVERY") { ui.recovery = true; ui.auth = "newpass"; }
    setTimeout(() => applySession(session), 0);
  });
  try { const { data } = await sb.auth.getSession(); applySession(data.session); }
  catch (e) { auth.ready = true; render(); }
}
window.addEventListener("online", () => { syncNow(); });
window.addEventListener("offline", paintStatus);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { const t = dstr(new Date()); if (t !== TODAY) { TODAY = t; render(); } syncNow(); }
  else persist();
});
setInterval(() => { if (document.visibilityState === "visible") pull(); }, 60000);

/* ---------- Adatok, számítások ---------- */
let dv = -1, D = null;
function data() {
  if (dv === ver && D) return D;
  const orders = {}, expenses = {}, docs = {}, stock = {}, art = {}, products = {}; let settings = null, biz = null, motiv = null;
  for (const [id, r] of Object.entries(store.recs)) {
    if (!r || r.deleted) continue;
    if (r.kind === "order") orders[id] = normOrder(r.data);
    else if (r.kind === "expense") expenses[id] = r.data;
    else if (r.kind === "doc") docs[id] = r.data;
    else if (r.kind === "settings") {
      // több dolog is "settings" típusú rekordként tárolódik, így nem kell adatbázis-módosítás
      if (id.startsWith("stk-")) stock[id] = r.data;
      else if (id.startsWith("prd-")) products[id] = r.data;
      else if (id.startsWith("art-")) art[id] = r.data;
      else if (id === "motivation") motiv = r.data;
      else if (id === "settings") settings = r.data;
    }
    else if (r.kind === "business") biz = r.data;
  }
  D = { orders, expenses, docs, stock, art, products, motiv: Object.assign({ why: "", goals: [], notes: [] }, motiv || {}), settings: mergeDef(settings), biz: Object.assign(clone(BIZ_DEF), biz || {}) };
  dv = ver; return D;
}
const listOrders = (pre) => Object.entries(data().orders).filter(([, o]) => String(o.date || "").startsWith(pre)).map(([id, o]) => Object.assign({ id }, o));
const listExp = (pre) => Object.entries(data().expenses).filter(([, o]) => String(o.date || "").startsWith(pre)).map(([id, o]) => Object.assign({ id }, o));
const sum = (a, k) => a.reduce((s, x) => s + num(x[k]), 0);
function stats(pre) {
  const os = listOrders(pre), es = listExp(pre), s = data().settings;
  const rev = sum(os, "price"), mat = sum(os, "cost"), h = sum(os, "hours"), qty = sum(os, "qty"), exp = sum(es, "amount");
  const cost = (s.deductMaterial ? mat : 0) + exp, profit = rev - cost, tax = profit > 0 ? profit * num(s.taxPct) / 100 : 0;
  return { os, es, rev, mat, h, qty, exp, cost, profit, tax, net: profit - tax, hourly: h > 0 ? (rev - mat) / h : null, n: os.length };
}
const hasAny = () => Object.keys(data().orders).length + Object.keys(data().expenses).length > 0;
const saveSettings = (s, quiet) => setRec("settings", "settings", s, { quiet });

/* ---------- Ikonok ---------- */
const sv = (p, w) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 1.8}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
  prev: sv('<path d="M15 5l-7 7 7 7"/>', 2), next: sv('<path d="M9 5l7 7-7 7"/>', 2),
  home: sv('<path d="M4 20V10l8-6 8 6v10"/><path d="M9 20v-5h6v5"/>'),
  log: sv('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/><circle cx="9" cy="14.5" r="1" fill="currentColor"/><circle cx="15" cy="14.5" r="1" fill="currentColor"/>'),
  new: sv('<path d="M12 6v12M6 12h12"/>', 2.4),
  more: sv('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
  prod: sv('<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  cam: sv('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  gal: sv('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>'),
  search: sv('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  order: sv('<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  motiv: sv('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  draw: sv('<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>'),
  set: sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  exp: sv('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  nav: sv('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
  biz: sv('<path d="M4 9h16v11H4z"/><path d="M9 9V5h6v4M4 14h16"/>'),
  stock: sv('<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>'),
  minus: sv('<path d="M6 12h12"/>', 2.2), plus: sv('<path d="M12 6v12M6 12h12"/>', 2.2),
  x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  file: sv('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>')
};
const TABS = [["home", "Főoldal"], ["log", "Naptár"], ["new", "Új"], ["prod", "Árukészlet"], ["more", "Menü"]];
const MORE_TABS = ["more", "exp", "stock", "nav", "biz", "motiv", "draw", "set"];
const MORE = [
  ["Pénzügyek", [["exp", "Kiadások", "Fonal, posta, könyvelő, fix költségek"], ["nav", "NAV kimutatás", "Bevételi nyilvántartás, PDF, CSV"]]],
  ["Műhely", [["prod", "Árukészlet", "Termékfotók kategória és szín szerint"], ["stock", "Alapanyagok", "Fonal, kellékek, mennyiségek"]]],
  ["Vállalkozás", [["biz", "Cég adatai", "Adószám, hivatalos dokumentumok"], ["set", "Beállítások", "Termékárak, mentés, telepítés"]]],
  ["Magamnak", [["motiv", "Motiváció", "Miért csinálom, céljaim"], ["draw", "Rajztábla", "Vázlatok, kikapcsolódás"]]]
];
const SHELL_OK = (document.querySelector('meta[name="smhd-shell"]') || {}).content === "2.5";

/* ---------- Állapotjelző ---------- */
function paintStatus() {
  const el = document.getElementById("status"); if (!el) return;
  const pending = Object.keys(store.dirty).length;
  let cls = "ok", txt = "Szinkronizálva";
  if (!CLOUD) { cls = "local"; txt = "Helyi mód"; }
  else if (!store.uid) { cls = "local"; txt = "Kijelentkezve"; }
  else if (!online() || sync.state === "offline") { cls = "warn"; txt = pending ? `Offline · ${pending} mentésre vár` : "Offline"; }
  else if (sync.state === "sync") { cls = ""; txt = "Szinkronizálás…"; }
  else if (sync.state === "err") { cls = "err"; txt = "Szinkron hiba · újra"; }
  else if (pending) { cls = "warn"; txt = `${pending} mentésre vár`; }
  el.className = "status " + cls;
  el.querySelector("span").textContent = txt;
  el.title = sync.err || txt;
}

/* ---------- Renderelés ---------- */
let pending = false;
function render(force) {
  const main = document.getElementById("main"), ae = document.activeElement;
  if (!force && ae && main.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.type !== "checkbox" && ae.type !== "file") { pending = true; paintStatus(); return; }
  pending = false;
  paintStatus();
  const needAuth = CLOUD && (ui.recovery || (!store.uid && auth.ready));
  const loading = CLOUD && !store.uid && !auth.ready;
  document.getElementById("tabsNav").hidden = needAuth || loading;
  document.getElementById("gear").hidden = needAuth || loading;
  const fab = document.getElementById("fab");
  fab.hidden = needAuth || loading || !["exp", "stock"].includes(ui.tab);
  document.getElementById("fabLbl").textContent = ui.tab === "exp" ? "Új kiadás" : ui.tab === "prod" ? "Termék hozzáadása" : "Új tétel";
  if (loading) { main.innerHTML = '<div class="card empty"><h3>Betöltés…</h3><p>Egy pillanat, előkészítem a naplót.</p></div>'; return; }
  if (needAuth) { main.innerHTML = vAuth(); return; }
  const tabsEl = document.getElementById("tabs");
  tabsEl.style.gridTemplateColumns = `repeat(${TABS.length}, minmax(0, 1fr))`;
  tabsEl.innerHTML = TABS.map(([k, l]) => { const on = ui.tab === k || (k === "more" && MORE_TABS.includes(ui.tab)); return `<button type="button" class="${k === "new" ? "tab-new" : ""}" data-action="${k === "new" ? "choose" : "tab"}" data-t="${k}" ${on ? 'aria-current="page"' : ""} ${k === "new" ? 'aria-label="Új rögzítése: rendelés, kiadás, termékfotó"' : ""}>${k === "new" ? `<span class="new-dot">${I.new}</span>` : `<span class="ic">${I[k]}</span>`}<span>${l}</span></button>`; }).join("");
  if (ui.tab !== "new") stashDraft();
  const y = window.scrollY;
  if (CLOUD && !sync.firstDone && !hasAny() && online() && sb) { main.innerHTML = '<div class="card empty"><h3>Adatok letöltése…</h3><p>Szinkronizálom a felhőből a rendeléseket és kiadásokat.</p></div>'; return; }
  const shellWarn = SHELL_OK ? "" : '<div class="banner warn" style="margin-top:12px">Az <b>index.html</b> régi verziója van fent a GitHubon. Töltsd fel újra az új index.html fájlt, különben egyes gombok rosszul jelenhetnek meg.</div>';
  const back = MORE_TABS.includes(ui.tab) && ui.tab !== "more" ? `<div class="backbar noprint"><button type="button" class="back" data-action="tab" data-t="more">${I.prev}<span>Menü</span></button></div>` : "";
  main.innerHTML = shellWarn + back + ({ home: vHome, log: vLog, new: vNew, exp: vExp, more: vMore, prod: vProd, stock: vStock, nav: vNav, biz: vBiz, motiv: vMotiv, draw: vDraw, set: vSet }[ui.tab])();
  window.scrollTo(0, y);
  if (ui.tab === "new") { if (!sheet || !sheet.inline) { sheet = draftNew || newDraft(); draftNew = null; } drawSheet(); }
  loadThumbs();
  if (ui.tab === "set") drawQr();
  if (ui.tab === "draw") mountCanvas();
}
document.addEventListener("focusout", () => { setTimeout(() => { if (pending) render(); }, 0); });

function monthNav() { return `<div class="navrow"><button type="button" class="iconbtn" data-action="month" data-k="-1" aria-label="Előző hónap">${I.prev}</button><h2 class="cap">${esc(monthLabel(ui.month))}</h2><button type="button" class="iconbtn" data-action="month" data-k="1" aria-label="Következő hónap">${I.next}</button></div>`; }
const kpi = (k, v, h) => `<div class="kpi"><div class="k">${k}</div><div class="v num">${v}</div>${h ? `<div class="h">${h}</div>` : ""}</div>`;
function quickActions() { return `<div class="quick"><button type="button" class="qa" data-action="newOrder"><span class="mi">${I.order}</span>Új rendelés</button><button type="button" class="qa sage" data-action="newExp"><span class="mi">${I.exp}</span>Új kiadás</button><button type="button" class="qa cord" data-action="prodCam"><span class="mi">${I.cam}</span>Termékfotó</button></div>`; }
function emptyCard() { return `<div class="card empty"><h3>Kezdjük az első rendeléssel</h3><p>Rögzítsd, mit készítettél, mennyiből és mennyiért adtad el. Az összesítők maguktól kitöltődnek.</p><div class="btns" style="justify-content:center"><button type="button" class="btn primary" data-action="newOrder">Új rendelés</button><button type="button" class="btn" data-action="sample">Kipróbálom mintaadatokkal</button></div></div>`; }
const catBars = (cats) => { const ce = Object.entries(cats).sort((a, b) => b[1] - a[1]), mx = ce.length ? ce[0][1] || 1 : 1; return ce.map(([k, v]) => `<div class="catbar"><span>${esc(k)}</span><b class="num">${huf(v)}</b><div class="track"><b style="width:${v / mx * 100}%"></b></div></div>`).join(""); };

/* Belépés */
function vAuth() {
  const m = ui.auth, msg = auth.msg ? `<p class="note" style="margin:0;color:${auth.msgOk ? "var(--sage)" : "var(--danger)"}">${esc(auth.msg)}</p>` : "";
  const busy = auth.busy ? "disabled" : "";
  if (!online() && !store.uid) return `<div class="card auth stack"><h2>Nincs internet</h2><p class="note" style="margin:0">Az első belépéshez internetkapcsolat kell. Utána offline is használható.</p></div>`;
  if (m === "newpass") return `<form class="card auth stack" id="authForm" novalidate><h2>Új jelszó</h2><div class="field"><label for="au-pass">Új jelszó (min. 8 karakter)</label><input class="in-ctl" type="password" id="au-pass" autocomplete="new-password"></div>${msg}<button class="btn primary wide" type="submit" ${busy}>Jelszó mentése</button></form>`;
  const title = m === "signup" ? "Fiók létrehozása" : m === "reset" ? "Elfelejtett jelszó" : "Bejelentkezés";
  return `<form class="card auth stack" id="authForm" novalidate><h2>${title}</h2>
    <p class="note" style="margin:0">${m === "signup" ? "Egy fiókkal a telefonon és a gépen is ugyanazokat az adatokat látod." : m === "reset" ? "Küldünk egy linket, amivel új jelszót adhatsz meg." : "Lépj be, hogy a rendeléseid a felhőbe mentődjenek."}</p>
    <div class="field"><label for="au-email">E-mail cím</label><input class="in-ctl" type="email" id="au-email" autocomplete="email" inputmode="email" value="${esc(auth.lastEmail || "")}"></div>
    ${m !== "reset" ? `<div class="field"><label for="au-pass">Jelszó${m === "signup" ? " (min. 8 karakter)" : ""}</label><input class="in-ctl" type="password" id="au-pass" autocomplete="${m === "signup" ? "new-password" : "current-password"}"></div>` : ""}
    ${msg}
    <button class="btn primary wide" type="submit" ${busy}>${m === "signup" ? "Fiók létrehozása" : m === "reset" ? "Link küldése" : "Belépés"}</button>
    <div class="btns" style="justify-content:space-between">
      ${m === "login" ? '<button type="button" class="btn link" data-action="authMode" data-m="signup">Új fiók</button><button type="button" class="btn link" data-action="authMode" data-m="reset">Elfelejtett jelszó</button>' : '<button type="button" class="btn link" data-action="authMode" data-m="login">Vissza a belépéshez</button>'}
    </div>
    ${m === "login" ? '<p class="note" style="margin:0">Nem emlékszel, melyik e-mail címmel regisztráltál? <b>Ne hozz létre új fiókot</b> – az új fiók üres lenne, a régi adatok a régi fiókban maradnak. Szólj annak, aki a rendszert kezeli, ő megkeresi a címet.</p>' : ""}
    </form>`;
}
function authErr(error, pre) {
  const m = String((error && error.message) || "");
  if (/registered|already/i.test(m)) return "Ezzel az e-mail címmel már van fiók. Lépj be, vagy használd az Elfelejtett jelszó lehetőséget.";
  if (/rate limit|too many|security purposes|over_email_send_rate_limit/i.test(m)) return "Rövid időn belül túl sok e-mail ment ki. Várj egy órát, és próbáld újra.";
  if (/password/i.test(m) && /(weak|short|least|character)/i.test(m)) return "Ez a jelszó túl gyenge, válassz hosszabbat.";
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(m)) return "Ez az e-mail cím nem érvényes.";
  if (/network|fetch|failed to|timeout|load failed/i.test(m)) return "Nincs kapcsolat a szerverrel. Próbáld újra. (" + m.slice(0, 80) + ")";
  return pre + m;
}
async function authSubmit() {
  const email = (document.getElementById("au-email") || {}).value, pass = (document.getElementById("au-pass") || {}).value;
  const fail = (t) => { auth.msg = t; auth.msgOk = false; auth.busy = false; render(true); };
  const ok = (t) => { auth.msg = t; auth.msgOk = true; auth.busy = false; render(true); };
  if (!sb) return fail("A felhős mentés most nem érhető el. Ellenőrizd az internetet.");
  if (email !== undefined) auth.lastEmail = String(email).trim();
  if (ui.auth !== "newpass" && !/^\S+@\S+\.\S+$/.test(auth.lastEmail || "")) return fail("Adj meg egy érvényes e-mail címet.");
  if ((ui.auth === "signup" || ui.auth === "newpass") && String(pass || "").length < 8) return fail("A jelszó legyen legalább 8 karakter.");
  auth.busy = true; auth.msg = ""; render(true);
  try {
    if (ui.auth === "login") {
      const { error } = await sb.auth.signInWithPassword({ email: auth.lastEmail, password: pass });
      if (error) return fail(/confirm/i.test(error.message) ? "Előbb erősítsd meg az e-mail címed a kapott levélben." : "Hibás e-mail cím vagy jelszó.");
      auth.busy = false; auth.msg = "";
    } else if (ui.auth === "signup") {
      const { data: d, error } = await sb.auth.signUp({ email: auth.lastEmail, password: pass, options: { emailRedirectTo: location.origin } });
      if (error) return fail(authErr(error, "A regisztráció nem sikerült: "));
      if (d && d.user && Array.isArray(d.user.identities) && d.user.identities.length === 0) { ui.auth = "login"; return fail("Ezzel az e-mail címmel már van fiók, ne hozz létre újat. Lépj be, vagy használd az Elfelejtett jelszó lehetőséget."); }
      if (!d.session) { ui.auth = "login"; return ok("Küldtünk egy megerősítő e-mailt. Kattints a benne lévő linkre, utána lépj be."); }
      auth.busy = false;
    } else if (ui.auth === "reset") {
      const { error } = await sb.auth.resetPasswordForEmail(auth.lastEmail, { redirectTo: location.origin });
      if (error) return fail(authErr(error, "Nem sikerült elküldeni: "));
      ui.auth = "login"; return ok("Ha ezzel az e-mail címmel van fiók, elküldtük a jelszó-visszaállító linket. Nézd meg a spam mappát is.");
    } else if (ui.auth === "newpass") {
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) return fail("Nem sikerült menteni: " + error.message);
      ui.recovery = false; ui.auth = "login"; auth.busy = false; toast("Új jelszó elmentve");
    }
  } catch (e) { return fail("Nincs kapcsolat a szerverrel. Próbáld újra. (" + String((e && e.message) || e).slice(0, 80) + ")"); }
  render(true);
}

/* Áttekintés */
function vHome() {
  const m = stats(ui.month), s = data().settings, t = num(s.target);
  let h = monthNav();
  if (!hasAny()) return h + emptyCard();
  const pct = t > 0 ? Math.max(0, Math.min(100, m.rev / t * 100)) : 0;
  h += `<div class="stack"><section class="hero"><div class="label">Tiszta haszon ebben a hónapban</div>
  <div class="big num ${m.profit < 0 ? "neg" : ""}">${huf(m.profit)}</div>
  <div class="eq num">${huf(m.rev)} bevétel − ${huf(m.cost)} költség</div>
  ${t > 0 ? `<div class="progress"><div class="bar"><b style="width:${pct}%"></b></div><small class="num"><span>Havi bevételi cél: ${Math.round(m.rev / t * 100)}%</span><span>${huf(m.rev)} / ${huf(t)}</span></small></div>` : `<div class="progress"><small><span>Havi bevételi célt a Beállításokban adhatsz meg.</span></small></div>`}
  </section>
  ${quickActions()}
  <div class="kpis">
   ${kpi("Bevétel", huf(m.rev), m.n + " rendelés")}
   ${kpi("Anyagköltség", huf(m.mat), s.deductMaterial ? "levonva" : "nincs levonva")}
   ${kpi("Egyéb kiadás", huf(m.exp), m.es.length + " tétel")}
   ${kpi("Darabszám", m.qty + " db", m.n ? "átl. " + huf(m.rev / m.n) + "/rendelés" : "")}
   ${kpi("Munkaóra", hrs(m.h), "")}
   ${kpi("Órabér", m.hourly == null ? "–" : huf(m.hourly), "anyag levonása után")}
  </div>
  ${num(s.taxPct) > 0 ? `<div class="card"><div class="rows"><div class="row"><span>Adó- és járuléktartalék (${num(s.taxPct)}%)</span><b class="num">${huf(m.tax)}</b></div><div class="row"><span>Ami ténylegesen marad</span><b class="num">${huf(m.net)}</b></div></div></div>` : ""}`;
  const today = stats(TODAY), open = Object.values(data().orders).filter((o) => o.status !== "Teljesítve").length, att = attention();
  const low = lowStock();
  if (low.length) h += `<div class="card"><div class="section-title">Fogyóban lévő készlet</div><div class="btns">${low.slice(0, 6).map((x) => `<span class="pill st-late">${esc(x.name)}: ${fmtQty(x.qty)} ${esc(x.unit)}</span>`).join("")}<button type="button" class="btn small" data-action="tab" data-t="stock">Készlet</button></div></div>`;
  if (att.list.length) h += `<div class="card"><div class="section-title">Figyelmet igényel</div><div class="btns">${att.late ? `<span class="pill st-late">${att.late} lemaradt</span>` : ""}${att.unpaid.length ? `<span class="pill st-unpaid">${att.unpaid.length} nem fizetett · ${huf(att.unpaidSum)}</span>` : ""}<button type="button" class="btn small" data-action="tab" data-t="log">Megnézem</button></div></div>`;
  h += `<div class="card"><div class="section-title">Ma · ${esc(dayLabel(TODAY))}, ${esc(weekday(TODAY))}</div>
   <div class="row" style="border:0;padding:0"><div class="l"><b class="num">${today.n} rendelés</b><div class="t num">${huf(today.rev)} bevétel · ${hrs(today.h)} munka${open ? ` · ${open} nyitott rendelés összesen` : ""}</div></div>
   <div class="r"><button type="button" class="btn small" data-action="goDay" data-d="${TODAY}">Napló</button></div></div></div>`;
  const cats = {}; m.es.forEach((e) => { cats[e.cat || "Egyéb"] = (cats[e.cat || "Egyéb"] || 0) + num(e.amount); });
  if (s.deductMaterial && m.mat > 0) cats["Anyagköltség (rendelések)"] = m.mat;
  if (Object.keys(cats).length) h += `<div class="card"><div class="section-title">Hová ment a pénz</div>${catBars(cats)}</div>`;
  return h + vYear() + "</div>";
}
function vYear() {
  const Y = ui.year, ys = stats(String(Y)), months = [];
  for (let i = 1; i <= 12; i++) months.push(Object.assign({ ym: Y + "-" + pad(i), i }, stats(Y + "-" + pad(i))));
  const best = months.filter((x) => x.n).sort((a, b) => b.profit - a.profit)[0];
  const types = {}; ys.os.forEach((o) => { const k = o.type || "Egyéb"; const t = types[k] || (types[k] = { q: 0, rev: 0, pr: 0, h: 0 }); t.q += num(o.qty) || 1; t.rev += num(o.price); t.pr += num(o.price) - num(o.cost); t.h += num(o.hours); });
  const te = Object.entries(types).sort((a, b) => b[1].rev - a[1].rev);
  return `<div class="navrow" style="margin-top:22px"><button type="button" class="iconbtn" data-action="year" data-k="-1" aria-label="Előző év">${I.prev}</button><h2>${Y} összesen</h2><button type="button" class="iconbtn" data-action="year" data-k="1" aria-label="Következő év">${I.next}</button></div>
  <div class="kpis">${kpi("Éves bevétel", huf(ys.rev), ys.n + " rendelés")}${kpi("Összes költség", huf(ys.cost), "")}${kpi("Éves haszon", huf(ys.profit), num(data().settings.taxPct) > 0 ? "tartalék után " + huf(ys.net) : "")}${kpi("Munkaóra", hrs(ys.h), "")}${kpi("Órabér", ys.hourly == null ? "–" : huf(ys.hourly), "éves átlag")}${kpi("Legjobb hónap", best ? MON[best.i - 1] : "–", best ? huf(best.profit) : "")}</div>
  <div class="card"><div class="section-title">Havonta</div><div class="legend"><span><i style="background:var(--rose)"></i>Bevétel</span><span><i style="background:var(--sage)"></i>Haszon</span><span>Koppints egy hónapra a megnyitáshoz</span></div><div class="chart">${chart(months)}</div></div>
  ${te.length ? `<div class="card"><div class="section-title">Termékek ${Y}-ben</div><div class="table-wrap"><table class="num"><thead><tr><th class="l">Típus</th><th>Db</th><th>Bevétel</th><th>Haszon</th><th>Ft/óra</th></tr></thead><tbody>${te.map(([k, t]) => `<tr><td class="l">${esc(k)}</td><td>${t.q}</td><td>${huf(t.rev)}</td><td>${huf(t.pr)}</td><td>${t.h > 0 ? huf(t.pr / t.h) : "–"}</td></tr>`).join("")}</tbody></table></div></div>` : ""}`;
}
function chart(ms) {
  const W = 640, H = 230, L = 46, R = 8, T = 14, B = 30;
  let hi = Math.max(1, ...ms.map((m) => Math.max(m.rev, m.profit))), lo = Math.min(0, ...ms.map((m) => m.profit));
  const raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), stp = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= raw) || raw;
  hi = Math.ceil(hi / stp) * stp; lo = Math.floor(lo / stp) * stp;
  const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B), gw = (W - L - R) / 12, bw = gw * 0.32;
  let g = "";
  for (let v = lo; v <= hi + 1e-6; v += stp) g += `<line class="${Math.abs(v) < 1e-6 ? "c-zero" : "c-grid"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="c-lab" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`;
  ms.forEach((m, i) => {
    const x0 = L + i * gw, sel = m.ym === ui.month, z = y(0);
    if (sel) g += `<rect class="c-sel" x="${x0 + 2}" y="${T}" width="${gw - 4}" height="${H - T - B}" rx="6"/>`;
    if (m.rev > 0) { const r0 = y(m.rev); g += `<rect class="c-rev" x="${x0 + gw * 0.16}" y="${r0}" width="${bw}" height="${Math.max(1, z - r0)}" rx="3"/>`; }
    if (m.profit !== 0) { const p = y(m.profit); g += `<rect class="${m.profit < 0 ? "c-neg" : "c-pro"}" x="${x0 + gw * 0.52}" y="${Math.min(p, z)}" width="${bw}" height="${Math.max(1, Math.abs(z - p))}" rx="3"/>`; }
    g += `<text class="c-lab ${sel ? "on" : ""}" x="${x0 + gw / 2}" y="${H - 10}" text-anchor="middle">${MON[i]}</text>`;
    g += `<rect class="c-hit" data-action="pickMonth" data-m="${m.ym}" x="${x0}" y="${T}" width="${gw}" height="${H - T}"><title>${MON[i]}: ${huf(m.rev)} bevétel, ${huf(m.profit)} haszon</title></rect>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Havi bevétel és haszon">${g}</svg>`;
}

/* Napló */
const photoImg = (ph, cls, extra) => !ph ? "" : ph.dataUrl ? `<img class="${cls}" src="${ph.dataUrl}" alt="" ${extra || ""}>` : `<img class="${cls}" data-thumb="${esc(ph.path)}" alt="" ${extra || ""}>`;
function orderCard(o) {
  const p = num(o.price) - num(o.cost), st = orderState(o);
  return `<div class="order-wrap"><button type="button" class="order st-${st}" data-action="editOrder" data-id="${esc(o.id)}">
   <span class="oname">${photoImg(o.photo, "othumb")}<span class="name">${esc(o.product || o.type || "Rendelés")}</span></span><span class="price num">${huf(o.price)}</span>
   <span class="meta"><span class="pill st-${st}">${esc(STATE[st].label)}</span>${o.type ? `<span class="chip-type">${esc(o.type)}</span>` : ""}<span>${esc(o.status)}</span><span class="num">· ${num(o.qty) || 1} db · ${hrs(o.hours)}</span>${o.deadline ? `<span class="num">· határidő ${esc(dayLabel(o.deadline))}</span>` : ""}${depositOf(o) && !o.paid ? `<span class="pill dep num">előleg ${huf(depositOf(o))} · hátralék ${huf(dueOf(o))}</span>` : ""}${o.customer ? `<span>· ${esc(o.customer)}</span>` : ""}${o.sample ? "<span>· minta</span>" : ""}</span>
   <span class="profit num ${p < 0 ? "neg" : ""}">${p >= 0 ? "+" : ""}${huf(p)}</span></button><button type="button" class="ox" data-action="delOrder" data-id="${esc(o.id)}" aria-label="${esc(o.product || "Rendelés")} törlése">${I.x}</button></div>`;
}
const depositOf = (o) => (o.depositPaid ? Math.max(0, num(o.deposit)) : 0);
const dueOf = (o) => Math.max(0, num(o.price) - depositOf(o));
const allOrders = () => Object.entries(data().orders).map(([id, o]) => Object.assign({ id }, o));
function attention() {
  const os = allOrders().map((o) => Object.assign(o, { st: orderState(o) })).filter((o) => o.st === "late" || o.st === "unpaid");
  os.sort((a, b) => STATE[b.st].rank - STATE[a.st].rank || String(a.deadline || a.date).localeCompare(String(b.deadline || b.date)));
  return { list: os, late: os.filter((o) => o.st === "late").length, unpaid: os.filter((o) => o.st === "unpaid"), unpaidSum: os.filter((o) => o.st === "unpaid").reduce((a, o) => a + dueOf(o), 0) };
}
function calendar(ym) {
  const [y, m] = ym.split("-").map(Number), by = ui.calBy === "deadline" ? "deadline" : "date";
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7, days = new Date(y, m, 0).getDate(), map = {};
  allOrders().forEach((o) => { const k = o[by]; if (k && k.startsWith(ym)) (map[k] = map[k] || []).push(o); });
  let g = ["H", "K", "Sze", "Cs", "P", "Szo", "V"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < offset; i++) g += '<div class="blank"></div>';
  for (let d = 1; d <= days; d++) {
    const k = `${ym}-${pad(d)}`, os = map[k] || [];
    let worst = null; os.forEach((o) => { const s = orderState(o); if (!worst || STATE[s].rank > STATE[worst].rank) worst = s; });
    const dots = os.slice(0, 5).map((o) => `<i class="dot-${orderState(o)}"></i>`).join("");
    g += `<button type="button" class="d ${worst ? "st-" + worst : ""} ${k === TODAY ? "today" : ""} ${k === ui.day ? "sel" : ""}" data-action="pickDay" data-d="${k}" aria-label="${esc(dayLabel(k))}: ${os.length} rendelés"><span class="n">${d}</span><span class="c num">${os.length || ""}</span><span class="dots">${dots}</span></button>`;
  }
  return `<div class="cal">${g}</div>`;
}
function vLog() {
  const by = ui.calBy === "deadline" ? "deadline" : "date";
  let h = monthNav();
  if (!hasAny()) return h + emptyCard();
  const att = attention();
  h += `<div class="stack"><div class="card"><div class="seg" style="margin-bottom:12px"><button type="button" data-action="calBy" data-v="date" aria-pressed="${by === "date"}">Rendelés napja</button><button type="button" data-action="calBy" data-v="deadline" aria-pressed="${by === "deadline"}">Határidő</button></div>
   ${calendar(ui.month)}
   <div class="legend" style="margin-top:12px"><span><i class="dot-done"></i>Kész, fizetve</span><span><i class="dot-open"></i>Folyamatban</span><span><i class="dot-unpaid"></i>Nem fizetett</span><span><i class="dot-late"></i>Lemaradt</span></div></div>`;
  if (att.list.length) h += `<div class="card"><div class="section-title">Figyelmet igényel</div><div class="rows">${att.list.slice(0, 8).map((o) => `<div class="row tap" data-action="editOrder" data-id="${esc(o.id)}"><div class="l"><span class="pill st-${o.st}">${STATE[o.st].label}</span> <b>${esc(o.product || o.type)}</b><div class="t num">${o.st === "late" ? "határidő: " + esc(dayLabel(o.deadline)) : "rendelve: " + esc(dayLabel(o.date))}${o.customer ? " · " + esc(o.customer) : ""}</div></div><div class="r"><b class="num">${huf(dueOf(o))}</b>${depositOf(o) ? `<div class="t num">előleg ${huf(depositOf(o))}</div>` : ""}</div></div>`).join("")}</div>${att.list.length > 8 ? `<p class="note" style="margin:6px 0 0">és még ${att.list.length - 8} tétel</p>` : ""}</div>`;
  const os = allOrders().filter((o) => o[by] === ui.day).sort((a, b) => (a.created || 0) - (b.created || 0));
  const rev = sum(os, "price"), mat = sum(os, "cost"), hh = sum(os, "hours");
  h += `<div><h2 class="page-title" style="margin-top:4px">${esc(dayLabel(ui.day))}<span class="note" style="font-family:var(--f-body);font-size:14px"> · ${esc(weekday(ui.day))}${ui.day === TODAY ? " · ma" : ""}${by === "deadline" ? " · határidős rendelések" : ""}</span></h2></div>`;
  if (os.length) h += `<div class="kpis">${kpi("Rendelés", os.length + " db", sum(os, "qty") + " darab termék")}${kpi("Bevétel", huf(rev), "")}${kpi("Haszon", huf(rev - mat), hrs(hh) + " munka")}</div><div class="stack" style="gap:10px">${os.map(orderCard).join("")}</div>`;
  else h += `<div class="card empty" style="padding:18px"><p>Ezen a napon nincs ${by === "deadline" ? "határidős " : ""}rendelés.</p></div>`;
  h += `<div class="btns"><button type="button" class="btn primary" data-action="newOrder">Rendelés erre a napra</button>${ui.day !== TODAY ? `<button type="button" class="btn" data-action="goDay" data-d="${TODAY}">Ugrás a mai napra</button>` : ""}</div></div>`;
  return h;
}

/* Kiadások */
function vExp() {
  const m = stats(ui.month), s = data().settings;
  let h = '<h2 class="page-title">Kiadások</h2>' + monthNav() + '<div class="stack">';
  h += `<section class="hero"><div class="label">Kiadások ebben a hónapban</div><div class="big num">${huf(m.exp)}</div><div class="eq num">${m.es.length} tétel${s.deductMaterial ? ` · plusz ${huf(m.mat)} anyagköltség a rendelésekből` : ""}</div></section>`;
  if (s.fixed.length) {
    const missing = s.fixed.filter((f) => !m.es.some((e) => e.fixedId === f.id));
    h += `<div class="card"><div class="section-title">Havi fix költségek</div>${missing.length ? `<p class="note" style="margin:0 0 10px">${missing.length} fix tétel még nincs felvéve erre a hónapra (${esc(missing.map((f) => f.cat).join(", "))}).</p><button type="button" class="btn sage" data-action="addFixed">Fix költségek felvétele · ${huf(sum(missing, "amount"))}</button>` : '<p class="note" style="margin:0">Minden fix költség fel van véve erre a hónapra.</p>'}</div>`;
  }
  const cats = {}; m.es.forEach((e) => { cats[e.cat || "Egyéb"] = (cats[e.cat || "Egyéb"] || 0) + num(e.amount); });
  if (m.es.length) h += `<div class="card"><div class="section-title">Kategóriánként</div>${catBars(cats)}</div>`;
  const es = m.es.sort((a, b) => b.date.localeCompare(a.date));
  h += `<div class="card"><div class="section-title">Tételek</div>${es.length ? `<div class="rows">${es.map((e) => `<div class="row tap" data-action="editExp" data-id="${esc(e.id)}"><div class="l"><b>${esc(e.cat || "Egyéb")}</b>${e.sample ? ' <span class="t">· minta</span>' : ""}<div class="t">${esc(dayLabel(e.date))}${e.note ? " · " + esc(e.note) : ""}${e.docNo ? " · " + esc(e.docNo) : ""}</div></div><div class="r"><b class="num">${huf(e.amount)}</b></div></div>`).join("")}</div>` : '<p class="note" style="margin:0">Még nincs kiadás ebben a hónapban.</p>'}
  <div class="btns" style="margin-top:12px"><button type="button" class="btn primary" data-action="newExp">Új kiadás</button></div></div></div>`;
  return h;
}

/* Új rendelés fül */
function vNew() {
  return `<h2 class="page-title">Új rendelés</h2><p class="note" style="margin:0 0 12px">Válaszd ki a terméket, írd be az árat, és mentsd. A többi adat ráér.</p><div class="card" id="newForm"></div>`;
}

/* Több menü */
function vMore() {
  return `<h2 class="page-title">Menü</h2>${MORE.map(([g, items]) => `<div class="more-group"><div class="section-title">${esc(g)}</div><div class="more-grid">${items.map(([k, l, d]) => `<button type="button" class="more-tile" data-action="tab" data-t="${k}"><span class="mi">${I[k]}</span><b>${l}</b><span class="note">${d}</span></button>`).join("")}</div></div>`).join("")}`;
}

/* Motiváció */
const QUOTES = ["Minden csomó egy döntés. Minden rendelés egy lépés előre.", "A legszebb falikárpit is egyetlen szál zsinórral kezdődött.", "Nem kell tökéletesnek lennie, elég, ha a tiéd.", "Lassan csomózz, de ne állj meg.", "Amit két kézzel alkotsz, az valakinek az otthonát teszi melegebbé.", "A türelem is alapanyag.", "Ma egy sorral több, mint tegnap."];
function vMotiv() {
  const m = data().motiv, q = QUOTES[Math.floor(new Date(TODAY + "T12:00").getTime() / 864e5) % QUOTES.length];
  const done = m.goals.filter((g) => g.done).length;
  return `<h2 class="page-title">Motiváció</h2><div class="stack">
   <section class="hero quote"><div class="label">A mai gondolat</div><p class="q">${esc(q)}</p></section>
   <div class="card"><div class="section-title">Miért csinálom?</div><textarea class="in-ctl why" id="mo-why" data-mo="why" placeholder="Írd le a saját szavaiddal, miért indítottad el az SM home dekort, mit szeretsz benne, és mit jelent neked.">${esc(m.why)}</textarea><p class="note" style="margin:6px 0 0">Gépelés közben magától mentődik.</p></div>
   <div class="card"><div class="section-title">Céljaim${m.goals.length ? ` · ${done}/${m.goals.length} teljesítve` : ""}</div>
    ${m.goals.length ? `<div class="rows">${m.goals.map((g, i) => `<div class="row"><label class="switch goal ${g.done ? "done" : ""}"><input type="checkbox" data-action="goalToggle" data-i="${i}" ${g.done ? "checked" : ""}><span>${esc(g.t)}</span></label><button type="button" class="x" data-action="goalDel" data-i="${i}" aria-label="Cél törlése">${I.x}</button></div>`).join("")}</div>` : '<p class="note" style="margin:0">Pl. „Saját webshop az év végéig”, „Havi 20 rendelés”, „Kiállítás a tavaszi vásáron”.</p>'}
    <div class="addline"><input class="in-ctl" id="goalNew" placeholder="Új cél"><button type="button" class="btn small" data-action="goalAdd">Hozzáadás</button></div></div>
   <div class="card"><div class="section-title">Gondolatok, büszke pillanatok</div>
    <textarea class="in-ctl" id="noteNew" placeholder="Egy kedves vevői üzenet, egy jól sikerült darab, egy ötlet…"></textarea>
    <div class="btns" style="margin-top:8px"><button type="button" class="btn primary small" data-action="noteAdd">Feljegyzés mentése</button></div>
    ${m.notes.length ? `<div class="rows" style="margin-top:8px">${m.notes.map((n, i) => `<div class="row" style="align-items:flex-start"><div class="l"><div class="t num">${esc(fullDate(n.d))}</div><div class="mnote">${esc(n.t)}</div></div><button type="button" class="x" data-action="noteDel" data-i="${i}" aria-label="Feljegyzés törlése">${I.x}</button></div>`).join("")}</div>` : ""}</div>
  </div>`;
}

/* Rajztábla */
const PAPER = "#fffaf4";
const PENS = ["#3b2c2a", "#b86f76", "#e7a9a5", "#728f77", "#cdb59c", "#c27a26", "#5d7fa3", "#ffffff"];
const board = { canvas: null, ctx: null, color: PENS[0], size: 6, eraser: false, undo: [], drawing: false, last: null };
function paper() { board.ctx.save(); board.ctx.globalCompositeOperation = "source-over"; board.ctx.fillStyle = PAPER; board.ctx.fillRect(0, 0, board.canvas.width, board.canvas.height); board.ctx.restore(); }
function pushUndo() { try { board.undo.push(board.ctx.getImageData(0, 0, board.canvas.width, board.canvas.height)); if (board.undo.length > 6) board.undo.shift(); } catch (e) {} }
function padPt(e) { const r = board.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * board.canvas.width / r.width, y: (e.clientY - r.top) * board.canvas.height / r.height, k: board.canvas.width / r.width }; }
function stroke(a, b) {
  const c = board.ctx; c.strokeStyle = board.eraser ? PAPER : board.color; c.lineWidth = board.size * b.k * (board.eraser ? 2.5 : 1);
  c.beginPath(); c.moveTo(a.x, a.y); const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; c.quadraticCurveTo(a.x, a.y, mx, my); c.lineTo(b.x, b.y); c.stroke();
}
function mountCanvas() {
  const host = document.getElementById("drawHost"); if (!host) return;
  if (!board.canvas) {
    const cv = document.createElement("canvas"), w = Math.min(1200, Math.round((host.clientWidth || 360) * Math.min(2, window.devicePixelRatio || 1)));
    cv.width = w; cv.height = Math.round(w * 1.3); cv.className = "pad";
    board.canvas = cv; board.ctx = cv.getContext("2d"); board.ctx.lineCap = "round"; board.ctx.lineJoin = "round"; paper();
    cv.addEventListener("pointerdown", (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); pushUndo(); board.drawing = true; board.last = padPt(e); stroke(board.last, Object.assign({}, board.last, { x: board.last.x + 0.01 })); });
    cv.addEventListener("pointermove", (e) => { if (!board.drawing) return; const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const ev of evs) { const p = padPt(ev); stroke(board.last, p); board.last = p; } });
    const end = () => { board.drawing = false; board.last = null; };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end); cv.addEventListener("pointerleave", end);
  }
  host.appendChild(board.canvas);
}
function vDraw() {
  const arts = Object.entries(data().art).sort((a, b) => (b[1].created || 0) - (a[1].created || 0));
  return `<h2 class="page-title">Rajztábla</h2><div class="stack">
   <div class="card draw-card"><div class="draw-tools">
    <div class="pens">${PENS.map((c) => `<button type="button" class="pen ${!board.eraser && board.color === c ? "on" : ""}" style="background:${c}" data-action="penColor" data-c="${c}" aria-label="Szín"></button>`).join("")}</div>
    <div class="btns">${[3, 6, 12, 22].map((z) => `<button type="button" class="size ${board.size === z ? "on" : ""}" data-action="penSize" data-s="${z}" aria-label="Vastagság ${z}"><i style="width:${Math.min(z, 18)}px;height:${Math.min(z, 18)}px"></i></button>`).join("")}
     <button type="button" class="btn small ${board.eraser ? "sage" : ""}" data-action="penEraser">Radír</button><button type="button" class="btn small" data-action="drawUndo">Vissza</button><button type="button" class="btn small" data-action="drawClear">Új lap</button></div></div>
    <div id="drawHost" class="draw-host"></div>
    <div class="btns" style="margin-top:10px"><button type="button" class="btn primary" data-action="drawSave">Mentés a galériába</button><button type="button" class="btn" data-action="drawDownload">Letöltés a telefonra</button></div></div>
   <div class="card"><div class="section-title">Mentett rajzok</div>${arts.length ? `<div class="docs">${arts.map(([id, a]) => `<div class="doc"><button type="button" class="thumb" data-action="artOpen" data-id="${esc(id)}" aria-label="Rajz megnyitása">${photoImg(a, "", "")}</button><div class="info"><span class="num">${esc(new Date(a.created || 0).toLocaleString("hu-HU", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</span></div><div class="acts"><button type="button" class="btn small" data-action="artOpen" data-id="${esc(id)}">Megnyitás</button><button type="button" class="btn small danger" data-action="artDel" data-id="${esc(id)}">Törlés</button></div></div>`).join("")}</div>` : '<p class="note" style="margin:0">A mentett rajzok itt jelennek meg. Megnyitva tovább rajzolhatsz rajtuk, mentéskor új verzió készül.</p>'}</div>
  </div>`;
}
const canvasBlob = (type, q) => new Promise((r) => board.canvas.toBlob(r, type, q));
async function saveDrawing() {
  if (!board.canvas) return;
  const id = uid("art"), created = Date.now();
  if (CLOUD && sb && store.uid) {
    if (!online()) { toast("A mentéshez internetkapcsolat kell. Addig letöltheted a telefonra."); return; }
    toast("Mentés…");
    const blob = await canvasBlob("image/png"), path = `${store.uid}/art/${id}.png`;
    const { error } = await sb.storage.from("documents").upload(path, blob, { contentType: "image/png", upsert: false });
    if (error) { toast("Nem sikerült menteni: " + error.message); return; }
    setRec(id, "settings", { path, created });
  } else {
    const t = document.createElement("canvas"), k = Math.min(1, 700 / board.canvas.width);
    t.width = Math.round(board.canvas.width * k); t.height = Math.round(board.canvas.height * k); t.getContext("2d").drawImage(board.canvas, 0, 0, t.width, t.height);
    setRec(id, "settings", { dataUrl: t.toDataURL("image/jpeg", 0.82), created });
  }
  haptic("save"); toast("Rajz elmentve a galériába");
}
async function downloadDrawing() {
  if (!board.canvas) return;
  const blob = await canvasBlob("image/png");
  downloadBlob(`sm-rajz-${TODAY}.png`, blob);
}
function downloadBlob(name, blob) { const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
async function openArt(id) {
  const a = data().art[id]; if (!a || !board.canvas) return;
  try {
    let bmp;
    if (a.dataUrl) bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = a.dataUrl; });
    else { if (!sb || !online()) { toast("A megnyitáshoz internetkapcsolat kell."); return; } const { data: blob, error } = await sb.storage.from("documents").download(a.path); if (error) throw error; bmp = await createImageBitmap(blob); }
    pushUndo(); paper(); board.ctx.drawImage(bmp, 0, 0, board.canvas.width, board.canvas.height);
    window.scrollTo({ top: 0, behavior: "smooth" }); toast("Rajz betöltve, folytathatod");
  } catch (e) { toast("Nem sikerült megnyitni a rajzot."); }
}

/* Készlet */
const UNITS = ["db", "m", "tekercs", "kg", "csomag", "pár"];
const fmtQty = (n) => (Math.round(num(n) * 100) / 100).toLocaleString("hu-HU");
const stockList = () => Object.entries(data().stock).map(([id, x]) => Object.assign({ id }, x)).sort((a, b) => String(a.name).localeCompare(String(b.name), "hu"));
const isLow = (x) => num(x.min) > 0 && num(x.qty) <= num(x.min);
const lowStock = () => stockList().filter(isLow);
function vStock() {
  const all = stockList(), f = ui.stockF || "all";
  const list = all.filter((x) => f === "all" || (f === "low" ? isLow(x) : x.kind === f));
  const value = all.reduce((s, x) => s + num(x.qty) * num(x.price), 0), low = all.filter(isLow).length;
  const seg = (v, l) => `<button type="button" data-action="stockF" data-v="${v}" aria-pressed="${f === v}">${l}</button>`;
  let h = `<h2 class="page-title">Alapanyagok</h2><p class="note" style="margin:0 0 10px">Fonalak, kellékek és darabos tételek mennyisége. A kész termékeid fotós listája az <b>Árukészlet</b> fülön van.</p><div class="stack">
   <section class="hero"><div class="label">Raktáron lévő készlet értéke</div><div class="big num">${huf(value)}</div><div class="eq num">${all.length} tétel${low ? ` · ${low} fogyóban` : ""}</div></section>`;
  if (!all.length) return h + `<div class="card empty"><h3>Még üres a készlet</h3><p>Vedd fel a fonalakat, fa karikákat, kellékeket és a kész, eladásra váró termékeket. A mennyiséget egy koppintással növelheted vagy csökkentheted.</p><button type="button" class="btn primary" data-action="newStock">Első tétel felvétele</button></div></div>`;
  h += `<div class="seg">${seg("all", "Mind")}${seg("mat", "Alapanyag")}${seg("prod", "Kész termék")}${seg("low", "Fogyóban")}</div>
   <div class="card" style="padding-block:6px">${list.length ? `<div class="rows">${list.map((x) => `<div class="row stock-row">
     <div class="l tap" data-action="editStock" data-id="${esc(x.id)}"><b>${esc(x.name)}</b>${isLow(x) ? ' <span class="pill st-late">fogyóban</span>' : ""}<div class="t num">${x.kind === "prod" ? "Kész termék" : "Alapanyag"}${num(x.price) ? ` · ${huf(x.price)}/${esc(x.unit)} · érték ${huf(num(x.qty) * num(x.price))}` : ""}${num(x.min) ? ` · min. ${fmtQty(x.min)}` : ""}</div></div>
     <div class="r qty"><button type="button" class="qbtn" data-action="stockStep" data-id="${esc(x.id)}" data-k="-1" aria-label="Csökkentés">${I.minus}</button><b class="num">${fmtQty(x.qty)}<small> ${esc(x.unit)}</small></b><button type="button" class="qbtn" data-action="stockStep" data-id="${esc(x.id)}" data-k="1" aria-label="Növelés">${I.plus}</button></div></div>`).join("")}</div>` : '<p class="note">Nincs ilyen tétel.</p>'}</div>
   <div class="btns"><button type="button" class="btn primary" data-action="newStock">Új tétel</button></div></div>`;
  return h;
}

/* ---------- Árukészlet: termékfotók, kategóriák, automatikus színfelismerés ---------- */
/* Színcsaládok szivárvány-sorrendben: ebben a sorrendben jelennek meg a csoportok */
const FAMS = [
  ["piros", "Piros", "#d23b3b"], ["bordo", "Bordó", "#7d1f33"], ["rozsa", "Rózsaszín", "#e88fb0"],
  ["narancs", "Narancs", "#e8843a"], ["sarga", "Sárga", "#e9c93c"], ["zold", "Zöld", "#5d9a5b"],
  ["turkiz", "Türkiz", "#3fb3b0"], ["kek", "Kék", "#3f6fc4"], ["lila", "Lila", "#8a5bc0"],
  ["barna", "Barna", "#7a5232"], ["natur", "Natúr / bézs", "#dcc6a5"], ["feher", "Fehér", "#f6f3ee"],
  ["szurke", "Szürke", "#9a9a9a"], ["fekete", "Fekete", "#222222"], ["tarka", "Színes, mintás", "#c08"]
];
const FAM = {}; FAMS.forEach(([k, n, hex], i) => { FAM[k] = { k, n, hex, i }; });
const NEUTRAL = new Set(["barna", "natur", "feher", "szurke", "fekete"]);
const hex2 = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [h, s, l];
}
const hexHsl = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return [0, 0, 0.5]; const n = parseInt(m[1], 16); return rgb2hsl(n >> 16, (n >> 8) & 255, n & 255); };
function famOf(r, g, b) {
  const [h, s, l] = rgb2hsl(r, g, b), warm = h >= 15 && h < 60;
  if (l < 0.12) return "fekete";
  if (l > 0.93 && s < 0.6) return "feher";
  if (s < 0.13 || (s < 0.22 && !warm)) return l > 0.8 ? "feher" : l < 0.2 ? "fekete" : "szurke";
  if (warm && l >= 0.62 && s < 0.55) return l > 0.9 ? "feher" : "natur";
  if (h >= 12 && h < 45 && l < 0.5) return "barna";
  if (warm && s < 0.3) return l > 0.45 ? "natur" : "barna";
  if (h < 12 || h >= 345) return l < 0.33 ? "bordo" : l > 0.72 ? "rozsa" : "piros";
  if (h < 42) return "narancs";
  if (h < 68) return l < 0.32 ? "zold" : "sarga";
  if (h < 165) return "zold";
  if (h < 195) return "turkiz";
  if (h < 255) return "kek";
  if (h < 290) return "lila";
  if (l < 0.3) return h >= 320 ? "bordo" : "lila";
  return "rozsa";
}
/* A fotó fő színe: a háttér (a kép szélein uralkodó szín) kiszűrése után a kép közepe nagyobb súllyal számít */
function analyzeColors(src) {
  const S = 80, k = S / Math.max(src.width, src.height), w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const cx = c.getContext("2d", { willReadFrequently: true }); cx.drawImage(src, 0, 0, w, h);
  const px = cx.getImageData(0, 0, w, h).data, B = Math.max(2, Math.round(Math.min(w, h) * 0.07));
  const buckets = {}; let bn = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= B && x < w - B && y >= B && y < h - B) continue;
    const i = (y * w + x) * 4, key = (px[i] >> 5) * 64 + (px[i + 1] >> 5) * 8 + (px[i + 2] >> 5);
    const b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 }); b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2]; bn++;
  }
  const top = Object.values(buckets).sort((a, b) => b.n - a.n)[0], bg = top ? [top.r / top.n, top.g / top.n, top.b / top.n] : null;
  const near = (i) => bg && Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]) < 44;
  let useBg = !!(top && top.n / bn > 0.3);
  // semleges háttér (fehér, bézs, szürke, fa) mindig kiszűrve; színes "háttér" csak akkor, ha a kép közepe más színű
  if (useBg && !NEUTRAL.has(famOf(bg[0], bg[1], bg[2]))) {
    let cn = 0, cb = 0;
    for (let y = Math.round(h * 0.3); y < h * 0.7; y++) for (let x = Math.round(w * 0.3); x < w * 0.7; x++) { cn++; if (near((y * w + x) * 4)) cb++; }
    if (cn && cb / cn > 0.6) useBg = false;
  }
  const run = (skipBg) => {
    const fam = {}; let tot = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; if (px[i + 3] < 128 || (skipBg && near(i))) continue;
      const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2), d = Math.min(1, Math.hypot(dx, dy) / 1.2);
      const f = famOf(px[i], px[i + 1], px[i + 2]); let wt = Math.pow(Math.max(0.1, 1 - d), 1.5);
      if (!NEUTRAL.has(f)) wt *= 1.15;
      const a = fam[f] || (fam[f] = { f, w: 0, r: 0, g: 0, b: 0 }); a.w += wt; a.r += px[i] * wt; a.g += px[i + 1] * wt; a.b += px[i + 2] * wt; tot += wt;
    }
    return { fam, tot };
  };
  let res = run(useBg); if (res.tot < 1.5) res = run(false);
  const list = Object.values(res.fam).map((a) => ({ f: a.f, share: a.w / res.tot, hex: hex2(a.r / a.w, a.g / a.w, a.b / a.w) })).sort((a, b) => b.share - a.share);
  if (!list.length) return { fam: "szurke", hex: "#9a9a9a", palette: [] };
  const chroma = list.filter((x) => !NEUTRAL.has(x.f) && x.share >= 0.14);
  const main = chroma.length >= 3 && list[0].share < 0.4 ? "tarka" : list[0].f;
  return { fam: main, hex: list[0].hex, palette: list.filter((x) => x.share >= 0.06).slice(0, 5).map((x) => ({ f: x.f, hex: x.hex, p: Math.round(x.share * 100) })) };
}
const swatch = (fam, hex, big) => `<i class="sw ${big ? "big" : ""} ${fam === "tarka" ? "tarka" : ""}" style="background:${esc(hex || (FAM[fam] || FAM.szurke).hex)}"></i>`;
const famName = (f) => (FAM[f] || { n: "Ismeretlen" }).n;

/* Lista, rendezés, csoportosítás */
const prodList = () => Object.entries(data().products).map(([id, x]) => Object.assign({ id }, x));
const prodCats = () => { const s = data().settings.prodCats.slice(); prodList().forEach((p) => { if (p.cat && !s.includes(p.cat)) s.push(p.cat); }); return s; };
const DIGRAPH = ["DZS", "CS", "DZ", "GY", "LY", "NY", "SZ", "TY", "ZS"], ACC = { Á: "A", É: "E", Í: "I", Ó: "O", Ú: "U", Ő: "Ö", Ű: "Ü" };
function letterOf(name) {
  const u = String(name || "").trim().toLocaleUpperCase("hu-HU"); if (!u) return "#";
  const d = DIGRAPH.find((x) => u.startsWith(x)); if (d) return d[0] + d.slice(1).toLocaleLowerCase("hu-HU");
  const ch = ACC[u[0]] || u[0]; return /[A-ZÖÜ]/.test(ch) ? ch : "#";
}
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "hu", { sensitivity: "base", numeric: true });
function byColor(a, b) {
  const fa = FAM[a.fam] || FAM.szurke, fb = FAM[b.fam] || FAM.szurke; if (fa.i !== fb.i) return fa.i - fb.i;
  const [ha, sa, la] = hexHsl(a.hex), [hb, sb, lb] = hexHsl(b.hex);
  if (!NEUTRAL.has(fa.k)) { const dh = ((ha + 30) % 360) - ((hb + 30) % 360); if (Math.abs(dh) > 4) return dh; }
  return lb - la || sb - sa || byName(a, b);
}
function prodFiltered() {
  const cat = ui.prodCat || "all", q = String(ui.prodQ || "").trim().toLocaleLowerCase("hu-HU");
  return prodList().filter((p) => (cat === "all" || p.cat === cat) && (!q || [p.name, p.cat, p.note, famName(p.fam)].join(" ").toLocaleLowerCase("hu-HU").includes(q)));
}
function prodCard(p) {
  const ph = p.photo, img = !ph ? I.gal : ph.dataUrl ? `<img src="${ph.dataUrl}" alt="" loading="lazy">` : `<img data-thumb="${esc(ph.thumb || ph.path)}" alt="" loading="lazy" hidden>${I.gal}`;
  const qty = p.qty === "" || p.qty == null ? null : num(p.qty);
  return `<button type="button" class="pcard" data-action="prodEdit" data-id="${esc(p.id)}"><span class="pph">${img}</span>${qty != null ? `<span class="badge num ${qty <= 0 ? "zero" : ""}">${qty <= 0 ? "elfogyott" : fmtQty(qty) + " db"}</span>` : ""}
   <span class="pinfo"><b>${esc(p.name || "Névtelen termék")}</b><span class="pmeta">${swatch(p.fam, p.hex)}${esc(famName(p.fam))}${(ui.prodCat || "all") === "all" && p.cat ? " · " + esc(p.cat) : ""}</span>${num(p.price) ? `<span class="pprice num">${huf(p.price)}</span>` : ""}</span></button>`;
}
function prodGrid() {
  const list = prodFiltered(), mode = ui.prodSort === "abc" ? "abc" : "color";
  if (!list.length) return `<div class="card empty" style="padding:20px"><p>${ui.prodQ ? "Nincs találat erre a keresésre." : "Ebben a kategóriában még nincs termék. Fotózz le egyet, vagy válassz a galériából."}</p></div>`;
  const groups = [], idx = {};
  list.sort(mode === "abc" ? byName : byColor).forEach((p) => {
    const k = mode === "abc" ? letterOf(p.name) : (FAM[p.fam] ? p.fam : "szurke");
    if (!(k in idx)) { idx[k] = groups.length; groups.push({ k, items: [] }); }
    groups[idx[k]].items.push(p);
  });
  if (mode === "abc") groups.sort((a, b) => a.k === "#" ? 1 : b.k === "#" ? -1 : a.k.localeCompare(b.k, "hu"));
  return groups.map((g) => `<section class="pgroup"><h3 class="${mode === "abc" ? "letter" : ""}">${mode === "abc" ? esc(g.k) : swatch(g.k, FAM[g.k].hex, true) + esc(famName(g.k))}<span class="cnt">${g.items.length} db</span></h3><div class="pgrid">${g.items.map(prodCard).join("")}</div></section>`).join("");
}
function vProd() {
  const all = prodList(), cats = prodCats(), cat = ui.prodCat && (ui.prodCat === "all" || cats.includes(ui.prodCat)) ? ui.prodCat : "all";
  ui.prodCat = cat;
  const cnt = (c) => all.filter((p) => p.cat === c).length, pcs = all.reduce((s, p) => s + (p.qty === "" || p.qty == null ? 0 : Math.max(0, num(p.qty))), 0);
  const value = all.reduce((s, p) => s + Math.max(0, num(p.qty)) * num(p.price), 0);
  let h = `<h2 class="page-title">Árukészlet</h2><div class="stack">
   <div class="add2"><button type="button" class="addbig" data-action="prodCam">${I.cam}Fotó készítése</button><button type="button" class="addbig alt" data-action="prodGal">${I.gal}Galériából</button></div>`;
  if (!all.length) return h + `<div class="card empty"><h3>Még üres az árukészlet</h3><p>Fotózd le a kész termékeket, vagy válassz egyszerre több képet a galériából. Az app felismeri a fő színüket, te pedig megadod a kategóriát (pl. fülbevalók, táskák, egyedi termékek).</p><button type="button" class="btn" data-action="prodCatsOpen">Kategóriák szerkesztése</button></div></div>`;
  h += `<div class="kpis k3">${kpi("Termék", all.length + " féle", cats.length + " kategória")}${kpi("Raktáron", fmtQty(pcs) + " db", "")}${kpi("Készlet értéke", value ? huf(value) : "–", value ? "eladási áron" : "adj meg árat")}</div>
   <div class="catchips" role="tablist" aria-label="Kategóriák"><button type="button" class="tchip ${cat === "all" ? "on" : ""}" data-action="prodCat" data-v="all">Mind<small>${all.length}</small></button>${cats.map((c) => `<button type="button" class="tchip ${cat === c ? "on" : ""}" data-action="prodCat" data-v="${esc(c)}">${esc(c)}<small>${cnt(c)}</small></button>`).join("")}<button type="button" class="tchip" data-action="prodCatsOpen">+ Kategóriák</button></div>
   <div class="toolrow"><div class="seg" aria-label="Rendezés"><button type="button" data-action="prodSort" data-v="color" aria-pressed="${ui.prodSort !== "abc"}">Szín szerint</button><button type="button" data-action="prodSort" data-v="abc" aria-pressed="${ui.prodSort === "abc"}">ABC sorrend</button></div></div>
   <div class="searchbox">${I.search}<input class="in-ctl" id="prodQ" type="search" placeholder="Keresés név, szín vagy kategória szerint" value="${esc(ui.prodQ || "")}" autocomplete="off"></div>
   <div id="prodGrid">${prodGrid()}</div></div>`;
  return h;
}

/* Képek beolvasása */
async function loadBitmap(file) {
  try { return await createImageBitmap(file); }
  catch (e) { return await new Promise((res, rej) => { const i = new Image(), u = URL.createObjectURL(file); i.onload = () => { res(i); setTimeout(() => URL.revokeObjectURL(u), 1000); }; i.onerror = rej; i.src = u; }); }
}
function scaled(src, max) { const k = Math.min(1, max / Math.max(src.width, src.height)), c = document.createElement("canvas"); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k); c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); return c; }
const toBlob = (c, q) => new Promise((r) => c.toBlob(r, "image/jpeg", q));
const blobUrl = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
const dataBlob = async (u) => (await fetch(u)).blob();

/* Külön "modal" réteg az árukészlethez és a gyorsválasztóhoz (a rendelés-űrlaptól független) */
let modal = null;
function openModal(m) { modal = m; drawModal(); }
function closeModal() {
  if (modal && modal.kind === "prodNew") { if (modal.saving != null) return; modal.items.forEach((x) => URL.revokeObjectURL(x.url)); }
  modal = null; drawModal();
}
function drawModal() {
  const box = document.getElementById("modal");
  if (!modal) { box.innerHTML = ""; if (!sheet || sheet.inline) document.body.style.overflow = ""; return; }
  const ae = document.activeElement, fid = ae && box.contains(ae) ? ae.id : null, sel = fid && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;
  const keepScroll = box.querySelector(".sheet") ? box.querySelector(".sheet").scrollTop : 0;
  box.innerHTML = `<div class="overlay" data-action="closeModalBg">${MV[modal.kind]()}</div>`;
  document.body.style.overflow = "hidden";
  const sh = box.querySelector(".sheet"); if (sh) sh.scrollTop = keepScroll;
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
  loadThumbs();
}
const mhead = (t) => `<div class="sheet-head"><h3>${t}</h3><button type="button" class="iconbtn" data-action="closeModal" aria-label="Bezárás">${I.x}</button></div>`;
const catPicker = (cur, act) => `<div class="chips type-chips">${prodCats().map((c) => `<button type="button" class="tchip ${cur === c ? "on" : ""}" data-action="${act}" data-v="${esc(c)}">${esc(c)}</button>`).join("")}</div>
  <div class="addline" style="margin-top:8px"><input class="in-ctl" id="m-newcat" placeholder="Új kategória, pl. Karkötők"><button type="button" class="btn small" data-action="${act}" data-new="1">Hozzáadás</button></div>`;
const autoName = (cat, fam) => `${famName(fam)} – ${cat || "termék"}`;
const MV = {
  choose: () => `<div class="sheet" role="dialog" aria-modal="true">${mhead(modal.prodOnly ? "Termék hozzáadása" : "Mit szeretnél rögzíteni?")}
    <div class="choose">${modal.prodOnly ? "" : `<button type="button" class="qa" data-action="newOrder"><span class="mi">${I.order}</span>Új rendelés<span class="note">Termék, ár, határidő, vevő</span></button><button type="button" class="qa sage" data-action="newExp"><span class="mi">${I.exp}</span>Új kiadás<span class="note">Fonal, posta, könyvelő…</span></button>`}
    <button type="button" class="qa cord" data-action="prodCam"><span class="mi">${I.cam}</span>Termék fotózása<span class="note">A kamera azonnal megnyílik</span></button><button type="button" class="qa cord" data-action="prodGal"><span class="mi">${I.gal}</span>Fotók a galériából<span class="note">Egyszerre több kép is</span></button></div></div>`,
  prodNew: () => {
    const m = modal, n = m.items.length, saving = m.saving != null;
    return `<form class="sheet" id="modalForm" role="dialog" aria-modal="true" novalidate>${mhead(n > 1 ? `${n} új termék` : "Új termék")}
     <div class="field"><label>Kategória${n > 1 ? " (mindegyik képre)" : ""}</label>${catPicker(m.cat, "pnCat")}</div>
     ${m.busy ? `<div class="busy"><i></i>Képek feldolgozása, színek felismerése… (${m.busy} hátra)</div>` : ""}
     <div class="newrows">${m.items.map((it, i) => `<div class="newrow"><img src="${it.url}" alt="">
      <div class="fields"><input class="in-ctl" id="pn-name-${it.key}" data-pi="${i}" data-pf="name" value="${esc(it.name)}" placeholder="${esc(autoName(m.cat, it.fam))}" aria-label="Termék neve">
       <div class="colorline">${swatch(it.fam, it.hex)}${esc(famName(it.fam))}<button type="button" data-action="pnColor" data-i="${i}">${it.open ? "kész" : "módosítás"}</button></div>
       ${it.open ? famChooser(it, `data-action="pnFam" data-i="${i}"`, `data-action="pnPal" data-i="${i}"`) : ""}
       <div class="mini"><input class="in-ctl num" id="pn-qty-${it.key}" data-pi="${i}" data-pf="qty" value="${esc(it.qty)}" inputmode="numeric" placeholder="db" aria-label="Darabszám"><input class="in-ctl num" id="pn-price-${it.key}" data-pi="${i}" data-pf="price" value="${esc(it.price)}" inputmode="numeric" placeholder="ár, Ft" aria-label="Eladási ár"></div></div>
      <button type="button" class="x" data-action="pnDel" data-i="${i}" aria-label="Kép kivétele">${I.x}</button></div>`).join("")}</div>
     <div class="btns"><button type="button" class="btn small" data-action="prodCam">${I.cam.replace("<svg", '<svg width="16" height="16"')} Még egy fotó</button><button type="button" class="btn small" data-action="prodGal">${I.gal.replace("<svg", '<svg width="16" height="16"')} Még a galériából</button></div>
     <p class="note" style="margin:0">A nevet nem kötelező megadni: üresen hagyva szín és kategória alapján kap nevet. A színt az app a fotóból ismeri fel, a „módosítás” gombbal javíthatod.</p>
     <p class="note" id="mErr" hidden style="color:var(--danger);margin:0"></p>
     <div class="btns" style="justify-content:space-between"><button type="button" class="btn" data-action="closeModal" ${saving ? "disabled" : ""}>Mégse</button><button class="btn primary big" type="submit" ${m.busy || saving || !n ? "disabled" : ""}>${saving ? `Mentés… ${m.saving}/${n}` : n > 1 ? `${n} termék mentése` : "Termék mentése"}</button></div></form>`;
  },
  prod: () => {
    const m = modal, d = m.data, ph = d.photo;
    const img = !ph ? "" : ph.dataUrl ? `<img class="prod-hero" src="${ph.dataUrl}" alt="" data-action="prodZoom">` : `<img class="prod-hero" data-thumb="${esc(ph.thumb || ph.path)}" alt="" data-action="prodZoom" hidden>`;
    return `<form class="sheet" id="modalForm" role="dialog" aria-modal="true" novalidate>${mhead("Termék adatai")}
     ${img}
     <div class="field"><label for="m-name">Megnevezés</label><input class="in-ctl" id="m-name" data-mf="name" value="${esc(d.name)}" placeholder="pl. Rózsaszín csomós fülbevaló"></div>
     <div class="field"><label>Kategória</label>${catPicker(d.cat, "pCat")}</div>
     <div class="field"><label>Szín</label><div class="colorline">${swatch(d.fam, d.hex, true)}<span>${esc(famName(d.fam))}${d.colorManual ? " (kézzel beállítva)" : " (felismert)"}</span></div>${famChooser(d, 'data-action="pFam"', 'data-action="pPal"')}</div>
     <div class="grid2"><div class="field"><label for="m-qty">Raktáron (db)</label><div class="qty"><button type="button" class="qbtn" data-action="pStep" data-k="-1" aria-label="Csökkentés">${I.minus}</button><input class="in-ctl num" id="m-qty" data-mf="qty" inputmode="numeric" value="${esc(d.qty)}" style="text-align:center"><button type="button" class="qbtn" data-action="pStep" data-k="1" aria-label="Növelés">${I.plus}</button></div></div>
     <div class="field"><label for="m-price">Eladási ár (Ft)</label><input class="in-ctl num" id="m-price" data-mf="price" inputmode="numeric" value="${esc(d.price)}" placeholder="darabonként"></div></div>
     <div class="field"><label for="m-note">Megjegyzés</label><input class="in-ctl" id="m-note" data-mf="note" value="${esc(d.note || "")}" placeholder="méret, anyag, hol tárolod…"></div>
     <p class="note" id="mErr" hidden style="color:var(--danger);margin:0"></p>
     <div class="btns" style="justify-content:space-between">${m.confirm ? '<button type="button" class="btn danger solid" data-action="pDel">Igen, törlöm</button>' : '<button type="button" class="btn danger" data-action="pAskDel">Törlés</button>'}<button class="btn primary" type="submit">Mentés</button></div></form>`;
  },
  prodCats: () => {
    const m = modal, used = (c) => prodList().filter((p) => p.cat === c).length;
    return `<form class="sheet" id="modalForm" role="dialog" aria-modal="true" novalidate>${mhead("Kategóriák")}
     <p class="note" style="margin:0">Átnevezéskor a kategória összes terméke is átkerül az új névre.</p>
     <div>${m.list.map((c, i) => `<div class="catedit"><input class="in-ctl" id="pc-${i}" data-ci="${i}" value="${esc(c.name)}" aria-label="Kategória neve"><span class="t num">${c.orig ? used(c.orig) + " db" : "új"}</span><button type="button" class="x" data-action="pcDel" data-i="${i}" aria-label="Kategória törlése">${I.x}</button></div>`).join("")}</div>
     <div class="addline"><input class="in-ctl" id="m-newcat" placeholder="Új kategória, pl. Karkötők"><button type="button" class="btn small" data-action="pcAdd">Hozzáadás</button></div>
     <p class="note" id="mErr" hidden style="color:var(--danger);margin:0"></p>
     <div class="btns" style="justify-content:flex-end"><button class="btn primary" type="submit">Mentés</button></div></form>`;
  }
};
function famChooser(d, famAttr, palAttr) {
  const pal = (d.palette || []).filter((x) => FAM[x.f]);
  return `${pal.length > 1 ? `<div class="note" style="margin:8px 0 4px">A fotón talált színek – koppints a helyesre:</div><div class="famchips">${pal.map((x, i) => `<button type="button" class="famchip ${d.hex === x.hex ? "on" : ""}" ${palAttr} data-p="${i}">${swatch(x.f, x.hex)}${esc(famName(x.f))} <span class="note num">${x.p}%</span></button>`).join("")}</div>` : ""}
   <div class="note" style="margin:8px 0 4px">Vagy válassz színcsaládot:</div><div class="famchips">${FAMS.map(([k, n, hex]) => `<button type="button" class="famchip ${d.fam === k ? "on" : ""}" ${famAttr} data-f="${k}">${swatch(k, hex)}${esc(n)}</button>`).join("")}</div>`;
}
function modalInput(t) {
  if (!modal) return false;
  if (t.dataset.pi !== undefined && modal.kind === "prodNew") { const it = modal.items[+t.dataset.pi]; if (it) it[t.dataset.pf] = t.value; return true; }
  if (t.dataset.mf !== undefined && modal.kind === "prod") { modal.data[t.dataset.mf] = t.value; return true; }
  if (t.dataset.ci !== undefined && modal.kind === "prodCats") { const c = modal.list[+t.dataset.ci]; if (c) c.name = t.value; return true; }
  return false;
}
function modalErr(msg) { const e = document.getElementById("mErr"); if (e) { e.textContent = msg; e.hidden = false; e.scrollIntoView({ block: "nearest" }); } else toast(msg); }
function addCat(name) {
  const v = String(name || "").trim(); if (!v) return "";
  const s = clone(data().settings); if (!s.prodCats.includes(v)) { s.prodCats.push(v); saveSettings(s, true); }
  return v;
}
const readNewCat = () => { const el = document.getElementById("m-newcat"); return el ? el.value : ""; };

/* Fotók feldolgozása (sorban, hogy a telefon memóriája bírja) */
async function addProdFiles(list) {
  const files = [...list].filter((f) => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (!files.length) { toast("Képfájlt válassz."); return; }
  if (!modal || modal.kind !== "prodNew") {
    const cats = prodCats();
    openModal({ kind: "prodNew", items: [], busy: 0, cat: ui.prodCat && ui.prodCat !== "all" && cats.includes(ui.prodCat) ? ui.prodCat : (cats[0] || "") });
  }
  const m = modal; m.busy += files.length; drawModal();
  for (const f of files) {
    try {
      const bmp = await loadBitmap(f), full = scaled(bmp, 1600), th = scaled(bmp, 480);
      if (bmp.close) bmp.close();
      const col = analyzeColors(th), fullBlob = await toBlob(full, 0.82), thBlob = await toBlob(th, 0.76);
      full.width = full.height = 0;
      m.items.push({ key: uid("i"), name: "", qty: "1", price: "", fam: col.fam, hex: col.hex, palette: col.palette, fullBlob, thBlob, url: URL.createObjectURL(thBlob) });
    } catch (e) { toast("Egy képet nem sikerült beolvasni (" + f.name + ")."); }
    m.busy--; if (modal === m) drawModal();
  }
}
async function storeProdPhoto(id, fullBlob, thBlob) {
  if (CLOUD && sb && store.uid && online()) {
    const base = `${store.uid}/products/${id}`;
    try {
      const a = await sb.storage.from("documents").upload(base + ".jpg", fullBlob, { contentType: "image/jpeg", upsert: true });
      if (a.error) throw a.error;
      const b = await sb.storage.from("documents").upload(base + "-t.jpg", thBlob, { contentType: "image/jpeg", upsert: true });
      return b.error ? { path: base + ".jpg" } : { path: base + ".jpg", thumb: base + "-t.jpg" };
    } catch (e) { /* lent: helyi mentés, később feltöltődik */ }
  }
  return { dataUrl: await blobUrl(thBlob), local: !!CLOUD };
}
async function saveProdBatch() {
  const m = modal; if (!m || m.busy || m.saving != null) return;
  if (!m.items.length) return modalErr("Adj hozzá legalább egy fotót.");
  if (!m.cat) return modalErr("Válassz vagy adj meg egy kategóriát.");
  addCat(m.cat);
  m.saving = 0; drawModal();
  let offline = 0;
  for (let i = 0; i < m.items.length; i++) {
    const it = m.items[i], id = uid("prd"), photo = await storeProdPhoto(id, it.fullBlob, it.thBlob);
    if (photo.local) offline++;
    setRec(id, "settings", { name: String(it.name || "").trim() || autoName(m.cat, it.fam), cat: m.cat, fam: it.fam, hex: it.hex, palette: it.palette, colorManual: !!it.manual, qty: it.qty === "" ? "" : num(it.qty), price: num(it.price), note: "", photo, created: Date.now() + i }, { quiet: true });
    m.saving = i + 1; if (modal === m) drawModal();
  }
  const n = m.items.length; m.items.forEach((x) => URL.revokeObjectURL(x.url));
  modal = null; drawModal();
  if (ui.prodCat !== "all" && ui.prodCat !== m.cat) ui.prodCat = m.cat;
  ui.tab = "prod"; saveUi(); render(true); haptic("save");
  toast(n > 1 ? `${n} termék elmentve` : "Termék elmentve" + (offline ? " (a fotó internet esetén feltöltődik)" : ""));
}
/* Offline mentett fotók feltöltése, amint van net */
let migrating = false;
async function migrateProdPhotos() {
  if (migrating || !CLOUD || !sb || !store.uid || !online()) return;
  const todo = prodList().filter((p) => p.photo && p.photo.local && p.photo.dataUrl); if (!todo.length) return;
  migrating = true;
  try {
    for (const p of todo) {
      const blob = await dataBlob(p.photo.dataUrl), base = `${store.uid}/products/${p.id}`;
      const { error } = await sb.storage.from("documents").upload(base + "-t.jpg", blob, { contentType: "image/jpeg", upsert: true });
      if (error) break;
      const cur = data().products[p.id]; if (!cur) continue;
      setRec(p.id, "settings", Object.assign(clone(cur), { photo: { path: base + "-t.jpg", thumb: base + "-t.jpg" } }), { quiet: true });
    }
  } catch (e) {} finally { migrating = false; }
}
function openProd(id) { const p = data().products[id]; if (!p) return; openModal({ kind: "prod", id, data: Object.assign({ name: "", cat: "", fam: "szurke", hex: "", palette: [], qty: "", price: "", note: "" }, clone(p)) }); }
function saveProd() {
  const m = modal, d = m.data; if (!d.cat) return modalErr("Válassz kategóriát.");
  const cur = data().products[m.id]; if (!cur) { closeModal(); return; }
  const x = Object.assign(clone(cur), { name: String(d.name || "").trim() || autoName(d.cat, d.fam), cat: d.cat, fam: d.fam, hex: d.hex, colorManual: !!d.colorManual, qty: d.qty === "" ? "" : Math.max(0, num(d.qty)), price: num(d.price), note: String(d.note || "").trim() });
  addCat(d.cat); modal = null; drawModal(); setRec(m.id, "settings", x); haptic("save"); toast("Termék elmentve");
}
function saveCats() {
  const m = modal, names = m.list.map((c) => String(c.name || "").trim());
  if (names.some((n) => !n)) return modalErr("Egyik kategória neve üres. Írj be nevet, vagy töröld a sort.");
  if (new Set(names.map((n) => n.toLocaleLowerCase("hu-HU"))).size !== names.length) return modalErr("Két kategóriának ugyanaz a neve.");
  const s = clone(data().settings); s.prodCats = names;
  m.list.forEach((c) => { if (c.orig && c.orig !== c.name.trim()) prodList().filter((p) => p.cat === c.orig).forEach((p) => { const x = clone(data().products[p.id]); x.cat = c.name.trim(); setRec(p.id, "settings", x, { quiet: true }); }); if (ui.prodCat === c.orig) ui.prodCat = c.name.trim(); });
  saveSettings(s, true); modal = null; drawModal(); saveUi(); render(true); toast("Kategóriák elmentve");
}
function submitModal() { if (!modal) return; if (modal.kind === "prodNew") saveProdBatch(); else if (modal.kind === "prod") saveProd(); else if (modal.kind === "prodCats") saveCats(); }
async function zoomProd() {
  const ph = modal && modal.data && modal.data.photo; if (!ph) return;
  if (ph.dataUrl) return showPhoto(ph.dataUrl);
  if (!sb || !online()) { const im = document.querySelector(".prod-hero"); if (im && im.src) showPhoto(im.src); return; }
  const { data: r } = await sb.storage.from("documents").createSignedUrl(ph.path, 600);
  if (r && r.signedUrl) showPhoto(r.signedUrl);
}
document.getElementById("prodCam").addEventListener("change", (e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) addProdFiles(f); });
document.getElementById("prodGal").addEventListener("change", (e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) addProdFiles(f); });
document.addEventListener("input", (e) => {
  if (e.target.id !== "prodQ") return;
  ui.prodQ = e.target.value; const g = document.getElementById("prodGrid"); if (g) { g.innerHTML = prodGrid(); loadThumbs(); }
});
const pickFile = (id) => { const keep = modal && modal.kind === "prodNew"; if (!keep && modal) { modal = null; drawModal(); } document.getElementById(id).click(); };
const PA = {
  choose: () => { stashDraft(); openModal({ kind: "choose" }); },
  newExp: () => { if (modal) { modal = null; drawModal(); } if (ui.tab === "new") { ui.tab = "exp"; saveUi(); render(true); } openExp(); },
  closeModal: () => closeModal(),
  closeModalBg: (b, e) => { if (e.target === b) closeModal(); },
  prodCam: () => pickFile("prodCam"),
  prodGal: () => pickFile("prodGal"),
  prodCat: (b) => { ui.prodCat = b.dataset.v; saveUi(); render(true); },
  prodSort: (b) => { ui.prodSort = b.dataset.v; saveUi(); render(true); },
  prodEdit: (b) => openProd(b.dataset.id),
  prodZoom: () => zoomProd(),
  prodCatsOpen: () => openModal({ kind: "prodCats", list: prodCats().map((c) => ({ orig: c, name: c })) }),
  pnCat: (b) => { const v = b.dataset.new ? addCat(readNewCat()) : b.dataset.v; if (!v) return; modal.cat = v; drawModal(); },
  pnColor: (b) => { const it = modal.items[+b.dataset.i]; if (it) { it.open = !it.open; drawModal(); } },
  pnFam: (b) => { const it = modal.items[+b.dataset.i]; if (!it) return; it.fam = b.dataset.f; it.hex = FAM[it.fam].hex; it.manual = true; it.open = false; drawModal(); },
  pnPal: (b) => { const it = modal.items[+b.dataset.i], p = it && it.palette[+b.dataset.p]; if (!p) return; it.fam = p.f; it.hex = p.hex; it.manual = true; it.open = false; drawModal(); },
  pnDel: (b) => { const it = modal.items.splice(+b.dataset.i, 1)[0]; if (it) URL.revokeObjectURL(it.url); if (!modal.items.length && !modal.busy) closeModal(); else drawModal(); },
  pCat: (b) => { const v = b.dataset.new ? addCat(readNewCat()) : b.dataset.v; if (!v) return; modal.data.cat = v; drawModal(); },
  pFam: (b) => { modal.data.fam = b.dataset.f; modal.data.hex = FAM[b.dataset.f].hex; modal.data.colorManual = true; drawModal(); },
  pPal: (b) => { const p = (modal.data.palette || [])[+b.dataset.p]; if (!p) return; modal.data.fam = p.f; modal.data.hex = p.hex; modal.data.colorManual = true; drawModal(); },
  pStep: (b) => { modal.data.qty = Math.max(0, num(modal.data.qty) + +b.dataset.k); drawModal(); },
  pAskDel: () => { modal.confirm = true; drawModal(); },
  pDel: () => {
    const id = modal.id, raw = clone(store.recs[id].data); modal = null; drawModal(); delRec(id);
    let undone = false; toast(`„${raw.name || "Termék"}” törölve`, "Visszavonás", () => { undone = true; setRec(id, "settings", raw); });
    setTimeout(() => { if (!undone && raw.photo && raw.photo.path) dropPhotos([raw.photo.path, raw.photo.thumb]); }, 7000);
  },
  pcAdd: () => { const v = readNewCat().trim(); if (!v) return; modal.list.push({ orig: null, name: v }); drawModal(); },
  pcDel: (b) => { const c = modal.list[+b.dataset.i]; if (!c) return; const n = c.orig ? prodList().filter((p) => p.cat === c.orig).length : 0; if (n) return modalErr(`A(z) „${c.orig}” kategóriában ${n} termék van. Előbb sorold át őket, vagy nevezd át a kategóriát.`); modal.list.splice(+b.dataset.i, 1); drawModal(); }
};

/* NAV bevételi kimutatás */
function periodOf(p) {
  const Y = p.year;
  if (p.kind === "y") return { from: Y + "-01-01", to: Y + "-12-31", label: Y + ". év", file: String(Y) };
  if (p.kind === "q") { const a = (p.n - 1) * 3 + 1, b = a + 2; return { from: `${Y}-${pad(a)}-01`, to: `${Y}-${pad(b)}-31`, label: `${Y}. ${ROMAN[p.n - 1]} negyedév`, file: `${Y}-Q${p.n}` }; }
  return { from: `${Y}-${pad(p.n)}-01`, to: `${Y}-${pad(p.n)}-31`, label: monthLabel(`${Y}-${pad(p.n)}`), file: `${Y}-${pad(p.n)}` };
}
function reportRows(per) {
  const biz = data().biz, afa = biz.vat === "afa27";
  // A bevétel a ténylegesen befolyt összeg a befolyás napján: az előleg a saját napján, a hátralék a kifizetéskor kerül be.
  const rows = [];
  Object.entries(data().orders).forEach(([id, o]) => {
    const dep = depositOf(o);
    if (dep > 0) rows.push(Object.assign({ id }, o, { rd: o.depositDate || o.date, amount: dep, part: "dep", invoiceNo: o.depositInvoice, payMethod: o.depositMethod }));
    if (o.status === "Teljesítve" && o.paid) { const rest = Math.max(0, num(o.price) - dep); if (rest > 0 || !dep) rows.push(Object.assign({ id }, o, { rd: o.payDate || o.date, amount: rest, part: dep ? "rest" : "full" })); }
  });
  rows.splice(0, rows.length, ...rows.filter((o) => o.rd >= per.from && o.rd <= per.to).sort((a, b) => a.rd.localeCompare(b.rd) || (a.created || 0) - (b.created || 0) || (a.part === "dep" ? -1 : 1)));
  rows.forEach((o, i) => { o.no = i + 1; o.gross = o.amount; o.net = afa ? Math.round(o.gross / 1.27) : o.gross; o.vat = o.gross - o.net; });
  return rows;
}
function vNav() {
  const p = ui.rep, per = periodOf(p), biz = data().biz, afa = biz.vat === "afa27", rows = reportRows(per);
  const tot = { gross: sum(rows, "gross"), net: sum(rows, "net"), vat: sum(rows, "vat") };
  const missing = rows.filter((r) => !r.invoiceNo).length;
  const openN = Object.values(data().orders).filter((o) => !(o.status === "Teljesítve" && o.paid) && o.date >= per.from && o.date <= per.to).length;
  const ytd = reportRows(periodOf({ year: p.year, kind: "y" })), ytdSum = sum(ytd, "net");
  const segBtn = (kind, n, label) => `<button type="button" data-action="repSet" data-kind="${kind}" data-n="${n}" aria-pressed="${p.kind === kind && (kind === "y" || p.n === n)}">${label}</button>`;
  const months = {}; rows.forEach((r) => { const k = r.rd.slice(0, 7); months[k] = (months[k] || 0) + r.net; });
  const bizOk = biz.owner && biz.taxNo;
  let h = `<div class="noprint"><h2 class="page-title">NAV bevételi kimutatás</h2><p class="note" style="margin:0 0 10px">Időrendi bevételi nyilvántartás a „Teljesítve” állapotú, kifizetett rendelésekből, a kifizetés napja szerint.</p>
   <div class="navrow" style="margin-top:6px"><button type="button" class="iconbtn" data-action="repYear" data-k="-1" aria-label="Előző év">${I.prev}</button><h2>${p.year}</h2><button type="button" class="iconbtn" data-action="repYear" data-k="1" aria-label="Következő év">${I.next}</button></div>
   <div class="stack" style="gap:8px"><div class="seg">${segBtn("y", 0, "Egész év")}${[1, 2, 3, 4].map((n) => segBtn("q", n, ROMAN[n - 1] + " negyedév")).join("")}</div>
   <div class="seg">${MON.map((m, i) => segBtn("m", i + 1, m)).join("")}</div></div>
   <div class="stack" style="gap:8px;margin-top:12px">
    ${!bizOk ? `<div class="banner warn"><span>A fejlécbe kerülő vállalkozási adatok hiányosak (név, adószám).</span><button type="button" class="btn small" data-action="tab" data-t="biz">Kitöltés</button></div>` : ""}
    ${missing ? `<div class="banner warn"><span>${missing} tételnél hiányzik a számla / nyugta sorszáma.</span></div>` : ""}
    ${openN ? `<div class="banner"><span>${openN} rendelés ebben az időszakban még nincs lezárva vagy kifizetve, ezek nem szerepelnek a kimutatásban.</span></div>` : ""}
   </div>
   <div class="btns" style="margin-block:12px"><button type="button" class="btn primary" data-action="print">Nyomtatás / PDF</button><button type="button" class="btn" data-action="repCsv">CSV letöltése</button></div></div>`;
  h += `<article class="report" id="report">
   <div class="rep-head"><div class="rep-id"><b>${esc(biz.name || "SM home dekor")}</b><br>${esc(biz.owner || "—")} egyéni vállalkozó<br>${biz.address ? esc(biz.address) + "<br>" : ""}Adószám: ${esc(biz.taxNo || "—")}${biz.evNo ? ` · Nyilvántartási szám: ${esc(biz.evNo)}` : ""}<br>${esc(biz.taxMode)} · ${afa ? "ÁFA-körös (27%)" : "Alanyi adómentes (AAM)"}</div>
   <div class="rep-meta">Kiállítva:<br><b class="num" style="color:var(--ink)">${fullDate(TODAY)}</b></div></div>
   <h2>Bevételi nyilvántartás</h2><div class="note">${esc(per.label)} · ${fullDate(per.from)} – ${fullDate(per.to.replace(/-31$/, "-" + pad(new Date(+per.to.slice(0, 4), +per.to.slice(5, 7), 0).getDate())))}</div>
   <div class="rep-sum num"><div><small>Tételek</small><b>${rows.length} db</b></div><div><small>${afa ? "Nettó bevétel" : "Bevétel"}</small><b>${huf(tot.net)}</b></div><div><small>${p.kind === "y" ? "Éves összesen" : p.year + " eddig"}</small><b>${huf(ytdSum)}</b></div></div>
   ${rows.length ? `<div class="table-wrap"><table class="num"><thead><tr><th class="l">Ssz.</th><th class="l">Dátum</th><th class="l">Bizonylat</th><th class="l">Megnevezés</th><th class="l">Fiz. mód</th>${afa ? "<th>Nettó</th><th>ÁFA</th><th>Bruttó</th>" : "<th>Bevétel (Ft)</th>"}</tr></thead>
   <tbody>${rows.map((r) => `<tr><td class="l">${r.no}.</td><td class="l">${fullDate(r.rd)}</td><td class="l ${r.invoiceNo ? "" : "miss"}">${r.invoiceNo ? esc(r.invoiceNo) : "hiányzik"}</td><td class="l tw">${esc(r.product || r.type)}${num(r.qty) > 1 ? ` (${num(r.qty)} db)` : ""}${r.part === "dep" ? ' <span class="pill dep">előleg</span>' : r.part === "rest" ? ' <span class="pill">hátralék</span>' : ""}${r.customer ? `<br><span class="note">${esc(r.customer)}</span>` : ""}</td><td class="l">${esc(r.payMethod || "—")}</td>${afa ? `<td>${huf(r.net)}</td><td>${huf(r.vat)}</td><td>${huf(r.gross)}</td>` : `<td>${huf(r.net)}</td>`}</tr>`).join("")}</tbody>
   <tfoot><tr><td class="l" colspan="5">Összesen</td>${afa ? `<td>${huf(tot.net)}</td><td>${huf(tot.vat)}</td><td>${huf(tot.gross)}</td>` : `<td>${huf(tot.net)}</td>`}</tr></tfoot></table></div>` : '<p class="note">Ebben az időszakban nincs lezárt rendelés.</p>'}
   ${p.kind !== "m" && Object.keys(months).length > 1 ? `<div class="section-title" style="margin-top:16px">Havi bontás</div><div class="table-wrap"><table class="num"><tbody>${Object.entries(months).sort().map(([k, v]) => `<tr><td class="l" style="text-transform:capitalize">${esc(monthLabel(k))}</td><td>${huf(v)}</td></tr>`).join("")}</tbody></table></div>` : ""}
   <div class="rep-foot"><span>A kimutatás a ténylegesen befolyt összegeket tartalmazza időrendben: az előleget a befizetés napján, a hátralékot a kifizetéskor${afa ? ", az ÁFA a bruttó összegből 27%-kal visszaszámolva" : ", áfa nélküli összegben"}.</span><span>Készült az SM home dekor Planner alkalmazással. A bevallást nem helyettesíti.</span></div>
  </article>`;
  return h;
}

/* Vállalkozás */
function vBiz() {
  const b = data().biz, docs = Object.entries(data().docs).sort((x, y) => String(y[1].uploaded || "").localeCompare(String(x[1].uploaded || "")));
  const f = (k, label, ph, type, wide) => `<div class="field" ${wide ? 'style="grid-column:1/-1"' : ""}><label for="b-${k}">${label}</label><input class="in-ctl" id="b-${k}" data-b="${k}" ${type ? `type="${type}"` : ""} value="${esc(b[k])}" placeholder="${esc(ph || "")}"></div>`;
  const sel = (k, label, opts) => `<div class="field"><label for="b-${k}">${label}</label><select class="in-ctl" id="b-${k}" data-b="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${b[k] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
  const canDocs = CLOUD && store.uid;
  return `<h2 class="page-title">Vállalkozás adatai</h2><p class="note" style="margin:0 0 12px">Ezek kerülnek a NAV kimutatás fejlécébe. Minden mező automatikusan mentődik.</p>
  <div class="stack">
  <div class="card"><div class="section-title">Alapadatok</div><div class="grid2">
   ${f("name", "Vállalkozás neve", "SM home dekor", "", true)}${f("owner", "Egyéni vállalkozó neve", "teljes név", "", true)}${f("address", "Székhely", "irányítószám, város, utca", "", true)}
   ${f("taxNo", "Adószám", "12345678-1-11")}${f("evNo", "Nyilvántartási szám", "EV szám")}
   ${f("statNo", "Statisztikai számjel", "")}${f("teaor", "Fő tevékenység (TEÁOR)", "pl. 1392")}
   ${sel("taxMode", "Adózási mód", TAX_MODES.map((x) => [x, x]))}${sel("vat", "ÁFA", [["aam", "Alanyi adómentes (AAM)"], ["afa27", "ÁFA-körös (27%)"]])}
   ${f("started", "Tevékenység kezdete", "", "date")}${f("bank", "Bankszámlaszám", "")}
  </div></div>
  <div class="card"><div class="section-title">Elérhetőség és könyvelő</div><div class="grid2">
   ${f("email", "E-mail", "", "email")}${f("phone", "Telefon", "", "tel")}
   ${f("accountant", "Könyvelő neve", "")}${f("accountantContact", "Könyvelő elérhetősége", "telefon / e-mail")}
   <div class="field" style="grid-column:1/-1"><label for="b-note">Megjegyzés</label><textarea class="in-ctl" id="b-note" data-b="note" placeholder="pl. határidők, ügyfélkapu, kamarai tagság">${esc(b.note)}</textarea></div>
  </div></div>
  <div class="card"><div class="section-title">Hivatalos dokumentumok</div>
   ${canDocs ? `<p class="note" style="margin:0 0 10px">Szkenneld vagy fotózd le a nyomtatványt (vállalkozói nyilvántartás, adószám-igazolás, szerződések). A fájlok privát tárhelyre kerülnek, csak te látod őket.</p>
   <div class="addline" style="margin:0 0 12px;flex-wrap:wrap"><select class="in-ctl" id="docLabel" style="flex:1;min-width:180px">${DOC_LABELS.map((l) => `<option>${esc(l)}</option>`).join("")}</select><button type="button" class="btn primary" data-action="pickDoc" ${online() ? "" : "disabled"}>Fotó / fájl feltöltése</button></div>
   ${online() ? "" : '<p class="note">Feltöltéshez internetkapcsolat kell.</p>'}
   ${docs.length ? `<div class="docs">${docs.map(([id, d]) => `<div class="doc"><button type="button" class="thumb" data-action="openDoc" data-id="${esc(id)}" aria-label="${esc(d.name)} megnyitása">${/^image\//.test(d.type) ? `<img alt="" data-thumb="${esc(d.path)}" hidden>${I.file}` : I.file}</button><div class="info"><b>${esc(d.label || "Dokumentum")}</b><span>${esc(d.name)}</span><span class="num">${esc(fullDate(d.uploaded))} · ${fmtSize(d.size || 0)}</span></div><div class="acts">${uiConfirm === "doc:" + id ? `<button type="button" class="btn small danger solid" data-action="delDoc" data-id="${esc(id)}">Törlés</button><button type="button" class="btn small" data-action="cancelConfirm">Mégse</button>` : `<button type="button" class="btn small danger" data-action="askDelDoc" data-id="${esc(id)}">Törlés</button>`}</div></div>`).join("")}</div>` : '<p class="note" style="margin:0">Még nincs feltöltött dokumentum.</p>'}`
   : `<p class="note" style="margin:0">Dokumentumokat felhős mentéssel lehet tárolni. ${CLOUD ? "Lépj be a feltöltéshez." : "Állítsd be a Supabase kapcsolatot a config.js fájlban (lásd README)."}</p>`}
  </div></div>`;
}

/* Beállítások */
let uiConfirm = null, installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; if (ui.tab === "set") render(); });
function drawQr() {
  const box = document.getElementById("qrBox"); if (!box) return;
  if (!window.qrcode) { box.innerHTML = '<p class="note">A QR-kód offline nem jeleníthető meg.</p>'; return; }
  try { const q = window.qrcode(0, "M"); q.addData(location.origin + "/"); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
  catch (e) { box.innerHTML = ""; }
}
function vSet() {
  const s = data().settings;
  const chips = (k, ph) => `<div class="chips">${s[k].map((c, i) => `<span class="chip">${esc(c)}<button type="button" data-action="chipDel" data-list="${k}" data-i="${i}" aria-label="${esc(c)} törlése">${I.x}</button></span>`).join("")}</div><div class="addline"><input class="in-ctl" id="chip-${k}" placeholder="${ph}"><button type="button" class="btn small" data-action="chipAdd" data-list="${k}">Hozzáadás</button></div>`;
  const opt = (arr, v) => arr.map((c) => `<option ${c === v ? "selected" : ""}>${esc(c)}</option>`).join("");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const pend = Object.keys(store.dirty).length;
  return `<h2 class="page-title">Beállítások</h2><div class="stack">
  ${CLOUD ? `<div class="card"><div class="section-title">Fiók és szinkron</div><div class="rows">
    <div class="row"><span>Belépve</span><b style="overflow-wrap:anywhere;text-align:right">${esc(auth.email || "—")}</b></div>
    <div class="row"><span>Állapot</span><span class="num">${esc(document.getElementById("status").textContent)}</span></div>
    ${sync.err ? `<div class="row"><span class="note">${esc(sync.err)}</span></div>` : ""}</div>
    <div class="btns" style="margin-top:10px"><button type="button" class="btn" data-action="syncNow">Szinkronizálás most</button><button type="button" class="btn" data-action="pwOpen">${ui.pwOpen ? "Jelszócsere bezárása" : "Jelszó módosítása"}</button>
    ${uiConfirm === "logout" ? `<button type="button" class="btn danger solid" data-action="logout">Kijelentkezés${pend ? ` (${pend} nem mentett tétel elvész)` : ""}</button><button type="button" class="btn" data-action="cancelConfirm">Mégse</button>` : '<button type="button" class="btn danger" data-action="askLogout">Kijelentkezés</button>'}</div>
    ${ui.pwOpen ? `<form id="pwForm" class="stack pw-form" style="gap:10px;margin-top:14px" novalidate autocomplete="on">
     <input type="email" autocomplete="username" value="${esc(auth.email || "")}" hidden readonly>
     <div class="field"><label for="pw-old">Jelenlegi jelszó</label><input class="in-ctl" type="password" id="pw-old" autocomplete="current-password"></div>
     <div class="grid2"><div class="field"><label for="pw-new">Új jelszó</label><input class="in-ctl" type="password" id="pw-new" autocomplete="new-password" placeholder="min. 8 karakter"></div>
     <div class="field"><label for="pw-new2">Új jelszó még egyszer</label><input class="in-ctl" type="password" id="pw-new2" autocomplete="new-password"></div></div>
     <label class="switch"><input type="checkbox" id="pw-show"><span>Jelszavak megjelenítése</span></label>
     <p class="note" id="pwMsg" hidden style="margin:0"></p>
     <div class="btns"><button class="btn primary" type="submit">Új jelszó mentése</button></div>
     <p class="note" style="margin:0">Ha a jelenlegi jelszót nem tudod, lépj ki, és a belépésnél használd az „Elfelejtett jelszó” lehetőséget.</p></form>` : ""}</div>`
  : `<div class="card"><div class="section-title">Mentés</div><p class="note" style="margin:0">Helyi mód: az adatok csak ezen a készüléken vannak. Felhős mentéshez töltsd ki a config.js fájlt (lásd README).</p></div>`}

  <div class="card"><div class="section-title">Telepítés telefonra</div><div class="stack" style="gap:12px">
   ${standalone ? '<p class="note" style="margin:0">Az app telepítve fut ezen a készüléken.</p>' : installEvt ? '<button type="button" class="btn primary" data-action="install">Telepítés erre a telefonra</button>' : `<p class="note" style="margin:0">${ios ? "iPhone: Safariban a Megosztás gomb, majd „Főképernyőhöz adás”." : "Android: Chrome menü (⋮), majd „Alkalmazás telepítése” vagy „Hozzáadás a kezdőképernyőhöz”."}</p>`}
   <p class="note" style="margin:0">Másik telefonra: olvasd be ezt a QR-kódot a kamerával.</p>
   <div class="qr" id="qrBox" aria-label="QR-kód az app címével"></div>
   <div class="copyline"><code>${esc(location.origin + "/")}</code><button type="button" class="btn small" data-action="copyLink">Másolás</button></div>
  </div></div>

  <div class="card"><div class="section-title">Visszajelzés</div><div class="stack" style="gap:12px">
   <label class="switch"><input type="checkbox" data-action="fxToggle" data-k="vib" ${fxPrefs().vib ? "checked" : ""}><span><b>Rezgés</b> gombnyomáskor<br><span class="note">Androidon működik, iPhone-on a böngésző nem engedi.</span></span></label>
   <label class="switch"><input type="checkbox" data-action="fxToggle" data-k="snd" ${fxPrefs().snd ? "checked" : ""}><span><b>Halk hang</b> (fagyöngy a zsinóron)<br><span class="note">A telefon némítója ezt is elnémítja.</span></span></label>
   <div class="field"><label for="fx-vol">Hangerő: <span id="volLbl" class="num">${fxPrefs().vol}%</span></label><input type="range" id="fx-vol" class="range" min="0" max="100" step="5" data-fx="vol" value="${fxPrefs().vol}"></div>
  </div></div>
  <div class="card"><div class="section-title">Célok és számítás</div><div class="stack" style="gap:12px">
   <div class="grid2"><div class="field"><label for="s-target">Havi bevételi cél (Ft)</label><input class="in-ctl num" id="s-target" inputmode="numeric" data-s="target" data-num value="${num(s.target) || ""}" placeholder="pl. 250000"></div>
   <div class="field"><label for="s-tax">Adó- és járuléktartalék (%)</label><input class="in-ctl num" id="s-tax" inputmode="decimal" data-s="taxPct" data-num value="${num(s.taxPct) || ""}" placeholder="pl. 15"></div></div>
   <label class="switch"><input type="checkbox" id="s-deduct" data-s="deductMaterial" ${s.deductMaterial ? "checked" : ""}><span><b>A rendelések anyagköltségét is vonja le a haszonból</b><br><span class="note">Kapcsold ki, ha a fonalat és nyersanyagot inkább kiadásként rögzíted vásárláskor. Így nem számolod kétszer.</span></span></label>
  </div></div>

  <div class="card"><div class="section-title">Termékek és alapárak</div><p class="note" style="margin:0 0 6px">Rendelésnél a típus kiválasztásakor ezekkel tölti ki az árat, költséget és munkaidőt (darabszámmal szorozva).</p>
   <div class="set-row set-head" style="border:0;padding-bottom:0"><span class="nm">Név</span><span>Ár</span><span>Anyag</span><span>Óra</span><span></span></div>
   ${s.types.map((t, i) => `<div class="set-row"><input class="in-ctl nm" aria-label="Típus neve" data-s="types.${i}.name" value="${esc(t.name)}"><input class="in-ctl num" aria-label="Alapár" inputmode="numeric" data-s="types.${i}.price" data-num value="${num(t.price) || ""}" placeholder="Ft"><input class="in-ctl num" aria-label="Anyagköltség" inputmode="numeric" data-s="types.${i}.cost" data-num value="${num(t.cost) || ""}" placeholder="Ft"><input class="in-ctl num" aria-label="Munkaóra" inputmode="decimal" data-s="types.${i}.hours" data-num value="${num(t.hours) || ""}" placeholder="ó"><button type="button" class="x" data-action="typeDel" data-i="${i}" aria-label="Típus törlése">${I.x}</button></div>`).join("")}
   <div class="btns" style="margin-top:10px"><button type="button" class="btn small" data-action="typeAdd">Új terméktípus</button></div></div>

  <div class="card"><div class="section-title">Havi fix költségek</div><p class="note" style="margin:0 0 6px">Például könyvelő, áram, webshop díj. A Kiadások fülön egy gombbal felveheted őket minden hónapra.</p>
   ${s.fixed.map((f, i) => `<div class="set-row fixed"><select class="in-ctl" aria-label="Kategória" data-s="fixed.${i}.cat">${opt(s.expCats, f.cat)}</select><input class="in-ctl num" aria-label="Összeg" inputmode="numeric" data-s="fixed.${i}.amount" data-num value="${num(f.amount) || ""}" placeholder="Ft"><input class="in-ctl nt" aria-label="Megjegyzés" data-s="fixed.${i}.note" value="${esc(f.note || "")}" placeholder="megjegyzés"><button type="button" class="x" data-action="fixedDel" data-i="${i}" aria-label="Fix költség törlése">${I.x}</button></div>`).join("") || '<p class="note">Még nincs fix költség.</p>'}
   <div class="btns" style="margin-top:10px"><button type="button" class="btn small" data-action="fixedAdd">Új fix költség</button></div></div>

  <div class="card"><div class="section-title">Kiadás kategóriák</div>${chips("expCats", "pl. Fa karika")}</div>
  <div class="card"><div class="section-title">Értékesítési csatornák</div>${chips("channels", "pl. Etsy")}</div>

  <div class="card"><div class="section-title">Biztonsági mentés és adatok</div><div class="stack" style="gap:10px">
   <div class="btns"><button type="button" class="btn" data-action="exportJson">Mentés letöltése (JSON)</button><button type="button" class="btn" data-action="exportCsv"><span style="text-transform:capitalize">${esc(monthLabel(ui.month))}</span>&nbsp;CSV</button><button type="button" class="btn" data-action="importJson">Mentés visszatöltése</button></div>
   <p class="note" style="margin:0">A JSON mentés a rendeléseket, kiadásokat, készletet és az árukészlet adatait tartalmazza. A fotók a felhőben maradnak. A visszatöltés a korábbi verziók mentését is elfogadja.</p>
   <div class="btns"><button type="button" class="btn" data-action="sample">Mintaadatok betöltése</button><button type="button" class="btn" data-action="clearSample">Mintaadatok törlése</button>
   ${uiConfirm === "wipe" ? '<button type="button" class="btn danger solid" data-action="wipe">Igen, minden rendelés és kiadás törlése</button><button type="button" class="btn" data-action="cancelConfirm">Mégse</button>' : '<button type="button" class="btn danger" data-action="askWipe">Minden adat törlése</button>'}</div>
  </div></div>
  <p class="note" style="text-align:center">SM home dekor Planner · 2.5</p>
  </div>`;
}

/* ---------- Lap (rendelés / kiadás) ---------- */
let sheet = null, sheetConfirm = false;
function orderSheet(id, date) {
  const base = { date: date || ui.day, deadline: "", product: "", type: "", qty: 1, cost: "", price: "", hours: "", customer: "", channel: "", status: STATUSES[0], paid: false, depositPaid: false, deposit: "", depositDate: "", depositMethod: "", depositInvoice: "", note: "", invoiceNo: "", payMethod: "", payDate: "", photo: null };
  const d = Object.assign(base, id ? clone(data().orders[id]) : {});
  return { kind: "order", id: id || null, newId: id || uid("r"), data: d, origPhoto: d.photo && d.photo.path ? d.photo.path : null, uploads: [] };
}
function openOrder(id) { stashDraft(); sheet = orderSheet(id); sheetConfirm = false; drawSheet(); }
let draftNew = null;
const newDraft = (date) => Object.assign(orderSheet(null, date || TODAY), { inline: true });
function stashDraft() { if (sheet && sheet.inline) { draftNew = sheet; sheet = null; } }
function openStock(id) {
  const base = { name: "", kind: "mat", qty: "", unit: "db", price: "", min: "", note: "", buyQty: "", buyAmount: "", buyExp: true, buyCat: data().settings.expCats.includes("Fonal") ? "Fonal" : (data().settings.expCats[0] || "Egyéb") };
  sheet = { kind: "stock", id: id || null, data: Object.assign(base, id ? clone(data().stock[id]) : {}) }; sheetConfirm = false; drawSheet();
}
function openExp(id) {
  const d0 = ymOf(TODAY) === ui.month ? TODAY : ui.month + "-01";
  sheet = { kind: "exp", id: id || null, data: Object.assign({ date: d0, cat: data().settings.expCats[0] || "Egyéb", amount: "", note: "", docNo: "" }, id ? clone(data().expenses[id]) : {}) }; sheetConfirm = false; drawSheet();
}
function drawSheet() {
  const over = document.getElementById("sheet");
  if (!sheet || sheet.inline) { over.innerHTML = ""; document.body.style.overflow = ""; }
  if (!sheet) return;
  const box = sheet.inline ? document.getElementById("newForm") : over;
  if (!box) return;
  if (!sheet.inline) document.body.style.overflow = "hidden";
  const d = sheet.data, s = data().settings;
  const opts = (arr, v, blank) => (blank ? `<option value="">${blank}</option>` : "") + [...new Set([...arr, ...(v && !arr.includes(v) ? [v] : [])])].map((c) => `<option ${c === v ? "selected" : ""}>${esc(c)}</option>`).join("");
  let body;
  if (sheet.kind === "order") {
    const names = [...new Set(Object.values(data().orders).map((o) => o.product).filter(Boolean))].slice(0, 80);
    const inline = !!sheet.inline;
    body = `<div class="field"><label>Mit készítesz?</label><div class="chips type-chips">${s.types.map((t) => `<button type="button" class="tchip ${d.type === t.name ? "on" : ""}" data-action="pickType" data-v="${esc(t.name)}">${esc(t.name)}</button>`).join("")}</div></div>
     <div class="field"><label for="f-product">Termék megnevezése</label><input class="in-ctl" id="f-product" data-f="product" list="dl-prod" value="${esc(d.product)}" placeholder="pl. Bohém falikárpit 60 cm"><datalist id="dl-prod">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist></div>
     <div class="grid3"><div class="field"><label for="f-qty">Darab</label><input class="in-ctl num" id="f-qty" inputmode="numeric" data-f="qty" value="${esc(d.qty)}"></div>
     <div class="field"><label for="f-price">Eladási ár (Ft)</label><input class="in-ctl num" id="f-price" inputmode="numeric" data-f="price" value="${esc(d.price)}" placeholder="összesen"></div>
     <div class="field"><label for="f-cost">Anyagköltség (Ft)</label><input class="in-ctl num" id="f-cost" inputmode="numeric" data-f="cost" value="${esc(d.cost)}" placeholder="nettó"></div></div>
     <div class="grid2"><div class="field"><label for="f-hours">Munkaidő (óra)</label><input class="in-ctl num" id="f-hours" inputmode="decimal" data-f="hours" value="${esc(d.hours)}" placeholder="pl. 3,5"></div>
     <div class="field"><label for="f-deadline">Határidő</label><input class="in-ctl" type="date" id="f-deadline" data-f="deadline" value="${esc(d.deadline || "")}"></div></div>
     <div class="field"><label for="f-customer">Vevő (nem kötelező)</label><input class="in-ctl" id="f-customer" data-f="customer" value="${esc(d.customer)}"></div>
     <div class="fieldset dep-box"><label class="switch"><input type="checkbox" id="f-depositPaid" data-f="depositPaid" ${d.depositPaid ? "checked" : ""}><span><b>Előleget fizetett</b></span></label>
      ${d.depositPaid ? `<div class="grid2"><div class="field"><label for="f-deposit">Előleg összege (Ft)</label><input class="in-ctl num" id="f-deposit" inputmode="numeric" data-f="deposit" value="${esc(d.deposit || "")}" placeholder="pl. 5000"></div>
      <div class="field"><label for="f-depositDate">Előleg napja</label><input class="in-ctl" type="date" id="f-depositDate" data-f="depositDate" value="${esc(d.depositDate || "")}"></div></div>
      <div class="grid2"><div class="field"><label for="f-depositMethod">Fizetés módja</label><select class="in-ctl" id="f-depositMethod" data-f="depositMethod">${opts(PAY, d.depositMethod, "–")}</select></div>
      <div class="field"><label for="f-depositInvoice">Előleg bizonylata</label><input class="in-ctl" id="f-depositInvoice" data-f="depositInvoice" value="${esc(d.depositInvoice || "")}" placeholder="nem kötelező"></div></div>` : ""}</div>
     <div class="field"><label>Fotó, vázlat vagy inspiráció</label><div class="photo-box">${d.photo ? `<button type="button" class="photo-btn" data-action="viewPhoto" aria-label="Fotó nagyítása">${photoImg(d.photo, "pimg")}</button>` : `<div class="photo-empty">${I.file}</div>`}
      <div class="btns">${sheet.uploading ? '<span class="note">Feltöltés…</span>' : `<button type="button" class="btn small" data-action="pickPhoto">${d.photo ? "Csere" : "Fotó hozzáadása"}</button>${d.photo ? '<button type="button" class="btn small danger" data-action="removePhoto">Eltávolítás</button>' : ""}`}</div></div></div>
     <div class="preview num" id="preview"></div>
     <details class="more" ${inline && !sheet.moreOpen ? "" : "open"}><summary>További adatok <span class="note">(dátum, csatorna, megjegyzés, fizetés)</span></summary><div class="stack" style="gap:12px;margin-top:12px">
     <div class="grid2"><div class="field"><label for="f-date">Rendelés dátuma</label><input class="in-ctl" type="date" id="f-date" data-f="date" value="${esc(d.date)}"></div>
     <div class="field"><label for="f-channel">Csatorna</label><select class="in-ctl" id="f-channel" data-f="channel">${opts(s.channels, d.channel, "–")}</select></div></div>
     <div class="field"><label for="f-note">Megjegyzés</label><textarea class="in-ctl" id="f-note" data-f="note" placeholder="szín, méret, egyéb kérés…">${esc(d.note)}</textarea></div>
     <fieldset class="fieldset"><legend>Lezárás és bizonylat</legend>
      <div class="grid2"><div class="field"><label for="f-status">Állapot</label><select class="in-ctl" id="f-status" data-f="status">${opts(STATUSES, d.status)}</select></div>
      <label class="switch" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="f-paid" data-f="paid" ${d.paid ? "checked" : ""}><span><b>Kifizetve</b></span></label>
      <div class="field"><label for="f-payDate">Kifizetés napja</label><input class="in-ctl" type="date" id="f-payDate" data-f="payDate" value="${esc(d.payDate)}"></div>
      <div class="field"><label for="f-invoiceNo">Számla / nyugta sorszáma</label><input class="in-ctl" id="f-invoiceNo" data-f="invoiceNo" value="${esc(d.invoiceNo)}" placeholder="pl. SMHD-2026-014"></div>
      <div class="field"><label for="f-payMethod">Fizetés módja</label><select class="in-ctl" id="f-payMethod" data-f="payMethod">${opts(PAY, d.payMethod, "–")}</select></div></div>
      <p class="note" style="margin:0">A „Teljesítve” és kifizetett rendelések kerülnek a NAV kimutatásba, a kifizetés napja szerint.</p>
     </fieldset></div></details>`;
  } else if (sheet.kind === "stock") {
    body = `<div class="field"><label for="f-name">Megnevezés</label><input class="in-ctl" id="f-name" data-f="name" value="${esc(d.name)}" placeholder="pl. Pamutzsinór 5 mm, natúr"></div>
     <div class="grid2"><div class="field"><label for="f-kind">Típus</label><select class="in-ctl" id="f-kind" data-f="kind"><option value="mat" ${d.kind !== "prod" ? "selected" : ""}>Alapanyag</option><option value="prod" ${d.kind === "prod" ? "selected" : ""}>Kész termék</option></select></div>
     <div class="field"><label for="f-unit">Egység</label><select class="in-ctl" id="f-unit" data-f="unit">${opts(UNITS, d.unit)}</select></div></div>
     <div class="grid3"><div class="field"><label for="f-qty">Mennyiség</label><input class="in-ctl num" id="f-qty" inputmode="decimal" data-f="qty" value="${esc(d.qty)}" placeholder="0"></div>
     <div class="field"><label for="f-price">Egységár (Ft)</label><input class="in-ctl num" id="f-price" inputmode="numeric" data-f="price" value="${esc(d.price)}" placeholder="beszerzési"></div>
     <div class="field"><label for="f-min">Minimum</label><input class="in-ctl num" id="f-min" inputmode="decimal" data-f="min" value="${esc(d.min)}" placeholder="figyelmeztet"></div></div>
     <div class="field"><label for="f-note">Megjegyzés</label><input class="in-ctl" id="f-note" data-f="note" value="${esc(d.note)}" placeholder="pl. beszállító, szín, tárolás helye"></div>
     <fieldset class="fieldset"><legend>Beszerzés rögzítése</legend>
      <div class="grid2"><div class="field"><label for="f-buyQty">Vásárolt mennyiség</label><input class="in-ctl num" id="f-buyQty" inputmode="decimal" data-f="buyQty" value="${esc(d.buyQty)}" placeholder="+ ${esc(d.unit)}"></div>
      <div class="field"><label for="f-buyAmount">Fizetett összeg (Ft)</label><input class="in-ctl num" id="f-buyAmount" inputmode="numeric" data-f="buyAmount" value="${esc(d.buyAmount)}"></div></div>
      <label class="switch"><input type="checkbox" id="f-buyExp" data-f="buyExp" ${d.buyExp ? "checked" : ""}><span><b>Kiadásként is rögzítse</b></span></label>
      <div class="field"><label for="f-buyCat">Kiadás kategóriája</label><select class="in-ctl" id="f-buyCat" data-f="buyCat">${opts(s.expCats, d.buyCat)}</select></div>
      <p class="note" style="margin:0">Mentéskor a mennyiséghez hozzáadja a vásároltat, és ha megadtál összeget, a Kiadásokhoz is felveszi a mai nappal.</p>
     </fieldset>`;
  } else {
    body = `<div class="grid2"><div class="field"><label for="f-date">Dátum</label><input class="in-ctl" type="date" id="f-date" data-f="date" value="${esc(d.date)}"></div>
     <div class="field"><label for="f-cat">Kategória</label><select class="in-ctl" id="f-cat" data-f="cat">${opts(s.expCats, d.cat)}</select></div></div>
     <div class="grid2"><div class="field"><label for="f-amount">Összeg (Ft)</label><input class="in-ctl num" id="f-amount" inputmode="numeric" data-f="amount" value="${esc(d.amount)}" placeholder="pl. 12000"></div>
     <div class="field"><label for="f-docNo">Számla száma</label><input class="in-ctl" id="f-docNo" data-f="docNo" value="${esc(d.docNo || "")}" placeholder="nem kötelező"></div></div>
     <div class="field"><label for="f-note">Leírás</label><input class="in-ctl" id="f-note" data-f="note" value="${esc(d.note)}" placeholder="pl. 5 mm-es pamutzsinór, 3 tekercs"></div>`;
  }
  const delBtn = sheet.id ? (sheetConfirm ? '<button type="button" class="btn danger solid" data-action="sheetDel">Igen, törlöm</button>' : '<button type="button" class="btn danger" data-action="askDel">Törlés</button>') : "";
  const form = `<form class="sheet ${sheet.inline ? "inline" : ""}" id="sheetForm" ${sheet.inline ? "" : 'role="dialog" aria-modal="true"'} aria-labelledby="sh-t" novalidate>
   ${sheet.inline ? "" : `<div class="sheet-head"><h3 id="sh-t">${sheet.kind === "order" ? (sheet.id ? "Rendelés szerkesztése" : "Új rendelés") : sheet.kind === "stock" ? (sheet.id ? "Készlettétel" : "Új készlettétel") : (sheet.id ? "Kiadás szerkesztése" : "Új kiadás")}</h3><button type="button" class="iconbtn" data-action="closeSheet" aria-label="Bezárás">${I.x}</button></div>`}
   ${body}<p class="note" id="formErr" hidden style="color:var(--danger);margin:0"></p>
   <div class="btns" style="justify-content:space-between"><span>${sheet.inline ? '<button type="button" class="btn" data-action="resetDraft">Ürítés</button>' : delBtn}</span><button class="btn primary ${sheet.inline ? "big" : ""}" type="submit" ${sheet.uploading ? "disabled" : ""}>${sheet.inline ? "Rendelés mentése" : "Mentés"}</button></div></form>`;
  box.innerHTML = sheet.inline ? form : `<div class="overlay" data-action="closeSheetBg">${form}</div>`;
  updPreview(); loadThumbs();
}
function updPreview() {
  const el = document.getElementById("preview"); if (!el || !sheet) return; const d = sheet.data;
  const p = num(d.price) - num(d.cost), h = num(d.hours);
  el.innerHTML = `<span>Haszon: <b>${huf(p)}</b></span><span>Órabér: <b>${h > 0 ? huf(p / h) : "–"}</b></span>${num(d.qty) > 1 ? `<span>Darabonként: <b>${huf(num(d.price) / num(d.qty))}</b></span>` : ""}${d.depositPaid && num(d.deposit) > 0 ? `<span>Hátralék: <b>${huf(Math.max(0, num(d.price) - num(d.deposit)))}</b></span>` : ""}`;
}
function setField(f, v) { sheet.data[f] = v; const el = document.getElementById("f-" + f); if (el) el.value = v; }
function applyType() {
  const d = sheet.data, t = data().settings.types.find((x) => x.name === d.type); if (!t) return;
  const q = num(d.qty) || 1;
  ["price", "cost", "hours"].forEach((k) => { if (num(t[k]) > 0) setField(k, String(Math.round(num(t[k]) * q * 100) / 100)); });
  if (!d.product) setField("product", t.name);
}
function submitSheet() {
  const d = sheet.data, err = document.getElementById("formErr");
  const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: "nearest" }); };
  if (sheet.kind !== "stock" && !/^\d{4}-\d{2}-\d{2}$/.test(d.date || "")) return fail("Adj meg egy dátumot.");
  if (sheet.kind === "order") {
    if (!d.product && !d.type) return fail("Adj meg terméknevet vagy típust.");
    if (d.paid && !d.payDate) d.payDate = TODAY;
    if (d.depositPaid && !(num(d.deposit) > 0)) return fail("Add meg az előleg összegét, vagy vedd ki a pipát.");
    if (d.depositPaid && num(d.price) > 0 && num(d.deposit) > num(d.price)) return fail("Az előleg nem lehet több az eladási árnál.");
    const dep = !!d.depositPaid && num(d.deposit) > 0;
    const o = { date: d.date, deadline: d.deadline || "", paid: !!d.paid, depositPaid: dep, deposit: dep ? num(d.deposit) : 0, depositDate: dep ? (d.depositDate || TODAY) : "", depositMethod: dep ? (d.depositMethod || "") : "", depositInvoice: dep ? String(d.depositInvoice || "").trim() : "", photo: d.photo || null, product: String(d.product || "").trim(), type: d.type || "", qty: num(d.qty) || 1, cost: num(d.cost), price: num(d.price), hours: num(d.hours), customer: String(d.customer || "").trim(), channel: d.channel || "", status: d.status || STATUSES[0], note: String(d.note || "").trim(), invoiceNo: String(d.invoiceNo || "").trim(), payMethod: d.payMethod || "", payDate: d.payDate || "", created: d.created || Date.now() };
    if (d.sample) o.sample = true;
    const id = sheet.newId, keep = o.photo && o.photo.path;
    dropPhotos([...sheet.uploads, sheet.origPhoto].filter((x) => x && x !== keep));
    const wasInline = !!sheet.inline;
    ui.day = ui.calBy === "deadline" && o.deadline ? o.deadline : o.date; ui.month = ymOf(ui.day);
    sheet = wasInline ? newDraft() : null; draftNew = null; if (!wasInline) drawSheet();
    setRec(id, "order", o); haptic("save");
    if (wasInline) { window.scrollTo({ top: 0, behavior: "smooth" }); toast("Rendelés elmentve", "Megnézem", () => A.goDay({ dataset: { d: ui.day } })); }
    else toast("Rendelés elmentve");
  } else if (sheet.kind === "stock") {
    if (!String(d.name || "").trim()) return fail("Adj meg egy megnevezést.");
    const add = num(d.buyQty), amt = num(d.buyAmount);
    const x = { name: String(d.name).trim(), kind: d.kind === "prod" ? "prod" : "mat", qty: Math.round((num(d.qty) + add) * 100) / 100, unit: d.unit || "db", price: add > 0 && amt > 0 ? Math.round(amt / add) : num(d.price), min: num(d.min), note: String(d.note || "").trim() };
    const id = sheet.id || uid("stk"), buyExp = d.buyExp && amt > 0, cat = d.buyCat;
    sheet = null; drawSheet();
    setRec(id, "settings", x, { quiet: true });
    if (buyExp) setRec(uid("k"), "expense", { date: TODAY, cat: cat || "Egyéb", amount: amt, note: `${x.name} beszerzés${add ? ` (${fmtQty(add)} ${x.unit})` : ""}`, docNo: "", created: Date.now() }, { quiet: true });
    render(true); haptic("save"); toast(buyExp ? "Készlet és kiadás elmentve" : "Készlet elmentve");
  } else {
    if (!(num(d.amount) > 0)) return fail("Adj meg egy összeget.");
    const e = { date: d.date, cat: d.cat || "Egyéb", amount: num(d.amount), note: String(d.note || "").trim(), docNo: String(d.docNo || "").trim(), created: d.created || Date.now() };
    if (d.fixedId) e.fixedId = d.fixedId; if (d.sample) e.sample = true;
    const id = sheet.id || uid("k"); sheet = null; drawSheet(); ui.month = ymOf(e.date);
    setRec(id, "expense", e); haptic("save"); toast("Kiadás elmentve");
  }
}

/* ---------- Dokumentumok ---------- */
const thumbCache = {};
async function loadThumbs() {
  if (!sb) return;
  const imgs = [...document.querySelectorAll("img[data-thumb]")]; if (!imgs.length) return;
  const now = Date.now(), need = [...new Set(imgs.map((i) => i.dataset.thumb).filter((p) => !(thumbCache[p] && thumbCache[p].exp > now)))];
  if (need.length && online()) {
    try { const { data: d } = await sb.storage.from("documents").createSignedUrls(need, 3600); (d || []).forEach((x) => { if (x.signedUrl) thumbCache[x.path] = { url: x.signedUrl, exp: now + 3500e3 }; }); } catch (e) {}
  }
  imgs.forEach((img) => { const c = thumbCache[img.dataset.thumb]; if (c) { if (img.src !== c.url) img.src = c.url; img.hidden = false; const ic = img.nextElementSibling; if (ic && ic.tagName.toLowerCase() === "svg") ic.remove(); } });
}
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)/.test(file.type) || file.size < 1.5e6) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch (e) { return file; }
}
async function uploadDoc(file) {
  if (!sb || !store.uid) return;
  if (!online()) { toast("Feltöltéshez internetkapcsolat kell."); return; }
  if (file.size > 20 * 1048576) { toast("A fájl nagyobb 20 MB-nál. Válassz kisebbet."); return; }
  const label = (document.getElementById("docLabel") || {}).value || "Egyéb dokumentum";
  toast("Feltöltés…");
  const f = await shrinkImage(file);
  const id = uid("d"), safe = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-60) || "dokumentum";
  const path = `${store.uid}/${id}-${safe}`;
  const { error } = await sb.storage.from("documents").upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
  if (error) { toast("A feltöltés nem sikerült: " + error.message); return; }
  setRec(id, "doc", { name: file.name, label, path, type: f.type, size: f.size, uploaded: TODAY });
  toast("Dokumentum feltöltve");
}
async function openDoc(id) {
  const d = data().docs[id]; if (!d || !sb) return;
  if (!online()) { toast("A megnyitáshoz internetkapcsolat kell."); return; }
  const w = window.open("", "_blank");
  const { data: res, error } = await sb.storage.from("documents").createSignedUrl(d.path, 600);
  if (error || !res) { if (w) w.close(); toast("Nem sikerült megnyitni."); return; }
  if (w) w.location.href = res.signedUrl;
  else { sheet = null; document.getElementById("sheet").innerHTML = `<div class="overlay" data-action="closeSheetBg"><div class="sheet"><div class="sheet-head"><h3>${esc(d.label || "Dokumentum")}</h3><button type="button" class="iconbtn" data-action="closeSheet" aria-label="Bezárás">${I.x}</button></div><a class="btn primary wide" href="${esc(res.signedUrl)}" target="_blank" rel="noopener">Megnyitás</a></div></div>`; }
}
async function deleteDoc(id) {
  const d = data().docs[id]; if (!d) return;
  if (sb && online()) { const { error } = await sb.storage.from("documents").remove([d.path]); if (error) { toast("Nem sikerült törölni: " + error.message); return; } }
  else { toast("Törléshez internetkapcsolat kell."); return; }
  uiConfirm = null; delRec(id); toast("Dokumentum törölve");
}
/* Rendelés fotó (1 db) */
async function resizeImage(file, max, q) {
  let src;
  try { src = await createImageBitmap(file); }
  catch (e) { src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const w = src.width, h = src.height, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return { canvas: c, blob: await new Promise((r) => c.toBlob(r, "image/jpeg", q)) };
}
async function pickOrderPhoto(file) {
  if (!sheet || sheet.kind !== "order") return;
  if (!/^image\//.test(file.type)) { toast("Képfájlt válassz (fotó, vázlat)."); return; }
  const cloud = CLOUD && sb && store.uid;
  if (cloud && !online()) { toast("A fotó feltöltéséhez internetkapcsolat kell."); return; }
  sheet.uploading = true; drawSheet();
  try {
    if (cloud) {
      const { blob } = await resizeImage(file, 1600, 0.8);
      const path = `${store.uid}/orders/${sheet.newId}-${Date.now().toString(36)}.jpg`;
      const { error } = await sb.storage.from("documents").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      sheet.uploads.push(path); sheet.data.photo = { path };
    } else {
      const { canvas } = await resizeImage(file, 900, 0.72);
      sheet.data.photo = { dataUrl: canvas.toDataURL("image/jpeg", 0.72) };
    }
  } catch (e) { toast("A fotót nem sikerült feltölteni" + (e && e.message ? ": " + e.message : ".")); }
  if (sheet) { sheet.uploading = false; drawSheet(); }
}
function dropPhotos(paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length || !sb || !online()) return;
  sb.storage.from("documents").remove(list).catch(() => {});
}
function closeSheet() {
  if (sheet && sheet.inline) return;
  if (sheet && sheet.kind === "order") dropPhotos(sheet.uploads.filter((x) => x !== sheet.origPhoto));
  sheet = null; drawSheet();
}
function showPhoto(src) {
  if (!src) return;
  const v = document.getElementById("viewer"); v.querySelector("img").src = src; v.hidden = false;
}
document.getElementById("photoFile").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) pickOrderPhoto(f); });
document.getElementById("docFile").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) uploadDoc(f); });

/* ---------- Export / import ---------- */
function downloadFile(filename, text, type) {
  const blob = new Blob([text], { type }), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
const csvNum = (n) => String(Math.round(num(n) * 100) / 100).replace(".", ",");
function csvMonth() {
  const m = stats(ui.month);
  const lines = ["Tétel;Dátum;Megnevezés;Típus / kategória;Darab;Nettó költség (Ft);Eladási ár / összeg (Ft);Munkaóra;Állapot;Határidő;Előleg (Ft);Előleg napja;Kifizetve;Bizonylat;Fizetés módja;Kifizetés napja;Vevő;Csatorna;Megjegyzés"];
  m.os.sort((a, b) => a.date.localeCompare(b.date)).forEach((o) => lines.push(["Rendelés", o.date, o.product, o.type, o.qty, csvNum(o.cost), csvNum(o.price), csvNum(o.hours), o.status, o.deadline, depositOf(o) ? csvNum(depositOf(o)) : "", o.depositDate || "", o.paid ? "igen" : "nem", o.invoiceNo, o.payMethod, o.payDate, o.customer, o.channel, o.note].map(q).join(";")));
  m.es.sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => lines.push(["Kiadás", e.date, e.note, e.cat, "", "", csvNum(e.amount), "", "", "", "", "", "", e.docNo, "", "", "", "", ""].map(q).join(";")));
  lines.push(""); lines.push(["Bevétel összesen", "", "", "", "", csvNum(m.mat), csvNum(m.rev)].map(q).join(";"));
  lines.push(["Egyéb kiadások", "", "", "", "", "", csvNum(m.exp)].map(q).join(";"));
  lines.push(["Tiszta haszon", "", "", "", "", "", csvNum(m.profit)].map(q).join(";"));
  return "﻿" + lines.join("\r\n");
}
function csvReport() {
  const per = periodOf(ui.rep), rows = reportRows(per), afa = data().biz.vat === "afa27", b = data().biz;
  const lines = [[`Bevételi nyilvántartás – ${per.label}`].map(q).join(";"), [b.name, b.owner, "Adószám: " + (b.taxNo || "")].map(q).join(";"), ""];
  lines.push(["Sorszám", "Dátum", "Bizonylat", "Megnevezés", "Darab", "Vevő", "Fizetés módja", ...(afa ? ["Nettó (Ft)", "ÁFA (Ft)", "Bruttó (Ft)"] : ["Bevétel (Ft)"])].map(q).join(";"));
  rows.forEach((r) => lines.push([r.no, r.rd, r.invoiceNo, (r.product || r.type) + (r.part === "dep" ? " (előleg)" : r.part === "rest" ? " (hátralék)" : ""), r.qty, r.customer, r.payMethod, ...(afa ? [r.net, r.vat, r.gross] : [r.net])].map(q).join(";")));
  lines.push(["Összesen", "", "", "", "", "", "", ...(afa ? [sum(rows, "net"), sum(rows, "vat"), sum(rows, "gross")] : [sum(rows, "net")])].map(q).join(";"));
  return "﻿" + lines.join("\r\n");
}
function exportJson() {
  const d = data();
  return JSON.stringify({ app: "sm-home-dekor", version: 2, exported: new Date().toISOString(), settings: d.settings, business: d.biz, orders: d.orders, expenses: d.expenses, docs: d.docs, stock: d.stock, products: d.products }, null, 1);
}
function importData(obj, quietToast) {
  const os = (obj && obj.orders) || {}, es = (obj && obj.expenses) || {};
  const no = Object.keys(os).length, ne = Object.keys(es).length;
  if (!no && !ne && !(obj && (obj.settings || obj.business))) { toast("Ez a fájl nem SM home dekor mentés."); return; }
  for (const [k, v] of Object.entries(os)) setRec(k, "order", normOrder(v), { quiet: true });
  for (const [k, v] of Object.entries(es)) setRec(k, "expense", v, { quiet: true });
  if (obj.settings) setRec("settings", "settings", mergeDef(obj.settings), { quiet: true });
  if (obj.business) setRec("business", "business", Object.assign(clone(BIZ_DEF), obj.business), { quiet: true });
  if (obj.docs) for (const [k, v] of Object.entries(obj.docs)) if (!store.recs[k]) setRec(k, "doc", v, { quiet: true });
  if (obj.stock) for (const [k, v] of Object.entries(obj.stock)) if (k.startsWith("stk-")) setRec(k, "settings", v, { quiet: true });
  if (obj.products) for (const [k, v] of Object.entries(obj.products)) if (k.startsWith("prd-")) setRec(k, "settings", v, { quiet: true });
  render(true); if (!quietToast) toast(`Visszatöltve: ${no} rendelés, ${ne} kiadás`);
}
document.getElementById("importFile").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = () => { try { importData(JSON.parse(r.result)); } catch (x) { toast("A fájl nem olvasható. Egy korábbi JSON mentést válassz."); } e.target.value = ""; }; r.readAsText(f);
});
function sampleData() {
  const items = [["Bohém falikárpit 60 cm", "Falikárpit", 1, 4200, 18900, 5.5, "Instagram"], ["Növénytartó duó", "Növénytartó", 2, 1800, 9800, 2, "Facebook"], ["Kulcstartó szett", "Kulcstartó", 5, 900, 6000, 1.5, "Vásár"], ["Natúr lámpabúra", "Lámpabúra", 1, 3500, 16500, 4, "Webshop"], ["Kerek tükörkeret 40 cm", "Tükörkeret", 1, 2900, 14900, 3.5, "Instagram"], ["Egyedi esküvői dekor", "Egyedi rendelés", 1, 5200, 26000, 7, "Személyes"]];
  const o = {}, e = {}, now = new Date(); let inv = 1;
  for (let k = 2; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1), ym = d.getFullYear() + "-" + pad(d.getMonth() + 1);
    [3, 7, 12, 18, 24].forEach((day, j) => {
      const ds = ym + "-" + pad(day); if (ds > TODAY) return; const it = items[(j + k) % items.length];
      const done = k > 0 ? j !== 4 : j === 0, status = done ? "Teljesítve" : (j % 2 ? "Elkészült" : "Megrendelve");
      o["minta-r-" + ym + "-" + j] = { date: ds, deadline: shiftDay(ds, 6 + j), product: it[0], type: it[1], qty: it[2], cost: it[3], price: it[4], hours: it[5], channel: it[6], customer: ["Kiss Anna", "Nagy Eszter", "", "Tóth Réka", ""][j], status, paid: done, note: "", invoiceNo: done ? "MINTA-" + String(inv++).padStart(3, "0") : "", payMethod: done ? PAY[j % 3] : "", payDate: done ? ds : "", photo: null, created: Date.now() + j, sample: true };
    });
    [["Könyvelő", 15000, "havi díj", 5], ["Fonal", 12500, "pamutzsinór 5 mm", 2], ["Energia", 6000, "áram, műhely", 10], ["Csomagolás", 3200, "dobozok, selyempapír", 15]].forEach((x, j) => { const ds = ym + "-" + pad(x[3]); if (ds > TODAY) return; e["minta-k-" + ym + "-" + j] = { date: ds, cat: x[0], amount: x[1], note: x[2], docNo: "", created: Date.now(), sample: true }; });
  }
  return { orders: o, expenses: e };
}

/* ---------- Események ---------- */
const A = {
  tab: (b) => { ui.tab = b.dataset.t; uiConfirm = null; saveUi(); render(true); window.scrollTo(0, 0); },
  month: (b) => { ui.month = shiftMonth(ui.month, +b.dataset.k); ui.year = +ui.month.slice(0, 4); ui.day = ymOf(TODAY) === ui.month ? TODAY : ui.month + "-01"; render(true); },
  pickDay: (b) => { ui.day = b.dataset.d; render(true); const t = document.querySelector(".page-title"); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); },
  calBy: (b) => { ui.calBy = b.dataset.v; render(true); },
  viewPhoto: (b) => showPhoto(b.dataset.src || (b.querySelector("img") || {}).src),
  closeViewer: () => { document.getElementById("viewer").hidden = true; },
  pickPhoto: () => document.getElementById("photoFile").click(),
  removePhoto: () => { if (sheet) { sheet.data.photo = null; drawSheet(); } },
  year: (b) => { ui.year += +b.dataset.k; ui.month = ui.year + ui.month.slice(4); render(true); },
  pickMonth: (b) => { ui.month = b.dataset.m; render(true); window.scrollTo({ top: 0, behavior: "smooth" }); },
  day: (b) => { ui.day = shiftDay(ui.day, +b.dataset.k); ui.month = ymOf(ui.day); render(true); },
  goDay: (b) => { ui.day = b.dataset.d; ui.month = ymOf(ui.day); ui.year = +ui.day.slice(0, 4); ui.tab = "log"; saveUi(); render(true); window.scrollTo(0, 0); },
  newOrder: () => {
    if (modal) { modal = null; drawModal(); }
    const date = ui.tab === "log" ? ui.day : TODAY;
    if (sheet && sheet.inline) stashDraft();
    if (!draftNew || (!draftNew.data.product && !draftNew.data.type)) draftNew = newDraft(date); else draftNew.data.date = date;
    ui.tab = "new"; saveUi(); render(true); window.scrollTo(0, 0);
  },
  pickType: (b) => { if (!sheet) return; sheet.data.type = sheet.data.type === b.dataset.v ? "" : b.dataset.v; if (sheet.data.type) applyType(); drawSheet(); },
  resetDraft: () => { if (!sheet || !sheet.inline) return; dropPhotos(sheet.uploads); sheet = newDraft(); drawSheet(); },
  goalAdd: () => { const inp = document.getElementById("goalNew"), v = (inp.value || "").trim(); if (!v) return; const m = clone(data().motiv); m.goals.push({ t: v, done: false }); saveMotiv(m); },
  goalToggle: (b) => { const m = clone(data().motiv); const g = m.goals[+b.dataset.i]; if (g) { g.done = !g.done; saveMotiv(m); if (g.done) haptic("save"); } },
  goalDel: (b) => { const m = clone(data().motiv); m.goals.splice(+b.dataset.i, 1); saveMotiv(m); },
  noteAdd: () => { const inp = document.getElementById("noteNew"), v = (inp.value || "").trim(); if (!v) return; const m = clone(data().motiv); m.notes.unshift({ d: TODAY, t: v }); saveMotiv(m); haptic("save"); },
  noteDel: (b) => { const m = clone(data().motiv); m.notes.splice(+b.dataset.i, 1); saveMotiv(m); },
  penColor: (b) => { board.color = b.dataset.c; board.eraser = false; render(true); },
  penSize: (b) => { board.size = +b.dataset.s; render(true); },
  penEraser: () => { board.eraser = !board.eraser; render(true); },
  drawUndo: () => { const im = board.undo.pop(); if (im && board.ctx) board.ctx.putImageData(im, 0, 0); },
  drawClear: () => { if (!board.ctx) return; pushUndo(); paper(); toast("Tiszta lap", "Visszavonás", () => A.drawUndo()); },
  drawSave: () => saveDrawing(),
  drawDownload: () => downloadDrawing(),
  artOpen: (b) => openArt(b.dataset.id),
  artDel: (b) => { const a = data().art[b.dataset.id]; if (!a) return; delRec(b.dataset.id); toast("Rajz törölve", "Visszavonás", () => setRec(b.dataset.id, "settings", a)); setTimeout(() => { if (!data().art[b.dataset.id] && a.path) dropPhotos([a.path]); }, 7000); },
  editOrder: (b) => openOrder(b.dataset.id),
  newExp: () => openExp(),
  editExp: (b) => openExp(b.dataset.id),
  closeSheet: () => closeSheet(),
  closeSheetBg: (b, e) => { if (e.target === b) closeSheet(); },
  askDel: () => { sheetConfirm = true; drawSheet(); },
  sheetDel: () => { const id = sheet.id; if (sheet.kind === "order") dropPhotos([...sheet.uploads, sheet.origPhoto]); sheet = null; drawSheet(); delRec(id); toast("Törölve"); },
  delOrder: (b) => {
    const id = b.dataset.id, o = data().orders[id]; if (!o) return;
    const raw = clone(store.recs[id].data); delRec(id);
    let undone = false;
    toast(`„${o.product || o.type || "Rendelés"}” törölve`, "Visszavonás", () => { undone = true; setRec(id, "order", raw); haptic("tap"); });
    setTimeout(() => { if (!undone && o.photo && o.photo.path) dropPhotos([o.photo.path]); }, 7000);
  },
  newStock: () => openStock(),
  editStock: (b) => openStock(b.dataset.id),
  stockF: (b) => { ui.stockF = b.dataset.v; render(true); },
  stockStep: (b) => { const x = clone(data().stock[b.dataset.id]); if (!x) return; x.qty = Math.max(0, Math.round((num(x.qty) + +b.dataset.k) * 100) / 100); setRec(b.dataset.id, "settings", x); },
  fxToggle: (b) => { const p = fxPrefs(); p[b.dataset.k] = !p[b.dataset.k]; try { localStorage.setItem("smhd-fx", JSON.stringify(p)); } catch (e) {} render(true); },
  addFixed: () => {
    const s = data().settings, m = stats(ui.month), day = ymOf(TODAY) === ui.month ? TODAY : ui.month + "-01";
    s.fixed.filter((f) => !m.es.some((e) => e.fixedId === f.id)).forEach((f) => setRec(uid("k"), "expense", { date: day, cat: f.cat, amount: num(f.amount), note: f.note || "havi fix", docNo: "", fixedId: f.id, created: Date.now() }, { quiet: true }));
    render(true); toast("Fix költségek felvéve");
  },
  chipAdd: (b) => { const k = b.dataset.list, inp = document.getElementById("chip-" + k), v = (inp.value || "").trim(); if (!v) return; const s = clone(data().settings); if (!s[k].includes(v)) s[k].push(v); saveSettings(s); render(true); },
  chipDel: (b) => { const s = clone(data().settings); s[b.dataset.list].splice(+b.dataset.i, 1); saveSettings(s); render(true); },
  typeAdd: () => { const s = clone(data().settings); s.types.push({ name: "Új termék", price: 0, cost: 0, hours: 0 }); saveSettings(s); render(true); },
  typeDel: (b) => { const s = clone(data().settings); s.types.splice(+b.dataset.i, 1); saveSettings(s); render(true); },
  fixedAdd: () => { const s = clone(data().settings); s.fixed.push({ id: uid("f"), cat: s.expCats[0] || "Könyvelő", amount: 0, note: "" }); saveSettings(s); render(true); },
  fixedDel: (b) => { const s = clone(data().settings); s.fixed.splice(+b.dataset.i, 1); saveSettings(s); render(true); },
  repSet: (b) => { ui.rep.kind = b.dataset.kind; ui.rep.n = +b.dataset.n; render(true); },
  repYear: (b) => { ui.rep.year += +b.dataset.k; render(true); },
  print: () => window.print(),
  repCsv: () => downloadFile(`sm-home-dekor-bevetel-${periodOf(ui.rep).file}.csv`, csvReport(), "text/csv;charset=utf-8"),
  exportJson: () => downloadFile(`sm-home-dekor-mentes-${TODAY}.json`, exportJson(), "application/json"),
  exportCsv: () => downloadFile(`sm-home-dekor-${ui.month}.csv`, csvMonth(), "text/csv;charset=utf-8"),
  importJson: () => document.getElementById("importFile").click(),
  sample: () => { importData(sampleData(), true); ui.tab = "home"; saveUi(); render(true); toast("Mintaadatok betöltve"); },
  clearSample: () => { let n = 0; for (const [id, r] of Object.entries(store.recs)) if (r && !r.deleted && r.data && r.data.sample) { delRec(id, { quiet: true }); n++; } render(true); toast(`${n} mintatétel törölve`); },
  askWipe: () => { uiConfirm = "wipe"; render(true); },
  askLogout: () => { uiConfirm = "logout"; render(true); },
  askDelDoc: (b) => { uiConfirm = "doc:" + b.dataset.id; render(true); },
  cancelConfirm: () => { uiConfirm = null; render(true); },
  wipe: () => { uiConfirm = null; for (const [id, r] of Object.entries(store.recs)) if (r && !r.deleted && (r.kind === "order" || r.kind === "expense")) delRec(id, { quiet: true }); render(true); toast("Minden rendelés és kiadás törölve"); },
  logout: async () => { uiConfirm = null; try { await sb.auth.signOut(); } catch (e) {} store.uid = null; resetStore(); sync.firstDone = false; ui.tab = "home"; render(true); },
  syncNow: () => { if (CLOUD && store.uid) { syncNow(); toast("Szinkronizálás…"); } },
  pwOpen: () => { ui.pwOpen = !ui.pwOpen; render(true); if (ui.pwOpen) { const el = document.getElementById("pw-old"); if (el) el.focus(); } },
  authMode: (b) => { ui.auth = b.dataset.m; auth.msg = ""; render(true); },
  install: async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; render(true); },
  copyLink: async () => { try { await navigator.clipboard.writeText(location.origin + "/"); toast("Link másolva"); } catch (e) { toast("Jelöld ki és másold a linket kézzel."); } },
  pickDoc: () => document.getElementById("docFile").click(),
  openDoc: (b) => openDoc(b.dataset.id),
  delDoc: (b) => deleteDoc(b.dataset.id),
  ...PA
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]"); if (!b) return;
  const f = A[b.dataset.action]; if (!f) return;
  const act = b.dataset.action;
  if (act === "delOrder" || act === "sheetDel") haptic("del");
  else if (!["closeSheetBg", "closeModalBg", "closeViewer", "fxToggle"].includes(act) || (/Bg$/.test(act) && e.target === b)) haptic("tap");
  if (b.dataset.action !== "closeSheetBg" && b.dataset.action !== "closeModalBg") e.preventDefault();
  f(b, e);
});
document.getElementById("fab").addEventListener("click", () => { haptic("tap"); if (ui.tab === "exp") openExp(); else if (ui.tab === "stock") openStock(); else if (ui.tab === "prod") openModal({ kind: "choose", prodOnly: true }); else A.newOrder(); });
document.addEventListener("submit", (e) => { e.preventDefault(); if (e.target.id === "modalForm") submitModal(); else if (e.target.id === "sheetForm") submitSheet(); else if (e.target.id === "authForm") authSubmit(); else if (e.target.id === "pwForm") changePassword(); });
document.addEventListener("change", (e) => { if (e.target.id === "pw-show") ["pw-old", "pw-new", "pw-new2"].forEach((i) => { const el = document.getElementById(i); if (el) el.type = e.target.checked ? "text" : "password"; }); });
async function changePassword() {
  const v = (i) => (document.getElementById(i) || {}).value || "", msg = document.getElementById("pwMsg"), btn = document.querySelector("#pwForm button[type=submit]");
  const say = (t, ok) => { msg.textContent = t; msg.hidden = false; msg.style.color = ok ? "var(--sage)" : "var(--danger)"; };
  const oldPw = v("pw-old"), p1 = v("pw-new"), p2 = v("pw-new2");
  if (!sb || !store.uid) return say("Ehhez be kell lépni.");
  if (!online()) return say("A jelszócseréhez internetkapcsolat kell.");
  if (!oldPw) return say("Add meg a jelenlegi jelszót.");
  if (p1.length < 8) return say("Az új jelszó legyen legalább 8 karakter.");
  if (p1 !== p2) return say("A két új jelszó nem egyezik.");
  if (p1 === oldPw) return say("Az új jelszó legyen más, mint a mostani.");
  btn.disabled = true; say("Ellenőrzés…", true);
  try {
    const chk = await sb.auth.signInWithPassword({ email: auth.email, password: oldPw });
    if (chk.error) { btn.disabled = false; return say("A jelenlegi jelszó nem helyes."); }
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) { btn.disabled = false; return say(/weak|short|least/i.test(error.message) ? "Ez a jelszó túl gyenge, válassz hosszabbat." : /same|different/i.test(error.message) ? "Az új jelszó legyen más, mint a mostani." : "Nem sikerült menteni: " + error.message); }
    ui.pwOpen = false; render(true); haptic("save"); toast("Új jelszó elmentve. Legközelebb ezzel lépj be.");
  } catch (x) { btn.disabled = false; say("Nincs kapcsolat a szerverrel. Próbáld újra."); }
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { const v = document.getElementById("viewer"); if (!v.hidden) v.hidden = true; else if (modal) closeModal(); else if (sheet && !sheet.inline) closeSheet(); }
  if (e.key === "Enter" && e.target.id && e.target.id.startsWith("chip-")) { e.preventDefault(); const b = document.querySelector(`[data-action="chipAdd"][data-list="${e.target.id.slice(5)}"]`); if (b) A.chipAdd(b); }
});
let bizT = null, bizDraft = null, motT = null, motDraft = null;
document.addEventListener("toggle", (e) => { if (e.target.classList && e.target.classList.contains("more") && sheet) sheet.moreOpen = e.target.open; }, true);
document.addEventListener("change", (e) => { if (e.target.dataset && e.target.dataset.fx === "vol") haptic("tap"); });
function saveMotiv(m, quiet) { motDraft = null; clearTimeout(motT); setRec("motivation", "settings", m, { quiet }); }
document.addEventListener("input", (e) => {
  const t = e.target;
  if (modalInput(t)) return;
  if (t.dataset.f && sheet) {
    sheet.data[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value;
    const fe = document.getElementById("formErr"); if (fe) fe.hidden = true;
    if (t.dataset.f === "paid" && t.checked && !sheet.data.payDate) setField("payDate", TODAY);
    if (t.dataset.f === "depositPaid") { if (t.checked && !sheet.data.depositDate) sheet.data.depositDate = TODAY; drawSheet(); const el = document.getElementById("f-deposit"); if (el) el.focus(); return; }
    if (t.dataset.f === "type" || (t.dataset.f === "qty" && sheet.data.type && !sheet.id)) applyType();
    updPreview(); return;
  }
  if (t.id === "dayInput") { if (t.value) { ui.day = t.value; ui.month = ymOf(ui.day); ui.year = +ui.day.slice(0, 4); t.blur(); render(true); } return; }
  if (t.dataset.s !== undefined) {
    const s = clone(data().settings), path = t.dataset.s.split("."); let o = s;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
    o[path[path.length - 1]] = t.type === "checkbox" ? t.checked : ("num" in t.dataset ? num(t.value) : t.value);
    saveSettings(s, true); return;
  }
  if (t.dataset.fx === "vol") { const p = fxPrefs(); p.vol = +t.value; try { localStorage.setItem("smhd-fx", JSON.stringify(p)); } catch (x) {} const l = document.getElementById("volLbl"); if (l) l.textContent = t.value + "%"; return; }
  if (t.dataset.mo !== undefined) {
    motDraft = motDraft || clone(data().motiv); motDraft[t.dataset.mo] = t.value;
    clearTimeout(motT); motT = setTimeout(() => { const v = motDraft; motDraft = null; setRec("motivation", "settings", v, { quiet: true }); }, 500);
    return;
  }
  if (t.dataset.b !== undefined) {
    bizDraft = bizDraft || clone(data().biz); bizDraft[t.dataset.b] = t.value;
    clearTimeout(bizT); bizT = setTimeout(() => { const v = bizDraft; bizDraft = null; setRec("business", "business", v, { quiet: true }); }, 400);
  }
});
let toastT = null;
function toast(m, actionLabel, fn) {
  const el = document.getElementById("toast"); el.textContent = m; el.hidden = false; el.classList.toggle("has-act", !!actionLabel);
  if (actionLabel) { const btn = document.createElement("button"); btn.type = "button"; btn.textContent = actionLabel; btn.onclick = (e) => { e.stopPropagation(); el.hidden = true; fn(); }; el.appendChild(btn); }
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, actionLabel ? 6000 : 2800);
}

/* ---------- Visszajelzés: rezgés és halk „fagyöngy a zsinóron” hang ---------- */
function fxPrefs() { try { return Object.assign({ vib: true, snd: true, vol: 60 }, JSON.parse(localStorage.getItem("smhd-fx") || "{}")); } catch (e) { return { vib: true, snd: true, vol: 60 }; } }
let audio = null;
function haptic(kind) {
  const p = fxPrefs();
  if (p.vib && navigator.vibrate) { try { navigator.vibrate(kind === "save" ? [10, 50, 14] : kind === "del" ? 22 : 8); } catch (e) {} }
  if (p.snd && p.vol > 0) bead(kind, p.vol / 60);
}
function bead(kind, k) {
  k = k || 1;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const c = audio; if (c.state === "suspended") c.resume();
    const t = c.currentTime;
    const tone = (f, at, vol) => {
      const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 1600; o.type = "triangle";
      o.frequency.setValueAtTime(f, t + at); o.frequency.exponentialRampToValueAtTime(f * 0.86, t + at + 0.14);
      g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * k), t + at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.18);
      o.connect(lp); lp.connect(g); g.connect(c.destination); o.start(t + at); o.stop(t + at + 0.2);
    };
    const cord = (at, vol, dur) => {
      const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
      bp.type = "bandpass"; bp.frequency.value = 2200; bp.Q.value = 0.7; g.gain.value = vol * k;
      src.buffer = buf; src.connect(bp); bp.connect(g); g.connect(c.destination); src.start(t + at);
    };
    if (kind === "save") { cord(0, 0.05, 0.06); tone(587, 0.01, 0.05); tone(784, 0.11, 0.045); }
    else if (kind === "del") { cord(0, 0.06, 0.09); tone(392, 0.01, 0.05); }
    else { cord(0, 0.035, 0.04); tone(698, 0, 0.035); }
  } catch (e) { /* hang nélkül megy tovább */ }
}

/* ---------- Indítás ---------- */
render();
if (CLOUD) initCloud();
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
})();
