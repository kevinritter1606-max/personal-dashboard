/* ==========================================================================
   PLANER-BOARD LOGIK (planer.js) - Vollständige korrigierte Version 4.9.37
   ========================================================================== */

try {
  firebase.initializeApp({
    apiKey: "AIzaSyBPOYRYyUm5gA-j7YSAZl7EJoxedFhDTl4", authDomain: "schichtplan-bayer.firebaseapp.com",
    projectId: "schichtplan-bayer", storageBucket: "schichtplan-bayer.firebasestorage.app",
    messagingSenderId: "152929285194", appId: "1:152929285194:web:00b73aa6058a70aed3a2b3"
  });
} catch(e) { console.warn("Firebase bereits initialisiert:", e); }

const db = firebase.firestore(), boardRef = db.collection("shiftplan").doc("live_board");
const shifts = [{ id: "frueh", name: "Früh" }, { id: "spaet", name: "Spät" }, { id: "nacht", name: "Nacht" }];
const shiftsLabel = { frueh: "Frühschicht", spaet: "Spätschicht", nacht: "Nachtschicht" };
const shiftsShortLabel = { frueh: "Früh", spaet: "Spät", nacht: "Nacht" };
const defaultLines = ["32","33","34","09","22","39","36","37","38","54"].map(n => ({ 
  id: "L" + n, name: "Linie " + n, prio: "", tag: "", note: "",
  targetStaff: { frueh: 3, spaet: 3, nacht: 2 }
}));

let shiftRotation = { frueh: "team-1", spaet: "team-2", nacht: "team-3", frei: "team-4" };
let lines = defaultLines.slice(), roles = ["Bediener", "LOP", "TL", "Schichtexperte", "Waschraumoperator"];
let employees = [], sickLeaves = [], leaveRequests = [], extraShifts = [], historyLogs = [], backups = [];
let teamsConfig = {
  "team-1": { name: "Team 1", color: "#0091df", rotates: true },
  "team-2": { name: "Team 2", color: "#f59e0b", rotates: true },
  "team-3": { name: "Team 3", color: "#10b981", rotates: true },
  "team-4": { name: "Team 4", color: "#f43f5e", rotates: true }
};
let securityConfig = { boardPwEnabled: false, boardPw: "0110", plannerTimeoutMin: 180 };
let shiftModelConfig = {
  model: "vollkonti_sonntag_frei", autoRotate: true,
  resetEnabled: true, resetDay: 0, resetHour: 6,
  loadEnabled: true, loadDay: 0, loadHour: 12,
  lastRotationStepKey: "", lastResetRunKey: "", lastLoadRunKey: ""
};

let approvedShiftKey = "", hasLoadedFromCloud = false, isDraggingCard = false;
let activeTeamFilters = {}, activeRoleFilters = {}, poolSearchQuery = "", settingsEmpSearchQuery = "";
let settingsEmpTeamFilter = "ALL", settingsEmpRoleFilter = "ALL", activeHistoryCategory = "ALL", inboxSearchQuery = "";
let selectedManualSickEmpId = null, selectedManualExtraEmpId = null, selectedLoginPlannerId = null;
let isPlanner = false, plannerLevel = 0, currentPlannerName = "", currentPlannerEmpId = null;
let sortableInstances = [], msgTimers = {}, toastTimer = null;

function showToast(text, isError) {
  const t = document.getElementById("toastBanner"); if (!t) return;
  if (toastTimer) clearTimeout(toastTimer);
  t.style.background = isError ? "#dc2626" : "#16a34a"; t.textContent = text; t.style.display = "block";
  toastTimer = setTimeout(() => { t.style.display = "none"; }, 3200);
}

function getTodayIso(dObj) {
  const d = dObj || new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function isIsoDateSunday(iso) {
  const p = (iso || "").split("-");
  return p.length === 3 && new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay() === 0;
}
function isSundayRestPeriod(baseDate) { return (baseDate || new Date()).getDay() === 0; }
function isSundayDaytimeFree() { return isSundayRestPeriod(new Date()); }
function getLogicalDateObj(baseDate) {
  const now = baseDate || new Date();
  if (now.getDay() === 0 && now.getHours() >= 21) return now;
  return new Date(now.getTime() + 3 * 3600000);
}
function getLogicalDateIso(baseDate) { return getTodayIso(getLogicalDateObj(baseDate)); }
function getCurrentActiveShiftId() {
  const h = new Date().getHours();
  return (h >= 6 && h < 14) ? "frueh" : ((h >= 14 && h < 22) ? "spaet" : "nacht");
}
function getCurrentShiftApprovalKey() { return getLogicalDateIso() + "_" + getCurrentActiveShiftId(); }
function isCurrentShiftApproved() { return approvedShiftKey === getCurrentShiftApprovalKey(); }

function getCalendarWeek(d) {
  try {
    const target = new Date(d.valueOf()), dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf(); target.setMonth(0, 1);
    if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
    return Math.ceil((firstThursday - target) / 604800000 + 1);
  } catch(e) { return 1; }
}

function getWorkdayBlockIndex(logicalIso) {
  try {
    const p = logicalIso.split("-");
    const diffDays = Math.floor((Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - Date.UTC(2026, 0, 12)) / 86400000);
    const weeks = Math.floor(diffDays / 7), dayInWeek = ((diffDays % 7) + 7) % 7;
    return Math.floor((weeks * 6 + Math.min(dayInWeek, 5)) / 2);
  } catch(e) { return 0; }
}

function getDatesInRange(startIso, endIso) {
  const res = [], pS = startIso.split("-"), pE = endIso.split("-");
  let cur = new Date(Date.UTC(Number(pS[0]), Number(pS[1]) - 1, Number(pS[2])));
  const end = new Date(Date.UTC(Number(pE[0]), Number(pE[1]) - 1, Number(pE[2])));
  while (cur <= end && res.length < 60) {
    res.push(cur.getUTCFullYear() + "-" + String(cur.getUTCMonth() + 1).padStart(2, "0") + "-" + String(cur.getUTCDate()).padStart(2, "0"));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return res;
}

function getPrevDateIso(isoDate) {
  const p = isoDate.split("-"), d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() - 1); return getTodayIso(d);
}
function getNextDateIso(isoDate) {
  const p = isoDate.split("-"), d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + 1); return getTodayIso(d);
}

function isEmpAnchorActiveToday(emp, dateIso) {
  if (!emp || !emp.noRotation) return false;
  const p = (dateIso || getTodayIso()).split("-");
  const jsDay = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
  const fixDays = Array.isArray(emp.fixDays) ? emp.fixDays : [1, 2, 3, 4, 5];
  return fixDays.indexOf(jsDay) !== -1;
}

