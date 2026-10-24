/* ==========================================================================
   PLANER-BOARD MASTER-LOGIK (planer.js) - Version 4.9.66 (TEIL 1 VON 2)
   Vollständige Original-Struktur · Bayer 2-2-2 (Sonntag frei) Automatik ab 05:00 Uhr
   1h-Schicht-Vorlauf · "Nur Stamm" (Planer-Only) · Rotes +EH · Stamm-Schutz-Modus
   ========================================================================== */

window.PLANER_JS_VERSION = "4.9.66";

try {
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp({
      apiKey: "AIzaSyBPOYRYyUm5gA-j7YSAZl7EJoxedFhDTl4",
      authDomain: "schichtplan-bayer.firebaseapp.com",
      projectId: "schichtplan-bayer",
      storageBucket: "schichtplan-bayer.firebasestorage.app",
      messagingSenderId: "152929285194",
      appId: "1:152929285194:web:00b73aa6058a70aed3a2b3"
    });
  }
} catch (e) {
  console.warn("Firebase bereits initialisiert:", e);
}

var db = firebase.firestore();
var boardRef = db.collection("shiftplan").doc("live_board");

var shifts = [
  { id: "frueh", name: "Früh" },
  { id: "spaet", name: "Spät" },
  { id: "nacht", name: "Nacht" }
];
var shiftsLabel = { frueh: "Frühschicht", spaet: "Spätschicht", nacht: "Nachtschicht" };
var shiftsShortLabel = { frueh: "Früh", spaet: "Spät", nacht: "Nacht" };
var weekdayShortNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

var defaultLines = ["32", "33", "34", "09", "22", "39", "36", "37", "38", "54"].map(function(n, idx) {
  return {
    id: "L" + n,
    name: "Linie " + n,
    floor: (idx < 3 ? "1. OG" : (idx < 7 ? "2. OG" : "3. OG")),
    prio: "",
    tag: "",
    note: "",
    ausgeplant: false,
    mainOnly: false,
    roleTargets: { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 }
  };
});

var shiftRotation = { frueh: "team-1", spaet: "team-2", nacht: "team-3", frei: "team-4" };
var lines = defaultLines.slice();
var roles = ["Bediener", "LOP", "TL", "Schichtexperte", "Waschraumoperator"];
var employees = [];
var sickLeaves = [];
var leaveRequests = [];
var extraShifts = [];
var historyLogs = [];
var backups = [];
var recentHistorySearches = [];

var teamsConfig = {
  "team-1": { name: "Team 1", color: "#0091df", rotates: true },
  "team-2": { name: "Team 2", color: "#f59e0b", rotates: true },
  "team-3": { name: "Team 3", color: "#10b981", rotates: true },
  "team-4": { name: "Team 4", color: "#f43f5e", rotates: true }
};

