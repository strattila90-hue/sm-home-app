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
function mergeDef(s) { const o = Object.assign(clone(DEF), s || {}); ["types", "expCats", "channels", "fixed"].forEach((k) => { if (!Array.isArray(o[k])) o[k] = clone(DEF[k]); }); return o; }
function normOrder(o) { o = Object.assign({}, o); if (o.status === "Átadva") o.status = "Teljesítve"; if (!STATUSES.includes(o.status)) o.status = STATUSES[0]; return o; }

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
try { const u = JSON.parse(localStorage.getItem(LS_UI) || "null"); if (u && ["home", "log", "exp", "nav", "biz", "set"].includes(u.tab)) ui.tab = u.tab; } catch (e) {}
function saveUi() { try { localStorage.setItem(LS_UI, JSON.stringify({ tab: ui.tab })); } catch (e) {} }

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
async function syncNow() { await flush(); await pull(); if (!sync.firstDone) { sync.firstDone = true; render(); } }

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
  const orders = {}, expenses = {}, docs = {}; let settings = null, biz = null;
  for (const [id, r] of Object.entries(store.recs)) {
    if (!r || r.deleted) continue;
    if (r.kind === "order") orders[id] = normOrder(r.data);
    else if (r.kind === "expense") expenses[id] = r.data;
    else if (r.kind === "doc") docs[id] = r.data;
    else if (r.kind === "settings") settings = r.data;
    else if (r.kind === "business") biz = r.data;
  }
  D = { orders, expenses, docs, settings: mergeDef(settings), biz: Object.assign(clone(BIZ_DEF), biz || {}) };
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
  log: sv('<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  exp: sv('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  nav: sv('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
  biz: sv('<path d="M4 9h16v11H4z"/><path d="M9 9V5h6v4M4 14h16"/>'),
  x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  file: sv('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>')
};
const TABS = [["home", "Áttekintés"], ["log", "Napló"], ["exp", "Kiadások"], ["nav", "NAV"], ["biz", "Vállalkozás"]];

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
  fab.hidden = needAuth || loading || !["home", "log", "exp"].includes(ui.tab);
  fab.setAttribute("aria-label", ui.tab === "exp" ? "Új kiadás" : "Új rendelés");
  if (loading) { main.innerHTML = '<div class="card empty"><h3>Betöltés…</h3><p>Egy pillanat, előkészítem a naplót.</p></div>'; return; }
  if (needAuth) { main.innerHTML = vAuth(); return; }
  document.getElementById("tabs").innerHTML = TABS.map(([k, l]) => `<button type="button" data-action="tab" data-t="${k}" ${ui.tab === k ? 'aria-current="page"' : ""}>${I[k]}<span>${l}</span></button>`).join("");
  const y = window.scrollY;
  if (CLOUD && !sync.firstDone && !hasAny() && online() && sb) { main.innerHTML = '<div class="card empty"><h3>Adatok letöltése…</h3><p>Szinkronizálom a felhőből a rendeléseket és kiadásokat.</p></div>'; return; }
  main.innerHTML = ({ home: vHome, log: vLog, exp: vExp, nav: vNav, biz: vBiz, set: vSet }[ui.tab])();
  window.scrollTo(0, y);
  if (ui.tab === "biz") loadThumbs();
  if (ui.tab === "set") drawQr();
}
document.addEventListener("focusout", () => { setTimeout(() => { if (pending) render(); }, 0); });