function getRotationForDate(targetIso) {
  const diff = getWorkdayBlockIndex(targetIso) - getWorkdayBlockIndex(getLogicalDateIso());
  const slotOrder = (shiftModelConfig && shiftModelConfig.model === "dreierschicht") ? ["frueh", "spaet", "nacht"] : ["frueh", "spaet", "nacht", "frei"];
  const activeSlots = slotOrder.filter(s => shiftRotation[s] && isTeamRotating(shiftRotation[s]));
  const res = Object.assign({}, shiftRotation);
  if (activeSlots.length >= 2 && shiftModelConfig.autoRotate !== false) {
    const len = activeSlots.length;
    activeSlots.forEach((fromSlot, idx) => { res[activeSlots[((idx + diff) % len + len) % len]] = shiftRotation[fromSlot]; });
  }
  return res;
}

window.getEmpRegularShiftOnDate = function(emp, dateIso) {
  if (!emp || !dateIso || isIsoDateSunday(dateIso)) return null;
  const rot = getRotationForDate(dateIso);
  let empShift = ["frueh", "spaet", "nacht"].find(s => rot[s] === emp.team) || null;
  if (!empShift && isEmpAnchorActiveToday(emp, dateIso)) empShift = extractShiftIdFromZone(emp.zone) || emp.lastShiftId || null;
  return empShift;
};

window.didEmpWorkNightBefore = function(emp, dateIso) {
  if (!emp || !dateIso) return false;
  const prevIso = getPrevDateIso(dateIso);
  if (window.getEmpRegularShiftOnDate(emp, prevIso) === "nacht") return true;
  return extraShifts.some(es => es.empId === emp.id && es.date === prevIso && es.shift === "nacht" && (es.status === "approved" || es.status === "pending"));
};

window.checkExtraShiftPlausibility = function(empId, dateIso, shiftId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return { ok: false, reason: "Mitarbeiter nicht gefunden", code: "NO_EMP" };
  if (isIsoDateSunday(dateIso)) return { ok: false, reason: "Sonntags ist betriebsfrei", code: "SUNDAY_OFF" };
  if (hasLeaveOverlap(empId, dateIso, dateIso, null)) return { ok: false, reason: "An diesem Tag bereits als abwesend / im Urlaub eingetragen", code: "ON_LEAVE" };
  if (extraShifts.some(es => es.empId === empId && es.date === dateIso && es.status !== "rejected")) {
    return { ok: false, reason: "Für dieses Datum ist bereits eine Bringschicht gemeldet", code: "ALREADY_EXTRA" };
  }
  
  const nightBefore = window.didEmpWorkNightBefore(emp, dateIso);
  if (nightBefore && shiftId === "frueh") {
    return { ok: false, isWorkingConflict: false, reason: "Nach einer Nachtschicht ist direkt im Anschluss keine Frühschicht möglich (Ruhezeit)", code: "NIGHT_TO_EARLY_BLOCKED" };
  }
  if (nightBefore && shiftId === "spaet") {
    return {
      ok: false, isWorkingConflict: true, isNightShiftConflict: true, regularShift: "nacht_vortag",
      regularShiftLabel: "Nachtschicht (bis morgens)",
      reason: "Mitarbeiter hatte bis morgens Nachtschicht", code: "NIGHT_REST_WARNING"
    };
  }
  if (nightBefore && shiftId === "nacht") return { ok: true, regularShift: null, reason: "" };

  if (shiftId === "nacht") {
    const nextIso = getNextDateIso(dateIso);
    const nextRegShift = window.getEmpRegularShiftOnDate(emp, nextIso);
    const hasNextExtraEarly = extraShifts.some(es => es.empId === empId && es.date === nextIso && es.shift === "frueh" && es.status !== "rejected");
    if (nextRegShift === "frueh" || hasNextExtraEarly) {
      return { ok: false, isWorkingConflict: false, reason: "Nach einer Nachtschicht am " + formatDateDe(dateIso) + " ist am Folgetag keine Frühschicht möglich", code: "NIGHT_TO_EARLY_BLOCKED" };
    }
  }

  const regShift = window.getEmpRegularShiftOnDate(emp, dateIso);
  if (regShift) {
    return {
      ok: false, isWorkingConflict: true, regularShift: regShift, regularShiftLabel: shiftsLabel[regShift] || regShift,
      reason: "Laut Schichtplan am " + formatDateDe(dateIso) + " bereits regulär in der " + (shiftsLabel[regShift] || regShift) + " eingeteilt",
      code: "WORKING_REGULAR"
    };
  }
  return { ok: true, regularShift: null, reason: "" };
};

window.getEmpProbableLinesText = function(emp) {
  if (!emp) return "";
  const ids = [];
  if (emp.mainLines && emp.mainLines.length) emp.mainLines.forEach(id => { if (ids.indexOf(id) === -1) ids.push(id); });
  if (emp.lastLineId && ids.indexOf(emp.lastLineId) === -1) ids.unshift(emp.lastLineId);
  const nums = ids.map(id => { const l = lines.find(x => x.id === id); return l ? l.name.replace(/Linie\s*/i, "").trim() : null; }).filter(Boolean);
  if (!nums.length) return "";
  if (nums.length === 1) return "Voraussichtlich Linie " + nums[0];
  if (nums.length === 2) return "Voraussichtlich Linie " + nums[0] + " oder " + nums[1];
  return "Voraussichtlich Linie " + nums.slice(0, -1).join(", ") + " oder " + nums[nums.length - 1];
};

function getShiftTimeBounds(dateIso, shiftId) {
  const p = dateIso.split("-"), y = Number(p[0]), m = Number(p[1]) - 1, d = Number(p[2]);
  let startHour = 6, endHour = 14, endDayOffset = 0;
  if (shiftId === "frueh") { startHour = 6; endHour = 14; }
  else if (shiftId === "spaet") { startHour = 14; endHour = 22; }
  else if (shiftId === "nacht") { startHour = 22; endHour = 6; endDayOffset = 1; }
  const shiftStartMs = new Date(y, m, d, startHour, 0, 0, 0).getTime();
  const shiftEndMs = new Date(y, m, d + endDayOffset, endHour, 0, 0, 0).getTime();
  return { prepStartMs: shiftStartMs - 3600000, shiftStartMs: shiftStartMs, shiftEndMs: shiftEndMs };
}

function syncExtraZones() {
  if (!hasLoadedFromCloud) return false;
  const nowMs = Date.now(); let changed = false;
  extraShifts.forEach(es => {
    if (es.status !== "approved" || !es.date || !es.shift) return;
    const emp = employees.find(e => e.id === es.empId);
    if (!emp || emp.zone === "absent") return;
    const bounds = getShiftTimeBounds(es.date, es.shift);
    if (nowMs >= bounds.prepStartMs && nowMs < bounds.shiftEndMs) {
      if (!es.autoPlacedInBox) {
        es.autoPlacedInBox = true;
        if (!emp.zone || emp.zone === "pool") emp.zone = "extra";
        changed = true;
      }
    } else if (nowMs >= bounds.shiftEndMs && !es.autoCleanedAfterShift) {
      es.autoCleanedAfterShift = true;
      const empRegToday = window.getEmpRegularShiftOnDate(emp, getTodayIso());
      if (emp.zone === "extra" || (!empRegToday && extractLineIdFromZone(emp.zone))) emp.zone = "pool";
      changed = true;
    }
  });
  return changed;
}

