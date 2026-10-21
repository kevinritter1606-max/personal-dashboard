/* ==========================================================================
   PLANER-BOARD LOGIK (planer.js) - Version 4.9.46 (All Helpers Fixed)
   ========================================================================== */

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

const defaultLines = ["32", "33", "34", "09", "22", "39", "36", "37", "38", "54"].map((n, idx) => ({
  id: "L" + n,
  name: "Linie " + n,
  floor: (idx < 3 ? "1. OG" : (idx < 7 ? "2. OG" : "3. OG")),
  prio: "",
  tag: "",
  note: "",
  ausgeplant: false,
  roleTargets: { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 },
  targetStaff: { frueh: 3, spaet: 3, nacht: 2 }
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
  lastRotationStepKey: "",
  lastResetRunKey: "",
  lastLoadRunKey: ""
};

let approvedShiftKey = "";
let hasLoadedFromCloud = false;
let isDraggingCard = false;
let lastBoardSnapshotForUndo = null;

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
let msgTimers = {};
let toastTimer = null;
let planerLastActivityTime = Date.now();

/* ==========================================================================
   ZENTRALE BASIS-FUNKTIONEN (HIER SIND ALLE HELFER FEST DEKLARIERT)
   ========================================================================== */

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
  });
  Object.keys(activeTeamFilters).forEach(k => {
    if (!teamsConfig[k]) delete activeTeamFilters[k];
  });
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

function updateShiftApprovalUI() {
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
}

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
  updateShiftApprovalUI();
  saveToFirebase();
};

function updateAutoRotationUI() {
  const isAuto = shiftModelConfig.autoRotate !== false;
  const badge = document.getElementById("autoRotationBadge");
  const badgeText = document.getElementById("autoRotationText");
  if (badge && badgeText) {
    badge.className = isAuto ? "auto-rotation-badge active" : "auto-rotation-badge";
    badgeText.textContent = isAuto ? "Auto: Vollkonti" : "Manuell";
  }
}

function updateSmartAssignUI() {
  const active = shiftModelConfig.smartAssignEnabled !== false;
  const badge = document.getElementById("smartAssignToggleBadge");
  const txt = document.getElementById("smartAssignBadgeText");
  if (badge && txt) {
    badge.className = active ? "smart-assign-badge active" : "smart-assign-badge";
    txt.textContent = active ? "Auto-Zuweisung: AN" : "Auto-Zuweisung: AUS";
  }
  const cfgChk = document.getElementById("cfgSmartAssignEnabled");
  if (cfgChk) cfgChk.checked = active;
}

window.toggleSmartAssignQuick = function() {
  shiftModelConfig.smartAssignEnabled = !(shiftModelConfig.smartAssignEnabled !== false);
  saveToFirebase();
  updateSmartAssignUI();
  showToast("Auto-Zuweisung: " + (shiftModelConfig.smartAssignEnabled !== false ? "AN" : "AUS"));
};

function getCalendarWeek(d) {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  return Math.ceil((firstThursday - target) / 604800000 + 1);
}

function updateHeaderDateKw() {
  const el = document.getElementById("headerDateKw");
  if (!el) return;
  const now = new Date();
  const ld = getLogicalDateObj(now);
  const activeShift = shiftsShortLabel[getCurrentActiveShiftId(now)] || "Früh";
  el.textContent = now.toLocaleDateString("de-DE", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }) + " · KW " + getCalendarWeek(ld) + " (" + activeShift + " aktiv)";
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

function getNextDateIso(isoDate) {
  const p = isoDate.split("-");
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + 1);
  return getTodayIso(d);
}

function fullName(e) {
  if (!e) return "";
  return ((e.firstName || "") + " " + (e.lastName || "")).trim();
}

function extractLineIdFromZone(z) {
  if (!z || ["pool", "absent", "extra"].indexOf(z) !== -1) return null;
  if (z.indexOf("_") === -1) return z;
  return z.split("_").slice(0, -1).join("_");
}

