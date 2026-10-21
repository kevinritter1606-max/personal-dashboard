/* ==========================================================================
   PLANER-BOARD MASTER-LOGIK (planer.js) - Version 4.9.60 (Complete & Verified)
   ========================================================================== */

window.PLANER_JS_VERSION = "4.9.60";

try {
  firebase.initializeApp({
    apiKey: "AIzaSyBPOYRYyUm5gA-j7YSAZl7EJoxedFhDTl4",
    authDomain: "schichtplan-bayer.firebaseapp.com",
    projectId: "schichtplan-bayer",
    storageBucket: "schichtplan-bayer.firebasestorage.app",
    messagingSenderId: "152929285194",
    appId: "1:152929285194:web:00b73aa6058a70aed3a2b3"
  });
} catch (e) {
  console.warn("Firebase bereits initialisiert:", e);
}

const db = firebase.firestore();
const boardRef = db.collection("shiftplan").doc("live_board");

const shifts = [
  { id: "frueh", name: "Früh" },
  { id: "spaet", name: "Spät" },
  { id: "nacht", name: "Nacht" }
];
const shiftsLabel = { frueh: "Frühschicht", spaet: "Spätschicht", nacht: "Nachtschicht" };
const shiftsShortLabel = { frueh: "Früh", spaet: "Spät", nacht: "Nacht" };
const weekdayShortNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

const defaultLines = ["32", "33", "34", "09", "22", "39", "36", "37", "38", "54"].map((n, idx) => ({
  id: "L" + n,
  name: "Linie " + n,
  floor: (idx < 3 ? "1. OG" : (idx < 7 ? "2. OG" : "3. OG")),
  prio: "",
  tag: "",
  note: "",
  ausgeplant: false,
  roleTargets: { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 }
}));

let shiftRotation = { frueh: "team-1", spaet: "team-2", nacht: "team-3", frei: "team-4" };
let lines = defaultLines.slice();
let roles = ["Bediener", "LOP", "TL", "Schichtexperte", "Waschraumoperator"];
let employees = [];
let sickLeaves = [];
let leaveRequests = [];
let extraShifts = [];
let historyLogs = [];
let backups = [];
let recentHistorySearches = [];

let teamsConfig = {
  "team-1": { name: "Team 1", color: "#0091df", rotates: true },
  "team-2": { name: "Team 2", color: "#f59e0b", rotates: true },
  "team-3": { name: "Team 3", color: "#10b981", rotates: true },
  "team-4": { name: "Team 4", color: "#f43f5e", rotates: true }
};

let securityConfig = { boardPwEnabled: false, boardPw: "0110", plannerTimeoutMin: 180 };
let shiftModelConfig = {
  model: "vollkonti_sonntag_frei",
  autoRotate: true,
  smartAssignEnabled: true,
  smartRespectFloorTL: true,
  smartAllowSwap: true,
  resetEnabled: false,
  resetDay: 0,
  resetHour: 6,
  loadEnabled: false,
  loadDay: 0,
  loadHour: 5,
  lastResetRunKey: "",
  lastLoadRunKey: "",
  // Punkt 13, 14, 17:
  secondaryUnlockThresholdHours: 1000,
  minDailyHoursForCounting: 6,
  roleRequiresLines: {
    "Bediener": true,
    "LOP": true,
    "TL": false,
    "Schichtexperte": false,
    "Waschraumoperator": false
  }
};

let approvedShiftKey = "";
let hasLoadedFromCloud = false;
let isDraggingCard = false;
let lastBoardSnapshotForUndo = null;
let pendingSecLineUnlockData = null;

let activeTeamFilters = {};
let activeRoleFilters = {};
let poolSearchQuery = "";
let settingsEmpSearchQuery = "";
let inboxSearchQuery = "";
let historySearchQuery = "";
let activeHistoryCategory = "ALL";

let selectedManualSickEmpId = null;
let selectedManualExtraEmpId = null;
let selectedLoginPlannerId = null;
let currentAnchorDaysSelection = [1, 2, 3, 4, 5];

let isPlanner = false;
let plannerLevel = 0;
let currentPlannerName = "";
let currentPlannerEmpId = null;

let sortableInstances = [];
let settingsSortableInstances = [];
let msgTimers = {};
let toastTimer = null;
let planerLastActivityTime = Date.now();

/* ==========================================================================
   1. GLOBALE BASIS- & HILFSFUNKTIONEN (CRASH-PROOF)
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
  t.style.background = isError ? "#dc2626" : "#16a34a";
  t.textContent = text;
  t.style.display = "block";
  toastTimer = setTimeout(() => { t.style.display = "none"; }, 3500);
}

function showTimedBoxMsg(elId, text, isSuccess) {
  const box = document.getElementById(elId);
  if (!box) return;
  if (msgTimers[elId]) clearTimeout(msgTimers[elId]);
  box.style.background = isSuccess ? "#dcfce7" : "#fee2e2";
  box.style.color = isSuccess ? "#166534" : "#b91c1c";
  box.textContent = text;
  box.style.display = "block";
  msgTimers[elId] = setTimeout(() => { box.style.display = "none"; }, 5000);
}

function getTodayIso(dObj) {
  const d = dObj || new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function formatDateDe(isoDate) {
  if (!isoDate) return "";
  const p = String(isoDate).split("-");
  if (p.length !== 3) return isoDate;
  return p[2] + "." + p[1] + "." + p[0];
}

function isIsoDateSunday(iso) {
  const p = (iso || "").split("-");
  return p.length === 3 && new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay() === 0;
}

function isSundayRestPeriod(baseDate) {
  const d = baseDate || new Date();
  return d.getDay() === 0 && d.getHours() < 21;
}

function isSundayDaytimeFree() {
  return isSundayRestPeriod(new Date());
}

function getLogicalDateObj(baseDate) {
  const now = baseDate || new Date();
  if (now.getDay() === 0 && now.getHours() >= 21) return now;
  return new Date(now.getTime() + 3 * 3600000);
}

function getLogicalDateIso(baseDate) {
  return getTodayIso(getLogicalDateObj(baseDate));
}

function getCurrentActiveShiftId(baseDate) {
  const h = (baseDate || new Date()).getHours();
  return (h >= 6 && h < 14) ? "frueh" : ((h >= 14 && h < 22) ? "spaet" : "nacht");
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

function getWorkdayBlockIndex(logicalIso) {
  const p = logicalIso.split("-");
  const diffDays = Math.floor((Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - Date.UTC(2026, 0, 12)) / 86400000);
  const weeks = Math.floor(diffDays / 7);
  const dayInWeek = ((diffDays % 7) + 7) % 7;
  return Math.floor((weeks * 6 + Math.min(dayInWeek, 5)) / 2);
}

function getPrevDateIso(isoDate) {
  const p = isoDate.split("-");
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() - 1);
  return getTodayIso(d);
}

function fullName(e) {
  if (!e) return "";
  return ((e.firstName || "") + " " + (e.lastName || "")).trim();
}

function extractLineIdFromZone(z) {
  if (!z || ["pool", "review", "absent", "extra"].indexOf(z) !== -1) return null;
  if (z.indexOf("_") === -1) return z;
  return z.split("_").slice(0, -1).join("_");
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
  const rawName = found ? found.name : String(pureId);
  return rawName.replace(/^Linie\s*/i, "").replace(/^L/i, "").trim();
}

function isTeamRotating(teamKey) {
  return teamsConfig[teamKey] ? (teamsConfig[teamKey].rotates !== false) : true;
}

function isEmpAnchorActiveToday(emp, dateIso) {
  if (!emp || !emp.noRotation) return false;
  const p = (dateIso || getTodayIso()).split("-");
  const jsDay = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
  const fixDays = Array.isArray(emp.fixDays) ? emp.fixDays : [1, 2, 3, 4, 5];
  return fixDays.indexOf(jsDay) !== -1;
}

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
    if (!emp.manualReviewQueue) emp.manualReviewQueue = [];
    if (!emp.trainingHoursByLine) emp.trainingHoursByLine = {};
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
  const lockModal = document.getElementById("boardLockModal");
  if (lockModal) lockModal.style.display = "none";
  window.handleLogoClick();
};

window.updateHeaderDateKw = function() {
  const el = document.getElementById("headerDateKw");
  if (!el) return;
  const now = new Date();
  const ld = getLogicalDateObj(now);
  const activeShift = shiftsShortLabel[getCurrentActiveShiftId(now)] || "Früh";
  el.textContent = now.toLocaleDateString("de-DE", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }) + " · KW " + getCalendarWeek(ld) + " (" + activeShift + " aktiv) · v" + window.PLANER_JS_VERSION;

  const warnBtn = document.getElementById("btnForceCacheReload");
  if (warnBtn) {
    if (window.EXPECTED_HTML_VERSION && window.EXPECTED_HTML_VERSION !== window.PLANER_JS_VERSION) {
      warnBtn.style.display = "inline-flex";
    } else {
      warnBtn.style.display = "none";
    }
  }
};

window.updateShiftApprovalUI = function() {
  const approved = isCurrentShiftApproved();
  const bar = document.getElementById("brandGradientBar");
  if (bar) bar.className = approved ? "brand-gradient approved" : "brand-gradient pending";

  const dot = document.getElementById("indicatorDot");
  const text = document.getElementById("indicatorText");
  const btn = document.getElementById("plannerApprovalIndicator");
  if (dot && text && btn) {
    dot.style.background = approved ? "#16a34a" : "#dc2626";
    text.textContent = approved ? "Freigegeben" : "Freigeben";
    btn.style.borderColor = approved ? "#86efac" : "#fecaca";
    btn.style.background = approved ? "#f0fdf4" : "#fef2f2";
    btn.style.color = approved ? "#166534" : "#b91c1c";
  }
};