function syncAbsentZones() {
  if (!hasLoadedFromCloud) return false;
  const now = new Date(), calToday = getTodayIso(now), logToday = getLogicalDateIso(now);
  let changed = false;
  employees.forEach(emp => {
    let activeLeave = getActiveLeaveForEmpOnDate(emp.id, calToday);
    if (!activeLeave && logToday !== calToday && !isSundayRestPeriod(now)) {
      if (shiftRotation.nacht === emp.team) activeLeave = getActiveLeaveForEmpOnDate(emp.id, logToday);
    }
    if (activeLeave && emp.zone !== "absent") { emp.zone = "absent"; changed = true; }
    else if (!activeLeave && emp.zone === "absent") { emp.zone = "pool"; changed = true; }
  });
  return changed;
}

function checkAndRunSundayResetAndRotation() {
  if (!hasLoadedFromCloud || !shiftModelConfig) return;
  const now = new Date(), day = now.getDay(), hour = now.getHours(), todayIso = getTodayIso(now);
  let changed = false;

  if (shiftModelConfig.resetEnabled !== false) {
    const targetDay = Number(shiftModelConfig.resetDay ?? 0);
    const targetHour = Number(shiftModelConfig.resetHour ?? 6);
    if (day === targetDay && hour >= targetHour) {
      const resetKey = "FLEX_RESET_" + todayIso;
      if (shiftModelConfig.lastResetRunKey !== resetKey) {
        shiftModelConfig.lastResetRunKey = resetKey;
        employees.forEach(emp => {
          if (emp.noRotation && isEmpAnchorActiveToday(emp, todayIso)) return;
          if (emp.zone && ["pool", "absent", "extra"].indexOf(emp.zone) === -1) { emp.zone = "pool"; changed = true; }
        });
        logHistory("Automatischer Pool-Reset", "Mitarbeiter automatisch in den Pool verschoben");
        changed = true;
      }
    }
  }

  if (shiftModelConfig.loadEnabled !== false) {
    const targetLoadDay = Number(shiftModelConfig.loadDay ?? 0);
    const targetLoadHour = Number(shiftModelConfig.loadHour ?? 12);
    if (day === targetLoadDay && hour >= targetLoadHour) {
      const loadKey = "FLEX_LOAD_" + todayIso;
      if (shiftModelConfig.lastLoadRunKey !== loadKey) {
        shiftModelConfig.lastLoadRunKey = loadKey;
        placeTeamsOnDefaultLines();
        logHistory("Automatisches Laden", "Teams automatisch auf Positionen geladen");
        changed = true;
      }
    }
  }

  if (shiftModelConfig.autoRotate === true) {
    const stepKey = "CYCLE8_" + getWorkdayBlockIndex(getLogicalDateIso(now));
    if (!shiftModelConfig.lastRotationStepKey || shiftModelConfig.lastRotationStepKey.indexOf("CYCLE8_") !== 0) {
      shiftModelConfig.lastRotationStepKey = stepKey; saveToFirebase(); return;
    }
    if (shiftModelConfig.lastRotationStepKey !== stepKey) {
      shiftModelConfig.lastRotationStepKey = stepKey;
      logHistory("Auto-Rotation", "Automatischer Schichtwechsel im 8-Werktage-Rhythmus ausgeführt");
      performShiftRotationLogic(true);
      return;
    }
  }
  if (changed) { saveToFirebase(); initBoard(); }
}

const ROUND_SYNC_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';
const ROUND_PAUSE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="9"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>';

function updateAutoRotationUI() {
  const isAuto = shiftModelConfig.autoRotate !== false;
  const badge = document.getElementById("autoRotationBadge"), badgeIcon = document.getElementById("autoRotationIcon"), badgeText = document.getElementById("autoRotationText");
  if (badge && badgeIcon && badgeText) {
    badge.className = isAuto ? "auto-rotation-badge active" : "auto-rotation-badge";
    badgeIcon.innerHTML = isAuto ? ROUND_SYNC_SVG : ROUND_PAUSE_SVG;
    badgeText.textContent = isAuto ? "Auto aktiv" : "Manuell";
  }
  document.querySelectorAll(".shift-rotate-btn").forEach(btn => {
    btn.innerHTML = '<span style="display:inline-flex; align-items:center; gap:5px; justify-content:center;">' + ROUND_SYNC_SVG + '<span>Rotieren</span></span>';
  });
  const chkAuto = document.getElementById("cfgAutoRotate"), hintEl = document.getElementById("cfgRotationStatusHint");
  if (chkAuto) chkAuto.checked = isAuto;
  if (hintEl) {
    const rEn = shiftModelConfig.resetEnabled !== false, lEn = shiftModelConfig.loadEnabled !== false;
    hintEl.textContent = isAuto ? `✅ Aktiv (Pool-Reset: ${rEn?'An':'Aus'} · Auto-Laden: ${lEn?'An':'Aus'})` : "⏸️ Automatik deaktiviert";
    hintEl.style.color = isAuto ? "#166534" : "#64748b";
  }
  
  const rChk = document.getElementById("cfgResetEnabled"), rDay = document.getElementById("cfgResetDay"), rHour = document.getElementById("cfgResetHour");
  const lChk = document.getElementById("cfgLoadEnabled"), lDay = document.getElementById("cfgLoadDay"), lHour = document.getElementById("cfgLoadHour");
  if (rChk) rChk.checked = shiftModelConfig.resetEnabled !== false;
  if (rDay) rDay.value = shiftModelConfig.resetDay ?? 0;
  if (rHour) rHour.value = shiftModelConfig.resetHour ?? 6;
  if (lChk) lChk.checked = shiftModelConfig.loadEnabled !== false;
  if (lDay) lDay.value = shiftModelConfig.loadDay ?? 0;
  if (lHour) lHour.value = shiftModelConfig.loadHour ?? 12;

  const freiWrap = document.getElementById("poolFreiControlWrap");
  if (freiWrap) freiWrap.style.display = "flex";
}

window.saveShiftModelSettings = function() {
  const chkAuto = document.getElementById("cfgAutoRotate");
  const rChk = document.getElementById("cfgResetEnabled"), rDay = document.getElementById("cfgResetDay"), rHour = document.getElementById("cfgResetHour");
  const lChk = document.getElementById("cfgLoadEnabled"), lDay = document.getElementById("cfgLoadDay"), lHour = document.getElementById("cfgLoadHour");

  shiftModelConfig.model = "vollkonti_sonntag_frei";
  if (chkAuto) shiftModelConfig.autoRotate = chkAuto.checked;
  if (rChk) shiftModelConfig.resetEnabled = rChk.checked;
  if (rDay) shiftModelConfig.resetDay = Number(rDay.value);
  if (rHour) shiftModelConfig.resetHour = Number(rHour.value);
  if (lChk) shiftModelConfig.loadEnabled = lChk.checked;
  if (lDay) shiftModelConfig.loadDay = Number(lDay.value);
  if (lHour) shiftModelConfig.loadHour = Number(lHour.value);

  logHistory("Schichtmodell", "Automatische Einstellungen aktualisiert");
  updateAutoRotationUI(); updateHeaderDateKw(); updateShiftApprovalUI(); saveToFirebase(); initBoard();
  showToast("✅ Einstellungen gespeichert!");
};

