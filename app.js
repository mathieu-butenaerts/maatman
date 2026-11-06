/* MaatMan — shared data, calculation, import and sign-in for all pages.
   The data (consultants, projects, allocations, method, assumptions, CAO
   scales) lives in Supabase, in the maatman_* tables (supabase/schema.sql).
   Row-level security there decides who may read it (any of the three MaatMan
   pages) and who may change it (maatman.instellingen). Only personal view
   choices (reference date, incl./excl. pension, show ended allocations) stay
   in this browser's localStorage. */
"use strict";

const LEVELS = [
  { code: "TRA", name: "Trainee", mob: 480, train: 2388 },
  { code: "JUN", name: "Junior", mob: 480, train: 1380 },
  { code: "MED", name: "Medior", mob: 700, train: 360 },
  { code: "SPC", name: "Specialist", mob: 840, train: 0 },
  { code: "SEN", name: "Senior", mob: 1015, train: 0 },
  { code: "PRI", name: "Principal", mob: 1015, train: 0 },
  { code: "MAN", name: "Managing Principal", mob: 1015, train: 0 },
];
const DEFAULTS = {
  scalePos: 0.13, commuteKm: 40, commuteDays: 10, bonusPct: 0.5, extraLeaveDays: 6,
  homeAllow: 24, internet: 15, misc: 79, manager: 232.5, leftoverPct: 0.35, vat: 0.21,
  pfPensionPct: 0.159, pfFranchise: 1601.6, pensionFactor: 0.853, legalLeaveH: 160, burden: 0,
  levels: LEVELS,
};
const PRESETS = {
  excel:  { leaveNorm: false, noManager: false, noTraining: false, leaseExVat: false, pensionTwoSided: false },
  strict: { leaveNorm: true,  noManager: true,  noTraining: true,  leaseExVat: true,  pensionTwoSided: false },
};
const TOGGLES = [
  ["leaveNorm", "Bovenwettelijk verlof rekenen met de werkweek uit de cao", "De Excel vergelijkt verlofuren met 160 uur (40-urige werkweek), ook bij een cao van 36 uur. Daardoor worden extra verlofdagen bij de klant te laag geteld."],
  ["noManager", "Kosten teammanager niet meetellen", "Dat is een kostenpost van Profource, geen beloning die de consultant ontvangt."],
  ["noTraining", "Opleidingskosten Profource niet meetellen", "Aan de kant van de klant staat geen opleidingsbudget, dus alleen aan één kant meetellen vertekent de uitkomst."],
  ["leaseExVat", "Leaseauto en mobiliteitsbudget exclusief btw rekenen", "De Excel rekent ze inclusief 21% btw."],
  ["pensionTwoSided", "Profource meetellen als haar pensioen meer waard is", "De Excel corrigeert alleen als het pensioen bij de klant beter is."],
];
const PAGES = { overzicht: "maatman.dashboard", calculator: "maatman.calculator", instellingen: "maatman.instellingen" };
const clone = (o) => JSON.parse(JSON.stringify(o));
const PREFS = "maatman-prefs";