window.toggleShiftApprovalState = function() {
  if (plannerLevel <= 2) return;
  const currentKey = getCurrentShiftApprovalKey();
  if (approvedShiftKey === currentKey) {
    approvedShiftKey = "";
    addHistoryLog("Schicht-Freigabe zurückgenommen", "SHIFT");
    showToast("Freigabe zurückgenommen");
  } else {
    approvedShiftKey = currentKey;
    addHistoryLog("Schicht freigegeben", "SHIFT");
    showToast("Aktuelle Schicht freigegeben!");
  }
  window.updateShiftApprovalUI();
  saveToFirebase();
};

/* ==========================================================================
   2. HISTORIE, ABWESENHEITS- & BRINGSCHICHT-PRÜFUNG
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

function getRotationForDate(targetIso) {
  const diff = getWorkdayBlockIndex(targetIso) - getWorkdayBlockIndex(getLogicalDateIso());
  const slotOrder = (shiftModelConfig && shiftModelConfig.model === "dreierschicht") ? ["frueh", "spaet", "nacht"] : ["frueh", "spaet", "nacht", "frei"];
  const activeSlots = slotOrder.filter(s => shiftRotation[s] && isTeamRotating(shiftRotation[s]));
  const res = Object.assign({}, shiftRotation);
  if (activeSlots.length >= 2 && shiftModelConfig.autoRotate !== false) {
    const len = activeSlots.length;
    activeSlots.forEach((fromSlot, idx) => {
      res[activeSlots[((idx + diff) % len + len) % len]] = shiftRotation[fromSlot];
    });
  }
  return res;
}

window.getEmpRegularShiftOnDate = function(emp, dateIso) {
  if (!emp || !dateIso || isIsoDateSunday(dateIso)) return null;
  const rot = getRotationForDate(dateIso);
  let empShift = ["frueh", "spaet", "nacht"].find(s => rot[s] === emp.team) || null;
  if (!empShift && isEmpAnchorActiveToday(emp, dateIso)) {
    empShift = extractShiftIdFromZone(emp.zone) || emp.lastShiftId || null;
  }
  return empShift;
};

window.didEmpWorkNightBefore = function(emp, dateIso) {
  if (!emp || !dateIso) return false;
  const prevIso = getPrevDateIso(dateIso);
  if (window.getEmpRegularShiftOnDate(emp, prevIso) === "nacht") return true;
  return extraShifts.some(es => es.empId === emp.id && es.date === prevIso && es.shift === "nacht" && (es.status === "approved" || es.status === "pending"));
};

function getActiveLeaveForEmpOnDate(empId, isoDate) {
  return sickLeaves.find(sl => {
    if (sl.empId !== empId || sl.status === "rejected" || sl.status === "pending") return false;
    if (sl.blocks && sl.blocks.length) {
      return sl.blocks.some(b => b.status === "approved" && b.start <= isoDate && b.end >= isoDate);
    }
    return sl.status === "approved" && sl.startDate <= isoDate && sl.endDate >= isoDate;
  });
}

function checkExtraShiftConflict(emp, dateIso, shiftId) {
  if (!emp || !dateIso || !shiftId) return null;
  const activeLeave = getActiveLeaveForEmpOnDate(emp.id, dateIso);
  if (activeLeave) return "Konflikt: Mitarbeiter ist am " + formatDateDe(dateIso) + " abwesend!";
  const regShift = window.getEmpRegularShiftOnDate(emp, dateIso);
  if (regShift === shiftId) return "Hinweis: Mitarbeiter hat am " + formatDateDe(dateIso) + " bereits regulär " + (shiftsLabel[shiftId] || shiftId) + ".";
  if ((shiftId === "frueh" || shiftId === "spaet") && window.didEmpWorkNightBefore(emp, dateIso)) {
    return "Ruhezeit-Warnung: Nachtschicht am Vortag!";
  }
  return null;
}

function isExtraShiftInActiveWindow(es, nowObj) {
  if (!es || es.status !== "approved" || !es.date || !es.shift) return false;
  const now = nowObj || new Date();
  const p = es.date.split("-");
  if (p.length !== 3) return false;
  const y = Number(p[0]), m = Number(p[1]) - 1, d = Number(p[2]);

  let startHour = 6, endHour = 14;
  if (es.shift === "frueh") { startHour = 6; endHour = 14; }
  else if (es.shift === "spaet") { startHour = 14; endHour = 22; }
  else if (es.shift === "nacht") { startHour = 22; endHour = 30; }

  const windowStart = new Date(y, m, d, startHour - 1, 0, 0);
  const windowEnd = new Date(y, m, d, endHour, 0, 0);
  return now >= windowStart && now < windowEnd;
}

window.syncAbsentAndExtraZones = function() {
  if (!hasLoadedFromCloud) return false;
  const now = new Date();
  const calToday = getTodayIso(now);
  const logToday = getLogicalDateIso(now);
  let changed = false;

  employees.forEach(emp => {
    let activeLeave = getActiveLeaveForEmpOnDate(emp.id, calToday);
    if (!activeLeave && logToday !== calToday && !isSundayRestPeriod(now)) {
      if (shiftRotation.nacht === emp.team) activeLeave = getActiveLeaveForEmpOnDate(emp.id, logToday);
    }

    if (activeLeave) {
      if (emp.zone !== "absent") {
        emp.zone = "absent";
        changed = true;
      }
      return;
    } else if (emp.zone === "absent") {
      emp.zone = "pool";
      changed = true;
    }

    const activeExtra = extraShifts.find(es => es.empId === emp.id && isExtraShiftInActiveWindow(es, now));
    if (activeExtra && emp.zone === "pool") {
      emp.zone = "extra";
      changed = true;
    } else if (!activeExtra && emp.zone === "extra") {
      emp.zone = "pool";
      changed = true;
    }
  });

  return changed;
};

/* ==========================================================================
   3. PUNKTE 13, 14 & 15: QUALIFIKATIONS-STUNDENZÄHLER & SEKUNDÄR-ANLAGEN
   ========================================================================== */

window.doesRoleRequireLines = function(roleName) {
  if (shiftModelConfig && shiftModelConfig.roleRequiresLines && typeof shiftModelConfig.roleRequiresLines[roleName] === "boolean") {
    return shiftModelConfig.roleRequiresLines[roleName];
  }
  const rLow = String(roleName || "").toLowerCase();
  if (rLow.indexOf("schichtexperte") !== -1 || rLow === "tl" || rLow.indexOf("teamleiter") !== -1) {
    return false;
  }
  return true;
};

window.recordManualAssignmentHours = function(empId, lineId, plannedHours) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  // Wenn die Rolle überhaupt keine Anlagen benötigt (z.B. Schichtexperte), kein Tracking
  if (!doesRoleRequireLines(emp.role)) return;

  // Wenn bereits Primär- oder freigeschaltete Sekundärlinie, kein Stundenzähler nötig
  const isMain = Array.isArray(emp.mainLines) && emp.mainLines.indexOf(lineId) !== -1;
  const isSec = Array.isArray(emp.secLines) && emp.secLines.indexOf(lineId) !== -1;
  if (isMain || isSec) return;

  // Punkt 13: Zähler akzeptiert Stunden ERST, wenn an diesem Tag >= 6 Stunden eingeplant
  const hours = parseFloat(plannedHours) || 8;
  const minRequired = (shiftModelConfig && typeof shiftModelConfig.minDailyHoursForCounting === "number") ? shiftModelConfig.minDailyHoursForCounting : 6;
  if (hours < minRequired) return;

  if (!emp.trainingHoursByLine) emp.trainingHoursByLine = {};
  emp.trainingHoursByLine[lineId] = (emp.trainingHoursByLine[lineId] || 0) + hours;

  const accumulated = emp.trainingHoursByLine[lineId];
  const threshold = (shiftModelConfig && typeof shiftModelConfig.secondaryUnlockThresholdHours === "number") ? shiftModelConfig.secondaryUnlockThresholdHours : 1000;

  if (accumulated >= threshold) {
    pendingSecLineUnlockData = { empId: emp.id, lineId: lineId };
    const textEl = document.getElementById("secLineUnlockText");
    if (textEl) {
      textEl.innerHTML = "<b>" + fullName(emp) + "</b> hat bereits <b>" + accumulated + " Stunden</b> (Schwellenwert: " + threshold + "h) an <b>" + getLineNameById(lineId) + "</b> absolviert.<br><br>Soll diese Anlage ab sofort als offizielle Sekundär-Anlage freigeschaltet werden?";
    }
    const modal = document.getElementById("secLineUnlockModal");
    if (modal) modal.style.display = "flex";
  }

  saveToFirebase();
  renderUnqualifiedHoursOverview();
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