window.toggleTeamRotationSetting = function(teamKey, isChecked) {
  if (teamsConfig[teamKey]) {
    teamsConfig[teamKey].rotates = isChecked;
    saveToFirebase(); initBoard();
    showToast("Team-Rotation für " + teamsConfig[teamKey].name + " aktualisiert!");
  }
};

window.toggleNewTeamForm = function() {
  const wrap = document.getElementById("newTeamFormWrapper"), btn = document.getElementById("toggleNewTeamBtn");
  if (wrap) {
    const isHidden = wrap.style.display === "none";
    wrap.style.display = isHidden ? "block" : "none";
    if (btn) btn.textContent = isHidden ? "✖ Abbrechen" : "+ Neues Team hinzufügen";
  }
};

function updateShiftApprovalUI() {
  const approved = isCurrentShiftApproved();
  const bar = document.getElementById("brandGradientBar");
  if (bar) bar.className = approved ? "brand-gradient approved" : "brand-gradient pending";

  const dot = document.getElementById("indicatorDot"), text = document.getElementById("indicatorText"), btn = document.getElementById("plannerApprovalIndicator");
  if (dot && text && btn) {
    dot.style.background = approved ? "#16a34a" : "#dc2626"; text.textContent = approved ? "Freigegeben" : "Freigeben";
    btn.style.borderColor = approved ? "#86efac" : "#fecaca"; btn.style.background = approved ? "#f0fdf4" : "#fef2f2"; btn.style.color = approved ? "#166534" : "#b91c1c";
  }
}

window.toggleShiftApprovalState = function() {
  if (plannerLevel <= 2) return;
  const currentKey = getCurrentShiftApprovalKey();
  approvedShiftKey = (approvedShiftKey === currentKey) ? "" : currentKey;
  logHistory("Freigabe", approvedShiftKey ? "Schicht bestätigt & freigegeben" : "Schichtfreigabe zurückgezogen");
  updateShiftApprovalUI(); saveToFirebase();
};

window.deleteEmployee = function(empId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp || !canManageEmployee(emp)) { showToast("❌ Keine Berechtigung!", true); return; }
  if (!confirm(`Mitarbeiter "${fullName(emp)}" wirklich löschen?`)) return;
  employees = employees.filter(e => e.id !== empId);
  logHistory("Personal", `Mitarbeiter "${fullName(emp)}" gelöscht`);
  saveToFirebase(); renderEmployees(); renderSettingsLists();
  showToast("Mitarbeiter erfolgreich gelöscht");
};

let lastWatchedShiftKey = getCurrentShiftApprovalKey();
setInterval(function() {
  const currentKey = getCurrentShiftApprovalKey(); let needsSave = false;
  if (currentKey !== lastWatchedShiftKey) { lastWatchedShiftKey = currentKey; updateHeaderDateKw(); updateShiftApprovalUI(); updateAutoRotationUI(); }
  if (syncAbsentZones()) needsSave = true;
  if (syncExtraZones()) needsSave = true;
  if (needsSave) { saveToFirebase(); renderEmployees(); }
  checkAndRunSundayResetAndRotation();
}, 20000);

let planerLastActivityTime = Date.now();
function resetPlanerActivity() {
  planerLastActivityTime = Date.now();
  if (isPlanner) sessionStorage.setItem("planner_last_active", String(planerLastActivityTime));
}
setInterval(function() {
  const timeoutMin = Number(securityConfig.plannerTimeoutMin);
  if (isPlanner && timeoutMin > 0 && (Date.now() - planerLastActivityTime > timeoutMin * 60000)) logoutPlanner();
}, 15000);

function fullName(e) { return ((e.firstName || "") + " " + (e.lastName || "")).trim(); }
function extractLineIdFromZone(z) { return (!z || ["pool","absent","extra"].indexOf(z) !== -1 || z.indexOf("_") === -1) ? null : z.split("_").slice(0, -1).join("_"); }
function extractShiftIdFromZone(z) { return (!z || ["pool","absent","extra"].indexOf(z) !== -1 || z.indexOf("_") === -1) ? null : z.split("_").pop(); }
function isTeamRotating(teamKey) { return teamsConfig[teamKey] ? (teamsConfig[teamKey].rotates !== false) : true; }
function isEmpProtectedFromRotation(emp) { return !!(emp.noRotation || !isTeamRotating(emp.team)); }

function getMaxAssignableLevel() { return plannerLevel >= 4 ? 4 : (plannerLevel === 3 ? 2 : (plannerLevel === 2 ? 1 : 0)); }
function canManageEmployee(targetEmp) {
  if (!isPlanner) return false;
  if (!targetEmp) return plannerLevel >= 2;
  if (targetEmp.id === currentPlannerEmpId) return true;
  const targetLvl = Number(targetEmp.accessLevel || 1);
  if (plannerLevel >= 4) return targetLvl <= 4;
  return targetLvl < plannerLevel;
}
function updateAccessLevelDropdownOptions(selectedLvl) {
  const sel = document.getElementById("newEmpAccessLevel"); if (!sel) return;
  const maxLvl = getMaxAssignableLevel();
  const labels = { 1: "Mitarbeiter (Stufe 1)", 2: "Schichtführer (Stufe 2)", 3: "Planer (Stufe 3)", 4: "Admin (Stufe 4)" };
  let html = "";
  for (let l = 1; l <= maxLvl; l++) html += '<option value="' + l + '"' + (Number(selectedLvl || 1) === l ? ' selected' : '') + '>' + labels[l] + '</option>';
  sel.innerHTML = html;
}

function sanitizeTeamReferences() {
  const validKeys = Object.keys(teamsConfig);
  if (!validKeys.length) { teamsConfig["team-1"] = { name: "Team 1", color: "#0091df", rotates: true }; validKeys.push("team-1"); }
  const fallbackKey = validKeys[0];
  ["frueh", "spaet", "nacht", "frei"].forEach(slot => { if (!shiftRotation[slot] || !teamsConfig[shiftRotation[slot]]) shiftRotation[slot] = fallbackKey; });
  employees.forEach(emp => { if (!emp.team || !teamsConfig[emp.team]) emp.team = fallbackKey; });
  Object.keys(activeTeamFilters).forEach(k => { if (!teamsConfig[k]) delete activeTeamFilters[k]; });
}

window.deletePin = function(id) {
  const emp = employees.find(e => e.id === id);
  if (emp) { delete emp.lastLineId; logHistory("Nadel", "Stammlinie für " + fullName(emp) + " gelöscht"); saveToFirebase(); renderEmployees(); }
};

function updateHeaderDateKw() {
  const el = document.getElementById("headerDateKw"); if (!el) return;
  const now = new Date(), ld = getLogicalDateObj(now);
  el.textContent = now.toLocaleDateString("de-DE", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }) + " · KW " + getCalendarWeek(ld);
}

