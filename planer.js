/* ==========================================================================
   PLANER-BOARD MASTER-LOGIK (planer.js) - Version 4.9.70 (TEIL 1 VON 4)
   LEGO-MODUL-ARCHITEKTUR (PLN-00 bis PLN-14)
   Vollständige Original-Struktur · Bayer 2-2-2 (Sonntag frei) Automatik ab 05:00 Uhr
   Bringschichten (F/S/N) · Multi-Anlagen-Historie · Memory-Pin · Audit-Trail
   ========================================================================== */

/* ==========================================================================
   🧱 [LEGO-MODUL PLN-00 START: FIREBASE-INIT, GLOBALE VARIABLEN & SAAS-CSS]
   ========================================================================== */

window.PLANER_JS_VERSION = "4.9.70";

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
var shiftsCodeLetter = { frueh: "F", spaet: "S", nacht: "N" };
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
  focusModePercent: 20,
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
var activeCounterOfferLeaveId = null;

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
      padding: 4px 7px !important;
      margin-bottom: 3px !important;
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
    .card-extra-fsn-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.56rem;
      font-weight: 800;
      padding: 0px 5px;
      border-radius: 4px;
      background: #16a34a;
      color: #ffffff;
      border: 1px solid #15803d;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .card-quals-row {
      display: none;
      flex-wrap: wrap;
      gap: 3px;
      margin-top: 2px;
      padding-top: 2px;
      border-top: 1px dashed #f1f5f9;
      line-height: 1.1;
    }
    body.planner-active .card-quals-row {
      display: flex !important;
    }
    .card-qual-prio {
      font-size: 0.53rem;
      font-weight: 700;
      color: #0369a1;
      background: #e0f2fe;
      border: 1px solid #bae6fd;
      padding: 0px 4px;
      border-radius: 4px;
      white-space: nowrap;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-qual-sec {
      font-size: 0.53rem;
      font-weight: 600;
      color: #475569;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 0px 4px;
      border-radius: 4px;
      white-space: nowrap;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
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
    .emp-history-card {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 4px solid #0284c7;
      border-radius: 8px;
      padding: 7px 10px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-bottom: 6px;
    }
    .emp-history-line-item {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 5px 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .audit-trail-box {
      margin-top: 5px;
      padding: 4px 8px;
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 6px;
      font-size: 0.68rem;
      color: #475569;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
  `;
  document.head.appendChild(st);
}
/* ==========================================================================
   🧱 [LEGO-MODUL PLN-00 ENDE: FIREBASE-INIT, GLOBALE VARIABLEN & SAAS-CSS]
   ========================================================================== */

/* ==========================================================================
   🧱 [LEGO-MODUL PLN-01 START: GLOBALE BASIS-, DATUMS-, AUDIT- & FREIGABE-LOGIK]
   ========================================================================== */

window.closeModal = function(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
};

function getShiftCodeLetter(shiftId) {
  return shiftsCodeLetter[shiftId] || (shiftId === "frueh" ? "F" : (shiftId === "spaet" ? "S" : (shiftId === "nacht" ? "N" : "")));
}
window.getShiftCodeLetter = getShiftCodeLetter;

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
      "<div>📝 <b>Eingereicht / Erstellt:</b> " +
      (record.createdAt ? formatAuditTimestampDe(record.createdAt) : "Dokumentiert") +
      (record.createdBy ? " · <b>" + record.createdBy + "</b>" : "") +
      "</div>"
    );
  }
  if (record.reviewedBy || record.reviewedAt) {
    const actionLabel = record.status === "approved"
      ? "Angenommen / Genehmigt"
      : (record.status === "counter_offer" ? "Bedingt angenommen (Vorschlag)" : (record.status === "rejected" ? "Abgelehnt" : "Geprüft"));
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

function isSundayRestPeriod(baseDate) {
  const d = baseDate || new Date();
  return d.getDay() === 0 && d.getHours() >= 5;
}

function isSundayDaytimeFree() {
  return isSundayRestPeriod(new Date());
}

/* Produktionstag wechselt exakt um 05:00 Uhr morgens */
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

function getWorkdayBlockIndex(isoDateStr) {
  const p = String(isoDateStr || getLogicalDateIso()).split("-");
  const diffDays = Math.floor((Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - Date.UTC(2026, 0, 12)) / 86400000);
  const weeks = Math.floor(diffDays / 7);
  const dayInWeek = ((diffDays % 7) + 7) % 7;
  return weeks * 3 + Math.floor(Math.min(dayInWeek, 5) / 2);
}

function getWorkdaySerialIndex(isoDateStr) {
  const p = String(isoDateStr || getLogicalDateIso()).split("-");
  const diffDays = Math.floor((Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - Date.UTC(2026, 0, 12)) / 86400000);
  const weeks = Math.floor(diffDays / 7);
  const dayInWeek = ((diffDays % 7) + 7) % 7;
  return weeks * 6 + Math.min(dayInWeek, 5);
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

function isEmployeeQualifiedForLine(emp, lineId) {
  if (!emp || !lineId) return false;
  const isMain = Array.isArray(emp.mainLines) && emp.mainLines.indexOf(lineId) !== -1;
  const isSec = Array.isArray(emp.secLines) && emp.secLines.indexOf(lineId) !== -1;
  return isMain || isSec;
}
window.isEmployeeQualifiedForLine = isEmployeeQualifiedForLine;

/* Prüft den Neu-Mitarbeiter Einarbeitungs-Modus ("Stamm-Schutz-Phase") inkl. automatischem Ablauf */
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

  if (elapsedDays >= totalDays) {
    emp.inTrainingPhase = false;
    return {
      active: false,
      totalDays: totalDays,
      elapsedDays: elapsedDays,
      remainingDays: 0,
      mainPct: mainPct,
      startDate: startIso
    };
  }

  return {
    active: true,
    totalDays: totalDays,
    elapsedDays: elapsedDays,
    remainingDays: remainingDays,
    mainPct: mainPct,
    startDate: startIso
  };
};

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

window.updateShiftApprovalUI = function() {
  const approved = isCurrentShiftApproved();
  const sundayFree = isSundayDaytimeFree();
  const activeShiftId = getCurrentActiveShiftId();
  const activeShort = shiftsShortLabel[activeShiftId] || "Schicht";
  const activeLong = shiftsLabel[activeShiftId] || "Aktuelle Schicht";
  const nowObj = new Date();
  const prodTodayIso = getLogicalDateIso(nowObj);
  const calTodayIso = getTodayIso(nowObj);

  const bar = document.getElementById("brandGradientBar");
  const dot = document.getElementById("indicatorDot");
  const text = document.getElementById("indicatorText");
  const btn = document.getElementById("plannerApprovalIndicator");

  if (dot && text && btn) {
    dot.style.background = approved ? "#16a34a" : "#dc2626";
    text.textContent = approved ? ("Freigegeben (" + activeShort + ")") : (activeShort + " freigeben");
    btn.style.borderColor = approved ? "#86efac" : "#fecaca";
    btn.style.background = approved ? "#f0fdf4" : "#fef2f2";
    btn.style.color = approved ? "#166534" : "#b91c1c";
    if (bar) bar.className = (approved || sundayFree) ? "brand-gradient approved" : "brand-gradient pending";
  }

  const portalBadge = document.getElementById("portalShiftStatusBadge");
  const portalDot = document.getElementById("portalStatusDot");
  const portalText = document.getElementById("portalStatusText");
  if (portalBadge && portalDot && portalText) {
    if (sundayFree) {
      if (bar) bar.className = "brand-gradient approved";
      portalBadge.className = "portal-shift-status sunday";
      portalDot.style.background = "#0284c7";
      portalText.textContent = "☀️ Sonntag – Regulär Schichtfrei";
      return;
    }

    const portalEmpId = sessionStorage.getItem("portal_logged_emp_id");
    const emp = (portalEmpId && Array.isArray(employees)) ? employees.find(x => x.id === portalEmpId) : null;

    if (emp) {
      const activeLeaveToday = (typeof getActiveLeaveForEmpOnDate === "function")
        ? (getActiveLeaveForEmpOnDate(emp.id, prodTodayIso) || getActiveLeaveForEmpOnDate(emp.id, calTodayIso))
        : null;

      if (emp.zone === "absent" || activeLeaveToday) {
        if (bar) bar.className = "brand-gradient approved";
        portalBadge.className = "portal-shift-status sunday";
        portalDot.style.background = "#0284c7";
        portalText.textContent = "🏥 Heute als abwesend eingetragen";
        return;
      }

      const isOnLine = !!(emp.zone && ["pool", "review", "absent", "extra"].indexOf(emp.zone) === -1);
      const todayExtraShift = (Array.isArray(extraShifts) ? extraShifts : []).find(es =>
        es &&
        es.empId === emp.id &&
        es.status === "approved" &&
        (window.normalizeDateIso(es.date) === prodTodayIso || (typeof isExtraShiftInActiveWindow === "function" && isExtraShiftInActiveWindow(es, nowObj)))
      );

      let targetShiftId = null;
      if (isOnLine) {
        targetShiftId = extractShiftIdFromZone(emp.zone);
      } else if (todayExtraShift) {
        targetShiftId = todayExtraShift.shift;
      } else if (typeof window.getEmpRegularShiftOnDate === "function") {
        targetShiftId = window.getEmpRegularShiftOnDate(emp, prodTodayIso);
      }

      if (!targetShiftId) {
        if (bar) bar.className = "brand-gradient approved";
        portalBadge.className = "portal-shift-status sunday";
        portalDot.style.background = "#0284c7";
        portalText.textContent = "🌴 Heute regulär Freischicht";
        return;
      }

      const myShiftLong = shiftsLabel[targetShiftId] || targetShiftId;
      const isMyShiftApproved = (approvedShiftKey === (prodTodayIso + "_" + targetShiftId));

      if (bar) bar.className = isMyShiftApproved ? "brand-gradient approved" : "brand-gradient pending";
      if (isMyShiftApproved) {
        portalBadge.className = "portal-shift-status approved";
        portalDot.style.background = "#16a34a";
        portalText.textContent = "✅ " + myShiftLong + " ist vom Planer bestätigt";
      } else {
        portalBadge.className = "portal-shift-status pending";
        portalDot.style.background = "#dc2626";
        portalText.textContent = "⏳ " + myShiftLong + " ist noch nicht bestätigt";
      }
      return;
    }

    if (bar) bar.className = (approved || sundayFree) ? "brand-gradient approved" : "brand-gradient pending";
    if (approved) {
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
   🧱 [LEGO-MODUL PLN-01 ENDE: GLOBALE BASIS-, DATUMS-, AUDIT- & FREIGABE-LOGIK]
   ========================================================================== */

/* ==========================================================================
   🧱 [LEGO-MODUL PLN-02 START: HEADER-SCHALTER (AUTO-ROTATION, AUTO-ZUWEISUNG, ZEIT-SCHALTER)]
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
   🧱 [LEGO-MODUL PLN-02 ENDE: HEADER-SCHALTER (AUTO-ROTATION, AUTO-ZUWEISUNG, ZEIT-SCHALTER)]
   ========================================================================== */

/* ==========================================================================
   🧱 [LEGO-MODUL PLN-03 START: HISTORIE, ABWESENHEITS- & 2-2-2 BRINGSCHICHT-LOGIK]
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
  const slotOrder = ["frueh", "spaet", "nacht", "frei"];
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
    return extractShiftIdFromZone(emp.zone) || extractShiftIdFromZone(emp.pinnedZone) || emp.lastShiftId || "frueh";
  }
  if (!isTeamRotating(emp.team)) {
    const dayNum = parseIsoToLocalDate(dateIso).getDay();
    if (dayNum === 0 || dayNum === 6) return null;
    return ["frueh", "spaet", "nacht"].find(s => shiftRotation[s] === emp.team) || null;
  }
  const rot = getRotationForDate(dateIso);
  return ["frueh", "spaet", "nacht"].find(s => rot[s] === emp.team) || null;
};

function getEmpAnyShiftOnDate(emp, dateIso, ignoreExtraId) {
  if (!emp || !dateIso) return null;
  const normDate = window.normalizeDateIso(dateIso);
  const reg = window.getEmpRegularShiftOnDate(emp, normDate);
  if (reg) return reg;
  const extra = extraShifts.find(es => es.id !== ignoreExtraId && es.empId === emp.id && window.normalizeDateIso(es.date) === normDate && (es.status === "approved" || es.status === "pending"));
  return extra ? extra.shift : null;
}

window.didEmpWorkNightBefore = function(emp, dateIso) {
  return (emp && dateIso) ? (getEmpAnyShiftOnDate(emp, getPrevDateIso(dateIso)) === "nacht") : false;
};

function getActiveLeaveForEmpOnDate(empId, isoDate) {
  const normDate = window.normalizeDateIso(isoDate);
  return sickLeaves.find(sl => {
    if (sl.empId !== empId || sl.status === "rejected" || sl.status === "pending" || sl.isOnboardingNotice || sl.lineRequestData) return false;
    if (sl.blocks && sl.blocks.length) {
      return sl.blocks.some(b => b.status === "approved" && window.normalizeDateIso(b.start) <= normDate && window.normalizeDateIso(b.end) >= normDate);
    }
    return sl.status === "approved" && window.normalizeDateIso(sl.startDate) <= normDate && window.normalizeDateIso(sl.endDate) >= normDate;
  });
}

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
    if (Array.isArray(sl.blocks) && sl.blocks.length > 0) {
      return sl.blocks.some(b => {
        if (!b || b.status === "rejected") return false;
        const bStart = window.normalizeDateIso(b.start);
        const bEnd = window.normalizeDateIso(b.end);
        return bStart && bEnd && !(bEnd < sIso || bStart > eIso);
      });
    }
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
      prevDaysMap[window.normalizeDateIso(d.date) + "_" + d.shift] = d;
    });
  }

  leaveRequests = (Array.isArray(leaveRequests) ? leaveRequests : []).filter(r => r.leaveId !== sl.id && r.id !== ("cov_" + sl.id));

  const initStatus = defaultDayStatus || "pending";
  const days = [];
  const seenDates = new Set();
  const blocksToProcess = (Array.isArray(sl.blocks) && sl.blocks.length > 0)
    ? sl.blocks.filter(b => b && b.status === "approved" && b.start && b.end)
    : (sl.status === "approved" ? [{ start: sl.startDate, end: sl.endDate, status: "approved" }] : []);

  blocksToProcess.forEach(b => {
    let curIso = window.normalizeDateIso(b.start);
    const endIso = window.normalizeDateIso(b.end);
    let safetyCounter = 0;
    while (curIso && endIso && curIso <= endIso && safetyCounter < 366) {
      safetyCounter++;
      if (!seenDates.has(curIso)) {
        seenDates.add(curIso);
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
      }
      curIso = getNextDateIso(curIso);
    }
  });

  days.sort((a, b) => a.date.localeCompare(b.date));

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

  const activeLeave = getActiveLeaveForEmpOnDate(emp.id, normDate);
  if (activeLeave) {
    return {
      ok: false,
      isWorkingConflict: false,
      reason: "Du bist am " + formatDateDe(normDate) + " als abwesend eingetragen (" + (activeLeave.category || "Urlaub/Krank") + ")."
    };
  }

  const regShift = window.getEmpRegularShiftOnDate(emp, normDate);
  if (regShift) {
    return {
      ok: false,
      isWorkingConflict: false,
      reason: "Du arbeitest am " + formatDateDe(normDate) + " laut Schichtplan bereits regulär in der " + (shiftsLabel[regShift] || regShift) + "."
    };
  }

  const warnings = [];
  let isNightConflict = false;

  if (isIsoDateSunday(normDate)) {
    if (shiftId === "nacht") isNightConflict = true;
    warnings.push("Der " + formatDateDe(normDate) + " ist ein Sonntag (jeder Sonntag ist regulär schichtfrei).");
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
  const nowIso = new Date().toISOString();
  const actor = fullName(emp) + " (Portal)";

  const newLeave = {
    id: "sl_" + nowMs,
    empId: emp.id,
    startDate: sNorm,
    endDate: eNorm,
    originalStartDate: sNorm,
    originalEndDate: eNorm,
    category: category || "Urlaub - bezahlt",
    reason: reason || "",
    status: isSick ? "approved" : "pending",
    plannerUnreadInfo: true,
    createdAt: nowIso,
    createdBy: actor,
    reviewedBy: "",
    reviewedAt: "",
    auditLog: []
  };
  appendAuditEntry(newLeave, (isSick ? "Krankmeldung" : "Antrag (" + (category || "Urlaub") + ")") + " im Portal eingereicht (" + formatDateDe(sNorm) + " – " + formatDateDe(eNorm) + ")", actor);

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
  const nowIso = new Date().toISOString();
  const actor = fullName(emp) + " (Portal)";
  const fsnCode = getShiftCodeLetter(dayObj.shift);

  const newExtra = {
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
    status: "pending",
    createdAt: nowIso,
    createdBy: actor,
    auditLog: []
  };
  appendAuditEntry(newExtra, "Gesuchte Bringschicht [" + fsnCode + "] am " + formatDateDe(normDate) + " im Portal übernommen", actor);

  extraShifts.push(newExtra);
  addHistoryLog(fullName(emp) + " meldet sich für gesuchte Bringschicht [" + fsnCode + "] am " + formatDateDe(normDate), "ABSENCE");
  saveToFirebase();
  return true;
};

function isExtraShiftInActiveWindow(es, nowObj) {
  if (!es || es.status !== "approved" || !es.date || !es.shift) return false;
  const now = nowObj || new Date();
  const normDate = window.normalizeDateIso(es.date);
  const p = String(normDate).split("-");
  if (p.length !== 3) return false;
  const y = Number(p[0]), m = Number(p[1]) - 1, d = Number(p[2]);

  let startHour = 6, endHour = 14;
  if (es.shift === "spaet") { startHour = 14; endHour = 22; }
  else if (es.shift === "nacht") { startHour = 22; endHour = 30; }

  return now >= new Date(y, m, d, startHour - 1, 0, 0) && now < new Date(y, m, d, endHour, 0, 0);
}

function getApprovedExtraShiftForToday(empId, nowObj) {
  const now = nowObj || new Date();
  const prodToday = getLogicalDateIso(now);
  return (Array.isArray(extraShifts) ? extraShifts : []).find(es =>
    es &&
    es.empId === empId &&
    es.status === "approved" &&
    (window.normalizeDateIso(es.date) === prodToday || isExtraShiftInActiveWindow(es, now))
  ) || null;
}
window.getApprovedExtraShiftForToday = getApprovedExtraShiftForToday;

window.syncAbsentAndExtraZones = function() {
  if (!hasLoadedFromCloud) return false;
  const now = new Date();
  const prodToday = getLogicalDateIso(now);
  const calToday = getTodayIso(now);
  const activeShiftNow = getCurrentActiveShiftId(now);
  let changed = false;

  employees.forEach(emp => {
    let activeLeave = getActiveLeaveForEmpOnDate(emp.id, prodToday) || getActiveLeaveForEmpOnDate(emp.id, calToday);

    if (activeLeave) {
      if (emp.zone !== "absent") { emp.zone = "absent"; changed = true; }
      return;
    } else if (emp.zone === "absent") {
      emp.zone = "pool"; changed = true;
    }

    const activeExtraToday = getApprovedExtraShiftForToday(emp.id, now);
    if (activeExtraToday && emp.zone === "pool") {
      emp.zone = "extra"; changed = true;
    } else if (!activeExtraToday && emp.zone === "extra") {
      emp.zone = "pool"; changed = true;
    } else if (!activeExtraToday && emp.zone && ["pool", "review", "absent", "extra"].indexOf(emp.zone) === -1) {
      const zShift = extractShiftIdFromZone(emp.zone);
      if (zShift && shiftRotation[zShift] !== emp.team && !emp.noRotation && zShift !== activeShiftNow) {
        const hadPastExtra = extraShifts.some(es => es.empId === emp.id && es.status === "approved" && es.shift === zShift);
        if (hadPastExtra) {
          emp.zone = "pool";
          changed = true;
        }
      }
    }
  });

  return changed;
};
/* ==========================================================================
   🧱 [LEGO-MODUL PLN-03 ENDE: HISTORIE, ABWESENHEITS- & 2-2-2 BRINGSCHICHT-LOGIK]
   ========================================================================== */
