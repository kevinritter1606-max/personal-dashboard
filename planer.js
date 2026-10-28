/* ==========================================================================
   SCHICHTPLANER & AUTOMATIK KERNLOGIK (TEIL 1 VON 2 – ABSCHNITT 1 BIS 7)
   Version v4.9.69 – Penibel tiefengeprüft (Audit-Trail, Memory-Pin & Multi-Historie)
   ========================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyBPOYRYyUm5gA-j7YSAZl7EJoxedFhDTl4",
  authDomain: "schichtplan-bayer.firebaseapp.com",
  projectId: "schichtplan-bayer"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const boardRef = db.collection("shiftplan").doc("live_board");

/* Globale System-Variablen */
let hasLoadedFromCloud = false;

let lines = [
  { id: "L32", name: "Linie 32", floor: "1. OG", prio: "", tag: "", note: "", ausgeplant: false, mainOnly: false, roleTargets: { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 } },
  { id: "L33", name: "Linie 33", floor: "1. OG", prio: "", tag: "", note: "", ausgeplant: false, mainOnly: false, roleTargets: { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 } },
  { id: "L34", name: "Linie 34", floor: "1. OG", prio: "PRIO 1", tag: "", note: "", ausgeplant: false, mainOnly: false, roleTargets: { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 } },
  { id: "L_Sachet", name: "Linie Sachet", floor: "1. OG", prio: "", tag: "", note: "", ausgeplant: false, mainOnly: true, roleTargets: { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 } }
];

let roles = ["Bediener", "LOP", "TL", "Schichtexperte", "Waschraumoperator"];

let employees = [];

let teamsConfig = {
  team_1: { name: "Team 1", color: "#3b82f6", rotates: true },
  team_2: { name: "Team 2", color: "#f97316", rotates: true },
  team_3: { name: "Team 3", color: "#10b981", rotates: true },
  team_4: { name: "Team 4", color: "#ef4444", rotates: true }
};

let shiftRotation = { frueh: "team_1", spaet: "team_2", nacht: "team_3", frei: "team_4" };

let sickLeaves = [];
let leaveRequests = [];
let extraShifts = [];
let historyLogs = [];
let backups = [];

let securityConfig = {
  boardPwEnabled: false,
  boardPw: "0110",
  plannerTimeoutMin: 180
};

let shiftModelConfig = {
  model: "vollkonti_sonntag_frei",
  autoRotate: true,
  smartAssignEnabled: true,
  smartRespectFloorTL: true,
  smartAllowSwap: true,
  focusModeEnabled: true,
  focusModePercent: 20,
  fairnessBalanceEnabled: true,
  rotationCycleMonths: 3,
  resetEnabled: false,
  resetDay: -1,
  resetHour: 5,
  loadEnabled: false,
  loadDay: -1,
  loadHour: 5,
  secondaryUnlockThresholdHours: 160,
  defaultShiftHours: 8,
  lastRotationBlockIndex: 0,
  lastAutoResetTriggerKey: "",
  lastAutoLoadTriggerKey: "",
  anchorReferenceDateIso: "",
  anchorShiftRotation: null,
  roleRequiresLines: {
    "Bediener": true,
    "LOP": true,
    "TL": false,
    "Schichtexperte": false,
    "Waschraumoperator": false
  },
  roleAllowLineAssign: {
    "Bediener": true,
    "LOP": true,
    "TL": false,
    "Schichtexperte": false,
    "Waschraumoperator": false
  }
};

let approvedShiftKey = "";
let isPlanner = false;
let plannerLevel = 0;
let currentPlannerName = "";
let currentPlannerEmpId = null;

let selectedLoginPlannerId = null;
let selectedManualSickEmpId = null;
let selectedManualExtraEmpId = null;

let poolSearchQuery = "";
let inboxSearchQuery = "";
let settingsEmpSearchQuery = "";
let activeHistoryCategory = "ALL";
let activeInboxHistoryCategory = "ALL";
let activeTeamFilters = {};
let activeRoleFilters = {};
let recentHistorySearches = [];
let settingsSortableInstances = [];
let boardSortableInstances = [];
let currentAnchorDaysSelection = [1, 2, 3, 4, 5];
let activeCoverageReleaseLeaveId = null;
let activeCounterOfferLeaveId = null;
let expandedCoverageCards = {};

let draggedEmpId = null;
let isDraggingCard = false;
let isRunningAutoTransition = false;
let lastBoardSnapshotForUndo = null;

const shifts = [
  { id: "frueh", name: "Früh" },
  { id: "spaet", name: "Spät" },
  { id: "nacht", name: "Nacht" }
];

const shiftsLabel = {
  frueh: "Frühschicht",
  spaet: "Spätschicht",
  nacht: "Nachtschicht",
  frei: "Freischicht / Frei"
};

const shiftsShortLabel = {
  frueh: "Früh",
  spaet: "Spät",
  nacht: "Nacht",
  frei: "Frei"
};

/* ==========================================================================
   1. DATUMS-, ZEIT-, ZONEN- & AUDIT-HILFSFUNKTIONEN (05:00 UHR PRODUKTIONSTAG)
   ========================================================================== */

function injectModernSaaSStyles() {
  if (document.getElementById("modernSaasInjectedStyles")) return;
  const st = document.createElement("style");
  st.id = "modernSaasInjectedStyles";
  st.textContent =
    ".cov-mini-chip { display:inline-flex; align-items:center; gap:3px; padding:2px 7px; border-radius:999px; font-size:0.68rem; font-weight:700; cursor:pointer; user-select:none; transition:transform 0.1s ease; }" +
    ".cov-mini-chip:hover { transform:scale(1.03); }" +
    ".recent-chip { display:inline-flex; align-items:center; gap:3px; padding:2px 7px; border-radius:999px; font-size:0.68rem; background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; cursor:pointer; }" +
    ".recent-chip:hover { background:#e2e8f0; }" +
    ".emp-history-card { background:#f8fafc; border:1px solid #cbd5e1; border-left:4px solid #0284c7; border-radius:8px; padding:7px 10px; display:flex; flex-direction:column; gap:5px; }" +
    ".emp-history-line-item { background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:5px 8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }";
  document.head.appendChild(st);
}