function showTimedBoxMsg(elId, text, isSuccess) {
  const box = document.getElementById(elId); if (!box) return;
  if (msgTimers[elId]) clearTimeout(msgTimers[elId]);
  box.style.background = isSuccess ? "#dcfce7" : "#fee2e2"; box.style.color = isSuccess ? "#166534" : "#b91c1c";
  box.textContent = text; box.style.display = "block";
  msgTimers[elId] = setTimeout(() => { box.style.display = "none"; }, 5000);
}

function closeModal(id) {
  const el = document.getElementById(id); if (el) el.style.display = "none";
  if (id === "settingsModal") resetEmpForm();
}

function styleShiftDropdown(selEl, teamKey) {
  if (!selEl || !teamsConfig[teamKey]) return;
  selEl.style.borderLeft = "6px solid " + teamsConfig[teamKey].color;
  selEl.style.color = teamsConfig[teamKey].color; selEl.style.fontWeight = "700";
}

function checkBoardLockState() {
  const modal = document.getElementById("boardLockModal"); if (!modal) return;
  if (securityConfig && securityConfig.boardPwEnabled && !isPlanner) {
    modal.style.display = sessionStorage.getItem("board_unlocked") === "true" ? "none" : "flex";
  } else modal.style.display = "none";
}

window.unlockBoardView = function() {
  const inp = document.getElementById("boardLockInput"), val = inp ? inp.value.trim() : "";
  const targetPw = (securityConfig && securityConfig.boardPw) ? String(securityConfig.boardPw).trim() : "0110";
  if (val === targetPw) {
    sessionStorage.setItem("board_unlocked", "true"); if (inp) inp.value = "";
    document.getElementById("boardLockError").style.display = "none"; checkBoardLockState();
  } else showTimedBoxMsg("boardLockError", "❌ Falsches Zugangs-Passwort!", false);
};
window.openPlannerLoginFromLock = function() { handleLogoClick(); };

function logHistory(action, details) {
  historyLogs.unshift({ id: "h_" + Date.now(), time: new Date().toLocaleString("de-DE"), user: currentPlannerName || "System", action: action, details: details || "" });
  if (historyLogs.length > 150) historyLogs = historyLogs.slice(0, 150);
}

function initBoard() {
  if (isDraggingCard) return;
  sanitizeTeamReferences(); syncAbsentZones(); syncExtraZones();
  updateHeaderDateKw(); updateShiftApprovalUI(); updateAutoRotationUI();

  const headerRow = document.getElementById("headerRow"); if (!headerRow) return;
  if (!Array.isArray(lines) || !lines.length) lines = defaultLines.slice();

  headerRow.innerHTML = '<th class="shift-header"><div>Schicht</div><div class="shift-controls"><button class="shift-rotate-btn" onclick="rotateAllShifts()"><span style="display:inline-flex; align-items:center; gap:5px; justify-content:center;">' + ROUND_SYNC_SVG + '<span>Rotieren</span></span></button><button class="shift-clear-btn" onclick="clearEntireBoard()">🧹 Alle leeren</button></div></th>';
  
  lines.forEach(line => {
    if (!line.targetStaff) line.targetStaff = { frueh: 3, spaet: 3, nacht: 2 };
    const th = document.createElement("th"); th.className = "line-header";
    if (isPlanner && plannerLevel > 2) th.onclick = () => { openLineEditModal(line.id); };
    let pCls = line.prio && (line.prio.indexOf("1") !== -1 || line.prio.indexOf("2") !== -1) ? "prio-high" : (line.prio ? "prio-mid" : "");
    th.innerHTML = '<div class="line-title">' + line.name + '</div><div class="badge-container">' + (line.prio ? '<span class="line-prio ' + pCls + '">' + line.prio + '</span>' : '') + (line.tag ? '<span class="line-status-tag">' + line.tag + '</span>' : '') + '</div>' + (line.note ? '<div class="line-notes">' + line.note + '</div>' : '');
    headerRow.appendChild(th);
  });

  const matrixBody = document.getElementById("matrixBody"); matrixBody.innerHTML = "";
  const keys = Object.keys(teamsConfig).sort(), sundayFree = isSundayDaytimeFree();

  shifts.forEach(shift => {
    const curKey = shiftRotation[shift.id] || keys[0], curObj = teamsConfig[curKey] || { name: "Team", color: "#0091df" };
    const opts = keys.map(k => '<option value="' + k + '" style="color:' + teamsConfig[k].color + '; font-weight:700;" ' + (k === curKey ? 'selected' : '') + '>■ ' + teamsConfig[k].name + (isTeamRotating(k) ? ' 🔄' : '') + '</option>').join("");
    const isShiftSundayOff = sundayFree;
    const sunBadge = isShiftSundayOff ? '<div style="font-size:0.64rem; color:#0284c7; background:#e0f2fe; padding:2px 4px; border-radius:4px; margin-top:3px;">So. Frei</div>' : '';
    const tr = document.createElement("tr"), thS = document.createElement("th");
    thS.className = "shift-header";
    thS.innerHTML = '<div>' + shift.name + '</div>' + sunBadge + '<div class="shift-team-badge" style="border-left:4px solid ' + curObj.color + ';"><span style="color:' + curObj.color + ';">■</span> ' + curObj.name + '</div><div class="shift-controls"><div style="display:flex; gap:4px;"><select id="teamSelect_' + shift.id + '" class="shift-team-select" style="flex:1; border-left:6px solid ' + curObj.color + '; color:' + curObj.color + ';" onchange="onShiftTeamDropdownChange(\'' + shift.id + '\', this)">' + opts + '</select><button class="shift-clear-btn" style="width:26px; padding:0; color:var(--bayer-blue); border-color:var(--bayer-blue);" onclick="loadTeamToShift(\'' + shift.id + '\')" title="Team auf Linien laden">📥</button></div><button class="shift-clear-btn" onclick="clearShiftRow(\'' + shift.id + '\')">🧹 Leeren</button></div>';
    tr.appendChild(thS);
    
    lines.forEach(line => {
      const td = document.createElement("td"), zId = line.id + "_" + shift.id;
      td.innerHTML = '<div id="' + zId + '" class="card-list drop-zone" data-zone="' + zId + '"' + (isShiftSundayOff ? ' style="background:#f1f5f9; opacity:0.8;"' : '') + '></div>';
      tr.appendChild(td);
    });
    matrixBody.appendChild(tr);
  });

  applyTeamStyles(); updateRoleDropdown(); updateTeamDropdowns(); updateAccessLevelDropdownOptions(1);
  renderTeamFilterCheckboxes(); renderRoleFilterCheckboxes(); renderLineCheckboxes();
  renderEmployees(); initDragAndDrop(); renderSettingsLists(); updateInboxBadge(); checkBoardLockState();
  if (typeof renderProfileTab === "function") renderProfileTab();
}

window.onShiftTeamDropdownChange = function(shiftId, selEl) {
  styleShiftDropdown(selEl, selEl.value); shiftRotation[shiftId] = selEl.value; saveToFirebase();
};