function extractShiftIdFromZone(z) {
  if (!z || ["pool", "absent", "extra"].indexOf(z) !== -1 || z.indexOf("_") === -1) return null;
  return z.split("_").pop();
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

/* ==========================================================================
   HISTORIE & LOGGING
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

/* ==========================================================================
   INIT BOARD & KARTEN RENDERING
   ========================================================================== */

window.initBoard = function() {
  if (isDraggingCard) return;
  sanitizeTeamReferences();
  syncAbsentAndExtraZones();
  updateHeaderDateKw();
  updateShiftApprovalUI();
  updateAutoRotationUI();
  updateSmartAssignUI();

  const headerRow = document.getElementById("headerRow");
  if (!headerRow) return;
  if (!Array.isArray(lines) || !lines.length) lines = defaultLines.slice();

  headerRow.innerHTML = '<th class="shift-header"><div>Schicht</div><div class="shift-controls"><button class="shift-rotate-btn" onclick="rotateAllShifts()"><span>🔄 Rotieren</span></button><button class="shift-auto-btn" onclick="smartAssignShiftSlot(\'frueh\'); smartAssignShiftSlot(\'spaet\'); smartAssignShiftSlot(\'nacht\')"><span>🪄 Alle Auto</span></button><button class="shift-clear-btn" onclick="clearEntireBoard()">🧹 Alle leeren</button></div></th>';

  lines.forEach(line => {
    if (!line.targetStaff) line.targetStaff = { frueh: 3, spaet: 3, nacht: 2 };
    if (!line.floor) line.floor = "1. OG";
    const th = document.createElement("th");
    th.className = "line-header" + (line.ausgeplant ? " ausgeplant" : "");
    if (isPlanner && plannerLevel > 2) {
      th.onclick = () => { window.openLineEditModal(line.id); };
    }
    const pCls = line.prio && (line.prio.indexOf("1") !== -1 || line.prio.indexOf("2") !== -1) ? "prio-high" : (line.prio ? "prio-mid" : "");
    const safeNote = (line.note || "").replace(/"/g, "&quot;");
    
    let floorClass = "";
    if (line.floor === "2. OG") floorClass = " floor-2";
    else if (line.floor === "3. OG") floorClass = " floor-3";
    else if (line.floor === "EG") floorClass = " floor-eg";

    th.innerHTML =
      '<div class="line-title-row">' +
        '<span class="line-floor-badge' + floorClass + '">' + line.floor + '</span>' +
        '<span class="line-title" title="' + line.name + '">' + line.name + '</span>' +
      '</div>' +
      '<div class="badge-container">' +
        (line.ausgeplant ? '<span class="line-ausgeplant-tag">🚫 Ausgeplant</span>' : '') +
        (line.prio ? '<span class="line-prio ' + pCls + '">' + line.prio + '</span>' : '') +
        (line.tag ? '<span class="line-status-tag">' + line.tag + '</span>' : '') +
      '</div>' +
      '<div class="line-role-summary-tag">Bediener, LOP</div>' +
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
    
    const tr = document.createElement("tr");
    const thS = document.createElement("th");
    thS.className = "shift-header";
    thS.innerHTML =
      '<div>' + shift.name + '</div>' + sunBadge +
      '<div class="shift-team-badge" style="border-left:3px solid ' + curObj.color + ';"><span style="color:' + curObj.color + ';">■</span> ' + curObj.name + '</div>' +
      '<div class="shift-controls">' +
        '<div class="shift-load-row">' +
          '<select id="teamSelect_' + shift.id + '" class="shift-team-select" style="border-left:4px solid ' + curObj.color + '; color:' + curObj.color + ';" onchange="onShiftTeamDropdownChange(\'' + shift.id + '\', this)">' + opts + '</select>' +
          '<button class="shift-load-btn" onclick="loadTeamToShift(\'' + shift.id + '\')" title="Team laden">📥</button>' +
          '<button class="shift-magic-btn" onclick="smartAssignShiftSlot(\'' + shift.id + '\')" title="Intelligente Auto-Zuweisung">🪄</button>' +
        '</div>' +
        '<button class="shift-undo-mini-btn" id="undoBtn_' + shift.id + '" onclick="undoLastAutoAssignment()">↩️ Rückgängig</button>' +
        '<button class="shift-clear-btn" onclick="clearShiftRow(\'' + shift.id + '\')">🧹 Leeren</button>' +
      '</div>';
    tr.appendChild(thS);

    lines.forEach(line => {
      const td = document.createElement("td");
      const zId = line.id + "_" + shift.id;
      const isOff = isShiftSundayOff || line.ausgeplant;
      td.innerHTML =
        '<div class="cell-wrapper">' +
          '<div id="bar_' + zId + '" class="zone-staff-bar"><span>0/0</span><span class="zone-missing-roles"></span></div>' +
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
  updateInboxBadge();
  checkBoardLockState();
  if (typeof syncShiftModelSettingsUI === "function") syncShiftModelSettingsUI();
  if (typeof syncSecurityConfigUI === "function") syncSecurityConfigUI();
};

function renderEmployees() {
  if (isDraggingCard) return;
  const dropZones = document.querySelectorAll(".drop-zone");
  if (!dropZones.length) return;
  dropZones.forEach(el => { el.innerHTML = ""; });

  const cellStats = {};
  lines.forEach(l => {
    shifts.forEach(s => {
      cellStats[l.id + "_" + s.id] = { count: 0, roles: {} };
    });
  });

  employees.forEach(emp => {
    const fName = fullName(emp);
    const pinNum = emp.pinnedZone ? getShortLineNumber(emp.pinnedZone) : "";
    const mainNums = Array.isArray(emp.mainLines) ? emp.mainLines.map(getShortLineNumber).filter(Boolean).join(", ") : "";
    const secNums = Array.isArray(emp.secLines) ? emp.secLines.map(getShortLineNumber).filter(Boolean).join(", ") : "";

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

    const zId = emp.zone;
    if (cellStats[zId]) {
      cellStats[zId].count++;
      const rName = emp.role || "Bediener";
      cellStats[zId].roles[rName] = (cellStats[zId].roles[rName] || 0) + 1;
    }

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
    const isInSidebar = (!emp.zone || emp.zone === "pool" || emp.zone === "extra" || emp.zone === "absent");

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

  lines.forEach(line => {
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
      const targetSoll = (line.targetStaff && typeof line.targetStaff[shift.id] === "number") ? line.targetStaff[shift.id] : 3;
      
      let statusCls = "status-ok";
      if (st.count < targetSoll) statusCls = "status-missing";
      else if (st.count > targetSoll) statusCls = "status-over";

      barEl.className = "zone-staff-bar " + statusCls;
      const diffTxt = st.count < targetSoll ? " (Fehlt: " + (targetSoll - st.count) + ")" : (st.count > targetSoll ? " (Überzählig)" : " ✓");
      barEl.innerHTML = '<span>' + st.count + ' / ' + targetSoll + diffTxt + '</span><span class="zone-missing-roles"></span>';
    });
  });

  const pEl = document.getElementById("pool");
  const eEl = document.getElementById("extra");
  const aEl = document.getElementById("absent");
  if (document.getElementById("poolCount")) document.getElementById("poolCount").textContent = "(" + (pEl ? pEl.children.length : 0) + ")";
  if (document.getElementById("extraCount")) document.getElementById("extraCount").textContent = "(" + (eEl ? eEl.children.length : 0) + ")";
  if (document.getElementById("absentCount")) document.getElementById("absentCount").textContent = "(" + (aEl ? aEl.children.length : 0) + ")";

  renderSidebarExtraPreview();
}

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
  if (evt) evt.stopPropagation();
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  emp.pinnedZone = null;
  addHistoryLog("PIN-Nadel für " + fullName(emp) + " entfernt", "PIN");
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
          if (newZone !== "pool" && newZone !== "absent" && newZone !== "extra") {
            emp.pinnedZone = newZone;
            emp.lastShiftId = extractShiftIdFromZone(newZone) || emp.lastShiftId;
          }
          saveToFirebase();
          renderEmployees();
        }
      }
    }));
  });
}