function monthNav() { return `<div class="navrow"><button type="button" class="iconbtn" data-action="month" data-k="-1" aria-label="Előző hónap">${I.prev}</button><h2 class="cap">${esc(monthLabel(ui.month))}</h2><button type="button" class="iconbtn" data-action="month" data-k="1" aria-label="Következő hónap">${I.next}</button></div>`; }
const kpi = (k, v, h) => `<div class="kpi"><div class="k">${k}</div><div class="v num">${v}</div>${h ? `<div class="h">${h}</div>` : ""}</div>`;
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
    </div></form>`;
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
      if (error) return fail(error.message.includes("registered") ? "Ezzel az e-mail címmel már van fiók. Lépj be." : "A regisztráció nem sikerült: " + error.message);
      if (!d.session) { ui.auth = "login"; return ok("Küldtünk egy megerősítő e-mailt. Kattints a benne lévő linkre, utána lépj be."); }
      auth.busy = false;
    } else if (ui.auth === "reset") {
      const { error } = await sb.auth.resetPasswordForEmail(auth.lastEmail, { redirectTo: location.origin });
      if (error) return fail("Nem sikerült elküldeni: " + error.message);
      ui.auth = "login"; return ok("Elküldtük a jelszó-visszaállító linket az e-mail címedre.");
    } else if (ui.auth === "newpass") {
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) return fail("Nem sikerült menteni: " + error.message);
      ui.recovery = false; ui.auth = "login"; auth.busy = false; toast("Új jelszó elmentve");
    }
  } catch (e) { return fail("Nincs kapcsolat a szerverrel. Próbáld újra."); }
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
  <div class="kpis">
   ${kpi("Bevétel", huf(m.rev), m.n + " rendelés")}
   ${kpi("Anyagköltség", huf(m.mat), s.deductMaterial ? "levonva" : "nincs levonva")}
   ${kpi("Egyéb kiadás", huf(m.exp), m.es.length + " tétel")}
   ${kpi("Darabszám", m.qty + " db", m.n ? "átl. " + huf(m.rev / m.n) + "/rendelés" : "")}
   ${kpi("Munkaóra", hrs(m.h), "")}
   ${kpi("Órabér", m.hourly == null ? "–" : huf(m.hourly), "anyag levonása után")}
  </div>
  ${num(s.taxPct) > 0 ? `<div class="card"><div class="rows"><div class="row"><span>Adó- és járuléktartalék (${num(s.taxPct)}%)</span><b class="num">${huf(m.tax)}</b></div><div class="row"><span>Ami ténylegesen marad</span><b class="num">${huf(m.net)}</b></div></div></div>` : ""}`;
  const today = stats(TODAY), open = Object.values(data().orders).filter((o) => o.status !== "Teljesítve").length;
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
function orderCard(o) {
  const p = num(o.price) - num(o.cost), si = Math.max(0, STATUSES.indexOf(o.status));
  return `<button type="button" class="order" data-action="editOrder" data-id="${esc(o.id)}">
   <span class="name">${esc(o.product || o.type || "Rendelés")}</span><span class="price num">${huf(o.price)}</span>
   <span class="meta">${o.type ? `<span class="chip-type">${esc(o.type)}</span>` : ""}<span class="pill s${si}">${esc(STATUSES[si])}</span><span class="num">${num(o.qty) || 1} db · ${hrs(o.hours)}</span>${o.customer ? `<span>· ${esc(o.customer)}</span>` : ""}${o.invoiceNo ? `<span>· ${esc(o.invoiceNo)}</span>` : ""}${o.sample ? "<span>· minta</span>" : ""}</span>
   <span class="profit num ${p < 0 ? "neg" : ""}">${p >= 0 ? "+" : ""}${huf(p)}</span></button>`;
}
function vLog() {
  const d = stats(ui.day), os = d.os.sort((a, b) => (a.created || 0) - (b.created || 0));
  let h = `<div class="navrow"><button type="button" class="iconbtn" data-action="day" data-k="-1" aria-label="Előző nap">${I.prev}</button>
   <label class="daypick"><span class="lbl">${esc(dayLabel(ui.day))}<small>${esc(weekday(ui.day))}${ui.day === TODAY ? " · ma" : ""}</small></span><input type="date" id="dayInput" value="${ui.day}" aria-label="Nap kiválasztása"></label>
   <button type="button" class="iconbtn" data-action="day" data-k="1" aria-label="Következő nap">${I.next}</button></div>`;
  if (!hasAny()) return h + emptyCard();
  h += `<div class="stack"><div class="kpis">${kpi("Rendelés", d.n + " db", d.qty + " darab termék")}${kpi("Bevétel", huf(d.rev), "")}${kpi("Haszon", huf(d.rev - d.mat), hrs(d.h) + " munka")}</div>`;
  h += os.length ? `<div class="stack" style="gap:10px">${os.map(orderCard).join("")}</div>` : `<div class="card empty" style="padding:18px"><p>Ezen a napon még nincs rendelés.</p></div>`;
  h += `<div class="btns"><button type="button" class="btn primary" data-action="newOrder">Rendelés erre a napra</button>${ui.day !== TODAY ? `<button type="button" class="btn" data-action="goDay" data-d="${TODAY}">Ugrás a mai napra</button>` : ""}</div>`;
  const ym = ymOf(ui.day), ms = stats(ym), days = {};
  ms.os.forEach((o) => { const x = days[o.date] || (days[o.date] = { n: 0, rev: 0, pr: 0 }); x.n++; x.rev += num(o.price); x.pr += num(o.price) - num(o.cost); });
  const de = Object.entries(days).sort((a, b) => b[0].localeCompare(a[0]));
  h += `<div class="card"><div class="section-title">${esc(monthLabel(ym))} napjai</div>${de.length ? `<div class="rows">${de.map(([k, x]) => `<div class="row tap" data-action="goDay" data-d="${k}"><div class="l"><b>${esc(dayLabel(k))}</b> <span class="t">${esc(weekday(k))}</span><div class="t num">${x.n} rendelés</div></div><div class="r"><b class="num">${huf(x.rev)}</b><div class="t num">haszon ${huf(x.pr)}</div></div></div>`).join("")}</div>
   <div class="row" style="border-top:1px solid var(--line);margin-top:6px"><b>Hónap összesen</b><b class="num">${huf(ms.rev)}</b></div>` : '<p class="note" style="margin:0">Ebben a hónapban még nincs rendelés.</p>'}</div></div>`;
  return h;
}