function renderEmployees() {
  if (isDraggingCard) return;
  const dropZones = document.querySelectorAll(".drop-zone"); if (!dropZones.length) return;
  dropZones.forEach(el => { el.innerHTML = ""; });
  const today = getTodayIso(), nowMs = Date.now();

  employees.forEach(emp => {
    const fName = fullName(emp);
    if (isPlanner && emp.zone === "pool") {
      if (activeTeamFilters[emp.team] === false || activeRoleFilters[emp.role] === false) return;
      if (poolSearchQuery) {
        const nMatch = fName.toLowerCase().indexOf(poolSearchQuery) !== -1;
        const pMatch = emp.mainLines && emp.mainLines.some(id => { const l = lines.find(x => x.id === id); return l && l.name.toLowerCase().indexOf(poolSearchQuery) !== -1; });
        const sMatch = emp.secLines && emp.secLines.some(id => { const l = lines.find(x => x.id === id); return l && l.name.toLowerCase().indexOf(poolSearchQuery) !== -1; });
        if (!nMatch && !pMatch && !sMatch) return;
      }
    }

    const teamObj = teamsConfig[emp.team] || { name: "Team", color: "#0091df" };
    const card = document.createElement("div"); card.className = "employee-card";
    card.setAttribute("data-id", emp.id); card.style.borderLeft = "5px solid " + (teamObj.color || "#0091df");

    let parts = [];
    if (emp.lastLineId) {
      const lastL = lines.find(x => x.id === emp.lastLineId);
      if (lastL) {
        const delBtn = isPlanner && plannerLevel > 2 ? '<span onclick="event.stopPropagation(); deletePin(\'' + emp.id + '\')" style="cursor:pointer; color:#ef4444; font-size:0.75rem; padding:0 3px;" title="Nadel entfernen">✖</span>' : '';
        parts.push('<span style="color:#0284c7; font-weight:700;" title="Gemerkte Stammlinie">📌 ' + lastL.name.replace(/Linie\s*/i, '') + ' ' + delBtn + '</span>');
      }
    }
    if (emp.mainLines && emp.mainLines.length) parts.push("<b>Prio:</b> " + emp.mainLines.map(id => { const l = lines.find(x => x.id === id); return l ? l.name.replace(/Linie\s*/i, '') : null; }).filter(Boolean).join(", "));
    if (emp.secLines && emp.secLines.length) parts.push("<b>Sek:</b> " + emp.secLines.map(id => { const l = lines.find(x => x.id === id); return l ? l.name.replace(/Linie\s*/i, '') : null; }).filter(Boolean).join(", "));

    const fixHtml = emp.noRotation ? '<span class="card-fix-tag" title="Fixiert">⚓ Fix</span>' : '';
    const activeSl = getActiveLeaveForEmpOnDate(emp.id, today);
    const sickHtml = activeSl ? '<span class="card-sick-tag">' + (activeSl.category || 'Abwesend') + '</span>' : '';

    const empExtras = extraShifts.filter(es => es.empId === emp.id && es.status === "approved" && getShiftTimeBounds(es.date, es.shift).shiftEndMs > nowMs)
      .sort((a, b) => (a.date + a.shift).localeCompare(b.date + b.shift));
    const extraHtml = empExtras.map(es => {
      const b = getShiftTimeBounds(es.date, es.shift);
      const isNowReady = nowMs >= b.prepStartMs && nowMs < b.shiftEndMs;
      const lineHint = es.probableLines ? ' · ' + es.probableLines.replace("Voraussichtlich ", "Vorauss. ") : '';
      return '<span class="card-extra-tag" style="' + (isNowReady ? 'background:#16a34a; color:#fff;' : '') + '">' +
        (isNowReady ? '🟢 JETZT: ' : '➕ ') + formatDateDe(es.date) + ' (' + (shiftsShortLabel[es.shift] || es.shift) + ')' + lineHint + '</span>';
    }).join("");

    card.innerHTML =
      '<div class="card-name">' + fName + '</div>' +
      '<div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">' +
        '<div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap;"><span class="card-role">' + emp.role + '</span>' + fixHtml + '</div>' +
        '<div>' + (emp.ersthelfer ? '<span style="color:#dc2626; font-size:1.15rem; font-weight:900; line-height:0.5;" title="Ersthelfer">+</span>' : '') + '</div>' +
      '</div>' + (parts.length ? '<div class="card-lines-info">' + parts.join(" | ") + '</div>' : '') + extraHtml + sickHtml;

    const targetZone = document.getElementById(emp.zone) || document.getElementById("pool");
    if (targetZone) targetZone.appendChild(card);
  });

  const pEl = document.getElementById("pool"), eEl = document.getElementById("extra"), aEl = document.getElementById("absent");
  if (document.getElementById("poolCount")) document.getElementById("poolCount").textContent = "(" + (pEl ? pEl.children.length : 0) + ")";
  if (document.getElementById("extraCount")) document.getElementById("extraCount").textContent = "(" + (eEl ? eEl.children.length : 0) + ")";
  if (document.getElementById("absentCount")) document.getElementById("absentCount").textContent = "(" + (aEl ? aEl.children.length : 0) + ")";
  renderApprovedExtraSidebar();
}

function renderApprovedExtraSidebar() {
  const box = document.getElementById("approvedExtraList"); if (!box) return;
  const today = getTodayIso();
  const upcoming = extraShifts.filter(es => es.date >= today && es.status === "approved").sort((a, b) => a.date.localeCompare(b.date));
  box.innerHTML = upcoming.map(es => {
    const emp = employees.find(e => e.id === es.empId);
    return '<div style="display:flex; justify-content:space-between; align-items:center; padding:3px 6px; background:#dcfce7; color:#166534; border-radius:4px; margin-bottom:3px;">' +
      '<span><b>' + (emp ? fullName(emp) : "Unbekannt") + '</b> · ' + formatDateDe(es.date) + ' (' + (shiftsShortLabel[es.shift] || es.shift) + ')</span>' +
      (isPlanner && plannerLevel > 2 ? '<span style="cursor:pointer; color:#dc2626; font-weight:bold; padding-left:6px;" onclick="deleteExtraShift(\'' + es.id + '\')" title="Löschen">✖</span>' : '') +
    '</div>';
  }).join("");
}

function initDragAndDrop() {
  sortableInstances.forEach(s => s.destroy()); sortableInstances = [];
  document.querySelectorAll(".drop-zone").forEach(zone => {
    sortableInstances.push(new Sortable(zone, {
      group: "shared-shifts", animation: 150, disabled: !isPlanner,
      onStart: () => { isDraggingCard = true; },
      onEnd: evt => {
        isDraggingCard = false;
        const empId = evt.item.getAttribute("data-id"), newZone = evt.to.getAttribute("data-zone");
        const emp = employees.find(e => e.id === empId);
        if (emp) {
          emp.zone = newZone;
          const nL = extractLineIdFromZone(newZone), nS = extractShiftIdFromZone(newZone);
          if (nL && nS) emp.lastShiftId = nS;
          if (nL) emp.lastLineId = nL;
          saveToFirebase(); renderEmployees();
        }
      }
    }));
  });
}