// ---------- state ----------
function todayISO() { return new Date().toISOString().slice(0, 10); }
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS) || "null") || {}; } catch (e) { return {}; } }
const prefs0 = loadPrefs();
let state = {
  consultants: [], projects: [], allocations: [],
  settings: clone(DEFAULTS), toggles: { ...PRESETS.excel }, method: "excel", scales: null, importInfo: null, updatedAt: null,
  refDate: prefs0.refDate || todayISO(), pension: prefs0.pension || "inc", showAll: !!prefs0.showAll,
};
let profile = null, canEdit = false;
// Personal view choices only; shared data is written with the db* functions below.
function save() { try { localStorage.setItem(PREFS, JSON.stringify({ refDate: state.refDate, pension: state.pension, showAll: state.showAll })); } catch (e) {} }
function syncMethod() { const m = Object.entries(PRESETS).find(([, p]) => Object.keys(p).every((k) => p[k] === state.toggles[k])); state.method = m ? m[0] : "custom"; }
function setMethod(m) { state.method = m; if (PRESETS[m]) state.toggles = { ...PRESETS[m] }; return dbSaveShared(); }
function newId(prefix) { return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ---------- Supabase ----------
const TABLE = { c: "maatman_consultants", p: "maatman_projects", a: "maatman_allocations" };
const toRow = {
  c: (o) => ({ id: o.id, pfid: o.pfid || null, name: o.name || "", level: o.level || null, pt: o.pt ?? 1, salary: o.salary ?? null, holiday_ft: o.holidayFT ?? null, car: o.car ?? null, notes: o.notes || [] }),
  p: (o) => ({ id: o.id, number: o.number || null, name: o.name || null, client: o.client || null, cao: o.cao ?? null, version: o.version || "", scale: o.scale ?? null, scale_pos: o.scalePos ?? null }),
  a: (o) => ({ id: o.id, consultant_id: o.consultantId, project_id: o.projectId, assign: o.assign ?? 1, scale: o.scale || null, start_date: o.start || null, end_date: o.end || null, notes: o.notes || [] }),
};
const n0 = (v) => v == null ? null : Number(v);
const fromRow = {
  c: (r) => ({ id: r.id, pfid: r.pfid || "", name: r.name || "", level: r.level || "", pt: n0(r.pt) ?? 1, salary: n0(r.salary), holidayFT: n0(r.holiday_ft), car: n0(r.car), notes: r.notes || [] }),
  p: (r) => ({ id: r.id, number: r.number || "", name: r.name || "", client: r.client || "", cao: n0(r.cao), version: r.version || "", scale: r.scale ?? "", scalePos: n0(r.scale_pos) }),
  a: (r) => ({ id: r.id, consultantId: r.consultant_id, projectId: r.project_id, assign: n0(r.assign) ?? 1, scale: r.scale || null, start: r.start_date || null, end: r.end_date || null, notes: r.notes || [] }),
};
// Supabase returns at most 1000 rows per request, so read in pages.
async function fetchAll(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await window.supabase.from(table).select("*").order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
async function reloadAll() {
  try {
    const [c, p, a, s] = await Promise.all([fetchAll(TABLE.c), fetchAll(TABLE.p), fetchAll(TABLE.a),
      window.supabase.from("maatman_settings").select("*").eq("id", 1).maybeSingle()]);
    if (s.error) throw s.error;
    state.consultants = c.map(fromRow.c); state.projects = p.map(fromRow.p); state.allocations = a.map(fromRow.a);
    const row = s.data;
    state.settings = { ...clone(DEFAULTS), ...(row && row.settings ? row.settings : {}) };
    state.toggles = row && row.toggles ? { ...PRESETS.excel, ...row.toggles } : { ...PRESETS.excel };
    state.method = row && row.method ? row.method : "excel";
    state.scales = row && Array.isArray(row.scales) && row.scales.length ? row.scales : null;
    state.importInfo = row ? row.import_info : null;
    state.updatedAt = row ? row.updated_at : null;
    return true;
  } catch (err) {
    notice("Kon de MaatMan-gegevens niet laden: " + (err.message || err) + ". Is supabase/schema.sql al uitgevoerd?", true);
    return false;
  }
}
async function dbResult(promise) {
  const { error } = await promise;
  if (error) { notice("Opslaan mislukt: " + error.message + ". De gegevens zijn opnieuw geladen.", true); await reloadAll(); if (typeof window.render === "function") window.render(); return false; }
  return true;
}
const dbSave = (kind, obj) => dbResult(window.supabase.from(TABLE[kind]).upsert(toRow[kind](obj)));
const dbDelete = (kind, id) => dbResult(window.supabase.from(TABLE[kind]).delete().eq("id", id));
const dbSaveShared = () => dbResult(window.supabase.from("maatman_settings").upsert({ id: 1, settings: state.settings, toggles: state.toggles, method: state.method }));
// Replace all consultants, projects and allocations in one database transaction.
function dbReplaceAll(data, scales, info) {
  return dbResult(window.supabase.rpc("maatman_replace_all", {
    p_consultants: data.consultants.map(toRow.c), p_projects: data.projects.map(toRow.p), p_allocations: data.allocations.map(toRow.a),
    p_scales: scales || null, p_import_info: info || null,
  }));
}
// Live updates: reload when anyone changes MaatMan data in another tab or browser.
let liveTimer = null;
function subscribeLive() {
  const ch = window.supabase.channel("maatman-live");
  for (const t of [...Object.values(TABLE), "maatman_settings"]) ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => { if (await reloadAll() && typeof window.render === "function") window.render(); }, 400);
  });
  ch.subscribe();
}