function getLogicalDateIso(nowDate) {
  const d = nowDate ? new Date(nowDate) : new Date();
  if (d.getHours() < 5) {
    d.setDate(d.getDate() - 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}
window.getLogicalDateIso = getLogicalDateIso;

window.normalizeDateIso = function(dateStr) {
  if (!dateStr) return "";
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split(".");
  if (parts.length === 3) {
    return parts[2] + "-" + parts[1].padStart(2, "0") + "-" + parts[0].padStart(2, "0");
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
};
const normalizeDateIso = window.normalizeDateIso;

function formatDateDe(dateIso) {
  const norm = window.normalizeDateIso(dateIso);
  if (!norm) return "";
  const p = norm.split("-");
  if (p.length !== 3) return norm;
  return p[2] + "." + p[1] + "." + p[0];
}
window.formatDateDe = formatDateDe;

function formatAuditTimestampDe(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr);
  return d.toLocaleDateString("de-DE") + ", " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
}
window.formatAuditTimestampDe = formatAuditTimestampDe;

function getCurrentActorLabel() {
  if (isPlanner && currentPlannerName) {
    return currentPlannerName + (plannerLevel ? " (Stufe " + plannerLevel + ")" : " (Planer)");
  }
  return currentPlannerName || "Planer";
}
window.getCurrentActorLabel = getCurrentActorLabel;

function appendAuditEntry(record, actionText, customActor) {
  if (!record || typeof record !== "object") return;
  const nowIso = new Date().toISOString();
  const actor = customActor || getCurrentActorLabel();
  if (!record.createdAt) record.createdAt = nowIso;
  if (!record.createdBy) record.createdBy = actor;
  if (!Array.isArray(record.auditLog)) record.auditLog = [];
  record.auditLog.push({
    action: actionText,
    actor: actor,
    timestamp: nowIso
  });
}
window.appendAuditEntry = appendAuditEntry;

function renderAuditTrailHtml(record) {
  if (!record) return "";
  const rows = [];
  if (record.createdAt || record.createdBy) {
    rows.push(
      "<div>📝 <b>Erstellt / Gemeldet:</b> " +
      (record.createdAt ? formatAuditTimestampDe(record.createdAt) : "Dokumentiert") +
      (record.createdBy ? " · <b>" + record.createdBy + "</b>" : "") +
      "</div>"
    );
  }
  if (record.reviewedBy || record.reviewedAt) {
    const actionLabel = record.status === "approved"
      ? "Bestätigt / Genehmigt"
      : (record.status === "counter_offer" ? "Teilgenehmigt / Gegenangebot" : (record.status === "rejected" ? "Abgelehnt" : "Geprüft"));
    rows.push(
      "<div style='color:#0f172a;'>🛡️ <b>" + actionLabel + ":</b> " +
      (record.reviewedAt ? formatAuditTimestampDe(record.reviewedAt) : "") +
      (record.reviewedBy ? " durch <b>" + record.reviewedBy + "</b>" : "") +
      "</div>"
    );
  }
  if (Array.isArray(record.auditLog) && record.auditLog.length > 0) {
    const recentLogs = record.auditLog.slice(-2);
    recentLogs.forEach(entry => {
      if (!entry || !entry.action) return;
      rows.push(
        "<div style='color:#0369a1;'>🕒 " + entry.action + " — <b>" + (entry.actor || "System") + "</b> (" + formatAuditTimestampDe(entry.timestamp) + ")</div>"
      );
    });
  }
  if (!rows.length) return "";
  return "<div class='audit-trail-box'>" + rows.join("") + "</div>";
}
window.renderAuditTrailHtml = renderAuditTrailHtml;

function getWeekdayShortDe(dateIso) {
  const norm = window.normalizeDateIso(dateIso);
  if (!norm) return "";
  const d = new Date(norm + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()];
}
window.getWeekdayShortDe = getWeekdayShortDe;

function isIsoDateSunday(dateIso) {
  const norm = window.normalizeDateIso(dateIso);
  if (!norm) return false;
  const d = new Date(norm + "T00:00:00");
  return !isNaN(d.getTime()) && d.getDay() === 0;
}
window.isIsoDateSunday = isIsoDateSunday;

function getIsoWeekNumber(d) {
  const dateObj = d instanceof Date ? new Date(d.valueOf()) : new Date();
  const dayNr = (dateObj.getDay() + 6) % 7;
  dateObj.setDate(dateObj.getDate() - dayNr + 3);
  const firstThursday = dateObj.valueOf();
  dateObj.setMonth(0, 1);
  if (dateObj.getDay() !== 4) {
    dateObj.setMonth(0, 1 + (((4 - dateObj.getDay()) + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - dateObj.valueOf()) / 604800000);
}
window.getIsoWeekNumber = getIsoWeekNumber;

function fullName(emp) {
  if (!emp) return "Unbekannt";
  return ((emp.firstName || "") + " " + (emp.lastName || "")).trim() || "Mitarbeiter";
}
window.fullName = fullName;

function getShortLineNumber(lineId) {
  if (!lineId) return "";
  const lObj = lines.find(l => l.id === lineId);
  const base = lObj ? lObj.name : String(lineId);
  return base.replace(/^Linie\s*/i, "").replace(/^L_?/i, "").trim() || String(lineId);
}
window.getShortLineNumber = getShortLineNumber;

function extractShiftIdFromZone(zone) {
  if (!zone || typeof zone !== "string") return null;
  const m = zone.match(/_(frueh|spaet|nacht)$/);
  return m ? m[1] : null;
}
window.extractShiftIdFromZone = extractShiftIdFromZone;

function extractLineIdFromZone(zone) {
  if (!zone || typeof zone !== "string") return null;
  const m = zone.match(/^(.+)_(frueh|spaet|nacht)$/);
  return m ? m[1] : null;
}
window.extractLineIdFromZone = extractLineIdFromZone;

function getLineTotalTarget(lObj) {
  if (!lObj || lObj.ausgeplant) return 0;
  const rt = lObj.roleTargets || { Bediener: 2, LOP: 1 };
  return Object.keys(rt).reduce((acc, r) => acc + (parseInt(rt[r], 10) || 0), 0);
}
window.getLineTotalTarget = getLineTotalTarget;

function getLineRoleSummaryText(lObj) {
  if (!lObj) return "";
  const rt = lObj.roleTargets || { Bediener: 2, LOP: 1 };
  const parts = [];
  roles.forEach(r => {
    const cnt = parseInt(rt[r], 10) || 0;
    if (cnt > 0) {
      const shortR = r === "Bediener" ? "Bed." : (r === "Schichtexperte" ? "SE" : (r === "Waschraumoperator" ? "WR" : r));
      parts.push(cnt + " " + shortR);
    }
  });
  const total = getLineTotalTarget(lObj);
  return (parts.length ? parts.join(" · ") : "0") + " (Σ " + total + ")";
}
window.getLineRoleSummaryText = getLineRoleSummaryText;

window.doesRoleRequireLines = function(roleName) {
  const r = roleName || "Bediener";
  if (shiftModelConfig.roleRequiresLines && typeof shiftModelConfig.roleRequiresLines[r] === "boolean") {
    return shiftModelConfig.roleRequiresLines[r];
  }
  return r === "Bediener" || r === "LOP";
};

window.canRoleBeAssignedToLine = function(roleName) {
  const r = roleName || "Bediener";
  if (shiftModelConfig.roleAllowLineAssign && typeof shiftModelConfig.roleAllowLineAssign[r] === "boolean") {
    return shiftModelConfig.roleAllowLineAssign[r];
  }
  return r === "Bediener" || r === "LOP";
};

function isEmpAnchorActiveToday(emp, todayIso) {
  if (!emp || !emp.noRotation) return false;
  const norm = window.normalizeDateIso(todayIso || getLogicalDateIso());
  const d = new Date(norm + "T00:00:00");
  if (isNaN(d.getTime())) return false;
  const fixDays = Array.isArray(emp.fixDays) ? emp.fixDays : [1, 2, 3, 4, 5];
  return fixDays.indexOf(d.getDay()) !== -1;
}
window.isEmpAnchorActiveToday = isEmpAnchorActiveToday;

function showToast(msg, isError) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.style.background = isError ? "#b91c1c" : "#10384f";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}
window.showToast = showToast;

function showTimedBoxMsg(boxId, msg, isSuccess) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.textContent = msg;
  box.style.display = "block";
  box.style.background = isSuccess ? "#f0fdf4" : "#fef2f2";
  box.style.color = isSuccess ? "#166534" : "#dc2626";
  box.style.border = "1px solid " + (isSuccess ? "#86efac" : "#fecaca");
  setTimeout(() => { box.style.display = "none"; }, 4200);
}
window.showTimedBoxMsg = showTimedBoxMsg;

window.closeModal = function(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.style.display = "none";
};

function addHistoryLog(text, category) {
  const actor = getCurrentActorLabel();
  historyLogs.unshift({
    id: "hl_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    timestamp: new Date().toISOString(),
    actor: actor,
    category: category || "SHIFT",
    text: text
  });
  if (historyLogs.length > 500) historyLogs = historyLogs.slice(0, 500);
}
window.addHistoryLog = addHistoryLog;

window.resetPlanerActivity = function() {
  if (isPlanner) {
    sessionStorage.setItem("planner_last_active", String(Date.now()));
  }
};
["click", "keydown", "mousemove", "touchstart"].forEach(ev => {
  document.addEventListener(ev, () => {
    if (isPlanner) sessionStorage.setItem("planner_last_active", String(Date.now()));
  }, { passive: true });
});

/* ==========================================================================
   2. 2-2-2 VOLLKONTI-ROTATION (SONNTAG FREI) & ZEITGESTEUERTE AUTOMATIK
   ========================================================================== */

function getEpochDays(dateIso) {
  const norm = window.normalizeDateIso(dateIso);
  const d = new Date(norm + "T12:00:00");
  return Math.floor(d.getTime() / 86400000);
}

function countNonSundayWorkdaysBetween(startIso, endIso) {
  const sNorm = window.normalizeDateIso(startIso);
  const eNorm = window.normalizeDateIso(endIso);
  if (!sNorm || !eNorm || sNorm === eNorm) return 0;
  const forward = eNorm > sNorm;
  const cur = new Date(sNorm + "T12:00:00");
  const target = new Date(eNorm + "T12:00:00");
  let steps = 0;
  while ((forward && cur < target) || (!forward && cur > target)) {
    if (forward) {
      cur.setDate(cur.getDate() + 1);
      if (cur.getDay() !== 0) steps++;
    } else {
      if (cur.getDay() !== 0) steps--;
      cur.setDate(cur.getDate() - 1);
    }
  }
  return steps;
}

function getWorkdayBlockIndex(dateIso) {
  const norm = window.normalizeDateIso(dateIso || getLogicalDateIso());
  const d = new Date(norm + "T12:00:00");
  if (d.getDay() === 0) {
    const sat = new Date(d.getTime() - 86400000);
    return getWorkdayBlockIndex(getLogicalDateIso(sat));
  }
  const refIso = shiftModelConfig.anchorReferenceDateIso || "2024-01-01";
  const workdaysDiff = countNonSundayWorkdaysBetween(refIso, norm);
  return Math.floor(workdaysDiff / 2);
}
window.getWorkdayBlockIndex = getWorkdayBlockIndex;

function getBlockDayInfo(dateIso) {
  const norm = window.normalizeDateIso(dateIso || getLogicalDateIso());
  const d = new Date(norm + "T12:00:00");
  const isSun = (d.getDay() === 0);
  const bIdx = getWorkdayBlockIndex(norm);

  let nextChangeIso = norm;
  for (let i = 1; i <= 7; i++) {
    const cand = new Date(d.getTime() + i * 86400000);
    const candIso = cand.getFullYear() + "-" + String(cand.getMonth() + 1).padStart(2, "0") + "-" + String(cand.getDate()).padStart(2, "0");
    if (cand.getDay() !== 0 && getWorkdayBlockIndex(candIso) !== bIdx) {
      nextChangeIso = candIso;
      break;
    }
  }

  return {
    isSunday: isSun,
    blockIndex: bIdx,
    blockLabel: isSun ? "Sonntag (Regulär Frei)" : ("2-Tage-Block #" + (bIdx + 1)),
    nextChangeIso: nextChangeIso
  };
}
window.getBlockDayInfo = getBlockDayInfo;

function isTeamRotating(teamKey) {
  return teamsConfig[teamKey] ? teamsConfig[teamKey].rotates !== false : true;
}
window.isTeamRotating = isTeamRotating;

function getRotationForDate(dateIso) {
  const norm = window.normalizeDateIso(dateIso || getLogicalDateIso());
  if (isIsoDateSunday(norm)) {
    return { frueh: "", spaet: "", nacht: "", frei: shiftRotation.frei || "team_4" };
  }
  const todayIso = getLogicalDateIso();
  const curBlock = getWorkdayBlockIndex(todayIso);
  const targetBlock = getWorkdayBlockIndex(norm);
  const blockDelta = targetBlock - curBlock;

  const slotOrder = ["frueh", "spaet", "nacht", "frei"];
  const activeSlots = slotOrder.filter(s => shiftRotation[s] && isTeamRotating(shiftRotation[s]));
  if (activeSlots.length < 2 || blockDelta === 0) {
    return Object.assign({}, shiftRotation);
  }

  const len = activeSlots.length;
  const rotated = Object.assign({}, shiftRotation);
  activeSlots.forEach((fromSlot, idx) => {
    const toIdx = (((idx + blockDelta) % len) + len) % len;
    const targetSlot = activeSlots[toIdx];
    rotated[targetSlot] = shiftRotation[fromSlot];
  });
  return rotated;
}
window.getRotationForDate = getRotationForDate;

window.syncCurrentBoardAs222Anchor = function() {
  const todayIso = getLogicalDateIso();
  shiftModelConfig.anchorReferenceDateIso = todayIso;
  shiftModelConfig.anchorShiftRotation = Object.assign({}, shiftRotation);
  shiftModelConfig.lastRotationBlockIndex = getWorkdayBlockIndex(todayIso);
  addHistoryLog("Aktuelle Team-Aufstellung als 2-2-2 Start-Anker gespeichert (" + formatDateDe(todayIso) + ")", "SHIFT");
  if (!isIsoDateSunday(todayIso)) {
    window.smartAssignAllShifts(true);
  }
  saveToFirebase();
  window.initBoard();
  showToast("✅ Aktuelle Team-Aufstellung als 2-2-2 Start-Anker gespeichert!");
};

window.updateHeaderDateKw = function() {
  const todayIso = getLogicalDateIso();
  const dObj = new Date(todayIso + "T12:00:00");
  const dateEl = document.getElementById("currentDateText");
  const kwEl = document.getElementById("currentKwText");
  if (dateEl) dateEl.textContent = getWeekdayShortDe(todayIso) + ", " + formatDateDe(todayIso);
  if (kwEl) kwEl.textContent = "KW " + getIsoWeekNumber(dObj) + " · v4.9.69";
};

window.updateAutoRotationUI = function() {
  const rotBtn = document.getElementById("autoRotateToggleBtn");
  const rotTxt = document.getElementById("autoRotateToggleText");
  if (rotBtn && rotTxt) {
    const on = shiftModelConfig.autoRotate !== false;
    rotBtn.className = "auto-rotate-pill planner-only-lvl3 " + (on ? "on" : "off");
    rotTxt.textContent = "Auto-Rotation: " + (on ? "AN" : "AUS");
  }

  const smartBtn = document.getElementById("smartAssignHeaderBtn");
  const smartTxt = document.getElementById("smartAssignHeaderText");
  if (smartBtn && smartTxt) {
    const on = shiftModelConfig.smartAssignEnabled !== false;
    smartBtn.className = "auto-rotate-pill planner-only-lvl3 " + (on ? "on" : "off");
    smartTxt.textContent = "Auto-Zuweisung: " + (on ? "AN" : "AUS");
  }

  const timedBtn = document.getElementById("timedAutoHeaderBtn");
  const timedTxt = document.getElementById("timedAutoHeaderText");
  if (timedBtn && timedTxt) {
    const on = !!(shiftModelConfig.resetEnabled || shiftModelConfig.loadEnabled);
    timedBtn.className = "auto-rotate-pill planner-only-lvl3 " + (on ? "on" : "off");
    timedTxt.textContent = "Auto-Reset/Verteilen: " + (on ? "AN" : "AUS");
  }
};

window.toggleAutoRotationQuick = function() {
  shiftModelConfig.autoRotate = !(shiftModelConfig.autoRotate !== false);
  saveToFirebase();
  window.updateAutoRotationUI();
  showToast("Automatische 2-2-2 Rotation: " + (shiftModelConfig.autoRotate ? "AN" : "AUS"));
};

window.toggleSmartAssignQuick = function() {
  shiftModelConfig.smartAssignEnabled = !(shiftModelConfig.smartAssignEnabled !== false);
  saveToFirebase();
  window.updateAutoRotationUI();
  showToast("Intelligente Auto-Zuweisung: " + (shiftModelConfig.smartAssignEnabled ? "AN" : "AUS"));
};

/* Behält eingestellte Wochentage (z.B. Sonntag 06:00 Uhr / Montag 05:00 Uhr) exakt bei! */
window.toggleTimedAutoQuick = function() {
  const currentlyOn = !!(shiftModelConfig.resetEnabled || shiftModelConfig.loadEnabled);
  shiftModelConfig.resetEnabled = !currentlyOn;
  shiftModelConfig.loadEnabled = !currentlyOn;
  saveToFirebase();
  window.updateAutoRotationUI();
  window.syncShiftModelSettingsUI();
  showToast("Zeitgesteuertes Leeren & Verteilen: " + (!currentlyOn ? "AN" : "AUS"));
};

function checkScheduledAutomations() {
  if (!hasLoadedFromCloud || isRunningAutoTransition) return false;
  const now = new Date();
  const realDateIso = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  const prodTodayIso = getLogicalDateIso(now);
  const curDayOfWeek = now.getDay();
  const curHour = now.getHours();
  let didChange = false;

  isRunningAutoTransition = true;
  try {
    /* 1. Automatischer Ablauf des Stamm-Schutzes prüfen */
    employees.forEach(emp => {
      if (emp.inTrainingPhase) {
        const before = emp.inTrainingPhase;
        window.getEmpTrainingProtectionInfo(emp, prodTodayIso);
        if (before && !emp.inTrainingPhase) {
          addHistoryLog("Stamm-Schutz für " + fullName(emp) + " ist nach Ablauf der Schutz-Tage automatisch ausgelaufen", "EMP");
          didChange = true;
        }
      }
    });

    /* 2. 2-2-2 Block-Wechsel (ab 05:00 Uhr an Werktagen Mo–Sa) */
    if (!isIsoDateSunday(prodTodayIso) && shiftModelConfig.autoRotate !== false) {
      const curBlockIdx = getWorkdayBlockIndex(prodTodayIso);
      if (typeof shiftModelConfig.lastRotationBlockIndex === "number" && shiftModelConfig.lastRotationBlockIndex !== curBlockIdx) {
        const steps = Math.min(4, Math.max(1, Math.abs(curBlockIdx - shiftModelConfig.lastRotationBlockIndex)));
        for (let s = 0; s < steps; s++) {
          window.performShiftRotationLogic(true);
        }
        shiftModelConfig.lastRotationBlockIndex = curBlockIdx;
        if (shiftModelConfig.smartAssignEnabled !== false) {
          window.smartAssignAllShifts(true);
        }
        addHistoryLog("Automatischer 2-2-2 Block-Wechsel auf Block #" + (curBlockIdx + 1) + " durchgeführt", "AUTO");
        didChange = true;
      }
    }

    /* 3. Zeitgesteuertes Pool-Leeren (respektiert auch Sonntag = 0 um z.B. 06:00 Uhr!) */
    if (shiftModelConfig.resetEnabled) {
      const targetResetDay = Number(shiftModelConfig.resetDay ?? -1);
      const targetResetHour = Number(shiftModelConfig.resetHour ?? 5);
      const dayMatches = (targetResetDay === -1) ? (curDayOfWeek !== 0) : (curDayOfWeek === targetResetDay);
      const triggerKey = realDateIso + "_R_" + targetResetHour;

      if (dayMatches && curHour >= targetResetHour && shiftModelConfig.lastAutoResetTriggerKey !== triggerKey) {
        shiftModelConfig.lastAutoResetTriggerKey = triggerKey;
        employees.forEach(e => {
          if (e.zone && ["pool", "absent", "extra"].indexOf(e.zone) === -1 && !isEmpAnchorActiveToday(e, prodTodayIso)) {
            e.zone = "pool";
          }
        });
        addHistoryLog("Zeitgesteuerte Automatik: Mitarbeiter um " + targetResetHour + ":00 Uhr in den Pool geschickt", "AUTO");
        didChange = true;
      }
    }

    /* 4. Zeitgesteuertes Team-Verteilen (respektiert z.B. Montag = 1 um 05:00 Uhr!) */
    if (shiftModelConfig.loadEnabled) {
      const targetLoadDay = Number(shiftModelConfig.loadDay ?? -1);
      const targetLoadHour = Number(shiftModelConfig.loadHour ?? 5);
      const dayMatches = (targetLoadDay === -1) ? (curDayOfWeek !== 0) : (curDayOfWeek === targetLoadDay);
      const triggerKey = realDateIso + "_L_" + targetLoadHour;

      if (dayMatches && curHour >= targetLoadHour && shiftModelConfig.lastAutoLoadTriggerKey !== triggerKey) {
        shiftModelConfig.lastAutoLoadTriggerKey = triggerKey;
        if (!isIsoDateSunday(prodTodayIso)) {
          window.smartAssignAllShifts(true);
          addHistoryLog("Zeitgesteuerte Automatik: Teams um " + targetLoadHour + ":00 Uhr automatisch auf Linien verteilt", "AUTO");
          didChange = true;
        }
      }
    }

    if (didChange) {
      saveToFirebase();
      window.initBoard();
    }
  } finally {
    isRunningAutoTransition = false;
  }
  return didChange;
}
window.checkScheduledAutomations = checkScheduledAutomations;

setInterval(() => {
  if (hasLoadedFromCloud && !isDraggingCard) {
    window.syncAbsentAndExtraZones();
    checkScheduledAutomations();
  }
}, 60000);

/* ==========================================================================
   3. QUALIFIKATIONS-STUNDENZÄHLER, MULTI-ANLAGEN-HISTORIE & STAMM-SCHUTZ
   ========================================================================== */

window.getEmpTrainingProtectionInfo = function(emp, todayIso) {
  if (!emp || !emp.inTrainingPhase) {
    return { active: false, remainingDays: 0, mainPct: 90, startDate: "" };
  }
  const normToday = window.normalizeDateIso(todayIso || getLogicalDateIso());
  const startIso = window.normalizeDateIso(emp.trainingStartDate || normToday);
  const startMs = new Date(startIso + "T12:00:00").getTime();
  const nowMs = new Date(normToday + "T12:00:00").getTime();
  const elapsedDays = Math.max(0, Math.floor((nowMs - startMs) / 86400000));
  const totalDays = Math.max(1, parseInt(emp.trainingDays, 10) || 360);
  const mainPct = Math.min(100, Math.max(50, parseInt(emp.trainingMainPct, 10) || 90));

  /* Automatischer Rauswurf des Stamm-Schutzes nach Ablauf der Tage */
  if (elapsedDays >= totalDays) {
    emp.inTrainingPhase = false;
    return { active: false, remainingDays: 0, mainPct: mainPct, startDate: startIso };
  }

  return {
    active: true,
    startDate: startIso,
    remainingDays: Math.max(0, totalDays - elapsedDays),
    mainPct: mainPct
  };
};

function trackEmployeeLineAssignment(emp, lineId, todayIso) {
  if (!emp || !lineId) return;
  const normToday = window.normalizeDateIso(todayIso || getLogicalDateIso());
  if (!emp.lineHistory || typeof emp.lineHistory !== "object") emp.lineHistory = {};
  if (!emp.lineAssignCounts || typeof emp.lineAssignCounts !== "object") emp.lineAssignCounts = {};
  emp.lineHistory[lineId] = normToday;
  emp.lineAssignCounts[lineId] = (Number(emp.lineAssignCounts[lineId]) || 0) + 1;
}
window.trackEmployeeLineAssignment = trackEmployeeLineAssignment;

function isEmployeeQualifiedForLine(emp, lineId) {
  if (!emp || !lineId) return false;
  const mainArr = Array.isArray(emp.mainLines) ? emp.mainLines : [];
  const secArr = Array.isArray(emp.secLines) ? emp.secLines : [];
  return mainArr.indexOf(lineId) !== -1 || secArr.indexOf(lineId) !== -1;
}
window.isEmployeeQualifiedForLine = isEmployeeQualifiedForLine;

/* Speichert Einarbeitungsstunden tagesgenau und behält ALLE besuchten Lern-Anlagen in der Historie! */
window.recordManualAssignmentHours = function(empId, lineId, plannedHours, isClearOrPool) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  if (!emp.trainingHoursByLine || typeof emp.trainingHoursByLine !== "object") emp.trainingHoursByLine = {};
  if (!emp.trainingCreditedDates || typeof emp.trainingCreditedDates !== "object") emp.trainingCreditedDates = {};
  if (!emp.lineHistory || typeof emp.lineHistory !== "object") emp.lineHistory = {};

  const todayIso = getLogicalDateIso();
  const prevTodayCredit = emp.trainingCreditedDates[todayIso];

  /* Wenn der Mitarbeiter heute bereits auf einer anderen Lern-Anlage gebucht war und umgesetzt wird:
     Nur die heutigen Stunden von der vorherigen Anlage abziehen, aber die Historie NIEMALS löschen! */
  if (prevTodayCredit && prevTodayCredit.lineId && prevTodayCredit.lineId !== lineId) {
    const oldL = prevTodayCredit.lineId;
    const oldHrs = Number(prevTodayCredit.hours) || 0;
    const curTotalOld = Number(emp.trainingHoursByLine[oldL]) || 0;
    emp.trainingHoursByLine[oldL] = Math.max(0, Math.round((curTotalOld - oldHrs) * 10) / 10);
    delete emp.trainingCreditedDates[todayIso];
  }

  if (isClearOrPool || !lineId) {
    if (prevTodayCredit && prevTodayCredit.lineId) {
      const oldL = prevTodayCredit.lineId;
      const oldHrs = Number(prevTodayCredit.hours) || 0;
      const curTotalOld = Number(emp.trainingHoursByLine[oldL]) || 0;
      emp.trainingHoursByLine[oldL] = Math.max(0, Math.round((curTotalOld - oldHrs) * 10) / 10);
      delete emp.trainingCreditedDates[todayIso];
    }
    return;
  }

  /* Prüfen, ob diese Linie eine noch NICHT freigeschaltete Lern-Anlage ist */
  if (isEmployeeQualifiedForLine(emp, lineId)) {
    return;
  }

  const hrsToCredit = typeof plannedHours === "number" ? plannedHours : (Number(shiftModelConfig.defaultShiftHours) || 8);
  if (hrsToCredit < 6) return;

  emp.lineHistory[lineId] = todayIso;

  /* Falls heute noch nicht auf dieser Linie gutgeschrieben, jetzt gutschreiben */
  const activeCredit = emp.trainingCreditedDates[todayIso];
  if (!activeCredit || activeCredit.lineId !== lineId) {
    const beforeHrs = Number(emp.trainingHoursByLine[lineId]) || 0;
    const nextHrs = Math.round((beforeHrs + hrsToCredit) * 10) / 10;
    emp.trainingHoursByLine[lineId] = nextHrs;
    emp.trainingCreditedDates[todayIso] = { lineId: lineId, hours: hrsToCredit };

    const threshold = Number(shiftModelConfig.secondaryUnlockThresholdHours) || 160;
    if (beforeHrs < threshold && nextHrs >= threshold) {
      window.triggerSecLineUnlockPrompt(emp.id, lineId, nextHrs);
    }
  }
};

window.adjustEmpTrainingHoursManual = function(empId, lineId, deltaHours) {
  const emp = employees.find(e => e.id === empId);
  if (!emp || !lineId) return;
  if (!emp.trainingHoursByLine) emp.trainingHoursByLine = {};
  if (!emp.lineHistory) emp.lineHistory = {};
  const cur = Number(emp.trainingHoursByLine[lineId]) || 0;
  const next = Math.max(0, Math.round((cur + Number(deltaHours)) * 10) / 10);
  emp.trainingHoursByLine[lineId] = next;
  emp.lineHistory[lineId] = getLogicalDateIso();

  const lObj = lines.find(l => l.id === lineId);
  addHistoryLog("Lernstunden für " + fullName(emp) + " an " + (lObj ? lObj.name : lineId) + " auf " + next + "h angepasst", "EMP");
  saveToFirebase();
  renderEmployees();
  renderUnqualifiedHoursOverview();

  const threshold = Number(shiftModelConfig.secondaryUnlockThresholdHours) || 160;
  if (cur < threshold && next >= threshold) {
    window.triggerSecLineUnlockPrompt(emp.id, lineId, next);
  }
};

window.triggerSecLineUnlockPrompt = function(empId, lineId, hoursVal) {
  const emp = employees.find(e => e.id === empId);
  const line = lines.find(l => l.id === lineId);
  if (!emp || !line) return;

  window._pendingUnlockEmpId = emp.id;
  window._pendingUnlockLineId = line.id;

  const txtEl = document.getElementById("secLineUnlockText");
  if (txtEl) {
    txtEl.innerHTML =
      "Mitarbeiter <b>" + fullName(emp) + "</b> hat an der Anlage <b>" + line.name + "</b> inzwischen <b>" + hoursVal + " Stunden</b> gesammelt " +
      "(Schwellenwert: " + (shiftModelConfig.secondaryUnlockThresholdHours || 160) + "h).<br><br>" +
      "Soll <b>" + line.name + "</b> jetzt offiziell im Profil freigeschaltet werden?";
  }
  const modal = document.getElementById("secLineUnlockModal");
  if (modal) modal.style.display = "flex";
};

window.confirmSecLineUnlock = function(actionType) {
  const empId = window._pendingUnlockEmpId;
  const lineId = window._pendingUnlockLineId;
  const emp = employees.find(e => e.id === empId);
  const line = lines.find(l => l.id === lineId);

  if (emp && lineId) {
    if (!Array.isArray(emp.mainLines)) emp.mainLines = [];
    if (!Array.isArray(emp.secLines)) emp.secLines = [];
    if (!emp.trainingHoursByLine) emp.trainingHoursByLine = {};
    const lName = line ? line.name : lineId;

    if (actionType === "sec") {
      if (emp.secLines.indexOf(lineId) === -1) emp.secLines.push(lineId);
      emp.mainLines = emp.mainLines.filter(id => id !== lineId);
      addHistoryLog(fullName(emp) + ": " + lName + " als Sekundärlinie freigeschaltet (" + (emp.trainingHoursByLine[lineId] || 0) + "h)", "EMP");
      showToast("✅ " + lName + " als Sekundärlinie für " + fullName(emp) + " freigeschaltet!");
    } else if (actionType === "main") {
      if (emp.mainLines.indexOf(lineId) === -1) emp.mainLines.push(lineId);
      emp.secLines = emp.secLines.filter(id => id !== lineId);
      addHistoryLog(fullName(emp) + ": " + lName + " als Prio-Stammlinie freigeschaltet (" + (emp.trainingHoursByLine[lineId] || 0) + "h)", "EMP");
      showToast("⭐ " + lName + " als Prio-Stammlinie für " + fullName(emp) + " freigeschaltet!");
    } else if (actionType === "reset") {
      delete emp.trainingHoursByLine[lineId];
      if (emp.trainingCreditedDates) {
        Object.keys(emp.trainingCreditedDates).forEach(dKey => {
          if (emp.trainingCreditedDates[dKey] && emp.trainingCreditedDates[dKey].lineId === lineId) {
            delete emp.trainingCreditedDates[dKey];
          }
        });
      }
      addHistoryLog("Stundenzähler für " + fullName(emp) + " an " + lName + " auf 0h zurückgesetzt", "EMP");
      showToast("🔄 Stundenzähler für " + lName + " zurückgesetzt");
    }
  }

  window._pendingUnlockEmpId = null;
  window._pendingUnlockLineId = null;
  window.closeModal("secLineUnlockModal");
  saveToFirebase();
  renderEmployees();
  renderSettingsLists();
};

window.confirmSecLineUnlockQuick = function(empId, lineId, mode) {
  window._pendingUnlockEmpId = empId;
  window._pendingUnlockLineId = lineId;
  window.confirmSecLineUnlock(mode);
};

/* Gruppierte Multi-Anlagen-Historie im Einstellungs-Menü:
   Zeigt unter jedem Mitarbeiter (z.B. Test 3 B) ALLE besuchten Lern-Anlagen untereinander an! */
function renderUnqualifiedHoursOverview() {
  const container = document.getElementById("unqualifiedHoursOverviewList");
  if (!container) return;
  const threshold = Math.max(6, Number(shiftModelConfig.secondaryUnlockThresholdHours) || 160);
  const focusQuote = Math.min(100, Math.max(5, Number(shiftModelConfig.focusModePercent) || 20));
  const shiftHrs = Math.max(1, Number(shiftModelConfig.defaultShiftHours) || 8);

  const empBlocksHtml = [];

  employees.forEach(emp => {
    const hoursMap = emp.trainingHoursByLine || {};
    const historyMap = emp.lineHistory || {};
    const curActiveLineId = extractLineIdFromZone(emp.zone);

    /* Alle fremden Linien sammeln, an denen der Mitarbeiter Stunden > 0 hat oder gerade lernt */
    const candidateLineIds = Array.from(new Set(
      Object.keys(hoursMap).concat(curActiveLineId ? [curActiveLineId] : [])
    )).filter(lId => {
      if (!lId) return false;
      if (isEmployeeQualifiedForLine(emp, lId)) return false;
      const hrs = Number(hoursMap[lId]) || 0;
      return hrs > 0 || curActiveLineId === lId;
    });

    if (!candidateLineIds.length) return;

    /* Sortieren: Aktuell besetzte Linie zuerst, danach absteigend nach gelernten Stunden */
    candidateLineIds.sort((a, b) => {
      if (a === curActiveLineId) return -1;
      if (b === curActiveLineId) return 1;
      return (Number(hoursMap[b]) || 0) - (Number(hoursMap[a]) || 0);
    });

    const tObj = teamsConfig[emp.team] || { name: emp.team, color: "#0284c7" };

    const lineItemsHtml = candidateLineIds.map(lId => {
      const lObj = lines.find(l => l.id === lId);
      const lName = lObj ? lObj.name : lId;
      const hrs = Math.round((Number(hoursMap[lId]) || 0) * 10) / 10;
      const rem = Math.max(0, Math.round((threshold - hrs) * 10) / 10);
      const pct = Math.min(100, Math.round((hrs / threshold) * 100));
      const isHereNow = (curActiveLineId === lId);
      const lastDateStr = historyMap[lId] ? formatDateDe(historyMap[lId]) : "";

      const statusBadge = isHereNow
        ? '<span style="background:#dcfce7; color:#166534; border:1px solid #86efac; padding:1px 6px; border-radius:999px; font-size:0.65rem; font-weight:700;">🟢 Aktuell hier eingeteilt</span>'
        : '<span style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; padding:1px 6px; border-radius:999px; font-size:0.65rem; font-weight:600;">🕒 Historie' + (lastDateStr ? ' (zuletzt ' + lastDateStr + ')' : '') + '</span>';

      return (
        '<div class="emp-history-line-item" style="' + (isHereNow ? 'border-color:#86efac; background:#f0fdf4;' : '') + '">' +
          '<div style="flex:1; min-width:210px;">' +
            '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:0.76rem;">' +
              '<b>➔ ' + lName + '</b> ' + statusBadge +
              '<span style="color:#0369a1; font-weight:700; font-size:0.7rem;">(' + pct + '% gelernt · 🎯 Fokus-Quote: ' + focusQuote + '%)</span>' +
            '</div>' +
            '<div style="width:100%; height:5px; background:#e2e8f0; border-radius:999px; overflow:hidden; margin-top:4px;">' +
              '<div style="width:' + pct + '%; height:100%; background:linear-gradient(90deg, #0284c7, #16a34a);"></div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">' +
            '<b style="font-size:0.75rem; color:#0f172a; margin-right:4px;">' + hrs + 'h / ' + threshold + 'h <span style="color:#64748b; font-weight:600;">(noch ' + rem + 'h)</span></b>' +
            '<button type="button" class="btn btn-outline" style="padding:1px 6px; font-size:0.68rem;" onclick="adjustEmpTrainingHoursManual(\'' + emp.id + '\', \'' + lId + '\', ' + shiftHrs + ')" title="+' + shiftHrs + 'h hinzufügen">+' + shiftHrs + 'h</button>' +
            '<button type="button" class="btn btn-outline" style="padding:1px 6px; font-size:0.68rem;" onclick="adjustEmpTrainingHoursManual(\'' + emp.id + '\', \'' + lId + '\', -' + shiftHrs + ')" title="-' + shiftHrs + 'h abziehen">-' + shiftHrs + 'h</button>' +
            '<button type="button" class="btn btn-outline" style="padding:1px 6px; font-size:0.68rem; color:#166534; border-color:#86efac;" onclick="confirmSecLineUnlockQuick(\'' + emp.id + '\', \'' + lId + '\', \'sec\')" title="Als Sekundärlinie freischalten">✓ Sek.</button>' +
            '<button type="button" class="btn btn-outline" style="padding:1px 6px; font-size:0.68rem; color:#dc2626; border-color:#fca5a5;" onclick="confirmSecLineUnlockQuick(\'' + emp.id + '\', \'' + lId + '\', \'reset\')" title="Stundenzähler dieser Linie auf 0h zurücksetzen">🔄 Reset</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");

    empBlocksHtml.push(
      '<div class="emp-history-card" style="border-left-color:' + tObj.color + ';">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.78rem;">' +
          '<div><span style="color:' + tObj.color + '; font-weight:800;">■</span> <b>👤 ' + fullName(emp) + '</b> <span style="color:#64748b; font-size:0.72rem;">(' + (emp.role || 'Bediener') + ' · ' + tObj.name + ')</span></div>' +
          '<span style="font-size:0.68rem; font-weight:700; color:#0369a1; background:#e0f2fe; padding:1px 7px; border-radius:999px;">📚 ' + candidateLineIds.length + (candidateLineIds.length === 1 ? ' Lern-Anlage' : ' Lern-Anlagen in Historie') + '</span>' +
        '</div>' +
        lineItemsHtml +
      '</div>'
    );
  });

  if (!empBlocksHtml.length) {
    container.innerHTML = '<p style="font-size:0.78rem; color:#64748b; padding:4px;">Aktuell keine Mitarbeiter mit offenen Lernstunden an noch nicht freigeschalteten Anlagen.</p>';
  } else {
    container.innerHTML = empBlocksHtml.join("");
  }
}
window.renderUnqualifiedHoursOverview = renderUnqualifiedHoursOverview;

/* ==========================================================================
   4. SCHICHT-FREIGABE, UNDO-SNAPSHOTS & BOARD-LOCK
   ========================================================================== */

function getShiftWindowKey() {
  const todayIso = getLogicalDateIso();
  const d = new Date(todayIso + "T12:00:00");
  return d.getFullYear() + "-KW" + getIsoWeekNumber(d) + "-" + todayIso;
}
window.getShiftWindowKey = getShiftWindowKey;

window.updateShiftApprovalUI = function() {
  const currentKey = getShiftWindowKey();
  const isApproved = (approvedShiftKey === currentKey);
  const pill = document.getElementById("shiftApprovalPill");
  const txt = document.getElementById("shiftApprovalText");
  const gradBar = document.getElementById("brandGradientBar");

  if (pill && txt) {
    if (isApproved) {
      pill.className = "shift-approval-pill approved";
      txt.textContent = "🟢 Freigegeben";
      if (gradBar) gradBar.className = "brand-gradient approved";
    } else {
      pill.className = "shift-approval-pill pending";
      txt.textContent = "🔴 Nicht freigegeben";
      if (gradBar) gradBar.className = "brand-gradient pending";
    }
  }
  window.checkBoardLockState();
};

window.toggleShiftApproval = function() {
  if (plannerLevel < 2) {
    showToast("Keine Berechtigung zur Freigabe!", true);
    return;
  }
  const currentKey = getShiftWindowKey();
  if (approvedShiftKey === currentKey) {
    approvedShiftKey = "";
    addHistoryLog("Schichtplan-Freigabe zurückgezogen", "SHIFT");
    showToast("Freigabe aufgehoben");
  } else {
    approvedShiftKey = currentKey;
    addHistoryLog("Schichtplan offiziell freigegeben", "SHIFT");
    showToast("🟢 Schichtplan freigegeben!");
  }
  saveToFirebase();
  window.updateShiftApprovalUI();
};

function createBoardSnapshotForUndo() {
  return {
    timestamp: Date.now(),
    shiftRotation: Object.assign({}, shiftRotation),
    empStates: employees.map(e => ({
      id: e.id,
      zone: e.zone,
      pinnedZone: e.pinnedZone,
      lastShiftId: e.lastShiftId
    }))
  };
}
window.createBoardSnapshotForUndo = createBoardSnapshotForUndo;

function activateUndoButtons(shiftId) {
  const hdrBtn = document.getElementById("btnUndoLastAction");
  if (hdrBtn) hdrBtn.classList.add("visible");
  if (shiftId) {
    const sBtn = document.getElementById("btnUndoShift_" + shiftId);
    if (sBtn) sBtn.classList.add("visible");
  } else {
    shifts.forEach(s => {
      const sBtn = document.getElementById("btnUndoShift_" + s.id);
      if (sBtn) sBtn.classList.add("visible");
    });
  }
}
window.activateUndoButtons = activateUndoButtons;

window.undoLastBoardSnapshot = function() {
  if (!lastBoardSnapshotForUndo) return;
  if (lastBoardSnapshotForUndo.shiftRotation) {
    shiftRotation = Object.assign({}, lastBoardSnapshotForUndo.shiftRotation);
  }
  (lastBoardSnapshotForUndo.empStates || []).forEach(st => {
    const emp = employees.find(e => e.id === st.id);
    if (emp) {
      emp.zone = st.zone;
      emp.pinnedZone = st.pinnedZone;
      emp.lastShiftId = st.lastShiftId;
    }
  });
  lastBoardSnapshotForUndo = null;
  const hdrBtn = document.getElementById("btnUndoLastAction");
  if (hdrBtn) hdrBtn.classList.remove("visible");
  shifts.forEach(s => {
    const sBtn = document.getElementById("btnUndoShift_" + s.id);
    if (sBtn) sBtn.classList.remove("visible");
  });
  addHistoryLog("Letzte Schicht-Aktion rückgängig gemacht", "SHIFT");
  saveToFirebase();
  window.initBoard();
  showToast("↩️ Letzte Änderung rückgängig gemacht!");
};

window.checkBoardLockState = function() {
  const unlockedSession = sessionStorage.getItem("viewer_board_unlocked") === "1";
  const locked = !!(securityConfig && securityConfig.boardPwEnabled && !isPlanner && !unlockedSession);
  document.body.classList.toggle("board-locked", locked);
  const overlay = document.getElementById("boardLockOverlay");
  if (overlay) overlay.style.display = locked ? "flex" : "none";
};

window.unlockBoardView = function() {
  const inp = document.getElementById("boardViewerPwInput");
  const err = document.getElementById("boardLockError");
  const pw = (securityConfig && securityConfig.boardPw) ? securityConfig.boardPw : "0110";
  if (inp && inp.value.trim() === pw) {
    sessionStorage.setItem("viewer_board_unlocked", "1");
    if (inp) inp.value = "";
    if (err) err.style.display = "none";
    window.checkBoardLockState();
    showToast("🔓 Ansicht entsperrt!");
  } else if (err) {
    err.style.display = "block";
  }
};

window.openPlannerLoginFromLock = function() {
  const overlay = document.getElementById("boardLockOverlay");
  if (overlay) overlay.style.display = "none";
  window.handleLogoClick();
};

window.sanitizeTeamReferences = function() {
  const keys = Object.keys(teamsConfig).sort();
  if (!keys.length) {
    teamsConfig = { team_1: { name: "Team 1", color: "#3b82f6", rotates: true } };
  }
  const validKeys = Object.keys(teamsConfig).sort();
  employees.forEach(e => {
    if (!e.team || !teamsConfig[e.team]) e.team = validKeys[0];
  });
  ["frueh", "spaet", "nacht", "frei"].forEach((s, idx) => {
    if (!shiftRotation[s] || !teamsConfig[shiftRotation[s]]) {
      shiftRotation[s] = validKeys[idx % validKeys.length];
    }
  });
};

/* ==========================================================================
   5. ABWESENHEITEN, BRINGSCHICHTEN (1h VORLAUF) & PLAUSIBILITÄTS-PRÜFUNG
   ========================================================================== */

window.toggleManualEntryBox = function(forceState) {
  const box = document.getElementById("manualSickEntryBox");
  if (!box) return;
  const show = typeof forceState === "boolean" ? forceState : (box.style.display === "none" || !box.style.display);
  box.style.display = show ? "flex" : "none";
  if (show) {
    const today = getLogicalDateIso();
    const s = document.getElementById("manualSickStart");
    const e = document.getElementById("manualSickEnd");
    if (s && !s.value) s.value = today;
    if (e && !e.value) e.value = today;
  }
};

window.toggleManualExtraBox = function(forceState) {
  const box = document.getElementById("manualExtraEntryBox");
  if (!box) return;
  const show = typeof forceState === "boolean" ? forceState : (box.style.display === "none" || !box.style.display);
  box.style.display = show ? "flex" : "none";
  if (show) {
    const today = getLogicalDateIso();
    const d = document.getElementById("manualExtraDate");
    if (d && !d.value) d.value = today;
  }
};

function isLeaveActiveOnDate(sl, dateIso) {
  if (!sl || sl.isOnboardingNotice || sl.lineRequestData) return false;
  if (sl.status === "rejected" || sl.status === "pending") return false;
  const norm = window.normalizeDateIso(dateIso);
  if (Array.isArray(sl.blocks) && sl.blocks.length > 0) {
    return sl.blocks.some(b => b.status === "approved" && norm >= window.normalizeDateIso(b.start) && norm <= window.normalizeDateIso(b.end));
  }
  return sl.status === "approved" && norm >= window.normalizeDateIso(sl.startDate) && norm <= window.normalizeDateIso(sl.endDate);
}
window.isLeaveActiveOnDate = isLeaveActiveOnDate;

window.hasLeaveOverlap = function(empId, startIso, endIso, ignoreLeaveId) {
  const sNorm = window.normalizeDateIso(startIso);
  const eNorm = window.normalizeDateIso(endIso);
  if (!empId || !sNorm || !eNorm) return false;
  return (sickLeaves || []).some(sl => {
    if (!sl || sl.empId !== empId || sl.id === ignoreLeaveId) return false;
    if (sl.isOnboardingNotice || sl.lineRequestData || sl.status === "rejected") return false;
    const slStart = window.normalizeDateIso(sl.startDate);
    const slEnd = window.normalizeDateIso(sl.endDate);
    return sNorm <= slEnd && eNorm >= slStart;
  });
};

function getEmployeeRegularShiftOnDate(emp, dateIso) {
  if (!emp) return "frei";
  const norm = window.normalizeDateIso(dateIso);
  if (isIsoDateSunday(norm)) return "frei";
  if (emp.noRotation) {
    const d = new Date(norm + "T12:00:00");
    const fix = Array.isArray(emp.fixDays) ? emp.fixDays : [1, 2, 3, 4, 5];
    if (fix.indexOf(d.getDay()) === -1) return "frei";
    return extractShiftIdFromZone(emp.pinnedZone) || emp.lastShiftId || "frueh";
  }
  const rot = getRotationForDate(norm);
  for (const s of ["frueh", "spaet", "nacht"]) {
    if (rot[s] === emp.team) return s;
  }
  return "frei";
}
window.getEmployeeRegularShiftOnDate = getEmployeeRegularShiftOnDate;

window.checkExtraShiftPlausibility = function(empId, dateIso, shiftId, ignoreExtraId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return { ok: false, reason: "Mitarbeiter nicht gefunden" };
  const norm = window.normalizeDateIso(dateIso);
  if (!norm) return { ok: false, reason: "Ungültiges Datum" };

  const activeLeave = (sickLeaves || []).find(sl => sl.empId === emp.id && isLeaveActiveOnDate(sl, norm));
  if (activeLeave) {
    return { ok: false, reason: "An diesem Tag als abwesend/Urlaub eingetragen (" + (activeLeave.category || "Abwesend") + ")" };
  }

  const regShift = getEmployeeRegularShiftOnDate(emp, norm);
  if (regShift !== "frei") {
    return { ok: false, reason: "Regulär in " + (shiftsLabel[regShift] || regShift) + " eingeplant" };
  }

  /* 11h Ruhezeit-Prüfung (Vortag Nacht -> Früh/Spät oder Folgetag Früh nach Nacht) */
  const dObj = new Date(norm + "T12:00:00");
  const prevD = new Date(dObj.getTime() - 86400000);
  const nextD = new Date(dObj.getTime() + 86400000);
  const prevIso = prevD.getFullYear() + "-" + String(prevD.getMonth() + 1).padStart(2, "0") + "-" + String(prevD.getDate()).padStart(2, "0");
  const nextIso = nextD.getFullYear() + "-" + String(nextD.getMonth() + 1).padStart(2, "0") + "-" + String(nextD.getDate()).padStart(2, "0");

  const prevShift = getEmployeeRegularShiftOnDate(emp, prevIso);
  const nextShift = getEmployeeRegularShiftOnDate(emp, nextIso);

  if (prevShift === "nacht" && (shiftId === "frueh" || shiftId === "spaet")) {
    return { ok: false, reason: "Ruhezeit-Konflikt: Am Vortag (" + formatDateDe(prevIso) + ") in Nachtschicht" };
  }
  if (shiftId === "nacht" && (nextShift === "frueh" || nextShift === "spaet")) {
    return { ok: false, reason: "Ruhezeit-Konflikt: Am Folgetag (" + formatDateDe(nextIso) + ") regulär in " + (shiftsShortLabel[nextShift] || nextShift) };
  }

  const otherExtra = (extraShifts || []).find(es => es.id !== ignoreExtraId && es.empId === emp.id && es.status !== "rejected" && window.normalizeDateIso(es.date) === norm);
  if (otherExtra) {
    return { ok: false, reason: "Bereits eine Bringschicht am selben Tag eingetragen" };
  }

  return { ok: true, reason: "" };
};

function checkExtraShiftConflict(emp, dateIso, shiftId, ignoreExtraId) {
  if (!emp) return "";
  const res = window.checkExtraShiftPlausibility(emp.id, dateIso, shiftId, ignoreExtraId);
  return res.ok ? "" : res.reason;
}
window.checkExtraShiftConflict = checkExtraShiftConflict;

window.generateCoveragePromptForLeave = function(sl, defaultDayStatus) {
  if (!sl || sl.isOnboardingNotice || sl.lineRequestData) return null;
  const emp = employees.find(e => e.id === sl.empId);
  if (!emp) return null;

  const existing = (leaveRequests || []).find(r => r.leaveId === sl.id || r.id === ("cov_" + sl.id));
  const oldDaysMap = {};
  if (existing && Array.isArray(existing.days)) {
    existing.days.forEach(d => {
      oldDaysMap[window.normalizeDateIso(d.date)] = d;
    });
  }

  const sNorm = window.normalizeDateIso(sl.startDate);
  const eNorm = window.normalizeDateIso(sl.endDate);
  if (!sNorm || !eNorm || sNorm > eNorm) return null;

  const cur = new Date(sNorm + "T12:00:00");
  const end = new Date(eNorm + "T12:00:00");
  const daysArr = [];

  while (cur <= end) {
    const dIso = cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0") + "-" + String(cur.getDate()).padStart(2, "0");
    const blockApproved = !Array.isArray(sl.blocks) || sl.blocks.length === 0 || sl.blocks.some(b => b.status === "approved" && dIso >= window.normalizeDateIso(b.start) && dIso <= window.normalizeDateIso(b.end));

    if (blockApproved && !isIsoDateSunday(dIso)) {
      const regShift = getEmployeeRegularShiftOnDate(emp, dIso);
      if (regShift && regShift !== "frei") {
        const prevDayObj = oldDaysMap[dIso];
        daysArr.push({
          date: dIso,
          shift: regShift,
          dayStatus: prevDayObj ? prevDayObj.dayStatus : (defaultDayStatus || "pending"),
          explicitlyApproved: prevDayObj ? !!prevDayObj.explicitlyApproved : (defaultDayStatus === "open"),
          allowWithRestWarning: prevDayObj ? !!prevDayObj.allowWithRestWarning : false,
          takenBy: prevDayObj ? (prevDayObj.takenBy || null) : null
        });
      }
    }
    cur.setDate(cur.getDate() + 1);
  }

  const mainNames = (emp.mainLines || []).map(id => { const l = lines.find(x => x.id === id); return l ? l.name : id; });
  const pinLineId = emp.pinnedZone ? extractLineIdFromZone(emp.pinnedZone) : null;
  const pinLineObj = pinLineId ? lines.find(l => l.id === pinLineId) : null;
  const probLinesTxt = mainNames.length ? ("Voraussichtlich " + mainNames.join(" / ")) : (pinLineObj ? ("Voraussichtlich " + pinLineObj.name) : "");

  if (existing) {
    existing.days = daysArr;
    existing.role = emp.role || "Bediener";
    existing.probableLines = probLinesTxt;
    return existing;
  }

  const newCov = {
    id: "cov_" + sl.id,
    leaveId: sl.id,
    empId: emp.id,
    role: emp.role || "Bediener",
    probableLines: probLinesTxt,
    days: daysArr
  };
  leaveRequests.push(newCov);
  return newCov;
};

window.removeCoveragePromptForLeave = function(leaveId) {
  leaveRequests = (leaveRequests || []).filter(r => r && r.leaveId !== leaveId && r.id !== leaveId && r.id !== ("cov_" + leaveId));
};

/* Prüft inkl. 1-Stunden-Vorlauf (05:00 / 13:00 / 21:00 Uhr), ob eine Bringschicht aktiv ist */
function isExtraShiftActiveNow(es, nowDate) {
  if (!es || es.status !== "approved") return false;
  const now = nowDate ? new Date(nowDate) : new Date();
  const prodTodayIso = getLogicalDateIso(now);
  const esDate = window.normalizeDateIso(es.date);
  return esDate === prodTodayIso;
}
window.isExtraShiftActiveNow = isExtraShiftActiveNow;

window.syncAbsentAndExtraZones = function() {
  const now = new Date();
  const todayIso = getLogicalDateIso(now);

  employees.forEach(emp => {
    const hasActiveLeaveToday = (sickLeaves || []).some(sl => sl.empId === emp.id && isLeaveActiveOnDate(sl, todayIso));
    if (hasActiveLeaveToday) {
      emp.zone = "absent";
      return;
    }
    if (emp.zone === "absent") {
      emp.zone = "pool";
    }

    const activeExtraToday = (extraShifts || []).find(es => es.empId === emp.id && isExtraShiftActiveNow(es, now));
    if (activeExtraToday) {
      const curShift = extractShiftIdFromZone(emp.zone);
      if (!curShift) {
        emp.zone = "extra";
      }
    } else if (emp.zone === "extra") {
      emp.zone = "pool";
    }
  });
};

/* ==========================================================================
   6. INTELLIGENTE AUTO-ZUWEISUNG (SMART ASSIGN) MIT MEMORY-PIN & FOKUS-MODUS
   ========================================================================== */

window.smartAssignShiftSlot = function(shiftId, silent) {
  const todayIso = getLogicalDateIso();
  if (isIsoDateSunday(todayIso)) {
    if (!silent) showToast("Sonntag ist im 2-2-2 Schichtmodell regulär arbeitsfrei.");
    return;
  }

  if (!silent) {
    lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
    activateUndoButtons(shiftId);
  }

  const teamKey = shiftRotation[shiftId];
  if (!teamKey) return;

  window.syncAbsentAndExtraZones();

  /* Schritt 0: Team-Mitglieder & genehmigte Bringschichten dieser Schicht sammeln */
  const candidates = employees.filter(emp => {
    if (emp.zone === "absent") return false;
    const hasExtraInThisShift = (extraShifts || []).some(es =>
      es.empId === emp.id && es.status === "approved" && window.normalizeDateIso(es.date) === todayIso && es.shift === shiftId
    );
    if (hasExtraInThisShift) return true;
    if (emp.zone === "extra") return false;

    if (emp.noRotation && isEmpAnchorActiveToday(emp, todayIso)) {
      const anchorShift = extractShiftIdFromZone(emp.pinnedZone) || emp.lastShiftId || "frueh";
      return anchorShift === shiftId;
    }
    return emp.team === teamKey;
  });

  /* Bisherige Einteilungen in dieser Schicht zurücksetzen (außer fixierte Anker) */
  candidates.forEach(emp => {
    if (emp.noRotation && isEmpAnchorActiveToday(emp, todayIso) && extractShiftIdFromZone(emp.zone) === shiftId) {
      return;
    }
    emp.zone = "pool";
  });

  const activeLines = lines.filter(l => !l.ausgeplant).slice().sort((a, b) => {
    const pRank = p => (p === "PRIO 1" ? 1 : (p === "PRIO 2" ? 2 : (p === "PRIO 3" ? 3 : 4)));
    return pRank(a.prio) - pRank(b.prio);
  });

  const getOccupants = lId => employees.filter(e => extractLineIdFromZone(e.zone) === lId && extractShiftIdFromZone(e.zone) === shiftId);

  const canFitRoleOnLine = (lObj, roleName) => {
    if (!lObj || lObj.ausgeplant) return false;
    const roleSoll = parseInt((lObj.roleTargets || {})[roleName], 10) || 0;
    if (roleSoll <= 0) return false;
    const occ = getOccupants(lObj.id);
    if (occ.length >= getLineTotalTarget(lObj)) return false;
    const curRoleCnt = occ.filter(e => (e.role || "Bediener") === roleName).length;
    return curRoleCnt < roleSoll;
  };

  /* Prüft, ob auf dieser Linie in dieser Schicht bereits ein Lernender (ohne Prio/Sek) sitzt */
  const lineHasTraineeInShift = lObj => {
    return getOccupants(lObj.id).some(e => !isEmployeeQualifiedForLine(e, lObj.id));
  };

  const assignEmpToLine = (emp, lObj, countLearningHours) => {
    const newZone = lObj.id + "_" + shiftId;
    emp.zone = newZone;
    emp.pinnedZone = newZone; /* Memory-Effekt: Merkt sich immer die letzte Position */
    emp.lastShiftId = shiftId;
    trackEmployeeLineAssignment(emp, lObj.id, todayIso);
    if (countLearningHours && !isEmployeeQualifiedForLine(emp, lObj.id)) {
      window.recordManualAssignmentHours(emp.id, lObj.id, Number(shiftModelConfig.defaultShiftHours) || 8, false);
    }
  };

  const assignableCandidates = candidates.filter(emp => {
    if (extractShiftIdFromZone(emp.zone) === shiftId) return false;
    if (!window.canRoleBeAssignedToLine(emp.role || "Bediener")) {
      emp.zone = "pool";
      return false;
    }
    return true;
  });

  /* Deterministischer Tages-Seed für faire Fokus- und Stamm-Schutz-Quoten */
  const daySeed = getEpochDays(todayIso);
  const focusEnabled = shiftModelConfig.focusModeEnabled !== false;
  const focusPct = Math.min(100, Math.max(5, Number(shiftModelConfig.focusModePercent) || 20));
  const threshold = Math.max(6, Number(shiftModelConfig.secondaryUnlockThresholdHours) || 160);

  /* PHASE 1: Feste Stamm-Schutz-Mitarbeiter (🛡️ In Einarbeitung) auf ihre Prio-Stammlinie */
  assignableCandidates.forEach((emp, idx) => {
    if (emp.zone !== "pool") return;
    const prot = window.getEmpTrainingProtectionInfo(emp, todayIso);
    if (!prot.active) return;
    const roll = ((daySeed + idx * 17) % 100);
    if (roll < prot.mainPct && Array.isArray(emp.mainLines) && emp.mainLines.length > 0) {
      for (const lId of emp.mainLines) {
        const lObj = activeLines.find(l => l.id === lId);
        if (lObj && canFitRoleOnLine(lObj, emp.role || "Bediener")) {
          assignEmpToLine(emp, lObj, false);
          break;
        }
      }
    }
  });

  /* PHASE 2: Fokus-Modus (Begonnene Lern-Anlagen >0h bis <Schwellenwert anteilig einplanen, max. 1 Lernender pro Linie) */
  if (focusEnabled) {
    assignableCandidates.forEach((emp, idx) => {
      if (emp.zone !== "pool") return;
      const hoursMap = emp.trainingHoursByLine || {};
      const learningLineIds = Object.keys(hoursMap).filter(lId => {
        const h = Number(hoursMap[lId]) || 0;
        return h > 0 && h < threshold && !isEmployeeQualifiedForLine(emp, lId);
      });
      if (!learningLineIds.length) return;

      const roll = ((daySeed * 13 + idx * 29) % 100);
      if (roll >= focusPct) return;

      learningLineIds.sort((a, b) => (Number(hoursMap[b]) || 0) - (Number(hoursMap[a]) || 0));
      for (const lId of learningLineIds) {
        const lObj = activeLines.find(l => l.id === lId && !l.mainOnly);
        if (lObj && canFitRoleOnLine(lObj, emp.role || "Bediener") && !lineHasTraineeInShift(lObj)) {
          /* Sicherstellen, dass mindestens 1 erfahrener Stamm-/Sekundärmitarbeiter für diese Linie verfügbar ist */
          assignEmpToLine(emp, lObj, true);
          break;
        }
      }
    });
  }

  /* PHASE 3: Memory-Pin (📌 letzte gespeicherte Position), sofern es eine Prio- oder Sekundärlinie des Mitarbeiters ist */
  assignableCandidates.forEach(emp => {
    if (emp.zone !== "pool") return;
    const pinLineId = emp.pinnedZone ? extractLineIdFromZone(emp.pinnedZone) : null;
    if (!pinLineId) return;
    const hasAnyQual = (Array.isArray(emp.mainLines) && emp.mainLines.length > 0) || (Array.isArray(emp.secLines) && emp.secLines.length > 0);
    const isPinInMain = Array.isArray(emp.mainLines) && emp.mainLines.indexOf(pinLineId) !== -1;
    const isPinInSec = Array.isArray(emp.secLines) && emp.secLines.indexOf(pinLineId) !== -1;

    if (!hasAnyQual || isPinInMain || isPinInSec) {
      const lObj = activeLines.find(l => l.id === pinLineId);
      if (lObj && (!lObj.mainOnly || isPinInMain || !hasAnyQual) && canFitRoleOnLine(lObj, emp.role || "Bediener")) {
        assignEmpToLine(emp, lObj, false);
      }
    }
  });

  /* PHASE 4: Prio-Stammlinien (⭐ mainLines) besetzen */
  assignableCandidates.forEach(emp => {
    if (emp.zone !== "pool") return;
    const mainArr = Array.isArray(emp.mainLines) ? emp.mainLines : [];
    for (const lId of mainArr) {
      const lObj = activeLines.find(l => l.id === lId);
      if (lObj && canFitRoleOnLine(lObj, emp.role || "Bediener")) {
        assignEmpToLine(emp, lObj, false);
        break;
      }
    }
  });

  /* PHASE 5: Sekundärlinien (🔄 secLines – inkl. Fairness-Abwechslung) */
  assignableCandidates.forEach(emp => {
    if (emp.zone !== "pool") return;
    const secArr = (Array.isArray(emp.secLines) ? emp.secLines.slice() : []);
    if (!secArr.length) return;
    if (shiftModelConfig.fairnessBalanceEnabled !== false && emp.lineAssignCounts) {
      secArr.sort((a, b) => (Number(emp.lineAssignCounts[a]) || 0) - (Number(emp.lineAssignCounts[b]) || 0));
    }
    for (const lId of secArr) {
      const lObj = activeLines.find(l => l.id === lId && !l.mainOnly);
      if (lObj && canFitRoleOnLine(lObj, emp.role || "Bediener")) {
        assignEmpToLine(emp, lObj, false);
        break;
      }
    }
  });

  /* PHASE 6: Ringtausch-Optimierung (smartAllowSwap) – falls ein Mitarbeiter im Pool nur Linie A kann,
     auf Linie A aber jemand sitzt, der auch eine noch freie Linie B beherrscht */
  if (shiftModelConfig.smartAllowSwap !== false) {
    assignableCandidates.forEach(unassignedEmp => {
      if (unassignedEmp.zone !== "pool") return;
      const empRole = unassignedEmp.role || "Bediener";
      const myPossibleLines = [].concat(unassignedEmp.mainLines || [], unassignedEmp.secLines || []);

      for (const fullLineId of myPossibleLines) {
        const fullLineObj = activeLines.find(l => l.id === fullLineId);
        if (!fullLineObj) continue;
        const currentOccs = getOccupants(fullLineId).filter(o => (o.role || "Bediener") === empRole && !o.noRotation);

        let swapped = false;
        for (const occEmp of currentOccs) {
          const occAltLines = [].concat(occEmp.mainLines || [], occEmp.secLines || []).filter(id => id !== fullLineId);
          for (const altLineId of occAltLines) {
            const altLineObj = activeLines.find(l => l.id === altLineId);
            if (altLineObj && canFitRoleOnLine(altLineObj, empRole)) {
              assignEmpToLine(occEmp, altLineObj, false);
              assignEmpToLine(unassignedEmp, fullLineObj, false);
              swapped = true;
              break;
            }
          }
          if (swapped) break;
        }
        if (swapped) break;
      }
    });
  }

  /* PHASE 7: Nur-Stamm-Linien Notfall-Fallback über Sekundärlinien & Memory-Pin für Mitarbeiter ohne Prio/Sek */
  assignableCandidates.forEach(emp => {
    if (emp.zone !== "pool") return;
    const empRole = emp.role || "Bediener";
    const secArr = Array.isArray(emp.secLines) ? emp.secLines : [];
    for (const lId of secArr) {
      const lObj = activeLines.find(l => l.id === lId);
      if (lObj && canFitRoleOnLine(lObj, empRole)) {
        assignEmpToLine(emp, lObj, false);
        return;
      }
    }

    /* Falls der Mitarbeiter noch offene Kapazität auf einer nicht-gesperrten Anlage füllen kann (max. 1 Lernender pro Linie) */
    for (const lObj of activeLines) {
      if (lObj.mainOnly) continue;
      if (canFitRoleOnLine(lObj, empRole) && !lineHasTraineeInShift(lObj)) {
        assignEmpToLine(emp, lObj, true);
        return;
      }
    }
  });

  if (!silent) {
    addHistoryLog("Auto-Zuweisung für " + (shiftsLabel[shiftId] || shiftId) + " ausgeführt", "SHIFT");
    saveToFirebase();
    window.initBoard();
    showToast("🧠 " + (shiftsLabel[shiftId] || shiftId) + " intelligent zugewiesen!");
  }
};

window.smartAssignAllShifts = function(silent) {
  const todayIso = getLogicalDateIso();
  if (isIsoDateSunday(todayIso)) {
    if (!silent) showToast("Sonntag ist regulär arbeitsfrei.");
    return;
  }
  if (!silent) {
    lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
    activateUndoButtons();
  }
  shifts.forEach(s => {
    window.smartAssignShiftSlot(s.id, true);
  });
  if (!silent) {
    addHistoryLog("Komplette Auto-Zuweisung für alle Schichten ausgeführt", "SHIFT");
    saveToFirebase();
    window.initBoard();
    showToast("🧠 Alle Schichten intelligent verteilt!");
  }
};

/* ==========================================================================
   7. BOARD-RENDERING, MITARBEITER-KARTEN & DRAG-AND-DROP (MEMORY-PIN)
   ========================================================================== */

window.initBoard = function() {
  injectModernSaaSStyles();
  applyTeamStyles();
  window.updateHeaderDateKw();
  window.updateShiftApprovalUI();
  window.updateAutoRotationUI();
  updateTeamDropdowns();
  renderTeamFilterCheckboxes();
  renderRoleFilterCheckboxes();
  renderGrid();
  renderEmployees();
  window.updateInboxBadge();
};

function renderGrid() {
  const grid = document.getElementById("boardGrid");
  if (!grid) return;

  grid.style.gridTemplateColumns = "140px repeat(" + lines.length + ", minmax(150px, 1fr))";
  let html = "";

  /* Top-Left Ecke: Globale Schicht-Steuerung */
  html +=
    '<div class="grid-header" style="position:sticky; left:0; z-index:6; gap:4px; padding:6px;">' +
      '<div style="font-size:0.82rem; font-weight:800;">Schicht</div>' +
      (isPlanner ? (
        '<button class="btn btn-primary" style="width:100%; padding:3px 6px; font-size:0.7rem; justify-content:center;" onclick="rotateAllShifts()">🔄 Rotieren</button>' +
        '<button class="btn btn-outline" style="width:100%; padding:3px 6px; font-size:0.7rem; justify-content:center; color:#6d28d9; border-color:#ddd6fe; background:#f5f3ff;" onclick="smartAssignAllShifts(false)">🪄 Alle Auto</button>' +
        '<button class="btn btn-outline" style="width:100%; padding:3px 6px; font-size:0.7rem; justify-content:center;" onclick="clearEntireBoard()">🧹 Alle leeren</button>'
      ) : '') +
    '</div>';

  /* Spalten-Köpfe: Linien */
  lines.forEach(line => {
    const prioClass = line.ausgeplant
      ? "prio-ausgeplant"
      : (line.prio === "PRIO 1" ? "prio-1" : (line.prio === "PRIO 2" ? "prio-2" : (line.prio === "PRIO 3" ? "prio-3" : "")));
    const prioBadge = line.ausgeplant
      ? '<span class="line-prio-badge prio-ausgeplant">AUSGEPLANT</span>'
      : (line.prio ? '<span class="line-prio-badge ' + prioClass + '">' + line.prio + '</span>' : '');
    const mainOnlyBadge = line.mainOnly ? '<span class="line-mainonly-tag">🛡️ Nur Stamm</span>' : '';
    const tagBadge = line.tag ? '<span class="line-tag-badge">' + line.tag + '</span>' : '';
    const noteHtml = line.note ? '<div class="line-note-preview" title="' + line.note + '">📌 ' + line.note + '</div>' : '';

    html +=
      '<div class="grid-header ' + (line.ausgeplant ? 'ausgeplant-header' : '') + '">' +
        '<div class="line-edit-trigger" ' + (isPlanner ? 'onclick="openLineEditModal(\'' + line.id + '\')"' : '') + '>' +
          '<span class="line-floor-badge">' + (line.floor || "1. OG") + '</span>' +
          '<div style="font-size:0.88rem; font-weight:800;">' + line.name + '</div>' +
          prioBadge +
          mainOnlyBadge +
          tagBadge +
          noteHtml +
          '<div class="line-role-summary">' + getLineRoleSummaryText(line) + '</div>' +
        '</div>' +
      '</div>';
  });

  /* 3 Schicht-Zeilen: Früh, Spät, Nacht */
  const teamKeys = Object.keys(teamsConfig).sort();
  shifts.forEach(s => {
    const curTeamKey = shiftRotation[s.id] || teamKeys[0];
    const teamOpts = teamKeys.map(k =>
      '<option value="' + k + '" ' + (curTeamKey === k ? 'selected' : '') + '>' + teamsConfig[k].name + '</option>'
    ).join("");

    html +=
      '<div class="shift-label">' +
        '<div style="font-size:0.88rem; font-weight:800;">' + s.name + '</div>' +
        '<span id="shiftActiveLeadBadge_' + s.id + '" style="display:none; font-size:0.62rem; font-weight:700; background:#dcfce7; color:#166534; border:1px solid #86efac; padding:1px 6px; border-radius:999px;">🟢 Aktiv (1h Vorlauf)</span>' +
        '<div style="display:flex; gap:3px; flex-wrap:wrap; justify-content:center;">' +
          '<span id="shiftTotalBadge_' + s.id + '" class="shift-TotalCounter ok">👥 0/0</span>' +
          '<span id="shiftEhBadge_' + s.id + '" class="shift-eh-badge ok">+ 0 EH</span>' +
        '</div>' +
        '<div class="shift-team-control">' +
          '<select id="teamSelect_' + s.id + '" class="team-QuickSelect" onchange="onShiftTeamDropdownChange(\'' + s.id + '\', this)">' + teamOpts + '</select>' +
          '<div class="shift-action-row">' +
            '<button class="btn-load-team" onclick="loadTeamToShift(\'' + s.id + '\')" title="Ausgewähltes Team auf gespeicherte Positionen laden">📥</button>' +
            '<button class="btn-smart-assign" onclick="smartAssignShiftSlot(\'' + s.id + '\', false)" title="Intelligent automatisch verteilen">🪄</button>' +
          '</div>' +
          '<button id="btnUndoShift_' + s.id + '" class="btn-undo-shift" onclick="undoLastBoardSnapshot()">↩️ Rückgängig</button>' +
          '<button class="btn-clear-shift" onclick="clearShiftRow(\'' + s.id + '\')">🧹 Leeren</button>' +
        '</div>' +
      '</div>';

    lines.forEach(line => {
      const zId = line.id + "_" + s.id;
      html +=
        '<div class="dropzone ' + (line.ausgeplant ? 'ausgeplant-zone' : '') + '" id="zone_' + zId + '" data-zone="' + zId + '">' +
          '<div id="counter_' + zId + '" class="zone-counter"></div>' +
        '</div>';
    });
  });

  grid.innerHTML = html;
}

function doesEmployeeMatchPoolSearch(emp, q) {
  if (!q) return true;
  const cleanQ = q.toLowerCase().trim();
  const numOnlyQ = cleanQ.replace(/^linie\s*/i, "").replace(/^l_?/i, "").replace(/^0+/, "");

  const nameRoleHay = (fullName(emp) + " " + (emp.role || "") + " " + (teamsConfig[emp.team] ? teamsConfig[emp.team].name : "")).toLowerCase();
  if (nameRoleHay.indexOf(cleanQ) !== -1) return true;

  const empLineIds = [].concat(
    emp.mainLines || [],
    emp.secLines || [],
    emp.pinnedZone ? [extractLineIdFromZone(emp.pinnedZone)] : []
  ).filter(Boolean);

  return empLineIds.some(lId => {
    const shortNum = getShortLineNumber(lId).toLowerCase();
    const shortNoZero = shortNum.replace(/^0+/, "");
    return shortNum === cleanQ || (numOnlyQ && shortNoZero === numOnlyQ) || lId.toLowerCase() === cleanQ;
  });
}

function renderEmployees() {
  window.syncAbsentAndExtraZones();
  const todayIso = getLogicalDateIso();
  const nowHour = new Date().getHours();

  /* Aktives Schichtfenster (inkl. 1h Vorlauf: Früh ab 05:00, Spät ab 13:00, Nacht ab 21:00) */
  const activeShiftNow = (nowHour >= 5 && nowHour < 13) ? "frueh" : ((nowHour >= 13 && nowHour < 21) ? "spaet" : "nacht");
  shifts.forEach(s => {
    const leadEl = document.getElementById("shiftActiveLeadBadge_" + s.id);
    if (leadEl) leadEl.style.display = (s.id === activeShiftNow && !isIsoDateSunday(todayIso)) ? "inline-flex" : "none";
  });

  document.querySelectorAll(".employee-pool, .dropzone").forEach(el => {
    Array.from(el.querySelectorAll(".employee-card")).forEach(c => c.remove());
  });

  let poolCnt = 0, reviewCnt = 0, extraCnt = 0, absentCnt = 0;

  employees.forEach(emp => {
    const inPoolArea = !emp.zone || ["pool", "review", "extra", "absent"].indexOf(emp.zone) !== -1;
    const matchesSearch = doesEmployeeMatchPoolSearch(emp, poolSearchQuery);

    if (inPoolArea) {
      if (activeTeamFilters[emp.team] === false) return;
      if (activeRoleFilters[emp.role || "Bediener"] === false) return;
      if (poolSearchQuery && !matchesSearch) return;
    }

    const card = document.createElement("div");
    card.className = "employee-card" + (poolSearchQuery && matchesSearch ? " search-match-highlight" : "");
    card.setAttribute("data-id", emp.id);
    card.setAttribute("data-team", emp.team || "team_1");

    const ehPlus = emp.ersthelfer ? '<span class="ersthelfer-plus" title="Ersthelfer">+</span>' : '';
    const curLineId = extractLineIdFromZone(emp.zone);

    /* PIN-Nadel (📌) = Letzte gespeicherte Position (Memory-Effekt) */
    const pinLineId = emp.pinnedZone ? extractLineIdFromZone(emp.pinnedZone) : null;
    const pinShort = pinLineId ? getShortLineNumber(pinLineId) : "";
    const pinBadge = pinShort
      ? '<span class="line-QuickBadge pin" title="Letzte gespeicherte Position (Memory-Nadel)">📌 ' + pinShort + '</span>'
      : '';

    /* Prio-Stammlinien & Sekundärlinien Badges */
    const mainShorts = (emp.mainLines || []).map(getShortLineNumber).filter(Boolean);
    const secShorts = (emp.secLines || []).map(getShortLineNumber).filter(Boolean);
    const mainBadge = mainShorts.length && inPoolArea
      ? '<span class="line-QuickBadge main" title="Prio-Stammlinien">★ ' + mainShorts.join(",") + '</span>'
      : '';
    const secBadge = secShorts.length && inPoolArea
      ? '<span class="line-QuickBadge sec" title="Sekundärlinien">Sek ' + secShorts.join(",") + '</span>'
      : '';

    /* Lern-Stunden Badge (🎯): Zeigt auf einer Fremdanlage die Stunden dieser Anlage, sonst die höchste aktive Lern-Anlage */
    let learnBadge = "";
    const hoursMap = emp.trainingHoursByLine || {};
    if (curLineId && !isEmployeeQualifiedForLine(emp, curLineId)) {
      const h = Math.round((Number(hoursMap[curLineId]) || 0) * 10) / 10;
      learnBadge = '<span class="line-QuickBadge trainee" title="Einarbeitungsstunden an dieser Anlage">🎯 ' + h + 'h</span>';
    } else {
      const foreignKeys = Object.keys(hoursMap).filter(lId => (Number(hoursMap[lId]) || 0) > 0 && !isEmployeeQualifiedForLine(emp, lId));
      if (foreignKeys.length > 0) {
        foreignKeys.sort((a, b) => (Number(hoursMap[b]) || 0) - (Number(hoursMap[a]) || 0));
        const topId = foreignKeys[0];
        const topHrs = Math.round((Number(hoursMap[topId]) || 0) * 10) / 10;
        const moreHint = foreignKeys.length > 1 ? (" (+" + (foreignKeys.length - 1) + ")") : "";
        learnBadge = '<span class="line-QuickBadge trainee" title="Gesammelte Lernstunden (' + foreignKeys.map(k => getShortLineNumber(k) + ': ' + hoursMap[k] + 'h').join(', ') + ')">🎯 ' + topHrs + 'h' + moreHint + '</span>';
      }
    }

    card.innerHTML =
      '<div class="emp-top-row">' +
        '<span class="emp-name">' + fullName(emp) + ehPlus + '</span>' +
        '<div class="card-quick-actions">' +
          '<button type="button" class="card-action-btn" onclick="openSettingsModal(); editEmployee(\'' + emp.id + '\');" title="Mitarbeiter bearbeiten">✏️</button>' +
        '</div>' +
      '</div>' +
      '<div class="emp-meta-row">' +
        '<span class="emp-role" data-role="' + (emp.role || "Bediener") + '">' + (emp.role || "Bediener") + '</span>' +
        learnBadge +
        pinBadge +
        mainBadge +
        secBadge +
      '</div>';

    let targetContainer = null;
    if (emp.zone === "absent") {
      targetContainer = document.getElementById("pool-absent");
      absentCnt++;
    } else if (emp.zone === "extra") {
      targetContainer = document.getElementById("pool-extra");
      extraCnt++;
    } else if (emp.zone === "review") {
      targetContainer = document.getElementById("pool-review");
      reviewCnt++;
    } else if (emp.zone && emp.zone !== "pool") {
      targetContainer = document.getElementById("zone_" + emp.zone);
      if (!targetContainer) {
        emp.zone = "pool";
        targetContainer = document.getElementById("pool");
        poolCnt++;
      }
    } else {
      targetContainer = document.getElementById("pool");
      poolCnt++;
    }

    if (targetContainer) targetContainer.appendChild(card);
  });

  const setNum = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
  setNum("poolCount", poolCnt);
  setNum("reviewCount", reviewCnt);
  setNum("extraCount", extraCnt);
  setNum("absentCount", absentCnt);

  const revSec = document.getElementById("reviewPoolSection");
  if (revSec) revSec.style.display = reviewCnt > 0 ? "flex" : "none";

  updateZoneAndShiftCounters();
  initDragAndDrop();
}
window.renderEmployees = renderEmployees;

function updateZoneAndShiftCounters() {
  shifts.forEach(s => {
    let shiftAssigned = 0;
    let shiftTarget = 0;
    let ehCount = 0;

    lines.forEach(line => {
      const zId = line.id + "_" + s.id;
      const counterEl = document.getElementById("counter_" + zId);
      const occs = employees.filter(e => e.zone === zId);

      occs.forEach(e => { if (e.ersthelfer) ehCount++; });

      if (line.ausgeplant) {
        if (counterEl) {
          counterEl.className = "zone-counter ausgeplant-counter";
          counterEl.innerHTML = "<span>⛔ Ausgeplant</span>";
        }
        return;
      }

      const lineSoll = getLineTotalTarget(line);
      shiftAssigned += occs.length;
      shiftTarget += lineSoll;

      const missingParts = [];
      const rt = line.roleTargets || { Bediener: 2, LOP: 1 };
      roles.forEach(r => {
        const rSoll = parseInt(rt[r], 10) || 0;
        if (rSoll > 0) {
          const rIst = occs.filter(e => (e.role || "Bediener") === r).length;
          const diff = rIst - rSoll;
          if (diff < 0) {
            const shortR = r === "Bediener" ? "Bed." : (r === "Schichtexperte" ? "SE" : r);
            missingParts.push(diff + " " + shortR);
          }
        }
      });

      if (counterEl) {
        const stClass = occs.length < lineSoll ? "under" : (occs.length > lineSoll ? "over" : "full");
        counterEl.className = "zone-counter " + stClass;
        counterEl.innerHTML =
          "<span>" + occs.length + "/" + lineSoll + "</span>" +
          "<span>" + (missingParts.length ? missingParts.join(", ") : "✓ OK") + "</span>";
      }
    });

    const totalEl = document.getElementById("shiftTotalBadge_" + s.id);
    if (totalEl) {
      totalEl.className = "shift-TotalCounter " + (shiftAssigned < shiftTarget ? "missing" : (shiftAssigned > shiftTarget ? "over" : "ok"));
      totalEl.textContent = "👥 " + shiftAssigned + "/" + shiftTarget;
    }

    const ehEl = document.getElementById("shiftEhBadge_" + s.id);
    if (ehEl) {
      ehEl.className = "shift-eh-badge " + (ehCount > 0 ? "ok" : "warn");
      ehEl.textContent = "+ " + ehCount + " EH";
    }
  });
}

function initDragAndDrop() {
  boardSortableInstances.forEach(inst => inst.destroy());
  boardSortableInstances = [];
  if (!isPlanner || typeof Sortable === "undefined") return;

  const zones = document.querySelectorAll(".employee-pool, .dropzone");
  zones.forEach(zoneEl => {
    const inst = new Sortable(zoneEl, {
      group: "shiftboard",
      animation: 150,
      onStart: evt => {
        isDraggingCard = true;
        draggedEmpId = evt.item.getAttribute("data-id");
      },
      onEnd: evt => {
        isDraggingCard = false;
        const empId = evt.item.getAttribute("data-id");
        const targetZone = evt.to ? evt.to.getAttribute("data-zone") : null;
        const emp = employees.find(e => e.id === empId);
        if (!emp || !targetZone) return;

        lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
        const targetShift = extractShiftIdFromZone(targetZone);
        const targetLineId = extractLineIdFromZone(targetZone);
        activateUndoButtons(targetShift);

        emp.zone = targetZone;

        if (targetLineId && targetShift) {
          /* PIN-Nadel (📌) als Memory-Effekt: Merkt sich immer die zuletzt zugewiesene Position */
          emp.pinnedZone = targetZone;
          emp.lastShiftId = targetShift;
          trackEmployeeLineAssignment(emp, targetLineId, getLogicalDateIso());
          window.recordManualAssignmentHours(emp.id, targetLineId, Number(shiftModelConfig.defaultShiftHours) || 8, false);
        } else if (targetZone === "pool" || targetZone === "review") {
          window.recordManualAssignmentHours(emp.id, null, 0, true);
        }

        saveToFirebase();
        renderEmployees();
        renderUnqualifiedHoursOverview();
      }
    });
    boardSortableInstances.push(inst);
  });
}
/* ==========================================================================
   8. SCHICHTEN LEEREN, LADEN & ROTIEREN (TEIL 2A – ABSCHNITT 8 BIS 11)
   ========================================================================== */

function ensureUniqueShiftRotationTeams() {
  const slots = ["frueh", "spaet", "nacht", "frei"];
  const allTeamKeys = Object.keys(teamsConfig).sort();
  if (allTeamKeys.length < 4) return false;

  const rotatingKeys = allTeamKeys.filter(k => isTeamRotating(k));
  const targetPool = rotatingKeys.length >= 4 ? rotatingKeys.slice(0, 4) : allTeamKeys.slice(0, 4);

  const used = new Set();
  const duplicateSlots = [];

  slots.forEach(s => {
    const tKey = shiftRotation[s];
    if (!tKey || !teamsConfig[tKey] || used.has(tKey)) {
      duplicateSlots.push(s);
    } else {
      used.add(tKey);
    }
  });

  if (!duplicateSlots.length) return false;

  const missingTeams = targetPool.filter(k => !used.has(k));
  duplicateSlots.forEach((slotName, idx) => {
    shiftRotation[slotName] = missingTeams[idx] || targetPool[idx % targetPool.length];
  });
  return true;
}

window.clearEntireBoard = function() {
  lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
  activateUndoButtons();
  const todayIso = getLogicalDateIso();
  employees.forEach(e => {
    if (e.zone && ["pool", "absent", "extra"].indexOf(e.zone) === -1 && !isEmpAnchorActiveToday(e, todayIso)) {
      e.zone = "pool";
      window.recordManualAssignmentHours(e.id, null, 0, true);
    }
  });
  addHistoryLog("Komplettes Board in den Pool geleert (Memory-Nadeln behalten)", "SHIFT");
  saveToFirebase();
  window.initBoard();
  showToast("Alle Schichten geleert (Memory-Nadeln gespeichert)");
};

window.clearShiftRow = function(sId) {
  lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
  activateUndoButtons(sId);
  const todayIso = getLogicalDateIso();
  employees.forEach(e => {
    if (extractShiftIdFromZone(e.zone) === sId && !isEmpAnchorActiveToday(e, todayIso)) {
      e.zone = "pool";
      window.recordManualAssignmentHours(e.id, null, 0, true);
    }
  });
  addHistoryLog((shiftsLabel[sId] || sId) + " in den Pool geleert", "SHIFT");
  saveToFirebase();
  window.initBoard();
  showToast((shiftsLabel[sId] || sId) + " geleert");
};

function distributeTeamToSlotInternal(teamKey, slotKey) {
  const todayIso = getLogicalDateIso();
  const canFitOnLineInSlot = (lObj, roleName) => {
    if (!lObj || lObj.ausgeplant) return false;
    const roleSoll = Number((lObj.roleTargets || {})[roleName] || 0);
    if (roleSoll <= 0) return false;
    const curEmps = employees.filter(e => extractLineIdFromZone(e.zone) === lObj.id && extractShiftIdFromZone(e.zone) === slotKey);
    if (curEmps.length >= getLineTotalTarget(lObj)) return false;
    const curRoleCnt = curEmps.filter(e => (e.role || "Bediener") === roleName).length;
    return curRoleCnt < roleSoll;
  };

  employees.forEach(emp => {
    if (emp.team === teamKey && emp.zone !== "absent" && emp.zone !== "extra") {
      if (emp.noRotation && isEmpAnchorActiveToday(emp, todayIso) && emp.zone && ["pool", "review", "absent", "extra"].indexOf(emp.zone) === -1) {
        return;
      }
      const empRole = emp.role || "Bediener";
      if (slotKey === "frei" || !window.canRoleBeAssignedToLine(empRole)) {
        emp.zone = "pool";
        return;
      }

      const hasMainLines = Array.isArray(emp.mainLines) && emp.mainLines.length > 0;
      const hasSecLines = Array.isArray(emp.secLines) && emp.secLines.length > 0;

      /* 1. Memory-Nadel (letzte gespeicherte Position) prüfen */
      let targetLineId = emp.pinnedZone ? extractLineIdFromZone(emp.pinnedZone) : null;
      let lineObj = targetLineId ? lines.find(l => l.id === targetLineId && !l.ausgeplant) : null;

      if (lineObj && lineObj.mainOnly && hasMainLines && emp.mainLines.indexOf(lineObj.id) === -1) {
        lineObj = null;
      }
      if (lineObj && !canFitOnLineInSlot(lineObj, empRole)) {
        lineObj = null;
      }

      /* 2. Falls Memory-Nadel besetzt/nicht verfügbar: Prio-Stammlinien (mainLines) */
      if (!lineObj && hasMainLines) {
        for (let i = 0; i < emp.mainLines.length; i++) {
          const candidate = lines.find(l => l.id === emp.mainLines[i] && !l.ausgeplant);
          if (candidate && canFitOnLineInSlot(candidate, empRole)) {
            lineObj = candidate;
            break;
          }
        }
      }

      /* 3. Sekundärlinien (secLines) */
      if (!lineObj && hasSecLines) {
        for (let i = 0; i < emp.secLines.length; i++) {
          const candidate = lines.find(l => l.id === emp.secLines[i] && !l.ausgeplant && !l.mainOnly);
          if (candidate && canFitOnLineInSlot(candidate, empRole)) {
            lineObj = candidate;
            break;
          }
        }
      }

      if (lineObj) {
        const newZone = lineObj.id + "_" + slotKey;
        emp.zone = newZone;
        emp.pinnedZone = newZone; /* Memory-Effekt aktualisieren */
        emp.lastShiftId = slotKey;
        trackEmployeeLineAssignment(emp, lineObj.id, todayIso);
      } else {
        emp.zone = "pool";
      }
    }
  });
}

window.loadTeamToShift = function(slotKey) {
  const sel = document.getElementById("teamSelect_" + slotKey);
  const teamKey = sel ? sel.value : shiftRotation[slotKey];
  if (!teamKey) return;
  lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
  activateUndoButtons(slotKey);

  const todayIso = getLogicalDateIso();
  const oldTeam = shiftRotation[slotKey];
  ["frueh", "spaet", "nacht", "frei"].forEach(sKey => {
    if (sKey !== slotKey && shiftRotation[sKey] === teamKey) {
      shiftRotation[sKey] = oldTeam;
    }
  });
  shiftRotation[slotKey] = teamKey;
  ensureUniqueShiftRotationTeams();

  employees.forEach(emp => {
    if (emp.zone === "absent" || emp.zone === "extra") return;
    if (emp.noRotation && isEmpAnchorActiveToday(emp, todayIso)) return;
    const zShift = extractShiftIdFromZone(emp.zone);
    if ((slotKey !== "frei" && zShift === slotKey) || emp.team === teamKey || (oldTeam && emp.team === oldTeam && shiftRotation.frei === oldTeam)) {
      emp.zone = "pool";
      window.recordManualAssignmentHours(emp.id, null, 0, true);
    }
  });

  shiftModelConfig.lastRotationBlockIndex = getWorkdayBlockIndex(todayIso);
  distributeTeamToSlotInternal(teamKey, slotKey);
  const tName = teamsConfig[teamKey] ? teamsConfig[teamKey].name : teamKey;
  addHistoryLog(tName + " in " + (shiftsLabel[slotKey] || "Pool") + " geladen", "SHIFT");
  saveToFirebase();
  window.initBoard();
  showToast(tName + " geladen!");
};

window.performShiftRotationLogic = function(silent) {
  ensureUniqueShiftRotationTeams();
  const slotOrder = ["frueh", "spaet", "nacht", "frei"];
  const activeSlots = slotOrder.filter(s => shiftRotation[s] && isTeamRotating(shiftRotation[s]));
  if (activeSlots.length < 2) return;
  const nextShiftRotation = Object.assign({}, shiftRotation);
  activeSlots.forEach((fromSlot, idx) => {
    const targetSlot = activeSlots[(idx + 1) % activeSlots.length];
    nextShiftRotation[targetSlot] = shiftRotation[fromSlot];
  });
  shiftRotation = nextShiftRotation;
  shiftModelConfig.lastRotationBlockIndex = getWorkdayBlockIndex(getLogicalDateIso());
  addHistoryLog("Schicht-Rotation ausgeführt", "SHIFT");
  if (!silent) {
    saveToFirebase();
    window.initBoard();
    showToast("Schichten erfolgreich rotiert!");
  }
};

window.rotateAllShifts = function() {
  lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
  activateUndoButtons();
  const todayIso = getLogicalDateIso();

  employees.forEach(e => {
    if (e.zone && ["pool", "absent", "extra"].indexOf(e.zone) === -1 && !isEmpAnchorActiveToday(e, todayIso)) {
      e.zone = "pool";
    }
  });

  window.performShiftRotationLogic(true);
  if (shiftModelConfig.smartAssignEnabled !== false && !isIsoDateSunday(todayIso)) {
    shifts.forEach(s => {
      window.smartAssignShiftSlot(s.id, true);
    });
  }
  saveToFirebase();
  window.initBoard();
  const freiTeamKey = shiftRotation.frei;
  const freiName = (freiTeamKey && teamsConfig[freiTeamKey]) ? teamsConfig[freiTeamKey].name : "Freischicht";
  showToast("🔄 Schichten rotiert (" + freiName + " jetzt im Frei-Pool)!");
};

/* ==========================================================================
   9. FILTER & SOFORT-SUCHE IM POOL (INKL. 1- UND 2-STELLIGER LINIENNUMMERN)
   ========================================================================== */

function applyTeamStyles() {
  let st = document.getElementById("dynamicTeamStyles");
  if (!st) {
    st = document.createElement("style");
    st.id = "dynamicTeamStyles";
    document.head.appendChild(st);
  }
  st.textContent = Object.keys(teamsConfig).sort().map(k => '.employee-card[data-team="' + k + '"] { border-left-color: ' + teamsConfig[k].color + ' !important; }').join("\n");
}

function updateTeamDropdowns() {
  ensureUniqueShiftRotationTeams();
  const keys = Object.keys(teamsConfig).sort();
  const freiSel = document.getElementById("teamSelect_frei");
  if (freiSel) {
    const curFreiKey = (shiftRotation.frei && teamsConfig[shiftRotation.frei]) ? shiftRotation.frei : keys[0];
    shiftRotation.frei = curFreiKey;
    freiSel.innerHTML = keys.map(k => '<option value="' + k + '" ' + (curFreiKey === k ? 'selected' : '') + '>Frei: ' + teamsConfig[k].name + '</option>').join("");
    freiSel.onchange = function() {
      const newTeam = this.value;
      const oldTeam = shiftRotation.frei;
      ["frueh", "spaet", "nacht"].forEach(sKey => {
        if (shiftRotation[sKey] === newTeam) shiftRotation[sKey] = oldTeam;
      });
      shiftRotation.frei = newTeam;
      ensureUniqueShiftRotationTeams();
      shiftModelConfig.lastRotationBlockIndex = getWorkdayBlockIndex(getLogicalDateIso());
      saveToFirebase();
      window.initBoard();
    };
  }
}

window.onShiftTeamDropdownChange = function(shiftId, selEl) {
  if (!selEl) return;
  const newTeam = selEl.value;
  const oldTeam = shiftRotation[shiftId];
  ["frueh", "spaet", "nacht", "frei"].forEach(sKey => {
    if (sKey !== shiftId && shiftRotation[sKey] === newTeam) {
      shiftRotation[sKey] = oldTeam;
    }
  });
  shiftRotation[shiftId] = newTeam;
  ensureUniqueShiftRotationTeams();
  shiftModelConfig.lastRotationBlockIndex = getWorkdayBlockIndex(getLogicalDateIso());
  saveToFirebase();
  window.initBoard();
};

/* Sofort-Suche ab dem 1. Zeichen (filtert z.B. "09" oder "9" sofort nach Linie 09) */
window.updatePoolSearch = function(val) {
  const rawVal = (val || "").trim();
  const clearBtn = document.getElementById("clearSearchBtn");
  poolSearchQuery = rawVal.toLowerCase();
  if (clearBtn) clearBtn.style.display = poolSearchQuery ? "block" : "none";
  renderEmployees();
};

function renderTeamFilterCheckboxes() {
  const c = document.getElementById("teamFilterContainer");
  if (!c) return;
  c.innerHTML = Object.keys(teamsConfig).sort().map(k => {
    const t = teamsConfig[k];
    return '<label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer;"><input type="checkbox" ' + (activeTeamFilters[k] !== false ? 'checked' : '') + ' onchange="activeTeamFilters[\'' + k + '\']=this.checked; renderEmployees();"> <span style="color:' + t.color + '; font-weight:700;">■</span> ' + t.name + '</label>';
  }).join("");
}

function renderRoleFilterCheckboxes() {
  const c = document.getElementById("roleFilterContainer");
  if (!c) return;
  c.innerHTML = roles.map((r, i) => '<label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer;"><input type="checkbox" ' + (activeRoleFilters[r] !== false ? 'checked' : '') + ' onchange="activeRoleFilters[roles[' + i + ']]=this.checked; renderEmployees();"> ' + r + '</label>').join("");
}

window.toggleAllTeamFilters = function(state) {
  Object.keys(teamsConfig).forEach(k => { activeTeamFilters[k] = !!state; });
  renderTeamFilterCheckboxes();
  renderEmployees();
};

window.toggleAllRoleFilters = function(state) {
  roles.forEach(r => { activeRoleFilters[r] = !!state; });
  renderRoleFilterCheckboxes();
  renderEmployees();
};

/* ==========================================================================
   10. LINIEN-DETAILS MODAL (INKL. "🛡️ NUR STAMMMITARBEITER"-OPTION)
   ========================================================================== */

function ensureLineMainOnlyCheckboxExists() {
  if (document.getElementById("editLineMainOnly")) return;
  const ausgChk = document.getElementById("editLineAusgeplant");
  if (!ausgChk || !ausgChk.parentElement) return;
  const wrap = document.createElement("label");
  wrap.style.cssText = "display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.82rem; font-weight:700; color:#1d4ed8; background:#eff6ff; border:1px solid #bfdbfe; padding:8px 10px; border-radius:8px; margin-top:8px;";
  wrap.innerHTML = '<input type="checkbox" id="editLineMainOnly" onchange="saveLineDetails(true)"> 🛡️ Nur Stammmitarbeiter (Von Lern-Rotation befreit – Sekundär nur im Notfall)';
  ausgChk.parentElement.insertAdjacentElement("afterend", wrap);
}

window.openLineEditModal = function(lineId) {
  const line = lines.find(l => l.id === lineId);
  if (!line) return;
  ensureLineMainOnlyCheckboxExists();
  document.getElementById("editLineId").value = line.id;
  document.getElementById("lineEditTitle").textContent = "Linie bearbeiten: " + line.name;
  document.getElementById("editLineAusgeplant").checked = !!line.ausgeplant;
  const mainOnlyChk = document.getElementById("editLineMainOnly");
  if (mainOnlyChk) mainOnlyChk.checked = !!line.mainOnly;
  document.getElementById("editLineFloor").value = line.floor || "1. OG";
  document.getElementById("editLinePrio").value = line.prio || "";
  document.getElementById("editLineTag").value = line.tag || "";
  document.getElementById("editLineNote").value = line.note || "";

  renderLineEditRoleTargets(line);
  document.getElementById("lineEditModal").style.display = "flex";
};

function renderLineEditRoleTargets(line) {
  const container = document.getElementById("editLineRoleTargetsContainer");
  if (!container) return;
  if (!line.roleTargets) line.roleTargets = { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 };
  container.innerHTML = roles.map(r => {
    const val = line.roleTargets[r] ?? (r === "Bediener" ? 2 : (r === "LOP" ? 1 : 0));
    return '<div class="role-target-item"><span title="' + r + '">' + r + '</span><input type="number" min="0" max="10" value="' + val + '" data-role-target-input="' + r + '" onchange="updateLineEditAutoTotal()"></div>';
  }).join("");
  updateLineEditAutoTotal();
}

window.updateLineEditAutoTotal = function() {
  let sum = 0;
  document.querySelectorAll("[data-role-target-input]").forEach(inp => { sum += parseInt(inp.value, 10) || 0; });
  const badge = document.getElementById("editLineAutoTargetBadge");
  if (badge) badge.textContent = "Gesamt-Soll: " + sum;
};

window.saveLineDetails = function(isAuto) {
  const id = document.getElementById("editLineId").value;
  const line = lines.find(l => l.id === id);
  if (!line) return;
  line.ausgeplant = document.getElementById("editLineAusgeplant").checked;
  const mainOnlyChk = document.getElementById("editLineMainOnly");
  if (mainOnlyChk) line.mainOnly = mainOnlyChk.checked;
  line.floor = document.getElementById("editLineFloor").value;
  line.prio = document.getElementById("editLinePrio").value;
  line.tag = document.getElementById("editLineTag").value.trim();
  line.note = document.getElementById("editLineNote").value.trim();

  if (!line.roleTargets) line.roleTargets = {};
  document.querySelectorAll("[data-role-target-input]").forEach(inp => {
    const rName = inp.getAttribute("data-role-target-input");
    line.roleTargets[rName] = parseInt(inp.value, 10) || 0;
  });

  addHistoryLog("Linien-Konfiguration gespeichert: " + line.name, "EMP");
  saveToFirebase();
  window.initBoard();
  if (!isAuto) {
    window.closeModal("lineEditModal");
    showToast("Linie gespeichert!");
  }
};

/* ==========================================================================
   11. KOMPAKTE BRINGSCHICHT-FREIGABE, URLAUBS-SPLIT (+) & STAMMDATEN-UI
   ========================================================================== */

window.getCoverageTargetInfoForDay = function(dateIso, shiftId, reqRole) {
  const todayIso = getLogicalDateIso();
  const normDate = window.normalizeDateIso(dateIso);
  const isPast = normDate < todayIso;
  const rot = getRotationForDate(normDate);
  const freiTeamKey = rot.frei || "";
  const freiTeamObj = teamsConfig[freiTeamKey] || { name: "Freischicht-Team", color: "#0284c7" };

  const eligibleEmps = employees.filter(emp => {
    if ((emp.role || "Bediener") !== (reqRole || "Bediener")) return false;
    const check = window.checkExtraShiftPlausibility(emp.id, normDate, shiftId);
    return check.ok;
  });

  const eligibleFromFreiTeam = eligibleEmps.filter(e => e.team === freiTeamKey);

  return {
    isPast: isPast,
    freiTeamKey: freiTeamKey,
    freiTeamName: freiTeamObj.name,
    freiTeamColor: freiTeamObj.color,
    eligibleTotalCount: eligibleEmps.length,
    eligibleFreiTeamCount: eligibleFromFreiTeam.length,
    eligibleNames: eligibleEmps.map(fullName)
  };
};

window.openCoverageReleaseModal = function(leaveId) {
  activeCoverageReleaseLeaveId = leaveId;
  const sl = sickLeaves.find(x => x.id === leaveId);
  let req = (leaveRequests || []).find(r => r.leaveId === leaveId || r.id === leaveId || r.id === ("cov_" + leaveId));
  if (!req && sl && !sl.isOnboardingNotice) {
    req = window.generateCoveragePromptForLeave(sl, "pending");
  }

  const modal = document.getElementById("coverageReleaseModal");
  const subEl = document.getElementById("coverageReleaseSubtitle");
  const listEl = document.getElementById("coverageReleaseDaysList");
  if (!modal || !listEl) return;

  const emp = sl ? employees.find(e => e.id === sl.empId) : (req ? employees.find(e => e.id === req.empId) : null);
  const nameTxt = emp ? fullName(emp) : "Mitarbeiter";
  const roleTxt = (req && req.role) ? req.role : (emp ? emp.role : "Bediener");
  const probLineTxt = (req && req.probableLines) ? (" · " + req.probableLines) : "";

  if (subEl) {
    subEl.innerHTML =
      "Ausfall: <b style='color:#0f172a;'>" + nameTxt + "</b> <span style='color:#64748b;'>(" + roleTxt + probLineTxt + ")</span> · " +
      "<span style='font-size:0.72rem; color:#64748b;'>Einzelne Tage per <b>Ja / Nein</b> fürs Portal schalten:</span>";
  }

  const validDays = (req && Array.isArray(req.days)) ? req.days : [];

  if (!validDays.length) {
    listEl.style.display = "block";
    listEl.innerHTML = '<p style="font-size:0.78rem; color:#64748b; padding:6px;">In diesem genehmigten Zeitraum fallen laut 2-2-2-Schichtplan (Sonntag frei) keine regulären Arbeitstage für ' + nameTxt + ' an.</p>';
  } else {
    listEl.style.display = "grid";
    listEl.innerHTML = validDays.map((d, dIdx) => {
      const st = d.dayStatus || "pending";
      const isOpen = (st === "open");
      const isRejected = (st === "rejected" || st === "closed");
      const isTaken = !!d.takenBy;
      const takenEmp = isTaken ? employees.find(x => x.id === d.takenBy) : null;
      const wdShort = getWeekdayShortDe(d.date);

      const targetInfo = window.getCoverageTargetInfoForDay(d.date, d.shift, roleTxt);
      const hasYellowWarning = !targetInfo.isPast && targetInfo.eligibleTotalCount === 0;

      let teamMetaHtml = "";
      if (targetInfo.isPast) {
        teamMetaHtml = '<span style="color:#94a3b8;">⌛ Vergangen</span>';
      } else if (targetInfo.eligibleTotalCount > 0) {
        const namesHint = targetInfo.eligibleNames.slice(0, 4).join(", ") + (targetInfo.eligibleNames.length > 4 ? "..." : "");
        teamMetaHtml =
          '<span style="color:' + targetInfo.freiTeamColor + '; font-weight:700;">■ ' + targetInfo.freiTeamName + '</span>' +
          ' · <span style="color:#15803d; font-weight:600;" title="Verfügbar: ' + namesHint + '">🟢 ' + targetInfo.eligibleTotalCount + ' frei</span>';
      } else {
        teamMetaHtml =
          '<span style="color:' + targetInfo.freiTeamColor + '; font-weight:600;">■ ' + targetInfo.freiTeamName + '</span>' +
          ' · <span style="color:#d97706; font-weight:700;" title="Ruhezeit-Warnung">🟡 0 ohne Konflikt</span>';
      }

      let rightControlHtml = "";
      if (isTaken) {
        rightControlHtml =
          '<span style="background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; padding:2px 7px; border-radius:999px; font-size:0.66rem; font-weight:700; white-space:nowrap;">' +
            '🤝 ' + (takenEmp ? fullName(takenEmp) : 'Besetzt') +
          '</span>';
      } else {
        const yesStyle = isOpen
          ? (hasYellowWarning ? "background:#f59e0b; color:#fff;" : "background:#10b981; color:#fff;")
          : "background:#fff; color:#64748b; border:1px solid #cbd5e1;";
        const noStyle = isRejected
          ? "background:#ef4444; color:#fff;"
          : "background:#fff; color:#64748b; border:1px solid #cbd5e1;";

        rightControlHtml =
          '<div style="display:inline-flex; gap:2px; flex-shrink:0;">' +
            '<button type="button" onclick="setCoverageDayDecision(\'' + req.leaveId + '\', ' + dIdx + ', \'open\')" style="border:none; border-radius:5px; padding:3px 7px; font-size:0.68rem; font-weight:700; cursor:pointer; ' + yesStyle + '">Ja</button>' +
            '<button type="button" onclick="setCoverageDayDecision(\'' + req.leaveId + '\', ' + dIdx + ', \'rejected\')" style="border:none; border-radius:5px; padding:3px 7px; font-size:0.68rem; font-weight:700; cursor:pointer; ' + noStyle + '">Nein</button>' +
          '</div>';
      }

      const rowBorderColor = isTaken ? "#bae6fd" : (isOpen ? (hasYellowWarning ? "#fde68a" : "#bbf7d0") : (isRejected ? "#fecaca" : "#e2e8f0"));
      const rowBg = isOpen ? (hasYellowWarning ? "#fffbeb" : "#f0fdf4") : (isRejected ? "#fff1f2" : "#ffffff");
      const statusDot = isOpen ? (hasYellowWarning ? "🟡" : "🟢") : (isRejected ? "🔴" : "⚪");

      return (
        '<div style="display:flex; justify-content:space-between; align-items:center; background:' + rowBg + '; border:1px solid ' + rowBorderColor + '; padding:5px 8px; border-radius:8px; gap:6px;">' +
          '<div style="min-width:0; flex:1;">' +
            '<div style="font-size:0.76rem; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:4px;">' +
              '<span style="font-size:0.6rem;">' + statusDot + '</span>' +
              '<span>' + (wdShort ? wdShort + ', ' : '') + formatDateDe(d.date).slice(0, 6) + ' · ' + (shiftsShortLabel[d.shift] || d.shift) + '</span>' +
            '</div>' +
            '<div style="font-size:0.65rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' +
              teamMetaHtml +
            '</div>' +
          '</div>' +
          rightControlHtml +
        '</div>'
      );
    }).join("");
  }

  modal.style.display = "flex";
};

window.setCoverageDayDecision = function(leaveId, dayIdx, decisionStatus) {
  const req = (leaveRequests || []).find(r => r.leaveId === leaveId || r.id === leaveId || r.id === ("cov_" + leaveId));
  if (!req || !req.days || !req.days[dayIdx]) return;
  const d = req.days[dayIdx];
  d.dayStatus = decisionStatus;
  d.explicitlyApproved = (decisionStatus === "open");
  d.decidedBy = getCurrentActorLabel();
  d.decidedAt = new Date().toISOString();

  if (decisionStatus === "open") {
    const info = window.getCoverageTargetInfoForDay(d.date, d.shift, req.role || "Bediener");
    d.allowWithRestWarning = (info.eligibleTotalCount === 0);
  } else {
    d.allowWithRestWarning = false;
  }

  const sl = sickLeaves.find(x => x.id === req.leaveId);
  if (sl) {
    appendAuditEntry(sl, "Bringschicht am " + formatDateDe(d.date) + " (" + (shiftsShortLabel[d.shift] || d.shift) + ") auf " + (decisionStatus === "open" ? "JA (Freigegeben)" : "NEIN (Gesperrt)") + " gesetzt");
  }

  saveToFirebase();
  const modal = document.getElementById("coverageReleaseModal");
  if (modal && modal.style.display === "flex") {
    window.openCoverageReleaseModal(req.leaveId);
  }
  window.renderInboxLists();
};

window.toggleCoverageDayStatus = function(leaveId, dayIdx) {
  const req = (leaveRequests || []).find(r => r.leaveId === leaveId || r.id === leaveId || r.id === ("cov_" + leaveId));
  if (!req || !req.days || !req.days[dayIdx]) return;
  const cur = req.days[dayIdx].dayStatus;
  const next = (cur === "open") ? "rejected" : "open";
  window.setCoverageDayDecision(leaveId, dayIdx, next);
};

window.toggleCoverageCardExpand = function(leaveIdKey) {
  expandedCoverageCards[leaveIdKey] = !expandedCoverageCards[leaveIdKey];
  window.renderInboxLists();
};

window.setAllModalCoverageDaysStatus = function(mode) {
  if (!activeCoverageReleaseLeaveId) return;
  const req = (leaveRequests || []).find(r => r.leaveId === activeCoverageReleaseLeaveId || r.id === activeCoverageReleaseLeaveId || r.id === ("cov_" + activeCoverageReleaseLeaveId));
  if (!req || !Array.isArray(req.days)) return;

  const reqRole = req.role || "Bediener";
  let openCount = 0;
  const actor = getCurrentActorLabel();
  const nowIso = new Date().toISOString();

  req.days.forEach(d => {
    if (d.takenBy) return;
    const info = window.getCoverageTargetInfoForDay(d.date, d.shift, reqRole);
    d.decidedBy = actor;
    d.decidedAt = nowIso;

    if (mode === "open_green") {
      if (!info.isPast && info.eligibleTotalCount > 0) {
        d.dayStatus = "open";
        d.explicitlyApproved = true;
        d.allowWithRestWarning = false;
        openCount++;
      } else {
        d.dayStatus = "rejected";
        d.explicitlyApproved = false;
        d.allowWithRestWarning = false;
      }
    } else if (mode === "open_all" || mode === "open") {
      d.dayStatus = "open";
      d.explicitlyApproved = true;
      d.allowWithRestWarning = (info.eligibleTotalCount === 0);
      openCount++;
    } else {
      d.dayStatus = "rejected";
      d.explicitlyApproved = false;
      d.allowWithRestWarning = false;
    }
  });

  const sl = sickLeaves.find(x => x.id === req.leaveId);
  if (sl) {
    appendAuditEntry(sl, "Bringschicht-Schnellwahl ausgeführt (" + openCount + " Tage auf JA freigegeben)");
  }

  saveToFirebase();
  window.openCoverageReleaseModal(req.leaveId);
  window.renderInboxLists();

  if (mode === "open_green") {
    showToast("🟢 " + openCount + " regulär fahrbare Tage mit JA freigegeben");
  } else if (mode === "open_all" || mode === "open") {
    showToast("🟡 Alle " + openCount + " Tage fürs Portal freigegeben!");
  } else {
    showToast("❌ Alle Schichttage mit NEIN gesperrt");
  }
};

/* MODAL: Urlaub teilgenehmigen / splitten / Gegenangebot mit Plus-Zeichen (+) */
window.openLeaveCounterOfferModal = function(leaveId) {
  const sl = sickLeaves.find(x => x.id === leaveId);
  if (!sl) return;
  activeCounterOfferLeaveId = sl.id;

  const emp = employees.find(e => e.id === sl.empId);
  const eName = emp ? fullName(emp) : "Mitarbeiter";
  const origStart = sl.originalStartDate || sl.startDate;
  const origEnd = sl.originalEndDate || sl.endDate;

  const infoBox = document.getElementById("counterOfferOriginalInfo");
  if (infoBox) {
    infoBox.innerHTML =
      "<b>👤 " + eName + "</b> · <b>" + (sl.category || "Urlaub") + "</b><br>" +
      "Ursprünglich beantragt: <b>" + formatDateDe(origStart) + " bis " + formatDateDe(origEnd) + "</b>" +
      (sl.reason ? " <span style='color:#64748b;'>(" + sl.reason + ")</span>" : "");
  }

  const container = document.getElementById("counterOfferBlocksContainer");
  if (!container) return;
  container.innerHTML = "";

  const existingBlocks = (Array.isArray(sl.blocks) && sl.blocks.length > 0)
    ? sl.blocks
    : [{ start: sl.startDate, end: sl.endDate, status: "counter_offer" }];

  existingBlocks.forEach(b => {
    window.addCounterOfferBlockRow(b.start, b.end, b.status || "counter_offer");
  });

  const noteInp = document.getElementById("counterOfferPlannerNote");
  if (noteInp) noteInp.value = sl.plannerCounterNote || "";

  const modal = document.getElementById("leaveCounterOfferModal");
  if (modal) modal.style.display = "flex";
};

window.addCounterOfferBlockRow = function(startVal, endVal, statusVal) {
  const container = document.getElementById("counterOfferBlocksContainer");
  if (!container) return;

  const sl = sickLeaves.find(x => x.id === activeCounterOfferLeaveId);
  const defStart = startVal || (sl ? sl.startDate : getLogicalDateIso());
  const defEnd = endVal || (sl ? sl.endDate : defStart);
  const defStatus = statusVal || (container.children.length === 0 ? "approved" : "counter_offer");

  const row = document.createElement("div");
  row.className = "counter-offer-block-row";
  row.style.cssText = "display:flex; gap:6px; align-items:center; flex-wrap:wrap; background:#f8fafc; border:1px solid #cbd5e1; padding:7px 9px; border-radius:8px;";
  row.innerHTML =
    '<div style="display:flex; align-items:center; gap:4px; flex:1; min-width:135px;">' +
      '<span style="font-size:0.72rem; font-weight:700; color:#475569;">Von:</span>' +
      '<input type="date" class="form-control co-block-start" value="' + window.normalizeDateIso(defStart) + '" style="padding:4px 6px; font-size:0.78rem;">' +
    '</div>' +
    '<div style="display:flex; align-items:center; gap:4px; flex:1; min-width:135px;">' +
      '<span style="font-size:0.72rem; font-weight:700; color:#475569;">Bis:</span>' +
      '<input type="date" class="form-control co-block-end" value="' + window.normalizeDateIso(defEnd) + '" style="padding:4px 6px; font-size:0.78rem;">' +
    '</div>' +
    '<select class="form-control co-block-status" style="width:auto; flex:1; min-width:170px; padding:4px 6px; font-size:0.76rem; font-weight:700;">' +
      '<option value="approved" ' + (defStatus === "approved" ? "selected" : "") + '>✅ Fest genehmigen (Aktiv)</option>' +
      '<option value="counter_offer" ' + (defStatus === "counter_offer" ? "selected" : "") + '>💬 Gegenangebot (Vorschlag)</option>' +
      '<option value="rejected" ' + (defStatus === "rejected" ? "selected" : "") + '>❌ Ablehnen (Gesperrt)</option>' +
    '</select>' +
    '<button type="button" class="btn btn-outline" style="padding:3px 8px; font-size:0.74rem; color:#dc2626; border-color:#fca5a5;" onclick="this.parentElement.remove()" title="Zeitraum-Zeile entfernen">✕</button>';

  container.appendChild(row);
};

window.saveCounterOfferAndSplitLeave = function() {
  if (!activeCounterOfferLeaveId) return;
  const sl = sickLeaves.find(x => x.id === activeCounterOfferLeaveId);
  if (!sl) return;

  const rows = Array.from(document.querySelectorAll("#counterOfferBlocksContainer .counter-offer-block-row"));
  if (!rows.length) {
    showToast("Bitte mindestens einen Zeitraum mit '+' anlegen", true);
    return;
  }

  const parsedBlocks = [];
  for (let i = 0; i < rows.length; i++) {
    const s = window.normalizeDateIso(rows[i].querySelector(".co-block-start").value);
    const e = window.normalizeDateIso(rows[i].querySelector(".co-block-end").value);
    const st = rows[i].querySelector(".co-block-status").value || "approved";
    if (!s || !e || s > e) {
      showToast("Bitte gültige Von/Bis-Daten in Zeile " + (i + 1) + " eingeben!", true);
      return;
    }
    parsedBlocks.push({ start: s, end: e, status: st });
  }

  parsedBlocks.sort((a, b) => a.start.localeCompare(b.start));

  /* Prüfen, ob sich zwei Teil-Blöcke überlappen */
  for (let i = 1; i < parsedBlocks.length; i++) {
    if (parsedBlocks[i].start <= parsedBlocks[i - 1].end) {
      showToast("⛔ Zeitraum-Blöcke dürfen sich nicht überschneiden (" + formatDateDe(parsedBlocks[i].start) + ")!", true);
      return;
    }
  }

  if (!sl.originalStartDate) sl.originalStartDate = sl.startDate;
  if (!sl.originalEndDate) sl.originalEndDate = sl.endDate;

  sl.blocks = parsedBlocks;
  const nonRejected = parsedBlocks.filter(b => b.status !== "rejected");
  if (nonRejected.length > 0) {
    sl.startDate = nonRejected[0].start;
    sl.endDate = nonRejected[nonRejected.length - 1].end;
  } else {
    sl.startDate = parsedBlocks[0].start;
    sl.endDate = parsedBlocks[parsedBlocks.length - 1].end;
  }

  const hasCounter = parsedBlocks.some(b => b.status === "counter_offer");
  const hasApproved = parsedBlocks.some(b => b.status === "approved");

  sl.status = hasCounter ? "counter_offer" : (hasApproved ? "approved" : "rejected");
  sl.plannerUnreadInfo = false;
  sl.reviewedBy = getCurrentActorLabel();
  sl.reviewedAt = new Date().toISOString();

  const noteInp = document.getElementById("counterOfferPlannerNote");
  sl.plannerCounterNote = noteInp ? noteInp.value.trim() : "";

  const summaryParts = parsedBlocks.map(b => formatDateDe(b.start) + "–" + formatDateDe(b.end) + " (" + (b.status === "approved" ? "Genehmigt" : (b.status === "counter_offer" ? "Vorschlag" : "Abgelehnt")) + ")");
  appendAuditEntry(sl, "Zeitraum aufgeteilt / Gegenangebot: " + summaryParts.join(", "));

  const emp = employees.find(e => e.id === sl.empId);
  addHistoryLog("Urlaubs-Teilgenehmigung / Gegenangebot (" + parsedBlocks.length + " Blöcke) für " + (emp ? fullName(emp) : "") + " gespeichert", "ABSENCE");

  window.closeModal("leaveCounterOfferModal");

  if (hasApproved) {
    window.generateCoveragePromptForLeave(sl, "pending");
    window.openCoverageReleaseModal(sl.id);
    showToast("✅ Gespeichert! Genehmigte Teil-Tage können jetzt als Bringschicht geprüft werden.");
  } else {
    window.removeCoveragePromptForLeave(sl.id);
    showToast("💬 Gegenangebot mit Zeitstempel an Mitarbeiter gesendet!");
  }

  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
};

window.acceptLeaveCounterOffer = function(slId) {
  const sl = sickLeaves.find(x => x.id === slId);
  if (!sl) return false;
  const emp = employees.find(e => e.id === sl.empId);
  const empActor = (emp ? fullName(emp) : "Mitarbeiter") + " (Portal)";

  if (Array.isArray(sl.blocks) && sl.blocks.length > 0) {
    sl.blocks.forEach(b => {
      if (b.status === "counter_offer" || b.status === "pending") b.status = "approved";
    });
    const activeBlocks = sl.blocks.filter(b => b.status === "approved");
    if (activeBlocks.length > 0) {
      sl.startDate = activeBlocks[0].start;
      sl.endDate = activeBlocks[activeBlocks.length - 1].end;
    }
  }
  sl.status = "approved";
  sl.plannerUnreadInfo = true;
  appendAuditEntry(sl, "Gegenangebot vom Mitarbeiter verbindlich angenommen", empActor);
  window.generateCoveragePromptForLeave(sl, "pending");
  addHistoryLog((emp ? fullName(emp) : "Mitarbeiter") + " hat das Urlaubs-Gegenangebot angenommen", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  return true;
};

window.rejectLeaveCounterOffer = function(slId) {
  const sl = sickLeaves.find(x => x.id === slId);
  if (!sl) return false;
  const emp = employees.find(e => e.id === sl.empId);
  const empActor = (emp ? fullName(emp) : "Mitarbeiter") + " (Portal)";

  if (Array.isArray(sl.blocks) && sl.blocks.some(b => b.status === "approved")) {
    sl.blocks.forEach(b => {
      if (b.status === "counter_offer") b.status = "rejected";
    });
    const activeBlocks = sl.blocks.filter(b => b.status === "approved");
    if (activeBlocks.length > 0) {
      sl.startDate = activeBlocks[0].start;
      sl.endDate = activeBlocks[activeBlocks.length - 1].end;
    }
    sl.status = "approved";
    window.generateCoveragePromptForLeave(sl, "pending");
  } else {
    sl.status = "rejected";
    window.removeCoveragePromptForLeave(sl.id);
  }
  sl.plannerUnreadInfo = true;
  appendAuditEntry(sl, "Gegenangebot vom Mitarbeiter abgelehnt", empActor);
  addHistoryLog((emp ? fullName(emp) : "Mitarbeiter") + " hat das Urlaubs-Gegenangebot abgelehnt", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  return true;
};

window.openSettingsModal = function() {
  document.getElementById("settingsModal").style.display = "flex";
  if (plannerLevel === 2) {
    const profBtn = document.getElementById("tabBtnProfile");
    window.switchTab("tabProfile", profBtn);
  }
  renderSettingsLists();
};

window.switchTab = function(tabId, btnEl) {
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  const t = document.getElementById(tabId);
  if (t) t.classList.add("active");
  if (btnEl) btnEl.classList.add("active");
  renderSettingsLists();
};

window.renderAnchorDayButtons = function(selectedDays) {
  if (Array.isArray(selectedDays)) currentAnchorDaysSelection = selectedDays.slice();
  const container = document.getElementById("anchorDaysContainer");
  if (!container) return;
  const dayNames = [
    { d: 1, l: "Mo" }, { d: 2, l: "Di" }, { d: 3, l: "Mi" },
    { d: 4, l: "Do" }, { d: 5, l: "Fr" }, { d: 6, l: "Sa" }, { d: 0, l: "So" }
  ];
  container.innerHTML = dayNames.map(item => {
    const active = currentAnchorDaysSelection.indexOf(item.d) !== -1;
    return '<button type="button" class="btn ' + (active ? 'btn-primary' : 'btn-outline') + '" style="padding:4px 9px; font-size:0.75rem;" onclick="toggleAnchorDay(' + item.d + ')">' + item.l + '</button>';
  }).join("");
};

window.toggleAnchorDay = function(dayNum) {
  const idx = currentAnchorDaysSelection.indexOf(dayNum);
  if (idx === -1) currentAnchorDaysSelection.push(dayNum);
  else currentAnchorDaysSelection.splice(idx, 1);
  window.renderAnchorDayButtons(currentAnchorDaysSelection);
};

window.moveLineOrder = function(idx, dir) {
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= lines.length) return;
  const temp = lines[idx];
  lines[idx] = lines[targetIdx];
  lines[targetIdx] = temp;
  addHistoryLog("Linien-Reihenfolge geändert (" + temp.name + ")", "EMP");
  saveToFirebase();
  window.initBoard();
};

window.moveRoleOrder = function(idx, dir) {
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= roles.length) return;
  const temp = roles[idx];
  roles[idx] = roles[targetIdx];
  roles[targetIdx] = temp;
  addHistoryLog("Rollen-Reihenfolge geändert (" + temp + ")", "EMP");
  saveToFirebase();
  window.initBoard();
};

function initSettingsDragAndDrop() {
  settingsSortableInstances.forEach(s => s.destroy());
  settingsSortableInstances = [];

  const lineListEl = document.getElementById("lineSettingsList");
  if (lineListEl && typeof Sortable !== "undefined") {
    settingsSortableInstances.push(new Sortable(lineListEl, {
      handle: ".drag-handle",
      animation: 150,
      onEnd: evt => {
        if (evt.oldIndex === evt.newIndex) return;
        const moved = lines.splice(evt.oldIndex, 1)[0];
        lines.splice(evt.newIndex, 0, moved);
        addHistoryLog("Linie " + moved.name + " an Platz " + (evt.newIndex + 1) + " verschoben", "EMP");
        saveToFirebase();
        window.initBoard();
      }
    }));
  }

  const roleListEl = document.getElementById("roleList");
  if (roleListEl && typeof Sortable !== "undefined") {
    settingsSortableInstances.push(new Sortable(roleListEl, {
      handle: ".drag-handle",
      animation: 150,
      onEnd: evt => {
        if (evt.oldIndex === evt.newIndex) return;
        const moved = roles.splice(evt.oldIndex, 1)[0];
        roles.splice(evt.newIndex, 0, moved);
        addHistoryLog("Rolle " + moved + " verschoben", "EMP");
        saveToFirebase();
        window.initBoard();
      }
    }));
  }
}

window.onEmpLineCheckboxChange = function(changedChk) {
  if (changedChk && changedChk.checked) {
    if (changedChk.classList.contains("emp-main-line-chk")) {
      document.querySelectorAll(".emp-sec-line-chk").forEach(c => {
        if (c.value === changedChk.value) c.checked = false;
      });
    } else if (changedChk.classList.contains("emp-sec-line-chk")) {
      document.querySelectorAll(".emp-main-line-chk").forEach(c => {
        if (c.value === changedChk.value) c.checked = false;
      });
    }
  }
  window._tempEditEmpMainLines = Array.from(document.querySelectorAll(".emp-main-line-chk:checked")).map(c => c.value);
  window._tempEditEmpSecLines = Array.from(document.querySelectorAll(".emp-sec-line-chk:checked"))
    .map(c => c.value)
    .filter(id => window._tempEditEmpMainLines.indexOf(id) === -1);
};

/* Stellt sicher, dass das Tage-Fenster unter "🛡️ In Einarbeitung (Stamm-Schutz)"
   auf jedem Gerät (auch mobil wie auf Foto 22550.jpg) sofort aufklappt und das Ablaufdatum berechnet! */
function ensureTrainingProtectionDaysWindowExists() {
  const trChk = document.getElementById("newEmpInTrainingPhase");
  if (!trChk) return;
  let trWrap = document.getElementById("newEmpTrainingPhaseWrap");

  if (!trWrap) {
    trWrap = document.createElement("div");
    trWrap.id = "newEmpTrainingPhaseWrap";
    trWrap.style.cssText = "display:none; background:#eff6ff; padding:10px; border:1px solid #93c5fd; border-radius:8px; margin-top:6px;";
    trWrap.innerHTML =
      '<div style="font-size:0.75rem; font-weight:700; color:#1d4ed8; margin-bottom:6px;">🛡️ Stamm-Schutz-Zeitfenster (Fliegt nach Ablauf der Tage automatisch raus):</div>' +
      '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:8px;">' +
        '<div class="form-group">' +
          '<label>Schutzdauer (Tage):</label>' +
          '<input type="number" id="newEmpTrainingDays" class="form-control" value="360" min="1" max="1000" oninput="updateTrainingProtectionExpiryPreview()">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Stammlinien-Quote (%):</label>' +
          '<input type="number" id="newEmpTrainingMainPct" class="form-control" value="90" min="50" max="100">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Startdatum:</label>' +
          '<input type="date" id="newEmpTrainingStartDate" class="form-control" onchange="updateTrainingProtectionExpiryPreview()">' +
        '</div>' +
      '</div>' +
      '<div id="trainingExpiryPreviewText" style="font-size:0.72rem; color:#1e40af; font-weight:700; margin-top:6px;"></div>';

    const parentRow = trChk.closest("label") ? trChk.closest("label").parentElement : trChk.parentElement;
    if (parentRow) parentRow.insertAdjacentElement("afterend", trWrap);
  } else if (!document.getElementById("trainingExpiryPreviewText")) {
    const prevDiv = document.createElement("div");
    prevDiv.id = "trainingExpiryPreviewText";
    prevDiv.style.cssText = "font-size:0.72rem; color:#1e40af; font-weight:700; margin-top:6px;";
    trWrap.appendChild(prevDiv);
  }

  trChk.onchange = function() {
    trWrap.style.display = this.checked ? "block" : "none";
    const startInp = document.getElementById("newEmpTrainingStartDate");
    if (this.checked && startInp && !startInp.value) {
      startInp.value = getLogicalDateIso();
    }
    window.updateTrainingProtectionExpiryPreview();
  };

  const dInp = document.getElementById("newEmpTrainingDays");
  const sInp = document.getElementById("newEmpTrainingStartDate");
  if (dInp) dInp.oninput = window.updateTrainingProtectionExpiryPreview;
  if (sInp) sInp.onchange = window.updateTrainingProtectionExpiryPreview;
}

window.updateTrainingProtectionExpiryPreview = function() {
  const prevEl = document.getElementById("trainingExpiryPreviewText");
  if (!prevEl) return;
  const dInp = document.getElementById("newEmpTrainingDays");
  const sInp = document.getElementById("newEmpTrainingStartDate");
  const days = Math.max(1, parseInt(dInp ? dInp.value : 360, 10) || 360);
  const startIso = window.normalizeDateIso((sInp && sInp.value) ? sInp.value : getLogicalDateIso());
  const startObj = new Date(startIso + "T12:00:00");
  if (isNaN(startObj.getTime())) {
    prevEl.textContent = "";
    return;
  }
  const endObj = new Date(startObj.getTime() + days * 86400000);
  const endIso = endObj.getFullYear() + "-" + String(endObj.getMonth() + 1).padStart(2, "0") + "-" + String(endObj.getDate()).padStart(2, "0");
  const todayObj = new Date(getLogicalDateIso() + "T12:00:00");
  const remDays = Math.max(0, Math.ceil((endObj.getTime() - todayObj.getTime()) / 86400000));

  prevEl.innerHTML = "⏱️ Automatischer Ablauf am <b>" + formatDateDe(endIso) + "</b> (noch <b>" + remDays + " Tage</b> aktiv – danach wird der Stamm-Schutz automatisch entfernt).";
};

function ensureStrategicMatrixSettingsControls() {
  const prodTodayIso = getLogicalDateIso();
  const bInfo = getBlockDayInfo(prodTodayIso);
  const statusEl = document.getElementById("live222BlockStatusText");
  if (statusEl) {
    statusEl.innerHTML =
      "Aktueller Produktionstag (ab 05:00 Uhr): <b>" + formatDateDe(prodTodayIso) + "</b> · Block: <b>" + bInfo.blockLabel + "</b> · " +
      "Nächster automatischer 2-2-2 Block-Wechsel: <b>" + getWeekdayShortDe(bInfo.nextChangeIso) + ", " + formatDateDe(bInfo.nextChangeIso) + " um 05:00 Uhr</b>";
  }

  const threshLblEl = document.getElementById("focusThresholdDynamicLbl");
  const curThresh = (shiftModelConfig && typeof shiftModelConfig.secondaryUnlockThresholdHours === "number") ? shiftModelConfig.secondaryUnlockThresholdHours : 160;
  if (threshLblEl) threshLblEl.textContent = curThresh + "h";

  if (document.getElementById("cfgFocusModeEnabled")) return;
  const swapChk = document.getElementById("cfgSmartAllowSwap");
  if (!swapChk || !swapChk.parentElement) return;

  const pctOptionsHtml = [];
  for (let p = 5; p <= 100; p += 5) {
    const daysOf7 = ((p / 100) * 7).toFixed(1).replace(".", ",");
    pctOptionsHtml.push('<option value="' + p + '">' + p + '% (ca. ' + daysOf7 + ' von 7 Arbeitstagen)</option>');
  }

  const box = document.createElement("div");
  box.style.cssText = "margin-top:8px; padding:10px 12px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:10px; display:flex; flex-direction:column; gap:8px;";
  box.innerHTML =
    '<div style="font-size:0.78rem; font-weight:700; color:#0369a1;">🎯 Strategische Qualifikations-, Fokus- & 2-2-2 (Sonntag frei) Automatik</div>' +
    '<div id="live222BlockStatusText" style="font-size:0.74rem; color:#0f172a; background:#ffffff; padding:6px 9px; border-radius:6px; border:1px solid #bae6fd;">' +
      'Aktueller Produktionstag (ab 05:00 Uhr): <b>' + formatDateDe(prodTodayIso) + "</b> · Block: <b>" + bInfo.blockLabel + "</b> · " +
      'Nächster automatischer 2-2-2 Block-Wechsel: <b>' + getWeekdayShortDe(bInfo.nextChangeIso) + ', ' + formatDateDe(bInfo.nextChangeIso) + ' um 05:00 Uhr</b>' +
    '</div>' +
    '<button type="button" class="btn btn-primary" style="padding:6px 10px; font-size:0.74rem; align-self:flex-start;" onclick="syncCurrentBoardAs222Anchor()">🔄 Aktuelle Team-Aufstellung als heutigen 2-2-2 Start-Anker speichern & neu verteilen</button>' +
    '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; background:#ffffff; padding:7px 10px; border-radius:8px; border:1px solid #bae6fd;">' +
      '<label style="font-size:0.76rem; display:flex; align-items:center; gap:6px; cursor:pointer; flex:1; min-width:220px;">' +
        '<input type="checkbox" id="cfgFocusModeEnabled" onchange="saveShiftModelSettings()"> ' +
        '<span><b>Fokus-Modus:</b> Angefangene Einarbeitung (>0h bis <span id="focusThresholdDynamicLbl">' + curThresh + 'h</span>) anteilig einplanen</span>' +
      '</label>' +
      '<div style="display:flex; align-items:center; gap:6px; font-size:0.75rem; font-weight:700; color:#0369a1;">' +
        '<span>Einsatz-Quote:</span>' +
        '<select id="cfgFocusModePercent" class="form-control" style="width:auto; padding:4px 8px; font-size:0.75rem; font-weight:700; color:#0f172a;" onchange="saveShiftModelSettings()">' +
          pctOptionsHtml.join("") +
        '</select>' +
      '</div>' +
    '</div>' +
    '<label style="font-size:0.76rem; display:flex; align-items:center; gap:6px; cursor:pointer;">' +
      '<input type="checkbox" id="cfgFairnessBalanceEnabled" onchange="saveShiftModelSettings()"> ' +
      '<span><b>Fairness & Gleichgewicht:</b> Bei Sekundärlinien fair abwechseln (Einsatz-Gedächtnis)</span>' +
    '</label>' +
    '<div style="display:flex; align-items:center; gap:8px; font-size:0.76rem; flex-wrap:wrap;">' +
      '<span><b>Förder-Zyklus (Stamm-Bediener an neue Linien heranführen):</b> Alle</span>' +
      '<input type="number" id="cfgRotationCycleMonths" min="0" max="24" style="width:55px; padding:3px 6px; border:1px solid #cbd5e1; border-radius:6px;" onchange="saveShiftModelSettings()">' +
      '<span>Monate (0 = Aus)</span>' +
    '</div>';
  swapChk.parentElement.insertAdjacentElement("afterend", box);
}

function renderSettingsLists() {
  ensureTrainingProtectionDaysWindowExists();
  ensureStrategicMatrixSettingsControls();
  const empListEl = document.getElementById("employeeList");
  if (empListEl) {
    const todayIso = getLogicalDateIso();
    const filteredEmps = employees.filter(e => {
      if (settingsEmpSearchQuery) {
        const hay = (fullName(e) + " " + (e.password || "") + " " + (e.role || "")).toLowerCase();
        if (hay.indexOf(settingsEmpSearchQuery) === -1) return false;
      }
      return true;
    });

    empListEl.innerHTML = filteredEmps.map(e => {
      const tObj = teamsConfig[e.team] || { name: e.team, color: "#0091df" };
      const pinAction = (plannerLevel >= 3)
        ? '<button class="btn btn-outline" style="padding:2px 7px; font-size:0.68rem; color:#0284c7; border-color:#bae6fd;" onclick="resetEmployeePin(\'' + e.id + '\')" title="Neue einmalige Start-PIN generieren">🔑 PIN</button>'
        : '';
      const ehBadge = e.ersthelfer ? ' <span style="color:#dc2626; font-weight:900;">+</span>' : '';
      const pinVal = e.password || "1234";
      const isStartPin = (e.mustChangePw !== false);
      const pinBadge = isStartPin
        ? '<span class="start-pin-badge" title="Einmalige Start-PIN (noch nicht vom Mitarbeiter geändert)">🔑 Start-PIN: ' + pinVal + '</span>'
        : '<span class="own-pin-badge" title="Mitarbeiter hat eigene PIN vergeben">🔒 Eigene PIN</span>';

      const isOnbDone = !!(e.onboardingCompleted || (Array.isArray(e.mainLines) && e.mainLines.length > 0));
      const onbBadge = isOnbDone
        ? '<span style="font-size:0.65rem; font-weight:700; padding:1px 6px; border-radius:999px; background:#dcfce7; color:#166534; border:1px solid #86efac; white-space:nowrap;">✅ Onboarding abgeschlossen</span>'
        : '<span style="font-size:0.64rem; font-weight:600; padding:1px 6px; border-radius:999px; background:#f8fafc; color:#64748b; border:1px solid #cbd5e1; white-space:nowrap;">⏳ Onboarding offen</span>';

      const protInfo = window.getEmpTrainingProtectionInfo(e, todayIso);
      const traineeBadge = protInfo.active
        ? '<span style="font-size:0.65rem; font-weight:700; padding:1px 6px; border-radius:999px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; white-space:nowrap;" title="Stamm-Schutz aktiv seit ' + formatDateDe(protInfo.startDate) + '">🛡️ Stamm-Schutz: ' + protInfo.mainPct + '% (noch ' + protInfo.remainingDays + ' Tg.)</span>'
        : '';

      const mList = Array.isArray(e.mainLines) ? e.mainLines.map(getShortLineNumber).filter(Boolean).join(", ") : "";
      const sList = Array.isArray(e.secLines) ? e.secLines.map(getShortLineNumber).filter(Boolean).join(", ") : "";
      const linesMiniInfo = (mList || sList)
        ? '<span style="font-size:0.64rem; font-weight:600; color:#0369a1; background:#f0f9ff; border:1px solid #bae6fd; padding:1px 6px; border-radius:999px; white-space:nowrap;">' +
            (mList ? '★ Prio: ' + mList : '') + (mList && sList ? ' · ' : '') + (sList ? 'Sek: ' + sList : '') +
          '</span>'
        : '';

      const onbResetAction = (plannerLevel >= 3 && isOnbDone)
        ? '<button class="btn btn-outline" style="padding:2px 6px; font-size:0.68rem; color:#b45309; border-color:#fde68a;" onclick="resetEmployeeOnboarding(\'' + e.id + '\')" title="Onboarding für diesen Mitarbeiter zurücksetzen">🔄 Onb.</button>'
        : '';

      return '<div class="item-row">' +
        '<div class="emp-row-info"><span style="color:' + tObj.color + '; font-weight:700;">■</span> <b>' + fullName(e) + '</b>' + ehBadge + ' <small style="color:#64748b;">(' + e.role + ')</small> ' + linesMiniInfo + ' ' + pinBadge + ' ' + onbBadge + ' ' + traineeBadge + '</div>' +
        '<div class="emp-row-actions">' + onbResetAction + pinAction +
          '<button class="btn btn-outline" style="padding:2px 7px; font-size:0.72rem;" onclick="editEmployee(\'' + e.id + '\')">✏️</button>' +
          '<button class="btn btn-outline" style="padding:2px 7px; font-size:0.72rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteEmployee(\'' + e.id + '\')">🗑️</button>' +
        '</div></div>';
    }).join("");
  }

  const mainLinesBox = document.getElementById("mainLinesCheckboxes");
  const secLinesBox = document.getElementById("secLinesCheckboxes");
  const currentMain = window._tempEditEmpMainLines || [];
  const currentSec = (window._tempEditEmpSecLines || []).filter(id => currentMain.indexOf(id) === -1);

  if (mainLinesBox) {
    mainLinesBox.innerHTML = lines.map(l =>
      '<label style="font-size:0.74rem; display:inline-flex; align-items:center; gap:3px; cursor:pointer; background:#fff; padding:3px 6px; border:1px solid #cbd5e1; border-radius:6px;"><input type="checkbox" value="' + l.id + '" class="emp-main-line-chk" ' + (currentMain.indexOf(l.id) !== -1 ? 'checked' : '') + ' onchange="onEmpLineCheckboxChange(this)"> ' + l.name + '</label>'
    ).join("");
  }
  if (secLinesBox) {
    secLinesBox.innerHTML = lines.map(l =>
      '<label style="font-size:0.74rem; display:inline-flex; align-items:center; gap:3px; cursor:pointer; background:#fff; padding:3px 6px; border:1px solid #cbd5e1; border-radius:6px;"><input type="checkbox" value="' + l.id + '" class="emp-sec-line-chk" ' + (currentSec.indexOf(l.id) !== -1 ? 'checked' : '') + ' onchange="onEmpLineCheckboxChange(this)"> ' + l.name + '</label>'
    ).join("");
  }

  const teamSel = document.getElementById("newEmpTeam");
  if (teamSel) {
    const curTeam = teamSel.value || Object.keys(teamsConfig)[0];
    teamSel.innerHTML = Object.keys(teamsConfig).sort().map(k => '<option value="' + k + '">' + teamsConfig[k].name + '</option>').join("");
    if (teamsConfig[curTeam]) teamSel.value = curTeam;
  }

  const roleSel = document.getElementById("newEmpRole");
  if (roleSel) {
    const curRole = roleSel.value || roles[0];
    roleSel.innerHTML = roles.map(r => '<option value="' + r + '">' + r + '</option>').join("");
    if (roles.indexOf(curRole) !== -1) roleSel.value = curRole;
  }

  const roleListEl = document.getElementById("roleList");
  if (roleListEl) {
    if (!shiftModelConfig.roleRequiresLines) shiftModelConfig.roleRequiresLines = {};
    if (!shiftModelConfig.roleAllowLineAssign) shiftModelConfig.roleAllowLineAssign = {};
    roleListEl.innerHTML = roles.map((r, idx) => {
      const needsLines = window.doesRoleRequireLines(r);
      const allowAssign = window.canRoleBeAssignedToLine(r);
      return '<div class="item-row" data-role-idx="' + idx + '" style="flex-wrap:wrap; gap:6px;">' +
        '<div style="display:flex; align-items:center; gap:6px;">' +
          '<span class="drag-handle" title="Ziehen zum Verschieben">☰</span>' +
          '<b>' + (idx + 1) + '. ' + r + '</b>' +
        '</div>' +
        '<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">' +
          '<label style="font-size:0.72rem; display:flex; align-items:center; gap:4px; cursor:pointer; font-weight:700; color:#166534; background:#f0fdf4; padding:2px 8px; border-radius:999px; border:1px solid #bbf7d0;" title="Steuert, ob diese Rolle automatisch auf Linien verteilt werden darf">' +
            '<input type="checkbox" ' + (allowAssign ? 'checked' : '') + ' onchange="toggleRoleAllowLineAssignFlag(\'' + r + '\', this.checked)"> 🎯 Darf auf Linien verteilt werden' +
          '</label>' +
          '<label style="font-size:0.72rem; display:flex; align-items:center; gap:4px; cursor:pointer; font-weight:600; color:#0369a1; background:#f0f9ff; padding:2px 8px; border-radius:999px; border:1px solid #bae6fd;" title="Bestimmt, ob Mitarbeiter dieser Rolle im Onboarding Linien auswählen müssen">' +
            '<input type="checkbox" ' + (needsLines ? 'checked' : '') + ' onchange="toggleRoleOnboardingLinesFlag(\'' + r + '\', this.checked)"> 🏭 Anlagen für Onboarding' +
          '</label>' +
          '<button class="move-arrow-btn" onclick="moveRoleOrder(' + idx + ', -1)" ' + (idx === 0 ? 'disabled style="opacity:0.35;"' : '') + '>⬆️</button>' +
          '<button class="move-arrow-btn" onclick="moveRoleOrder(' + idx + ', 1)" ' + (idx === roles.length - 1 ? 'disabled style="opacity:0.35;"' : '') + '>⬇️</button>' +
          '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.72rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteRole(' + idx + ')">🗑️</button>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  const lineListEl = document.getElementById("lineSettingsList");
  if (lineListEl) {
    lineListEl.innerHTML = lines.map((l, idx) =>
      '<div class="item-row" data-line-id="' + l.id + '">' +
        '<div style="display:flex; align-items:center; gap:6px; min-width:0; flex-wrap:wrap;">' +
          '<span class="drag-handle" title="Ziehen zum Verschieben">☰</span>' +
          '<span><b>[' + (l.floor || "1. OG") + '] ' + l.name + '</b> ' +
          (l.ausgeplant ? '<small style="color:#dc2626; font-weight:700;">(Ausgeplant)</small>' : (l.prio ? '<small style="color:#b45309; font-weight:700;">(' + l.prio + ')</small>' : '')) +
          (l.mainOnly ? ' <span class="line-mainonly-tag">🛡️ Nur Stamm</span>' : '') +
          ' <small style="color:#64748b;">(' + getLineRoleSummaryText(l) + ')</small></span>' +
        '</div>' +
        '<div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">' +
          '<button class="move-arrow-btn" onclick="moveLineOrder(' + idx + ', -1)" ' + (idx === 0 ? 'disabled style="opacity:0.35;"' : '') + '>⬆️</button>' +
          '<button class="move-arrow-btn" onclick="moveLineOrder(' + idx + ', 1)" ' + (idx === lines.length - 1 ? 'disabled style="opacity:0.35;"' : '') + '>⬇️</button>' +
          '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.74rem;" onclick="openLineEditModal(\'' + l.id + '\')">✏️ Bearbeiten</button>' +
          '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.74rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteLine(\'' + l.id + '\')">🗑️</button>' +
        '</div>' +
      '</div>'
    ).join("");
  }

  const teamListEl = document.getElementById("teamSettingsList");
  if (teamListEl) {
    teamListEl.innerHTML = Object.keys(teamsConfig).sort().map(k => {
      const t = teamsConfig[k];
      return '<div class="item-row"><span><span style="color:' + t.color + '; font-weight:700;">■</span> <b>' + t.name + '</b></span>' +
        '<div style="display:flex; gap:8px; align-items:center;">' +
        '<label style="font-size:0.74rem; display:flex; align-items:center; gap:4px; cursor:pointer;"><input type="checkbox" ' + (t.rotates !== false ? 'checked' : '') + ' onchange="toggleTeamRotationSetting(\'' + k + '\', this.checked)"> Rotiert</label>' +
        (Object.keys(teamsConfig).length > 1 ? '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.72rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteTeam(\'' + k + '\')">🗑️</button>' : '') +
        '</div></div>';
    }).join("");
  }

  initSettingsDragAndDrop();
  window.syncShiftModelSettingsUI();
  syncSecurityConfigUI();
  renderHistoryList();
  renderBackupList();
  renderProfileTab();
  renderUnqualifiedHoursOverview();
}

window.toggleRoleOnboardingLinesFlag = function(roleName, val) {
  if (!shiftModelConfig.roleRequiresLines) shiftModelConfig.roleRequiresLines = {};
  shiftModelConfig.roleRequiresLines[roleName] = val;
  saveToFirebase();
  showToast("Onboarding-Regel für '" + roleName + "' aktualisiert");
};

window.toggleRoleAllowLineAssignFlag = function(roleName, val) {
  if (!shiftModelConfig.roleAllowLineAssign) shiftModelConfig.roleAllowLineAssign = {};
  shiftModelConfig.roleAllowLineAssign[roleName] = val;
  saveToFirebase();
  showToast("Linien-Verteilungsregel für '" + roleName + "' auf " + (val ? "AN" : "AUS") + " gestellt");
};

window.syncShiftModelSettingsUI = function() {
  ensureStrategicMatrixSettingsControls();
  const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = String(val); };

  const normFocusPct = Math.min(100, Math.max(5, Math.round((Number(shiftModelConfig.focusModePercent) || 20) / 5) * 5));

  setChk("cfgAutoRotate", shiftModelConfig.autoRotate !== false);
  setChk("cfgSmartAssignEnabled", shiftModelConfig.smartAssignEnabled !== false);
  setChk("cfgSmartRespectFloorTL", shiftModelConfig.smartRespectFloorTL !== false);
  setChk("cfgSmartAllowSwap", shiftModelConfig.smartAllowSwap !== false);
  setChk("cfgFocusModeEnabled", shiftModelConfig.focusModeEnabled !== false);
  setVal("cfgFocusModePercent", normFocusPct);
  setChk("cfgFairnessBalanceEnabled", shiftModelConfig.fairnessBalanceEnabled !== false);
  setVal("cfgRotationCycleMonths", shiftModelConfig.rotationCycleMonths ?? 3);

  setChk("cfgResetEnabled", !!shiftModelConfig.resetEnabled);
  setVal("cfgResetDay", shiftModelConfig.resetDay ?? -1);
  setVal("cfgResetHour", shiftModelConfig.resetHour ?? 5);

  setChk("cfgLoadEnabled", !!shiftModelConfig.loadEnabled);
  setVal("cfgLoadDay", shiftModelConfig.loadDay ?? -1);
  setVal("cfgLoadHour", shiftModelConfig.loadHour ?? 5);

  setVal("cfgSecondaryUnlockHours", shiftModelConfig.secondaryUnlockThresholdHours ?? 160);
  setVal("cfgDefaultShiftHours", shiftModelConfig.defaultShiftHours ?? 8);
};

window.saveShiftModelSettings = function() {
  const getChk = (id, def) => { const el = document.getElementById(id); return el ? el.checked : def; };
  const getInt = (id, def) => { const el = document.getElementById(id); return el ? (parseInt(el.value, 10) ?? def) : def; };

  shiftModelConfig.autoRotate = getChk("cfgAutoRotate", true);
  shiftModelConfig.smartAssignEnabled = getChk("cfgSmartAssignEnabled", true);
  shiftModelConfig.smartRespectFloorTL = getChk("cfgSmartRespectFloorTL", true);
  shiftModelConfig.smartAllowSwap = getChk("cfgSmartAllowSwap", true);
  shiftModelConfig.focusModeEnabled = getChk("cfgFocusModeEnabled", true);

  const focusPctEl = document.getElementById("cfgFocusModePercent");
  if (focusPctEl) {
    shiftModelConfig.focusModePercent = Math.min(100, Math.max(5, Math.round((parseInt(focusPctEl.value, 10) || 20) / 5) * 5));
  }

  shiftModelConfig.fairnessBalanceEnabled = getChk("cfgFairnessBalanceEnabled", true);

  const rotMonthsEl = document.getElementById("cfgRotationCycleMonths");
  if (rotMonthsEl) shiftModelConfig.rotationCycleMonths = Math.max(0, parseInt(rotMonthsEl.value, 10) || 0);

  shiftModelConfig.resetEnabled = getChk("cfgResetEnabled", false);
  shiftModelConfig.resetDay = getInt("cfgResetDay", -1);
  shiftModelConfig.resetHour = getInt("cfgResetHour", 5);

  shiftModelConfig.loadEnabled = getChk("cfgLoadEnabled", false);
  shiftModelConfig.loadDay = getInt("cfgLoadDay", -1);
  shiftModelConfig.loadHour = getInt("cfgLoadHour", 5);

  const threshInp = document.getElementById("cfgSecondaryUnlockHours");
  if (threshInp) shiftModelConfig.secondaryUnlockThresholdHours = Math.max(6, parseInt(threshInp.value, 10) || 160);

  const threshLblEl = document.getElementById("focusThresholdDynamicLbl");
  if (threshLblEl) threshLblEl.textContent = shiftModelConfig.secondaryUnlockThresholdHours + "h";

  const hoursInp = document.getElementById("cfgDefaultShiftHours");
  if (hoursInp) shiftModelConfig.defaultShiftHours = Math.max(1, parseFloat(hoursInp.value) || 8);

  saveToFirebase();
  window.updateAutoRotationUI();
  renderEmployees();
  renderUnqualifiedHoursOverview();
  showToast("Einstellungen & Fokus-Quote (" + (shiftModelConfig.focusModePercent || 20) + "%) gespeichert!");
};

window.toggleNewTeamForm = function() {
  const wrap = document.getElementById("newTeamFormWrapper");
  if (wrap) wrap.style.display = (wrap.style.display === "none" || !wrap.style.display) ? "block" : "none";
};

window.toggleTeamRotationSetting = function(key, val) {
  if (teamsConfig[key]) {
    teamsConfig[key].rotates = val;
    ensureUniqueShiftRotationTeams();
    saveToFirebase();
    showToast("Team-Rotation aktualisiert");
  }
};

function syncSecurityConfigUI() {
  const chk = document.getElementById("secBoardPwEnabled");
  const inp = document.getElementById("secBoardPwValue");
  if (chk) chk.checked = !!(securityConfig && securityConfig.boardPwEnabled);
  if (inp) inp.value = (securityConfig && securityConfig.boardPw) ? securityConfig.boardPw : "0110";
}

window.autoSaveSecurityConfig = function() {
  const chk = document.getElementById("secBoardPwEnabled");
  const inp = document.getElementById("secBoardPwValue");
  if (chk) securityConfig.boardPwEnabled = chk.checked;
  if (inp && inp.value.trim()) securityConfig.boardPw = inp.value.trim();
  saveToFirebase();
  showToast("Sicherheits-Einstellung gespeichert!");
};
/* ==========================================================================
   12. HISTORIE, BACKUPS, PROFIL & STAMMDATEN (TEIL 2B – ABSCHNITT 12 BIS 13)
   ========================================================================== */

window.setHistoryCatFilter = function(cat, btnEl) {
  activeHistoryCategory = cat || "ALL";
  document.querySelectorAll(".history-pill").forEach(p => p.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
  renderHistoryList();
};

window.filterHistoryUnified = function() { renderHistoryList(); };

window.saveCurrentHistorySearchTerm = function() {
  const inp = document.getElementById("historyUnifiedInput");
  const term = inp ? inp.value.trim() : "";
  if (term && recentHistorySearches.indexOf(term) === -1) {
    recentHistorySearches.unshift(term);
    if (recentHistorySearches.length > 6) recentHistorySearches.pop();
    renderRecentHistoryChips();
    showToast("Suchbegriff '" + term + "' im Verlauf gemerkt");
  }
};

window.useRecentHistorySearch = function(term) {
  const inp = document.getElementById("historyUnifiedInput");
  if (inp) inp.value = term;
  renderHistoryList();
};

function renderRecentHistoryChips() {
  const chipsContainer = document.getElementById("historyRecentChips");
  if (!chipsContainer) return;
  chipsContainer.innerHTML = recentHistorySearches.length
    ? '<span style="font-size:0.68rem; color:#64748b; font-weight:700;">Verlauf:</span>' + recentHistorySearches.map(term =>
        '<span class="recent-chip" onclick="useRecentHistorySearch(\'' + term.replace(/'/g, "\\'") + '\')">🕒 ' + term + '</span>'
      ).join("")
    : "";
}

function renderHistoryList() {
  const listEl = document.getElementById("historyList");
  if (!listEl) return;

  const searchVal = (document.getElementById("historyUnifiedInput") ? document.getElementById("historyUnifiedInput").value : "").trim().toLowerCase();
  const timeVal = document.getElementById("historyTimeFilter") ? document.getElementById("historyTimeFilter").value : "ALL";
  const actorVal = document.getElementById("historyActorFilter") ? document.getElementById("historyActorFilter").value : "ALL";

  const actorSelect = document.getElementById("historyActorFilter");
  if (actorSelect) {
    const currentActorSelection = actorSelect.value;
    const actors = Array.from(new Set((historyLogs || []).map(item => item.actor).filter(Boolean))).sort();
    actorSelect.innerHTML = '<option value="ALL">👤 Alle Planer / System</option>' + actors.map(a => '<option value="' + a + '" ' + (a === currentActorSelection ? 'selected' : '') + '>' + a + '</option>').join("");
  }

  const nowMs = Date.now();
  const timeCutoff = timeVal === "TODAY" ? (nowMs - 86400000) : (timeVal === "7D" ? (nowMs - 7 * 86400000) : (timeVal === "30D" ? (nowMs - 30 * 86400000) : 0));

  const items = (Array.isArray(historyLogs) ? historyLogs : []).filter(item => {
    if (activeHistoryCategory !== "ALL" && item.category !== activeHistoryCategory) return false;
    if (actorVal !== "ALL" && item.actor !== actorVal) return false;
    if (timeCutoff > 0 && (item.timestamp ? new Date(item.timestamp).getTime() : nowMs) < timeCutoff) return false;
    if (searchVal) {
      const hay = ((item.text || "") + " " + (item.actor || "") + " " + (item.category || "")).toLowerCase();
      if (hay.indexOf(searchVal) === -1) return false;
    }
    return true;
  });

  if (!items.length) {
    listEl.innerHTML = '<p style="font-size:0.8rem; color:#64748b; padding:6px;">Keine Historien-Einträge gefunden.</p>';
    return;
  }

  const catStyleMap = {
    SHIFT: ["#e0f2fe", "#0369a1"],
    AUTO: ["#f5f3ff", "#6d28d9"],
    ABSENCE: ["#fff1f2", "#be123c"],
    EMP: ["#f0fdf4", "#15803d"],
    LOGIN: ["#fef3c7", "#b45309"],
    BACKUP: ["#f0fdf4", "#166534"]
  };

  listEl.innerHTML = items.slice(0, 150).map(item => {
    const d = item.timestamp ? new Date(item.timestamp) : new Date();
    const dStr = d.toLocaleDateString("de-DE") + " " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
    const [catBg, catCol] = catStyleMap[item.category] || ["#f1f5f9", "#475569"];

    return '<div class="item-row" style="font-size:0.78rem;">' +
      '<div><b>' + (item.text || "") + '</b> <div style="color:#64748b; font-size:0.7rem;">🛡️ ' + (item.actor || "System") + ' · ' + dStr + '</div></div>' +
      '<span style="font-size:0.65rem; padding:2px 8px; border-radius:999px; background:' + catBg + '; color:' + catCol + '; font-weight:700; white-space:nowrap;">' + (item.category || "INFO") + '</span>' +
    '</div>';
  }).join("");
}

window.createManualBackup = function() {
  const now = new Date();
  backups = Array.isArray(backups) ? backups : [];
  backups.unshift({
    id: "bak_" + now.getTime(),
    createdAt: now.toISOString(),
    createdBy: getCurrentActorLabel(),
    data: JSON.stringify({ lines, roles, employees, teamsConfig, shiftRotation, sickLeaves, leaveRequests, extraShifts, shiftModelConfig })
  });
  if (backups.length > 20) backups = backups.slice(0, 20);
  addHistoryLog("Manuelles System-Backup erstellt", "BACKUP");
  saveToFirebase();
  renderBackupList();
  showToast("Sicherungspunkt erfolgreich erstellt!");
};

window.restoreBackup = function(id) {
  const b = (backups || []).find(x => x.id === id);
  if (!b || !b.data) return;
  const dStr = b.createdAt ? new Date(b.createdAt).toLocaleString("de-DE") : "";
  if (!confirm("Möchten Sie das Backup vom " + dStr + " wirklich laden? Aktuelle Änderungen werden überschrieben.")) return;
  try {
    const parsed = JSON.parse(b.data);
    if (Array.isArray(parsed.lines)) lines = parsed.lines;
    if (Array.isArray(parsed.roles)) roles = parsed.roles;
    if (Array.isArray(parsed.employees)) employees = parsed.employees;
    if (parsed.teamsConfig) teamsConfig = parsed.teamsConfig;
    if (parsed.shiftRotation) shiftRotation = parsed.shiftRotation;
    if (Array.isArray(parsed.sickLeaves)) sickLeaves = parsed.sickLeaves;
    if (Array.isArray(parsed.leaveRequests)) leaveRequests = parsed.leaveRequests;
    if (Array.isArray(parsed.extraShifts)) extraShifts = parsed.extraShifts;
    if (parsed.shiftModelConfig) shiftModelConfig = Object.assign(shiftModelConfig, parsed.shiftModelConfig);
    ensureUniqueShiftRotationTeams();
    addHistoryLog("Backup wiederhergestellt vom " + dStr, "BACKUP");
    saveToFirebase();
    window.initBoard();
    showToast("Backup erfolgreich wiederhergestellt!");
  } catch (e) {
    showToast("Fehler beim Wiederherstellen!", true);
  }
};

window.deleteBackup = function(id) {
  if (!confirm("Sind Sie sicher, dass Sie diesen Sicherungspunkt dauerhaft löschen möchten?")) return;
  backups = (backups || []).filter(x => x.id !== id);
  saveToFirebase();
  renderBackupList();
  showToast("Backup gelöscht");
};

function renderBackupList() {
  const el = document.getElementById("backupList");
  if (!el) return;
  if (!Array.isArray(backups) || !backups.length) {
    el.innerHTML = '<p style="font-size:0.8rem; color:#64748b; padding:6px;">Noch keine Sicherungspunkte vorhanden.</p>';
    return;
  }
  el.innerHTML = backups.map(b => {
    const dStr = b.createdAt ? new Date(b.createdAt).toLocaleString("de-DE") : "";
    return '<div class="item-row" style="font-size:0.8rem;">' +
      '<div><b>Sicherung vom ' + dStr + '</b><div style="font-size:0.7rem; color:#64748b;">Erstellt von: ' + (b.createdBy || "Planer") + '</div></div>' +
      '<div style="display:flex; gap:6px;">' +
        '<button class="btn btn-outline" style="padding:3px 8px; font-size:0.72rem; color:var(--bayer-blue); border-color:var(--bayer-blue);" onclick="restoreBackup(\'' + b.id + '\')">🔄 Laden</button>' +
        '<button class="btn btn-outline" style="padding:3px 8px; font-size:0.72rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteBackup(\'' + b.id + '\')">🗑️</button>' +
      '</div></div>';
  }).join("");
}

function renderProfileTab() {
  const box = document.getElementById("profileInfoBox");
  if (!box) return;
  const emp = employees.find(e => e.id === currentPlannerEmpId) || employees.find(e => fullName(e) === currentPlannerName);
  if (!emp) {
    box.innerHTML = '<div><b>Angemeldet als:</b> ' + (currentPlannerName || "Planer") + ' (Stufe ' + plannerLevel + ')</div>';
    return;
  }
  const tObj = teamsConfig[emp.team] || { name: emp.team };
  box.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      '<div><div style="font-size:0.95rem; font-weight:700;">👤 ' + fullName(emp) + '</div>' +
      '<div style="font-size:0.78rem; color:#64748b; margin-top:2px;">Rolle: <b>' + emp.role + '</b> · Team: <b>' + tObj.name + '</b> · Berechtigung: <b>Stufe ' + (emp.accessLevel || plannerLevel) + '</b></div></div>' +
    '</div>';
}

window.saveProfilePinChange = function() {
  const oldPin = (document.getElementById("profOldPin").value || "").trim();
  const newPin = (document.getElementById("profNewPin").value || "").trim();
  const confPin = (document.getElementById("profNewPinConfirm").value || "").trim();

  const emp = employees.find(e => e.id === currentPlannerEmpId) || employees.find(e => fullName(e) === currentPlannerName);
  if (!emp) return showTimedBoxMsg("profPinMsg", "❌ Benutzerprofil nicht gefunden!", false);
  if ((emp.password || "1234") !== oldPin) return showTimedBoxMsg("profPinMsg", "❌ Aktuelle PIN ist nicht korrekt!", false);
  if (newPin.length < 4) return showTimedBoxMsg("profPinMsg", "❌ Neue PIN muss mindestens 4 Zeichen haben!", false);
  if (newPin !== confPin) return showTimedBoxMsg("profPinMsg", "❌ Die neuen PINs stimmen nicht überein!", false);

  emp.password = newPin;
  emp.mustChangePw = false;
  document.getElementById("profOldPin").value = "";
  document.getElementById("profNewPin").value = "";
  document.getElementById("profNewPinConfirm").value = "";
  addHistoryLog("Persönliche PIN geändert von " + fullName(emp), "LOGIN");
  saveToFirebase();
  renderSettingsLists();
  showTimedBoxMsg("profPinMsg", "✅ Deine persönliche PIN wurde erfolgreich geändert!", true);
  showToast("PIN aktualisiert!");
};

window.resetEmployeePin = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;
  const newPin = String(Math.floor(1000 + Math.random() * 9000));
  emp.password = newPin;
  emp.mustChangePw = true;
  addHistoryLog("Start-PIN für " + fullName(emp) + " zurückgesetzt", "LOGIN");
  saveToFirebase();
  renderSettingsLists();
  showToast("🔑 Neue Start-PIN für " + fullName(emp) + ": " + newPin);
};

window.resetEmployeeOnboarding = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;
  if (!confirm("Möchten Sie den Onboarding-Status von " + fullName(emp) + " wirklich zurücksetzen? Der Mitarbeiter wird beim nächsten Portal-Login erneut durch das Onboarding geführt.")) return;
  emp.onboardingCompleted = false;
  emp.mainLines = [];
  emp.secLines = [];
  addHistoryLog("Onboarding-Status für " + fullName(emp) + " zurückgesetzt", "EMP");
  saveToFirebase();
  renderEmployees();
  renderSettingsLists();
  showToast("🔄 Onboarding für " + fullName(emp) + " zurückgesetzt");
};

window.deleteRole = function(idx) {
  if (roles.length <= 1) return showToast("Mindestens eine Rolle muss erhalten bleiben!", true);
  const rName = roles[idx];
  if (!confirm("Sind Sie sicher, dass Sie die Rolle '" + rName + "' dauerhaft löschen möchten?")) return;
  roles.splice(idx, 1);
  addHistoryLog("Rolle gelöscht: " + rName, "EMP");
  saveToFirebase();
  renderSettingsLists();
  renderRoleFilterCheckboxes();
  showToast("Rolle gelöscht");
};

window.deleteLine = function(id) {
  if (lines.length <= 1) return showToast("Mindestens eine Linie muss erhalten bleiben!", true);
  const lObj = lines.find(l => l.id === id);
  const lName = lObj ? lObj.name : id;
  if (!confirm("Sind Sie sicher, dass Sie " + lName + " dauerhaft löschen möchten?")) return;
  lines = lines.filter(l => l.id !== id);
  addHistoryLog(lName + " dauerhaft gelöscht", "EMP");
  saveToFirebase();
  window.initBoard();
  renderSettingsLists();
  showToast(lName + " gelöscht");
};

window.deleteTeam = function(k) {
  if (Object.keys(teamsConfig).length <= 1) return showToast("Mindestens ein Team muss erhalten bleiben!", true);
  const tName = teamsConfig[k] ? teamsConfig[k].name : k;
  if (!confirm("Sind Sie sicher, dass Sie das Team '" + tName + "' dauerhaft löschen möchten?")) return;
  delete teamsConfig[k];
  delete activeTeamFilters[k];
  window.sanitizeTeamReferences();
  ensureUniqueShiftRotationTeams();
  addHistoryLog("Team gelöscht: " + tName, "EMP");
  saveToFirebase();
  window.initBoard();
  renderSettingsLists();
  showToast("Team gelöscht");
};

window.deleteEmployee = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp || !confirm("Sind Sie sicher, dass Sie den Mitarbeiter '" + fullName(emp) + "' dauerhaft löschen möchten?")) return;
  const delName = fullName(emp);
  employees = employees.filter(e => e.id !== id);

  sickLeaves = (Array.isArray(sickLeaves) ? sickLeaves : []).filter(sl => sl && sl.empId !== id);
  extraShifts = (Array.isArray(extraShifts) ? extraShifts : []).filter(es => es && es.empId !== id);
  leaveRequests = (Array.isArray(leaveRequests) ? leaveRequests : []).filter(r => r && r.empId !== id);
  leaveRequests.forEach(cov => {
    (cov.days || []).forEach(d => {
      if (d.takenBy === id) {
        d.takenBy = null;
        d.dayStatus = d.explicitlyApproved ? "open" : "pending";
      }
    });
  });

  addHistoryLog("Mitarbeiter inkl. Anträgen gelöscht: " + delName, "EMP");
  saveToFirebase();
  renderEmployees();
  renderSettingsLists();
  window.renderInboxLists();
  window.updateInboxBadge();
  showToast("Mitarbeiter gelöscht");
};

window.editEmployee = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;
  ensureTrainingProtectionDaysWindowExists();

  document.getElementById("editEmpId").value = emp.id;
  document.getElementById("newEmpFirstName").value = emp.firstName || "";
  document.getElementById("newEmpLastName").value = emp.lastName || "";
  document.getElementById("newEmpTeam").value = emp.team || Object.keys(teamsConfig)[0];
  document.getElementById("newEmpRole").value = emp.role || roles[0];
  document.getElementById("newEmpAccessLevel").value = emp.accessLevel || 1;
  document.getElementById("newEmpFirstAider").checked = !!emp.ersthelfer;
  document.getElementById("newEmpNoRotation").checked = !!emp.noRotation;

  const anchorWrap = document.getElementById("newEmpAnchorDaysWrap");
  if (anchorWrap) anchorWrap.style.display = emp.noRotation ? "block" : "none";
  window.renderAnchorDayButtons(Array.isArray(emp.fixDays) ? emp.fixDays : [1, 2, 3, 4, 5]);

  const trChk = document.getElementById("newEmpInTrainingPhase");
  const trWrap = document.getElementById("newEmpTrainingPhaseWrap");
  const trDays = document.getElementById("newEmpTrainingDays");
  const trPct = document.getElementById("newEmpTrainingMainPct");
  const trStart = document.getElementById("newEmpTrainingStartDate");
  if (trChk) trChk.checked = !!emp.inTrainingPhase;
  if (trWrap) trWrap.style.display = emp.inTrainingPhase ? "block" : "none";
  if (trDays) trDays.value = emp.trainingDays || 360;
  if (trPct) trPct.value = emp.trainingMainPct || 90;
  if (trStart) trStart.value = emp.trainingStartDate || getLogicalDateIso();
  window.updateTrainingProtectionExpiryPreview();

  window._tempEditEmpMainLines = Array.isArray(emp.mainLines) ? emp.mainLines.slice() : [];
  window._tempEditEmpSecLines = Array.isArray(emp.secLines)
    ? emp.secLines.filter(lId => window._tempEditEmpMainLines.indexOf(lId) === -1)
    : [];

  document.getElementById("btnCancelEditEmp").style.display = "inline-block";
  document.getElementById("btnSaveEmp").textContent = "Änderungen speichern";
  renderSettingsLists();
};

window.resetEmpForm = function() {
  ensureTrainingProtectionDaysWindowExists();
  const idEl = document.getElementById("editEmpId");
  if (!idEl) return;
  idEl.value = "";
  document.getElementById("newEmpFirstName").value = "";
  document.getElementById("newEmpLastName").value = "";
  document.getElementById("newEmpFirstAider").checked = false;
  document.getElementById("newEmpNoRotation").checked = false;
  const anchorWrap = document.getElementById("newEmpAnchorDaysWrap");
  if (anchorWrap) anchorWrap.style.display = "none";

  const trChk = document.getElementById("newEmpInTrainingPhase");
  const trWrap = document.getElementById("newEmpTrainingPhaseWrap");
  const trDays = document.getElementById("newEmpTrainingDays");
  const trPct = document.getElementById("newEmpTrainingMainPct");
  const trStart = document.getElementById("newEmpTrainingStartDate");
  if (trChk) trChk.checked = false;
  if (trWrap) trWrap.style.display = "none";
  if (trDays) trDays.value = 360;
  if (trPct) trPct.value = 90;
  if (trStart) trStart.value = getLogicalDateIso();
  window.updateTrainingProtectionExpiryPreview();

  currentAnchorDaysSelection = [1, 2, 3, 4, 5];
  window._tempEditEmpMainLines = [];
  window._tempEditEmpSecLines = [];
  document.getElementById("btnCancelEditEmp").style.display = "none";
  document.getElementById("btnSaveEmp").textContent = "Speichern";
  renderSettingsLists();
};

window.saveEmployee = function() {
  ensureTrainingProtectionDaysWindowExists();
  const id = document.getElementById("editEmpId").value;
  const fName = document.getElementById("newEmpFirstName").value.trim();
  const lName = document.getElementById("newEmpLastName").value.trim();
  if (!fName || !lName) return showToast("Bitte Vor- und Nachname eingeben", true);

  const mainChecked = Array.from(document.querySelectorAll(".emp-main-line-chk:checked")).map(c => c.value);
  const secChecked = Array.from(document.querySelectorAll(".emp-sec-line-chk:checked"))
    .map(c => c.value)
    .filter(lId => mainChecked.indexOf(lId) === -1);

  const teamVal = document.getElementById("newEmpTeam").value;
  const roleVal = document.getElementById("newEmpRole").value;
  const lvlVal = Number(document.getElementById("newEmpAccessLevel").value) || 1;
  const ersthelferVal = document.getElementById("newEmpFirstAider").checked;
  const noRotVal = document.getElementById("newEmpNoRotation").checked;

  const trChk = document.getElementById("newEmpInTrainingPhase");
  const trDays = document.getElementById("newEmpTrainingDays");
  const trPct = document.getElementById("newEmpTrainingMainPct");
  const trStart = document.getElementById("newEmpTrainingStartDate");
  const inTrainingVal = trChk ? trChk.checked : false;
  const trainingDaysVal = trDays ? (Math.max(1, parseInt(trDays.value, 10) || 360)) : 360;
  const trainingPctVal = trPct ? (Math.min(100, Math.max(50, parseInt(trPct.value, 10) || 90))) : 90;
  const trainingStartVal = (trStart && trStart.value) ? window.normalizeDateIso(trStart.value) : getLogicalDateIso();

  if (id) {
    const emp = employees.find(e => e.id === id);
    if (emp) {
      Object.assign(emp, {
        firstName: fName,
        lastName: lName,
        team: teamVal,
        role: roleVal,
        accessLevel: lvlVal,
        ersthelfer: ersthelferVal,
        noRotation: noRotVal,
        fixDays: noRotVal ? currentAnchorDaysSelection.slice() : [1, 2, 3, 4, 5],
        inTrainingPhase: inTrainingVal,
        trainingDays: trainingDaysVal,
        trainingMainPct: trainingPctVal,
        trainingStartDate: trainingStartVal,
        mainLines: mainChecked,
        secLines: secChecked
      });
      if (mainChecked.length > 0) emp.onboardingCompleted = true;
      window.getEmpTrainingProtectionInfo(emp, getLogicalDateIso());
      addHistoryLog("Mitarbeiter aktualisiert: " + fullName(emp) + (emp.inTrainingPhase ? " [Stamm-Schutz: " + trainingDaysVal + " Tg. ab " + formatDateDe(trainingStartVal) + " / " + trainingPctVal + "%]" : ""), "EMP");
      showToast("Mitarbeiter gespeichert!");
    }
  } else {
    const randomPin = String(Math.floor(1000 + Math.random() * 9000));
    const newEmpObj = {
      id: "emp_" + Date.now(),
      firstName: fName,
      lastName: lName,
      team: teamVal,
      role: roleVal,
      accessLevel: lvlVal,
      ersthelfer: ersthelferVal,
      noRotation: noRotVal,
      fixDays: noRotVal ? currentAnchorDaysSelection.slice() : [1, 2, 3, 4, 5],
      inTrainingPhase: inTrainingVal,
      trainingDays: trainingDaysVal,
      trainingMainPct: trainingPctVal,
      trainingStartDate: trainingStartVal,
      mainLines: mainChecked,
      secLines: secChecked,
      onboardingCompleted: mainChecked.length > 0,
      password: randomPin,
      mustChangePw: true,
      zone: "pool",
      pinnedZone: null,
      lineHistory: {},
      lineAssignCounts: {},
      trainingHoursByLine: {},
      trainingCreditedDates: {}
    };
    window.getEmpTrainingProtectionInfo(newEmpObj, getLogicalDateIso());
    employees.push(newEmpObj);
    addHistoryLog("Neuer Mitarbeiter angelegt: " + fName + " " + lName, "EMP");
    showToast("Mitarbeiter angelegt! Start-PIN: " + randomPin);
  }

  saveToFirebase();
  renderEmployees();
  window.resetEmpForm();
};

window.addRole = function() {
  const inp = document.getElementById("newRoleName");
  const val = inp ? inp.value.trim() : "";
  if (val && roles.indexOf(val) === -1) {
    roles.push(val);
    inp.value = "";
    activeRoleFilters[val] = true;
    if (!shiftModelConfig.roleRequiresLines) shiftModelConfig.roleRequiresLines = {};
    if (!shiftModelConfig.roleAllowLineAssign) shiftModelConfig.roleAllowLineAssign = {};
    shiftModelConfig.roleRequiresLines[val] = true;
    shiftModelConfig.roleAllowLineAssign[val] = true;
    addHistoryLog("Neue Rolle angelegt: " + val, "EMP");
    saveToFirebase();
    renderSettingsLists();
    renderRoleFilterCheckboxes();
    showToast("Rolle hinzugefügt");
  }
};

window.addLine = function() {
  const inp = document.getElementById("newLineName");
  const floorSel = document.getElementById("newLineFloor");
  const val = inp ? inp.value.trim() : "";
  if (val) {
    const shortClean = val.replace(/^Linie\s*/i, "").trim();
    const newId = "L" + (shortClean || Date.now());
    const newName = val.indexOf("Linie") === 0 ? val : "Linie " + val;
    lines.push({
      id: newId,
      name: newName,
      floor: floorSel ? floorSel.value : "1. OG",
      prio: "",
      tag: "",
      note: "",
      ausgeplant: false,
      mainOnly: false,
      roleTargets: { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 }
    });
    inp.value = "";
    addHistoryLog("Neue Linie angelegt: " + newName, "EMP");
    saveToFirebase();
    window.initBoard();
    renderSettingsLists();
    showToast(newName + " hinzugefügt");
  }
};

window.addTeam = function() {
  const nameInp = document.getElementById("newTeamName");
  const colInp = document.getElementById("newTeamColor");
  const rotInp = document.getElementById("newTeamRotates");
  const val = nameInp ? nameInp.value.trim() : "";
  if (val) {
    const key = "team_" + Date.now();
    teamsConfig[key] = {
      name: val,
      color: colInp ? colInp.value : "#3b82f6",
      rotates: rotInp ? rotInp.checked : true
    };
    nameInp.value = "";
    activeTeamFilters[key] = true;
    const wrap = document.getElementById("newTeamFormWrapper");
    if (wrap) wrap.style.display = "none";
    ensureUniqueShiftRotationTeams();
    addHistoryLog("Neues Team angelegt: " + val, "EMP");
    saveToFirebase();
    window.initBoard();
    renderSettingsLists();
    renderTeamFilterCheckboxes();
    showToast("Team hinzugefügt");
  }
};

window.filterSettingsEmployees = function(q) {
  settingsEmpSearchQuery = (q || "").trim().toLowerCase();
  renderSettingsLists();
};

/* ==========================================================================
   13. POSTFACH (MIT MANIPULATIONSSICHEREM AUDIT-TRAIL: NAME, DATUM & UHRZEIT)
   ========================================================================== */

function renderUniversalSuggestions(val, boxId, selectFnName, preferPlanners) {
  const box = document.getElementById(boxId);
  const q = (val || "").trim().toLowerCase();
  if (!box || !employees || !employees.length || q.length < 2) {
    if (box) box.style.display = "none";
    return;
  }
  let matches = employees.filter(e => (!preferPlanners || (Number(e.accessLevel) || 1) >= 2) && fullName(e).toLowerCase().indexOf(q) !== -1);
  if (preferPlanners && !matches.length) {
    matches = employees.filter(e => fullName(e).toLowerCase().indexOf(q) !== -1);
  }
  if (!matches.length) {
    box.style.display = "none";
    return;
  }
  box.innerHTML = matches.map(e =>
    '<div class="suggestion-item" onclick="' + selectFnName + '(\'' + e.id + '\')">' +
      '<span><b>' + fullName(e) + '</b></span>' +
      '<small style="color:#64748b;">' + e.role + (preferPlanners ? (' (Stufe ' + (e.accessLevel || 1) + ')') : '') + '</small>' +
    '</div>'
  ).join("");
  box.style.display = "block";
}

function selectUniversalEmployee(id, inputId, boxId, focusId) {
  const e = employees.find(x => x.id === id);
  if (!e) return null;
  const inp = document.getElementById(inputId);
  if (inp) inp.value = fullName(e);
  const box = document.getElementById(boxId);
  if (box) box.style.display = "none";
  if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
  return e.id;
}

window.onPlannerLoginInput = function(val) {
  selectedLoginPlannerId = null;
  renderUniversalSuggestions(val, "plannerLoginSuggestions", "selectLoginPlannerEmp", true);
};
window.selectLoginPlannerEmp = function(id) {
  selectedLoginPlannerId = selectUniversalEmployee(id, "loginPlannerName", "plannerLoginSuggestions", "pinInput");
};

window.onManualSickNameInput = function(val) {
  selectedManualSickEmpId = null;
  renderUniversalSuggestions(val, "manualSickSuggestions", "selectManualSickEmp", false);
};
window.selectManualSickEmp = function(id) {
  selectedManualSickEmpId = selectUniversalEmployee(id, "manualSickEmpInput", "manualSickSuggestions");
};

window.onManualExtraNameInput = function(val) {
  selectedManualExtraEmpId = null;
  renderUniversalSuggestions(val, "manualExtraSuggestions", "selectManualExtraEmp", false);
};
window.selectManualExtraEmp = function(id) {
  selectedManualExtraEmpId = selectUniversalEmployee(id, "manualExtraEmpInput", "manualExtraSuggestions");
};

window.addManualSickLeave = function() {
  if (!selectedManualSickEmpId) {
    const typed = (document.getElementById("manualSickEmpInput").value || "").trim().toLowerCase();
    const found = employees.find(e => fullName(e).toLowerCase() === typed);
    if (found) selectedManualSickEmpId = found.id;
  }
  if (!selectedManualSickEmpId) return showToast("Bitte Mitarbeiter auswählen", true);

  const start = window.normalizeDateIso(document.getElementById("manualSickStart").value);
  const end = window.normalizeDateIso(document.getElementById("manualSickEnd").value);
  const cat = document.getElementById("manualSickCategory").value;
  const reason = document.getElementById("manualSickReason").value.trim();
  if (!start || !end || start > end) return showToast("Bitte gültigen Zeitraum auswählen", true);

  if (window.hasLeaveOverlap(selectedManualSickEmpId, start, end)) {
    return showToast("⛔ Für diesen Mitarbeiter existiert bereits eine Abwesenheit im gewählten Zeitraum.", true);
  }

  const emp = employees.find(e => e.id === selectedManualSickEmpId);
  const nowIso = new Date().toISOString();
  const actorLabel = getCurrentActorLabel();

  const newLeave = {
    id: "sl_" + Date.now(),
    empId: selectedManualSickEmpId,
    startDate: start,
    endDate: end,
    originalStartDate: start,
    originalEndDate: end,
    category: cat,
    reason: reason,
    status: "approved",
    createdAt: nowIso,
    createdBy: actorLabel,
    reviewedBy: actorLabel,
    reviewedAt: nowIso,
    auditLog: []
  };
  appendAuditEntry(newLeave, "Manuell eingetragen & bestätigt (" + cat + ": " + formatDateDe(start) + " – " + formatDateDe(end) + ")", actorLabel);

  sickLeaves.unshift(newLeave);
  const generatedCov = window.generateCoveragePromptForLeave(newLeave, "pending");

  addHistoryLog("Abwesenheit (" + cat + ") für " + (emp ? fullName(emp) : "") + " eingetragen (" + formatDateDe(start) + "–" + formatDateDe(end) + ")", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();

  const isShortErrand = String(cat || "").toLowerCase().indexOf("dienstgang") !== -1;
  if (!isShortErrand && generatedCov) {
    window.openCoverageReleaseModal(newLeave.id);
    showToast("Abwesenheit dokumentiert – bitte Bringschichten mit Ja / Nein prüfen!");
  } else {
    showToast("Abwesenheit mit Zeitstempel eingetragen!");
  }

  document.getElementById("manualSickStart").value = "";
  document.getElementById("manualSickEnd").value = "";
  document.getElementById("manualSickReason").value = "";
  document.getElementById("manualSickEmpInput").value = "";
  selectedManualSickEmpId = null;
};

window.addManualExtraShift = function() {
  if (!selectedManualExtraEmpId) {
    const typed = (document.getElementById("manualExtraEmpInput").value || "").trim().toLowerCase();
    const found = employees.find(e => fullName(e).toLowerCase() === typed);
    if (found) selectedManualExtraEmpId = found.id;
  }
  if (!selectedManualExtraEmpId) return showToast("Bitte Mitarbeiter auswählen", true);

  const dateVal = window.normalizeDateIso(document.getElementById("manualExtraDate").value);
  const shiftVal = document.getElementById("manualExtraShift").value;
  const noteVal = document.getElementById("manualExtraNote").value.trim();
  if (!dateVal) return showToast("Bitte Datum auswählen", true);

  const existingSameDay = extraShifts.find(es => es.empId === selectedManualExtraEmpId && window.normalizeDateIso(es.date) === dateVal && es.status !== "rejected");
  if (existingSameDay) {
    return showToast("⛔ Für diesen Mitarbeiter ist am " + formatDateDe(dateVal) + " bereits eine Bringschicht (" + (shiftsLabel[existingSameDay.shift] || existingSameDay.shift) + ") eingetragen!", true);
  }

  const emp = employees.find(e => e.id === selectedManualExtraEmpId);
  const newExtraId = "es_" + Date.now();
  const conflictWarning = checkExtraShiftConflict(emp, dateVal, shiftVal, newExtraId);
  const nowIso = new Date().toISOString();
  const actorLabel = getCurrentActorLabel();

  const newExtraObj = {
    id: newExtraId,
    empId: selectedManualExtraEmpId,
    date: dateVal,
    shift: shiftVal,
    note: noteVal,
    plausibilityWarning: !!conflictWarning,
    conflictDetails: conflictWarning || "",
    status: "approved",
    createdAt: nowIso,
    createdBy: actorLabel,
    reviewedBy: actorLabel,
    reviewedAt: nowIso,
    auditLog: []
  };
  appendAuditEntry(newExtraObj, "Bringschicht manuell eingetragen & genehmigt (" + formatDateDe(dateVal) + " · " + (shiftsShortLabel[shiftVal] || shiftVal) + ")", actorLabel);

  extraShifts.push(newExtraObj);

  addHistoryLog("Bringschicht für " + (emp ? fullName(emp) : "") + " am " + formatDateDe(dateVal) + " (" + (shiftsShortLabel[shiftVal] || shiftVal) + ") eingetragen", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();

  showToast(conflictWarning ? ("⚠️ Eingetragen (" + conflictWarning + ")") : "Bringschicht dokumentiert & aktiviert (1h Vorlauf)!", !!conflictWarning);

  document.getElementById("manualExtraDate").value = "";
  document.getElementById("manualExtraNote").value = "";
  document.getElementById("manualExtraEmpInput").value = "";
  selectedManualExtraEmpId = null;
};

function applyLineRequestToEmployee(sl) {
  if (!sl || !sl.lineRequestData || !sl.lineRequestData.lineId) return;
  const emp = employees.find(e => e.id === sl.empId);
  if (!emp) return;
  const lineId = sl.lineRequestData.lineId;
  if (!Array.isArray(emp.mainLines)) emp.mainLines = [];
  if (!Array.isArray(emp.secLines)) emp.secLines = [];

  if (sl.lineRequestData.type === "prio") {
    if (emp.mainLines.indexOf(lineId) === -1) emp.mainLines.push(lineId);
    emp.secLines = emp.secLines.filter(id => id !== lineId);
  } else {
    if (emp.mainLines.indexOf(lineId) === -1 && emp.secLines.indexOf(lineId) === -1) {
      emp.secLines.push(lineId);
    }
  }
}

function releaseCoverageTakenForExtra(es) {
  if (!es || !Array.isArray(leaveRequests)) return;
  const normDate = window.normalizeDateIso(es.date);
  leaveRequests.forEach(cov => {
    if (es.coverageId && cov.id !== es.coverageId) return;
    (cov.days || []).forEach(d => {
      if (window.normalizeDateIso(d.date) === normDate && d.shift === es.shift && d.takenBy === es.empId) {
        d.takenBy = null;
        d.dayStatus = d.explicitlyApproved ? "open" : "pending";
      }
    });
  });
}

/* Markiert ausschließlich reine Info-/Onboarding-/Krankmeldungs-Hinweise als gelesen (mit Audit-Stempel!) */
window.markAllSickLeavesRead = function() {
  const actorLabel = getCurrentActorLabel();
  const nowIso = new Date().toISOString();

  sickLeaves.forEach(sl => {
    if (sl.isOnboardingNotice && (sl.status === "pending" || sl.plannerUnreadInfo)) {
      sl.status = "approved";
      sl.plannerUnreadInfo = false;
      sl.reviewedBy = actorLabel;
      sl.reviewedAt = nowIso;
      appendAuditEntry(sl, "Onboarding-Info zur Kenntnis genommen", actorLabel);
    } else if ((sl.status === "approved" || sl.status === "rejected" || sl.status === "counter_offer") && sl.plannerUnreadInfo) {
      sl.plannerUnreadInfo = false;
      if (!sl.reviewedBy) sl.reviewedBy = actorLabel;
      if (!sl.reviewedAt) sl.reviewedAt = nowIso;
      appendAuditEntry(sl, "Info-Meldung als gelesen bestätigt", actorLabel);
    }
  });
  extraShifts.forEach(es => {
    if ((es.status === "approved" || es.status === "rejected") && es.plannerUnreadInfo) {
      es.plannerUnreadInfo = false;
      if (!es.reviewedBy) es.reviewedBy = actorLabel;
      if (!es.reviewedAt) es.reviewedAt = nowIso;
      appendAuditEntry(es, "Bringschicht-Info als gelesen bestätigt", actorLabel);
    }
  });
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
  showToast("Alle Info- und Krankmeldungs-Hinweise mit Zeitstempel als gelesen dokumentiert");
};

window.acknowledgeSickLeaveOnly = function(id) {
  const sl = sickLeaves.find(x => x.id === id);
  if (!sl) return;
  const actorLabel = getCurrentActorLabel();
  const nowIso = new Date().toISOString();

  sl.status = "approved";
  sl.plannerUnreadInfo = false;
  sl.reviewedBy = actorLabel;
  sl.reviewedAt = nowIso;
  appendAuditEntry(sl, "Krankmeldung / Hinweis zur Kenntnis genommen", actorLabel);

  const hasCov = (leaveRequests || []).some(r => r.leaveId === sl.id || r.id === ("cov_" + sl.id));
  if (!hasCov && !sl.isOnboardingNotice && !sl.lineRequestData) {
    window.generateCoveragePromptForLeave(sl, "pending");
  }

  const emp = employees.find(e => e.id === sl.empId);
  addHistoryLog("Krankmeldung / Hinweis von " + (emp ? fullName(emp) : "Mitarbeiter") + " zur Kenntnis genommen", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
  showToast("🏥 Mit Name, Datum & Uhrzeit als gelesen dokumentiert");
};

window.setInboxHistoryCategoryFilter = function(cat) {
  window.activeInboxHistoryCategory = cat || "ALL";
  window.renderInboxLists();
};
window.setInboxHistoryCatFilter = window.setInboxHistoryCategoryFilter;

window.classifyInboxActiveItem = function(sl) {
  if (!sl) return "EXTRA";
  if (sl._isExtraShiftRecord) return "EXTRA";
  if (sl.isOnboardingNotice || sl.lineRequestData) return "ONBOARDING";
  const cLow = String(sl.category || "").toLowerCase();
  if (cLow.indexOf("urlaub") !== -1 || cLow.indexOf("freizeit") !== -1 || cLow.indexOf("gleittag") !== -1) return "URLAUB";
  if (cLow.indexOf("krank") !== -1 || cLow.indexOf("arbeitsunfähig") !== -1 || cLow.indexOf("abwesen") !== -1 || cLow.indexOf("fortbildung") !== -1 || cLow.indexOf("dienstreise") !== -1 || cLow.indexOf("dienstgang") !== -1) return "KRANK";
  return "EXTRA";
};

function isSickCategoryName(catStr) {
  const cLow = String(catStr || "").toLowerCase();
  return cLow.indexOf("arbeitsunfähig") !== -1 || cLow.indexOf("krank") !== -1;
}

window.renderInboxLists = function() {
  const unreadEl = document.getElementById("unreadSickList");
  const coverageListEl = document.getElementById("inboxCoverageControlList");
  const extraListEl = document.getElementById("inboxExtraList");
  const activeListEl = document.getElementById("activeSickList");
  if (!unreadEl || !activeListEl) return;

  const todayIso = getLogicalDateIso();
  const globalQ = (document.getElementById("inboxSearchInput") ? document.getElementById("inboxSearchInput").value : "").trim().toLowerCase();
  const searchActive = (document.getElementById("inboxActiveSearchInput") ? document.getElementById("inboxActiveSearchInput").value : "").trim().toLowerCase();
  const curCatFilter = window.activeInboxHistoryCategory || "ALL";

  const filterBar = document.getElementById("inboxHistoryFilterBar");
  if (filterBar) {
    const mapCatOrder = ["ALL", "URLAUB", "KRANK", "EXTRA", "ONBOARDING"];
    filterBar.querySelectorAll("button").forEach((btn, idx) => {
      const isAct = (mapCatOrder[idx] === curCatFilter);
      btn.classList.toggle("active", isAct);
      btn.style.background = isAct ? "var(--bayer-blue)" : "#fff";
      btn.style.color = isAct ? "#fff" : "#475569";
      btn.style.borderColor = isAct ? "var(--bayer-blue)" : "#cbd5e1";
    });
  }

  const unreadLeaves = sickLeaves.filter(sl => {
    if (sl.status !== "pending" && !sl.plannerUnreadInfo) return false;
    if (globalQ) {
      const emp = employees.find(e => e.id === sl.empId);
      const txt = ((emp ? fullName(emp) : "") + " " + (sl.category || "") + " " + (sl.reason || "") + " " + (sl.createdBy || "") + " " + (sl.reviewedBy || "")).toLowerCase();
      if (txt.indexOf(globalQ) === -1) return false;
    }
    return true;
  });

  const pendingExtraRequests = extraShifts.filter(es => {
    if (es.status !== "pending" && !es.plannerUnreadInfo) return false;
    if (globalQ) {
      const emp = employees.find(e => e.id === es.empId);
      const txt = ((emp ? fullName(emp) : "") + " " + (es.note || "") + " " + (es.conflictDetails || "") + " " + (es.date || "") + " " + (es.createdBy || "")).toLowerCase();
      if (txt.indexOf(globalQ) === -1) return false;
    }
    return true;
  });

  if (!unreadLeaves.length && !pendingExtraRequests.length) {
    unreadEl.innerHTML = '<p style="font-size:0.78rem; color:#64748b;">Keine neuen Krankmeldungen, Urlaubsanträge oder Bringschicht-Anfragen.</p>';
  } else {
    const leavesHtml = unreadLeaves.map(sl => {
      const emp = employees.find(e => e.id === sl.empId);
      const eName = emp ? fullName(emp) : "Unbekannt";
      const auditHtml = renderAuditTrailHtml(sl);

      if (sl.isOnboardingNotice) {
        const empIdStr = sl.onboardingData ? sl.onboardingData.empId : (emp ? emp.id : "");
        const editBtn = empIdStr ? '<button class="btn btn-outline" style="padding:3px 8px; font-size:0.72rem; color:var(--bayer-blue); border-color:var(--bayer-blue);" onclick="closeModal(\'inboxModal\'); editEmployee(\'' + empIdStr + '\'); openSettingsModal();">✏️ Angaben ändern</button>' : '';
        return '<div style="background:#fff; border:1px solid #bae6fd; border-left:4px solid var(--bayer-blue); padding:8px 10px; border-radius:8px; margin-bottom:6px; font-size:0.8rem;">' +
          '<div style="display:flex; justify-content:space-between; align-items:center;"><b>' + eName + '</b><span style="color:var(--bayer-blue); font-weight:700;">' + sl.category + '</span></div>' +
          '<div style="color:#1e293b; margin:3px 0; font-size:0.76rem;">' + sl.reason + '</div>' +
          auditHtml +
          '<div style="display:flex; gap:6px; margin-top:6px;">' +
            '<button class="btn btn-primary" style="padding:3px 9px; font-size:0.72rem; background:#16a34a;" onclick="approveSickLeave(\'' + sl.id + '\')">✅ Zur Kenntnis genommen</button>' +
            editBtn +
          '</div>' +
        '</div>';
      }

      if (sl.lineRequestData && sl.lineRequestData.lineId) {
        return '<div style="background:#fff; border:1px solid #bae6fd; border-left:4px solid #0284c7; padding:8px 10px; border-radius:8px; margin-bottom:6px; font-size:0.8rem;">' +
          '<div style="display:flex; justify-content:space-between; align-items:center;"><b>' + eName + '</b><span style="color:#0369a1; font-weight:700;">🏭 ' + (sl.category || 'Linien-Anfrage') + '</span></div>' +
          '<div style="color:#475569; margin:2px 0; font-size:0.75rem;">' + (sl.reason || '') + '</div>' +
          auditHtml +
          '<div style="display:flex; gap:6px; margin-top:6px;">' +
            '<button class="btn btn-primary" style="padding:3px 9px; font-size:0.72rem; background:#16a34a;" onclick="approveSickLeave(\'' + sl.id + '\')">✅ Linie freischalten</button>' +
            '<button class="btn btn-outline" style="padding:3px 9px; font-size:0.72rem; color:#dc2626; border-color:#fca5a5;" onclick="rejectSickLeave(\'' + sl.id + '\')">❌ Ablehnen</button>' +
          '</div>' +
        '</div>';
      }

      /* Krankmeldung (Arbeitsunfähigkeit): Saubere Formulierung ohne "Ablehnen"-Button + voller Audit-Trail */
      if (isSickCategoryName(sl.category)) {
        return '<div style="background:#fff5f5; border:1px solid #fecaca; border-left:4px solid #dc2626; padding:8px 10px; border-radius:8px; margin-bottom:6px; font-size:0.8rem;">' +
          '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">' +
            '<b>🏥 Krankmeldung: ' + eName + '</b>' +
            '<span style="color:#b91c1c; font-weight:700; font-size:0.75rem;">' + (sl.category || 'Arbeitsunfähigkeit') + ' (Im System eingetragen)</span>' +
          '</div>' +
          '<div style="color:#475569; margin:3px 0; font-size:0.76rem;">Zeitraum: <b>' + formatDateDe(sl.startDate) + ' bis ' + formatDateDe(sl.endDate) + '</b>' + (sl.reason ? ' · ' + sl.reason : '') + '</div>' +
          auditHtml +
          '<div style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;">' +
            '<button class="btn btn-primary" style="padding:3px 10px; font-size:0.72rem; background:#0284c7;" onclick="approveSickLeave(\'' + sl.id + '\')">📢 Zur Kenntnis & Ersatzbedarf (Ja/Nein) prüfen</button>' +
            '<button class="btn btn-outline" style="padding:3px 9px; font-size:0.72rem; color:#475569;" onclick="acknowledgeSickLeaveOnly(\'' + sl.id + '\')">✓ Nur als gelesen dokumentieren</button>' +
          '</div>' +
        '</div>';
      }

      /* Rückmeldung zu einem Gegenangebot durch den Mitarbeiter */
      if (sl.status !== "pending" && sl.plannerUnreadInfo) {
        const stateText = sl.status === "approved" ? "✅ Gegenangebot vom Mitarbeiter angenommen" : "❌ Gegenangebot vom Mitarbeiter abgelehnt";
        return '<div style="background:#f0f9ff; border:1px solid #bae6fd; border-left:4px solid #0284c7; padding:8px 10px; border-radius:8px; margin-bottom:6px; font-size:0.8rem;">' +
          '<div style="display:flex; justify-content:space-between; align-items:center;"><b>' + eName + '</b><span style="color:#0369a1; font-weight:700;">' + stateText + '</span></div>' +
          '<div style="color:#475569; margin:3px 0; font-size:0.76rem;">' + (sl.category || 'Urlaub') + ': <b>' + formatDateDe(sl.startDate) + ' bis ' + formatDateDe(sl.endDate) + '</b></div>' +
          auditHtml +
          '<div style="display:flex; gap:6px; margin-top:6px;">' +
            '<button class="btn btn-primary" style="padding:3px 9px; font-size:0.72rem;" onclick="acknowledgeSickLeaveOnly(\'' + sl.id + '\')">✓ Gelesen bestätigen</button>' +
            (sl.status === "approved" ? '<button class="btn btn-outline" style="padding:3px 9px; font-size:0.72rem; color:#0284c7; border-color:#7dd3fc;" onclick="approveSickLeave(\'' + sl.id + '\')">📢 Bringschichten prüfen</button>' : '') +
          '</div>' +
        '</div>';
      }

      /* Regulärer Urlaubsantrag / Freistellungsantrag mit Komplett genehmigen, Teilgenehmigen/Gegenangebot (+) und Ablehnen */
      return '<div style="background:#fff; border:1px solid #cbd5e1; border-left:4px solid #0091df; padding:8px 10px; border-radius:8px; margin-bottom:6px; font-size:0.8rem;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">' +
          '<b>🌴 Antrag: ' + eName + '</b>' +
          '<span style="color:#0369a1; font-weight:700; font-size:0.76rem;">' + (sl.category || 'Urlaub - bezahlt') + '</span>' +
        '</div>' +
        '<div style="color:#475569; margin:3px 0; font-size:0.76rem;">Beantragt: <b>' + formatDateDe(sl.startDate) + ' bis ' + formatDateDe(sl.endDate) + '</b>' + (sl.reason ? ' · ' + sl.reason : '') + '</div>' +
        auditHtml +
        '<div style="display:flex; gap:5px; margin-top:6px; flex-wrap:wrap;">' +
          '<button class="btn btn-primary" style="padding:3px 9px; font-size:0.72rem; background:#16a34a;" onclick="approveSickLeave(\'' + sl.id + '\')">✅ Komplett genehmigen</button>' +
          '<button class="btn btn-outline" style="padding:3px 9px; font-size:0.72rem; color:#0284c7; border-color:#7dd3fc; background:#f0f9ff; font-weight:700;" onclick="openLeaveCounterOfferModal(\'' + sl.id + '\')">✂️ Teilgenehmigen / Gegenangebot (+)</button>' +
          '<button class="btn btn-outline" style="padding:3px 9px; font-size:0.72rem; color:#dc2626; border-color:#fca5a5;" onclick="rejectSickLeave(\'' + sl.id + '\')">❌ Ablehnen</button>' +
        '</div>' +
      '</div>';
    }).join("");

    const extrasHtml = pendingExtraRequests.map(es => {
      const emp = employees.find(e => e.id === es.empId);
      const eName = emp ? fullName(emp) : "Unbekannt";
      const liveConflict = checkExtraShiftConflict(emp, es.date, es.shift, es.id) || "";
      const hasWarn = !!liveConflict;
      const warnBanner = hasWarn
        ? '<div style="background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; padding:4px 7px; border-radius:6px; font-size:0.72rem; font-weight:700; margin-top:3px;">⚠️ Warnung: ' + liveConflict + '</div>'
        : '<div style="color:#166534; font-size:0.72rem; font-weight:600; margin-top:2px;">✅ Regulär Freischicht & Ruhezeit eingehalten</div>';

      return '<div style="background:#fff; border:1px solid ' + (hasWarn ? '#fca5a5' : '#86efac') + '; border-left:4px solid ' + (hasWarn ? '#dc2626' : '#16a34a') + '; padding:8px 10px; border-radius:8px; margin-bottom:6px; font-size:0.8rem;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          '<b>➕ Bringschicht-Angebot: ' + eName + '</b>' +
          '<span style="font-weight:700; color:' + (hasWarn ? '#b91c1c' : '#15803d') + ';">' + formatDateDe(es.date) + ' · ' + (shiftsLabel[es.shift] || es.shift) + '</span>' +
        '</div>' +
        (es.note ? '<div style="color:#475569; margin-top:2px; font-size:0.75rem;">Notiz: ' + es.note + '</div>' : '') +
        warnBanner +
        renderAuditTrailHtml(es) +
        '<div style="display:flex; gap:6px; margin-top:6px;">' +
          '<button class="btn btn-primary" style="padding:3px 9px; font-size:0.72rem; background:#16a34a;" onclick="approveExtraShiftRequest(\'' + es.id + '\')">✅ Genehmigen</button>' +
          '<button class="btn btn-outline" style="padding:3px 9px; font-size:0.72rem; color:#dc2626; border-color:#fca5a5;" onclick="rejectExtraShiftRequest(\'' + es.id + '\')">❌ Ablehnen</button>' +
        '</div>' +
      '</div>';
    }).join("");

    unreadEl.innerHTML = extrasHtml + leavesHtml;
  }

  /* Platzsparende Kompakt-Ansicht für gesuchte Bringschichten (Ein-Klick-Chips + Ausklapp-Zeile) */
  if (coverageListEl) {
    const activeLeavesWithCov = (sickLeaves || []).filter(sl =>
      (sl.status === "approved" || (sl.status === "counter_offer" && Array.isArray(sl.blocks) && sl.blocks.some(b => b.status === "approved"))) &&
      !sl.isOnboardingNotice &&
      !sl.lineRequestData &&
      window.normalizeDateIso(sl.endDate) >= todayIso
    );
    activeLeavesWithCov.forEach(sl => {
      const hasCov = (leaveRequests || []).some(r => r.leaveId === sl.id || r.id === ("cov_" + sl.id));
      if (!hasCov) window.generateCoveragePromptForLeave(sl, "pending");
    });

    const covRequests = (leaveRequests || []).filter(r => {
      const sl = activeLeavesWithCov.find(x => x.id === r.leaveId || ("cov_" + x.id) === r.id);
      if (!sl) return false;
      if (globalQ) {
        const emp = employees.find(e => e.id === r.empId);
        const hay = ((emp ? fullName(emp) : "") + " " + (r.role || "") + " " + (r.probableLines || "")).toLowerCase();
        if (hay.indexOf(globalQ) === -1) return false;
      }
      return Array.isArray(r.days) && r.days.some(d => window.normalizeDateIso(d.date) >= todayIso);
    });

    if (!covRequests.length) {
      coverageListEl.innerHTML = '<p style="font-size:0.78rem; color:#64748b;">Keine kommenden Ausfall-Schichten zur Freigabe vorhanden.</p>';
    } else {
      coverageListEl.innerHTML = covRequests.map(cov => {
        const sl = sickLeaves.find(x => x.id === cov.leaveId || ("cov_" + x.id) === cov.id);
        const emp = employees.find(e => e.id === cov.empId);
        const name = emp ? fullName(emp) : "Mitarbeiter";
        const probLine = cov.probableLines ? (" · " + cov.probableLines.replace("Voraussichtlich ", "")) : "";
        const leaveIdKey = sl ? sl.id : cov.leaveId;
        const reqRole = cov.role || "Bediener";

        const upcomingDays = (cov.days || []).map((d, dIdx) => ({ d, dIdx })).filter(item => window.normalizeDateIso(item.d.date) >= todayIso);
        let openCnt = 0, rejCnt = 0, takenCnt = 0, pendCnt = 0;
        upcomingDays.forEach(({ d }) => {
          if (d.takenBy) takenCnt++;
          else if (d.dayStatus === "open") openCnt++;
          else if (d.dayStatus === "rejected" || d.dayStatus === "closed") rejCnt++;
          else pendCnt++;
        });

        const isExpanded = expandedCoverageCards[leaveIdKey] !== undefined ? expandedCoverageCards[leaveIdKey] : (upcomingDays.length <= 6 || pendCnt > 0);

        const compactChips = upcomingDays.map(({ d, dIdx }) => {
          const dNorm = window.normalizeDateIso(d.date);
          const st = d.dayStatus || "pending";
          const isOpen = (st === "open");
          const isRejected = (st === "rejected" || st === "closed");
          const isTaken = !!d.takenBy;
          const wd = getWeekdayShortDe(dNorm);
          const targetInfo = window.getCoverageTargetInfoForDay(dNorm, d.shift, reqRole);
          const shortDate = (wd ? wd + ' ' : '') + formatDateDe(dNorm).slice(0, 5) + ' ' + (shiftsShortLabel[d.shift] || d.shift);

          if (isTaken) {
            const tEmp = employees.find(x => x.id === d.takenBy);
            return '<span class="cov-mini-chip" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; cursor:default;" title="Übernommen von ' + (tEmp ? fullName(tEmp) : 'Mitarbeiter') + '">🤝 ' + shortDate + ' (' + (tEmp ? fullName(tEmp).split(' ')[0] : 'Besetzt') + ')</span>';
          }

          const chipBg = isOpen ? "#dcfce7" : (isRejected ? "#fee2e2" : "#f1f5f9");
          const chipCol = isOpen ? "#166534" : (isRejected ? "#991b1b" : "#475569");
          const chipBdr = isOpen ? "#86efac" : (isRejected ? "#fca5a5" : "#cbd5e1");
          const icon = isOpen ? "🟢 Ja:" : (isRejected ? "🔴 Nein:" : "⚪ Offen:");
          const tooltip = "Klick zum Umschalten (Ja/Nein) · Freischicht: " + targetInfo.freiTeamName + " (" + targetInfo.eligibleTotalCount + " regulär fahrbar)";

          return '<span class="cov-mini-chip" onclick="toggleCoverageDayStatus(\'' + leaveIdKey + '\', ' + dIdx + ')" style="background:' + chipBg + '; color:' + chipCol + '; border:1px solid ' + chipBdr + ';" title="' + tooltip + '">' +
            icon + ' ' + shortDate +
          '</span>';
        }).join("");

        return '<div style="background:#ffffff; border:1px solid #e2e8f0; border-left:3px solid #0284c7; padding:6px 9px; border-radius:8px; margin-bottom:5px; font-size:0.76rem;">' +
          '<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">' +
            '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; cursor:pointer;" onclick="toggleCoverageCardExpand(\'' + leaveIdKey + '\')">' +
              '<b>' + name + '</b> <span style="color:#64748b; font-size:0.71rem;">(' + reqRole + probLine + ')</span>' +
              '<span style="font-size:0.68rem; background:#f0fdf4; color:#166534; padding:1px 6px; border-radius:999px; border:1px solid #bbf7d0;">🟢 ' + openCnt + ' Ja</span>' +
              (rejCnt > 0 ? '<span style="font-size:0.68rem; background:#fef2f2; color:#991b1b; padding:1px 6px; border-radius:999px; border:1px solid #fecaca;">🔴 ' + rejCnt + ' Nein</span>' : '') +
              (takenCnt > 0 ? '<span style="font-size:0.68rem; background:#f0f9ff; color:#0369a1; padding:1px 6px; border-radius:999px; border:1px solid #bae6fd;">🤝 ' + takenCnt + '</span>' : '') +
            '</div>' +
            '<div style="display:flex; gap:4px; align-items:center;">' +
              '<button type="button" class="btn btn-outline" style="padding:1px 6px; font-size:0.68rem;" onclick="toggleCoverageCardExpand(\'' + leaveIdKey + '\')">' + (isExpanded ? '▲ Kompakt' : '▼ ' + upcomingDays.length + ' Tage') + '</button>' +
              '<button type="button" class="btn btn-outline" style="padding:1px 7px; font-size:0.68rem; color:var(--bayer-blue); border-color:#bae6fd;" onclick="openCoverageReleaseModal(\'' + leaveIdKey + '\')" title="Schnellauswahl & Team-Details öffnen">⚙️ Schnellwahl</button>' +
            '</div>' +
          '</div>' +
          (isExpanded ? '<div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:5px; padding-top:5px; border-top:1px dashed #f1f5f9;">' + compactChips + '</div>' : '') +
        '</div>';
      }).join("");
    }
  }

  /* Kommende genehmigte Bringschichten inkl. Audit-Stempel */
  if (extraListEl) {
    const approvedExtras = extraShifts.filter(es => {
      if (es.status !== "approved") return false;
      if (window.normalizeDateIso(es.date) < todayIso) return false;
      if (globalQ) {
        const emp = employees.find(e => e.id === es.empId);
        const txt = ((emp ? fullName(emp) : "") + " " + (es.note || "") + " " + (es.date || "") + " " + (es.reviewedBy || "")).toLowerCase();
        if (txt.indexOf(globalQ) === -1) return false;
      }
      return true;
    });
    if (!approvedExtras.length) {
      extraListEl.innerHTML = '<p style="font-size:0.78rem; color:#64748b;">Keine kommenden Bringschichten eingetragen.</p>';
    } else {
      extraListEl.innerHTML = approvedExtras.map(es => {
        const emp = employees.find(e => e.id === es.empId);
        const eName = emp ? fullName(emp) : "Unbekannt";
        const conflict = checkExtraShiftConflict(emp, es.date, es.shift, es.id);
        const warnHtml = conflict ? '<div style="color:#dc2626; font-size:0.7rem; font-weight:700; margin-top:1px;">⚠️ ' + conflict + '</div>' : '';
        return '<div style="background:#fff; border:1px solid #86efac; padding:7px 10px; border-radius:8px; margin-bottom:5px; font-size:0.78rem; display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
          '<div style="flex:1;"><b>' + eName + '</b> · Am ' + formatDateDe(es.date) + ' (' + (shiftsShortLabel[es.shift] || es.shift) + ')' + (es.note ? ' · ' + es.note : '') + warnHtml + renderAuditTrailHtml(es) + '</div>' +
          '<button class="btn btn-outline" style="padding:2px 7px; font-size:0.7rem; color:#dc2626;" onclick="deleteExtraShift(\'' + es.id + '\')">🗑️</button>' +
        '</div>';
      }).join("");
    }
  }

  /* Archiv & Bearbeitete Anträge inkl. vollem Sicherheits-Audit-Trail */
  const processedLeaves = sickLeaves.filter(sl => !(sl.status === "pending" && !sl.plannerUnreadInfo));
  const processedExtrasAsItems = extraShifts
    .filter(es => es.status === "approved" || es.status === "rejected")
    .map(es => ({
      id: es.id,
      empId: es.empId,
      startDate: es.date,
      endDate: es.date,
      category: "➕ Bringschicht (" + (shiftsShortLabel[es.shift] || es.shift) + ")",
      reason: es.note || "",
      status: es.status,
      createdAt: es.createdAt,
      createdBy: es.createdBy,
      reviewedBy: es.reviewedBy,
      reviewedAt: es.reviewedAt,
      auditLog: es.auditLog,
      _isExtraShiftRecord: true
    }));

  const allProcessedItems = [].concat(processedLeaves, processedExtrasAsItems);

  const filteredActive = allProcessedItems.filter(sl => {
    if (curCatFilter !== "ALL" && window.classifyInboxActiveItem(sl) !== curCatFilter) return false;
    const emp = employees.find(e => e.id === sl.empId);
    const txt = ((emp ? fullName(emp) : "") + " " + (sl.category || "") + " " + (sl.reason || "") + " " + (sl.plannerCounterNote || "") + " " + (sl.reviewedBy || "") + " " + (sl.createdBy || "") + " " + formatDateDe(sl.startDate)).toLowerCase();
    if (globalQ && txt.indexOf(globalQ) === -1) return false;
    if (searchActive && txt.indexOf(searchActive) === -1) return false;
    return true;
  });

  if (!filteredActive.length) {
    activeListEl.innerHTML = '<p style="font-size:0.78rem; color:#64748b;">Keine Einträge in dieser Kategorie vorhanden.</p>';
  } else {
    activeListEl.innerHTML = filteredActive.map(sl => {
      const emp = employees.find(e => e.id === sl.empId);
      const eName = emp ? fullName(emp) : "Unbekannt";
      const stBadge = sl.status === "approved"
        ? '<span style="color:#166534; font-weight:700;">✅ Bestätigt / Aktiv</span>'
        : (sl.status === "counter_offer"
          ? '<span style="color:#0284c7; font-weight:700;">💬 Gegenangebot offen</span>'
          : '<span style="color:#b91c1c; font-weight:700;">❌ Abgelehnt</span>');

      if (sl._isExtraShiftRecord) {
        return '<div style="background:#fff; border:1px solid #e2e8f0; padding:7px 10px; border-radius:8px; margin-bottom:5px; font-size:0.78rem; display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
          '<div style="flex:1;"><b>' + eName + '</b> · <b>' + sl.category + '</b> (Am ' + formatDateDe(sl.startDate) + ')' + (sl.reason ? ' · ' + sl.reason : '') + ' ' + stBadge + renderAuditTrailHtml(sl) + '</div>' +
          '<button class="btn btn-outline" style="padding:2px 7px; font-size:0.7rem; color:#dc2626;" onclick="deleteExtraShift(\'' + sl.id + '\')">🗑️</button>' +
        '</div>';
      }

      const isSickItem = isSickCategoryName(sl.category);
      const splitBtn = (!sl.isOnboardingNotice && !sl.lineRequestData && !isSickItem)
        ? '<button class="btn btn-outline" style="padding:2px 6px; font-size:0.68rem; color:#0284c7; border-color:#bae6fd;" onclick="openLeaveCounterOfferModal(\'' + sl.id + '\')" title="Zeitraum nachträglich teilen oder Gegenangebot anpassen">✂️ Zeitraum/Split</button>'
        : '';
      const covBtn = ((sl.status === "approved" || sl.status === "counter_offer") && !sl.isOnboardingNotice && !sl.lineRequestData)
        ? '<button class="btn btn-outline" style="padding:2px 6px; font-size:0.68rem; color:var(--bayer-blue); border-color:#bae6fd;" onclick="openCoverageReleaseModal(\'' + sl.id + '\')" title="Bringschichten für diesen Zeitraum mit Ja/Nein steuern">📢 Bringschichten</button>'
        : '';

      return '<div style="background:#fff; border:1px solid #e2e8f0; padding:7px 10px; border-radius:8px; margin-bottom:5px; font-size:0.78rem; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">' +
        '<div style="flex:1; min-width:220px;"><b>' + eName + '</b> · <b>' + (sl.category || 'Abwesend') + '</b> (' + formatDateDe(sl.startDate) + ' bis ' + formatDateDe(sl.endDate) + ')' + (sl.reason ? ' · ' + sl.reason : '') + ' ' + stBadge + renderAuditTrailHtml(sl) + '</div>' +
        '<div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">' +
          splitBtn +
          covBtn +
          '<button class="btn btn-outline" style="padding:2px 7px; font-size:0.7rem; color:#dc2626;" onclick="deleteSickLeave(\'' + sl.id + '\')">🗑️</button>' +
        '</div>' +
      '</div>';
    }).join("");
  }
};

window.approveSickLeave = function(id) {
  const sl = sickLeaves.find(x => x.id === id);
  if (!sl) return;
  const actorLabel = getCurrentActorLabel();
  const nowIso = new Date().toISOString();

  sl.status = "approved";
  if (Array.isArray(sl.blocks) && sl.blocks.length > 0) {
    sl.blocks.forEach(b => { if (b.status !== "rejected") b.status = "approved"; });
  }
  sl.plannerUnreadInfo = false;
  sl.reviewedBy = actorLabel;
  sl.reviewedAt = nowIso;

  const emp = employees.find(e => e.id === sl.empId);
  const empName = emp ? fullName(emp) : "Mitarbeiter";

  if (sl.lineRequestData && sl.lineRequestData.lineId) {
    applyLineRequestToEmployee(sl);
    appendAuditEntry(sl, "Linien-Qualifikation freigeschaltet (" + (sl.reason || sl.lineRequestData.lineId) + ")", actorLabel);
    addHistoryLog("Linien-Anfrage für " + empName + " genehmigt (" + (sl.reason || "") + ")", "EMP");
    showToast("✅ Linien-Qualifikation mit Zeitstempel freigeschaltet!");
  } else if (sl.isOnboardingNotice) {
    appendAuditEntry(sl, "Onboarding-Qualifikationen bestätigt", actorLabel);
    addHistoryLog("Onboarding-Meldung von " + empName + " bestätigt", "EMP");
    showToast("✅ Onboarding-Meldung bestätigt");
  } else {
    const isSick = isSickCategoryName(sl.category);
    appendAuditEntry(sl, (isSick ? "Krankmeldung zur Kenntnis genommen" : "Antrag komplett genehmigt") + " (" + formatDateDe(sl.startDate) + " – " + formatDateDe(sl.endDate) + ")", actorLabel);
    addHistoryLog((isSick ? "Krankmeldung bestätigt: " : "Antrag (" + (sl.category || "Urlaub") + ") genehmigt: ") + empName + " (" + formatDateDe(sl.startDate) + "–" + formatDateDe(sl.endDate) + ")", "ABSENCE");
    window.generateCoveragePromptForLeave(sl, "pending");
    window.openCoverageReleaseModal(sl.id);
    showToast("Bestätigt & dokumentiert – bitte Bringschichten mit Ja / Nein wählen");
  }

  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
};

window.rejectSickLeave = function(id) {
  const sl = sickLeaves.find(x => x.id === id);
  if (!sl) return;
  const actorLabel = getCurrentActorLabel();
  const nowIso = new Date().toISOString();

  sl.status = "rejected";
  sl.plannerUnreadInfo = false;
  sl.reviewedBy = actorLabel;
  sl.reviewedAt = nowIso;
  appendAuditEntry(sl, "Antrag abgelehnt (" + formatDateDe(sl.startDate) + " – " + formatDateDe(sl.endDate) + ")", actorLabel);

  const emp = employees.find(e => e.id === sl.empId);
  addHistoryLog("Antrag (" + (sl.category || "Urlaub") + ") von " + (emp ? fullName(emp) : "Mitarbeiter") + " abgelehnt", "ABSENCE");

  window.removeCoveragePromptForLeave(sl.id);
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
  showToast("Antrag abgelehnt & dokumentiert");
};

window.approveExtraShiftRequest = function(id) {
  const es = extraShifts.find(x => x.id === id);
  if (!es) return;
  const actorLabel = getCurrentActorLabel();
  const nowIso = new Date().toISOString();

  es.status = "approved";
  es.plannerUnreadInfo = false;
  es.reviewedBy = actorLabel;
  es.reviewedAt = nowIso;

  const emp = employees.find(e => e.id === es.empId);
  const liveConflict = checkExtraShiftConflict(emp, es.date, es.shift, es.id);
  es.plausibilityWarning = !!liveConflict;
  es.conflictDetails = liveConflict || "";

  appendAuditEntry(es, "Bringschicht genehmigt für " + formatDateDe(es.date) + " (" + (shiftsLabel[es.shift] || es.shift) + ")", actorLabel);

  const normDate = window.normalizeDateIso(es.date);
  let filledCovId = null;

  if (Array.isArray(leaveRequests)) {
    leaveRequests.forEach(cov => {
      if (es.coverageId && cov.id !== es.coverageId) return;
      (cov.days || []).forEach(d => {
        if (window.normalizeDateIso(d.date) === normDate && d.shift === es.shift && !d.takenBy) {
          d.takenBy = es.empId;
          d.dayStatus = "taken";
          d.decidedBy = actorLabel;
          d.decidedAt = nowIso;
          filledCovId = cov.id;
        }
      });
    });
  }

  if (filledCovId) {
    extraShifts.forEach(other => {
      if (other.id !== es.id && other.status === "pending" && other.coverageId === filledCovId && window.normalizeDateIso(other.date) === normDate && other.shift === es.shift) {
        other.status = "rejected";
        other.plannerUnreadInfo = false;
        other.reviewedBy = actorLabel;
        other.reviewedAt = nowIso;
        other.note = (other.note ? other.note + " · " : "") + "Schicht wurde bereits vergeben";
        appendAuditEntry(other, "Automatisch geschlossen (Schicht anderweitig vergeben)", actorLabel);
      }
    });
  }

  addHistoryLog("Bringschicht genehmigt für " + (emp ? fullName(emp) : "") + " am " + formatDateDe(es.date), "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
  showToast("Bringschicht mit Zeitstempel genehmigt!");
};

window.rejectExtraShiftRequest = function(id) {
  const es = extraShifts.find(x => x.id === id);
  if (!es) return;
  const actorLabel = getCurrentActorLabel();
  const nowIso = new Date().toISOString();

  es.status = "rejected";
  es.plannerUnreadInfo = false;
  es.reviewedBy = actorLabel;
  es.reviewedAt = nowIso;
  appendAuditEntry(es, "Bringschicht-Angebot abgelehnt (" + formatDateDe(es.date) + ")", actorLabel);

  releaseCoverageTakenForExtra(es);
  const emp = employees.find(e => e.id === es.empId);
  addHistoryLog("Bringschicht abgelehnt für " + (emp ? fullName(emp) : "") + " am " + formatDateDe(es.date), "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
  showToast("Bringschicht abgelehnt & dokumentiert");
};

window.deleteSickLeave = function(id) {
  if (!confirm("Möchten Sie diesen Eintrag wirklich dauerhaft löschen?")) return;
  const target = sickLeaves.find(x => x.id === id);
  const emp = target ? employees.find(e => e.id === target.empId) : null;
  sickLeaves = sickLeaves.filter(x => x.id !== id);
  window.removeCoveragePromptForLeave(id);
  addHistoryLog("Abwesenheits-/Antragseintrag gelöscht (" + (emp ? fullName(emp) : "") + ")", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
  showToast("Eintrag gelöscht");
};

window.deleteExtraShift = function(id, skipConfirm) {
  const isPortalPage = !document.getElementById("inboxModal");
  if (!skipConfirm && !isPortalPage && !confirm("Möchten Sie diese Bringschicht wirklich löschen?")) return;
  const targetEs = extraShifts.find(x => x.id === id);
  const emp = targetEs ? employees.find(e => e.id === targetEs.empId) : null;
  if (targetEs) releaseCoverageTakenForExtra(targetEs);
  extraShifts = extraShifts.filter(x => x.id !== id);
  addHistoryLog("Bringschicht gelöscht (" + (emp ? fullName(emp) : "") + ")", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
  showToast("Bringschicht entfernt");
};

window.updateInboxSearch = function(val) {
  inboxSearchQuery = (val || "").trim().toLowerCase();
  const clearBtn = document.getElementById("clearInboxSearchBtn");
  if (clearBtn) clearBtn.style.display = inboxSearchQuery ? "block" : "none";
  window.renderInboxLists();
};

window.openInboxModal = function(empId, openSickForm, openExtraForm) {
  document.getElementById("inboxModal").style.display = "flex";
  const today = getLogicalDateIso();
  if (typeof window.toggleManualEntryBox === "function" && openSickForm) {
    window.toggleManualEntryBox(true);
    if (!document.getElementById("manualSickStart").value) document.getElementById("manualSickStart").value = today;
    if (!document.getElementById("manualSickEnd").value) document.getElementById("manualSickEnd").value = today;
  }
  if (typeof window.toggleManualExtraBox === "function" && openExtraForm) {
    window.toggleManualExtraBox(true);
    if (!document.getElementById("manualExtraDate").value) document.getElementById("manualExtraDate").value = today;
  }
  window.renderInboxLists();
};

window.updateInboxBadge = function() {
  const unreadLeavesCount = sickLeaves.filter(sl => sl.status === "pending" || sl.plannerUnreadInfo).length;
  const unreadExtrasCount = extraShifts.filter(es => es.status === "pending" || es.plannerUnreadInfo).length;
  const totalUnread = unreadLeavesCount + unreadExtrasCount;
  const badge = document.getElementById("inboxBadge");
  if (badge) {
    badge.textContent = totalUnread;
    badge.style.display = totalUnread > 0 ? "inline-flex" : "none";
  }
};

function deduplicateLeaveAndExtraRecords() {
  let removedAny = false;

  if (Array.isArray(sickLeaves) && sickLeaves.length > 1) {
    const seenLeaveKeys = {};
    const cleanedLeaves = [];
    const sorted = sickLeaves.slice().sort((a, b) => {
      const rank = st => (st === "approved" ? 0 : (st === "counter_offer" ? 1 : (st === "pending" ? 2 : 3)));
      return rank(a.status) - rank(b.status);
    });
    const keepIds = new Set();

    sorted.forEach(sl => {
      if (!sl) return;
      if (sl.status === "rejected" || sl.isOnboardingNotice) {
        keepIds.add(sl.id);
        return;
      }
      const sNorm = window.normalizeDateIso ? window.normalizeDateIso(sl.startDate) : sl.startDate;
      const eNorm = window.normalizeDateIso ? window.normalizeDateIso(sl.endDate) : sl.endDate;
      const key = sl.lineRequestData
        ? ("LINE_" + sl.empId + "_" + sl.lineRequestData.lineId + "_" + sl.lineRequestData.type)
        : ("LEAVE_" + sl.empId + "_" + sNorm + "_" + eNorm);
      if (!seenLeaveKeys[key]) {
        seenLeaveKeys[key] = true;
        keepIds.add(sl.id);
      } else {
        removedAny = true;
      }
    });

    if (removedAny) {
      sickLeaves.forEach(sl => {
        if (sl && keepIds.has(sl.id)) cleanedLeaves.push(sl);
      });
      sickLeaves = cleanedLeaves;
    }
  }

  if (Array.isArray(leaveRequests) && leaveRequests.length > 0) {
    const validLeaveIds = new Set(
      (Array.isArray(sickLeaves) ? sickLeaves : [])
        .filter(sl => sl && (sl.status === "approved" || sl.status === "counter_offer") && !sl.isOnboardingNotice && !sl.lineRequestData)
        .map(sl => sl.id)
    );
    const beforeLen = leaveRequests.length;
    leaveRequests = leaveRequests.filter(r => r && validLeaveIds.has(r.leaveId));
    if (leaveRequests.length !== beforeLen) removedAny = true;
  }

  if (Array.isArray(extraShifts) && extraShifts.length > 1) {
    const seenExtraKeys = {};
    const keepExtraIds = new Set();
    let removedExtra = false;

    const sortedExtras = extraShifts.slice().sort((a, b) => {
      const rank = st => (st === "approved" ? 0 : (st === "pending" ? 1 : 2));
      return rank(a.status) - rank(b.status);
    });

    sortedExtras.forEach(es => {
      if (!es) return;
      if (es.status === "rejected") {
        keepExtraIds.add(es.id);
        return;
      }
      const dNorm = window.normalizeDateIso ? window.normalizeDateIso(es.date) : es.date;
      const key = "EXTRA_" + es.empId + "_" + dNorm;
      if (!seenExtraKeys[key]) {
        seenExtraKeys[key] = true;
        keepExtraIds.add(es.id);
      } else {
        removedExtra = true;
        removedAny = true;
      }
    });

    if (removedExtra) {
      extraShifts = extraShifts.filter(es => es && keepExtraIds.has(es.id));
    }
  }

  return removedAny;
}

function applyIncomingDocData(d) {
  if (!d) return;
  hasLoadedFromCloud = true;
  try {
    if (Array.isArray(d.lines) && d.lines.length > 0) lines = d.lines;
    if (Array.isArray(d.roles) && d.roles.length > 0) roles = d.roles;
    sickLeaves = Array.isArray(d.sickLeaves) ? d.sickLeaves : [];
    leaveRequests = Array.isArray(d.leaveRequests) ? d.leaveRequests : [];
    extraShifts = Array.isArray(d.extraShifts) ? d.extraShifts : [];
    historyLogs = Array.isArray(d.historyLogs) ? d.historyLogs : [];
    backups = Array.isArray(d.backups) ? d.backups : [];
    if (d.shiftRotation && typeof d.shiftRotation === "object") shiftRotation = d.shiftRotation;
    if (d.teamsConfig && typeof d.teamsConfig === "object") {
      teamsConfig = d.teamsConfig;
      Object.keys(teamsConfig).forEach(k => {
        if (typeof activeTeamFilters[k] === "undefined") activeTeamFilters[k] = true;
      });
    }
    if (d.securityConfig && typeof d.securityConfig === "object") {
      securityConfig = Object.assign(securityConfig, d.securityConfig);
    }
    if (d.shiftModelConfig && typeof d.shiftModelConfig === "object") {
      shiftModelConfig = Object.assign(shiftModelConfig, d.shiftModelConfig);
      shiftModelConfig.model = "vollkonti_sonntag_frei";
      if (typeof shiftModelConfig.focusModePercent !== "number") {
        shiftModelConfig.focusModePercent = 20;
      }
      if (!shiftModelConfig.roleAllowLineAssign) {
        shiftModelConfig.roleAllowLineAssign = {
          "Bediener": true,
          "LOP": true,
          "TL": false,
          "Schichtexperte": false,
          "Waschraumoperator": false
        };
      }
    }
    if (typeof d.approvedShiftKey === "string") approvedShiftKey = d.approvedShiftKey;
    if (Array.isArray(d.employees)) employees = d.employees;

    let migratedCoverage = false;
    if (!shiftModelConfig.coverageExplicitMigratedV2) {
      (leaveRequests || []).forEach(cov => {
        (cov.days || []).forEach(day => {
          if (!day.takenBy && !day.explicitlyApproved && day.dayStatus === "open") {
            day.dayStatus = "pending";
            migratedCoverage = true;
          }
        });
      });
      shiftModelConfig.coverageExplicitMigratedV2 = true;
    }

    const deduplicatedAny = deduplicateLeaveAndExtraRecords();

    window.sanitizeTeamReferences();
    const fixedDuplicateTeams = ensureUniqueShiftRotationTeams();
    window.syncAbsentAndExtraZones();
    window.updateShiftApprovalUI();

    const autoDidRun = checkScheduledAutomations();
    if (!autoDidRun) {
      window.initBoard();
      if (migratedCoverage || deduplicatedAny || fixedDuplicateTeams) saveToFirebase();
    }
  } catch (err) {
    console.error("Fehler beim Verarbeiten der Cloud-Daten:", err);
  }
}

boardRef.onSnapshot(doc => {
  if (doc.exists && !isDraggingCard && !isRunningAutoTransition) applyIncomingDocData(doc.data());
}, err => {
  console.error("Firestore Snapshot Fehler:", err);
});

window.forceRefreshFromServer = function() {
  boardRef.get({ source: "server" }).then(doc => {
    if (doc.exists) {
      applyIncomingDocData(doc.data());
      window.renderInboxLists();
      showToast("🔄 Live-Daten frisch vom Server geladen!");
    }
  }).catch(() => {
    showToast("Server-Abruf fehlgeschlagen", true);
  });
};

function saveToFirebase() {
  if (!hasLoadedFromCloud) return;
  window.sanitizeTeamReferences();
  ensureUniqueShiftRotationTeams();
  const payload = {
    lines,
    roles,
    employees,
    teamsConfig,
    sickLeaves,
    leaveRequests,
    extraShifts,
    historyLogs,
    backups,
    shiftRotation,
    securityConfig,
    shiftModelConfig,
    approvedShiftKey
  };
  boardRef.update(payload).catch(() => { boardRef.set(payload); });
}

function applyPlannerLoginState(name, lvl, empId) {
  isPlanner = true;
  plannerLevel = lvl;
  currentPlannerName = name;
  currentPlannerEmpId = empId || null;
  sessionStorage.setItem("planner_name", name);
  sessionStorage.setItem("planner_level", String(lvl));
  if (empId) sessionStorage.setItem("planner_emp_id", empId);
  document.body.classList.add("planner-active");
  document.body.classList.toggle("planner-lvl-2", lvl === 2);
  document.body.classList.toggle("planner-lvl-3", lvl === 3);
  document.body.classList.toggle("planner-lvl-4", lvl >= 4);
  const badge = document.getElementById("plannerStatusBadge");
  if (badge) badge.textContent = "👤 " + name + " (Stufe " + lvl + ")";
  window.resetPlanerActivity();
  window.checkBoardLockState();
}

window.logoutPlanner = function() {
  isPlanner = false;
  plannerLevel = 0;
  currentPlannerName = "";
  currentPlannerEmpId = null;
  ["planner_name", "planner_level", "planner_emp_id", "planner_last_active"].forEach(k => sessionStorage.removeItem(k));
  document.body.classList.remove("planner-active", "planner-lvl-2", "planner-lvl-3", "planner-lvl-4");
  ["pinModal", "inboxModal", "settingsModal", "lineEditModal", "secLineUnlockModal", "plannerForcePinModal", "coverageReleaseModal", "leaveCounterOfferModal"].forEach(window.closeModal);
  window.initBoard();
};

window.handleLogoClick = function() {
  if (!isPlanner) {
    document.getElementById("pinModal").style.display = "flex";
    document.getElementById("loginModalError").style.display = "none";
    document.getElementById("loginPlannerName").value = "";
    document.getElementById("pinInput").value = "";
    const sug = document.getElementById("plannerLoginSuggestions");
    if (sug) sug.style.display = "none";
    document.getElementById("loginPlannerName").focus();
  }
};

window.verifyPin = function() {
  const pinVal = document.getElementById("pinInput").value.trim();
  const typedName = (document.getElementById("loginPlannerName").value || "").trim().toLowerCase();

  let emp = selectedLoginPlannerId ? employees.find(e => e.id === selectedLoginPlannerId) : null;
  if (!emp && typedName) emp = employees.find(e => fullName(e).toLowerCase() === typedName);

  if (!emp) return showTimedBoxMsg("loginModalError", "❌ Bitte wähle deinen Namen aus der Vorschlagsliste aus!", false);
  if (Number(emp.accessLevel || 1) < 2) return showTimedBoxMsg("loginModalError", "❌ Keine Planer-Berechtigung (Mindestens Stufe 2 erforderlich)!", false);
  if ((emp.password || "1234") !== pinVal) return showTimedBoxMsg("loginModalError", "❌ PIN nicht korrekt!", false);

  const finishPlannerLogin = () => {
    window.closeModal("pinModal");
    applyPlannerLoginState(fullName(emp), Number(emp.accessLevel) || 2, emp.id);
    addHistoryLog(fullName(emp) + " hat sich angemeldet", "LOGIN");
    saveToFirebase();
    window.initBoard();
  };

  if (emp.mustChangePw !== false) {
    window.closeModal("pinModal");
    window._pendingPlannerForceEmp = emp;
    document.getElementById("plannerForceNewPin1").value = "";
    document.getElementById("plannerForceNewPin2").value = "";
    document.getElementById("plannerForcePinError").style.display = "none";
    document.getElementById("plannerForcePinModal").style.display = "flex";
  } else {
    finishPlannerLogin();
  }
};

window.submitPlannerForcePinChange = function() {
  const emp = window._pendingPlannerForceEmp;
  if (!emp) return;
  const p1 = document.getElementById("plannerForceNewPin1").value.trim();
  const p2 = document.getElementById("plannerForceNewPin2").value.trim();
  const errBox = document.getElementById("plannerForcePinError");

  if (!p1 || p1.length < 4) {
    errBox.textContent = "❌ Die eigene PIN muss mindestens 4 Zeichen lang sein!";
    errBox.style.display = "block";
    return;
  }
  if (p1 !== p2) {
    errBox.textContent = "❌ Die beiden PINs stimmen nicht überein!";
    errBox.style.display = "block";
    return;
  }

  emp.password = p1;
  emp.mustChangePw = false;

  window._pendingPlannerForceEmp = null;
  document.getElementById("plannerForcePinModal").style.display = "none";

  applyPlannerLoginState(fullName(emp), Number(emp.accessLevel) || 2, emp.id);
  addHistoryLog(fullName(emp) + " hat sich angemeldet und persönliche PIN vergeben", "LOGIN");
  saveToFirebase();
  window.initBoard();
  showToast("✅ Eigene PIN erfolgreich gespeichert!");
};

document.addEventListener("click", evt => {
  ["plannerLoginSuggestions", "manualSickSuggestions", "manualExtraSuggestions"].forEach(id => {
    const box = document.getElementById(id);
    if (box && box.parentElement && !box.parentElement.contains(evt.target)) {
      box.style.display = "none";
    }
  });
});

window.addEventListener("DOMContentLoaded", function() {
  injectModernSaaSStyles();
  ensureTrainingProtectionDaysWindowExists();
  Object.keys(teamsConfig).forEach(k => { activeTeamFilters[k] = true; });
  roles.forEach(r => { activeRoleFilters[r] = true; });
  ensureUniqueShiftRotationTeams();
  window.updateHeaderDateKw();
  window.updateShiftApprovalUI();
  window.updateAutoRotationUI();

  const savedName = sessionStorage.getItem("planner_name");
  const savedLvl = Number(sessionStorage.getItem("planner_level") || 0);
  const savedEmpId = sessionStorage.getItem("planner_emp_id");
  const lastAct = Number(sessionStorage.getItem("planner_last_active") || Date.now());
  const maxMs = (Number(securityConfig.plannerTimeoutMin) || 180) * 60000;
  if (savedName && savedLvl >= 2 && (Date.now() - lastAct <= maxMs)) {
    applyPlannerLoginState(savedName, savedLvl, savedEmpId);
  }

  window.initBoard();
});