// Punkt 15: Übersicht zeigt NUR noch nicht freigeschaltete Anlagen im Lernprozess
function renderUnqualifiedHoursOverview() {
  const container = document.getElementById("unqualifiedHoursOverviewList");
  if (!container) return;

  const threshold = (shiftModelConfig && typeof shiftModelConfig.secondaryUnlockThresholdHours === "number") ? shiftModelConfig.secondaryUnlockThresholdHours : 1000;
  const rows = [];

  employees.forEach(emp => {
    if (!emp.trainingHoursByLine) return;
    Object.entries(emp.trainingHoursByLine).forEach(([lineId, hours]) => {
      const isMain = Array.isArray(emp.mainLines) && emp.mainLines.indexOf(lineId) !== -1;
      const isSec = Array.isArray(emp.secLines) && emp.secLines.indexOf(lineId !== -1) !== -1;
      // Bereits freigeschaltete Anlagen interessieren hier nicht -> ausblenden
      if (!isMain && !isSec && hours > 0) {
        const remaining = Math.max(0, threshold - hours);
        rows.push(
          '<div style="display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px solid #f1f5f9;">' +
            '<span><b>' + fullName(emp) + '</b> ➔ ' + getLineNameById(lineId) + '</span>' +
            '<span>' + hours + 'h / ' + threshold + 'h (noch ' + remaining + 'h)</span>' +
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
   4. PUNKTE 3, 10, 11 & 18: STRIKTE PRIO 1–10 ZUWEISUNG & "NOCH ZUZUTEILEN"
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

window.smartAssignShiftSlot = function(shiftId) {
  if (shiftModelConfig.smartAssignEnabled === false) {
    showToast("Auto-Zuweisung ist ausgeschaltet!", true);
    return;
  }

  lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
  activateUndoButtons(shiftId);

  const teamKey = shiftRotation[shiftId];
  const activeLines = lines.filter(l => !l.ausgeplant);
  const todayIso = getTodayIso();

  // Nicht-fixierte Mitarbeiter dieser Schicht zuerst in den Pool holen
  employees.forEach(emp => {
    if (extractShiftIdFromZone(emp.zone) === shiftId && !isEmpAnchorActiveToday(emp, todayIso)) {
      emp.zone = "pool";
    }
  });

  const slotCandidates = employees.filter(emp => {
    if (emp.zone === "absent") return false;
    if (emp.noRotation && isEmpAnchorActiveToday(emp, todayIso)) return false;
    const isTeamMember = (emp.team === teamKey);
    const hasExtra = extraShifts.some(es => es.empId === emp.id && es.date === todayIso && es.shift === shiftId && es.status === "approved");
    return isTeamMember || hasExtra;
  });

  // Punkt 3: Strikte Sortierung von Prio 1 bis 10 (Höchste Priorität zuerst)
  const sortedLines = activeLines.slice().sort((a, b) => {
    const parsePrio = (pStr) => {
      const match = String(pStr || "").match(/\d+/);
      return match ? parseInt(match[0], 10) : 999;
    };
    return parsePrio(a.prio) - parsePrio(b.prio);
  });

  let assignedCount = 0;
  let swapCount = 0;

  function getLineEmps(lineId) {
    return employees.filter(e => extractLineIdFromZone(e.zone) === lineId && extractShiftIdFromZone(e.zone) === shiftId);
  }

  function getRoleTargetForLine(line, roleName) {
    const rt = line.roleTargets || {};
    return Number(rt[roleName] || 0);
  }

  function getLineTotalTarget(line) {
    const rt = line.roleTargets || {};
    return Object.values(rt).reduce((sum, v) => sum + (Number(v) || 0), 0) || 3;
  }

  function placeEmpOnLine(emp, line) {
    emp.zone = line.id + "_" + shiftId;
    emp.pinnedZone = emp.zone;
    emp.lastShiftId = shiftId;
    assignedCount++;
  }

  // Durchgang 1: Höher priorisierte Linien lückenlos nach geforderten Rollen besetzen
  sortedLines.forEach(line => {
    const totalSoll = getLineTotalTarget(line);
    roles.forEach(rName => {
      const roleSoll = getRoleTargetForLine(line, rName);
      if (roleSoll <= 0) return;

      while (getLineEmps(line.id).length < totalSoll) {
        const currentRoleCount = getLineEmps(line.id).filter(e => (e.role || "Bediener") === rName).length;
        if (currentRoleCount >= roleSoll) break;

        // 1. Zuerst passende Stammlinie (Primär-Linie)
        let cand = slotCandidates.find(e => {
          if (e.zone !== "pool" && e.zone !== "review" && e.zone !== "extra") return false;
          if ((e.role || "Bediener") !== rName) return false;
          return Array.isArray(e.mainLines) && e.mainLines.indexOf(line.id) !== -1;
        });

        // 2. Danach freigeschaltete Sekundärlinie
        if (!cand) {
          cand = slotCandidates.find(e => {
            if (e.zone !== "pool" && e.zone !== "review" && e.zone !== "extra") return false;
            if ((e.role || "Bediener") !== rName) return false;
            return Array.isArray(e.secLines) && e.secLines.indexOf(line.id) !== -1;
          });
        }

        if (!cand) break;
        placeEmpOnLine(cand, line);
      }
    });
  });

  // Durchgang 2: Restliche Plätze mit Stammlinien-Mitarbeitern auffüllen
  sortedLines.forEach(line => {
    const totalSoll = getLineTotalTarget(line);
    while (getLineEmps(line.id).length < totalSoll) {
      let cand = slotCandidates.find(e => {
        if (e.zone !== "pool" && e.zone !== "review" && e.zone !== "extra") return false;
        return Array.isArray(e.mainLines) && e.mainLines.indexOf(line.id) !== -1;
      });
      if (!cand) break;
      placeEmpOnLine(cand, line);
    }
  });

  // Durchgang 3: Sekundär-Linien auffüllen
  sortedLines.forEach(line => {
    const totalSoll = getLineTotalTarget(line);
    while (getLineEmps(line.id).length < totalSoll) {
      let cand = slotCandidates.find(e => {
        if (e.zone !== "pool" && e.zone !== "review" && e.zone !== "extra") return false;
        return Array.isArray(e.secLines) && e.secLines.indexOf(line.id) !== -1;
      });
      if (!cand) break;
      placeEmpOnLine(cand, line);
    }
  });

  // Durchgang 4: Automatischer Ringtausch für Spezialisten/Bringschichtler
  if (shiftModelConfig.smartAllowSwap !== false) {
    const unplaced = slotCandidates.filter(e => e.zone === "pool" || e.zone === "review" || e.zone === "extra");
    unplaced.forEach(cand => {
      const candLines = [].concat(cand.mainLines || [], cand.secLines || []);
      for (let i = 0; i < candLines.length; i++) {
        const fullLine = sortedLines.find(l => l.id === candLines[i]);
        if (!fullLine) continue;
        const currentEmps = getLineEmps(fullLine.id);
        const totalSoll = getLineTotalTarget(fullLine);
        if (currentEmps.length < totalSoll) {
          placeEmpOnLine(cand, fullLine);
          break;
        }
      }
    });
  }

  // Durchgang 5: Punkt 18 - Übrig gebliebene Mitarbeiter (deren Stammlinie besetzt ist
  // und die keine passende Zweitlinien-Qualifikation haben) wandern ins "Noch zuzuteilen"-Fenster
  slotCandidates.forEach(cand => {
    if (cand.zone === "pool" || cand.zone === "review" || cand.zone === "extra") {
      cand.zone = "review";
    }
  });

  const swapInfo = swapCount > 0 ? (" · " + swapCount + " Ringtausch") : "";
  addHistoryLog("Auto-Zuweisung für " + (shiftsLabel[shiftId] || shiftId) + " (" + assignedCount + " zugewiesen" + swapInfo + ")", "AUTO");
  saveToFirebase();
  window.initBoard();
  showToast("🪄 Auto-Zuweisung " + (shiftsLabel[shiftId] || shiftId) + " fertig (" + assignedCount + " MA)!");
};

/* ==========================================================================
   5. PUNKTE 4 & 5: GESTAFFELTER "AUTO SCHICHT RESET"
   ========================================================================== */

async function executeStaggeredAutoShiftReset() {
  // Schritt 1: Pool leeren / Board bereinigen
  const todayIso = getTodayIso();
  employees.forEach(e => {
    if (e.zone && ["pool", "review", "absent", "extra"].indexOf(e.zone) === -1 && !isEmpAnchorActiveToday(e, todayIso)) {
      e.zone = "pool";
    }
  });
  window.initBoard();
  await new Promise(r => setTimeout(r, 350));

  // Schritt 2: Schicht-Rotation ausführen (falls aktiv)
  if (shiftModelConfig.autoRotate !== false) {
    window.performShiftRotationLogic(true);
  }
  await new Promise(r => setTimeout(r, 350));

  // Schritt 3: Auto-Zuweisung für alle Schichten konfliktfrei nacheinander ausführen
  for (const s of shifts) {
    smartAssignShiftSlot(s.id);
    await new Promise(r => setTimeout(r, 200));
  }

  addHistoryLog("Zentraler 'Auto Schicht Reset' erfolgreich ausgeführt", "SHIFT");
  saveToFirebase();
}

function checkScheduledAutomations() {
  if (!hasLoadedFromCloud || isDraggingCard) return;
  if (!shiftModelConfig.resetEnabled) return;

  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const todayIso = getTodayIso(now);
  const targetDay = Number(shiftModelConfig.resetDay ?? 0);
  const targetHour = Number(shiftModelConfig.resetHour ?? 6);

  // targetDay === -1 bedeutet "Täglich"
  const dayMatches = (targetDay === -1 || targetDay === day);
  if (dayMatches && targetHour === hour) {
    const runKey = todayIso + "_" + hour;
    if (shiftModelConfig.lastResetRunKey !== runKey) {
      shiftModelConfig.lastResetRunKey = runKey;
      executeStaggeredAutoShiftReset();
    }
  }
}

setInterval(() => {
  if (!hasLoadedFromCloud || isDraggingCard) return;
  window.updateHeaderDateKw();
  const zChanged = window.syncAbsentAndExtraZones();
  if (zChanged) {
    saveToFirebase();
    renderEmployees();
  }
  checkScheduledAutomations();

  if (isPlanner) {
    const maxMs = (Number(securityConfig.plannerTimeoutMin) || 180) * 60000;
    if (Date.now() - planerLastActivityTime > maxMs) {
      window.logoutPlanner();
      showToast("Automatisch abgemeldet (Zeitüberschreitung)", true);
    }
  }
}, 30000);

/* ==========================================================================
   6. INIT BOARD & KARTEN RENDERING (MIT MOUSE-FIX & ROLLEN-SUMMEN)
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
        '<button class="shift-auto-btn" onclick="smartAssignShiftSlot(\'frueh\'); smartAssignShiftSlot(\'spaet\'); smartAssignShiftSlot(\'nacht\')"><span>🪄 Alle Auto</span></button>' +
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

    th.innerHTML =
      '<span class="line-floor-corner">' + line.floor + '</span>' +
      '<div class="line-title-row">' +
        '<span class="line-title" title="' + line.name + '">' + line.name + '</span>' +
      '</div>' +
      '<div class="badge-container">' +
        (line.ausgeplant ? '<span class="line-ausgeplant-tag">🚫 Ausgeplant</span>' : '') +
        prioBadgeHtml +
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

  shifts.forEach(shift => {
    const curKey = shiftRotation[shift.id] || keys[0];
    const curObj = teamsConfig[curKey] || { name: "Team", color: "#0091df" };
    const opts = keys.map(k => '<option value="' + k + '" style="color:' + teamsConfig[k].color + '; font-weight:700;" ' + (k === curKey ? 'selected' : '') + '>■ ' + teamsConfig[k].name + '</option>').join("");
    const isShiftSundayOff = sundayFree;
    const sunBadge = isShiftSundayOff ? '<div style="font-size:0.6rem; color:#0284c7; background:#e0f2fe; padding:1px 3px; border-radius:3px; margin-top:2px;">So. Frei</div>' : '';
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
          '<select id="teamSelect_' + shift.id + '" class="shift-team-select" style="border-left:4px solid ' + curObj.color + '; color:' + curObj.color + ';" onchange="onShiftTeamDropdownChange(\'' + shift.id + '\', this)">' + opts + '</select>' +
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
      const isOff = isShiftSundayOff || line.ausgeplant;
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
      if (!l.ausgeplant) {
        shiftStats[s.id].target += totalSoll;
      }
    });
  });

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
        if (lineObj) {
          floorTLMap[sId + "_" + (lineObj.floor || "1. OG")] = true;
        }
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

    let qualWarnHtml = "";
    const lineIdPure = extractLineIdFromZone(emp.zone);
    if (lineIdPure && !emp.noRotation) {
      const isMain = Array.isArray(emp.mainLines) && emp.mainLines.indexOf(lineIdPure) !== -1;
      const isSec = Array.isArray(emp.secLines) && emp.secLines.indexOf(lineIdPure) !== -1;
      const isPinnedHere = extractLineIdFromZone(emp.pinnedZone) === lineIdPure;
      if (!isMain && !isSec && !isPinnedHere) {
        qualWarnHtml = '<span class="card-qual-warn" title="⚠️ Linie nicht in Qualifikation hinterlegt!">⚠️</span>';
      }
    }

    let rightMetaHtml = "";
    const isInSidebar = (!emp.zone || emp.zone === "pool" || emp.zone === "review" || emp.zone === "extra" || emp.zone === "absent");

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

  // Zellen-Balken (Ist/Soll + Rollen-Lücken) aktualisieren
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
              missingRolesList.push((req - have) + " " + shortR);
            }
          }
        }
      });

      let statusCls = "status-ok";
      if (st.count < totalSoll || missingRolesList.length > 0) statusCls = "status-missing";
      else if (st.count > totalSoll) statusCls = "status-over";

      barEl.className = "zone-staff-bar " + statusCls;
      const countTxt = st.count + "/" + totalSoll + (st.count >= totalSoll && missingRolesList.length === 0 ? " ✓" : "");
      let rightRoleTxt = "";
      if (missingRolesList.length > 0) {
        rightRoleTxt = "Fehlt: " + missingRolesList.join(", ");
      } else if (tlSharedViaFloor) {
        rightRoleTxt = "🔗 TL " + (line.floor || "1. OG");
      }

      barEl.innerHTML = '<span>' + countTxt + '</span><span class="zone-missing-roles" title="' + rightRoleTxt + '">' + rightRoleTxt + '</span>';
    });
  });

  // Schicht-KPIs aktualisieren
  shifts.forEach(shift => {
    const kpiEl = document.getElementById("kpiRow_" + shift.id);
    if (!kpiEl) return;
    const sStat = shiftStats[shift.id];
    const staffOk = sStat.assigned >= sStat.target;
    const ehOk = sStat.eh >= 1;
    kpiEl.innerHTML =
      '<span class="shift-kpi-pill ' + (staffOk ? 'ok' : 'warn') + '" title="Eingeteilt / Gesamt-Soll">👥 ' + sStat.assigned + '/' + sStat.target + '</span>' +
      '<span class="shift-kpi-pill ' + (ehOk ? 'ok' : 'warn') + '" title="Ersthelfer in dieser Schicht">➕ ' + sStat.eh + ' EH</span>';
  });

  const pEl = document.getElementById("pool");
  const revEl = document.getElementById("review");
  const eEl = document.getElementById("extra");
  const aEl = document.getElementById("absent");
  if (document.getElementById("poolCount")) document.getElementById("poolCount").textContent = "(" + (pEl ? pEl.children.length : 0) + ")";
  if (document.getElementById("reviewCount")) document.getElementById("reviewCount").textContent = "(" + (revEl ? revEl.children.length : 0) + ")";
  if (document.getElementById("extraCount")) document.getElementById("extraCount").textContent = "(" + (eEl ? eEl.children.length : 0) + ")";
  if (document.getElementById("absentCount")) document.getElementById("absentCount").textContent = "(" + (aEl ? aEl.children.length : 0) + ")";

  renderSidebarExtraPreview();
}

window.moveAllReviewToPool = function() {
  let count = 0;
  employees.forEach(e => {
    if (e.zone === "review") {
      e.zone = "pool";
      count++;
    }
  });
  saveToFirebase();
  renderEmployees();
  showToast(count + " Mitarbeiter aus 'Noch zuzuteilen' in den Pool verschoben");
};

function renderSidebarExtraPreview() {
  const box = document.getElementById("approvedExtraList");
  if (!box) return;
  const todayIso = getTodayIso();
  const upcoming = extraShifts.filter(es => es.status === "approved" && es.date >= todayIso).slice(0, 5);
  if (!upcoming.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = upcoming.map(es => {
    const emp = employees.find(e => e.id === es.empId);
    const name = emp ? fullName(emp) : "Mitarbeiter";
    return '<div style="padding:2px 4px; color:#166534; background:#dcfce7; border-radius:3px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + name + ' · ' + formatDateDe(es.date) + ' (' + (shiftsShortLabel[es.shift] || es.shift) + ')">⏰ <b>' + name + '</b>: ' + formatDateDe(es.date).slice(0, 6) + ' (' + (shiftsShortLabel[es.shift] || es.shift) + ')</div>';
  }).join("");
}

window.clickPinButton = function(empId, evt) {
  if (evt) {
    evt.stopPropagation();
    evt.preventDefault();
  }
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
          if (newZone !== "pool" && newZone !== "review" && newZone !== "absent" && newZone !== "extra") {
            emp.pinnedZone = newZone;
            emp.lastShiftId = extractShiftIdFromZone(newZone) || emp.lastShiftId;

            // Punkt 13: Stundenzähler greift beim manuellen Zuweisen an fremde Anlagen (ab >= 6h)
            const targetLineId = extractLineIdFromZone(newZone);
            if (targetLineId) {
              const defaultShiftHours = (shiftModelConfig && typeof shiftModelConfig.defaultShiftHours === "number") ? shiftModelConfig.defaultShiftHours : 8;
              recordManualAssignmentHours(emp.id, targetLineId, defaultShiftHours);
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
   7. SCHICHTEN LEEREN, LADEN & ROTIEREN
   ========================================================================== */

window.clearEntireBoard = function() {
  lastBoardSnapshotForUndo = createBoardSnapshotForUndo();
  activateUndoButtons();
  const todayIso = getTodayIso();
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
  const todayIso = getTodayIso();
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
  const todayIso = getTodayIso();
  employees.forEach(emp => {
    if (emp.team === teamKey && emp.zone !== "absent" && emp.zone !== "extra") {
      if (emp.noRotation && isEmpAnchorActiveToday(emp, todayIso) && emp.zone && ["pool", "review", "absent", "extra"].indexOf(emp.zone) === -1) {
        return;
      }
      if (slotKey === "frei") {
        emp.zone = "pool";
        return;
      }
      let targetLineId = emp.pinnedZone ? extractLineIdFromZone(emp.pinnedZone) : null;
      let lineObj = targetLineId ? lines.find(l => l.id === targetLineId && !l.ausgeplant) : null;

      if (!lineObj && Array.isArray(emp.mainLines) && emp.mainLines.length > 0) {
        for (let i = 0; i < emp.mainLines.length; i++) {
          const candidate = lines.find(l => l.id === emp.mainLines[i] && !l.ausgeplant);
          if (candidate) {
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
  distributeTeamToSlotInternal(teamKey, slotKey);
  const tName = teamsConfig[teamKey] ? teamsConfig[teamKey].name : teamKey;
  addHistoryLog(tName + " in " + (shiftsLabel[slotKey] || "Pool") + " geladen", "SHIFT");
  saveToFirebase();
  window.initBoard();
  showToast(tName + " geladen!");
};

window.performShiftRotationLogic = function(silent) {
  const slotOrder = (shiftModelConfig && shiftModelConfig.model === "dreierschicht") ? ["frueh", "spaet", "nacht"] : ["frueh", "spaet", "nacht", "frei"];
  const activeSlots = slotOrder.filter(s => shiftRotation[s] && isTeamRotating(shiftRotation[s]));
  if (activeSlots.length < 2) return;
  const nextShiftRotation = Object.assign({}, shiftRotation);
  activeSlots.forEach((fromSlot, idx) => {
    const targetSlot = activeSlots[(idx + 1) % activeSlots.length];
    nextShiftRotation[targetSlot] = shiftRotation[fromSlot];
  });
  shiftRotation = nextShiftRotation;
  addHistoryLog("Schicht-Rotation ausgeführt", "SHIFT");
  if (!silent) {
    saveToFirebase();
    window.initBoard();
    showToast("Schichten erfolgreich rotiert!");
  }
};

window.rotateAllShifts = function() {
  window.performShiftRotationLogic(false);
};

/* ==========================================================================
   8. FILTER & SUCHE IM POOL
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
      saveToFirebase();
    };
  }
}

window.onShiftTeamDropdownChange = function(shiftId, selEl) {
  if (!selEl) return;
  shiftRotation[shiftId] = selEl.value;
  saveToFirebase();
  window.initBoard();
};

/* Punkt 2: Namenssuche im Pool erst ab 3 Buchstaben */
window.updatePoolSearch = function(val) {
  const rawVal = (val || "").trim();
  if (rawVal.length > 0 && rawVal.length < 3) {
    poolSearchQuery = "";
    const clearBtn = document.getElementById("clearSearchBtn");
    if (clearBtn) clearBtn.style.display = "block";
    renderEmployees();
    return;
  }
  poolSearchQuery = rawVal.toLowerCase();
  const clearBtn = document.getElementById("clearSearchBtn");
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
   9. LINIEN-DETAILS MODAL (PRIO 1-10 & ROLLEN-BEDARF)
   ========================================================================== */

window.openLineEditModal = function(lineId) {
  const line = lines.find(l => l.id === lineId);
  if (!line) return;
  document.getElementById("editLineId").value = line.id;
  document.getElementById("lineEditTitle").textContent = "Linie bearbeiten: " + line.name;
  document.getElementById("editLineAusgeplant").checked = !!line.ausgeplant;
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
    return '<div class="role-target-item"><span>' + r + '</span><input type="number" min="0" max="10" value="' + val + '" data-role-target-input="' + r + '" onchange="updateLineEditAutoTotal()"></div>';
  }).join("");
  updateLineEditAutoTotal();
}

window.updateLineEditAutoTotal = function() {
  const inputs = document.querySelectorAll("[data-role-target-input]");
  let sum = 0;
  inputs.forEach(inp => { sum += parseInt(inp.value, 10) || 0; });
  const badge = document.getElementById("editLineAutoTargetBadge");
  if (badge) badge.textContent = "Gesamt-Soll: " + sum;
};

window.saveLineDetails = function(isAuto) {
  const id = document.getElementById("editLineId").value;
  const line = lines.find(l => l.id === id);
  if (!line) return;
  line.ausgeplant = document.getElementById("editLineAusgeplant").checked;
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
   10. EINSTELLUNGEN, ROLLEN-HAKEN & SICHERHEIT
   ========================================================================== */

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

function renderSettingsLists() {
  const empListEl = document.getElementById("employeeList");
  if (empListEl) {
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
        ? '<button class="btn btn-outline" style="padding:2px 7px; font-size:0.68rem; color:#0284c7; border-color:#bae6fd;" onclick="resetEmployeePin(\'' + e.id + '\')" title="Neue einmalige Start-PIN generieren">🔑 Reset</button>'
        : '';
      const ehBadge = e.ersthelfer ? ' <span style="color:#dc2626; font-weight:900;">+</span>' : '';
      const pinVal = e.password || "1234";
      const isStartPin = (e.mustChangePw !== false);
      const pinBadge = isStartPin
        ? '<span class="start-pin-badge" title="Einmalige Start-PIN (noch nicht vom Mitarbeiter geändert)">🔑 Start-PIN: ' + pinVal + '</span>'
        : '<span class="own-pin-badge" title="Mitarbeiter hat eigene PIN vergeben">🔒 Eigene PIN</span>';

      return '<div class="item-row">' +
        '<div class="emp-row-info"><span style="color:' + tObj.color + '; font-weight:700;">■</span> <b>' + fullName(e) + '</b>' + ehBadge + ' <small style="color:#64748b;">(' + e.role + ')</small> ' + pinBadge + '</div>' +
        '<div class="emp-row-actions">' + pinAction +
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
      '<label style="font-size:0.74rem; display:inline-flex; align-items:center; gap:3px; cursor:pointer; background:#fff; padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px;"><input type="checkbox" value="' + l.id + '" class="emp-main-line-chk" ' + (currentMain.indexOf(l.id) !== -1 ? 'checked' : '') + ' onchange="onEmpLineCheckboxChange()"> ' + l.name + '</label>'
    ).join("");
  }
  if (secLinesBox) {
    secLinesBox.innerHTML = lines.map(l =>
      '<label style="font-size:0.74rem; display:inline-flex; align-items:center; gap:3px; cursor:pointer; background:#fff; padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px;"><input type="checkbox" value="' + l.id + '" class="emp-sec-line-chk" ' + (currentSec.indexOf(l.id) !== -1 ? 'checked' : '') + ' onchange="onEmpLineCheckboxChange()"> ' + l.name + '</label>'
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

  // Punkt 17: Rollenliste mit Haken "Anlagen abfragen für Onboarding"
  const roleListEl = document.getElementById("roleList");
  if (roleListEl) {
    if (!shiftModelConfig.roleRequiresLines) shiftModelConfig.roleRequiresLines = {};
    roleListEl.innerHTML = roles.map((r, idx) => {
      const needsLines = shiftModelConfig.roleRequiresLines[r] !== false;
      return '<div class="item-row" data-role-idx="' + idx + '" style="flex-wrap:wrap; gap:6px;">' +
        '<div style="display:flex; align-items:center; gap:6px;">' +
          '<span class="drag-handle" title="Ziehen zum Verschieben">☰</span>' +
          '<b>' + (idx + 1) + '. ' + r + '</b>' +
        '</div>' +
        '<div style="display:flex; gap:10px; align-items:center;">' +
          '<label style="font-size:0.73rem; display:flex; align-items:center; gap:4px; cursor:pointer; font-weight:600; color:#0369a1;" title="Bestimmt, ob Mitarbeiter dieser Rolle im Onboarding Linien auswählen müssen">' +
            '<input type="checkbox" ' + (needsLines ? 'checked' : '') + ' onchange="toggleRoleOnboardingLinesFlag(\'' + r + '\', this.checked)"> 🏭 Anlagen abfragen für Onboarding' +
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
        '<div style="display:flex; align-items:center; gap:6px; min-width:0;">' +
          '<span class="drag-handle" title="Ziehen zum Verschieben">☰</span>' +
          '<span><b>[' + (l.floor || "1. OG") + '] ' + l.name + '</b> ' +
          (l.ausgeplant ? '<small style="color:#dc2626; font-weight:700;">(Ausgeplant)</small>' : (l.prio ? '<small style="color:#b45309; font-weight:700;">(' + l.prio + ')</small>' : '')) +
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

window.syncShiftModelSettingsUI = function() {
  const autoChk = document.getElementById("cfgAutoRotate");
  if (autoChk) autoChk.checked = shiftModelConfig.autoRotate !== false;

  const smartChk = document.getElementById("cfgSmartAssignEnabled");
  if (smartChk) smartChk.checked = shiftModelConfig.smartAssignEnabled !== false;

  const floorChk = document.getElementById("cfgSmartRespectFloorTL");
  if (floorChk) floorChk.checked = shiftModelConfig.smartRespectFloorTL !== false;

  const swapChk = document.getElementById("cfgSmartAllowSwap");
  if (swapChk) swapChk.checked = shiftModelConfig.smartAllowSwap !== false;

  const resetChk = document.getElementById("cfgAutoShiftResetEnabled");
  if (resetChk) resetChk.checked = !!shiftModelConfig.resetEnabled;
  const resetDay = document.getElementById("cfgResetDay");
  if (resetDay) resetDay.value = String(shiftModelConfig.resetDay ?? 0);
  const resetHour = document.getElementById("cfgResetHour");
  if (resetHour) resetHour.value = String(shiftModelConfig.resetHour ?? 6);

  const threshInp = document.getElementById("cfgSecondaryUnlockHours");
  if (threshInp) threshInp.value = shiftModelConfig.secondaryUnlockThresholdHours ?? 1000;

  const hoursInp = document.getElementById("cfgDefaultShiftHours");
  if (hoursInp) hoursInp.value = shiftModelConfig.defaultShiftHours ?? 8;
};

window.saveShiftModelSettings = function() {
  const autoChk = document.getElementById("cfgAutoRotate");
  if (autoChk) shiftModelConfig.autoRotate = autoChk.checked;

  const smartChk = document.getElementById("cfgSmartAssignEnabled");
  if (smartChk) shiftModelConfig.smartAssignEnabled = smartChk.checked;

  const floorChk = document.getElementById("cfgSmartRespectFloorTL");
  if (floorChk) shiftModelConfig.smartRespectFloorTL = floorChk.checked;

  const swapChk = document.getElementById("cfgSmartAllowSwap");
  if (swapChk) shiftModelConfig.smartAllowSwap = swapChk.checked;

  const resetChk = document.getElementById("cfgAutoShiftResetEnabled");
  if (resetChk) shiftModelConfig.resetEnabled = resetChk.checked;
  const resetDay = document.getElementById("cfgResetDay");
  if (resetDay) shiftModelConfig.resetDay = parseInt(resetDay.value, 10) ?? 0;
  const resetHour = document.getElementById("cfgResetHour");
  if (resetHour) shiftModelConfig.resetHour = parseInt(resetHour.value, 10) ?? 6;

  const threshInp = document.getElementById("cfgSecondaryUnlockHours");
  if (threshInp) shiftModelConfig.secondaryUnlockThresholdHours = Math.max(6, parseInt(threshInp.value, 10) || 1000);

  const hoursInp = document.getElementById("cfgDefaultShiftHours");
  if (hoursInp) shiftModelConfig.defaultShiftHours = Math.max(1, parseFloat(hoursInp.value) || 8);

  saveToFirebase();
  window.updateAutoRotationUI();
  renderEmployees();
  showToast("Einstellungen & Stundenzähler gespeichert!");
};

window.toggleNewTeamForm = function() {
  const wrap = document.getElementById("newTeamFormWrapper");
  if (!wrap) return;
  wrap.style.display = (wrap.style.display === "none" || !wrap.style.display) ? "block" : "none";
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
   11. HISTORIE, BACKUPS & PROFIL
   ========================================================================== */

window.setHistoryCatFilter = function(cat, btnEl) {
  activeHistoryCategory = cat || "ALL";
  document.querySelectorAll(".history-pill").forEach(p => p.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
  renderHistoryList();
};

window.filterHistoryUnified = function() {
  renderHistoryList();
};

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
  if (!recentHistorySearches.length) {
    chipsContainer.innerHTML = "";
    return;
  }
  chipsContainer.innerHTML = '<span style="font-size:0.68rem; color:#64748b; font-weight:700;">Verlauf:</span>' + recentHistorySearches.map(term =>
    '<span class="recent-chip" onclick="useRecentHistorySearch(\'' + term.replace(/'/g, "\\'") + '\')">🕒 ' + term + '</span>'
  ).join("");
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
  let timeCutoff = 0;
  if (timeVal === "TODAY") timeCutoff = nowMs - 86400000;
  else if (timeVal === "7D") timeCutoff = nowMs - 7 * 86400000;
  else if (timeVal === "30D") timeCutoff = nowMs - 30 * 86400000;

  const items = (Array.isArray(historyLogs) ? historyLogs : []).filter(item => {
    if (activeHistoryCategory !== "ALL" && item.category !== activeHistoryCategory) return false;
    if (actorVal !== "ALL" && item.actor !== actorVal) return false;
    if (timeCutoff > 0) {
      const ts = item.timestamp ? new Date(item.timestamp).getTime() : nowMs;
      if (ts < timeCutoff) return false;
    }
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

  listEl.innerHTML = items.slice(0, 150).map(item => {
    const d = item.timestamp ? new Date(item.timestamp) : new Date();
    const dStr = d.toLocaleDateString("de-DE") + " " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    let catBg = "#f1f5f9", catCol = "#475569";
    if (item.category === "SHIFT") { catBg = "#e0f2fe"; catCol = "#0369a1"; }
    else if (item.category === "AUTO") { catBg = "#f5f3ff"; catCol = "#6d28d9"; }
    else if (item.category === "ABSENCE") { catBg = "#fff1f2"; catCol = "#be123c"; }
    else if (item.category === "LOGIN") { catBg = "#fef3c7"; catCol = "#b45309"; }
    else if (item.category === "BACKUP") { catBg = "#f0fdf4"; catCol = "#166534"; }

    return '<div class="item-row" style="font-size:0.78rem;">' +
      '<div><b>' + (item.text || "") + '</b> <div style="color:#64748b; font-size:0.7rem;">👤 ' + (item.actor || "System") + ' · ' + dStr + '</div></div>' +
      '<span style="font-size:0.65rem; padding:2px 6px; border-radius:4px; background:' + catBg + '; color:' + catCol + '; font-weight:700; white-space:nowrap;">' + (item.category || "INFO") + '</span>' +
    '</div>';
  }).join("");
}

window.createManualBackup = function() {
  const now = new Date();
  const snap = {
    id: "bak_" + now.getTime(),
    createdAt: now.toISOString(),
    createdBy: currentPlannerName || "Planer",
    data: JSON.stringify({
      lines: lines,
      roles: roles,
      employees: employees,
      teamsConfig: teamsConfig,
      shiftRotation: shiftRotation,
      sickLeaves: sickLeaves,
      extraShifts: extraShifts
    })
  };
  backups = Array.isArray(backups) ? backups : [];
  backups.unshift(snap);
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
  if (!emp) {
    showTimedBoxMsg("profPinMsg", "❌ Benutzerprofil nicht gefunden!", false);
    return;
  }
  if ((emp.password || "1234") !== oldPin) {
    showTimedBoxMsg("profPinMsg", "❌ Aktuelle PIN ist nicht korrekt!", false);
    return;
  }
  if (newPin.length < 4) {
    showTimedBoxMsg("profPinMsg", "❌ Neue PIN muss mindestens 4 Zeichen haben!", false);
    return;
  }
  if (newPin !== confPin) {
    showTimedBoxMsg("profPinMsg", "❌ Die neuen PINs stimmen nicht überein!", false);
    return;
  }
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

window.deleteRole = function(idx) {
  if (roles.length <= 1) {
    showToast("Mindestens eine Rolle muss erhalten bleiben!", true);
    return;
  }
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
  if (lines.length <= 1) {
    showToast("Mindestens eine Linie muss erhalten bleiben!", true);
    return;
  }
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
  if (Object.keys(teamsConfig).length <= 1) {
    showToast("Mindestens ein Team muss erhalten bleiben!", true);
    return;
  }
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
  if (!emp) return;
  if (!confirm("Sind Sie sicher, dass Sie den Mitarbeiter '" + fullName(emp) + "' dauerhaft löschen möchten?")) return;
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
  if (!fName || !lName) {
    showToast("Bitte Vor- und Nachname eingeben", true);
    return;
  }

  const mainChecked = Array.from(document.querySelectorAll(".emp-main-line-chk:checked")).map(c => c.value);
  const secChecked = Array.from(document.querySelectorAll(".emp-sec-line-chk:checked")).map(c => c.value);

  const teamVal = document.getElementById("newEmpTeam").value;
  const roleVal = document.getElementById("newEmpRole").value;
  const lvlVal = Number(document.getElementById("newEmpAccessLevel").value) || 1;
  const ersthelferVal = document.getElementById("newEmpFirstAider").checked;
  const noRotVal = document.getElementById("newEmpNoRotation").checked;

  if (id) {
    const emp = employees.find(e => e.id === id);
    if (emp) {
      emp.firstName = fName;
      emp.lastName = lName;
      emp.team = teamVal;
      emp.role = roleVal;
      emp.accessLevel = lvlVal;
      emp.ersthelfer = ersthelferVal;
      emp.noRotation = noRotVal;
      emp.fixDays = noRotVal ? currentAnchorDaysSelection.slice() : [1, 2, 3, 4, 5];
      emp.mainLines = mainChecked;
      emp.secLines = secChecked;
      addHistoryLog("Mitarbeiter aktualisiert: " + fullName(emp), "EMP");
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
      mainLines: mainChecked,
      secLines: secChecked,
      password: randomPin,
      mustChangePw: true,
      zone: "pool",
      pinnedZone: null
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
    shiftModelConfig.roleRequiresLines[val] = true;
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
   12. AUTOCOMPLETE & POSTFACH
   ========================================================================== */

/* Punkt 2: Namenssuche erst ab 3 Buchstaben */
window.onPlannerLoginInput = function(val) {
  selectedLoginPlannerId = null;
  const box = document.getElementById("plannerLoginSuggestions");
  const q = (val || "").trim().toLowerCase();
  if (!employees || !employees.length || q.length < 3) {
    if (box) box.style.display = "none";
    return;
  }
  const matches = employees.filter(e => (Number(e.accessLevel) || 1) >= 2 && fullName(e).toLowerCase().indexOf(q) !== -1);
  const listToRender = matches.length ? matches : employees.filter(e => fullName(e).toLowerCase().indexOf(q) !== -1);
  if (!listToRender.length) {
    if (box) box.style.display = "none";
    return;
  }
  if (box) {
    box.innerHTML = listToRender.map(e =>
      '<div class="suggestion-item" onclick="selectLoginPlannerEmp(\'' + e.id + '\')"><span><b>' + fullName(e) + '</b></span><small style="color:#64748b;">' + e.role + ' (Stufe ' + (e.accessLevel || 1) + ')</small></div>'
    ).join("");
    box.style.display = "block";
  }
};

window.selectLoginPlannerEmp = function(id) {
  const e = employees.find(x => x.id === id);
  if (e) {
    selectedLoginPlannerId = e.id;
    const inp = document.getElementById("loginPlannerName");
    if (inp) inp.value = fullName(e);
    const box = document.getElementById("plannerLoginSuggestions");
    if (box) box.style.display = "none";
    const pin = document.getElementById("pinInput");
    if (pin) pin.focus();
  }
};

/* Punkt 2: Namenssuche erst ab 3 Buchstaben */
window.onManualSickNameInput = function(val) {
  selectedManualSickEmpId = null;
  const box = document.getElementById("manualSickSuggestions");
  const q = (val || "").trim().toLowerCase();
  if (!employees || !employees.length || q.length < 3) {
    if (box) box.style.display = "none";
    return;
  }
  const matches = employees.filter(e => fullName(e).toLowerCase().indexOf(q) !== -1);
  if (!matches.length) {
    if (box) box.style.display = "none";
    return;
  }
  if (box) {
    box.innerHTML = matches.map(e =>
      '<div class="suggestion-item" onclick="selectManualSickEmp(\'' + e.id + '\')"><span><b>' + fullName(e) + '</b></span><small style="color:#64748b;">' + e.role + '</small></div>'
    ).join("");
    box.style.display = "block";
  }
};

window.selectManualSickEmp = function(id) {
  const e = employees.find(x => x.id === id);
  if (e) {
    selectedManualSickEmpId = e.id;
    const inp = document.getElementById("manualSickEmpInput");
    if (inp) inp.value = fullName(e);
    const box = document.getElementById("manualSickSuggestions");
    if (box) box.style.display = "none";
  }
};

/* Punkt 2: Namenssuche erst ab 3 Buchstaben */
window.onManualExtraNameInput = function(val) {
  selectedManualExtraEmpId = null;
  const box = document.getElementById("manualExtraSuggestions");
  const q = (val || "").trim().toLowerCase();
  if (!employees || !employees.length || q.length < 3) {
    if (box) box.style.display = "none";
    return;
  }
  const matches = employees.filter(e => fullName(e).toLowerCase().indexOf(q) !== -1);
  if (!matches.length) {
    if (box) box.style.display = "none";
    return;
  }
  if (box) {
    box.innerHTML = matches.map(e =>
      '<div class="suggestion-item" onclick="selectManualExtraEmp(\'' + e.id + '\')"><span><b>' + fullName(e) + '</b></span><small style="color:#64748b;">' + e.role + '</small></div>'
    ).join("");
    box.style.display = "block";
  }
};

window.selectManualExtraEmp = function(id) {
  const e = employees.find(x => x.id === id);
  if (e) {
    selectedManualExtraEmpId = e.id;
    const inp = document.getElementById("manualExtraEmpInput");
    if (inp) inp.value = fullName(e);
    const box = document.getElementById("manualExtraSuggestions");
    if (box) box.style.display = "none";
  }
};

window.addManualSickLeave = function() {
  if (!selectedManualSickEmpId) {
    const typed = (document.getElementById("manualSickEmpInput").value || "").trim().toLowerCase();
    const found = employees.find(e => fullName(e).toLowerCase() === typed);
    if (found) selectedManualSickEmpId = found.id;
  }
  if (!selectedManualSickEmpId) {
    showToast("Bitte Mitarbeiter auswählen", true);
    return;
  }
  const start = document.getElementById("manualSickStart").value;
  const end = document.getElementById("manualSickEnd").value;
  const cat = document.getElementById("manualSickCategory").value;
  const reason = document.getElementById("manualSickReason").value.trim();
  if (!start || !end || start > end) {
    showToast("Bitte gültigen Zeitraum auswählen", true);
    return;
  }

  const emp = employees.find(e => e.id === selectedManualSickEmpId);
  sickLeaves.push({
    id: "sl_" + Date.now(),
    empId: selectedManualSickEmpId,
    startDate: start,
    endDate: end,
    category: cat,
    reason: reason,
    status: "approved",
    reviewedBy: currentPlannerName || "Planer",
    reviewedAt: new Date().toISOString()
  });

  addHistoryLog("Abwesenheit (" + cat + ") für " + (emp ? fullName(emp) : "") + " eingetragen", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  showToast("Abwesenheit eingetragen & genehmigt!");

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
  if (!selectedManualExtraEmpId) {
    showToast("Bitte Mitarbeiter auswählen", true);
    return;
  }
  const dateVal = document.getElementById("manualExtraDate").value;
  const shiftVal = document.getElementById("manualExtraShift").value;
  const noteVal = document.getElementById("manualExtraNote").value.trim();
  if (!dateVal) {
    showToast("Bitte Datum auswählen", true);
    return;
  }

  const emp = employees.find(e => e.id === selectedManualExtraEmpId);
  const conflictWarning = checkExtraShiftConflict(emp, dateVal, shiftVal);

  extraShifts.push({
    id: "es_" + Date.now(),
    empId: selectedManualExtraEmpId,
    date: dateVal,
    shift: shiftVal,
    note: noteVal,
    status: "approved"
  });

  addHistoryLog("Bringschicht für " + (emp ? fullName(emp) : "") + " am " + formatDateDe(dateVal) + " (" + (shiftsShortLabel[shiftVal] || shiftVal) + ")", "ABSENCE");
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();

  if (conflictWarning) {
    showToast("⚠️ Eingetragen (" + conflictWarning + ")", true);
  } else {
    showToast("Bringschicht eingetragen & aktiviert (1h Vorlauf)!");
  }

  document.getElementById("manualExtraDate").value = "";
  document.getElementById("manualExtraNote").value = "";
  document.getElementById("manualExtraEmpInput").value = "";
  selectedManualExtraEmpId = null;
};

window.markAllSickLeavesRead = function() {
  sickLeaves.forEach(sl => {
    if (sl.status === "pending") sl.status = "approved";
    sl.plannerUnreadInfo = false;
  });
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
  showToast("Alle Meldungen bestätigt");
};

window.renderInboxLists = function() {
  const unreadEl = document.getElementById("unreadSickList");
  const extraListEl = document.getElementById("inboxExtraList");
  const activeListEl = document.getElementById("activeSickList");
  if (!unreadEl || !activeListEl) return;

  const globalQ = (document.getElementById("inboxSearchInput") ? document.getElementById("inboxSearchInput").value : "").trim().toLowerCase();
  const searchActive = (document.getElementById("inboxActiveSearchInput") ? document.getElementById("inboxActiveSearchInput").value : "").trim().toLowerCase();
  const curCatFilter = typeof activeInboxHistoryCategory !== "undefined" ? activeInboxHistoryCategory : "ALL";

  const unreadItems = sickLeaves.filter(sl => {
    if (sl.status !== "pending" && !sl.plannerUnreadInfo) return false;
    if (globalQ) {
      const emp = employees.find(e => e.id === sl.empId);
      const txt = ((emp ? fullName(emp) : "") + " " + (sl.category || "") + " " + (sl.reason || "")).toLowerCase();
      if (txt.indexOf(globalQ) === -1) return false;
    }
    return true;
  });

  if (!unreadItems.length) {
    unreadEl.innerHTML = '<p style="font-size:0.8rem; color:#64748b;">Keine neuen Krankmeldungen oder Onboarding-Meldungen.</p>';
  } else {
    unreadEl.innerHTML = unreadItems.map(sl => {
      const emp = employees.find(e => e.id === sl.empId);
      const eName = emp ? fullName(emp) : "Unbekannt";
      
      if (sl.isOnboardingNotice) {
        return '<div style="background:#fff; border:1px solid #bae6fd; border-left:4px solid var(--bayer-blue); padding:10px; border-radius:6px; margin-bottom:8px; font-size:0.82rem;">' +
          '<div style="display:flex; justify-content:space-between; align-items:center;"><b>' + eName + '</b><span style="color:var(--bayer-blue); font-weight:700;">' + sl.category + '</span></div>' +
          '<div style="color:#1e293b; margin:4px 0;">' + sl.reason + '</div>' +
          '<div style="display:flex; gap:6px; margin-top:6px;">' +
            '<button class="btn btn-primary" style="padding:3px 10px; font-size:0.74rem; background:#16a34a;" onclick="approveSickLeave(\'' + sl.id + '\')">✅ Zur Kenntnis / Gelesen</button>' +
          '</div>' +
        '</div>';
      }

      return '<div style="background:#fff; border:1px solid #cbd5e1; border-left:4px solid #dc2626; padding:10px; border-radius:6px; margin-bottom:8px; font-size:0.82rem;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;"><b>' + eName + '</b><span style="color:#b91c1c; font-weight:700;">' + (sl.category || 'Meldung') + '</span></div>' +
        '<div style="color:#475569; margin:3px 0;">Von ' + formatDateDe(sl.startDate) + ' bis ' + formatDateDe(sl.endDate) + (sl.reason ? ' · ' + sl.reason : '') + '</div>' +
        '<div style="display:flex; gap:6px; margin-top:6px;">' +
          '<button class="btn btn-primary" style="padding:3px 10px; font-size:0.74rem; background:#16a34a;" onclick="approveSickLeave(\'' + sl.id + '\')">✅ Genehmigen</button>' +
          '<button class="btn btn-outline" style="padding:3px 10px; font-size:0.74rem; color:#dc2626; border-color:#fca5a5;" onclick="rejectSickLeave(\'' + sl.id + '\')">❌ Ablehnen</button>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  if (extraListEl) {
    const approvedExtras = extraShifts.filter(es => {
      if (es.status !== "approved") return false;
      if (globalQ) {
        const emp = employees.find(e => e.id === es.empId);
        const txt = ((emp ? fullName(emp) : "") + " " + (es.note || "") + " " + (es.date || "")).toLowerCase();
        if (txt.indexOf(globalQ) === -1) return false;
      }
      return true;
    });
    if (!approvedExtras.length) {
      extraListEl.innerHTML = '<p style="font-size:0.8rem; color:#64748b;">Keine eingetragenen Bringschichten.</p>';
    } else {
      extraListEl.innerHTML = approvedExtras.map(es => {
        const emp = employees.find(e => e.id === es.empId);
        const eName = emp ? fullName(emp) : "Unbekannt";
        const conflict = checkExtraShiftConflict(emp, es.date, es.shift);
        const warnHtml = conflict ? '<div style="color:#dc2626; font-size:0.72rem; font-weight:700; margin-top:2px;">⚠️ ' + conflict + '</div>' : '';
        return '<div style="background:#fff; border:1px solid #86efac; padding:8px 10px; border-radius:6px; margin-bottom:6px; font-size:0.82rem; display:flex; justify-content:space-between; align-items:center;">' +
          '<div><b>' + eName + '</b> · Am ' + formatDateDe(es.date) + ' (' + (shiftsShortLabel[es.shift] || es.shift) + ')' + (es.note ? ' · ' + es.note : '') + warnHtml + '</div>' +
          '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.72rem; color:#dc2626;" onclick="deleteExtraShift(\'' + es.id + '\')">🗑️</button>' +
        '</div>';
      }).join("");
    }
  }

  const filteredActive = sickLeaves.filter(sl => {
    if (sl.status === "pending" && !sl.plannerUnreadInfo) return false;
    if (curCatFilter !== "ALL" && typeof classifyInboxActiveItem === "function" && classifyInboxActiveItem(sl) !== curCatFilter) return false;
    const emp = employees.find(e => e.id === sl.empId);
    const txt = ((emp ? fullName(emp) : "") + " " + (sl.category || "") + " " + (sl.reason || "")).toLowerCase();
    if (globalQ && txt.indexOf(globalQ) === -1) return false;
    if (searchActive && txt.indexOf(searchActive) === -1) return false;
    return true;
  });

  if (!filteredActive.length) {
    activeListEl.innerHTML = '<p style="font-size:0.8rem; color:#64748b;">Keine Einträge vorhanden.</p>';
  } else {
    activeListEl.innerHTML = filteredActive.map(sl => {
      const emp = employees.find(e => e.id === sl.empId);
      const eName = emp ? fullName(emp) : "Unbekannt";
      const stBadge = sl.status === "approved"
        ? '<span style="color:#166534; font-weight:700;">✅ Aktiv</span>'
        : '<span style="color:#b91c1c; font-weight:700;">❌ Abgelehnt</span>';
      return '<div style="background:#fff; border:1px solid #e2e8f0; padding:8px 10px; border-radius:6px; margin-bottom:6px; font-size:0.82rem; display:flex; justify-content:space-between; align-items:center;">' +
        '<div><b>' + eName + '</b> · <b>' + (sl.category || 'Abwesend') + '</b> (' + formatDateDe(sl.startDate) + ' bis ' + formatDateDe(sl.endDate) + ')' + (sl.reason ? ' · ' + sl.reason : '') + ' ' + stBadge + '</div>' +
        '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.72rem; color:#dc2626;" onclick="deleteSickLeave(\'' + sl.id + '\')">🗑️</button>' +
      '</div>';
    }).join("");
  }
};

window.approveSickLeave = function(id) {
  const sl = sickLeaves.find(x => x.id === id);
  if (sl) {
    sl.status = "approved";
    sl.plannerUnreadInfo = false;
    sl.reviewedBy = currentPlannerName || "Planer";
    sl.reviewedAt = new Date().toISOString();
    saveToFirebase();
    window.syncAbsentAndExtraZones();
    renderEmployees();
    window.renderInboxLists();
    window.updateInboxBadge();
    showToast("Antrag bestätigt");
  }
};

window.rejectSickLeave = function(id) {
  const sl = sickLeaves.find(x => x.id === id);
  if (sl) {
    sl.status = "rejected";
    sl.plannerUnreadInfo = false;
    saveToFirebase();
    window.syncAbsentAndExtraZones();
    renderEmployees();
    window.renderInboxLists();
    window.updateInboxBadge();
    showToast("Antrag abgelehnt");
  }
};

window.deleteSickLeave = function(id) {
  if (!confirm("Möchten Sie diesen Eintrag wirklich löschen?")) return;
  sickLeaves = sickLeaves.filter(x => x.id !== id);
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  window.updateInboxBadge();
  showToast("Eintrag gelöscht");
};

window.deleteExtraShift = function(id) {
  if (!confirm("Möchten Sie diese Bringschicht wirklich löschen?")) return;
  extraShifts = extraShifts.filter(x => x.id !== id);
  saveToFirebase();
  window.syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
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
  if (typeof toggleManualEntryBox === "function" && openSickForm) {
    toggleManualEntryBox(true);
    const today = getTodayIso();
    if (!document.getElementById("manualSickStart").value) document.getElementById("manualSickStart").value = today;
    if (!document.getElementById("manualSickEnd").value) document.getElementById("manualSickEnd").value = today;
  }
  if (typeof toggleManualExtraBox === "function" && openExtraForm) {
    toggleManualExtraBox(true);
    const today = getTodayIso();
    if (!document.getElementById("manualExtraDate").value) document.getElementById("manualExtraDate").value = today;
  }
  window.renderInboxLists();
};

window.updateInboxBadge = function() {
  const unreadCount = sickLeaves.filter(sl => sl.status === "pending" || sl.plannerUnreadInfo).length;
  const badge = document.getElementById("inboxBadge");
  if (badge) {
    badge.textContent = unreadCount;
    badge.style.display = unreadCount > 0 ? "inline-flex" : "none";
  }
};

/* ==========================================================================
   12. FIREBASE CLOUD-SYNCHRONISATION & LOGIN (INKL. PLANER-PIN-ZTWANG)
   ========================================================================== */

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
    }
    if (typeof d.approvedShiftKey === "string") approvedShiftKey = d.approvedShiftKey;
    if (Array.isArray(d.employees)) employees = d.employees;

    window.sanitizeTeamReferences();
    window.syncAbsentAndExtraZones();
    window.initBoard();
  } catch (err) {
    console.error("Fehler beim Verarbeiten der Cloud-Daten:", err);
  }
}

boardRef.onSnapshot(doc => {
  if (doc.exists && !isDraggingCard) applyIncomingDocData(doc.data());
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
  const payload = {
    lines: lines,
    roles: roles,
    employees: employees,
    teamsConfig: teamsConfig,
    sickLeaves: sickLeaves,
    leaveRequests: leaveRequests,
    extraShifts: extraShifts,
    historyLogs: historyLogs,
    backups: backups,
    shiftRotation: shiftRotation,
    securityConfig: securityConfig,
    shiftModelConfig: shiftModelConfig,
    approvedShiftKey: approvedShiftKey
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
  ["pinModal", "inboxModal", "settingsModal", "lineEditModal", "secLineUnlockModal", "plannerForcePinModal"].forEach(window.closeModal);
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
  if (!emp && typedName) {
    emp = employees.find(e => fullName(e).toLowerCase() === typedName);
  }

  if (!emp) {
    showTimedBoxMsg("loginModalError", "❌ Bitte tippe mind. 3 Buchstaben und wähle deinen Namen aus der Liste aus!", false);
    return;
  }

  if (Number(emp.accessLevel || 1) < 2) {
    showTimedBoxMsg("loginModalError", "❌ Keine Planer-Berechtigung (Mindestens Stufe 2 erforderlich)!", false);
    return;
  }

  if ((emp.password || "1234") !== pinVal) {
    showTimedBoxMsg("loginModalError", "❌ PIN nicht korrekt!", false);
    return;
  }

  const finishPlannerLogin = () => {
    window.closeModal("pinModal");
    applyPlannerLoginState(fullName(emp), Number(emp.accessLevel) || 2, emp.id);
    addHistoryLog(fullName(emp) + " hat sich angemeldet", "LOGIN");
    window.initBoard();
  };

  /* Punkt 16: Wenn Planer sich mit Start-PIN anmeldet, zwingend eigene PIN vergeben */
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
    errBox.textContent = "❌ Die eigene PIN muss mindestens 4 Zeichen lang sein!"; errBox.style.display = "block"; return;
  }
  if (p1 !== p2) {
    errBox.textContent = "❌ Die beiden PINs stimmen nicht überein!"; errBox.style.display = "block"; return;
  }

  emp.password = p1;
  emp.mustChangePw = false;
  saveToFirebase();

  window._pendingPlannerForceEmp = null;
  document.getElementById("plannerForcePinModal").style.display = "none";

  applyPlannerLoginState(fullName(emp), Number(emp.accessLevel) || 2, emp.id);
  addHistoryLog(fullName(emp) + " hat sich angemeldet und persönliche PIN vergeben", "LOGIN");
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
  Object.keys(teamsConfig).forEach(k => { activeTeamFilters[k] = true; });
  roles.forEach(r => { activeRoleFilters[r] = true; });
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