// Data from the earlier browser-only versions, which can be copied into the database once.
function localLegacyData() {
  try {
    const v2 = JSON.parse(localStorage.getItem("maatman-v2") || "null");
    if (v2 && Array.isArray(v2.consultants) && !v2.example && v2.consultants.length) return v2;
    const v1 = JSON.parse(localStorage.getItem("maatman-v1") || "null");
    if (v1 && Array.isArray(v1.rows) && v1.rows.length && !v1.rows.some((r) => r.example)) return migrateV1(v1);
  } catch (e) {}
  return null;
}
function forgetLegacyData() { try { localStorage.removeItem("maatman-v2"); localStorage.removeItem("maatman-v1"); } catch (e) {} }
// v1 kept one flat row per allocation; split it into consultants, projects and allocations.
function migrateV1(old) {
  const s = { consultants: [], projects: [], allocations: [], scales: old.scales || null, importInfo: old.importInfo || null };
  for (const r of old.rows) {
    const cid = "c-" + (r.pfid || r.id); const pid = "p-" + (r.project || r.id);
    if (!s.consultants.some((c) => c.id === cid)) s.consultants.push({ id: cid, pfid: r.pfid || "", name: r.name, level: r.level, pt: r.pt ?? 1, salary: r.salary, holidayFT: r.holidayFT, car: r.car, notes: [] });
    if (!s.projects.some((p) => p.id === pid)) s.projects.push({ id: pid, number: r.project || "", name: r.projectName || "", client: r.client || "", cao: r.cao, version: r.version || "", scale: r.scale, scalePos: r.scalePos ?? null });
    s.allocations.push({ id: "a-" + r.id, consultantId: cid, projectId: pid, assign: r.assign ?? 1, scale: null, start: null, end: null, notes: r.notes || [] });
  }
  return s;
}

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur0 = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v) => (v * 100).toLocaleString("nl-NL", { maximumFractionDigits: 2 }) + "%";
const nl = (v, d = 2) => Number(v).toLocaleString("nl-NL", { maximumFractionDigits: d });
const p100 = (v) => v == null ? "" : +(v * 100).toFixed(2);
function signed(v, f = eur0) { if (v == null || isNaN(v)) return "–"; const r = Math.round(v * 100) / 100; return (r > 0 ? "+" : r < 0 ? "−" : "") + f.format(Math.abs(v)); }
function num(v) { if (v == null || v === "") return null; if (typeof v === "number") return isFinite(v) ? v : null; let t = String(v).trim(); if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); const n = parseFloat(t); return isNaN(n) ? null : n; }
function toDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + v * 864e5);
  const m = String(v).match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(v); return isNaN(d) ? null : d;
}
const isoDate = (d) => d ? d.toISOString().slice(0, 10) : null;
const fmtDate = (d) => d ? (d instanceof Date ? d : toDate(d)).toISOString().slice(0, 10).split("-").reverse().join("-") : "";
const refDate = () => new Date(state.refDate + "T00:00:00Z");
const CHEV = '<svg class="chev" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M3 1.5L6.5 5L3 8.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------- CAO scales ----------
const scales = () => state.scales || EMBEDDED_SCALES;
function caoList() { const m = new Map(); for (const s of scales()) if (!m.has(s.c)) m.set(s.c, s.cao || ("Cao " + s.c)); return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "nl")); }
function caoName(code) { const s = scales().find((x) => x.c == code); return s ? (s.cao || "Cao " + code) : "Cao " + code; }
const vnum = (v) => parseInt(String(v).replace(/\D/g, "")) || 0;
function versionsFor(code) { return [...new Set(scales().filter((s) => s.c == code).map((s) => s.v))].sort((a, b) => vnum(a) - vnum(b)); }
function pickVersion(code, ref = refDate()) {
  const rows = scales().filter((s) => s.c == code); if (!rows.length) return null;
  const vs = [...new Set(rows.map((s) => s.v))].sort((a, b) => vnum(b) - vnum(a));
  const valid = vs.filter((v) => { const r = rows.find((s) => s.v === v); const a = toDate(r.from), b = toDate(r.to); return a && b && a <= ref && ref <= b; });
  if (valid.length) return valid[0];
  const act = vs.filter((v) => rows.some((s) => s.v === v && s.act === 1)); if (act.length) return act[0];
  return vs[0];
}
function scalesFor(code, v) { return scales().filter((s) => s.c == code && s.v === v); }
function scaleOptions(code, version, current) {
  const sc = scalesFor(code, version || pickVersion(code));
  return sc.map((s) => `<option value="${esc(s.s)}" ${String(s.s) === String(current) ? "selected" : ""}>${esc(s.s)}</option>`).join("") +
    (current == null || current === "" || sc.some((s) => String(s.s) === String(current)) ? "" : `<option selected value="${esc(current)}">${esc(current)} (niet gevonden)</option>`);
}
function versionOptions(code, current) {
  return `<option value="">Automatisch (${esc(pickVersion(code) || "–")})</option>` + versionsFor(code).map((v) => `<option ${v === current ? "selected" : ""}>${esc(v)}</option>`).join("");
}
function caoOptions(current) { return caoList().map(([k, n]) => `<option value="${k}" ${k == current ? "selected" : ""}>${esc(n)} (${k})</option>`).join(""); }
function levelOptions(current) { return `<option value="">–</option>` + state.settings.levels.map((l) => `<option value="${l.code}" ${l.code === current ? "selected" : ""}>${esc(l.name)}</option>`).join(""); }
const level = (code) => state.settings.levels.find((l) => l.code === code);