function applyTeamStyles() {
  let st = document.getElementById("dynamicTeamStyles");
  if (!st) { st = document.createElement("style"); st.id = "dynamicTeamStyles"; document.head.appendChild(st); }
  st.textContent = Object.keys(teamsConfig).sort().map(k => '.employee-card[data-team="' + k + '"] { border-left-color: ' + teamsConfig[k].color + ' !important; }').join("\n");
}

function updateTeamDropdowns() {
  const keys = Object.keys(teamsConfig).sort();
  const freiSel = document.getElementById("teamSelect_frei");
  if (freiSel) {
    const curFreiKey = (shiftRotation.frei && teamsConfig[shiftRotation.frei]) ? shiftRotation.frei : keys[0];
    shiftRotation.frei = curFreiKey;
    freiSel.innerHTML = keys.map(k => '<option value="' + k + '" ' + (curFreiKey === k ? 'selected' : '') + '>Frei: ' + teamsConfig[k].name + '</option>').join("");
    freiSel.onchange = function() { shiftRotation.frei = this.value; saveToFirebase(); };
  }
  const empTeamSel = document.getElementById("newEmpTeam");
  if (empTeamSel) empTeamSel.innerHTML = keys.map(k => '<option value="' + k + '">' + teamsConfig[k].name + '</option>').join("");
}

function updatePoolSearch(val) {
  poolSearchQuery = (val || "").trim().toLowerCase();
  const clearBtn = document.getElementById("clearSearchBtn");
  if (clearBtn) clearBtn.style.display = poolSearchQuery ? "block" : "none";
  renderEmployees();
}

function renderTeamFilterCheckboxes() {
  const c = document.getElementById("teamFilterContainer"); if (!c) return;
  c.innerHTML = Object.keys(teamsConfig).sort().map(k => {
    const t = teamsConfig[k];
    return '<label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer;"><input type="checkbox" ' + (activeTeamFilters[k] !== false ? 'checked' : '') + ' onchange="activeTeamFilters[\'' + k + '\']=this.checked; renderEmployees();"> <span style="color:' + t.color + '; font-weight:700;">■</span> ' + t.name + '</label>';
  }).join("");
}
function toggleAllTeamFilters(s) { Object.keys(teamsConfig).forEach(k => { activeTeamFilters[k] = s; }); renderTeamFilterCheckboxes(); renderEmployees(); }

function renderRoleFilterCheckboxes() {
  const c = document.getElementById("roleFilterContainer"); if (!c) return;
  c.innerHTML = roles.map((r, i) => '<label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer;"><input type="checkbox" ' + (activeRoleFilters[r] !== false ? 'checked' : '') + ' onchange="activeRoleFilters[roles[' + i + ']]=this.checked; renderEmployees();"> ' + r + '</label>').join("");
}
function toggleAllRoleFilters(s) { roles.forEach(r => { activeRoleFilters[r] = s; }); renderRoleFilterCheckboxes(); renderEmployees(); }

function renderLineCheckboxes(selMain, selSec) {
  selMain = selMain || []; selSec = selSec || [];
  const mC = document.getElementById("mainLinesCheckboxes"), sC = document.getElementById("secLinesCheckboxes"); if (!mC || !sC) return;
  const build = (cls, sel) => lines.map(l => '<label style="font-size:0.78rem; display:inline-flex; align-items:center; gap:3px; cursor:pointer;"><input type="checkbox" value="' + l.id + '" class="' + cls + '" ' + (sel.indexOf(l.id) !== -1 ? 'checked' : '') + '> ' + l.name + '</label>').join("");
  mC.innerHTML = build("main-line-chk", selMain); sC.innerHTML = build("sec-line-chk", selSec);
}

function updateRoleDropdown() {
  const sel = document.getElementById("newEmpRole"); if (!sel) return;
  sel.innerHTML = roles.map(r => '<option value="' + r + '">' + r + '</option>').join("");
}

function renderSettingsLists() {
  const empListEl = document.getElementById("employeeList");
  if (empListEl) {
    let filterBar = document.getElementById("settingsEmpFilterBar");
    if (!filterBar && empListEl.parentNode) {
      filterBar = document.createElement("div"); filterBar.id = "settingsEmpFilterBar";
      filterBar.style.cssText = "display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 10px 0; align-items:center;";
      empListEl.parentNode.insertBefore(filterBar, empListEl);
    }
    const teamKeys = Object.keys(teamsConfig).sort();
    const filtered = employees.filter(e => (!settingsEmpSearchQuery || fullName(e).toLowerCase().indexOf(settingsEmpSearchQuery) !== -1) && (settingsEmpTeamFilter === "ALL" || e.team === settingsEmpTeamFilter) && (settingsEmpRoleFilter === "ALL" || e.role === settingsEmpRoleFilter));
    if (filterBar) {
      filterBar.innerHTML =
        '<select class="form-control" style="flex:1; min-width:130px; padding:6px 8px; font-size:0.8rem;" onchange="setSettingsEmpTeamFilter(this.value)"><option value="ALL">👥 Alle Teams</option>' +
        teamKeys.map(k => '<option value="' + k + '"' + (settingsEmpTeamFilter === k ? ' selected' : '') + '>' + teamsConfig[k].name + '</option>').join("") + '</select>' +
        '<select class="form-control" style="flex:1; min-width:130px; padding:6px 8px; font-size:0.8rem;" onchange="setSettingsEmpRoleFilter(this.value)"><option value="ALL">🏷️ Alle Rollen</option>' +
        roles.map(r => '<option value="' + r + '"' + (settingsEmpRoleFilter === r ? ' selected' : '') + '>' + r + '</option>').join("") + '</select>' +
        '<span style="font-size:0.75rem; color:#64748b; font-weight:700; padding:0 4px;">' + filtered.length + ' / ' + employees.length + '</span>';
    }
    empListEl.innerHTML = filtered.map(e => {
      const tObj = teamsConfig[e.team] || { name: e.team, color: "#0091df" };
      return '<div class="item-row" style="flex-wrap:wrap; gap:6px;">' +
        '<span style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;"><span style="color:' + tObj.color + '; font-weight:700; margin-right:4px;">■</span> <b>' + fullName(e) + '</b> <small style="color:#64748b; margin-left:4px;">(' + tObj.name + ' · ' + e.role + ')</small></span>' +
        '<div style="display:flex; gap:5px;">' +
          '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem;" onclick="editEmployee(\'' + e.id + '\')">✏️</button>' +
          '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; color:#dc2626;" onclick="deleteEmployee(\'' + e.id + '\')">🗑️</button>' +
        '</div></div>';
    }).join("");
  }
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
      Object.keys(teamsConfig).forEach(k => { if (typeof activeTeamFilters[k] === "undefined") activeTeamFilters[k] = true; });
    }
    if (d.securityConfig && typeof d.securityConfig === "object") securityConfig = Object.assign(securityConfig, d.securityConfig);
    if (d.shiftModelConfig && typeof d.shiftModelConfig === "object") shiftModelConfig = Object.assign(shiftModelConfig, d.shiftModelConfig);
    if (typeof d.approvedShiftKey === "string") approvedShiftKey = d.approvedShiftKey;
    if (Array.isArray(d.employees)) employees = d.employees;

    sanitizeTeamReferences(); syncAbsentZones(); initBoard();
  } catch (err) { console.error("Fehler beim Verarbeiten der Cloud-Daten:", err); }
}