/* ==========================================================================
   SCHICHTEN LEEREN, LADEN & ROTIEREN
   ========================================================================== */

window.clearEntireBoard = function() {
  const todayIso = getTodayIso();
  employees.forEach(e => {
    if (e.zone && ["pool", "absent", "extra"].indexOf(e.zone) === -1 && !isEmpAnchorActiveToday(e, todayIso)) {
      e.zone = "pool";
    }
  });
  addHistoryLog("Komplettes Board in den Pool geleert", "SHIFT");
  saveToFirebase();
  renderEmployees();
  showToast("Alle Schichten geleert (PIN-Nadeln gespeichert)");
};

window.clearShiftRow = function(sId) {
  const todayIso = getTodayIso();
  employees.forEach(e => {
    if (extractShiftIdFromZone(e.zone) === sId && !isEmpAnchorActiveToday(e, todayIso)) {
      e.zone = "pool";
    }
  });
  saveToFirebase();
  renderEmployees();
  showToast((shiftsLabel[sId] || sId) + " geleert");
};

function distributeTeamToSlotInternal(teamKey, slotKey) {
  const todayIso = getTodayIso();
  employees.forEach(emp => {
    if (emp.team === teamKey && emp.zone !== "absent" && emp.zone !== "extra") {
      if (emp.noRotation && isEmpAnchorActiveToday(emp, todayIso) && emp.zone && ["pool", "absent", "extra"].indexOf(emp.zone) === -1) {
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
  shiftRotation[slotKey] = teamKey;
  distributeTeamToSlotInternal(teamKey, slotKey);
  const tName = teamsConfig[teamKey] ? teamsConfig[teamKey].name : teamKey;
  addHistoryLog(tName + " in " + (shiftsLabel[slotKey] || "Pool") + " geladen", "SHIFT");
  saveToFirebase();
  initBoard();
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
    initBoard();
    showToast("Schichten erfolgreich rotiert!");
  }
};

window.rotateAllShifts = function() {
  window.performShiftRotationLogic(false);
};

/* ==========================================================================
   FILTER & SUCHE IM POOL
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
  initBoard();
};

window.updatePoolSearch = function(val) {
  poolSearchQuery = (val || "").trim().toLowerCase();
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
   LINIEN-DETAILS MODAL
   ========================================================================== */

window.openLineEditModal = function(lineId) {
  if (typeof closeModal === "function") closeModal("settingsModal");

  const line = lines.find(l => l.id === lineId);
  if (!line) return;
  document.getElementById("editLineId").value = line.id;
  document.getElementById("lineEditTitle").textContent = "Linie bearbeiten: " + line.name;
  document.getElementById("editLineAusgeplant").checked = !!line.ausgeplant;
  document.getElementById("editLineFloor").value = line.floor || "1. OG";
  document.getElementById("editLinePrio").value = line.prio || "";
  document.getElementById("editLineTag").value = line.tag || "";
  document.getElementById("editLineNote").value = line.note || "";
  if (!line.targetStaff) line.targetStaff = { frueh: 3, spaet: 3, nacht: 2 };
  document.getElementById("editLineStaffFrueh").value = line.targetStaff.frueh ?? 3;
  document.getElementById("editLineStaffSpaet").value = line.targetStaff.spaet ?? 3;
  document.getElementById("editLineStaffNacht").value = line.targetStaff.nacht ?? 2;

  renderLineEditRoleTargets(line);
  document.getElementById("lineEditModal").style.display = "flex";
};

function renderLineEditRoleTargets(line) {
  const container = document.getElementById("editLineRoleTargetsContainer");
  if (!container) return;
  if (!line.roleTargets) line.roleTargets = { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 };
  container.innerHTML = roles.map(r => {
    const val = line.roleTargets[r] ?? (r === "Bediener" ? 2 : (r === "LOP" ? 1 : 0));
    return '<div class="role-target-item"><span>' + r + '</span><input type="number" min="0" max="10" value="' + val + '" data-role-target-input="' + r + '" onchange="saveLineDetails(true)"></div>';
  }).join("");
}

window.syncRoleSumToTargetStaff = function() {
  const inputs = document.querySelectorAll("[data-role-target-input]");
  let sum = 0;
  inputs.forEach(inp => { sum += parseInt(inp.value, 10) || 0; });
  if (sum > 0) {
    document.getElementById("editLineStaffFrueh").value = sum;
    document.getElementById("editLineStaffSpaet").value = sum;
    document.getElementById("editLineStaffNacht").value = Math.max(1, sum - 1);
    saveLineDetails(true);
    showToast("Soll-Bedarf aus Rollen übernommen (" + sum + ")");
  }
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
  line.targetStaff = {
    frueh: parseInt(document.getElementById("editLineStaffFrueh").value, 10) || 0,
    spaet: parseInt(document.getElementById("editLineStaffSpaet").value, 10) || 0,
    nacht: parseInt(document.getElementById("editLineStaffNacht").value, 10) || 0
  };

  if (!line.roleTargets) line.roleTargets = {};
  document.querySelectorAll("[data-role-target-input]").forEach(inp => {
    const rName = inp.getAttribute("data-role-target-input");
    line.roleTargets[rName] = parseInt(inp.value, 10) || 0;
  });

  saveToFirebase();
  initBoard();
  if (!isAuto) {
    if (typeof closeModal === "function") closeModal("lineEditModal");
    showToast("Linie gespeichert!");
  }
};

/* ==========================================================================
   EINSTELLUNGEN, MITARBEITER, SICHERHEIT, HISTORIE, BACKUPS, PROFIL
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
        ? '<button class="btn btn-outline" style="padding:2px 7px; font-size:0.68rem; color:#0284c7; border-color:#bae6fd;" onclick="resetEmployeePin(\'' + e.id + '\')">🔑 Reset</button>'
        : '';
      const ehBadge = e.ersthelfer ? ' <span style="color:#dc2626; font-weight:900;">+</span>' : '';
      const pinBadge = e.password ? '<span class="start-pin-badge" title="Start-PIN">PIN: ' + e.password + '</span>' : '<span class="own-pin-badge">Eigene PIN</span>';

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

  const roleListEl = document.getElementById("roleList");
  if (roleListEl) {
    roleListEl.innerHTML = roles.map((r, idx) =>
      '<div class="item-row"><span><b>' + r + '</b></span>' +
      '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteRole(' + idx + ')">🗑️ Löschen</button></div>'
    ).join("");
  }

  const lineListEl = document.getElementById("lineSettingsList");
  if (lineListEl) {
    lineListEl.innerHTML = lines.map(l =>
      '<div class="item-row"><span><b>[' + (l.floor || "1. OG") + '] ' + l.name + '</b> ' + (l.ausgeplant ? '<small style="color:#dc2626;">(Ausgeplant)</small>' : (l.prio ? '<small>(' + l.prio + ')</small>' : '')) + '</span>' +
      '<div style="display:flex; gap:6px;"><button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem;" onclick="openLineEditModal(\'' + l.id + '\')">✏️ Bearbeiten</button>' +
      '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteLine(\'' + l.id + '\')">🗑️</button></div></div>'
    ).join("");
  }

  const teamListEl = document.getElementById("teamSettingsList");
  if (teamListEl) {
    teamListEl.innerHTML = Object.keys(teamsConfig).sort().map(k => {
      const t = teamsConfig[k];
      return '<div class="item-row"><span><span style="color:' + t.color + '; font-weight:700;">■</span> <b>' + t.name + '</b></span>' +
        '<div style="display:flex; gap:8px; align-items:center;">' +
        '<label style="font-size:0.75rem; display:flex; align-items:center; gap:4px; cursor:pointer;"><input type="checkbox" ' + (t.rotates !== false ? 'checked' : '') + ' onchange="toggleTeamRotationSetting(\'' + k + '\', this.checked)"> Rotiert</label>' +
        (Object.keys(teamsConfig).length > 1 ? '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteTeam(\'' + k + '\')">🗑️</button>' : '') +
        '</div></div>';
    }).join("");
  }

  syncShiftModelSettingsUI();
  syncSecurityConfigUI();
  renderHistoryList();
  renderBackupList();
  renderProfileTab();
}

window.onEmpLineCheckboxChange = function() {
  window._tempEditEmpMainLines = Array.from(document.querySelectorAll(".emp-main-line-chk:checked")).map(c => c.value);
  window._tempEditEmpSecLines = Array.from(document.querySelectorAll(".emp-sec-line-chk:checked")).map(c => c.value);
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

  saveToFirebase();
  updateAutoRotationUI();
  updateSmartAssignUI();
  showToast("Schichtmodell & Auto-Zuweisung gespeichert!");
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
   ERWEITERTE HISTORIE
   ========================================================================== */

window.setHistoryCatFilter = function(cat) {
  activeHistoryCategory = cat || "ALL";
  document.querySelectorAll(".history-pill").forEach(p => p.classList.remove("active"));
  if (event && event.target) event.target.classList.add("active");
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
  const items = (Array.isArray(historyLogs) ? historyLogs : []).filter(item => {
    if (activeHistoryCategory !== "ALL" && item.category !== activeHistoryCategory) return false;
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
  try {
    const parsed = JSON.parse(b.data);
    if (Array.isArray(parsed.lines)) lines = parsed.lines;
    if (Array.isArray(parsed.roles)) roles = parsed.roles;
    if (Array.isArray(parsed.employees)) employees = parsed.employees;
    if (parsed.teamsConfig) teamsConfig = parsed.teamsConfig;
    if (parsed.shiftRotation) shiftRotation = parsed.shiftRotation;
    if (Array.isArray(parsed.sickLeaves)) sickLeaves = parsed.sickLeaves;
    if (Array.isArray(parsed.extraShifts)) extraShifts = parsed.extraShifts;
    addHistoryLog("Backup wiederhergestellt vom " + new Date(b.createdAt).toLocaleString("de-DE"), "BACKUP");
    saveToFirebase();
    initBoard();
    showToast("Backup erfolgreich wiederhergestellt!");
  } catch (e) {
    showToast("Fehler beim Wiederherstellen!", true);
  }
};

window.deleteBackup = function(id) {
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
  addHistoryLog("Persönliche PIN geändert von " + fullName(emp), "SECURITY");
  saveToFirebase();
  showTimedBoxMsg("profPinMsg", "✅ Deine persönliche PIN wurde erfolgreich geändert!", true);
  showToast("PIN aktualisiert!");
};

window.resetEmployeePin = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;
  const newPin = String(Math.floor(1000 + Math.random() * 9000));
  emp.password = newPin;
  emp.mustChangePw = true;
  addHistoryLog("Start-PIN für " + fullName(emp) + " zurückgesetzt", "SECURITY");
  saveToFirebase();
  renderSettingsLists();
  showToast("Neue einmalige Start-PIN für " + fullName(emp) + ": " + newPin);
};

window.deleteRole = function(idx) {
  if (roles.length <= 1) return;
  roles.splice(idx, 1);
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
  lines = lines.filter(l => l.id !== id);
  saveToFirebase();
  initBoard();
  renderSettingsLists();
  showToast("Linie gelöscht");
};

window.deleteTeam = function(k) {
  if (Object.keys(teamsConfig).length <= 1) {
    showToast("Mindestens ein Team muss erhalten bleiben!", true);
    return;
  }
  delete teamsConfig[k];
  delete activeTeamFilters[k];
  sanitizeTeamReferences();
  saveToFirebase();
  initBoard();
  renderSettingsLists();
  showToast("Team gelöscht");
};

window.deleteEmployee = function(id) {
  const emp = employees.find(e => e.id === id);
  employees = employees.filter(e => e.id !== id);
  if (emp) addHistoryLog("Mitarbeiter gelöscht: " + fullName(emp), "EMP");
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
    lines.push({
      id: "L" + (shortClean || Date.now()),
      name: val.indexOf("Linie") === 0 ? val : "Linie " + val,
      floor: floorSel ? floorSel.value : "1. OG",
      prio: "",
      tag: "",
      note: "",
      ausgeplant: false,
      roleTargets: { Bediener: 2, LOP: 1, TL: 0, Schichtexperte: 0, Waschraumoperator: 0 },
      targetStaff: { frueh: 3, spaet: 3, nacht: 2 }
    });
    inp.value = "";
    saveToFirebase();
    initBoard();
    renderSettingsLists();
    showToast("Linie hinzugefügt");
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
    saveToFirebase();
    initBoard();
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
   AUTOCOMPLETE & POSTFACH
   ========================================================================== */

window.onPlannerLoginInput = function(val) {
  selectedLoginPlannerId = null;
  const box = document.getElementById("plannerLoginSuggestions");
  const q = (val || "").trim().toLowerCase();
  if (!employees || !employees.length || q.length < 1) {
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

window.onManualSickNameInput = function(val) {
  selectedManualSickEmpId = null;
  const box = document.getElementById("manualSickSuggestions");
  const q = (val || "").trim().toLowerCase();
  if (!employees || !employees.length || q.length < 1) {
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

window.onManualExtraNameInput = function(val) {
  selectedManualExtraEmpId = null;
  const box = document.getElementById("manualExtraSuggestions");
  const q = (val || "").trim().toLowerCase();
  if (!employees || !employees.length || q.length < 1) {
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
  syncAbsentAndExtraZones();
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
  syncAbsentAndExtraZones();
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
  syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  updateInboxBadge();
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
    unreadEl.innerHTML = '<p style="font-size:0.8rem; color:#64748b;">Keine neuen Krankmeldungen oder offenen Anträge.</p>';
  } else {
    unreadEl.innerHTML = unreadItems.map(sl => {
      const emp = employees.find(e => e.id === sl.empId);
      const eName = emp ? fullName(emp) : "Unbekannt";
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
    syncAbsentAndExtraZones();
    renderEmployees();
    window.renderInboxLists();
    updateInboxBadge();
    showToast("Antrag genehmigt");
  }
};

window.rejectSickLeave = function(id) {
  const sl = sickLeaves.find(x => x.id === id);
  if (sl) {
    sl.status = "rejected";
    sl.plannerUnreadInfo = false;
    saveToFirebase();
    syncAbsentAndExtraZones();
    renderEmployees();
    window.renderInboxLists();
    updateInboxBadge();
    showToast("Antrag abgelehnt");
  }
};

window.deleteSickLeave = function(id) {
  sickLeaves = sickLeaves.filter(x => x.id !== id);
  saveToFirebase();
  syncAbsentAndExtraZones();
  renderEmployees();
  window.renderInboxLists();
  updateInboxBadge();
  showToast("Eintrag gelöscht");
};

window.deleteExtraShift = function(id) {
  extraShifts = extraShifts.filter(x => x.id !== id);
  saveToFirebase();
  syncAbsentAndExtraZones();
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
   FIREBASE CLOUD-SYNCHRONISATION & LOGIN
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

    sanitizeTeamReferences();
    syncAbsentAndExtraZones();
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
  sanitizeTeamReferences();
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
  checkBoardLockState();
}

window.logoutPlanner = function() {
  isPlanner = false;
  plannerLevel = 0;
  currentPlannerName = "";
  currentPlannerEmpId = null;
  ["planner_name", "planner_level", "planner_emp_id", "planner_last_active"].forEach(k => sessionStorage.removeItem(k));
  document.body.classList.remove("planner-active", "planner-lvl-2", "planner-lvl-3", "planner-lvl-4");
  ["pinModal", "inboxModal", "settingsModal", "lineEditModal"].forEach(closeModal);
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
    showTimedBoxMsg("loginModalError", "❌ Bitte wähle deinen Namen aus der Vorschlagsliste aus!", false);
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

  const pinModal = document.getElementById("pinModal");
  if (pinModal) pinModal.style.display = "none";

  applyPlannerLoginState(fullName(emp), Number(emp.accessLevel) || 2, emp.id);
  addHistoryLog(fullName(emp) + " hat sich angemeldet", "LOGIN");
  window.initBoard();
};

document.addEventListener("click", evt => {
  ["plannerLoginSuggestions", "manualSickSuggestions", "manualExtraSuggestions"].forEach(id => {
    const box = document.getElementById(id);
    if (box && !box.parentElement.contains(evt.target)) {
      box.style.display = "none";
    }
  });
});

window.addEventListener("DOMContentLoaded", function() {
  Object.keys(teamsConfig).forEach(k => { activeTeamFilters[k] = true; });
  roles.forEach(r => { activeRoleFilters[r] = true; });
  updateHeaderDateKw();
  updateShiftApprovalUI();
  updateAutoRotationUI();
  updateSmartAssignUI();

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