var securityConfig = { boardPwEnabled: false, boardPw: "0110", plannerTimeoutMin: 180 };
var shiftModelConfig = {
  model: "vollkonti_sonntag_frei",
  autoRotate: true,
  smartAssignEnabled: true,
  smartRespectFloorTL: true,
  smartAllowSwap: true,
  focusModeEnabled: true,
  fairnessBalanceEnabled: true,
  rotationCycleMonths: 3,
  coverageExplicitMigratedV2: false,
  resetEnabled: true,
  resetDay: -1,
  resetHour: 5,
  loadEnabled: true,
  loadDay: -1,
  loadHour: 5,
  lastResetRunKey: "",
  lastLoadRunKey: "",
  lastRotationBlockIndex: null,
  lastProcessedProductionDate: "",
  lastActiveShiftWindowKey: "",
  secondaryUnlockThresholdHours: 120,
  minDailyHoursForCounting: 6,
  defaultShiftHours: 8,
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

var approvedShiftKey = "";
var hasLoadedFromCloud = false;
var isDraggingCard = false;
var isRunningAutoTransition = false;
var lastBoardSnapshotForUndo = null;
var pendingSecLineUnlockData = null;
var activeCoverageReleaseLeaveId = null;

var activeTeamFilters = {};
var activeRoleFilters = {};
var poolSearchQuery = "";
var settingsEmpSearchQuery = "";
var inboxSearchQuery = "";
var activeHistoryCategory = "ALL";
window.activeInboxHistoryCategory = window.activeInboxHistoryCategory || "ALL";

var selectedManualSickEmpId = null;
var selectedManualExtraEmpId = null;
var selectedLoginPlannerId = null;
var currentAnchorDaysSelection = [1, 2, 3, 4, 5];

var isPlanner = false;
var plannerLevel = 0;
var currentPlannerName = "";
var currentPlannerEmpId = null;

var sortableInstances = [];
var settingsSortableInstances = [];
var msgTimers = {};
var toastTimer = null;
var planerLastActivityTime = Date.now();
var lastLeaveSubmitTimestamp = 0;

/* ==========================================================================
   0. ULTRA-CLEAN & MODERN SAAS LOOK (AUTOMATISCHE CSS-ENGINE)
   ========================================================================== */

function injectModernSaaSStyles() {
  if (document.getElementById("saasCleanLookStyles")) return;
  const st = document.createElement("style");
  st.id = "saasCleanLookStyles";
  st.textContent = `
    body {
      background-color: #f8fafc !important;
      color: #0f172a !important;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif !important;
      letter-spacing: -0.01em;
    }
    header, .top-bar, .app-header {
      background: rgba(255, 255, 255, 0.92) !important;
      backdrop-filter: blur(10px);
      border-bottom: 1px solid #e2e8f0 !important;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03) !important;
    }
    .auto-toggle-pill, .btn {
      border-radius: 8px !important;
      transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1) !important;
      font-weight: 600 !important;
    }
    .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(15, 23, 42, 0.08);
    }
    .line-header, .shift-header {
      background: #ffffff !important;
      border-color: #e2e8f0 !important;
      box-shadow: inset 0 -1px 0 #e2e8f0;
    }
    .line-header:hover {
      background: #f8fafc !important;
    }
    body.planner-active .shift-header {
      width: 132px !important;
      min-width: 132px !important;
      padding: 4px 5px !important;
    }
    .shift-load-row {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 3px !important;
      align-items: center !important;
    }
    .shift-team-select {
      width: 100% !important;
      flex: 1 1 100% !important;
      min-width: 116px !important;
      font-size: 0.68rem !important;
      font-weight: 700 !important;
      padding: 3px 6px !important;
      border-radius: 5px !important;
    }
    #teamSelect_frei {
      min-width: 118px !important;
      font-size: 0.68rem !important;
      padding: 2px 6px !important;
      border-radius: 5px !important;
    }
    .shift-load-btn, .shift-magic-btn {
      flex: 1 1 44% !important;
      padding: 2px 4px !important;
      font-size: 0.64rem !important;
    }
    .line-prio {
      border-radius: 999px !important;
      padding: 2px 8px !important;
      font-weight: 700 !important;
      font-size: 0.65rem !important;
      border: 1px solid transparent !important;
    }
    .line-prio.prio-high {
      background: #fef2f2 !important;
      color: #dc2626 !important;
      border-color: #fecaca !important;
    }
    .line-prio.prio-mid {
      background: #fffbeb !important;
      color: #d97706 !important;
      border-color: #fde68a !important;
    }
    .line-mainonly-tag {
      display: none !important;
      align-items: center;
      gap: 3px;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
      border-radius: 999px;
      padding: 1px 7px;
      font-size: 0.62rem;
      font-weight: 700;
    }
    body.planner-active .line-mainonly-tag {
      display: inline-flex !important;
    }
    .line-status-tag {
      background: #f1f5f9 !important;
      color: #334155 !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 999px !important;
      padding: 1px 7px !important;
    }
    .line-ausgeplant-tag {
      background: #fff1f2 !important;
      color: #e11d48 !important;
      border: 1px solid #fecdd3 !important;
      border-radius: 999px !important;
      padding: 1px 7px !important;
    }
    .cell-wrapper {
      background: #ffffff !important;
      border-radius: 10px !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.02) !important;
      overflow: hidden;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .cell-wrapper:hover {
      border-color: #cbd5e1 !important;
      box-shadow: 0 4px 10px rgba(15, 23, 42, 0.04) !important;
    }
    .zone-staff-bar {
      font-weight: 600 !important;
      padding: 3px 8px !important;
      border-bottom: 1px solid #f1f5f9 !important;
    }
    .zone-staff-bar.status-ok {
      background: #f0fdf4 !important;
      color: #15803d !important;
    }
    .zone-staff-bar.status-missing {
      background: #fff1f2 !important;
      color: #be123c !important;
    }
    .zone-staff-bar.status-over {
      background: #eff6ff !important;
      color: #1d4ed8 !important;
    }
    .employee-card {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 8px !important;
      padding: 5px 8px !important;
      margin-bottom: 4px !important;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03) !important;
      transition: transform 0.16s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.16s ease, border-color 0.16s ease !important;
    }
    .employee-card:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.07) !important;
      border-color: #cbd5e1 !important;
    }
    .card-name {
      color: #0f172a !important;
      font-weight: 700 !important;
    }
    .card-role {
      background: #f1f5f9 !important;
      color: #334155 !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 999px !important;
      padding: 1px 6px !important;
      font-weight: 600 !important;
    }
    .card-pin-info {
      background: #f0f9ff !important;
      color: #0369a1 !important;
      border: 1px solid #bae6fd !important;
      border-radius: 999px !important;
      padding: 0 6px !important;
    }
    .shift-kpi-pill.ok {
      background: #f0fdf4 !important;
      color: #15803d !important;
      border: 1px solid #bbf7d0 !important;
      border-radius: 999px !important;
    }
    .shift-kpi-pill.warn {
      background: #fff1f2 !important;
      color: #be123c !important;
      border: 1px solid #fecdd3 !important;
      border-radius: 999px !important;
    }
    .shift-kpi-pill.eh-zero {
      background: #fef2f2 !important;
      color: #dc2626 !important;
      border: 1px solid #f87171 !important;
      font-weight: 800 !important;
    }
    .eh-plus-icon {
      color: #dc2626 !important;
      font-weight: 900 !important;
      font-size: 0.74rem !important;
      line-height: 1 !important;
    }
    .modal-content, .portal-card, .sidebar-panel {
      border-radius: 14px !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.06), 0 8px 10px -6px rgba(15, 23, 42, 0.04) !important;
    }
    .item-row {
      border-radius: 8px !important;
      border: 1px solid #e2e8f0 !important;
      background: #ffffff !important;
      margin-bottom: 5px !important;
      padding: 7px 10px !important;
      transition: background 0.15s ease;
    }
    .item-row:hover {
      background: #f8fafc !important;
    }
  `;
  document.head.appendChild(st);
}

/* ==========================================================================
   1. GLOBALE BASIS-, DATUMS- & 2-2-2 (SONNTAG FREI) BLOCK-FUNKTIONEN
   ========================================================================== */

window.closeModal = function(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
};

window.resetPlanerActivity = function() {
  planerLastActivityTime = Date.now();
  if (isPlanner) sessionStorage.setItem("planner_last_active", String(planerLastActivityTime));
};

["click", "keydown", "mousemove", "touchstart"].forEach(evtName => {
  window.addEventListener(evtName, () => {
    if (isPlanner) window.resetPlanerActivity();
  }, { passive: true });
});

function showToast(text, isError) {
  const t = document.getElementById("toastBanner");
  if (!t) return;
  if (toastTimer) clearTimeout(toastTimer);
  t.style.background = isError ? "#e11d48" : "#10b981";
  t.style.borderRadius = "10px";
  t.style.boxShadow = "0 10px 20px rgba(15,23,42,0.15)";
  t.textContent = text;
  t.style.display = "block";
  toastTimer = setTimeout(() => { t.style.display = "none"; }, 3500);
}

function showTimedBoxMsg(elId, text, isSuccess) {
  const box = document.getElementById(elId);
  if (!box) return;
  if (msgTimers[elId]) clearTimeout(msgTimers[elId]);
  box.style.background = isSuccess ? "#f0fdf4" : "#fff1f2";
  box.style.color = isSuccess ? "#166534" : "#be123c";
  box.style.border = "1px solid " + (isSuccess ? "#bbf7d0" : "#fecdd3");
  box.style.borderRadius = "8px";
  box.textContent = text;
  box.style.display = "block";
  msgTimers[elId] = setTimeout(() => { box.style.display = "none"; }, 5000);
}

function getTodayIso(dObj) {
  const d = dObj || new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

window.normalizeDateIso = function(dStr) {
  if (!dStr) return "";
  const s = String(dStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const pDe = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (pDe) return pDe[3] + "-" + pDe[2] + "-" + pDe[1];
  return s.slice(0, 10);
};

function parseIsoToLocalDate(isoDate) {
  const p = String(isoDate || "").split("-");
  if (p.length !== 3) return new Date();
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function shiftDateIso(isoDate, deltaDays) {
  const d = parseIsoToLocalDate(isoDate);
  d.setDate(d.getDate() + deltaDays);
  return getTodayIso(d);
}

function getPrevDateIso(isoDate) { return shiftDateIso(isoDate, -1); }
function getNextDateIso(isoDate) { return shiftDateIso(isoDate, 1); }

function daysBetweenIso(isoA, isoB) {
  if (!isoA || !isoB) return 9999;
  const a = parseIsoToLocalDate(isoA).getTime();
  const b = parseIsoToLocalDate(isoB).getTime();
  return Math.round(Math.abs(b - a) / 86400000);
}

function formatDateDe(isoDate) {
  if (!isoDate) return "";
  const p = String(isoDate).split("-");
  return p.length === 3 ? (p[2] + "." + p[1] + "." + p[0]) : isoDate;
}

function getWeekdayShortDe(isoDate) {
  const p = String(isoDate || "").split("-");
  return p.length === 3 ? (weekdayShortNames[parseIsoToLocalDate(isoDate).getDay()] || "") : "";
}

function isIsoDateSunday(iso) {
  const p = String(iso || "").split("-");
  return p.length === 3 && parseIsoToLocalDate(iso).getDay() === 0;
}

/* Sonntag ist komplett schichtfrei (ab 05:00 Uhr morgens bis Montag 05:00 Uhr Vorlauf) */
function isSundayRestPeriod(baseDate) {
  const d = baseDate || new Date();
  return d.getDay() === 0 && d.getHours() >= 5;
}

function isSundayDaytimeFree() {
  return isSundayRestPeriod(new Date());
}

/* Produktionstag wechselt exakt um 05:00 Uhr morgens (1h vor Frühschicht-Beginn um 06:00 Uhr).
   Zwischen 00:00 und 04:59 Uhr läuft noch die Nachtschicht des Vortags. */
function getLogicalDateObj(baseDate) {
  const now = baseDate || new Date();
  if (now.getHours() < 5) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0);
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
}

function getLogicalDateIso(baseDate) {
  return getTodayIso(getLogicalDateObj(baseDate));
}

/* 1-Stunden-Vorlauf für jede Schicht (ab 05:00 Uhr):
   - Ab 05:00 bis 12:59 Uhr -> Frühschicht (Start 06:00)
   - Ab 13:00 bis 20:59 Uhr -> Spätschicht (Start 14:00)
   - Ab 21:00 bis 04:59 Uhr -> Nachtschicht (Start 22:00) */
function getCurrentActiveShiftId(baseDate) {
  const h = (baseDate || new Date()).getHours();
  return (h >= 5 && h < 13) ? "frueh" : ((h >= 13 && h < 21) ? "spaet" : "nacht");
}

function getCurrentShiftApprovalKey() {
  return getLogicalDateIso() + "_" + getCurrentActiveShiftId();
}

function isCurrentShiftApproved() {
  return approvedShiftKey === getCurrentShiftApprovalKey();
}

function getCalendarWeek(d) {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  return Math.ceil((firstThursday - target) / 604800000 + 1);
}

/* Exakte Bayer 2-2-2 (Sonntag frei) Block-Formel */
function getWorkdayBlockIndex(isoDateStr) {
  const p = String(isoDateStr || getLogicalDateIso()).split("-");
  const diffDays = Math.floor((Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - Date.UTC(2026, 0, 12)) / 86400000);
  const weeks = Math.floor(diffDays / 7);
  const dayInWeek = ((diffDays % 7) + 7) % 7;
  return weeks * 3 + Math.floor(Math.min(dayInWeek, 5) / 2);
}

function getBlockDayInfo(isoDateStr) {
  const d = parseIsoToLocalDate(isoDateStr || getLogicalDateIso());
  const jsDay = d.getDay();
  if (jsDay === 0) {
    return { isSunday: true, dayInBlock: 0, blockLabel: "Sonntag (Schichtfrei)", nextChangeIso: getNextDateIso(isoDateStr) };
  }
  const dayInWeekMon0 = jsDay - 1;
  const dayInBlock = (dayInWeekMon0 % 2) + 1;
  const pairNames = ["Mo + Di", "Mi + Do", "Fr + Sa"][Math.floor(dayInWeekMon0 / 2)];
  const deltaToNext = dayInBlock === 1 ? 2 : (jsDay === 6 ? 2 : 1);
  return {
    isSunday: false,
    dayInBlock: dayInBlock,
    blockLabel: pairNames + " (Tag " + dayInBlock + " von 2)",
    nextChangeIso: shiftDateIso(isoDateStr || getLogicalDateIso(), deltaToNext)
  };
}

function fullName(e) {
  return e ? ((e.firstName || "") + " " + (e.lastName || "")).trim() : "";
}

function extractLineIdFromZone(z) {
  if (!z || ["pool", "review", "absent", "extra"].indexOf(z) !== -1) return null;
  return z.indexOf("_") === -1 ? z : z.split("_").slice(0, -1).join("_");
}

function extractShiftIdFromZone(z) {
  if (!z || ["pool", "review", "absent", "extra"].indexOf(z) !== -1 || z.indexOf("_") === -1) return null;
  return z.split("_").pop();
}

function getLineNameById(lineId) {
  const found = lines.find(l => l.id === lineId);
  return found ? found.name : lineId;
}

function getShortLineNumber(lineIdOrZone) {
  const pureId = extractLineIdFromZone(lineIdOrZone) || lineIdOrZone;
  if (!pureId) return "";
  const found = lines.find(l => l.id === pureId);
  return (found ? found.name : String(pureId)).replace(/^Linie\s*/i, "").replace(/^L/i, "").trim();
}

function isTeamRotating(teamKey) {
  return teamsConfig[teamKey] ? (teamsConfig[teamKey].rotates !== false) : true;
}

function isEmpAnchorActiveToday(emp, dateIso) {
  if (!emp || !emp.noRotation) return false;
  const jsDay = parseIsoToLocalDate(dateIso || getLogicalDateIso()).getDay();
  const fixDays = Array.isArray(emp.fixDays) ? emp.fixDays : [1, 2, 3, 4, 5];
  return fixDays.indexOf(jsDay) !== -1;
}

/* Prüft den Neu-Mitarbeiter Einarbeitungs-Modus ("Stamm-Schutz-Phase", z.B. 360 Tage zu 90% an Stammlinie) */
window.getEmpTrainingProtectionInfo = function(emp, refDateIso) {
  if (!emp || !emp.inTrainingPhase) {
    return { active: false, totalDays: 0, elapsedDays: 0, remainingDays: 0, mainPct: 90, startDate: "" };
  }
  const todayIso = refDateIso || getLogicalDateIso();
  const startIso = emp.trainingStartDate || todayIso;
  const totalDays = Math.max(1, parseInt(emp.trainingDays, 10) || 360);
  const mainPct = Math.min(100, Math.max(50, parseInt(emp.trainingMainPct, 10) || 90));
  const pStart = parseIsoToLocalDate(startIso).getTime();
  const pToday = parseIsoToLocalDate(todayIso).getTime();
  const elapsedDays = Math.max(0, Math.floor((pToday - pStart) / 86400000));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  return {
    active: elapsedDays < totalDays,
    totalDays: totalDays,
    elapsedDays: elapsedDays,
    remainingDays: remainingDays,
    mainPct: mainPct,
    startDate: startIso
  };
};

/* Entscheidet anhand der gewählten Prozent-Quote (z.B. 90%), ob der Mitarbeiter heute strikt auf seiner Stammlinie gehalten wird */
window.shouldHoldEmpOnMainLineToday = function(emp, todayIso) {
  const prot = window.getEmpTrainingProtectionInfo(emp, todayIso);
  if (!prot.active) return false;
  if (!Array.isArray(emp.mainLines) || emp.mainLines.length === 0) return false;
  if (prot.mainPct >= 100) return true;
  const bucket = ((prot.elapsedDays * 17) + 7) % 100;
  return bucket < prot.mainPct;
};

window.sanitizeTeamReferences = function() {
  const validKeys = Object.keys(teamsConfig);
  if (!validKeys.length) {
    teamsConfig["team-1"] = { name: "Team 1", color: "#0091df", rotates: true };
    validKeys.push("team-1");
  }
  const fallbackKey = validKeys[0];
  ["frueh", "spaet", "nacht", "frei"].forEach(slot => {
    if (!shiftRotation[slot] || !teamsConfig[shiftRotation[slot]]) shiftRotation[slot] = fallbackKey;
  });
  employees.forEach(emp => {
    if (!emp.team || !teamsConfig[emp.team]) emp.team = fallbackKey;
    if (!emp.password) {
      emp.password = "1234";
      if (typeof emp.mustChangePw === "undefined") emp.mustChangePw = true;
    }
    if (!emp.trainingHoursByLine) emp.trainingHoursByLine = {};
    if (!emp.trainingCreditedDates) emp.trainingCreditedDates = {};
    if (!emp.lineHistory) emp.lineHistory = {};
    if (!emp.lineAssignCounts) emp.lineAssignCounts = {};
    if (emp.inTrainingPhase) {
      if (!emp.trainingDays) emp.trainingDays = 360;
      if (!emp.trainingMainPct) emp.trainingMainPct = 90;
      if (!emp.trainingStartDate) emp.trainingStartDate = getLogicalDateIso();
    }
  });
  Object.keys(activeTeamFilters).forEach(k => {
    if (!teamsConfig[k]) delete activeTeamFilters[k];
  });
};

window.checkBoardLockState = function() {
  const modal = document.getElementById("boardLockModal");
  if (!modal) return;
  if (securityConfig && securityConfig.boardPwEnabled && !isPlanner) {
    modal.style.display = (sessionStorage.getItem("board_unlocked") === "true") ? "none" : "flex";
  } else {
    modal.style.display = "none";
  }
};

window.unlockBoardView = function() {
  const inp = document.getElementById("boardLockInput");
  const val = inp ? inp.value.trim() : "";
  const targetPw = (securityConfig && securityConfig.boardPw) ? String(securityConfig.boardPw).trim() : "0110";
  if (val === targetPw) {
    sessionStorage.setItem("board_unlocked", "true");
    if (inp) inp.value = "";
    const errEl = document.getElementById("boardLockError");
    if (errEl) errEl.style.display = "none";
    window.checkBoardLockState();
  } else {
    showTimedBoxMsg("boardLockError", "❌ Falsches Zugangs-Passwort!", false);
  }
};

window.openPlannerLoginFromLock = function() {
  window.closeModal("boardLockModal");
  window.handleLogoClick();
};

window.updateHeaderDateKw = function() {
  const el = document.getElementById("headerDateKw");
  if (!el) return;
  const now = new Date();
  const ld = getLogicalDateObj(now);
  const prodIso = getLogicalDateIso(now);
  const bInfo = getBlockDayInfo(prodIso);
  const activeShift = shiftsShortLabel[getCurrentActiveShiftId(now)] || "Früh";
  el.textContent = now.toLocaleDateString("de-DE", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }) +
    " · KW " + getCalendarWeek(ld) + " · " + bInfo.blockLabel + " (" + activeShift + " aktiv) · v" + window.PLANER_JS_VERSION;

  const warnBtn = document.getElementById("btnForceCacheReload");
  if (warnBtn) {
    warnBtn.style.display = (window.EXPECTED_HTML_VERSION && window.EXPECTED_HTML_VERSION !== window.PLANER_JS_VERSION) ? "inline-flex" : "none";
  }
};

/* Aktualisiert sowohl den Planer-Button als auch den Portal-Header-Status für die aktuell aktive Schicht */
window.updateShiftApprovalUI = function() {
  const approved = isCurrentShiftApproved();
  const sundayFree = isSundayDaytimeFree();
  const activeShiftId = getCurrentActiveShiftId();
  const activeShort = shiftsShortLabel[activeShiftId] || "Schicht";
  const activeLong = shiftsLabel[activeShiftId] || "Aktuelle Schicht";

  const bar = document.getElementById("brandGradientBar");
  if (bar) bar.className = (approved || sundayFree) ? "brand-gradient approved" : "brand-gradient pending";

  const dot = document.getElementById("indicatorDot");
  const text = document.getElementById("indicatorText");
  const btn = document.getElementById("plannerApprovalIndicator");
  if (dot && text && btn) {
    dot.style.background = approved ? "#16a34a" : "#dc2626";
    text.textContent = approved ? ("Freigegeben (" + activeShort + ")") : (activeShort + " freigeben");
    btn.style.borderColor = approved ? "#86efac" : "#fecaca";
    btn.style.background = approved ? "#f0fdf4" : "#fef2f2";
    btn.style.color = approved ? "#166534" : "#b91c1c";
  }

  const portalBadge = document.getElementById("portalShiftStatusBadge");
  const portalDot = document.getElementById("portalStatusDot");
  const portalText = document.getElementById("portalStatusText");
  if (portalBadge && portalDot && portalText) {
    if (sundayFree) {
      portalBadge.className = "portal-shift-status sunday";
      portalDot.style.background = "#0284c7";
      portalText.textContent = "☀️ Sonntag – Regulär Schichtfrei";
    } else if (approved) {
      portalBadge.className = "portal-shift-status approved";
      portalDot.style.background = "#16a34a";
      portalText.textContent = "✅ " + activeLong + " ist vom Planer bestätigt";
    } else {
      portalBadge.className = "portal-shift-status pending";
      portalDot.style.background = "#dc2626";
      portalText.textContent = "⏳ " + activeLong + " ist noch nicht bestätigt";
    }
  }
};

window.toggleShiftApprovalState = function() {
  if (plannerLevel <= 2) return;
  const activeShiftId = getCurrentActiveShiftId();
  const activeLong = shiftsLabel[activeShiftId] || "Schicht";
  const currentKey = getCurrentShiftApprovalKey();
  if (approvedShiftKey === currentKey) {
    approvedShiftKey = "";
    addHistoryLog("Freigabe für " + activeLong + " zurückgenommen", "SHIFT");
    showToast("Freigabe für " + activeLong + " zurückgenommen");
  } else {
    approvedShiftKey = currentKey;
    addHistoryLog(activeLong + " fürs Mitarbeiter-Portal freigegeben", "SHIFT");
    showToast("✅ " + activeLong + " freigegeben!");
  }
  window.updateShiftApprovalUI();
  saveToFirebase();
};

/* ==========================================================================
   2. HEADER-SCHALTER (AUTO-ROTATION, AUTO-ZUWEISUNG, KOMB. ZEIT-SCHALTER)
   ========================================================================== */

window.updateAutoRotationUI = function() {
  const isAuto = shiftModelConfig.autoRotate !== false;
  const badge = document.getElementById("autoRotationBadge");
  const badgeText = document.getElementById("autoRotationText");
  if (badge && badgeText) {
    badge.className = "auto-toggle-pill lvl-2-hide" + (isAuto ? " active-blue" : "");
    badgeText.textContent = isAuto ? "Auto-Rotation: AN" : "Auto-Rotation: AUS";
  }
  const cfgChk = document.getElementById("cfgAutoRotate");
  if (cfgChk) cfgChk.checked = isAuto;

  const smartActive = shiftModelConfig.smartAssignEnabled !== false;
  const smartBadge = document.getElementById("smartAssignToggleBadge");
  const smartTxt = document.getElementById("smartAssignBadgeText");
  if (smartBadge && smartTxt) {
    smartBadge.className = "auto-toggle-pill lvl-2-hide" + (smartActive ? " active-purple" : "");
    smartTxt.textContent = smartActive ? "Auto-Zuweisung: AN" : "Auto-Zuweisung: AUS";
  }
  const smartChk = document.getElementById("cfgSmartAssignEnabled");
  if (smartChk) smartChk.checked = smartActive;

  const combinedActive = !!(shiftModelConfig.resetEnabled || shiftModelConfig.loadEnabled);
  const combBadge = document.getElementById("autoTimedCombinedBadge");
  const combTxt = document.getElementById("autoTimedCombinedBadgeText");
  if (combBadge && combTxt) {
    combBadge.className = "auto-toggle-pill lvl-2-hide" + (combinedActive ? " active-teal" : "");
    combTxt.textContent = combinedActive ? "Auto-Reset/Verteilen: AN" : "Auto-Reset/Verteilen: AUS";
  }
};

window.toggleAutoRotateQuick = function() {
  if (plannerLevel <= 2) return;
  shiftModelConfig.autoRotate = !(shiftModelConfig.autoRotate !== false);
  if (shiftModelConfig.autoRotate) {
    shiftModelConfig.lastRotationBlockIndex = getWorkdayBlockIndex(getLogicalDateIso());
  }
  saveToFirebase();
  window.updateAutoRotationUI();
  if (typeof window.syncShiftModelSettingsUI === "function") window.syncShiftModelSettingsUI();
  addHistoryLog("Automatische Schicht-Rotation auf " + (shiftModelConfig.autoRotate ? "AN" : "AUS") + " gestellt", "SHIFT");
  showToast("🔄 Auto-Rotation: " + (shiftModelConfig.autoRotate ? "AN" : "AUS"));
};

window.toggleSmartAssignQuick = function() {
  if (plannerLevel <= 2) return;
  shiftModelConfig.smartAssignEnabled = !(shiftModelConfig.smartAssignEnabled !== false);
  saveToFirebase();
  window.updateAutoRotationUI();
  if (typeof window.syncShiftModelSettingsUI === "function") window.syncShiftModelSettingsUI();
  addHistoryLog("Intelligente Auto-Zuweisung auf " + (shiftModelConfig.smartAssignEnabled ? "AN" : "AUS") + " gestellt", "AUTO");
  showToast("🧠 Auto-Zuweisung: " + (shiftModelConfig.smartAssignEnabled ? "AN" : "AUS"));
};

window.toggleAutoTimedCombinedQuick = function() {
  if (plannerLevel <= 2) return;
  const nextState = !(shiftModelConfig.resetEnabled || shiftModelConfig.loadEnabled);
  shiftModelConfig.resetEnabled = nextState;
  shiftModelConfig.loadEnabled = nextState;
  if (nextState) {
    shiftModelConfig.resetDay = -1;
    shiftModelConfig.loadDay = -1;
    shiftModelConfig.resetHour = 5;
    shiftModelConfig.loadHour = 5;
  }
  saveToFirebase();
  window.updateAutoRotationUI();
  if (typeof window.syncShiftModelSettingsUI === "function") window.syncShiftModelSettingsUI();
  addHistoryLog("Auto-Reset/Verteilen im Header auf " + (nextState ? "AN" : "AUS") + " gestellt", "SHIFT");
  showToast("⏱️ Auto-Reset/Verteilen (05:00 Uhr): " + (nextState ? "AN (Aktiv)" : "AUS"));
};

/* ==========================================================================
   3. HISTORIE, ABWESENHEITS- & 2-2-2 (SONNTAG FREI) BRINGSCHICHT-LOGIK
   ========================================================================== */

function addHistoryLog(text, category) {
  const now = new Date();
  const cutoffMs = now.getTime() - 360 * 86400000;
  historyLogs = (Array.isArray(historyLogs) ? historyLogs : []).filter(item => {
    const ts = item && item.timestamp ? new Date(item.timestamp).getTime() : now.getTime();
    return ts >= cutoffMs;
  });
  historyLogs.unshift({
    id: "log_" + now.getTime() + "_" + Math.floor(Math.random() * 1000),
    timestamp: now.toISOString(),
    actor: currentPlannerName || "System",
    category: category || "INFO",
    text: text
  });
  if (historyLogs.length > 500) historyLogs = historyLogs.slice(0, 500);
}
window.logHistory = function(cat, text) { addHistoryLog(text, cat); };

function getRotationForDate(targetIso) {
  const anchorBlock = (typeof shiftModelConfig.lastRotationBlockIndex === "number")
    ? shiftModelConfig.lastRotationBlockIndex
    : getWorkdayBlockIndex(getLogicalDateIso());
  const diff = getWorkdayBlockIndex(targetIso) - anchorBlock;
  const slotOrder = (shiftModelConfig && shiftModelConfig.model === "dreierschicht")
    ? ["frueh", "spaet", "nacht"]
    : ["frueh", "spaet", "nacht", "frei"];
  const activeSlots = slotOrder.filter(s => shiftRotation[s] && isTeamRotating(shiftRotation[s]));
  const res = Object.assign({}, shiftRotation);
  if (activeSlots.length >= 2 && shiftModelConfig.autoRotate !== false && diff !== 0) {
    const len = activeSlots.length;
    activeSlots.forEach((fromSlot, idx) => {
      res[activeSlots[((idx + diff) % len + len) % len]] = shiftRotation[fromSlot];
    });
  }
  return res;
}

window.getEmpRegularShiftOnDate = function(emp, dateIso) {
  if (!emp || !dateIso || isIsoDateSunday(dateIso)) return null;
  if (emp.noRotation) {
    if (!isEmpAnchorActiveToday(emp, dateIso)) return null;
    return extractShiftIdFromZone(emp.zone) || emp.lastShiftId || "frueh";
  }
  if (!isTeamRotating(emp.team)) {
    const dayNum = parseIsoToLocalDate(dateIso).getDay();
    if (dayNum === 0 || dayNum === 6) return null;
    return ["frueh", "spaet", "nacht"].find(s => shiftRotation[s] === emp.team) || "frueh";
  }
  const rot = getRotationForDate(dateIso);
  return ["frueh", "spaet", "nacht"].find(s => rot[s] === emp.team) || null;
};

function getEmpAnyShiftOnDate(emp, dateIso, ignoreExtraId) {
  if (!emp || !dateIso) return null;
  const reg = window.getEmpRegularShiftOnDate(emp, dateIso);
  if (reg) return reg;
  const extra = extraShifts.find(es => es.id !== ignoreExtraId && es.empId === emp.id && es.date === dateIso && (es.status === "approved" || es.status === "pending"));
  return extra ? extra.shift : null;
}

window.didEmpWorkNightBefore = function(emp, dateIso) {
  return (emp && dateIso) ? (getEmpAnyShiftOnDate(emp, getPrevDateIso(dateIso)) === "nacht") : false;
};

function getActiveLeaveForEmpOnDate(empId, isoDate) {
  return sickLeaves.find(sl => {
    if (sl.empId !== empId || sl.status === "rejected" || sl.status === "pending" || sl.isOnboardingNotice || sl.lineRequestData) return false;
    if (sl.blocks && sl.blocks.length) {
      return sl.blocks.some(b => b.status === "approved" && b.start <= isoDate && b.end >= isoDate);
    }
    return sl.status === "approved" && sl.startDate <= isoDate && sl.endDate >= isoDate;
  });
}

/* Strikte Doppel-Antrags-Sperre mit automatischer Datums-Normalisierung */
window.hasLeaveOverlap = function(empId, startIso, endIso, ignoreLeaveId) {
  if (!empId || !startIso || !endIso) return false;
  const normA = window.normalizeDateIso(startIso);
  const normB = window.normalizeDateIso(endIso);
  if (!normA || !normB) return false;
  const sIso = normA <= normB ? normA : normB;
  const eIso = normA <= normB ? normB : normA;
  return (Array.isArray(sickLeaves) ? sickLeaves : []).some(sl => {
    if (!sl) return false;
    if (ignoreLeaveId && sl.id === ignoreLeaveId) return false;
    if (String(sl.empId) !== String(empId)) return false;
    if (sl.status === "rejected" || sl.isOnboardingNotice || sl.lineRequestData) return false;
    const slStart = window.normalizeDateIso(sl.startDate);
    const slEnd = window.normalizeDateIso(sl.endDate);
    if (!slStart || !slEnd) return false;
    return !(slEnd < sIso || slStart > eIso);
  });
};

window.getEmpProbableLinesText = function(emp) {
  if (!emp) return "";
  if (emp.pinnedZone) {
    const lId = extractLineIdFromZone(emp.pinnedZone);
    if (lId) return getLineNameById(lId);
  }
  if (Array.isArray(emp.mainLines) && emp.mainLines.length > 0) {
    const names = emp.mainLines.slice(0, 2).map(id => getLineNameById(id));
    return names.length > 1 ? ("Voraussichtlich " + names.join(" oder ")) : names[0];
  }
  return "";
};

window.generateCoveragePromptForLeave = function(sl, defaultDayStatus) {
  if (!sl || sl.isOnboardingNotice || sl.lineRequestData || !sl.startDate || !sl.endDate) return null;
  const emp = employees.find(e => e.id === sl.empId);
  if (!emp) return null;

  const existingCov = (Array.isArray(leaveRequests) ? leaveRequests : []).find(r => r.leaveId === sl.id || r.id === ("cov_" + sl.id));
  const prevDaysMap = {};
  if (existingCov && Array.isArray(existingCov.days)) {
    existingCov.days.forEach(d => {
      prevDaysMap[d.date + "_" + d.shift] = d;
    });
  }

  leaveRequests = (Array.isArray(leaveRequests) ? leaveRequests : []).filter(r => r.leaveId !== sl.id && r.id !== ("cov_" + sl.id));

  const initStatus = defaultDayStatus || "pending";
  const days = [];
  let curIso = window.normalizeDateIso(sl.startDate);
  const endIso = window.normalizeDateIso(sl.endDate);
  let safetyCounter = 0;
  while (curIso <= endIso && safetyCounter < 120) {
    safetyCounter++;
    const regShift = window.getEmpRegularShiftOnDate(emp, curIso);
    if (regShift) {
      const prev = prevDaysMap[curIso + "_" + regShift];
      days.push({
        date: curIso,
        shift: regShift,
        takenBy: prev ? prev.takenBy : null,
        dayStatus: prev ? prev.dayStatus : initStatus,
        explicitlyApproved: prev ? !!prev.explicitlyApproved : (initStatus === "open"),
        allowWithRestWarning: prev ? !!prev.allowWithRestWarning : false
      });
    }
    curIso = getNextDateIso(curIso);
  }

  if (days.length > 0) {
    const newCov = {
      id: "cov_" + sl.id,
      leaveId: sl.id,
      empId: emp.id,
      role: emp.role || "Bediener",
      probableLines: window.getEmpProbableLinesText(emp),
      days: days
    };
    leaveRequests.push(newCov);
    return newCov;
  }
  return null;
};

window.removeCoveragePromptForLeave = function(slId) {
  if (!slId) return;
  leaveRequests = (Array.isArray(leaveRequests) ? leaveRequests : []).filter(r => r.leaveId !== slId && r.id !== ("cov_" + slId));
};

window.formatConflictForPlanner = function(reasonText, empName) {
  if (!reasonText) return "";
  const name = empName || "Der Mitarbeiter";
  return String(reasonText)
    .replace(/Du hast /g, name + " hat ")
    .replace(/Du arbeitest /g, name + " arbeitet ")
    .replace(/Du bist /g, name + " ist ")
    .replace(/deiner /g, "der ")
    .replace(/deine /g, "die ");
};

window.checkExtraShiftPlausibility = function(empId, dateIso, shiftId, ignoreExtraId) {
  const emp = employees.find(e => e.id === empId);
  const normDate = window.normalizeDateIso(dateIso);
  if (!emp || !normDate || !shiftId) {
    return { ok: false, isWorkingConflict: false, reason: "Ungültige Eingabe." };
  }

  const existingExtra = extraShifts.find(es => es.id !== ignoreExtraId && es.empId === emp.id && window.normalizeDateIso(es.date) === normDate && es.status !== "rejected");
  if (existingExtra) {
    return {
      ok: false,
      isWorkingConflict: false,
      reason: "Du hast für den " + formatDateDe(normDate) + " bereits eine Bringschicht (" + (shiftsLabel[existingExtra.shift] || existingExtra.shift) + ") eingetragen."
    };
  }

  const warnings = [];
  let isNightConflict = false;

  const activeLeave = getActiveLeaveForEmpOnDate(emp.id, normDate);
  if (activeLeave) {
    warnings.push("Du bist am " + formatDateDe(normDate) + " als abwesend eingetragen (" + (activeLeave.category || "Urlaub/Krank") + ").");
  }

  if (isIsoDateSunday(normDate)) {
    if (shiftId === "nacht") isNightConflict = true;
    warnings.push("Der " + formatDateDe(normDate) + " ist ein Sonntag (jeder Sonntag ist regulär schichtfrei).");
  }

  const regShift = window.getEmpRegularShiftOnDate(emp, normDate);
  if (regShift) {
    if (regShift === "nacht" || shiftId === "nacht") isNightConflict = true;
    warnings.push("Du arbeitest am " + formatDateDe(normDate) + " laut Schichtplan bereits regulär in der " + (shiftsLabel[regShift] || regShift) + ".");
  }

  const prevIso = getPrevDateIso(normDate);
  const prevShift = getEmpAnyShiftOnDate(emp, prevIso, ignoreExtraId);
  if (prevShift === "nacht" && (shiftId === "frueh" || shiftId === "spaet")) {
    isNightConflict = true;
    warnings.push("Ruhezeit-Konflikt: Du hast am Vortag (" + formatDateDe(prevIso) + ") Nachtschicht (bis 06:00 Uhr morgens) – direkt danach ist keine " + (shiftsLabel[shiftId] || shiftId) + " möglich.");
  } else if (prevShift === "spaet" && shiftId === "frueh") {
    warnings.push("Ruhezeit-Konflikt: Nach deiner Spätschicht am Vortag (" + formatDateDe(prevIso) + ", bis 22:00 Uhr) ist die Ruhezeit bis zur Frühschicht (06:00 Uhr) zu kurz.");
  }

  const nextIso = getNextDateIso(normDate);
  const nextShift = getEmpAnyShiftOnDate(emp, nextIso, ignoreExtraId);
  if (shiftId === "nacht" && (nextShift === "frueh" || nextShift === "spaet")) {
    isNightConflict = true;
    warnings.push("Ruhezeit-Konflikt: Diese Nachtschicht (bis 06:00 Uhr morgens) läuft direkt in deine " + (shiftsLabel[nextShift] || nextShift) + " am Folgetag (" + formatDateDe(nextIso) + ") hinein.");
  } else if (shiftId === "spaet" && nextShift === "frueh") {
    warnings.push("Ruhezeit-Konflikt: Zwischen dieser Spätschicht (bis 22:00 Uhr) und deiner Frühschicht am Folgetag (" + formatDateDe(nextIso) + ", ab 06:00 Uhr) liegen nur 8 Stunden Pause.");
  }

  if (warnings.length > 0) {
    return {
      ok: false,
      isWorkingConflict: true,
      isNightShiftConflict: isNightConflict,
      reason: warnings.join(" ")
    };
  }

  return { ok: true, isWorkingConflict: false, isNightShiftConflict: false, reason: "" };
};

function checkExtraShiftConflict(emp, dateIso, shiftId, ignoreExtraId) {
  if (!emp || !dateIso || !shiftId) return null;
  const res = window.checkExtraShiftPlausibility(emp.id, dateIso, shiftId, ignoreExtraId);
  return (!res.ok && res.reason) ? window.formatConflictForPlanner(res.reason, fullName(emp)) : null;
}

window.addPortalLeaveRequest = function(empId, startIso, endIso, category, reason) {
  const nowMs = Date.now();
  if (nowMs - lastLeaveSubmitTimestamp < 600) return false;

  const emp = employees.find(e => e.id === empId);
  const sNorm = window.normalizeDateIso(startIso);
  const eNorm = window.normalizeDateIso(endIso);
  if (!emp || !sNorm || !eNorm || sNorm > eNorm) return false;
  if (window.hasLeaveOverlap(emp.id, sNorm, eNorm)) return false;

  lastLeaveSubmitTimestamp = nowMs;

  const isSick = String(category || "").toLowerCase().indexOf("arbeitsunfähig") !== -1 || String(category || "").toLowerCase().indexOf("krank") !== -1;
  const newLeave = {
    id: "sl_" + nowMs,
    empId: emp.id,
    startDate: sNorm,
    endDate: eNorm,
    category: category || "Urlaub - bezahlt",
    reason: reason || "",
    status: isSick ? "approved" : "pending",
    plannerUnreadInfo: true,
    reviewedBy: "",
    reviewedAt: ""
  };
  sickLeaves.unshift(newLeave);
  if (isSick) {
    window.generateCoveragePromptForLeave(newLeave, "pending");
  }
  addHistoryLog(fullName(emp) + " hat " + (category || "Antrag") + " (" + formatDateDe(sNorm) + " - " + formatDateDe(eNorm) + ") eingereicht", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  return true;
};

window.applyForCoverageDay = function(covId, dateIso, empId) {
  const cov = (leaveRequests || []).find(r => r.id === covId);
  const emp = employees.find(e => e.id === empId);
  const normDate = window.normalizeDateIso(dateIso);
  if (!cov || !emp || !normDate) return false;
  const dayObj = (cov.days || []).find(d => window.normalizeDateIso(d.date) === normDate && !d.takenBy && d.dayStatus === "open" && d.explicitlyApproved);
  if (!dayObj) return false;

  if (extraShifts.some(es => es.empId === emp.id && window.normalizeDateIso(es.date) === normDate && es.status !== "rejected")) return false;
  const check = window.checkExtraShiftPlausibility(emp.id, normDate, dayObj.shift);
  if (!check.ok && !dayObj.allowWithRestWarning) return false;

  const probTxt = cov.probableLines ? (" · " + cov.probableLines) : "";
  extraShifts.push({
    id: "es_" + Date.now(),
    empId: emp.id,
    date: normDate,
    shift: dayObj.shift,
    note: "Ersatzbedarf (" + (cov.role || "Mitarbeiter") + ")" + probTxt,
    coverageId: cov.id,
    plausibilityWarning: !check.ok,
    isNightShiftConflict: !!check.isNightShiftConflict,
    conflictDetails: (!check.ok && check.reason) ? window.formatConflictForPlanner(check.reason, fullName(emp)) : "",
    plannerUnreadInfo: true,
    status: "pending"
  });
  addHistoryLog(fullName(emp) + " meldet sich für gesuchte Bringschicht am " + formatDateDe(normDate), "ABSENCE");
  saveToFirebase();
  return true;
};

function isExtraShiftInActiveWindow(es, nowObj) {
  if (!es || es.status !== "approved" || !es.date || !es.shift) return false;
  const now = nowObj || new Date();
  const p = String(es.date).split("-");
  if (p.length !== 3) return false;
  const y = Number(p[0]), m = Number(p[1]) - 1, d = Number(p[2]);

  let startHour = 6, endHour = 14;
  if (es.shift === "spaet") { startHour = 14; endHour = 22; }
  else if (es.shift === "nacht") { startHour = 22; endHour = 30; }

  return now >= new Date(y, m, d, startHour - 1, 0, 0) && now < new Date(y, m, d, endHour, 0, 0);
}

window.syncAbsentAndExtraZones = function() {
  if (!hasLoadedFromCloud) return false;
  const now = new Date();
  const prodToday = getLogicalDateIso(now);
  const calToday = getTodayIso(now);
  let changed = false;

  employees.forEach(emp => {
    let activeLeave = getActiveLeaveForEmpOnDate(emp.id, prodToday) || getActiveLeaveForEmpOnDate(emp.id, calToday);

    if (activeLeave) {
      if (emp.zone !== "absent") { emp.zone = "absent"; changed = true; }
      return;
    } else if (emp.zone === "absent") {
      emp.zone = "pool"; changed = true;
    }

    const activeExtra = extraShifts.find(es =>
      es.empId === emp.id &&
      es.status === "approved" &&
      (window.normalizeDateIso(es.date) === prodToday || isExtraShiftInActiveWindow(es, now))
    );
    if (activeExtra && emp.zone === "pool") {
      emp.zone = "extra"; changed = true;
    } else if (!activeExtra && emp.zone === "extra") {
      emp.zone = "pool"; changed = true;
    }
  });

  return changed;
};

/* ==========================================================================
   4. ROLLEN-STEUERUNG, EINSATZ-GEDÄCHTNIS & QUALIFIKATIONS-STUNDENZÄHLER
   ========================================================================== */

window.doesRoleRequireLines = function(roleName) {
  if (shiftModelConfig && shiftModelConfig.roleRequiresLines && typeof shiftModelConfig.roleRequiresLines[roleName] === "boolean") {
    return shiftModelConfig.roleRequiresLines[roleName];
  }
  const rLow = String(roleName || "").toLowerCase();
  return !(rLow.indexOf("schichtexperte") !== -1 || rLow === "tl" || rLow.indexOf("teamleiter") !== -1 || rLow.indexOf("waschraum") !== -1);
};

window.canRoleBeAssignedToLine = function(roleName) {
  if (shiftModelConfig && shiftModelConfig.roleAllowLineAssign && typeof shiftModelConfig.roleAllowLineAssign[roleName] === "boolean") {
    return shiftModelConfig.roleAllowLineAssign[roleName];
  }
  const rLow = String(roleName || "").toLowerCase();
  return !(rLow.indexOf("schichtexperte") !== -1 || rLow === "tl" || rLow.indexOf("teamleiter") !== -1 || rLow.indexOf("waschraum") !== -1);
};

function trackEmployeeLineAssignment(emp, lineId, dateIso) {
  if (!emp || !lineId) return;
  const dIso = dateIso || getLogicalDateIso();
  if (!emp.lineHistory) emp.lineHistory = {};
  if (!emp.lineAssignCounts) emp.lineAssignCounts = {};

  if (emp.lineHistory[lineId] !== dIso) {
    emp.lineAssignCounts[lineId] = (emp.lineAssignCounts[lineId] || 0) + 1;
    const isMain = Array.isArray(emp.mainLines) && emp.mainLines.indexOf(lineId) !== -1;
    if (!isMain) {
      emp.foreignAssignCount = (emp.foreignAssignCount || 0) + 1;
      const isSec = Array.isArray(emp.secLines) && emp.secLines.indexOf(lineId) !== -1;
      if (!isSec) emp.lastRotationLearnDate = dIso;
    }
  }
  emp.lineHistory[lineId] = dIso;
}

window.recordManualAssignmentHours = function(empId, lineId, plannedHours, skipSave) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  const todayKey = getLogicalDateIso();
  trackEmployeeLineAssignment(emp, lineId, todayKey);

  if (!window.doesRoleRequireLines(emp.role) || !window.canRoleBeAssignedToLine(emp.role)) return;

  const isMain = Array.isArray(emp.mainLines) && emp.mainLines.indexOf(lineId) !== -1;
  const isSec = Array.isArray(emp.secLines) && emp.secLines.indexOf(lineId) !== -1;
  if (isMain || isSec) return;

  const hours = parseFloat(plannedHours) || (shiftModelConfig && shiftModelConfig.defaultShiftHours) || 8;
  const minRequired = (shiftModelConfig && typeof shiftModelConfig.minDailyHoursForCounting === "number") ? shiftModelConfig.minDailyHoursForCounting : 6;
  if (hours < minRequired) return;

  if (!emp.trainingHoursByLine) emp.trainingHoursByLine = {};
  if (!emp.trainingCreditedDates) emp.trainingCreditedDates = {};

  const prevCredit = emp.trainingCreditedDates[todayKey];

  if (prevCredit && prevCredit.lineId === lineId) return;
  if (prevCredit && prevCredit.lineId && prevCredit.hours) {
    emp.trainingHoursByLine[prevCredit.lineId] = Math.max(0, (emp.trainingHoursByLine[prevCredit.lineId] || 0) - prevCredit.hours);
  }

  emp.trainingHoursByLine[lineId] = (emp.trainingHoursByLine[lineId] || 0) + hours;
  emp.trainingCreditedDates[todayKey] = { lineId: lineId, hours: hours };

  const accumulated = emp.trainingHoursByLine[lineId];
  const threshold = (shiftModelConfig && typeof shiftModelConfig.secondaryUnlockThresholdHours === "number") ? shiftModelConfig.secondaryUnlockThresholdHours : 120;

  if (accumulated >= threshold) {
    pendingSecLineUnlockData = { empId: emp.id, lineId: lineId };
    const textEl = document.getElementById("secLineUnlockText");
    if (textEl) {
      textEl.innerHTML = "<b>" + fullName(emp) + "</b> hat bereits <b>" + accumulated + " Stunden</b> (Schwellenwert: " + threshold + "h) an <b>" + getLineNameById(lineId) + "</b> absolviert.<br><br>Soll diese Anlage ab sofort als offizielle Sekundär-Anlage freigeschaltet werden?";
    }
    const modal = document.getElementById("secLineUnlockModal");
    if (modal) modal.style.display = "flex";
  }

  if (!skipSave) {
    saveToFirebase();
    renderUnqualifiedHoursOverview();
  }
};

window.confirmSecondaryLineUnlock = function() {
  if (!pendingSecLineUnlockData) return;
  const { empId, lineId } = pendingSecLineUnlockData;
  pendingSecLineUnlockData = null;
  window.closeModal("secLineUnlockModal");

  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  if (!Array.isArray(emp.secLines)) emp.secLines = [];
  if (emp.secLines.indexOf(lineId) === -1) {
    emp.secLines.push(lineId);
    addHistoryLog("Sekundär-Anlage freigeschaltet: " + getLineNameById(lineId) + " für " + fullName(emp), "EMP");
    saveToFirebase();
    renderEmployees();
    renderUnqualifiedHoursOverview();
    showToast("✅ " + getLineNameById(lineId) + " als Sekundär-Anlage für " + fullName(emp) + " freigeschaltet!");
  }
};

window.resetEmployeeTrainingHours = function(empId, lineId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp || !emp.trainingHoursByLine) return;
  const curHours = emp.trainingHoursByLine[lineId] || 0;
  const lineName = getLineNameById(lineId);
  if (!confirm("Möchten Sie die gesammelten Stunden (" + curHours + "h) von " + fullName(emp) + " an " + lineName + " wirklich auf 0 zurücksetzen?")) return;

  delete emp.trainingHoursByLine[lineId];
  if (emp.trainingCreditedDates) {
    Object.keys(emp.trainingCreditedDates).forEach(dKey => {
      if (emp.trainingCreditedDates[dKey] && emp.trainingCreditedDates[dKey].lineId === lineId) {
        delete emp.trainingCreditedDates[dKey];
      }
    });
  }

  addHistoryLog("Schulungsstunden zurückgesetzt: " + fullName(emp) + " an " + lineName + " (war " + curHours + "h)", "EMP");
  saveToFirebase();
  renderUnqualifiedHoursOverview();
  showToast("🔄 Stunden für " + fullName(emp) + " an " + lineName + " auf 0 zurückgesetzt");
};

function renderUnqualifiedHoursOverview() {
  const container = document.getElementById("unqualifiedHoursOverviewList");
  if (!container) return;

  const threshold = (shiftModelConfig && typeof shiftModelConfig.secondaryUnlockThresholdHours === "number") ? shiftModelConfig.secondaryUnlockThresholdHours : 120;
  const rows = [];

  employees.forEach(emp => {
    if (!emp.trainingHoursByLine) return;
    Object.entries(emp.trainingHoursByLine).forEach(([lineId, hours]) => {
      const isMain = Array.isArray(emp.mainLines) && emp.mainLines.indexOf(lineId) !== -1;
      const isSec = Array.isArray(emp.secLines) && emp.secLines.indexOf(lineId) !== -1;
      if (!isMain && !isSec && hours > 0) {
        const remaining = Math.max(0, threshold - hours);
        const pct = Math.min(100, Math.round((hours / threshold) * 100));
        rows.push(
          '<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #f1f5f9; gap:8px;">' +
            '<span><b>' + fullName(emp) + '</b> ➔ ' + getLineNameById(lineId) + ' <small style="color:#0284c7; font-weight:700;">(' + pct + '% Fokus)</small></span>' +
            '<span style="display:inline-flex; align-items:center; gap:6px;">' +
              '<span>' + hours + 'h / ' + threshold + 'h (noch ' + remaining + 'h)</span>' +
              '<button type="button" class="btn btn-outline" style="padding:1px 6px; font-size:0.68rem; color:#dc2626; border-color:#fca5a5;" onclick="resetEmployeeTrainingHours(\'' + emp.id + '\', \'' + lineId + '\')" title="Gesammelte Stunden für diesen Mitarbeiter an dieser Linie auf 0 zurücksetzen">🔄 Reset</button>' +
            '</span>' +
          '</div>'
        );
      }
    });
  });

  container.innerHTML = rows.length > 0
    ? rows.join("")
    : '<span style="color:#64748b;">Aktuell keine Mitarbeiter in offener Einarbeitung an Fremdanlagen.</span>';
}

/* ==========================================================================
   5. STRATEGISCHE QUALIFIKATIONS- & ROTATIONS-MATRIX (INKL. STAMM-SCHUTZ)
   ========================================================================== */

function createBoardSnapshotForUndo() {
  return employees.map(e => ({
    id: e.id,
    zone: e.zone,
    pinnedZone: e.pinnedZone,
    lastShiftId: e.lastShiftId
  }));
}

function activateUndoButtons(shiftId) {
  const undoBtn = document.getElementById("btnUndoAutoAssignHeader");
  if (undoBtn) undoBtn.classList.add("has-undo");
  if (shiftId) {
    const miniUndo = document.getElementById("undoBtn_" + shiftId);
    if (miniUndo) miniUndo.classList.add("has-undo");
  }
}

window.undoLastAutoAssignment = function() {
  if (!lastBoardSnapshotForUndo) {
    showToast("Kein vorheriger Zustand zum Zurückkorrigieren vorhanden", true);
    return;
  }
  lastBoardSnapshotForUndo.forEach(snap => {
    const emp = employees.find(e => e.id === snap.id);
    if (emp) {
      emp.zone = snap.zone;
      emp.pinnedZone = snap.pinnedZone;
      emp.lastShiftId = snap.lastShiftId;
    }
  });
  lastBoardSnapshotForUndo = null;
  const undoBtn = document.getElementById("btnUndoAutoAssignHeader");
  if (undoBtn) undoBtn.classList.remove("has-undo");
  document.querySelectorAll(".shift-undo-mini-btn").forEach(b => b.classList.remove("has-undo"));

  saveToFirebase();
  window.initBoard();
  addHistoryLog("Letzte Schicht-Zuweisung per 'Zurück korrigieren' widerrufen", "AUTO");
  showToast("↩️ Änderungen erfolgreich zurückkorrigiert!");
};

function compareSecondaryFairness(empA, empB, lineId, todayIso) {
  if (shiftModelConfig.fairnessBalanceEnabled === false) return 0;
  const lastA = (empA.lineHistory && empA.lineHistory[lineId]) ? empA.lineHistory[lineId] : "2000-01-01";
  const lastB = (empB.lineHistory && empB.lineHistory[lineId]) ? empB.lineHistory[lineId] : "2000-01-01";
  if (lastA !== lastB) return lastA < lastB ? -1 : 1;

  const cntLineA = (empA.lineAssignCounts && empA.lineAssignCounts[lineId]) || 0;
  const cntLineB = (empB.lineAssignCounts && empB.lineAssignCounts[lineId]) || 0;
  if (cntLineA !== cntLineB) return cntLineA - cntLineB;

  return (empA.foreignAssignCount || 0) - (empB.foreignAssignCount || 0);
}

function getActiveFocusLineHours(emp, lineId) {
  if (!emp || !emp.trainingHoursByLine) return 0;
  const isMain = Array.isArray(emp.mainLines) && emp.mainLines.indexOf(lineId) !== -1;
  const isSec = Array.isArray(emp.secLines) && emp.secLines.indexOf(lineId) !== -1;
  if (isMain || isSec) return 0;
  const h = Number(emp.trainingHoursByLine[lineId] || 0);
  const threshold = Number(shiftModelConfig.secondaryUnlockThresholdHours || 120);
  return (h > 0 && h < threshold) ? h : 0;
}

function isEmpDueForRotationLearning(emp, todayIso) {
  if (window.shouldHoldEmpOnMainLineToday(emp, todayIso)) return false;
  const cycleMonths = Number(shiftModelConfig.rotationCycleMonths || 0);
  if (cycleMonths <= 0) return false;
  const secCount = Array.isArray(emp.secLines) ? emp.secLines.length : 0;
  if (secCount >= 3) return false;
  const cycleDays = cycleMonths * 30;
  const lastLearn = emp.lastRotationLearnDate || "2000-01-01";
  return daysBetweenIso(lastLearn, todayIso) >= cycleDays;
}

window.smartAssignShiftSlot = function(shiftId, silentBatch) {
  if (shiftModelConfig.smartAssignEnabled === false) {
    if (!silentBatch) showToast("Auto-Zuweisung ist ausgeschaltet!", true);
    return;
  }

  const todayIso = getLogicalDateIso();
  if (isIsoDateSunday(todayIso)) {
    if (!silentBatch) showToast("☀️ Sonntag ist regulär schichtfrei", false);
    return;
  }

  if (!lastBoardSnapshotForUndo) {
    lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
  }
  activateUndoButtons(shiftId);

  const teamKey = shiftRotation[shiftId];
  const activeLines = lines.filter(l => !l.ausgeplant);

  employees.forEach(emp => {
    if (extractShiftIdFromZone(emp.zone) === shiftId && !isEmpAnchorActiveToday(emp, todayIso)) {
      emp.zone = "pool";
    }
  });

  const slotCandidates = employees.filter(emp => {
    if (emp.zone === "absent") return false;
    if (getActiveLeaveForEmpOnDate(emp.id, todayIso)) return false;
    if (emp.noRotation && isEmpAnchorActiveToday(emp, todayIso)) return false;
    if (!window.canRoleBeAssignedToLine(emp.role || "Bediener")) return false;
    const isTeamMember = (emp.team === teamKey);
    const hasExtra = extraShifts.some(es => es.empId === emp.id && window.normalizeDateIso(es.date) === todayIso && es.shift === shiftId && es.status === "approved");
    return isTeamMember || hasExtra;
  });

  const getQualCount = (emp) => {
    const m = Array.isArray(emp.mainLines) ? emp.mainLines.length : 0;
    const s = Array.isArray(emp.secLines) ? emp.secLines.length : 0;
    return m + s;
  };
  slotCandidates.sort((a, b) => getQualCount(a) - getQualCount(b));

  const sortedLines = activeLines.slice().sort((a, b) => {
    const parsePrio = (pStr) => {
      const match = String(pStr || "").match(/\d+/);
      return match ? parseInt(match[0], 10) : 999;
    };
    return parsePrio(a.prio) - parsePrio(b.prio);
  });

  let assignedCount = 0;
  let swapCount = 0;
  let focusCount = 0;

  function isAvailableInPool(e) {
    return e.zone === "pool" || e.zone === "review" || e.zone === "extra";
  }

  function getLineEmps(lineId) {
    return employees.filter(e => extractLineIdFromZone(e.zone) === lineId && extractShiftIdFromZone(e.zone) === shiftId);
  }

  function isFloorTLCovered(floorName) {
    if (shiftModelConfig.smartRespectFloorTL === false) return false;
    return employees.some(e => {
      if (extractShiftIdFromZone(e.zone) !== shiftId || e.role !== "TL") return false;
      const lId = extractLineIdFromZone(e.zone);
      const lObj = lines.find(x => x.id === lId);
      return lObj && (lObj.floor || "1. OG") === (floorName || "1. OG");
    });
  }

  function getRoleDeficitForLine(line, roleName) {
    if (!window.canRoleBeAssignedToLine(roleName)) return 0;
    const rt = line.roleTargets || {};
    const roleSoll = Number(rt[roleName] || 0);
    if (roleSoll <= 0) return 0;
    const currentRoleCount = getLineEmps(line.id).filter(e => (e.role || "Bediener") === roleName).length;
    if (roleName === "TL" && currentRoleCount === 0 && isFloorTLCovered(line.floor)) {
      return 0;
    }
    return Math.max(0, roleSoll - currentRoleCount);
  }

  function placeEmpOnLine(emp, line, countTrainingHours) {
    emp.zone = line.id + "_" + shiftId;
    emp.pinnedZone = emp.zone;
    emp.lastShiftId = shiftId;
    trackEmployeeLineAssignment(emp, line.id, todayIso);
    if (countTrainingHours) {
      const defaultShiftHours = (shiftModelConfig && typeof shiftModelConfig.defaultShiftHours === "number") ? shiftModelConfig.defaultShiftHours : 8;
      window.recordManualAssignmentHours(emp.id, line.id, defaultShiftHours, true);
    }
    assignedCount++;
  }

  /* PHASE 0: Neu-Mitarbeiter mit aktivem Stamm-Schutz (z.B. 360 Tage / 90%) zuerst fest auf ihrer Stammlinie sichern */
  slotCandidates.filter(e => isAvailableInPool(e) && window.shouldHoldEmpOnMainLineToday(e, todayIso)).forEach(protectedEmp => {
    const rName = protectedEmp.role || "Bediener";
    const mainList = Array.isArray(protectedEmp.mainLines) ? protectedEmp.mainLines : [];
    const pinLineId = extractLineIdFromZone(protectedEmp.pinnedZone);
    const orderedIds = (pinLineId && mainList.indexOf(pinLineId) !== -1)
      ? [pinLineId].concat(mainList.filter(id => id !== pinLineId))
      : mainList.slice();

    for (let i = 0; i < orderedIds.length; i++) {
      const line = sortedLines.find(l => l.id === orderedIds[i]);
      if (line && getLineEmps(line.id).length < getLineTotalTarget(line) && getRoleDeficitForLine(line, rName) > 0) {
        placeEmpOnLine(protectedEmp, line, false);
        break;
      }
    }
  });

  /* PHASE 1: "Nur Stammmitarbeiter"-Linien (line.mainOnly) zuerst strikt mit Stammpersonal besetzen */
  sortedLines.filter(l => l.mainOnly).forEach(line => {
    const totalSoll = getLineTotalTarget(line);
    roles.forEach(rName => {
      while (getLineEmps(line.id).length < totalSoll && getRoleDeficitForLine(line, rName) > 0) {
        let cand = slotCandidates.find(e =>
          isAvailableInPool(e) &&
          (e.role || "Bediener") === rName &&
          extractLineIdFromZone(e.pinnedZone) === line.id &&
          Array.isArray(e.mainLines) && e.mainLines.indexOf(line.id) !== -1
        );
        if (!cand) {
          cand = slotCandidates.find(e =>
            isAvailableInPool(e) &&
            (e.role || "Bediener") === rName &&
            Array.isArray(e.mainLines) && e.mainLines.indexOf(line.id) !== -1
          );
        }
        if (!cand) break;
        placeEmpOnLine(cand, line, false);
      }
    });
  });

  /* PHASE 2: Reguläre Linien (nicht mainOnly) mit Fokus-Modus, Stammpersonal & fairer Sekundär-Balance besetzen */
  sortedLines.filter(l => !l.mainOnly).forEach(line => {
    const totalSoll = getLineTotalTarget(line);
    roles.forEach(rName => {
      while (getLineEmps(line.id).length < totalSoll && getRoleDeficitForLine(line, rName) > 0) {
        let cand = null;

        const existingTraineeOnLine = getLineEmps(line.id).some(e => getActiveFocusLineHours(e, line.id) > 0);
        if (shiftModelConfig.focusModeEnabled !== false && !existingTraineeOnLine && getLineEmps(line.id).length >= 1) {
          const focusCands = slotCandidates.filter(e =>
            isAvailableInPool(e) &&
            !window.shouldHoldEmpOnMainLineToday(e, todayIso) &&
            (e.role || "Bediener") === rName &&
            getActiveFocusLineHours(e, line.id) > 0
          ).sort((a, b) => getActiveFocusLineHours(b, line.id) - getActiveFocusLineHours(a, line.id));
          if (focusCands.length > 0) {
            cand = focusCands[0];
            focusCount++;
            placeEmpOnLine(cand, line, true);
            continue;
          }
        }

        cand = slotCandidates.find(e =>
          isAvailableInPool(e) &&
          (e.role || "Bediener") === rName &&
          extractLineIdFromZone(e.pinnedZone) === line.id &&
          Array.isArray(e.mainLines) && e.mainLines.indexOf(line.id) !== -1
        );

        if (!cand) {
          cand = slotCandidates.find(e =>
            isAvailableInPool(e) &&
            (e.role || "Bediener") === rName &&
            Array.isArray(e.mainLines) && e.mainLines.indexOf(line.id) !== -1
          );
        }

        if (!cand) {
          const secPool = slotCandidates.filter(e =>
            isAvailableInPool(e) &&
            !window.shouldHoldEmpOnMainLineToday(e, todayIso) &&
            (e.role || "Bediener") === rName &&
            Array.isArray(e.secLines) && e.secLines.indexOf(line.id) !== -1
          ).sort((a, b) => compareSecondaryFairness(a, b, line.id, todayIso));
          if (secPool.length > 0) cand = secPool[0];
        }

        if (!cand) break;
        placeEmpOnLine(cand, line, false);
      }
    });
  });

  /* PHASE 3: AUSNAHME-FALLBACK für "Nur Stammmitarbeiter"-Linien */
  sortedLines.filter(l => l.mainOnly).forEach(line => {
    const totalSoll = getLineTotalTarget(line);
    roles.forEach(rName => {
      while (getLineEmps(line.id).length < totalSoll && getRoleDeficitForLine(line, rName) > 0) {
        const secFallback = slotCandidates.filter(e =>
          isAvailableInPool(e) &&
          !window.shouldHoldEmpOnMainLineToday(e, todayIso) &&
          (e.role || "Bediener") === rName &&
          Array.isArray(e.secLines) && e.secLines.indexOf(line.id) !== -1
        ).sort((a, b) => compareSecondaryFairness(a, b, line.id, todayIso));
        if (!secFallback.length) break;
        placeEmpOnLine(secFallback[0], line, false);
      }
    });
  });

  /* PHASE 4: Intelligenter Ringtausch (Stamm-Schutz-Mitarbeiter werden nicht von ihrer Stammlinie wegrotiert) */
  if (shiftModelConfig.smartAllowSwap !== false) {
    const unplaced = slotCandidates.filter(isAvailableInPool);
    unplaced.forEach(cand => {
      const cRole = cand.role || "Bediener";
      const holdOnMain = window.shouldHoldEmpOnMainLineToday(cand, todayIso);
      const candLines = holdOnMain ? (cand.mainLines || []).slice() : [].concat(cand.mainLines || [], cand.secLines || []);
      for (let i = 0; i < candLines.length; i++) {
        const targetLine = sortedLines.find(l => l.id === candLines[i]);
        if (!targetLine) continue;

        const isCandMainOnTarget = Array.isArray(cand.mainLines) && cand.mainLines.indexOf(targetLine.id) !== -1;
        if (targetLine.mainOnly && !isCandMainOnTarget && getLineEmps(targetLine.id).length >= getLineTotalTarget(targetLine)) {
          continue;
        }

        if (getLineEmps(targetLine.id).length < getLineTotalTarget(targetLine) && getRoleDeficitForLine(targetLine, cRole) > 0) {
          placeEmpOnLine(cand, targetLine, false);
          break;
        }

        const currentRoleOccupants = getLineEmps(targetLine.id).filter(occ =>
          !occ.noRotation &&
          !window.shouldHoldEmpOnMainLineToday(occ, todayIso) &&
          (occ.role || "Bediener") === cRole
        );
        let swapped = false;

        for (let j = 0; j < currentRoleOccupants.length; j++) {
          const occ = currentRoleOccupants[j];
          const occAltLineIds = [].concat(occ.mainLines || [], occ.secLines || []).filter(id => id !== targetLine.id);
          occAltLineIds.sort((idA, idB) => {
            const lastA = (occ.lineHistory && occ.lineHistory[idA]) || "2000-01-01";
            const lastB = (occ.lineHistory && occ.lineHistory[idB]) || "2000-01-01";
            return lastA < lastB ? -1 : 1;
          });
          for (let k = 0; k < occAltLineIds.length; k++) {
            const altLine = sortedLines.find(l => l.id === occAltLineIds[k]);
            if (!altLine) continue;
            if (altLine.mainOnly && (!Array.isArray(occ.mainLines) || occ.mainLines.indexOf(altLine.id) === -1)) continue;
            if (getLineEmps(altLine.id).length < getLineTotalTarget(altLine) && getRoleDeficitForLine(altLine, cRole) > 0) {
              occ.zone = altLine.id + "_" + shiftId;
              occ.pinnedZone = occ.zone;
              trackEmployeeLineAssignment(occ, altLine.id, todayIso);
              placeEmpOnLine(cand, targetLine, false);
              swapCount++;
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

  /* PHASE 5: Förder-Zyklus (alle X Monate an neue Linien heranführen, außer Linie ist mainOnly oder Mitarbeiter im Stamm-Schutz) */
  sortedLines.filter(l => !l.mainOnly).forEach(line => {
    const totalSoll = getLineTotalTarget(line);
    roles.forEach(rName => {
      while (getLineEmps(line.id).length < totalSoll && getRoleDeficitForLine(line, rName) > 0) {
        let learner = slotCandidates.find(e =>
          isAvailableInPool(e) &&
          !window.shouldHoldEmpOnMainLineToday(e, todayIso) &&
          (e.role || "Bediener") === rName &&
          (getActiveFocusLineHours(e, line.id) > 0 || isEmpDueForRotationLearning(e, todayIso))
        );
        if (!learner) break;
        focusCount++;
        placeEmpOnLine(learner, line, true);
      }
    });
  });

  slotCandidates.forEach(cand => {
    if (isAvailableInPool(cand) && window.canRoleBeAssignedToLine(cand.role || "Bediener")) {
      cand.zone = "review";
    }
  });

  const swapInfo = swapCount > 0 ? (" · " + swapCount + " Ringtausch") : "";
  const focusInfo = focusCount > 0 ? (" · " + focusCount + " Förder/Fokus") : "";
  addHistoryLog("Auto-Zuweisung für " + (shiftsLabel[shiftId] || shiftId) + " (" + assignedCount + " zugewiesen" + swapInfo + focusInfo + ")", "AUTO");

  if (!silentBatch) {
    saveToFirebase();
    window.initBoard();
    showToast("🪄 Auto-Zuweisung " + (shiftsLabel[shiftId] || shiftId) + " fertig (" + assignedCount + " MA" + swapInfo + focusInfo + ")!");
  }
};

window.runAllShiftsAutoAssignment = function(silent) {
  lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
  activateUndoButtons();
  shifts.forEach(s => {
    smartAssignShiftSlot(s.id, true);
  });
  saveToFirebase();
  window.initBoard();
  if (!silent) showToast("🪄 Alle Schichten automatisch zugewiesen!");
};

/* ==========================================================================
   6. KUGELSICHERE 05:00-UHR-AUTOMATIK (INKL. CATCH-UP & 2-2-2 SONNTAG FREI)
   ========================================================================== */

function checkScheduledAutomations() {
  if (!hasLoadedFromCloud || isDraggingCard || isRunningAutoTransition) return false;
  const now = new Date();
  const prodTodayIso = getLogicalDateIso(now);
  const isSundayNow = isIsoDateSunday(prodTodayIso);
  const currentBlockIdx = getWorkdayBlockIndex(prodTodayIso);
  let didChange = false;

  isRunningAutoTransition = true;
  try {
    if (typeof shiftModelConfig.lastRotationBlockIndex !== "number") {
      shiftModelConfig.lastRotationBlockIndex = currentBlockIdx;
      didChange = true;
    }

    if (!isSundayNow && shiftModelConfig.autoRotate !== false && currentBlockIdx !== shiftModelConfig.lastRotationBlockIndex) {
      const blockDiff = currentBlockIdx - shiftModelConfig.lastRotationBlockIndex;
      const steps = ((blockDiff % 4) + 4) % 4;
      for (let i = 0; i < steps; i++) {
        window.performShiftRotationLogic(true);
      }
      shiftModelConfig.lastRotationBlockIndex = currentBlockIdx;
      addHistoryLog("Automatischer 2-2-2 Block-Wechsel (" + getBlockDayInfo(prodTodayIso).blockLabel + ") ausgeführt", "SHIFT");
      didChange = true;
    }

    if (shiftModelConfig.lastProcessedProductionDate !== prodTodayIso) {
      shiftModelConfig.lastProcessedProductionDate = prodTodayIso;

      if (isSundayNow) {
        employees.forEach(e => {
          if (e.zone && ["pool", "review", "absent", "extra"].indexOf(e.zone) === -1) {
            e.zone = "pool";
          }
        });
        window.syncAbsentAndExtraZones();
        addHistoryLog("Sonntags-Ruhe ab 05:00 Uhr aktiviert (Board in Pool geleert)", "SHIFT");
        didChange = true;
      } else {
        if (shiftModelConfig.resetEnabled !== false || shiftModelConfig.autoRotate !== false) {
          employees.forEach(e => {
            if (e.zone && ["pool", "review", "absent", "extra"].indexOf(e.zone) === -1 && !isEmpAnchorActiveToday(e, prodTodayIso)) {
              e.zone = "pool";
            }
          });
        }
        window.syncAbsentAndExtraZones();

        if (shiftModelConfig.smartAssignEnabled !== false) {
          lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
          shifts.forEach(s => {
            window.smartAssignShiftSlot(s.id, true);
          });
        } else if (shiftModelConfig.loadEnabled !== false) {
          ["frueh", "spaet", "nacht", "frei"].forEach(slot => {
            const tKey = shiftRotation[slot];
            if (tKey) distributeTeamToSlotInternal(tKey, slot);
          });
        }
        addHistoryLog("Tages-Automatik (05:00 Uhr / Catch-Up) für " + formatDateDe(prodTodayIso) + " ausgeführt", "AUTO");
        didChange = true;
      }
    }

    const activeShiftWindowKey = prodTodayIso + "_" + getCurrentActiveShiftId(now);
    if (shiftModelConfig.lastActiveShiftWindowKey !== activeShiftWindowKey) {
      shiftModelConfig.lastActiveShiftWindowKey = activeShiftWindowKey;
      window.syncAbsentAndExtraZones();
      window.updateShiftApprovalUI();
      didChange = true;
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

window.syncCurrentBoardAs222Anchor = function() {
  const prodTodayIso = getLogicalDateIso();
  shiftModelConfig.lastRotationBlockIndex = getWorkdayBlockIndex(prodTodayIso);
  shiftModelConfig.lastProcessedProductionDate = prodTodayIso;
  if (!isIsoDateSunday(prodTodayIso) && shiftModelConfig.smartAssignEnabled !== false) {
    lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
    shifts.forEach(s => {
      window.smartAssignShiftSlot(s.id, true);
    });
  }
  saveToFirebase();
  window.initBoard();
  const bInfo = getBlockDayInfo(prodTodayIso);
  addHistoryLog("2-2-2 Start-Anker auf heute (" + bInfo.blockLabel + ") synchronisiert", "SHIFT");
  showToast("✅ 2-2-2 Anker für " + bInfo.blockLabel + " gespeichert & Schichten aktualisiert!");
};

setInterval(() => {
  if (!hasLoadedFromCloud || isDraggingCard) return;
  window.updateHeaderDateKw();
  window.updateShiftApprovalUI();
  const autoChanged = checkScheduledAutomations();
  if (!autoChanged) {
    const zChanged = window.syncAbsentAndExtraZones();
    if (zChanged) {
      saveToFirebase();
      renderEmployees();
    }
  }

  if (isPlanner) {
    const maxMs = (Number(securityConfig.plannerTimeoutMin) || 180) * 60000;
    if (Date.now() - planerLastActivityTime > maxMs) {
      window.logoutPlanner();
      showToast("Automatisch abgemeldet (Zeitüberschreitung)", true);
    }
  }
}, 30000);

/* ==========================================================================
   7. INIT BOARD & KARTEN RENDERING (INKL. STAMM-BADGE & ROTES +EH)
   ========================================================================== */

function getLineTotalTarget(line) {
  if (!line || !line.roleTargets) return 3;
  const sum = Object.values(line.roleTargets).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
  return sum > 0 ? sum : 3;
}

function getLineRoleSummaryText(line) {
  const rt = line.roleTargets || {};
  const parts = [];
  roles.forEach(r => {
    const cnt = Number(rt[r] || 0);
    if (cnt > 0) {
      const shortR = r === "Bediener" ? "Bed." : (r === "Schichtexperte" ? "SE" : (r === "Waschraumoperator" ? "WRO" : r));
      parts.push(cnt + " " + shortR);
    }
  });
  return parts.length ? parts.join(" · ") : "Bediener, LOP";
}

window.initBoard = function() {
  if (isDraggingCard) return;
  injectModernSaaSStyles();
  window.sanitizeTeamReferences();
  window.syncAbsentAndExtraZones();
  window.updateHeaderDateKw();
  window.updateShiftApprovalUI();
  window.updateAutoRotationUI();
  window.checkBoardLockState();

  const headerRow = document.getElementById("headerRow");
  if (!headerRow) return;
  if (!Array.isArray(lines) || !lines.length) lines = defaultLines.slice();

  headerRow.innerHTML =
    '<th class="shift-header">' +
      '<div>Schicht</div>' +
      '<div class="shift-controls">' +
        '<button class="shift-rotate-btn" onclick="rotateAllShifts()"><span>🔄 Rotieren</span></button>' +
        '<button class="shift-auto-btn" onclick="runAllShiftsAutoAssignment()"><span>🪄 Alle Auto</span></button>' +
        '<button class="shift-clear-btn" onclick="clearEntireBoard()">🧹 Alle leeren</button>' +
      '</div>' +
    '</th>';

  lines.forEach(line => {
    if (!line.roleTargets) line.roleTargets = { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 };
    if (!line.floor) line.floor = "1. OG";

    const th = document.createElement("th");
    th.className = "line-header" + (line.ausgeplant ? " ausgeplant" : "");
    if (isPlanner && plannerLevel > 2) {
      th.onclick = () => { window.openLineEditModal(line.id); };
    }
    const safeNote = (line.note || "").replace(/"/g, "&quot;");
    const roleSumText = getLineRoleSummaryText(line);
    const totalSoll = getLineTotalTarget(line);

    let prioBadgeHtml = "";
    if (line.prio) {
      const pLow = String(line.prio).toLowerCase();
      const pCls = (pLow.indexOf("1") !== -1 || pLow.indexOf("2") !== -1) ? "prio-high" : "prio-mid";
      prioBadgeHtml = '<span class="line-prio ' + pCls + '">' + line.prio + '</span>';
    }
    const mainOnlyBadgeHtml = (isPlanner && line.mainOnly)
      ? '<span class="line-mainonly-tag" title="Nur Stammmitarbeiter (Ausnahme bei Personalmangel)">🛡️ Nur Stamm</span>'
      : '';

    th.innerHTML =
      '<span class="line-floor-corner">' + line.floor + '</span>' +
      '<div class="line-title-row">' +
        '<span class="line-title" title="' + line.name + '">' + line.name + '</span>' +
      '</div>' +
      '<div class="badge-container">' +
        (line.ausgeplant ? '<span class="line-ausgeplant-tag">🚫 Ausgeplant</span>' : '') +
        prioBadgeHtml +
        mainOnlyBadgeHtml +
        (line.tag ? '<span class="line-status-tag">' + line.tag + '</span>' : '') +
      '</div>' +
      '<div class="line-role-summary-tag" title="Soll-Rollen: ' + roleSumText + ' (Σ ' + totalSoll + ')">' + roleSumText + ' (Σ ' + totalSoll + ')</div>' +
      (line.note ? '<div class="line-notes" title="' + safeNote + '">' + line.note + '</div>' : '');
    headerRow.appendChild(th);
  });

  const matrixBody = document.getElementById("matrixBody");
  matrixBody.innerHTML = "";
  const keys = Object.keys(teamsConfig).sort();
  const sundayFree = isSundayDaytimeFree();
  const activeShiftIdNow = getCurrentActiveShiftId();

  shifts.forEach(shift => {
    const curKey = shiftRotation[shift.id] || keys[0];
    const curObj = teamsConfig[curKey] || { name: "Team", color: "#0091df" };
    const opts = keys.map(k => '<option value="' + k + '" style="color:' + teamsConfig[k].color + '; font-weight:700;" ' + (k === curKey ? 'selected' : '') + '>■ ' + teamsConfig[k].name + '</option>').join("");
    const sunBadge = sundayFree
      ? '<div style="font-size:0.6rem; color:#0284c7; background:#e0f2fe; padding:1px 5px; border-radius:4px; margin-top:2px;">☀️ So. Frei</div>'
      : (shift.id === activeShiftIdNow ? '<div style="font-size:0.6rem; color:#15803d; background:#dcfce7; padding:1px 5px; border-radius:4px; margin-top:2px;">🟢 Aktiv (1h Vorlauf)</div>' : '');
    const hasUndoCls = lastBoardSnapshotForUndo ? " has-undo" : "";

    const tr = document.createElement("tr");
    const thS = document.createElement("th");
    thS.className = "shift-header";
    thS.innerHTML =
      '<div>' + shift.name + '</div>' + sunBadge +
      '<div class="shift-team-badge" style="border-left:3px solid ' + curObj.color + ';"><span style="color:' + curObj.color + ';">■</span> ' + curObj.name + '</div>' +
      '<div class="shift-kpi-row" id="kpiRow_' + shift.id + '"></div>' +
      '<div class="shift-controls">' +
        '<div class="shift-load-row">' +
          '<select id="teamSelect_' + shift.id + '" class="shift-team-select" title="' + curObj.name + '" style="border-left:4px solid ' + curObj.color + '; color:' + curObj.color + ';" onchange="onShiftTeamDropdownChange(\'' + shift.id + '\', this)">' + opts + '</select>' +
          '<button class="shift-load-btn" onclick="loadTeamToShift(\'' + shift.id + '\')" title="Team laden">📥</button>' +
          '<button class="shift-magic-btn" onclick="smartAssignShiftSlot(\'' + shift.id + '\')" title="Intelligente Auto-Zuweisung">🪄</button>' +
        '</div>' +
        '<button class="shift-undo-mini-btn' + hasUndoCls + '" id="undoBtn_' + shift.id + '" onclick="undoLastAutoAssignment()">↩️ Rückgängig</button>' +
        '<button class="shift-clear-btn" onclick="clearShiftRow(\'' + shift.id + '\')">🧹 Leeren</button>' +
      '</div>';
    tr.appendChild(thS);

    lines.forEach(line => {
      const td = document.createElement("td");
      const zId = line.id + "_" + shift.id;
      const isOff = sundayFree || line.ausgeplant;
      td.innerHTML =
        '<div class="cell-wrapper">' +
          '<div id="bar_' + zId + '" class="zone-staff-bar"><span>0/3</span><span class="zone-missing-roles"></span></div>' +
          '<div id="' + zId + '" class="card-list drop-zone" data-zone="' + zId + '"' + (isOff ? ' style="background:#f1f5f9; opacity:0.72;"' : '') + '></div>' +
        '</div>';
      tr.appendChild(td);
    });
    matrixBody.appendChild(tr);
  });

  applyTeamStyles();
  updateTeamDropdowns();
  renderTeamFilterCheckboxes();
  renderRoleFilterCheckboxes();
  renderEmployees();
  initDragAndDrop();
  renderSettingsLists();
  window.updateInboxBadge();
  renderUnqualifiedHoursOverview();
  if (typeof window.syncShiftModelSettingsUI === "function") window.syncShiftModelSettingsUI();
  if (typeof syncSecurityConfigUI === "function") syncSecurityConfigUI();
};

function renderEmployees() {
  if (isDraggingCard) return;
  const dropZones = document.querySelectorAll(".drop-zone");
  if (!dropZones.length) return;
  dropZones.forEach(el => { el.innerHTML = ""; });

  const cellStats = {};
  const floorTLMap = {};
  const shiftStats = {
    frueh: { assigned: 0, target: 0, eh: 0 },
    spaet: { assigned: 0, target: 0, eh: 0 },
    nacht: { assigned: 0, target: 0, eh: 0 }
  };

  lines.forEach(l => {
    const totalSoll = getLineTotalTarget(l);
    shifts.forEach(s => {
      cellStats[l.id + "_" + s.id] = { count: 0, roles: {} };
      if (!l.ausgeplant) shiftStats[s.id].target += totalSoll;
    });
  });

  const todayIso = getLogicalDateIso();

  employees.forEach(emp => {
    const fName = fullName(emp);
    const pinNum = emp.pinnedZone ? getShortLineNumber(emp.pinnedZone) : "";
    const mainNums = Array.isArray(emp.mainLines) ? emp.mainLines.map(getShortLineNumber).filter(Boolean).join(", ") : "";
    const secNums = Array.isArray(emp.secLines) ? emp.secLines.map(getShortLineNumber).filter(Boolean).join(", ") : "";

    const zId = emp.zone;
    if (cellStats[zId]) {
      cellStats[zId].count++;
      const rName = emp.role || "Bediener";
      cellStats[zId].roles[rName] = (cellStats[zId].roles[rName] || 0) + 1;

      const sId = extractShiftIdFromZone(zId);
      const lId = extractLineIdFromZone(zId);
      if (sId && shiftStats[sId]) {
        shiftStats[sId].assigned++;
        if (emp.ersthelfer) shiftStats[sId].eh++;
      }
      if (rName === "TL" && sId && lId) {
        const lineObj = lines.find(x => x.id === lId);
        if (lineObj) floorTLMap[sId + "_" + (lineObj.floor || "1. OG")] = true;
      }
    }

    if (isPlanner && emp.zone === "pool") {
      if (activeTeamFilters[emp.team] === false || activeRoleFilters[emp.role] === false) return;
      if (poolSearchQuery) {
        const haystack = (fName + " " + (emp.role || "") + " " + pinNum + " " + mainNums + " " + secNums).toLowerCase();
        if (haystack.indexOf(poolSearchQuery) === -1) return;
      }
    }

    const teamObj = teamsConfig[emp.team] || { name: "Team", color: "#0091df" };
    const card = document.createElement("div");
    card.className = "employee-card" + (emp.pinnedZone ? " pinned" : "");
    card.setAttribute("data-id", emp.id);
    card.setAttribute("data-team", emp.team || "");
    card.style.borderLeft = "4px solid " + (teamObj.color || "#0091df");

    const ersthelferHtml = emp.ersthelfer ? '<span class="ersthelfer-plus" title="Ersthelfer">+</span>' : '';
    const fixTagHtml = emp.noRotation ? '<span class="card-fix-tag" title="Anker / Feste Schicht">⚓ Fix</span>' : '';
    const protInfo = window.getEmpTrainingProtectionInfo(emp, todayIso);
    const traineeTagHtml = protInfo.active
      ? '<span class="card-trainee-tag" title="Stamm-Schutz aktiv: ' + protInfo.mainPct + '% Stammlinie (noch ' + protInfo.remainingDays + ' Tage)">🛡️ ' + protInfo.mainPct + '%</span>'
      : '';

    let qualWarnHtml = "";
    const lineIdPure = extractLineIdFromZone(emp.zone);
    if (lineIdPure && !emp.noRotation) {
      const isMain = Array.isArray(emp.mainLines) && emp.mainLines.indexOf(lineIdPure) !== -1;
      const isSec = Array.isArray(emp.secLines) && emp.secLines.indexOf(lineIdPure) !== -1;
      const focusH = getActiveFocusLineHours(emp, lineIdPure);
      const threshold = Number(shiftModelConfig.secondaryUnlockThresholdHours || 120);
      if (focusH > 0) {
        qualWarnHtml = '<span class="card-qual-warn" style="color:#0284c7; font-weight:700;" title="🎯 Fokus-Einarbeitung: ' + focusH + 'h / ' + threshold + 'h gesammelt (noch ' + Math.max(0, threshold - focusH) + 'h bis Freischaltung)">🎯 ' + focusH + 'h</span>';
      } else if (!isMain && !isSec && extractLineIdFromZone(emp.pinnedZone) !== lineIdPure) {
        qualWarnHtml = '<span class="card-qual-warn" title="⚠️ Linie nicht in Qualifikation hinterlegt!">⚠️</span>';
      }
    }

    let rightMetaHtml = "";
    const isInSidebar = (!emp.zone || ["pool", "review", "extra", "absent"].indexOf(emp.zone) !== -1);

    if (emp.pinnedZone && pinNum) {
      const removeXHtml = isInSidebar
        ? '<span class="pin-remove-x" title="PIN-Nadel löschen" onclick="clickPinButton(\'' + emp.id + '\', event)">✕</span>'
        : '';
      rightMetaHtml = '<div class="card-pin-info" title="Gespeicherte Linie ' + pinNum + '"><span>📌 ' + pinNum + '</span>' + removeXHtml + '</div>';
    } else if (isInSidebar && mainNums) {
      rightMetaHtml = '<span class="card-prio-hint" title="Stammlinie">Prio: ' + mainNums + '</span>';
    }

    card.innerHTML =
      ersthelferHtml +
      '<div class="card-name" title="' + fName + '">' + fName + '</div>' +
      '<div class="card-bottom-row">' +
        '<div class="card-badges-left">' +
          '<span class="card-role">' + (emp.role || "Bediener") + '</span>' +
          fixTagHtml +
          traineeTagHtml +
          qualWarnHtml +
        '</div>' +
        rightMetaHtml +
      '</div>';

    let targetZone = document.getElementById(emp.zone);
    if (!targetZone) {
      emp.zone = "pool";
      targetZone = document.getElementById("pool");
    }
    if (targetZone) targetZone.appendChild(card);
  });

  lines.forEach(line => {
    const totalSoll = getLineTotalTarget(line);
    shifts.forEach(shift => {
      const zId = line.id + "_" + shift.id;
      const barEl = document.getElementById("bar_" + zId);
      if (!barEl) return;
      if (line.ausgeplant) {
        barEl.className = "zone-staff-bar status-off";
        barEl.innerHTML = '<span>Ausgeplant</span><span></span>';
        return;
      }
      const st = cellStats[zId] || { count: 0, roles: {} };
      const rTargets = line.roleTargets || {};
      const missingRolesList = [];
      let tlSharedViaFloor = false;

      roles.forEach(r => {
        const req = Number(rTargets[r] || 0);
        if (req > 0) {
          const have = Number(st.roles[r] || 0);
          if (have < req) {
            if (r === "TL" && shiftModelConfig.smartRespectFloorTL !== false && floorTLMap[shift.id + "_" + (line.floor || "1. OG")]) {
              tlSharedViaFloor = true;
            } else {
              const shortR = r === "Bediener" ? "Bed." : (r === "Schichtexperte" ? "SE" : (r === "Waschraumoperator" ? "WRO" : r));
              missingRolesList.push("-" + (req - have) + " " + shortR);
            }
          }
        }
      });

      let statusCls = "status-ok";
      if (st.count < totalSoll || missingRolesList.length > 0) statusCls = "status-missing";
      else if (st.count > totalSoll) statusCls = "status-over";

      barEl.className = "zone-staff-bar " + statusCls;
      const countTxt = st.count + "/" + totalSoll + (st.count >= totalSoll && missingRolesList.length === 0 ? " ✓" : "");
      let rightRoleTxt = missingRolesList.length > 0 ? missingRolesList.join(", ") : (tlSharedViaFloor ? ("🔗 TL " + (line.floor || "1. OG")) : "");

      barEl.innerHTML = '<span>' + countTxt + '</span><span class="zone-missing-roles" title="' + rightRoleTxt + '">' + rightRoleTxt + '</span>';
    });
  });

  shifts.forEach(shift => {
    const kpiEl = document.getElementById("kpiRow_" + shift.id);
    if (!kpiEl) return;
    const sStat = shiftStats[shift.id];
    const staffOk = sStat.assigned >= sStat.target;
    const ehOk = sStat.eh >= 1;
    kpiEl.innerHTML =
      '<span class="shift-kpi-pill ' + (staffOk ? 'ok' : 'warn') + '" title="Eingeteilt / Gesamt-Soll">👥 ' + sStat.assigned + '/' + sStat.target + '</span>' +
      '<span class="shift-kpi-pill ' + (ehOk ? 'ok' : 'warn eh-zero') + '" title="Ersthelfer in dieser Schicht"><span class="eh-plus-icon">+</span> ' + sStat.eh + ' EH</span>';
  });

  const pEl = document.getElementById("pool");
  const revEl = document.getElementById("review");
  const revWrap = document.getElementById("reviewPanelWrap");
  const eEl = document.getElementById("extra");
  const aEl = document.getElementById("absent");

  const revCount = revEl ? revEl.children.length : 0;
  if (document.getElementById("reviewCount")) document.getElementById("reviewCount").textContent = "(" + revCount + ")";
  if (revWrap) revWrap.classList.toggle("empty-review", revCount === 0);

  if (document.getElementById("poolCount")) document.getElementById("poolCount").textContent = "(" + (pEl ? pEl.children.length : 0) + ")";
  if (document.getElementById("extraCount")) document.getElementById("extraCount").textContent = "(" + (eEl ? eEl.children.length : 0) + ")";
  if (document.getElementById("absentCount")) document.getElementById("absentCount").textContent = "(" + (aEl ? aEl.children.length : 0) + ")";

  renderSidebarExtraPreview();
}

window.moveAllReviewToPool = function() {
  let count = 0;
  employees.forEach(e => {
    if (e.zone === "review") { e.zone = "pool"; count++; }
  });
  saveToFirebase();
  renderEmployees();
  showToast(count + " Mitarbeiter aus 'Noch zuzuteilen' in den Pool verschoben");
};

function renderSidebarExtraPreview() {
  const box = document.getElementById("approvedExtraList");
  if (!box) return;
  const todayIso = getLogicalDateIso();
  const upcoming = extraShifts.filter(es => es.status === "approved" && window.normalizeDateIso(es.date) >= todayIso).slice(0, 5);
  if (!upcoming.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = upcoming.map(es => {
    const emp = employees.find(e => e.id === es.empId);
    const name = emp ? fullName(emp) : "Mitarbeiter";
    return '<div style="padding:3px 6px; color:#166534; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + name + ' · ' + formatDateDe(es.date) + ' (' + (shiftsShortLabel[es.shift] || es.shift) + ')">⏰ <b>' + name + '</b>: ' + formatDateDe(es.date).slice(0, 6) + ' (' + (shiftsShortLabel[es.shift] || es.shift) + ')</div>';
  }).join("");
}

window.clickPinButton = function(empId, evt) {
  if (evt) { evt.stopPropagation(); evt.preventDefault(); }
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  emp.pinnedZone = null;
  addHistoryLog("PIN-Nadel für " + fullName(emp) + " entfernt", "LOGIN");
  saveToFirebase();
  renderEmployees();
  showToast("PIN-Nadel für " + fullName(emp) + " entfernt");
};

function initDragAndDrop() {
  sortableInstances.forEach(s => s.destroy());
  sortableInstances = [];
  document.querySelectorAll(".drop-zone").forEach(zone => {
    sortableInstances.push(new Sortable(zone, {
      group: "shared-shifts",
      animation: 150,
      disabled: !isPlanner,
      filter: ".pin-remove-x",
      preventOnFilter: false,
      onStart: () => { isDraggingCard = true; },
      onEnd: evt => {
        isDraggingCard = false;
        const empId = evt.item.getAttribute("data-id");
        const newZone = evt.to.getAttribute("data-zone");
        const emp = employees.find(e => e.id === empId);
        if (emp && newZone) {
          emp.zone = newZone;
          if (["pool", "review", "absent", "extra"].indexOf(newZone) === -1) {
            emp.pinnedZone = newZone;
            emp.lastShiftId = extractShiftIdFromZone(newZone) || emp.lastShiftId;

            const targetLineId = extractLineIdFromZone(newZone);
            if (targetLineId) {
              const defaultShiftHours = (shiftModelConfig && typeof shiftModelConfig.defaultShiftHours === "number") ? shiftModelConfig.defaultShiftHours : 8;
              window.recordManualAssignmentHours(emp.id, targetLineId, defaultShiftHours);
            }
          }
          saveToFirebase();
          renderEmployees();
        }
      }
    }));
  });
}
/* ==========================================================================
   8. SCHICHTEN LEEREN, LADEN & ROTIEREN (TEIL 2 VON 2)
   ========================================================================== */

window.clearEntireBoard = function() {
  lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
  activateUndoButtons();
  const todayIso = getLogicalDateIso();
  employees.forEach(e => {
    if (e.zone && ["pool", "review", "absent", "extra"].indexOf(e.zone) === -1 && !isEmpAnchorActiveToday(e, todayIso)) {
      e.zone = "pool";
    }
  });
  addHistoryLog("Komplettes Board in den Pool geleert", "SHIFT");
  saveToFirebase();
  window.initBoard();
  showToast("Alle Schichten geleert (PIN-Nadeln gespeichert)");
};

window.clearShiftRow = function(sId) {
  lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
  activateUndoButtons(sId);
  const todayIso = getLogicalDateIso();
  employees.forEach(e => {
    if (extractShiftIdFromZone(e.zone) === sId && !isEmpAnchorActiveToday(e, todayIso)) {
      e.zone = "pool";
    }
  });
  saveToFirebase();
  window.initBoard();
  showToast((shiftsLabel[sId] || sId) + " geleert");
};

function distributeTeamToSlotInternal(teamKey, slotKey) {
  const todayIso = getLogicalDateIso();
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
      let targetLineId = emp.pinnedZone ? extractLineIdFromZone(emp.pinnedZone) : null;
      let lineObj = targetLineId ? lines.find(l => l.id === targetLineId && !l.ausgeplant) : null;

      if (lineObj && Number((lineObj.roleTargets || {})[empRole] || 0) <= 0) {
        lineObj = null;
      }

      if (lineObj && lineObj.mainOnly && (!Array.isArray(emp.mainLines) || emp.mainLines.indexOf(lineObj.id) === -1)) {
        lineObj = null;
      }

      if (!lineObj && Array.isArray(emp.mainLines) && emp.mainLines.length > 0) {
        for (let i = 0; i < emp.mainLines.length; i++) {
          const candidate = lines.find(l => l.id === emp.mainLines[i] && !l.ausgeplant);
          if (candidate && Number((candidate.roleTargets || {})[empRole] || 0) > 0) {
            lineObj = candidate;
            break;
          }
        }
      }

      if (lineObj) {
        const newZone = lineObj.id + "_" + slotKey;
        emp.zone = newZone;
        emp.pinnedZone = newZone;
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

  shiftRotation[slotKey] = teamKey;
  shiftModelConfig.lastRotationBlockIndex = getWorkdayBlockIndex(getLogicalDateIso());
  distributeTeamToSlotInternal(teamKey, slotKey);
  const tName = teamsConfig[teamKey] ? teamsConfig[teamKey].name : teamKey;
  addHistoryLog(tName + " in " + (shiftsLabel[slotKey] || "Pool") + " geladen", "SHIFT");
  saveToFirebase();
  window.initBoard();
  showToast(tName + " geladen!");
};

/* Bayer 2-2-2 Rotation:
   Beim Wechsel nach 2 Werktagen rückt jedes Team exakt eine Station im Zyklus vor:
   Früh -> Spät -> Nacht -> Frei -> Früh */
window.performShiftRotationLogic = function(silent) {
  const slotOrder = ["frueh", "spaet", "nacht", "frei"];
  const nextShiftRotation = {
    frueh: shiftRotation.nacht,
    spaet: shiftRotation.frueh,
    nacht: shiftRotation.spaet,
    frei: shiftRotation.frei
  };
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
  window.performShiftRotationLogic(true);
  if (shiftModelConfig.smartAssignEnabled !== false && !isIsoDateSunday(getLogicalDateIso())) {
    shifts.forEach(s => {
      window.smartAssignShiftSlot(s.id, true);
    });
  }
  saveToFirebase();
  window.initBoard();
  showToast("🔄 Schichten rotiert & für aktuellen Block zugewiesen!");
};

/* ==========================================================================
   9. FILTER & SUCHE IM POOL
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
  const keys = Object.keys(teamsConfig).sort();
  const freiSel = document.getElementById("teamSelect_frei");
  if (freiSel) {
    const curFreiKey = (shiftRotation.frei && teamsConfig[shiftRotation.frei]) ? shiftRotation.frei : keys[0];
    shiftRotation.frei = curFreiKey;
    freiSel.innerHTML = keys.map(k => '<option value="' + k + '" ' + (curFreiKey === k ? 'selected' : '') + '>Frei: ' + teamsConfig[k].name + '</option>').join("");
    freiSel.onchange = function() {
      shiftRotation.frei = this.value;
      shiftModelConfig.lastRotationBlockIndex = getWorkdayBlockIndex(getLogicalDateIso());
      saveToFirebase();
    };
  }
}

window.onShiftTeamDropdownChange = function(shiftId, selEl) {
  if (!selEl) return;
  const selectedTeam = selEl.value;
  const oldTeam = shiftRotation[shiftId];
  
  // Verhindert doppelte Team-Zuweisung und tauscht automatisch durch
  Object.keys(shiftRotation).forEach(sKey => {
    if (sKey !== shiftId && shiftRotation[sKey] === selectedTeam) {
      shiftRotation[sKey] = oldTeam;
    }
  });
  
  shiftRotation[shiftId] = selectedTeam;
  shiftModelConfig.lastRotationBlockIndex = getWorkdayBlockIndex(getLogicalDateIso());
  saveToFirebase();
  window.initBoard();
};

window.updatePoolSearch = function(val) {
  const rawVal = (val || "").trim();
  const clearBtn = document.getElementById("clearSearchBtn");
  if (rawVal.length > 0 && rawVal.length < 3) {
    poolSearchQuery = "";
    if (clearBtn) clearBtn.style.display = "block";
    renderEmployees();
    return;
  }
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

  saveToFirebase();
  window.initBoard();
  if (!isAuto) {
    window.closeModal("lineEditModal");
    showToast("Linie gespeichert!");
  }
};

/* ==========================================================================
   11. SMARTE 3ER-SCHNELLAUSWAHL & "JA / NEIN"-BRINGSCHICHT-FREIGABE
   ========================================================================== */

window.getCoverageTargetInfoForDay = function(dateIso, shiftId, reqRole) {
  const todayIso = getLogicalDateIso();
  const isPast = dateIso < todayIso;
  const rot = getRotationForDate(dateIso);
  const freiTeamKey = rot.frei || "";
  const freiTeamObj = teamsConfig[freiTeamKey] || { name: "Freischicht-Team", color: "#0284c7" };

  const eligibleEmps = employees.filter(emp => {
    if ((emp.role || "Bediener") !== (reqRole || "Bediener")) return false;
    const check = window.checkExtraShiftPlausibility(emp.id, dateIso, shiftId);
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

  const bulkBtns = modal.querySelectorAll("button[onclick*='setAllModalCoverageDaysStatus']");
  if (bulkBtns.length > 0 && bulkBtns[0].parentElement) {
    const bulkWrap = bulkBtns[0].parentElement;
    bulkWrap.style.cssText = "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #f1f5f9;";
    bulkWrap.innerHTML =
      '<span style="font-size:0.74rem; font-weight:700; color:#475569;">Schnellauswahl:</span>' +
      '<div style="display:flex; gap:5px; flex-wrap:wrap;">' +
        '<button type="button" onclick="setAllModalCoverageDaysStatus(\'open_green\')" style="background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; border-radius:6px; padding:4px 9px; font-size:0.71rem; font-weight:700; cursor:pointer;" title="Schaltet nur Tage frei, an denen das freie Team ohne Ruhezeit-Konflikt fahren darf">🟢 Alle fahrbaren Tage (Ja)</button>' +
        '<button type="button" onclick="setAllModalCoverageDaysStatus(\'open_all\')" style="background:#fffbeb; color:#b45309; border-color:#fde68a; border-radius:6px; padding:4px 9px; font-size:0.71rem; font-weight:700; cursor:pointer;" title="Schaltet alle Tage inkl. gelber Ruhezeit-Warnung fürs Portal frei">🟡 Alle inkl. Warnung (Ja)</button>' +
        '<button type="button" onclick="setAllModalCoverageDaysStatus(\'rejected\')" style="background:#fef2f2; color:#b91c1c; border-color:#fecaca; border-radius:6px; padding:4px 9px; font-size:0.71rem; font-weight:700; cursor:pointer;" title="Lehnt alle Tage ab (im Portal gesperrt)">❌ Alle ablehnen (Nein)</button>' +
      '</div>';
  }

  const emp = sl ? employees.find(e => e.id === sl.empId) : (req ? employees.find(e => e.id === req.empId) : null);
  const nameTxt = emp ? fullName(emp) : "Mitarbeiter";
  const roleTxt = (req && req.role) ? req.role : (emp ? emp.role : "Bediener");
  const probLineTxt = (req && req.probableLines) ? (" · " + req.probableLines) : "";

  if (subEl) {
    subEl.style.cssText = "font-size:0.8rem; color:#475569; margin-bottom:10px; line-height:1.4;";
    subEl.innerHTML =
      "Ausfall: <b style='color:#0f172a;'>" + nameTxt + "</b> <span style='color:#64748b;'>(" + roleTxt + probLineTxt + ")</span><br>" +
      "<span style='font-size:0.74rem; color:#64748b;'>Du kannst diese Auswahl jederzeit auch nachträglich im Postfach wieder öffnen und einzelne Tage auf <b>Ja</b> oder <b>Nein</b> umstellen.</span>";
  }

  const validDays = (req && Array.isArray(req.days)) ? req.days : [];

  if (!validDays.length) {
    listEl.innerHTML = '<p style="font-size:0.8rem; color:#64748b; padding:8px;">In diesem Zeitraum fallen laut 2-2-2-Schichtplan (Sonntag frei) keine regulären Arbeitstage für ' + nameTxt + ' an.</p>';
  } else {
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
        teamMetaHtml = '<span style="color:#94a3b8;">⌛ Datum bereits vergangen</span>';
      } else if (targetInfo.eligibleTotalCount > 0) {
        const namesHint = targetInfo.eligibleNames.slice(0, 4).join(", ") + (targetInfo.eligibleNames.length > 4 ? "..." : "");
        teamMetaHtml =
          '<span style="color:' + targetInfo.freiTeamColor + '; font-weight:700;">■ ' + targetInfo.freiTeamName + ' (Frei)</span>' +
          ' · <span style="color:#15803d; font-weight:600;" title="Mögliche Mitarbeiter: ' + namesHint + '">🟢 ' + targetInfo.eligibleTotalCount + ' ' + roleTxt + ' regulär fahrbar</span>';
      } else {
        teamMetaHtml =
          '<span style="color:' + targetInfo.freiTeamColor + '; font-weight:600;">■ ' + targetInfo.freiTeamName + ' (Frei)</span>' +
          ' · <span style="color:#d97706; font-weight:700;" title="Wegen Vor-/Nachschicht-Ruhezeit (z.B. Ausschlaftag nach Nachtschicht) aktuell kein passender ' + roleTxt + ' ohne Ruhezeit-Warnung frei">🟡 Ruhezeit-Warnung (0 ohne Konflikt frei)</span>';
      }

      let rightControlHtml = "";
      if (isTaken) {
        rightControlHtml =
          '<span style="background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; padding:3px 9px; border-radius:999px; font-size:0.7rem; font-weight:700; white-space:nowrap;">' +
            '🤝 ' + (takenEmp ? fullName(takenEmp) : 'Besetzt') +
          '</span>';
      } else {
        const yesStyle = isOpen
          ? (hasYellowWarning
              ? "background:#f59e0b; color:#ffffff; border-color:#f59e0b; box-shadow:0 1px 2px rgba(245,158,11,0.25);"
              : "background:#10b981; color:#ffffff; border-color:#10b981; box-shadow:0 1px 2px rgba(16,185,129,0.25);")
          : "background:#ffffff; color:#64748b; border-color:#e2e8f0;";
        const noStyle = isRejected
          ? "background:#ef4444; color:#ffffff; border-color:#ef4444; box-shadow:0 1px 2px rgba(239,68,68,0.25);"
          : "background:#ffffff; color:#64748b; border-color:#e2e8f0;";

        rightControlHtml =
          '<div style="display:inline-flex; background:#f8fafc; padding:2px; border-radius:8px; border:1px solid #e2e8f0; gap:3px; flex-shrink:0;">' +
            '<button type="button" onclick="setCoverageDayDecision(\'' + req.leaveId + '\', ' + dIdx + ', \'open\')" style="border:1px solid transparent; border-radius:6px; padding:4px 10px; font-size:0.73rem; font-weight:700; cursor:pointer; transition:all 0.15s ease; ' + yesStyle + '">Ja</button>' +
            '<button type="button" onclick="setCoverageDayDecision(\'' + req.leaveId + '\', ' + dIdx + ', \'rejected\')" style="border:1px solid transparent; border-radius:6px; padding:4px 10px; font-size:0.73rem; font-weight:700; cursor:pointer; transition:all 0.15s ease; ' + noStyle + '">Nein</button>' +
          '</div>';
      }

      const rowBorderColor = isTaken ? "#bae6fd" : (isOpen ? (hasYellowWarning ? "#fde68a" : "#bbf7d0") : (isRejected ? "#fecaca" : "#e2e8f0"));
      const rowBg = isOpen ? (hasYellowWarning ? "#fffbeb" : "#f0fdf4") : (isRejected ? "#fff1f2" : "#ffffff");
      const statusDot = isOpen ? (hasYellowWarning ? "🟡" : "🟢") : (isRejected ? "🔴" : "⚪");

      return (
        '<div style="display:flex; justify-content:space-between; align-items:center; background:' + rowBg + '; border:1px solid ' + rowBorderColor + '; padding:8px 11px; border-radius:10px; margin-bottom:6px; gap:10px; transition:all 0.15s ease;">' +
          '<div style="min-width:0; flex:1;">' +
            '<div style="font-size:0.84rem; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:5px;">' +
              '<span style="font-size:0.65rem;">' + statusDot + '</span>' +
              '<span>' + (wdShort ? wdShort + ', ' : '') + formatDateDe(d.date) + ' · ' + (shiftsShortLabel[d.shift] || d.shift) + '</span>' +
            '</div>' +
            '<div style="font-size:0.71rem; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' +
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
  if (decisionStatus === "open") {
    const info = window.getCoverageTargetInfoForDay(d.date, d.shift, req.role || "Bediener");
    d.allowWithRestWarning = (info.eligibleTotalCount === 0);
  } else {
    d.allowWithRestWarning = false;
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

window.setAllModalCoverageDaysStatus = function(mode) {
  if (!activeCoverageReleaseLeaveId) return;
  const req = (leaveRequests || []).find(r => r.leaveId === activeCoverageReleaseLeaveId || r.id === activeCoverageReleaseLeaveId || r.id === ("cov_" + activeCoverageReleaseLeaveId));
  if (!req || !Array.isArray(req.days)) return;

  const reqRole = req.role || "Bediener";
  let openCount = 0;

  req.days.forEach(d => {
    if (d.takenBy) return;
    const info = window.getCoverageTargetInfoForDay(d.date, d.shift, reqRole);

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

  saveToFirebase();
  window.openCoverageReleaseModal(req.leaveId);
  window.renderInboxLists();

  if (mode === "open_green") {
    showToast("🟢 " + openCount + " regulär fahrbare Tage mit JA freigegeben (Ruhezeit-Konflikte auf Nein)");
  } else if (mode === "open_all" || mode === "open") {
    showToast("🟡 Alle " + openCount + " Tage (inkl. Ruhezeit-Warnung) fürs Portal freigegeben!");
  } else {
    showToast("❌ Alle Schichttage mit NEIN abgelehnt (gesperrt)");
  }
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

window.onEmpLineCheckboxChange = function() {
  window._tempEditEmpMainLines = Array.from(document.querySelectorAll(".emp-main-line-chk:checked")).map(c => c.value);
  window._tempEditEmpSecLines = Array.from(document.querySelectorAll(".emp-sec-line-chk:checked")).map(c => c.value);
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

  if (document.getElementById("cfgFocusModeEnabled")) return;
  const swapChk = document.getElementById("cfgSmartAllowSwap");
  if (!swapChk || !swapChk.parentElement || !swapChk.parentElement.parentElement) return;
  const box = document.createElement("div");
  box.style.cssText = "margin-top:10px; padding:10px 12px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:10px; display:flex; flex-direction:column; gap:8px;";
  box.innerHTML =
    '<div style="font-size:0.78rem; font-weight:700; color:#0369a1;">🎯 Strategische Qualifikations-, Fokus- & 2-2-2 (Sonntag frei) Automatik</div>' +
    '<div id="live222BlockStatusText" style="font-size:0.74rem; color:#0f172a; background:#ffffff; padding:6px 9px; border-radius:6px; border:1px solid #bae6fd;">' +
      'Aktueller Produktionstag (ab 05:00 Uhr): <b>' + formatDateDe(prodTodayIso) + "</b> · Block: <b>" + bInfo.blockLabel + "</b> · " +
      'Nächster automatischer 2-2-2 Block-Wechsel: <b>' + getWeekdayShortDe(bInfo.nextChangeIso) + ', ' + formatDateDe(bInfo.nextChangeIso) + ' um 05:00 Uhr</b>' +
    '</div>' +
    '<button type="button" class="btn btn-primary" style="padding:6px 10px; font-size:0.74rem; align-self:flex-start;" onclick="syncCurrentBoardAs222Anchor()">🔄 Aktuelle Team-Aufstellung als heutigen 2-2-2 Start-Anker speichern & neu verteilen</button>' +
    '<label style="font-size:0.76rem; display:flex; align-items:center; gap:6px; cursor:pointer;">' +
      '<input type="checkbox" id="cfgFocusModeEnabled" onchange="saveShiftModelSettings()"> ' +
      '<span><b>Fokus-Modus:</b> Angefangene Einarbeitung (>0h bis 120h) an einer Linie priorisiert zu Ende lernen</span>' +
    '</label>' +
    '<label style="font-size:0.76rem; display:flex; align-items:center; gap:6px; cursor:pointer;">' +
      '<input type="checkbox" id="cfgFairnessBalanceEnabled" onchange="saveShiftModelSettings()"> ' +
      '<span><b>Fairness & Gleichgewicht:</b> Bei Sekundärlinien fair abwechseln (Einsatz-Gedächtnis)</span>' +
    '</label>' +
    '<div style="display:flex; align-items:center; gap:8px; font-size:0.76rem; flex-wrap:wrap;">' +
      '<span><b>Förder-Zyklus (Stamm-Bediener an neue Linien heranführen):</b> Alle</span>' +
      '<input type="number" id="cfgRotationCycleMonths" min="0" max="24" style="width:55px; padding:3px 6px; border:1px solid #cbd5e1; border-radius:6px;" onchange="saveShiftModelSettings()">' +
      '<span>Monate (0 = Aus)</span>' +
    '</div>';
  swapChk.parentElement.parentElement.appendChild(box);
}

function renderSettingsLists() {
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

      const onbResetAction = (plannerLevel >= 3 && isOnbDone)
        ? '<button class="btn btn-outline" style="padding:2px 6px; font-size:0.68rem; color:#b45309; border-color:#fde68a;" onclick="resetEmployeeOnboarding(\'' + e.id + '\')" title="Onboarding für diesen Mitarbeiter zurücksetzen">🔄 Onb.</button>'
        : '';

      return '<div class="item-row">' +
        '<div class="emp-row-info"><span style="color:' + tObj.color + '; font-weight:700;">■</span> <b>' + fullName(e) + '</b>' + ehBadge + ' <small style="color:#64748b;">(' + e.role + ')</small> ' + pinBadge + ' ' + onbBadge + ' ' + traineeBadge + '</div>' +
        '<div class="emp-row-actions">' + onbResetAction + pinAction +
          '<button class="btn btn-outline" style="padding:2px 7px; font-size:0.72rem;" onclick="editEmployee(\'' + e.id + '\')">✏️</button>' +
          '<button class="btn btn-outline" style="padding:2px 7px; font-size:0.72rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteEmployee(\'' + e.id + '\')">🗑️</button>' +
        '</div></div>';
    }).join("");
  }

  const mainLinesBox = document.getElementById("mainLinesCheckboxes");
  const secLinesBox = document.getElementById("secLinesCheckboxes");
  const currentMain = window._tempEditEmpMainLines || [];
  const currentSec = window._tempEditEmpSecLines || [];

  if (mainLinesBox) {
    mainLinesBox.innerHTML = lines.map(l =>
      '<label style="font-size:0.74rem; display:inline-flex; align-items:center; gap:3px; cursor:pointer; background:#fff; padding:3px 6px; border:1px solid #cbd5e1; border-radius:6px;"><input type="checkbox" value="' + l.id + '" class="emp-main-line-chk" ' + (currentMain.indexOf(l.id) !== -1 ? 'checked' : '') + ' onchange="onEmpLineCheckboxChange()"> ' + l.name + '</label>'
    ).join("");
  }
  if (secLinesBox) {
    secLinesBox.innerHTML = lines.map(l =>
      '<label style="font-size:0.74rem; display:inline-flex; align-items:center; gap:3px; cursor:pointer; background:#fff; padding:3px 6px; border:1px solid #cbd5e1; border-radius:6px;"><input type="checkbox" value="' + l.id + '" class="emp-sec-line-chk" ' + (currentSec.indexOf(l.id) !== -1 ? 'checked' : '') + ' onchange="onEmpLineCheckboxChange()"> ' + l.name + '</label>'
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

  setChk("cfgAutoRotate", shiftModelConfig.autoRotate !== false);
  setChk("cfgSmartAssignEnabled", shiftModelConfig.smartAssignEnabled !== false);
  setChk("cfgSmartRespectFloorTL", shiftModelConfig.smartRespectFloorTL !== false);
  setChk("cfgSmartAllowSwap", shiftModelConfig.smartAllowSwap !== false);
  setChk("cfgFocusModeEnabled", shiftModelConfig.focusModeEnabled !== false);
  setChk("cfgFairnessBalanceEnabled", shiftModelConfig.fairnessBalanceEnabled !== false);
  setVal("cfgRotationCycleMonths", shiftModelConfig.rotationCycleMonths ?? 3);

  setChk("cfgResetEnabled", !!shiftModelConfig.resetEnabled);
  setVal("cfgResetDay", shiftModelConfig.resetDay ?? -1);
  setVal("cfgResetHour", shiftModelConfig.resetHour ?? 5);

  setChk("cfgLoadEnabled", !!shiftModelConfig.loadEnabled);
  setVal("cfgLoadDay", shiftModelConfig.loadDay ?? -1);
  setVal("cfgLoadHour", shiftModelConfig.loadHour ?? 5);

  setVal("cfgSecondaryUnlockHours", shiftModelConfig.secondaryUnlockThresholdHours ?? 120);
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
  shiftModelConfig.fairnessBalanceEnabled = getChk("cfgFairnessBalanceEnabled", true);

  const rotMonthsEl = document.getElementById("cfgRotationCycleMonths");
  if (rotMonthsEl) shiftModelConfig.rotationCycleMonths = Math.max(0, parseInt(rotMonthsEl.value, 10) || 0);

  shiftModelConfig.resetEnabled = getChk("cfgResetEnabled", true);
  shiftModelConfig.resetDay = getInt("cfgResetDay", -1);
  shiftModelConfig.resetHour = getInt("cfgResetHour", 5);

  shiftModelConfig.loadEnabled = getChk("cfgLoadEnabled", true);
  shiftModelConfig.loadDay = getInt("cfgLoadDay", -1);
  shiftModelConfig.loadHour = getInt("cfgLoadHour", 5);

  const threshInp = document.getElementById("cfgSecondaryUnlockHours");
  if (threshInp) shiftModelConfig.secondaryUnlockThresholdHours = Math.max(6, parseInt(threshInp.value, 10) || 120);

  const hoursInp = document.getElementById("cfgDefaultShiftHours");
  if (hoursInp) shiftModelConfig.defaultShiftHours = Math.max(1, parseFloat(hoursInp.value) || 8);

  saveToFirebase();
  window.updateAutoRotationUI();
  renderEmployees();
  renderUnqualifiedHoursOverview();
  showToast("Einstellungen & Förder-Matrix gespeichert!");
};

window.toggleNewTeamForm = function() {
  const wrap = document.getElementById("newTeamFormWrapper");
  if (wrap) wrap.style.display = (wrap.style.display === "none" || !wrap.style.display) ? "block" : "none";
};

window.toggleTeamRotationSetting = function(key, val) {
  if (teamsConfig[key]) {
    teamsConfig[key].rotates = val;
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
   12. HISTORIE, BACKUPS, PROFIL & STAMMDATEN-VERWALTUNG (INKL. STAMM-SCHUTZ)
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
    LOGIN: ["#fef3c7", "#b45309"],
    BACKUP: ["#f0fdf4", "#166534"]
  };

  listEl.innerHTML = items.slice(0, 150).map(item => {
    const d = item.timestamp ? new Date(item.timestamp) : new Date();
    const dStr = d.toLocaleDateString("de-DE") + " " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const [catBg, catCol] = catStyleMap[item.category] || ["#f1f5f9", "#475569"];

    return '<div class="item-row" style="font-size:0.78rem;">' +
      '<div><b>' + (item.text || "") + '</b> <div style="color:#64748b; font-size:0.7rem;">👤 ' + (item.actor || "System") + ' · ' + dStr + '</div></div>' +
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
    createdBy: currentPlannerName || "Planer",
    data: JSON.stringify({ lines, roles, employees, teamsConfig, shiftRotation, sickLeaves, extraShifts })
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
    if (Array.isArray(parsed.extraShifts)) extraShifts = parsed.extraShifts;
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
  addHistoryLog("Team gelöscht: " + tName, "EMP");
  saveToFirebase();
  window.initBoard();
  renderSettingsLists();
  showToast("Team gelöscht");
};

window.deleteEmployee = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp || !confirm("Sind Sie sicher, dass Sie den Mitarbeiter '" + fullName(emp) + "' dauerhaft löschen möchten?")) return;
  employees = employees.filter(e => e.id !== id);
  addHistoryLog("Mitarbeiter gelöscht: " + fullName(emp), "EMP");
  saveToFirebase();
  renderEmployees();
  renderSettingsLists();
  showToast("Mitarbeiter gelöscht");
};

window.editEmployee = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;
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

  window._tempEditEmpMainLines = Array.isArray(emp.mainLines) ? emp.mainLines.slice() : [];
  window._tempEditEmpSecLines = Array.isArray(emp.secLines) ? emp.secLines.slice() : [];

  document.getElementById("btnCancelEditEmp").style.display = "inline-block";
  document.getElementById("btnSaveEmp").textContent = "Änderungen speichern";
  renderSettingsLists();
};

window.resetEmpForm = function() {
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

  currentAnchorDaysSelection = [1, 2, 3, 4, 5];
  window._tempEditEmpMainLines = [];
  window._tempEditEmpSecLines = [];
  document.getElementById("btnCancelEditEmp").style.display = "none";
  document.getElementById("btnSaveEmp").textContent = "Speichern";
  renderSettingsLists();
};

window.saveEmployee = function() {
  const id = document.getElementById("editEmpId").value;
  const fName = document.getElementById("newEmpFirstName").value.trim();
  const lName = document.getElementById("newEmpLastName").value.trim();
  if (!fName || !lName) return showToast("Bitte Vor- und Nachname eingeben", true);

  const mainChecked = Array.from(document.querySelectorAll(".emp-main-line-chk:checked")).map(c => c.value);
  const secChecked = Array.from(document.querySelectorAll(".emp-sec-line-chk:checked")).map(c => c.value);

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
  const trainingStartVal = (trStart && trStart.value) ? trStart.value : getLogicalDateIso();

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
      addHistoryLog("Mitarbeiter aktualisiert: " + fullName(emp) + (inTrainingVal ? " [Stamm-Schutz: " + trainingDaysVal + " Tg. / " + trainingPctVal + "%]" : ""), "EMP");
      showToast("Mitarbeiter gespeichert!");
    }
  } else {
    const randomPin = String(Math.floor(1000 + Math.random() * 9000));
    employees.push({
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
      lineAssignCounts: {}
    });
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
   13. UNIVERSELLE AUTOCOMPLETE-ENGINE, POSTFACH & CLOUD-SYNCHRONISIERUNG
   ========================================================================== */

function renderUniversalSuggestions(val, boxId, selectFnName, preferPlanners) {
  const box = document.getElementById(boxId);
  const q = (val || "").trim().toLowerCase();
  if (!box || !employees || !employees.length || q.length < 3) {
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
  const newLeave = {
    id: "sl_" + Date.now(),
    empId: selectedManualSickEmpId,
    startDate: start,
    endDate: end,
    category: cat,
    reason: reason,
    status: "approved",
    reviewedBy: currentPlannerName || "Planer",
    reviewedAt: new Date().toISOString()
  };
  sickLeaves.unshift(newLeave);
  window.generateCoveragePromptForLeave(newLeave, "pending");

  addHistoryLog("Abwesenheit (" + cat + ") für " + (emp ? fullName(emp) : "") + " eingetragen", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.openCoverageReleaseModal(newLeave.id);
  showToast("Abwesenheit eingetragen – bitte Bringschichten mit Ja / Nein prüfen!");

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

  extraShifts.push({
    id: newExtraId,
    empId: selectedManualExtraEmpId,
    date: dateVal,
    shift: shiftVal,
    note: noteVal,
    plausibilityWarning: !!conflictWarning,
    conflictDetails: conflictWarning || "",
    status: "approved"
  });

  addHistoryLog("Bringschicht für " + (emp ? fullName(emp) : "") + " am " + formatDateDe(dateVal) + " (" + (shiftsShortLabel[shiftVal] || shiftVal) + ")", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();

  showToast(conflictWarning ? ("⚠️ Eingetragen (" + conflictWarning + ")") : "Bringschicht eingetragen & aktiviert (1h Vorlauf)!", !!conflictWarning);

  document.getElementById("manualExtraDate").value = "";
  document.getElementById("manualExtraNote").value = "";
  document.getElementById("manualExtraEmpInput").value = "";
  selectedManualExtraEmpId = null;
};

function applyLineRequestToEmployee(sl) {
  if (!sl || !sl.lineRequestData || !sl.lineRequestData.lineId) return;
  const emp = employees.find(e => e.id === sl.empId);
  if (!emp) return;
  if (sl.lineRequestData.type === "prio") {
    if (!Array.isArray(emp.mainLines)) emp.mainLines = [];
    if (emp.mainLines.indexOf(sl.lineRequestData.lineId) === -1) emp.mainLines.push(sl.lineRequestData.lineId);
  } else {
    if (!Array.isArray(emp.secLines)) emp.secLines = [];
    if (emp.secLines.indexOf(sl.lineRequestData.lineId) === -1) emp.secLines.push(sl.lineRequestData.lineId);
  }
}

window.markAllSickLeavesRead = function() {
  sickLeaves.forEach(sl => {
    if (sl.status === "pending") {
      sl.status = "approved";
      if (sl.lineRequestData && sl.lineRequestData.lineId) {
        applyLineRequestToEmployee(sl);
      } else if (!sl.isOnboardingNotice) {
        window.generateCoveragePromptForLeave(sl, "pending");
      }
    }
    sl.plannerUnreadInfo = false;
  });
  extraShifts.forEach(es => {
    if (es.status === "pending") es.status = "approved";
    es.plannerUnreadInfo = false;
  });
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
  showToast("Alle Meldungen bestätigt");
};

/* Beide Funktionsnamen registriert, damit die Filter-Pillen unten im Postfach garantiert greifen */
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