// ---------- lookups ----------
const consultant = (id) => state.consultants.find((c) => c.id === id);
const project = (id) => state.projects.find((p) => p.id === id);
function isCurrent(a, ref = refDate()) { const s = a.start ? toDate(a.start) : null, e = a.end ? toDate(a.end) : null; return (!s || s <= ref) && (!e || e >= ref); }
function projectLabel(p) { return p ? (p.number || "–") + (p.name ? " · " + p.name : "") : "Onbekend project"; }

// Combine a consultant, a project and optional overrides into one calculation input.
function inputFor(cons, proj, over = {}) {
  const pick = (k, dflt) => over[k] != null && over[k] !== "" ? over[k] : dflt;
  return {
    cao: proj ? proj.cao : null, version: pick("version", proj ? proj.version : ""), scale: pick("scale", proj ? proj.scale : ""),
    scalePos: pick("scalePos", proj ? proj.scalePos : null), level: cons ? cons.level : "", pt: pick("pt", cons ? cons.pt ?? 1 : 1),
    assign: pick("assign", 1), salary: pick("salary", cons ? cons.salary : null), holidayFT: pick("holidayFT", cons ? cons.holidayFT : null),
    car: over.car !== undefined ? over.car : (cons ? cons.car : null),
  };
}
function allocInput(a) { return inputFor(consultant(a.consultantId), project(a.projectId), { assign: a.assign, scale: a.scale }); }