/* Kiadások */
function vExp() {
  const m = stats(ui.month), s = data().settings;
  let h = monthNav() + '<div class="stack">';
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

/* NAV bevételi kimutatás */
function periodOf(p) {
  const Y = p.year;
  if (p.kind === "y") return { from: Y + "-01-01", to: Y + "-12-31", label: Y + ". év", file: String(Y) };
  if (p.kind === "q") { const a = (p.n - 1) * 3 + 1, b = a + 2; return { from: `${Y}-${pad(a)}-01`, to: `${Y}-${pad(b)}-31`, label: `${Y}. ${ROMAN[p.n - 1]} negyedév`, file: `${Y}-Q${p.n}` }; }
  return { from: `${Y}-${pad(p.n)}-01`, to: `${Y}-${pad(p.n)}-31`, label: monthLabel(`${Y}-${pad(p.n)}`), file: `${Y}-${pad(p.n)}` };
}
function reportRows(per) {
  const biz = data().biz, afa = biz.vat === "afa27";
  const rows = Object.entries(data().orders).map(([id, o]) => Object.assign({ id }, o))
    .filter((o) => o.status === "Teljesítve").map((o) => Object.assign(o, { rd: o.payDate || o.date }))
    .filter((o) => o.rd >= per.from && o.rd <= per.to)
    .sort((a, b) => a.rd.localeCompare(b.rd) || (a.created || 0) - (b.created || 0));
  rows.forEach((o, i) => { o.no = i + 1; o.gross = num(o.price); o.net = afa ? Math.round(o.gross / 1.27) : o.gross; o.vat = o.gross - o.net; });
  return rows;
}
function vNav() {
  const p = ui.rep, per = periodOf(p), biz = data().biz, afa = biz.vat === "afa27", rows = reportRows(per);
  const tot = { gross: sum(rows, "gross"), net: sum(rows, "net"), vat: sum(rows, "vat") };
  const missing = rows.filter((r) => !r.invoiceNo).length;
  const openN = Object.values(data().orders).filter((o) => o.status !== "Teljesítve" && o.date >= per.from && o.date <= per.to).length;
  const ytd = reportRows(periodOf({ year: p.year, kind: "y" })), ytdSum = sum(ytd, "net");
  const segBtn = (kind, n, label) => `<button type="button" data-action="repSet" data-kind="${kind}" data-n="${n}" aria-pressed="${p.kind === kind && (kind === "y" || p.n === n)}">${label}</button>`;
  const months = {}; rows.forEach((r) => { const k = r.rd.slice(0, 7); months[k] = (months[k] || 0) + r.net; });
  const bizOk = biz.owner && biz.taxNo;
  let h = `<div class="noprint"><h2 class="page-title">NAV bevételi kimutatás</h2><p class="note" style="margin:0 0 10px">Időrendi bevételi nyilvántartás a lezárt, „Teljesítve” állapotú rendelésekből, a kifizetés napja szerint.</p>
   <div class="navrow" style="margin-top:6px"><button type="button" class="iconbtn" data-action="repYear" data-k="-1" aria-label="Előző év">${I.prev}</button><h2>${p.year}</h2><button type="button" class="iconbtn" data-action="repYear" data-k="1" aria-label="Következő év">${I.next}</button></div>
   <div class="stack" style="gap:8px"><div class="seg">${segBtn("y", 0, "Egész év")}${[1, 2, 3, 4].map((n) => segBtn("q", n, ROMAN[n - 1] + " negyedév")).join("")}</div>
   <div class="seg">${MON.map((m, i) => segBtn("m", i + 1, m)).join("")}</div></div>
   <div class="stack" style="gap:8px;margin-top:12px">
    ${!bizOk ? `<div class="banner warn"><span>A fejlécbe kerülő vállalkozási adatok hiányosak (név, adószám).</span><button type="button" class="btn small" data-action="tab" data-t="biz">Kitöltés</button></div>` : ""}
    ${missing ? `<div class="banner warn"><span>${missing} tételnél hiányzik a számla / nyugta sorszáma.</span></div>` : ""}
    ${openN ? `<div class="banner"><span>${openN} rendelés még nincs lezárva ebben az időszakban, ezek nem szerepelnek a kimutatásban.</span></div>` : ""}
   </div>
   <div class="btns" style="margin-block:12px"><button type="button" class="btn primary" data-action="print">Nyomtatás / PDF</button><button type="button" class="btn" data-action="repCsv">CSV letöltése</button></div></div>`;
  h += `<article class="report" id="report">
   <div class="rep-head"><div class="rep-id"><b>${esc(biz.name || "SM home dekor")}</b><br>${esc(biz.owner || "—")} egyéni vállalkozó<br>${biz.address ? esc(biz.address) + "<br>" : ""}Adószám: ${esc(biz.taxNo || "—")}${biz.evNo ? ` · Nyilvántartási szám: ${esc(biz.evNo)}` : ""}<br>${esc(biz.taxMode)} · ${afa ? "ÁFA-körös (27%)" : "Alanyi adómentes (AAM)"}</div>
   <div class="rep-meta">Kiállítva:<br><b class="num" style="color:var(--ink)">${fullDate(TODAY)}</b></div></div>
   <h2>Bevételi nyilvántartás</h2><div class="note">${esc(per.label)} · ${fullDate(per.from)} – ${fullDate(per.to.replace(/-31$/, "-" + pad(new Date(+per.to.slice(0, 4), +per.to.slice(5, 7), 0).getDate())))}</div>
   <div class="rep-sum num"><div><small>Tételek</small><b>${rows.length} db</b></div><div><small>${afa ? "Nettó bevétel" : "Bevétel"}</small><b>${huf(tot.net)}</b></div><div><small>${p.kind === "y" ? "Éves összesen" : p.year + " eddig"}</small><b>${huf(ytdSum)}</b></div></div>
   ${rows.length ? `<div class="table-wrap"><table class="num"><thead><tr><th class="l">Ssz.</th><th class="l">Dátum</th><th class="l">Bizonylat</th><th class="l">Megnevezés</th><th class="l">Fiz. mód</th>${afa ? "<th>Nettó</th><th>ÁFA</th><th>Bruttó</th>" : "<th>Bevétel (Ft)</th>"}</tr></thead>
   <tbody>${rows.map((r) => `<tr><td class="l">${r.no}.</td><td class="l">${fullDate(r.rd)}</td><td class="l ${r.invoiceNo ? "" : "miss"}">${r.invoiceNo ? esc(r.invoiceNo) : "hiányzik"}</td><td class="l tw">${esc(r.product || r.type)}${num(r.qty) > 1 ? ` (${num(r.qty)} db)` : ""}${r.customer ? `<br><span class="note">${esc(r.customer)}</span>` : ""}</td><td class="l">${esc(r.payMethod || "—")}</td>${afa ? `<td>${huf(r.net)}</td><td>${huf(r.vat)}</td><td>${huf(r.gross)}</td>` : `<td>${huf(r.net)}</td>`}</tr>`).join("")}</tbody>
   <tfoot><tr><td class="l" colspan="5">Összesen</td>${afa ? `<td>${huf(tot.net)}</td><td>${huf(tot.vat)}</td><td>${huf(tot.gross)}</td>` : `<td>${huf(tot.net)}</td>`}</tr></tfoot></table></div>` : '<p class="note">Ebben az időszakban nincs lezárt rendelés.</p>'}
   ${p.kind !== "m" && Object.keys(months).length > 1 ? `<div class="section-title" style="margin-top:16px">Havi bontás</div><div class="table-wrap"><table class="num"><tbody>${Object.entries(months).sort().map(([k, v]) => `<tr><td class="l" style="text-transform:capitalize">${esc(monthLabel(k))}</td><td>${huf(v)}</td></tr>`).join("")}</tbody></table></div>` : ""}
   <div class="rep-foot"><span>A kimutatás a ténylegesen befolyt, lezárt rendeléseket tartalmazza időrendben${afa ? ", az ÁFA a bruttó összegből 27%-kal visszaszámolva" : ", áfa nélküli összegben"}.</span><span>Készült az SM home dekor Planner alkalmazással. A bevallást nem helyettesíti.</span></div>
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
    <div class="btns" style="margin-top:10px"><button type="button" class="btn" data-action="syncNow">Szinkronizálás most</button>
    ${uiConfirm === "logout" ? `<button type="button" class="btn danger solid" data-action="logout">Kijelentkezés${pend ? ` (${pend} nem mentett tétel elvész)` : ""}</button><button type="button" class="btn" data-action="cancelConfirm">Mégse</button>` : '<button type="button" class="btn danger" data-action="askLogout">Kijelentkezés</button>'}</div></div>`
  : `<div class="card"><div class="section-title">Mentés</div><p class="note" style="margin:0">Helyi mód: az adatok csak ezen a készüléken vannak. Felhős mentéshez töltsd ki a config.js fájlt (lásd README).</p></div>`}

  <div class="card"><div class="section-title">Telepítés telefonra</div><div class="stack" style="gap:12px">
   ${standalone ? '<p class="note" style="margin:0">Az app telepítve fut ezen a készüléken.</p>' : installEvt ? '<button type="button" class="btn primary" data-action="install">Telepítés erre a telefonra</button>' : `<p class="note" style="margin:0">${ios ? "iPhone: Safariban a Megosztás gomb, majd „Főképernyőhöz adás”." : "Android: Chrome menü (⋮), majd „Alkalmazás telepítése” vagy „Hozzáadás a kezdőképernyőhöz”."}</p>`}
   <p class="note" style="margin:0">Másik telefonra: olvasd be ezt a QR-kódot a kamerával.</p>
   <div class="qr" id="qrBox" aria-label="QR-kód az app címével"></div>
   <div class="copyline"><code>${esc(location.origin + "/")}</code><button type="button" class="btn small" data-action="copyLink">Másolás</button></div>
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
   <p class="note" style="margin:0">A visszatöltés a korábbi (Claude-os) verzió JSON mentését is elfogadja.</p>
   <div class="btns"><button type="button" class="btn" data-action="sample">Mintaadatok betöltése</button><button type="button" class="btn" data-action="clearSample">Mintaadatok törlése</button>
   ${uiConfirm === "wipe" ? '<button type="button" class="btn danger solid" data-action="wipe">Igen, minden rendelés és kiadás törlése</button><button type="button" class="btn" data-action="cancelConfirm">Mégse</button>' : '<button type="button" class="btn danger" data-action="askWipe">Minden adat törlése</button>'}</div>
  </div></div>
  <p class="note" style="text-align:center">SM home dekor Planner · 2.0</p>
  </div>`;
}

/* ---------- Lap (rendelés / kiadás) ---------- */
let sheet = null, sheetConfirm = false;
function openOrder(id) {
  const base = { date: ui.day, product: "", type: "", qty: 1, cost: "", price: "", hours: "", customer: "", channel: "", status: STATUSES[0], note: "", invoiceNo: "", payMethod: "", payDate: "" };
  sheet = { kind: "order", id: id || null, data: Object.assign(base, id ? clone(data().orders[id]) : {}) }; sheetConfirm = false; drawSheet();
}
function openExp(id) {
  const d0 = ymOf(TODAY) === ui.month ? TODAY : ui.month + "-01";
  sheet = { kind: "exp", id: id || null, data: Object.assign({ date: d0, cat: data().settings.expCats[0] || "Egyéb", amount: "", note: "", docNo: "" }, id ? clone(data().expenses[id]) : {}) }; sheetConfirm = false; drawSheet();
}
function drawSheet() {
  const box = document.getElementById("sheet");
  if (!sheet) { box.innerHTML = ""; document.body.style.overflow = ""; return; }
  document.body.style.overflow = "hidden";
  const d = sheet.data, s = data().settings;
  const opts = (arr, v, blank) => (blank ? `<option value="">${blank}</option>` : "") + [...new Set([...arr, ...(v && !arr.includes(v) ? [v] : [])])].map((c) => `<option ${c === v ? "selected" : ""}>${esc(c)}</option>`).join("");
  let body;
  if (sheet.kind === "order") {
    const names = [...new Set(Object.values(data().orders).map((o) => o.product).filter(Boolean))].slice(0, 80);
    body = `<div class="grid2"><div class="field"><label for="f-date">Rendelés dátuma</label><input class="in-ctl" type="date" id="f-date" data-f="date" value="${esc(d.date)}"></div>
     <div class="field"><label for="f-type">Típus</label><select class="in-ctl" id="f-type" data-f="type">${opts(s.types.map((t) => t.name), d.type, "Válassz…")}</select></div></div>
     <div class="field"><label for="f-product">Termék megnevezése</label><input class="in-ctl" id="f-product" data-f="product" list="dl-prod" value="${esc(d.product)}" placeholder="pl. Bohém falikárpit 60 cm"><datalist id="dl-prod">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist></div>
     <div class="grid3"><div class="field"><label for="f-qty">Darab</label><input class="in-ctl num" id="f-qty" inputmode="numeric" data-f="qty" value="${esc(d.qty)}"></div>
     <div class="field"><label for="f-cost">Nettó költség (Ft)</label><input class="in-ctl num" id="f-cost" inputmode="numeric" data-f="cost" value="${esc(d.cost)}" placeholder="anyag"></div>
     <div class="field"><label for="f-price">Eladási ár (Ft)</label><input class="in-ctl num" id="f-price" inputmode="numeric" data-f="price" value="${esc(d.price)}" placeholder="összesen"></div></div>
     <div class="grid2"><div class="field"><label for="f-hours">Munkaidő (óra)</label><input class="in-ctl num" id="f-hours" inputmode="decimal" data-f="hours" value="${esc(d.hours)}" placeholder="pl. 3,5"></div>
     <div class="field"><label for="f-channel">Csatorna</label><select class="in-ctl" id="f-channel" data-f="channel">${opts(s.channels, d.channel, "–")}</select></div></div>
     <div class="field"><label for="f-customer">Vevő (nem kötelező)</label><input class="in-ctl" id="f-customer" data-f="customer" value="${esc(d.customer)}"></div>
     <div class="field"><label for="f-note">Megjegyzés</label><textarea class="in-ctl" id="f-note" data-f="note" placeholder="szín, méret, határidő…">${esc(d.note)}</textarea></div>
     <div class="preview num" id="preview"></div>
     <fieldset class="fieldset"><legend>Lezárás és bizonylat</legend>
      <div class="grid2"><div class="field"><label for="f-status">Állapot</label><select class="in-ctl" id="f-status" data-f="status">${opts(STATUSES, d.status)}</select></div>
      <div class="field"><label for="f-payDate">Kifizetés napja</label><input class="in-ctl" type="date" id="f-payDate" data-f="payDate" value="${esc(d.payDate)}"></div>
      <div class="field"><label for="f-invoiceNo">Számla / nyugta sorszáma</label><input class="in-ctl" id="f-invoiceNo" data-f="invoiceNo" value="${esc(d.invoiceNo)}" placeholder="pl. SMHD-2026-014"></div>
      <div class="field"><label for="f-payMethod">Fizetés módja</label><select class="in-ctl" id="f-payMethod" data-f="payMethod">${opts(PAY, d.payMethod, "–")}</select></div></div>
      <p class="note" style="margin:0">A „Teljesítve” állapotú rendelések kerülnek a NAV kimutatásba, a kifizetés napja szerint.</p>
     </fieldset>`;
  } else {
    body = `<div class="grid2"><div class="field"><label for="f-date">Dátum</label><input class="in-ctl" type="date" id="f-date" data-f="date" value="${esc(d.date)}"></div>
     <div class="field"><label for="f-cat">Kategória</label><select class="in-ctl" id="f-cat" data-f="cat">${opts(s.expCats, d.cat)}</select></div></div>
     <div class="grid2"><div class="field"><label for="f-amount">Összeg (Ft)</label><input class="in-ctl num" id="f-amount" inputmode="numeric" data-f="amount" value="${esc(d.amount)}" placeholder="pl. 12000"></div>
     <div class="field"><label for="f-docNo">Számla száma</label><input class="in-ctl" id="f-docNo" data-f="docNo" value="${esc(d.docNo || "")}" placeholder="nem kötelező"></div></div>
     <div class="field"><label for="f-note">Leírás</label><input class="in-ctl" id="f-note" data-f="note" value="${esc(d.note)}" placeholder="pl. 5 mm-es pamutzsinór, 3 tekercs"></div>`;
  }
  const delBtn = sheet.id ? (sheetConfirm ? '<button type="button" class="btn danger solid" data-action="sheetDel">Igen, törlöm</button>' : '<button type="button" class="btn danger" data-action="askDel">Törlés</button>') : "";
  box.innerHTML = `<div class="overlay" data-action="closeSheetBg"><form class="sheet" id="sheetForm" role="dialog" aria-modal="true" aria-labelledby="sh-t" novalidate>
   <div class="sheet-head"><h3 id="sh-t">${sheet.kind === "order" ? (sheet.id ? "Rendelés szerkesztése" : "Új rendelés") : (sheet.id ? "Kiadás szerkesztése" : "Új kiadás")}</h3><button type="button" class="iconbtn" data-action="closeSheet" aria-label="Bezárás">${I.x}</button></div>
   ${body}<p class="note" id="formErr" hidden style="color:var(--danger);margin:0"></p>
   <div class="btns" style="justify-content:space-between"><span>${delBtn}</span><button class="btn primary" type="submit">Mentés</button></div></form></div>`;
  updPreview();
}
function updPreview() {
  const el = document.getElementById("preview"); if (!el || !sheet) return; const d = sheet.data;
  const p = num(d.price) - num(d.cost), h = num(d.hours);
  el.innerHTML = `<span>Haszon: <b>${huf(p)}</b></span><span>Órabér: <b>${h > 0 ? huf(p / h) : "–"}</b></span>${num(d.qty) > 1 ? `<span>Darabonként: <b>${huf(num(d.price) / num(d.qty))}</b></span>` : ""}`;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || "")) return fail("Adj meg egy dátumot.");
  if (sheet.kind === "order") {
    if (!d.product && !d.type) return fail("Adj meg terméknevet vagy típust.");
    if (d.status === "Teljesítve" && !d.payDate) d.payDate = d.date;
    const o = { date: d.date, product: String(d.product || "").trim(), type: d.type || "", qty: num(d.qty) || 1, cost: num(d.cost), price: num(d.price), hours: num(d.hours), customer: String(d.customer || "").trim(), channel: d.channel || "", status: d.status || STATUSES[0], note: String(d.note || "").trim(), invoiceNo: String(d.invoiceNo || "").trim(), payMethod: d.payMethod || "", payDate: d.payDate || "", created: d.created || Date.now() };
    if (d.sample) o.sample = true;
    const id = sheet.id || uid("r"); sheet = null; drawSheet(); ui.day = o.date; ui.month = ymOf(o.date);
    setRec(id, "order", o); toast("Rendelés elmentve");
  } else {
    if (!(num(d.amount) > 0)) return fail("Adj meg egy összeget.");
    const e = { date: d.date, cat: d.cat || "Egyéb", amount: num(d.amount), note: String(d.note || "").trim(), docNo: String(d.docNo || "").trim(), created: d.created || Date.now() };
    if (d.fixedId) e.fixedId = d.fixedId; if (d.sample) e.sample = true;
    const id = sheet.id || uid("k"); sheet = null; drawSheet(); ui.month = ymOf(e.date);
    setRec(id, "expense", e); toast("Kiadás elmentve");
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
  imgs.forEach((img) => { const c = thumbCache[img.dataset.thumb]; if (c) { img.src = c.url; img.hidden = false; const ic = img.nextElementSibling; if (ic) ic.remove(); } });
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
  const lines = ["Tétel;Dátum;Megnevezés;Típus / kategória;Darab;Nettó költség (Ft);Eladási ár / összeg (Ft);Munkaóra;Állapot;Bizonylat;Fizetés módja;Kifizetés napja;Vevő;Csatorna;Megjegyzés"];
  m.os.sort((a, b) => a.date.localeCompare(b.date)).forEach((o) => lines.push(["Rendelés", o.date, o.product, o.type, o.qty, csvNum(o.cost), csvNum(o.price), csvNum(o.hours), o.status, o.invoiceNo, o.payMethod, o.payDate, o.customer, o.channel, o.note].map(q).join(";")));
  m.es.sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => lines.push(["Kiadás", e.date, e.note, e.cat, "", "", csvNum(e.amount), "", "", e.docNo, "", "", "", "", ""].map(q).join(";")));
  lines.push(""); lines.push(["Bevétel összesen", "", "", "", "", csvNum(m.mat), csvNum(m.rev)].map(q).join(";"));
  lines.push(["Egyéb kiadások", "", "", "", "", "", csvNum(m.exp)].map(q).join(";"));
  lines.push(["Tiszta haszon", "", "", "", "", "", csvNum(m.profit)].map(q).join(";"));
  return "﻿" + lines.join("\r\n");
}
function csvReport() {
  const per = periodOf(ui.rep), rows = reportRows(per), afa = data().biz.vat === "afa27", b = data().biz;
  const lines = [[`Bevételi nyilvántartás – ${per.label}`].map(q).join(";"), [b.name, b.owner, "Adószám: " + (b.taxNo || "")].map(q).join(";"), ""];
  lines.push(["Sorszám", "Dátum", "Bizonylat", "Megnevezés", "Darab", "Vevő", "Fizetés módja", ...(afa ? ["Nettó (Ft)", "ÁFA (Ft)", "Bruttó (Ft)"] : ["Bevétel (Ft)"])].map(q).join(";"));
  rows.forEach((r) => lines.push([r.no, r.rd, r.invoiceNo, r.product || r.type, r.qty, r.customer, r.payMethod, ...(afa ? [r.net, r.vat, r.gross] : [r.net])].map(q).join(";")));
  lines.push(["Összesen", "", "", "", "", "", "", ...(afa ? [sum(rows, "net"), sum(rows, "vat"), sum(rows, "gross")] : [sum(rows, "net")])].map(q).join(";"));
  return "﻿" + lines.join("\r\n");
}
function exportJson() {
  const d = data();
  return JSON.stringify({ app: "sm-home-dekor", version: 2, exported: new Date().toISOString(), settings: d.settings, business: d.biz, orders: d.orders, expenses: d.expenses, docs: d.docs }, null, 1);
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
      const done = k > 0 || j < 3;
      o["minta-r-" + ym + "-" + j] = { date: ds, product: it[0], type: it[1], qty: it[2], cost: it[3], price: it[4], hours: it[5], channel: it[6], customer: "", status: done ? "Teljesítve" : STATUSES[j % 2], note: "", invoiceNo: done ? "MINTA-" + String(inv++).padStart(3, "0") : "", payMethod: done ? PAY[j % 3] : "", payDate: done ? ds : "", created: Date.now() + j, sample: true };
    });
    [["Könyvelő", 15000, "havi díj", 5], ["Fonal", 12500, "pamutzsinór 5 mm", 2], ["Energia", 6000, "áram, műhely", 10], ["Csomagolás", 3200, "dobozok, selyempapír", 15]].forEach((x, j) => { const ds = ym + "-" + pad(x[3]); if (ds > TODAY) return; e["minta-k-" + ym + "-" + j] = { date: ds, cat: x[0], amount: x[1], note: x[2], docNo: "", created: Date.now(), sample: true }; });
  }
  return { orders: o, expenses: e };
}

/* ---------- Események ---------- */
const A = {
  tab: (b) => { ui.tab = b.dataset.t; uiConfirm = null; saveUi(); render(true); window.scrollTo(0, 0); },
  month: (b) => { ui.month = shiftMonth(ui.month, +b.dataset.k); ui.year = +ui.month.slice(0, 4); render(true); },
  year: (b) => { ui.year += +b.dataset.k; ui.month = ui.year + ui.month.slice(4); render(true); },
  pickMonth: (b) => { ui.month = b.dataset.m; render(true); window.scrollTo({ top: 0, behavior: "smooth" }); },
  day: (b) => { ui.day = shiftDay(ui.day, +b.dataset.k); ui.month = ymOf(ui.day); render(true); },
  goDay: (b) => { ui.day = b.dataset.d; ui.month = ymOf(ui.day); ui.year = +ui.day.slice(0, 4); ui.tab = "log"; saveUi(); render(true); window.scrollTo(0, 0); },
  newOrder: () => { if (ui.tab === "home") ui.day = ymOf(TODAY) === ui.month ? TODAY : ui.month + "-01"; openOrder(); },
  editOrder: (b) => openOrder(b.dataset.id),
  newExp: () => openExp(),
  editExp: (b) => openExp(b.dataset.id),
  closeSheet: () => { sheet = null; drawSheet(); },
  closeSheetBg: (b, e) => { if (e.target === b) { sheet = null; drawSheet(); } },
  askDel: () => { sheetConfirm = true; drawSheet(); },
  sheetDel: () => { const id = sheet.id; sheet = null; drawSheet(); delRec(id); toast("Törölve"); },
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
  authMode: (b) => { ui.auth = b.dataset.m; auth.msg = ""; render(true); },
  install: async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; render(true); },
  copyLink: async () => { try { await navigator.clipboard.writeText(location.origin + "/"); toast("Link másolva"); } catch (e) { toast("Jelöld ki és másold a linket kézzel."); } },
  pickDoc: () => document.getElementById("docFile").click(),
  openDoc: (b) => openDoc(b.dataset.id),
  delDoc: (b) => deleteDoc(b.dataset.id)
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]"); if (!b) return;
  const f = A[b.dataset.action]; if (!f) return;
  if (b.dataset.action !== "closeSheetBg") e.preventDefault();
  f(b, e);
});
document.getElementById("fab").addEventListener("click", () => { if (ui.tab === "exp") openExp(); else A.newOrder(); });
document.addEventListener("submit", (e) => { e.preventDefault(); if (e.target.id === "sheetForm") submitSheet(); else if (e.target.id === "authForm") authSubmit(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheet) { sheet = null; drawSheet(); }
  if (e.key === "Enter" && e.target.id && e.target.id.startsWith("chip-")) { e.preventDefault(); const b = document.querySelector(`[data-action="chipAdd"][data-list="${e.target.id.slice(5)}"]`); if (b) A.chipAdd(b); }
});
let bizT = null, bizDraft = null;
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.f && sheet) {
    sheet.data[t.dataset.f] = t.value;
    if (t.dataset.f === "type" || (t.dataset.f === "qty" && sheet.data.type && !sheet.id)) applyType();
    if (t.dataset.f === "status" && t.value === "Teljesítve" && !sheet.data.payDate) setField("payDate", sheet.data.date || TODAY);
    updPreview(); return;
  }
  if (t.id === "dayInput") { if (t.value) { ui.day = t.value; ui.month = ymOf(ui.day); ui.year = +ui.day.slice(0, 4); t.blur(); render(true); } return; }
  if (t.dataset.s !== undefined) {
    const s = clone(data().settings), path = t.dataset.s.split("."); let o = s;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
    o[path[path.length - 1]] = t.type === "checkbox" ? t.checked : ("num" in t.dataset ? num(t.value) : t.value);
    saveSettings(s, true); return;
  }
  if (t.dataset.b !== undefined) {
    bizDraft = bizDraft || clone(data().biz); bizDraft[t.dataset.b] = t.value;
    clearTimeout(bizT); bizT = setTimeout(() => { const v = bizDraft; bizDraft = null; setRec("business", "business", v, { quiet: true }); }, 400);
  }
});
let toastT = null;
function toast(m) { const el = document.getElementById("toast"); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2800); }

/* ---------- Indítás ---------- */
render();
if (CLOUD) initCloud();
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
})();