boardRef.onSnapshot(doc => {
  if (doc.exists && !isDraggingCard) applyIncomingDocData(doc.data());
}, err => { console.error("Firestore Snapshot Fehler:", err); });

function saveToFirebase() {
  if (!hasLoadedFromCloud) return;
  sanitizeTeamReferences();
  const payload = {
    lines: lines, roles: roles, employees: employees, teamsConfig: teamsConfig,
    sickLeaves: sickLeaves, leaveRequests: leaveRequests, extraShifts: extraShifts,
    historyLogs: historyLogs, backups: backups, shiftRotation: shiftRotation,
    securityConfig: securityConfig, shiftModelConfig: shiftModelConfig, approvedShiftKey: approvedShiftKey
  };
  boardRef.update(payload).catch(() => { boardRef.set(payload); });
}

window.addEventListener("DOMContentLoaded", function() {
  Object.keys(teamsConfig).forEach(k => { activeTeamFilters[k] = true; });
  roles.forEach(r => { activeRoleFilters[r] = true; });
  updateHeaderDateKw(); updateShiftApprovalUI(); updateAutoRotationUI();

  const savedName = sessionStorage.getItem("planner_name"), savedLvl = Number(sessionStorage.getItem("planner_level") || 0);
  const savedEmpId = sessionStorage.getItem("planner_emp_id"), lastAct = Number(sessionStorage.getItem("planner_last_active") || Date.now());
  const maxMs = (Number(securityConfig.plannerTimeoutMin) || 180) * 60000;
  if (savedName && savedLvl >= 2 && (Date.now() - lastAct <= maxMs)) applyPlannerLoginState(savedName, savedLvl, savedEmpId);
  
  initBoard();
});

function applyPlannerLoginState(name, lvl, empId) {
  isPlanner = true; plannerLevel = lvl; currentPlannerName = name; currentPlannerEmpId = empId || null;
  sessionStorage.setItem("planner_name", name); sessionStorage.setItem("planner_level", lvl);
  if (empId) sessionStorage.setItem("planner_emp_id", empId);
  document.body.classList.add("planner-active");
  document.body.classList.toggle("planner-lvl-2", lvl === 2);
  document.body.classList.toggle("planner-lvl-3", lvl === 3);
  document.body.classList.toggle("planner-lvl-4", lvl >= 4);
  const badge = document.getElementById("plannerStatusBadge");
  if (badge) badge.textContent = "👤 " + name + " (Stufe " + lvl + ")";
  resetPlanerActivity(); checkBoardLockState();
}

function logoutPlanner() {
  isPlanner = false; plannerLevel = 0; currentPlannerName = ""; currentPlannerEmpId = null;
  ["planner_name","planner_level","planner_emp_id","planner_last_active"].forEach(k => sessionStorage.removeItem(k));
  document.body.classList.remove("planner-active", "planner-lvl-2", "planner-lvl-3", "planner-lvl-4");
  ["pinModal","inboxModal","settingsModal","lineEditModal"].forEach(closeModal);
  initBoard();
}

function verifyPin() {
  const nameVal = document.getElementById("loginPlannerName").value.trim().toLowerCase();
  const pinVal = document.getElementById("pinInput").value.trim();
  if ((nameVal === "admin" || nameVal === "planer") && pinVal === "1234") {
    sessionStorage.setItem("board_unlocked", "true");
    applyPlannerLoginState("Admin", 4, null); closeModal("pinModal"); initBoard(); return;
  }
  let emp = selectedLoginPlannerId ? employees.find(e => e.id === selectedLoginPlannerId) : employees.find(e => fullName(e).toLowerCase() === nameVal);
  if (!emp && nameVal) { const p = employees.filter(e => fullName(e).toLowerCase().indexOf(nameVal) !== -1); if (p.length === 1) emp = p[0]; }
  if (!emp || (emp.password || "1234") !== pinVal) { showTimedBoxMsg("loginModalError", "❌ Name oder PIN nicht korrekt!", false); return; }
  if (Number(emp.accessLevel || 1) < 2) { showTimedBoxMsg("loginModalError", "❌ Kein Planer-Zugriff freigeschaltet.", false); return; }
  
  applyPlannerLoginState(fullName(emp), Number(emp.accessLevel) || 2, emp.id);
  closeModal("pinModal"); initBoard();
}

window.rotateAllShifts = function() { logHistory("Rotation", "Schichtrotation ausgelöst"); performShiftRotationLogic(true); };
window.clearEntireBoard = function() { employees.forEach(e => { if (e.zone && ["pool","absent","extra"].indexOf(e.zone) === -1 && !e.noRotation) e.zone = "pool"; }); saveToFirebase(); renderEmployees(); };
window.clearShiftRow = function(sId) { employees.forEach(e => { if (extractShiftIdFromZone(e.zone) === sId && !e.noRotation) e.zone = "pool"; }); saveToFirebase(); renderEmployees(); };
window.loadTeamToShift = function(slotKey) {
  const sel = document.getElementById("teamSelect_" + slotKey); if (!sel) return;
  const teamKey = sel.value; shiftRotation[slotKey] = teamKey; syncAbsentZones();
  employees.forEach(emp => {
    if (emp.team === teamKey && emp.zone !== "absent" && emp.zone !== "extra" && !emp.noRotation) {
      if (slotKey === "frei") emp.zone = "pool";
      else {
        const targetLine = (emp.lastLineId && lines.some(l => l.id === emp.lastLineId)) ? emp.lastLineId : (emp.mainLines && emp.mainLines[0] ? emp.mainLines[0] : null);
        emp.zone = targetLine ? (targetLine + "_" + slotKey) : "pool";
      }
    }
  });
  saveToFirebase(); initBoard();
};
window.performShiftRotationLogic = function(autoPlace) {
  const slotOrder = ["frueh", "spaet", "nacht", "frei"];
  const activeSlots = slotOrder.filter(s => shiftRotation[s] && isTeamRotating(shiftRotation[s]));
  if (activeSlots.length < 2) return;
  const nextShiftRotation = Object.assign({}, shiftRotation);
  activeSlots.forEach((fromSlot, idx) => { nextShiftRotation[activeSlots[(idx + 1) % activeSlots.length]] = shiftRotation[fromSlot]; });
  shiftRotation = nextShiftRotation; syncAbsentZones(); saveToFirebase(); initBoard();
};
window.placeTeamsOnDefaultLines = function() {};
window.updateInboxBadge = function() {};
window.openSettingsModal = function() { document.getElementById("settingsModal").style.display = "flex"; renderSettingsLists(); };
window.openInboxModal = function() { document.getElementById("inboxModal").style.display = "flex"; };