// ---------- calculation (follows the Excel columns; the toggles switch on the corrections) ----------
function calc(row) {
  const S = state.settings, T = state.toggles;
  const v = row.version || pickVersion(row.cao);
  const s = v ? scalesFor(row.cao, v).find((x) => String(x.s) === String(row.scale)) || null : null;
  const out = { version: v, scale: s, client: [], pf: [], issues: [], w: (row.pt ?? 1) * (row.assign ?? 1) };
  if (!s) { out.issues.push(`Geen cao-schaal gevonden voor ${caoName(row.cao)} schaal ${row.scale ?? "–"}${v ? " (" + v + ")" : ""}.`); return out; }
  const lv = level(row.level); if (!lv) out.issues.push("Functieniveau onbekend, dus mobiliteitsbudget en opleidingen ontbreken.");
  if (row.salary == null) out.issues.push("Geen salaris bij Profource bekend.");
  const pos = row.scalePos ?? S.scalePos;
  const U = s.min + (s.max - s.min) * pos;
  const hrs = s.hrs || 40;
  const extraDays = T.leaveNorm ? Math.max(0, ((s.leaveH || 0) - 4 * hrs) / (hrs / 5)) : Math.max(0, ((s.leaveH || 0) - S.legalLeaveH) / 8);
  const dayV = s.dayV ?? 0.00385;
  const AQ = (s.vak || 0) * U, AF = (s.eju || 0) * U, AH = (s.ikb || 0) * U;
  const budgetTxt = s.budget && !["nvt", "0", 0].includes(s.budget) ? "Niet meegeteld: " + s.budget : "";
  out.client = [
    ["Basissalaris", U, `Schaal ${s.s}: ${eur0.format(s.min)}–${eur0.format(s.max)} (40 uur), op ${pct(pos)}`],
    ["Vakantiegeld", AQ, pct(s.vak || 0)],
    ["Eindejaarsuitkering", AF, pct(s.eju || 0)],
    ["IKB-budget", AH, pct(s.ikb || 0)],
    ["Bovenwettelijk verlof", extraDays * dayV * U, `${nl(extraDays, 1)} dagen × ${pct(dayV)} van het salaris`],
    ["Reiskosten woon-werk", (s.km || 0) * S.commuteKm * 2 * S.commuteDays, `€ ${nl(s.km || 0)}/km × ${nl(S.commuteKm)} km × 2 × ${nl(S.commuteDays)} dagen`],
    ["Thuiswerk + internet", s.home || 0, ""],
    ["Overige cao-elementen", s.other || 0, budgetTxt],
  ];
  const V = row.salary || 0;
  const AS = row.holidayFT ?? V * 0.08;
  const budget = lv ? lv.mob : 0;
  const carGross = row.car != null ? row.car : budget * (1 + S.vat);
  const Z = T.leaseExVat ? carGross / (1 + S.vat) : carGross;
  const AA = carGross / (1 + S.vat) < budget ? (budget - carGross / (1 + S.vat)) * S.leftoverPct : 0;
  const W = V * S.bonusPct / 12;
  out.pf = [
    ["Salaris (fulltime)", V, "Uit AFAS"],
    ["Vakantiegeld", AS, row.holidayFT == null ? "8% aangenomen" : "Uit AFAS"],
    ["Bonus", W, `${pct(S.bonusPct)} van een maandsalaris per jaar`],
    [row.car != null ? "Leaseauto" : "Mobiliteitsbudget", Z, (row.car != null ? "" : (lv ? "Budget " + lv.name + ", " : "")) + (T.leaseExVat ? "excl. btw" : "incl. btw")],
    ["Resterend mobiliteitsbudget", AA, `${pct(S.leftoverPct)} van wat overblijft`],
    ["Extra verlofdagen", V * dayV * S.extraLeaveDays, `${nl(S.extraLeaveDays)} dagen × ${pct(dayV)} van het salaris`],
    ["Thuiswerkvergoeding", S.homeAllow, ""],
    ["Internetvergoeding", S.internet, ""],
    ["Diversen", S.misc, ""],
    ["Teammanager", T.noManager ? 0 : S.manager, T.noManager ? "Niet meegeteld" : "", T.noManager],
    ["Opleidingen", T.noTraining || !lv ? 0 : lv.train / 12, T.noTraining ? "Niet meegeteld" : lv ? `${eur0.format(lv.train)} per jaar` : "", T.noTraining],
  ];
  out.clientTotal = out.client.reduce((a, l) => a + l[1], 0);
  out.pfTotal = out.pf.reduce((a, l) => a + l[1], 0);
  const base = (s.fSal === 1 ? U : 0) + (s.fVak === 1 ? AQ : 0) + (s.fEju === 1 ? AF : 0) + (s.fToe === 1 ? AH : 0);
  out.penClient = (base - (s.fran || 0)) * (s.pen || 0);
  out.penPf = (V + AS + W - S.pfFranchise) * S.pfPensionPct;
  out.penText = s.penTxt || "";
  let gap = out.penClient - out.penPf; if (!T.pensionTwoSided) gap = Math.max(0, gap);
  out.penComp = gap * S.pensionFactor;
  out.diffEx = out.pfTotal - out.clientTotal;
  out.diffInc = out.diffEx - out.penComp;
  out.wEx = out.diffEx * out.w; out.wInc = out.diffInc * out.w;
  out.ok = row.salary != null && !!lv;
  return out;
}
const head = (c) => state.pension === "inc" ? c.wInc : c.wEx;
const headFT = (c) => state.pension === "inc" ? c.diffInc : c.diffEx;
function status(c) { if (!c.scale || !c.ok) return ["chk", "Data controleren"]; return head(c) < -0.5 ? ["gap", "Onder klantniveau"] : ["ok", "In orde"]; }
function diffCell(v, has = true) { return `<td class="r tnum ${has ? (v < 0 ? "neg" : "pos") : ""}">${has ? signed(v) : "–"}</td>`; }

// The side-by-side calculation shown on the overview and the calculator.
function breakdownHTML(c, caoCode, notes = []) {
  const all = [...notes, ...c.issues];
  let h = all.length ? `<ul class="meldingen">${all.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  if (!c.scale) return h;
  const tbl = (title, lines, total) => `<div class="box"><h3>${title}</h3><table><tbody>${lines.map(([k, v, note, off]) => `<tr><td>${esc(k)}${note ? `<div class="klein">${esc(note)}</div>` : ""}</td><td class="r tnum ${off ? "uit" : ""}">${eur2.format(v)}</td></tr>`).join("")}<tr class="tot"><td>Totaal per maand</td><td class="r tnum">${eur2.format(total)}</td></tr></tbody></table></div>`;
  return h + `<div class="vgl">${tbl("Bij de klant · " + esc(caoName(caoCode)) + " " + esc(c.version), c.client, c.clientTotal)}${tbl("Bij Profource", c.pf, c.pfTotal)}</div>
    <div class="box"><h3>Pensioen</h3><table><tbody>
      <tr><td>Werkgeverspremie klant<div class="klein">${pct(c.scale.pen || 0)} over pensioengevend loon min franchise ${eur0.format(c.scale.fran || 0)}${c.penText ? " · " + esc(c.penText) : ""}</div></td><td class="r tnum">${eur2.format(c.penClient)}</td></tr>
      <tr><td>Werkgeverspremie Profource<div class="klein">${pct(state.settings.pfPensionPct)} over salaris, vakantiegeld en bonus min ${eur0.format(state.settings.pfFranchise)}</div></td><td class="r tnum">${eur2.format(c.penPf)}</td></tr>
      <tr class="tot"><td>Pensioencompensatie<div class="klein" style="font-weight:400">${state.toggles.pensionTwoSided ? "Verschil" : "Alleen voordeel klant"} × ${nl(state.settings.pensionFactor, 3)}</div></td><td class="r tnum">${eur2.format(c.penComp)}</td></tr>
    </tbody></table></div>
    <div class="uitkomst">
      <div class="box"><h3>Verschil excl. pensioen</h3><div class="big ${c.diffEx < 0 ? "neg" : "pos"}">${signed(c.diffEx, eur2)}</div><div class="klein">Fulltime · gewogen naar ${pct(c.w)}: <span class="tnum">${signed(c.wEx, eur2)}</span></div></div>
      <div class="box"><h3>Verschil incl. pensioen</h3><div class="big ${c.diffInc < 0 ? "neg" : "pos"}">${signed(c.diffInc, eur2)}</div><div class="klein">Fulltime · gewogen naar ${pct(c.w)}: <span class="tnum">${signed(c.wInc, eur2)}</span></div></div>
    </div>`;
}
function methodLabel() { return state.method === "excel" ? "Zoals Excel" : state.method === "strict" ? "Strikt" : "Aangepast"; }
function notice(msg, err = false) { const n = $("notice"); if (!n) return; n.hidden = false; n.classList.toggle("err", err); n.textContent = msg; }
function dataNotice() {
  if (!state.consultants.length && !state.projects.length) notice(canEdit ? "Er staan nog geen gegevens in MaatMan. Importeer het MaatMan-workbook via Instellingen." : "Er staan nog geen gegevens in MaatMan. Vraag een collega met toegang tot Instellingen om het workbook te importeren.");
  else if (state.importInfo) notice(state.importInfo + (state.updatedAt ? ` Laatst gewijzigd: ${new Date(state.updatedAt).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}.` : ""));
  else { const n = $("notice"); if (n) n.hidden = true; }
}

// ---------- import of the MaatMan workbook ----------
async function importFile(f) {
  try {
    if (typeof XLSX === "undefined") throw new Error("de Excel-lezer is niet geladen");
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    return await importWorkbook(wb, f.name);
  } catch (err) {
    notice(`Kon ${f.name} niet lezen: ${err.message}. Controleer of het het MaatMan-workbook (.xlsx) is.`, true);
    return false;
  }
}
function sheetRows(wb, name) { const ws = wb.Sheets[name]; return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) : null; }
function headerIndex(rows, must) { for (let i = 0; i < Math.min(rows.length, 15); i++) if ((rows[i] || []).some((v) => String(v ?? "").trim() === must)) return i; return -1; }
function colMap(hdr) { const m = {}; (hdr || []).forEach((h, i) => { const k = String(h ?? "").trim(); if (k && !(k in m)) m[k] = i; }); return m; }
async function importWorkbook(wb, fname) {
  const ref = refDate();
  let scalesList = null;
  const or = sheetRows(wb, "Oracle Projecten-Allocaties");
  if (!or) { notice(`${fname} heeft geen tabblad "Oracle Projecten-Allocaties". Er is niets geïmporteerd.`, true); return false; }
  const hi = headerIndex(or, "PERSON NUMBER");
  if (hi < 0) { notice(`De kolom PERSON NUMBER staat niet in "Oracle Projecten-Allocaties". Er is niets geïmporteerd.`, true); return false; }
  // CAO scales
  const sr = sheetRows(wb, "SUGB-Salarischalen");
  if (sr && sr.length > 1) {
    const h = colMap(sr[0]); const g = (row, k) => h[k] == null ? null : row[h[k]];
    const list = [];
    for (const row of sr.slice(1)) {
      const mn = num(g(row, "Min schaal obv 40 uur")), mx = num(g(row, "Max schaal obv 40 uur"));
      if (mn == null || mx == null || g(row, "Code CAO") == null) continue;
      list.push({ cao: String(g(row, "CAO") ?? "").trim(), v: String(g(row, "Versie") ?? "").trim(), c: num(g(row, "Code CAO")), s: String(g(row, "Schaal") ?? "").trim(), from: g(row, "Begin (Schaal)"), to: g(row, "Eind (schaal)"), act: num(g(row, "Actief")), hrs: num(g(row, "Wekelijkse arbeidsduur")), min: mn, max: mx, vak: num(g(row, "Vakantiebijslag")), km: num(g(row, "Reiskosten eigen vervoer (uitgegaan met auto)")), home: num(g(row, "Thuiswerk+internet per maand")), eju: num(g(row, "Eindejaarsuitkering")), leaveH: num(g(row, "Totaal verlofuren per jaar")), dayV: num(g(row, "Waarde vakantiedagen")), ikb: num(g(row, "IKB")), pen: num(g(row, "Pensioen werkgeverspremie")), penTxt: g(row, "Pensioen elementen"), fSal: num(g(row, "Periodeloon in schaal")), fToe: num(g(row, "Toeslagen")), fVak: num(g(row, "Vakantiebijslag_2")), fEju: num(g(row, "Vaste uitkeringen (eindejaarsuitkering)")), fran: num(g(row, "Franchise per maand")), other: num(g(row, "Overig per maand")), budget: g(row, "Budgetten2") });
    }
    if (list.length) scalesList = list;
  }
  // employees
  const emp = new Map(); const er = sheetRows(wb, "AFAS Medewerkers");
  if (er) { const h = colMap(er[0]); for (const row of er.slice(1)) { const id = row[h["PFid"]]; if (id != null) emp.set(String(id), { level: row[h["FunctieniveauPFcode"]], name: row[h["Naam"]], out: toDate(row[h["Datum uit dienst"]]) }); } }
  // pay components: latest period up to the reference month, summed within that period
  const pay = new Map(); const lr = sheetRows(wb, "AFAS Mdw-Looncomponent");
  const refP = ref.getUTCFullYear() * 12 + ref.getUTCMonth() + 1;
  if (lr) {
    const h = colMap(lr[0]);
    for (const row of lr.slice(1)) {
      const id = row[h["PFid"]]; if (id == null) continue;
      const p = (num(row[h["Boekjaar"]]) || 0) * 12 + (num(row[h["Periode"]]) || 0); if (p > refP) continue;
      const comp = String(row[h["Looncomponent"]] || "").trim(); const amt = num(row[h["Totaalbedrag"]]) || 0;
      const key = String(id); if (!pay.has(key)) pay.set(key, {});
      const m = pay.get(key);
      if (!m[comp] || m[comp].p < p) m[comp] = { p, amt: 0 };
      if (m[comp].p === p) m[comp].amt += amt;
    }
  }
  // lease cars running on the reference date
  const cars = new Map(); const ar = sheetRows(wb, "AFAS Mdw-Auto");
  if (ar) { const h = colMap(ar[0]); for (const row of ar.slice(1)) { const id = row[h["PFid"]]; if (id == null) continue; const a = toDate(row[h["Begindatum"]]), b = toDate(row[h["Einddatum"]]); if (a && a <= ref && (!b || ref <= b)) cars.set(String(id), (num(row[h["Waarde t.b.v. Gelijkwaardig belonen"]]) || 0) - (num(row[h["Eigen bijdrage privégebruik"]]) || 0)); } }
  // allocations → consultants, projects, allocations
  const h = colMap(or[hi]);
  const consultants = new Map(), projects = new Map(), allocations = [];
  or.slice(hi + 1).forEach((row, i) => {
    const idA = row[h["PERSON NUMBER"]]; if (idA == null || idA === "") return;
    const idC = h["PERSON NUMBER"] === 0 && row[2] != null && String(row[2]) !== String(idA) ? String(row[2]) : null;
    const ids = [String(idA), idC].filter(Boolean);
    const hit = (map) => { for (const id of ids) if (map.has(id)) return map.get(id); return null; };
    const pt = num(row[h["PT%"]]) ?? 1;
    const cid = "c-" + idA;
    if (!consultants.has(cid)) {
      const notes = [];
      if (idC) notes.push(`Oracle heeft personeelsnummer ${idA}, maar de opzoekkolom in het werkblad heeft ${idC}. Beide nummers zijn geprobeerd.`);
      const e = hit(emp), p = hit(pay);
      if (!e) notes.push("Niet gevonden in de AFAS-medewerkerslijst, dus het functieniveau ontbreekt.");
      if (e && e.out && e.out < ref) notes.push(`Uit dienst sinds ${fmtDate(e.out)}.`);
      let salary = null, holidayFT = null;
      if (p) {
        const sal = p["Fulltime salaris tbv berekening vaste uitkeringen"];
        const hol = p["Periodieke uitbetaling vakantietoeslag"] || p["Reservering vakantietoeslag"];
        if (sal) { salary = sal.amt; if (refP - sal.p > 1) { const y = Math.floor((sal.p - 1) / 12), m = sal.p - y * 12; notes.push(`Het meest recente salaris in AFAS is van ${String(m).padStart(2, "0")}-${y}.`); } }
        if (hol) holidayFT = hol.amt / (pt || 1);
      }
      if (salary == null) notes.push("Geen fulltime salaris gevonden in de AFAS-looncomponenten.");
      const car = hit(cars);
      consultants.set(cid, { id: cid, pfid: String(idA), name: row[h["PERSON NAME"]] || (e && e.name) || String(idA), level: e ? e.level : "", pt, salary, holidayFT, car: car ?? null, notes });
    }
    const pnum = String(row[h["PROJECT NUMBER"]] ?? "").trim() || "rij-" + i;
    const pid = "p-" + pnum;
    const cao = num(row[h["CAO"]]); const scale = String(row[h["SCHAAL"]] ?? "").trim();
    if (!projects.has(pid)) projects.set(pid, { id: pid, number: pnum, name: row[h["PROJECT NAME"]] || "", client: row[h["CUSTOMER NAME"]] || "", cao, version: "", scale, scalePos: null });
    const proj = projects.get(pid);
    const anotes = [];
    const start = toDate(row[h["START DATE PERSON ALLOCATION"]]), end = toDate(row[h["END DATE PERSON ALLOCATION"]]);
    if (end && end < ref) anotes.push(`Allocatie afgelopen op ${fmtDate(end)}.`);
    if (proj.cao != cao) anotes.push(`Deze regel noemt cao ${cao}, het project cao ${proj.cao}. Gerekend met de cao van het project.`);
    allocations.push({ id: "a-" + i + "-" + idA, consultantId: cid, projectId: pid, assign: num(row[h["Opdracht%"]]) ?? 1, scale: scale !== String(proj.scale) ? scale : null, start: isoDate(start), end: isoDate(end), notes: anotes });
  });
  const data = { consultants: [...consultants.values()], projects: [...projects.values()], allocations };
  const info = `${allocations.length} allocatie${allocations.length === 1 ? "" : "s"} geïmporteerd uit ${fname}: ${data.consultants.length} consultant${data.consultants.length === 1 ? "" : "s"} en ${data.projects.length} project${data.projects.length === 1 ? "" : "en"}${scalesList ? `, met ${scalesList.length} cao-schalen` : ""}. Salarissen en leaseauto's zijn bepaald per peildatum ${fmtDate(ref)}.`;
  if (!(await dbReplaceAll(data, scalesList, info))) return false;
  await reloadAll();
  return true;
}

// ---------- start: same sign-in as Marktmonitor and Leadbeheer, plus page access ----------
async function boot(pageKey, start) {
  $("btn-logout").addEventListener("click", () => window.logout());
  const p = await window.requirePage(pageKey);
  if (!p) { $("loading").hidden = true; return; } // requirePage redirected to login or showed "Geen toegang"
  profile = p;
  canEdit = p.pages.has(PAGES.instellingen);
  if (p.role === "admin") $("adminLink").hidden = false;
  document.querySelectorAll(".nav a[data-page]").forEach((a) => { a.hidden = !p.pages.has(a.dataset.page); });
  $("loading").textContent = "Gegevens laden…";
  await reloadAll();
  $("loading").hidden = true;
  $("app").hidden = false;
  start();
  subscribeLive();
}
