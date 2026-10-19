/* PLANER-BOARD LOGIK (planer.js) - Version 4.9.30 */
firebase.initializeApp({
  apiKey: "AIzaSyBPOYRYyUm5gA-j7YSAZl7EJoxedFhDTl4", authDomain: "schichtplan-bayer.firebaseapp.com",
  projectId: "schichtplan-bayer", storageBucket: "schichtplan-bayer.firebasestorage.app",
  messagingSenderId: "152929285194", appId: "1:152929285194:web:00b73aa6058a70aed3a2b3"
});
const db = firebase.firestore(), boardRef = db.collection("shiftplan").doc("live_board");
const shifts = [{ id: "frueh", name: "Früh" }, { id: "spaet", name: "Spät" }, { id: "nacht", name: "Nacht" }];
const shiftsLabel = { frueh: "Frühschicht", spaet: "Spätschicht", nacht: "Nachtschicht" };
const shiftsShortLabel = { frueh: "Früh", spaet: "Spät", nacht: "Nacht" };
const defaultLines = ["32","33","34","09","22","39","36","37","38","54"].map(n => ({ id: "L" + n, name: "Linie " + n, prio: "", tag: "", note: "" }));

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
  model: "vollkonti_sonntag_frei",
  autoRotate: true,
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
function isSundayRestPeriod(baseDate) {
  const now = baseDate || new Date();
  return now.getDay() === 0;
}
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
  const target = new Date(d.valueOf()), dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf(); target.setMonth(0, 1);
  if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  return Math.ceil((firstThursday - target) / 604800000 + 1);
}
function getWorkdayBlockIndex(logicalIso) {
  const p = logicalIso.split("-");
  const diffDays = Math.floor((Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - Date.UTC(2026, 0, 12)) / 86400000);
  const weeks = Math.floor(diffDays / 7), dayInWeek = ((diffDays % 7) + 7) % 7;
  return Math.floor((weeks * 6 + Math.min(dayInWeek, 5)) / 2);
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

// VERBESSERTE PLAUSIBILITÄTSPRÜFUNG (Inkl. Sperre für Nachtschicht vor geplanter Frühschicht am Folgetag)
window.checkExtraShiftPlausibility = function(empId, dateIso, shiftId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return { ok: false, reason: "Mitarbeiter nicht gefunden", code: "NO_EMP" };
  if (isIsoDateSunday(dateIso)) return { ok: false, reason: "Sonntags ist betriebsfrei", code: "SUNDAY_OFF" };
  if (hasLeaveOverlap(empId, dateIso, dateIso, null)) return { ok: false, reason: "An diesem Tag bereits als abwesend / im Urlaub eingetragen", code: "ON_LEAVE" };
  if (extraShifts.some(es => es.empId === empId && es.date === dateIso && es.status !== "rejected")) {
    return { ok: false, reason: "Für dieses Datum ist bereits eine Bringschicht gemeldet", code: "ALREADY_EXTRA" };
  }
  
  // 1. Prüfung auf Nachtschicht vom Vortag (falls user hier Nachtschicht am 27. macht, hat er am 28. Frühschicht-Konflikt)
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
  if (nightBefore && shiftId === "nacht") {
    return { ok: true, regularShift: null, reason: "" };
  }

  // 2. NEU: Prüfung für den Folgetag, falls hier eine NACHTSCHICHT gewählt wird und am Folgetag eine FRÜHSCHICHT ansteht!
  if (shiftId === "nacht") {
    const nextIso = getNextDateIso(dateIso);
    const nextRegShift = window.getEmpRegularShiftOnDate(emp, nextIso);
    const hasNextExtraEarly = extraShifts.some(es => es.empId === empId && es.date === nextIso && es.shift === "frueh" && es.status !== "rejected");
    
    if (nextRegShift === "frueh" || hasNextExtraEarly) {
      return {
        ok: false, isWorkingConflict: false,
        reason: "Nach einer Nachtschicht am " + formatDateDe(dateIso) + " ist am Folgetag (" + formatDateDe(nextIso) + ") keine Frühschicht möglich (Ruhezeitkonflikt)",
        code: "NIGHT_TO_EARLY_BLOCKED"
      };
    }
  }

  // 3. Normale Prüfung auf reguläre Schicht am selben Tag
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
          if (emp.zone && ["pool", "absent", "extra"].indexOf(emp.zone) === -1) {
            emp.zone = "pool";
            changed = true;
          }
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
    saveToFirebase();
    initBoard();
    showToast("Team-Rotation für " + teamsConfig[teamKey].name + " aktualisiert!");
  }
};

window.toggleNewTeamForm = function() {
  const wrap = document.getElementById("newTeamFormWrapper");
  const btn = document.getElementById("toggleNewTeamBtn");
  if (wrap) {
    const isHidden = wrap.style.display === "none";
    wrap.style.display = isHidden ? "block" : "none";
    if (btn) btn.textContent = isHidden ? "✖ Abbrechen" : "+ Neues Team hinzufügen";
  }
};

function updateShiftApprovalUI() {
  const approved = isCurrentShiftApproved(), activeShift = getCurrentActiveShiftId(), shiftName = shiftsLabel[activeShift] || "Schicht";
  
  const bar = document.getElementById("brandGradientBar");
  if (bar) {
    bar.className = approved ? "brand-gradient approved" : "brand-gradient pending";
  }

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
  if (!emp) return;
  if (!canManageEmployee(emp)) {
    showToast("❌ Keine Berechtigung, diesen Mitarbeiter zu löschen!", true);
    return;
  }
  const confirmDel = confirm(`Möchtest du den Mitarbeiter "${fullName(emp)}" wirklich unwiderruflich löschen?`);
  if (!confirmDel) return;

  employees = employees.filter(e => e.id !== empId);
  logHistory("Personal", `Mitarbeiter "${fullName(emp)}" gelöscht`);
  saveToFirebase();
  renderEmployees();
  renderSettingsLists();
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

function formatDateDe(s) { return (s && s.indexOf("-") !== -1) ? s.split("-").reverse().join(".") : (s || ""); }
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
  if (selectedLvl && Number(selectedLvl) > maxLvl) {
    const curL = Number(selectedLvl);
    html += '<option value="' + curL + '" selected disabled>' + (labels[curL] || ("Stufe " + curL)) + '</option>';
  }
  sel.innerHTML = html;
}

function getActiveLeaveForEmpOnDate(empId, isoDate) {
  return sickLeaves.find(sl => {
    if (sl.empId !== empId || sl.status === "rejected" || sl.status === "pending") return false;
    if (sl.blocks && sl.blocks.length) return sl.blocks.some(b => b.status === "approved" && b.start <= isoDate && b.end >= isoDate);
    return sl.status === "approved" && sl.startDate <= isoDate && sl.endDate >= isoDate;
  });
}

function hasLeaveOverlap(empId, startIso, endIso, ignoreSlId) {
  return sickLeaves.some(sl => {
    if (sl.empId !== empId || sl.id === ignoreSlId || sl.status === "rejected") return false;
    if (sl.blocks && sl.blocks.length) return sl.blocks.some(b => b.status !== "rejected" && !(b.end < startIso || b.start > endIso));
    return !(sl.endDate < startIso || sl.startDate > endIso);
  });
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
  const dateStr = now.toLocaleDateString("de-DE", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
  el.textContent = dateStr + " · KW " + getCalendarWeek(ld);
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
  const nowTs = Date.now();
  const cutoffMs = nowTs - (360 * 86400000);
  historyLogs = historyLogs.filter(h => {
    if (h.ts) return h.ts >= cutoffMs;
    try {
      const parts = h.time.split(",");
      const dParts = parts[0].trim().split(".");
      const entryTime = new Date(Number(dParts[2]), Number(dParts[1]) - 1, Number(dParts[0])).getTime();
      return entryTime >= cutoffMs;
    } catch(e) { return true; }
  });

  historyLogs.unshift({ id: "h_" + nowTs, ts: nowTs, time: new Date().toLocaleString("de-DE"), user: currentPlannerName || "System", action: action, details: details || "" });
  if (historyLogs.length > 300) historyLogs = historyLogs.slice(0, 300);
}

window.deleteHistoryItem = function(id) {
  historyLogs = historyLogs.filter(h => h.id !== id);
  saveToFirebase(); filterHistoryUnified(); showToast("Historien-Eintrag gelöscht");
};

function initBoard() {
  if (isDraggingCard) return;
  sanitizeTeamReferences(); syncAbsentZones(); syncExtraZones();
  updateHeaderDateKw(); updateShiftApprovalUI(); updateAutoRotationUI();

  const headerRow = document.getElementById("headerRow"); if (!headerRow) return;
  if (!Array.isArray(lines) || !lines.length) lines = defaultLines.slice();

  headerRow.innerHTML = '<th class="shift-header"><div>Schicht</div><div class="shift-controls"><button class="shift-rotate-btn" onclick="rotateAllShifts()"><span style="display:inline-flex; align-items:center; gap:5px; justify-content:center;">' + ROUND_SYNC_SVG + '<span>Rotieren</span></span></button><button class="shift-clear-btn" onclick="clearEntireBoard()">🧹 Alle leeren</button></div></th>';
  lines.forEach(line => {
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
  const nowMs = Date.now();
  const upcoming = extraShifts.filter(es => es.status === "approved" && getShiftTimeBounds(es.date, es.shift).shiftEndMs > nowMs)
    .sort((a, b) => getShiftTimeBounds(a.date, a.shift).prepStartMs - getShiftTimeBounds(b.date, b.shift).prepStartMs);
  box.innerHTML = upcoming.map(es => {
    const emp = employees.find(e => e.id === es.empId), bounds = getShiftTimeBounds(es.date, es.shift);
    const prepTimeStr = new Date(bounds.prepStartMs).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const isReadyNow = nowMs >= bounds.prepStartMs;
    return '<div style="display:flex; justify-content:space-between; align-items:center; padding:3px 6px; background:' + (isReadyNow ? '#bbf7d0' : '#f0fdf4') + '; color:#166534; border:1px solid #86efac; border-radius:4px; margin-bottom:3px;" title="Bereitstellung ab ' + prepTimeStr + ' Uhr">' +
      '<span>' + (isReadyNow ? '🟢 ' : '🕒 ') + '<b>' + (emp ? fullName(emp) : "Unbekannt") + '</b> · ' + formatDateDe(es.date) + ' (' + (shiftsShortLabel[es.shift] || es.shift) + ' · ab ' + prepTimeStr + ')</span>' +
      (isPlanner && plannerLevel >= 3 ? '<span style="cursor:pointer; color:#dc2626; font-weight:bold; padding-left:6px;" onclick="deleteExtraShift(\'' + es.id + '\')" title="Bringschicht löschen">✖</span>' : '') +
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
          if (nL && nS && newZone !== "extra") { emp.lastShiftId = nS; emp.lastLineId = nL; }
          saveToFirebase(); renderEmployees();
        }
      }
    }));
  });
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
  ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"].forEach(evt => document.addEventListener(evt, resetPlanerActivity, { passive: true }));
});

function handleLogoClick() {
  if (!isPlanner) {
    document.getElementById("pinModal").style.display = "flex"; document.getElementById("loginModalError").style.display = "none";
    document.getElementById("loginPlannerName").value = ""; document.getElementById("pinInput").value = "";
    selectedLoginPlannerId = null; document.getElementById("loginPlannerName").focus();
  }
}

function onPlannerLoginInput(val) {
  selectedLoginPlannerId = null;
  const box = document.getElementById("plannerLoginSuggestions"), q = (val || "").trim().toLowerCase();
  if (!employees.length || q.length < 3) { box.style.display = "none"; return; }
  const matches = employees.slice().sort((a, b) => fullName(a).localeCompare(fullName(b))).filter(e => fullName(e).toLowerCase().indexOf(q) !== -1 || ((e.lastName || "") + " " + (e.firstName || "")).toLowerCase().indexOf(q) !== -1);
  if (!matches.length) { box.style.display = "none"; return; }
  box.innerHTML = matches.map(e => '<div class="suggestion-item" onclick="selectPlannerLogin(\'' + e.id + '\')"><span><b>' + fullName(e) + '</b></span><small style="color:#64748b;">Stufe ' + (e.accessLevel || 1) + '</small></div>').join("");
  box.style.display = "block";
}
function selectPlannerLogin(id) {
  const e = employees.find(x => x.id === id);
  if (e) { selectedLoginPlannerId = e.id; document.getElementById("loginPlannerName").value = fullName(e); document.getElementById("plannerLoginSuggestions").style.display = "none"; document.getElementById("pinInput").focus(); }
}

function generateStartPin() {
  let pin = ""; do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (pin === "1234" || pin === "0000"); return pin;
}

window.openForcePinChangeModal = function(emp, onSuccess) {
  let modal = document.getElementById("forcePinChangeModal");
  if (!modal) {
    modal = document.createElement("div"); modal.id = "forcePinChangeModal"; modal.className = "modal-overlay";
    modal.style.cssText = "display:flex; position:fixed; inset:0; background:rgba(15,23,42,0.65); z-index:9999; align-items:center; justify-content:center; padding:16px;";
    modal.innerHTML = '<div style="background:#fff; border-radius:12px; max-width:380px; width:100%; padding:20px; box-shadow:0 10px 25px rgba(0,0,0,0.2);"><h3 style="margin:0 0 6px 0; color:#10384f; font-size:1.05rem;">🔒 Persönliche PIN festlegen</h3><p id="forcePinEmpText" style="margin:0 0 14px 0; font-size:0.82rem; color:#475569;"></p><div id="forcePinError" style="display:none; padding:8px 10px; border-radius:6px; font-size:0.8rem; font-weight:700; margin-bottom:10px; background:#fee2e2; color:#b91c1c;"></div><div style="margin-bottom:10px;"><label style="display:block; font-size:0.78rem; font-weight:700; color:#334155; margin-bottom:4px;">Neue 4-stellige PIN</label><input type="password" id="forcePinNew1" maxlength="8" inputmode="numeric" placeholder="Mind. 4 Ziffern..." style="width:100%; padding:9px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.95rem;"></div><div style="margin-bottom:14px;"><label style="display:block; font-size:0.78rem; font-weight:700; color:#334155; margin-bottom:4px;">Neue PIN wiederholen</label><input type="password" id="forcePinNew2" maxlength="8" inputmode="numeric" placeholder="PIN nochmals eingeben..." style="width:100%; padding:9px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.95rem;"></div><button id="forcePinSaveBtn" class="btn btn-primary" style="width:100%; padding:10px; font-weight:700;">PIN speichern & weiter</button></div>';
    document.body.appendChild(modal);
  }
  document.getElementById("forcePinEmpText").innerHTML = 'Hallo <b>' + fullName(emp) + '</b>, bitte wählen Sie jetzt Ihre eigene PIN (zweimal eingeben):';
  const errBox = document.getElementById("forcePinError"), inp1 = document.getElementById("forcePinNew1"), inp2 = document.getElementById("forcePinNew2");
  errBox.style.display = "none"; inp1.value = ""; inp2.value = ""; modal.style.display = "flex"; setTimeout(() => inp1.focus(), 50);
  document.getElementById("forcePinSaveBtn").onclick = function() {
    const p1 = inp1.value.trim(), p2 = inp2.value.trim();
    if (p1.length < 4) { errBox.textContent = "❌ Die neue PIN muss mindestens 4 Zeichen lang sein!"; errBox.style.display = "block"; return; }
    if (p1 !== p2) { errBox.textContent = "❌ Die beiden PIN-Eingaben stimmen nicht überein!"; errBox.style.display = "block"; return; }
    if (p1 === (emp.password || "")) { errBox.textContent = "❌ Bitte wählen Sie eine andere PIN als die Start-PIN!"; errBox.style.display = "block"; return; }
    emp.password = p1; emp.mustChangePw = false;
    logHistory("Sicherheit", fullName(emp) + " hat die Start-PIN in eine persönliche PIN geändert");
    saveToFirebase(); modal.style.display = "none"; showToast("✅ Persönliche PIN wurde gespeichert!");
    if (typeof onSuccess === "function") onSuccess();
  };
};

function verifyPin() {
  const nameVal = document.getElementById("loginPlannerName").value.trim().toLowerCase(), pinVal = document.getElementById("pinInput").value.trim();
  if (nameVal === "admin" && pinVal === "1234") { sessionStorage.setItem("board_unlocked", "true"); applyPlannerLoginState("System-Admin", 4, null); closeModal("pinModal"); initBoard(); return; }
  if (nameVal === "planer" && pinVal === "1234") { sessionStorage.setItem("board_unlocked", "true"); applyPlannerLoginState("Planer", 3, null); closeModal("pinModal"); initBoard(); return; }
  let emp = selectedLoginPlannerId ? employees.find(e => e.id === selectedLoginPlannerId) : employees.find(e => fullName(e).toLowerCase() === nameVal);
  if (!emp && nameVal) { const p = employees.filter(e => fullName(e).toLowerCase().indexOf(nameVal) !== -1); if (p.length === 1) emp = p[0]; }
  if (!emp || (emp.password || "1234") !== pinVal) { showTimedBoxMsg("loginModalError", "❌ Name oder PIN nicht korrekt!", false); return; }
  if (Number(emp.accessLevel || 1) < 2) { showTimedBoxMsg("loginModalError", "❌ Kein Planer-Zugriff freigeschaltet.", false); return; }
  const finishLogin = () => { sessionStorage.setItem("board_unlocked", "true"); applyPlannerLoginState(fullName(emp), Number(emp.accessLevel) || 2, emp.id); closeModal("pinModal"); initBoard(); };
  if (emp.mustChangePw) { closeModal("pinModal"); window.openForcePinChangeModal(emp, finishLogin); } else finishLogin();
}

function applyPlannerLoginState(name, lvl, empId) {
  isPlanner = true; plannerLevel = lvl; currentPlannerName = name; currentPlannerEmpId = empId || null;
  sessionStorage.setItem("planner_name", name); sessionStorage.setItem("planner_level", lvl);
  if (empId) sessionStorage.setItem("planner_emp_id", empId);
  document.body.classList.add("planner-active");
  document.body.classList.toggle("planner-lvl-2", lvl === 2);
  document.body.classList.toggle("planner-lvl-3", lvl === 3);
  document.body.classList.toggle("planner-lvl-4", lvl >= 4);
  const badge = document.getElementById("plannerStatusBadge"); if (badge) badge.textContent = "👤 " + name + " (Stufe " + lvl + ")";
  resetPlanerActivity(); checkBoardLockState();
}

function logoutPlanner() {
  isPlanner = false; plannerLevel = 0; currentPlannerName = "", currentPlannerEmpId = null;
  ["planner_name","planner_level","planner_emp_id","planner_last_active"].forEach(k => sessionStorage.removeItem(k));
  document.body.classList.remove("planner-active", "planner-lvl-2", "planner-lvl-3", "planner-lvl-4");
  ["pinModal","inboxModal","settingsModal","lineEditModal"].forEach(closeModal); initBoard();
}

function applyIncomingDocData(d) {
  if (!d) return; hasLoadedFromCloud = true;
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

    sanitizeTeamReferences(); syncAbsentZones(); syncExtraZones(); checkAndRunSundayResetAndRotation();
    updateShiftApprovalUI(); updateAutoRotationUI(); initBoard();
    if (typeof renderPortalView === "function") renderPortalView();
    if (document.getElementById("inboxModal") && document.getElementById("inboxModal").style.display === "flex") renderInboxLists();
  } catch (err) { console.error("Fehler beim Laden:", err); }
}

boardRef.onSnapshot(doc => { if (doc.exists && !isDraggingCard) applyIncomingDocData(doc.data()); });

function saveToFirebase() {
  if (!hasLoadedFromCloud) return; sanitizeTeamReferences();
  const payload = {
    lines: lines, roles: roles, employees: employees, teamsConfig: teamsConfig,
    sickLeaves: sickLeaves, leaveRequests: leaveRequests, extraShifts: extraShifts,
    historyLogs: historyLogs, backups: backups, shiftRotation: shiftRotation,
    securityConfig: securityConfig, shiftModelConfig: shiftModelConfig, approvedShiftKey: approvedShiftKey
  };
  boardRef.update(payload).catch(() => boardRef.set(payload));
}

function placeTeamsOnDefaultLines() {
  const sundayFree = isSundayDaytimeFree(), todayIso = getTodayIso();
  employees.forEach(emp => {
    if (emp.zone === "absent" || emp.zone === "extra") return;
    if (emp.noRotation && isEmpAnchorActiveToday(emp, todayIso)) return;

    if (sundayFree) { emp.zone = "pool"; return; }
    let targetShift = ["frueh", "spaet", "nacht"].find(sKey => shiftRotation[sKey] === emp.team) || null;
    if (targetShift) {
      const targetLine = (emp.lastLineId && lines.some(l => l.id === emp.lastLineId)) ? emp.lastLineId : (emp.mainLines && emp.mainLines[0] ? emp.mainLines[0] : null);
      emp.zone = targetLine ? (targetLine + "_" + targetShift) : "pool";
    } else emp.zone = "pool";
  });
}

function performShiftRotationLogic(autoPlaceEmployees) {
  const slotOrder = (shiftModelConfig && shiftModelConfig.model === "dreierschicht") ? ["frueh", "spaet", "nacht"] : ["frueh", "spaet", "nacht", "frei"];
  const activeSlots = slotOrder.filter(s => shiftRotation[s] && isTeamRotating(shiftRotation[s]));
  if (activeSlots.length < 2) return;
  const nextShiftRotation = Object.assign({}, shiftRotation);
  activeSlots.forEach((fromSlot, idx) => { nextShiftRotation[activeSlots[(idx + 1) % activeSlots.length]] = shiftRotation[fromSlot]; });
  shiftRotation = nextShiftRotation;
  syncAbsentZones();
  if (autoPlaceEmployees) placeTeamsOnDefaultLines();
  syncExtraZones(); saveToFirebase(); initBoard();
}

function rotateAllShifts() { logHistory("Rotation", "Schichtrotation ausgelöst"); performShiftRotationLogic(true); }

window.loadTeamToShift = function(slotKey) {
  const sel = document.getElementById("teamSelect_" + slotKey); if (!sel) return;
  const teamKey = sel.value, todayIso = getTodayIso(); shiftRotation[slotKey] = teamKey; syncAbsentZones();
  
  employees.forEach(emp => {
    if (emp.noRotation && isEmpAnchorActiveToday(emp, todayIso)) return;

    if (emp.team === teamKey && (!emp.zone || emp.zone === "pool")) {
      if (slotKey === "frei" || isSundayDaytimeFree()) {
        emp.zone = "pool";
      } else {
        const targetLine = (emp.lastLineId && lines.some(l => l.id === emp.lastLineId)) ? emp.lastLineId : (emp.mainLines && emp.mainLines[0] ? emp.mainLines[0] : null);
        emp.zone = targetLine ? (targetLine + "_" + slotKey) : "pool";
      }
    }
  });
  saveToFirebase(); initBoard();
  showToast("Team erfolgreich geladen (Pins & Anker berücksichtigt)!");
};

window.clearShiftRow = function(shiftId) {
  if (!isPlanner) return;
  employees.forEach(emp => {
    if (emp.noRotation && isEmpAnchorActiveToday(emp, getTodayIso())) return;
    if (extractShiftIdFromZone(emp.zone) === shiftId) emp.zone = "pool";
  });
  saveToFirebase(); renderEmployees();
};
window.clearEntireBoard = function() {
  if (!isPlanner) return;
  employees.forEach(emp => {
    if (emp.noRotation && isEmpAnchorActiveToday(emp, getTodayIso())) return;
    if (emp.zone && ["pool","absent","extra"].indexOf(emp.zone) === -1) emp.zone = "pool";
  });
  saveToFirebase(); renderEmployees();
};

// BRINGSCHICHT-AUSSCHREIBUNG
window.generateCoveragePromptForLeave = function(sl) {
  if (!sl || (sl.status !== "approved" && sl.status !== "partial")) return;
  const emp = employees.find(e => e.id === sl.empId); if (!emp) return;
  const today = getTodayIso();
  const approvedBlocks = (sl.blocks && sl.blocks.length) ? sl.blocks.filter(b => b.status === "approved") : (sl.status === "approved" ? [{ start: sl.startDate, end: sl.endDate }] : []);
  const covId = "cov_" + sl.id, existingCov = leaveRequests.find(r => r.id === covId);
  const neededDays = [];

  approvedBlocks.forEach(b => {
    getDatesInRange(b.start, b.end).forEach(dIso => {
      if (dIso < today || isIsoDateSunday(dIso)) return;
      const rot = getRotationForDate(dIso);
      let empShift = ["frueh", "spaet", "nacht"].find(s => rot[s] === emp.team) || null;
      if (!empShift && isEmpAnchorActiveToday(emp, dIso)) empShift = emp.lastShiftId || "frueh";
      if (empShift) {
        const oldDay = (existingCov && existingCov.days) ? existingCov.days.find(od => od.date === dIso && od.shift === empShift) : null;
        neededDays.push({
          date: dIso, shift: empShift, freeTeam: rot.frei || "",
          takenBy: oldDay ? oldDay.takenBy : null,
          dayStatus: oldDay && oldDay.dayStatus ? oldDay.dayStatus : "pending"
        });
      }
    });
  });

  if (!neededDays.length) return;
  const existingIdx = leaveRequests.findIndex(r => r.id === covId);
  const bestLineId = (emp.mainLines && emp.mainLines[0]) ? emp.mainLines[0] : ((emp.lastLineId && lines.some(l => l.id === emp.lastLineId)) ? emp.lastLineId : (lines[0] ? lines[0].id : ""));
  const probableLinesText = window.getEmpProbableLinesText(emp);
  const hasOpenDays = neededDays.some(d => d.dayStatus === "open" && !d.takenBy);
  const hasPendingDays = neededDays.some(d => (!d.dayStatus || d.dayStatus === "pending") && !d.takenBy);

  const covObj = {
    id: covId, slId: sl.id, empId: emp.id, role: emp.role || "Bediener",
    lineId: bestLineId, probableLines: probableLinesText, category: sl.category || "Urlaub",
    startDate: sl.startDate, endDate: sl.endDate, days: neededDays,
    status: hasPendingDays ? "planner_prompt" : (hasOpenDays ? "open" : "closed"),
    createdAt: new Date().toLocaleString("de-DE")
  };
  if (existingIdx !== -1) leaveRequests[existingIdx] = covObj;
  else leaveRequests.unshift(covObj);
};

function recalcCoverageOverallStatus(cov) {
  if (!cov || !cov.days) return;
  const activeDays = cov.days.filter(d => d.dayStatus !== "dismissed");
  if (!activeDays.length) { leaveRequests = leaveRequests.filter(r => r.id !== cov.id); return; }
  const hasPending = activeDays.some(d => (!d.dayStatus || d.dayStatus === "pending") && !d.takenBy);
  const hasOpen = activeDays.some(d => d.dayStatus === "open" && !d.takenBy);
  cov.status = hasOpen ? "open" : (hasPending ? "planner_prompt" : "closed");
}

window.publishSelectedCoverageDays = function(covId) {
  const cov = leaveRequests.find(r => r.id === covId); if (!cov || !cov.days) return;
  const checkboxes = document.querySelectorAll('.cov-day-chk-' + covId);
  let publishedCount = 0;
  checkboxes.forEach(chk => {
    if (chk.checked) {
      const dIso = chk.getAttribute('data-date'), sId = chk.getAttribute('data-shift');
      const dObj = cov.days.find(d => d.date === dIso && d.shift === sId);
      if (dObj && !dObj.takenBy) { dObj.dayStatus = "open"; publishedCount++; }
    }
  });
  if (publishedCount === 0) { showToast("⚠️ Bitte mindestens einen Tag per Checkbox auswählen!", true); return; }
  recalcCoverageOverallStatus(cov);
  logHistory("Bringschicht-Suche", publishedCount + " ausgewählte Ersatzschichten (" + (cov.probableLines || cov.role) + ") im Portal freigegeben");
  saveToFirebase(); renderInboxLists(); updateInboxBadge();
  showToast("📢 " + publishedCount + " Schicht(en) im Portal freigegeben!");
};

window.dismissSelectedCoverageDays = function(covId) {
  const cov = leaveRequests.find(r => r.id === covId); if (!cov || !cov.days) return;
  const checkboxes = document.querySelectorAll('.cov-day-chk-' + covId);
  let dismissedCount = 0;
  checkboxes.forEach(chk => {
    if (chk.checked) {
      const dIso = chk.getAttribute('data-date'), sId = chk.getAttribute('data-shift');
      const dObj = cov.days.find(d => d.date === dIso && d.shift === sId);
      if (dObj && !dObj.takenBy) { dObj.dayStatus = "dismissed"; dismissedCount++; }
    }
  });
  if (dismissedCount === 0) { showToast("⚠️ Bitte mindestens einen Tag per Checkbox auswählen!", true); return; }
  recalcCoverageOverallStatus(cov);
  showToast(dismissedCount + " Schicht(en) verworfen / ausgeschlossen");
  saveToFirebase(); renderInboxLists(); updateInboxBadge();
};

window.toggleAllCovCheckboxes = function(covId, masterChk) {
  document.querySelectorAll('.cov-day-chk-' + covId).forEach(chk => { if (!chk.disabled) chk.checked = masterChk.checked; });
};

window.decideCoveragePrompt = function(covId, publish) {
  const cov = leaveRequests.find(r => r.id === covId); if (!cov) return;
  const absentEmp = employees.find(e => e.id === cov.empId);
  if (publish) {
    (cov.days || []).forEach(d => { if ((!d.dayStatus || d.dayStatus === "pending") && !d.takenBy) d.dayStatus = "open"; });
    cov.status = "open";
    logHistory("Bringschicht-Suche", "Alle offenen Ersatzschichten für " + (absentEmp ? fullName(absentEmp) : cov.role) + " im Portal ausgeschrieben");
    showToast("📢 Alle offenen Schichten im Portal veröffentlicht!");
  } else {
    leaveRequests = leaveRequests.filter(r => r.id !== covId);
    showToast("Ersatzsuche beendet / verworfen");
  }
  saveToFirebase(); renderInboxLists(); updateInboxBadge();
};

window.applyForCoverageDay = function(covId, dateIso, empId) {
  const cov = leaveRequests.find(r => r.id === covId); if (!cov) return false;
  const dayObj = (cov.days || []).find(d => d.date === dateIso);
  if (!dayObj || dayObj.takenBy || (dayObj.dayStatus && dayObj.dayStatus !== "open")) return false;
  const plaus = window.checkExtraShiftPlausibility(empId, dateIso, dayObj.shift);
  if (!plaus.ok) return false;

  const emp = employees.find(e => e.id === empId), absentEmp = employees.find(e => e.id === cov.empId);
  const probLines = cov.probableLines || (absentEmp ? window.getEmpProbableLinesText(absentEmp) : "");
  const noteStr = "Ersatzbedarf (" + cov.role + ")" + (probLines ? " · " + probLines : "");

  extraShifts.push({
    id: "es_" + Date.now(), empId: empId, date: dateIso, shift: dayObj.shift,
    note: noteStr, probableLines: probLines, covId: covId,
    forAbsentEmpId: cov.empId || "", forAbsentEmpName: absentEmp ? fullName(absentEmp) : "",
    status: "pending"
  });
  logHistory("Bringschicht-Bewerbung", (emp ? fullName(emp) : "Mitarbeiter") + " hat sich für die Bringschicht am " + formatDateDe(dateIso) + " (" + shiftsShortLabel[dayObj.shift] + ") gemeldet");
  saveToFirebase(); updateInboxBadge(); return true;
};

window.decideExtraShiftRequest = function(esId, approve) {
  const es = extraShifts.find(x => x.id === esId); if (!es) return;
  const emp = employees.find(e => e.id === es.empId);
  if (approve) {
    if (es.plausibilityWarning || es.isNightShiftConflict) {
      const okWarn = confirm("🔴 KONFLIKT-WARNUNG:\n\n" + (emp ? fullName(emp) : "Der Mitarbeiter") + ": " + (es.conflictDetails || "Schicht-/Ruhezeitkonflikt") + ".\n\nMöchtest du diese Bringschicht trotzdem genehmigen?");
      if (!okWarn) return;
    }
    es.status = "approved"; es.reviewedBy = currentPlannerName || "Planer"; es.reviewedAt = new Date().toLocaleString("de-DE");
    es.autoPlacedInBox = false; es.autoCleanedAfterShift = false;
    if (es.covId) {
      const cov = leaveRequests.find(r => r.id === es.covId);
      if (cov && cov.days) {
        const dObj = cov.days.find(d => d.date === es.date && d.shift === es.shift);
        if (dObj) dObj.takenBy = es.empId;
        recalcCoverageOverallStatus(cov);
      }
      extraShifts.forEach(other => {
        if (other.id !== es.id && other.covId === es.covId && other.date === es.date && other.shift === es.shift && other.status === "pending") {
          other.status = "rejected"; other.reviewedBy = "System (Schicht anderweitig vergeben)"; other.reviewedAt = new Date().toLocaleString("de-DE");
        }
      });
    }
    syncExtraZones();
    logHistory("Bringschicht", "Bringschicht von " + (emp ? fullName(emp) : "") + " am " + formatDateDe(es.date) + " genehmigt");
    showToast("✅ Bringschicht genehmigt! (Bereitstellung 1h vor Schichtbeginn)");
  } else {
    es.status = "rejected"; es.reviewedBy = currentPlannerName || "Planer"; es.reviewedAt = new Date().toLocaleString("de-DE");
    logHistory("Bringschicht", "Bringschicht-Angebot von " + (emp ? fullName(emp) : "") + " am " + formatDateDe(es.date) + " abgelehnt");
    showToast("❌ Bringschicht abgelehnt (Mitarbeiter wird im Portal informiert)");
  }
  saveToFirebase(); renderEmployees(); renderInboxLists(); updateInboxBadge();
};

// KRANKMELDUNG / URLAUB
window.addPortalLeaveRequest = function(empId, start, end, cat, reason) {
  const emp = employees.find(e => e.id === empId);
  const catLower = (cat || "").toLowerCase();
  const isVac = catLower.indexOf("urlaub") !== -1 || catLower.indexOf("freizeit") !== -1;
  const isAutoApprove = !isVac;

  if (hasLeaveOverlap(empId, start, end, null)) { showToast("⚠️ Für diesen Zeitraum existiert bereits ein Eintrag!", true); return false; }

  const newSl = {
    id: "sl_" + Date.now(), empId: empId, startDate: start, endDate: end,
    category: cat, reason: reason || "Vom Mitarbeiter im Portal gemeldet",
    status: isAutoApprove ? "approved" : "pending",
    blocks: [{ start: start, end: end, status: isAutoApprove ? "approved" : "pending", reason: "" }],
    reviewedBy: isAutoApprove ? "System (Meldung erfasst)" : "",
    reviewedAt: isAutoApprove ? new Date().toLocaleString("de-DE") : "",
    empResponseNote: "", empRespondedUnread: false,
    plannerUnreadInfo: isAutoApprove
  };
  sickLeaves.push(newSl);
  if (isAutoApprove) { generateCoveragePromptForLeave(newSl); syncAbsentZones(); }

  logHistory(isVac ? "Urlaub" : "Krank / Abwesend", (emp ? fullName(emp) : "Mitarbeiter") + " hat " + cat + " (" + formatDateDe(start) + " bis " + formatDateDe(end) + ") " + (isAutoApprove ? "gemeldet (sofort im System aktiv)" : "beantragt"));
  saveToFirebase(); renderEmployees(); updateInboxBadge();
  return true;
};

window.ackSickLeaveInfo = function(slId) {
  const sl = sickLeaves.find(x => x.id === slId);
  if (sl) {
    sl.plannerUnreadInfo = false; sl.reviewedBy = (currentPlannerName || "Planer") + " (Gelesen)"; sl.reviewedAt = new Date().toLocaleString("de-DE");
    saveToFirebase(); renderInboxLists(); updateInboxBadge();
  }
};

function updateInboxBadge() {
  const badge = document.getElementById("inboxBadge"); if (!badge) return;
  const pendingLeaves = sickLeaves.filter(sl => sl.status === "pending" || sl.empRespondedUnread || sl.plannerUnreadInfo).length;
  const pendingExtra = extraShifts.filter(es => es.status === "pending").length;
  const pendingCov = leaveRequests.filter(r => (r.days || []).some(d => (!d.dayStatus || d.dayStatus === "pending") && !d.takenBy)).length;
  const total = pendingLeaves + pendingExtra + pendingCov;
  badge.textContent = total; badge.style.display = total > 0 ? "inline-flex" : "none";
}

window.openInboxModal = function(empId, openSickForm, openExtraForm) {
  document.getElementById("inboxModal").style.display = "flex";
  const sickContent = document.getElementById("manualEntryContent"), extraContent = document.getElementById("manualExtraContent");
  if (sickContent) sickContent.style.display = openSickForm ? "block" : "none";
  if (extraContent) extraContent.style.display = openExtraForm ? "block" : "none";
  if (openExtraForm && document.getElementById("manualExtraDate") && !document.getElementById("manualExtraDate").value) document.getElementById("manualExtraDate").value = getTodayIso();
  renderInboxLists();
};

window.updateInboxSearch = function(val) {
  inboxSearchQuery = (val || "").trim().toLowerCase();
  const clearBtn = document.getElementById("clearInboxSearchBtn"); if (clearBtn) clearBtn.style.display = inboxSearchQuery ? "block" : "none";
  renderInboxLists();
};
window.toggleManualEntryBox = function() { const c = document.getElementById("manualEntryContent"); if (c) c.style.display = c.style.display === "none" ? "block" : "none"; };
window.toggleManualExtraBox = function() {
  const c = document.getElementById("manualExtraContent"); if (!c) return;
  const isOpening = c.style.display === "none"; c.style.display = isOpening ? "block" : "none";
  if (isOpening && document.getElementById("manualExtraDate") && !document.getElementById("manualExtraDate").value) document.getElementById("manualExtraDate").value = getTodayIso();
};

window.onManualSickNameInput = function(val) {
  selectedManualSickEmpId = null;
  const box = document.getElementById("manualSickSuggestions"), q = (val || "").trim().toLowerCase();
  if (!box || !employees.length) return;
  const matches = q ? employees.filter(e => fullName(e).toLowerCase().indexOf(q) !== -1) : employees.slice(0, 12);
  if (!matches.length) { box.style.display = "none"; return; }
  box.innerHTML = matches.map(e => '<div class="suggestion-item" onclick="selectManualSickEmp(\'' + e.id + '\')"><b>' + fullName(e) + '</b></div>').join("");
  box.style.display = "block";
};
window.selectManualSickEmp = function(id) {
  const e = employees.find(x => x.id === id);
  if (e) { selectedManualSickEmpId = e.id; document.getElementById("manualSickEmpInput").value = fullName(e); document.getElementById("manualSickSuggestions").style.display = "none"; }
};

window.addManualSickLeave = function() {
  const start = document.getElementById("manualSickStart").value, end = document.getElementById("manualSickEnd").value;
  const cat = document.getElementById("manualSickCategory").value, reason = document.getElementById("manualSickReason").value.trim();
  if (!selectedManualSickEmpId || !start || !end) { showToast("Bitte Mitarbeiter, Von- und Bis-Datum wählen", true); return; }
  if (start > end) { showToast("Startdatum darf nicht nach Enddatum liegen", true); return; }
  if (hasLeaveOverlap(selectedManualSickEmpId, start, end, null)) { showToast("⚠️ Für diesen Zeitraum existiert bereits eine Abwesenheit!", true); return; }

  const newSl = {
    id: "sl_" + Date.now(), empId: selectedManualSickEmpId, startDate: start, endDate: end,
    category: cat, reason: reason || "Vom Planer eingetragen", status: "approved",
    blocks: [{ start: start, end: end, status: "approved", reason: "" }],
    reviewedBy: currentPlannerName || "Planer", reviewedAt: new Date().toLocaleString("de-DE"), plannerUnreadInfo: false
  };
  sickLeaves.push(newSl); generateCoveragePromptForLeave(newSl); syncAbsentZones();
  const emp = employees.find(e => e.id === selectedManualSickEmpId);
  document.getElementById("manualSickEmpInput").value = ""; document.getElementById("manualSickReason").value = ""; selectedManualSickEmpId = null;
  logHistory("Abwesenheit", (emp ? fullName(emp) : "") + ": " + cat);
  saveToFirebase(); renderEmployees(); renderInboxLists(); updateInboxBadge();
  showToast("Abwesenheit gespeichert (Bringschichten im Postfach auswählbar)");
};

window.onManualExtraNameInput = function(val) {
  selectedManualExtraEmpId = null;
  const box = document.getElementById("manualExtraSuggestions"), q = (val || "").trim().toLowerCase();
  if (!box || !employees.length || q.length < 3) { if (box) box.style.display = "none"; return; }
  const matches = employees.filter(e => fullName(e).toLowerCase().indexOf(q) !== -1);
  if (!matches.length) { box.style.display = "none"; return; }
  box.innerHTML = matches.map(e => '<div class="suggestion-item" onclick="selectManualExtraEmp(\'' + e.id + '\')"><b>' + fullName(e) + '</b></div>').join("");
  box.style.display = "block";
};
window.selectManualExtraEmp = function(id) {
  const e = employees.find(x => x.id === id);
  if (e) { selectedManualExtraEmpId = e.id; document.getElementById("manualExtraEmpInput").value = fullName(e); document.getElementById("manualExtraSuggestions").style.display = "none"; }
};

window.addManualExtraShift = function() {
  const dateVal = document.getElementById("manualExtraDate").value, shiftVal = document.getElementById("manualExtraShift").value, noteVal = document.getElementById("manualExtraNote").value.trim();
  if (!selectedManualExtraEmpId || !dateVal) { showToast("Bitte Mitarbeiter und Datum wählen", true); return; }
  const emp = employees.find(e => e.id === selectedManualExtraEmpId);
  const plaus = window.checkExtraShiftPlausibility(selectedManualExtraEmpId, dateVal, shiftVal);
  if (!plaus.ok && !plaus.isWorkingConflict) { showToast("⚠️ " + plaus.reason, true); return; }
  if (plaus.isWorkingConflict) {
    if (!confirm("🔴 KONFLIKT-HINWEIS:\n\n" + (emp ? fullName(emp) : "Der Mitarbeiter") + ": " + plaus.reason + "!\n\nTrotzdem als Bringschicht eintragen?")) return;
  }
  extraShifts.push({
    id: "es_" + Date.now(), empId: selectedManualExtraEmpId, date: dateVal, shift: shiftVal,
    note: noteVal || "Vom Planer eingetragen", plausibilityWarning: !!plaus.isWorkingConflict,
    isNightShiftConflict: !!plaus.isNightShiftConflict, conflictDetails: plaus.isWorkingConflict ? plaus.reason : "",
    autoPlacedInBox: false, autoCleanedAfterShift: false, status: "approved"
  });
  syncExtraZones();
  document.getElementById("manualExtraEmpInput").value = ""; document.getElementById("manualExtraNote").value = ""; selectedManualExtraEmpId = null;
  logHistory("Bringschicht", (emp ? fullName(emp) : "") + " am " + formatDateDe(dateVal) + " (" + shiftsShortLabel[shiftVal] + ")");
  saveToFirebase(); renderEmployees(); renderInboxLists(); updateInboxBadge();
  showToast("Bringschicht eingetragen (Bereitstellung 1h vor Schichtbeginn)");
};

window.deleteExtraShift = function(id) {
  const es = extraShifts.find(x => x.id === id);
  if (es && es.covId) {
    const cov = leaveRequests.find(r => r.id === es.covId);
    if (cov && cov.days) {
      const dObj = cov.days.find(d => d.date === es.date && d.shift === es.shift);
      if (dObj && dObj.takenBy === es.empId) { dObj.takenBy = null; recalcCoverageOverallStatus(cov); }
    }
  }
  if (es) { const emp = employees.find(e => e.id === es.empId); if (emp && emp.zone === "extra") emp.zone = "pool"; }
  extraShifts = extraShifts.filter(x => x.id !== id);
  saveToFirebase(); renderEmployees(); renderInboxLists(); updateInboxBadge();
};

window.ackEmpPartialResponse = function(slId) {
  const sl = sickLeaves.find(x => x.id === slId);
  if (sl) { sl.empRespondedUnread = false; saveToFirebase(); renderInboxLists(); updateInboxBadge(); }
};

window.setInboxHistoryCategoryFilter = function(cat) {
  window.activeInboxHistoryCategory = cat || "ALL";
  renderInboxLists();
};

function classifyInboxActiveItem(sl) {
  const cat = (sl.category || "").toLowerCase();
  if (cat.indexOf("urlaub") !== -1 || cat.indexOf("freizeit") !== -1) return "URLAUB";
  if (cat.indexOf("krank") !== -1 || cat.indexOf("abwesen") !== -1 || cat.indexOf("arbeitsunfähig") !== -1) return "KRANK";
  return "EXTRA";
}

window.renderInboxLists = function() {
  const unreadEl = document.getElementById("unreadSickList"), activeEl = document.getElementById("activeSickList"), extraEl = document.getElementById("inboxExtraList");
  if (!unreadEl || !activeEl) return;
  const today = getTodayIso();
  const matchQuery = (empId, text) => {
    if (!inboxSearchQuery) return true;
    const emp = employees.find(e => e.id === empId);
    return (emp ? fullName(emp).toLowerCase() : "").indexOf(inboxSearchQuery) !== -1 || (text || "").toLowerCase().indexOf(inboxSearchQuery) !== -1;
  };

  const pendingLeaves = sickLeaves.filter(sl => (sl.status === "pending" || sl.empRespondedUnread || sl.plannerUnreadInfo) && matchQuery(sl.empId, sl.category));
  const pendingExtras = extraShifts.filter(es => es.status === "pending" && matchQuery(es.empId, (es.note || "") + " " + (es.forAbsentEmpName || "")));
  const covPrompts = leaveRequests.filter(r => {
    const hasRelevantDays = (r.days || []).some(d => d.date >= today && d.dayStatus !== "dismissed");
    return hasRelevantDays && (r.status === "planner_prompt" || r.status === "open") && matchQuery(r.empId, r.role + " " + (r.category || ""));
  });
  const active = sickLeaves.filter(sl => sl.status !== "pending" && matchQuery(sl.empId, sl.category));
  const extras = extraShifts.filter(es => es.status === "approved" && es.date >= today && matchQuery(es.empId, es.note));

  let unreadHtml = "";

  pendingLeaves.forEach(sl => {
    const emp = employees.find(e => e.id === sl.empId), name = emp ? fullName(emp) : "Unbekannt";
    
    if (sl.lineRequestData && sl.lineRequestData.lineId) {
      const lineObj = lines.find(l => l.id === sl.lineRequestData.lineId);
      const lineName = lineObj ? lineObj.name : sl.lineRequestData.lineId;
      const typeLabel = sl.lineRequestData.type === 'prio' ? 'Stammlinie (Prio)' : 'Sekundärlinie';

      unreadHtml += '<div class="sick-card unread" style="background:#f0fdf4; border:1px solid #86efac; border-left:5px solid #16a34a; padding:12px; border-radius:8px; margin-bottom:8px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">' +
          '<div><b>🏭 Linien-Antrag: ' + name + '</b><br>' +
          '<span style="font-size:0.83rem; color:#1e293b;">Möchte <b>' + lineName + '</b> als <b>' + typeLabel + '</b> eintragen.</span>' +
          (sl.reason ? '<br><small style="color:#475569;">' + sl.reason + '</small>' : '') + '</div>' +
          '<div style="display:flex; gap:6px;">' +
            '<button class="btn btn-primary" style="padding:4px 10px; font-size:0.75rem; background:#16a34a;" onclick="quickApproveLeave(\'' + sl.id + '\', true)">✅ Genehmigen</button>' +
            '<button class="btn btn-primary" style="padding:4px 10px; font-size:0.75rem; background:#dc2626;" onclick="quickApproveLeave(\'' + sl.id + '\', false)">❌ Ablehnen</button>' +
          '</div>' +
        '</div></div>';
      return;
    }

    if (sl.plannerUnreadInfo) {
      const probLines = emp ? window.getEmpProbableLinesText(emp) : "";
      unreadHtml += '<div class="sick-card unread" style="background:#fef2f2; border:1px solid #fca5a5; border-left:5px solid #dc2626; padding:12px; border-radius:8px; margin-bottom:8px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">' +
          '<div><b>🏥 Neue Meldung: ' + name + ' (' + (sl.category || 'Krank') + ')</b><br>' +
          '<span style="font-size:0.83rem; color:#1e293b;">Zeitraum: <b>' + formatDateDe(sl.startDate) + ' bis ' + formatDateDe(sl.endDate) + '</b>' + (probLines ? ' · <b>' + probLines + '</b>' : '') + '</span>' +
          (sl.reason ? '<br><small style="color:#475569;">' + sl.reason + '</small>' : '') +
          '<div style="font-size:0.74rem; color:#166534; font-weight:700; margin-top:4px;">✅ Bereits automatisch im System eingepflegt</div></div>' +
          '<button class="btn btn-primary" style="padding:5px 12px; font-size:0.75rem; background:#0284c7;" onclick="ackSickLeaveInfo(\'' + sl.id + '\')">👁️ Als gelesen markieren</button>' +
        '</div></div>';
      return;
    }
    if (sl.empRespondedUnread && sl.status !== "pending") {
      const isAcc = sl.status === "approved";
      unreadHtml += '<div class="sick-card unread" style="background:' + (isAcc ? '#f0fdf4' : '#fef2f2') + '; border:1px solid ' + (isAcc ? '#86efac' : '#fecaca') + '; padding:12px; border-radius:8px; margin-bottom:8px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          '<div><b>🔔 Rückmeldung von ' + name + '</b><br><span style="font-size:0.82rem;">Hat deinen Gegenvorschlag für <b>' + sl.category + '</b> ' + (isAcc ? '<b style="color:#166534;">✅ ANGENOMMEN</b>' : '<b style="color:#b91c1c;">❌ ABGELEHNT</b>') + '.</span></div>' +
          '<button class="btn btn-outline" style="padding:4px 10px; font-size:0.75rem;" onclick="ackEmpPartialResponse(\'' + sl.id + '\')">👍 OK</button>' +
        '</div></div>';
      return;
    }
    unreadHtml += '<div class="sick-card unread" style="background:#fffbeb; border:1px solid #fde68a; padding:12px; border-radius:8px; margin-bottom:8px;">' +
      '<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><b>' + name + '</b><span style="color:#b45309; font-weight:700; font-size:0.75rem;">⏳ Offener Urlaubsantrag</span></div>' +
      '<div style="font-size:0.85rem; margin-bottom:8px;"><b>' + (sl.category || 'Urlaub') + '</b>: ' + formatDateDe(sl.startDate) + ' bis ' + formatDateDe(sl.endDate) + (sl.reason ? '<br><em>' + sl.reason + '</em>' : '') + '</div>' +
      '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">' +
        '<button class="btn btn-primary" style="padding:4px 10px; font-size:0.75rem; background:#16a34a;" onclick="quickApproveLeave(\'' + sl.id + '\', true)">✅ Annehmen</button>' +
        '<button class="btn btn-primary" style="padding:4px 10px; font-size:0.75rem; background:#dc2626;" onclick="quickApproveLeave(\'' + sl.id + '\', false)">❌ Ablehnen</button>' +
        '<button class="btn btn-outline" style="padding:4px 10px; font-size:0.75rem; color:#0284c7; border-color:#0284c7;" onclick="openReviewLeaveModal(\'' + sl.id + '\')">⚠️ Teilgenehmigen / Gegenvorschlag</button>' +
      '</div></div>';
  });

  pendingExtras.forEach(es => {
    const emp = employees.find(e => e.id === es.empId), name = emp ? fullName(emp) : "Unbekannt";
    const regShift = emp ? window.getEmpRegularShiftOnDate(emp, es.date) : null;
    const nightBefore = emp ? window.didEmpWorkNightBefore(emp, es.date) : false;
    const hasConflict = !!(es.plausibilityWarning || es.isNightShiftConflict || regShift || nightBefore);
    let conflictText = es.conflictDetails || "";
    if (!conflictText) {
      if (nightBefore) conflictText = "Mitarbeiter hatte an diesem Tag bis morgens eine Nachtschicht!";
      else if (regShift) conflictText = "Arbeitet am " + formatDateDe(es.date) + " bereits regulär in der " + (shiftsLabel[regShift] || regShift);
    }
    const forWhoInfo = es.forAbsentEmpName ? ' · <span style="color:#0369a1; font-weight:700;">Ersatz für: ' + es.forAbsentEmpName + (es.probableLines ? ' (' + es.probableLines + ')' : '') + '</span>' : '';

    const warnBanner = hasConflict
      ? '<div style="background:#fef2f2; border:2px solid #dc2626; color:#b91c1c; padding:7px 10px; border-radius:6px; font-size:0.8rem; font-weight:800; margin-bottom:8px;">❗ ACHTUNG PLAUSIBILITÄT PRÜFEN: ' + conflictText + '</div>'
      : '<div style="background:#dcfce7; color:#166534; padding:3px 8px; border-radius:4px; font-size:0.73rem; font-weight:700; margin-bottom:6px; display:inline-block;">✅ Prüfung OK (Mitarbeiter hat Freischicht)</div>';

    unreadHtml += '<div class="sick-card unread" style="background:' + (hasConflict ? '#fff1f2' : '#f0fdf4') + '; border:1px solid ' + (hasConflict ? '#fca5a5' : '#86efac') + '; padding:12px; border-radius:8px; margin-bottom:8px;">' +
      '<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><b>✋ Bringschicht-Angebot: ' + name + '</b><span style="color:' + (hasConflict ? '#dc2626' : '#166534') + '; font-weight:800; font-size:0.75rem;">' + (hasConflict ? '❗ Konflikt aktiv' : 'Neu') + '</span></div>' +
      warnBanner +
      '<div style="font-size:0.84rem; margin-bottom:8px;">Möchte am <b>' + formatDateDe(es.date) + ' (' + (shiftsLabel[es.shift] || es.shift) + ')</b> einspringen' + forWhoInfo + '.' + (es.note ? '<br><small style="color:#475569;">' + es.note + '</small>' : '') + '</div>' +
      '<div style="display:flex; gap:6px;">' +
        '<button class="btn btn-primary" style="padding:4px 10px; font-size:0.75rem; background:#16a34a;" onclick="decideExtraShiftRequest(\'' + es.id + '\', true)">✅ Genehmigen</button>' +
        '<button class="btn btn-primary" style="padding:4px 10px; font-size:0.75rem; background:#dc2626;" onclick="decideExtraShiftRequest(\'' + es.id + '\', false)">❌ Ablehnen (Portal informieren)</button>' +
      '</div></div>';
  });

  covPrompts.forEach(cov => {
    const absentEmp = employees.find(e => e.id === cov.empId);
    const absentName = absentEmp ? fullName(absentEmp) : "Unbekannter Mitarbeiter";
    const probLinesTxt = cov.probableLines || (absentEmp ? window.getEmpProbableLinesText(absentEmp) : "Stammlinie");
    const visibleDays = (cov.days || []).filter(d => d.date >= today && d.dayStatus !== "dismissed");
    if (!visibleDays.length) return;

    const daysRowsHtml = visibleDays.map(d => {
      const fTeamName = (teamsConfig[d.freeTeam] ? teamsConfig[d.freeTeam].name : "Freischicht");
      const takenEmp = d.takenBy ? employees.find(e => e.id === d.takenBy) : null;
      const dStat = d.dayStatus || "pending";
      let rightControls = "";
      if (takenEmp) {
        rightControls = '<span style="color:#166534; font-weight:700;">✅ Übernommen von ' + fullName(takenEmp) + '</span>';
      } else {
        const isSelectedByDefault = dStat === "pending" || dStat === "open";
        const isPortalActive = dStat === "open";
        rightControls =
          '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' +
            '<span style="color:#64748b; font-size:0.72rem;">Frei hat: ' + fTeamName + '</span>' +
            (isPortalActive ? '<span style="background:#dcfce7; color:#166534; padding:1px 6px; border-radius:4px; font-weight:700; font-size:0.68rem;">📢 Im Portal aktiv</span>' : '') +
            '<label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer; font-size:0.78rem; font-weight:600; color:#334155; background:#f8fafc; padding:2px 6px; border:1px solid #cbd5e1; border-radius:4px;">' +
              '<input type="checkbox" class="cov-day-chk-' + cov.id + '" data-date="' + d.date + '" data-shift="' + d.shift + '" ' + (isSelectedByDefault ? 'checked' : '') + '> Auswählen' +
            '</label></div>';
      }
      return '<div style="font-size:0.78rem; padding:6px 8px; background:#fff; border-radius:6px; border:1px solid #bae6fd; display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">' +
        '<span>📅 <b>' + formatDateDe(d.date) + '</b> · ' + (shiftsLabel[d.shift] || d.shift) + '</span>' + rightControls + '</div>';
    }).join("");

    unreadHtml += '<div class="sick-card" style="background:#f0f9ff; border:1px solid #7dd3fc; border-left:4px solid #0284c7; padding:12px; border-radius:8px; margin-bottom:8px;">' +
      '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px; gap:8px; flex-wrap:wrap;">' +
        '<div>' +
          '<b>📢 Bringschicht-Ausschreibung für: <span style="color:#0369a1;">' + absentName + '</span></b>' +
          '<div style="font-size:0.78rem; color:#1e293b; margin-top:2px;">Grund: <b>' + (cov.category || 'Abwesenheit') + '</b> (' + formatDateDe(cov.startDate) + ' – ' + formatDateDe(cov.endDate) + ') · Rolle: <b>' + cov.role + '</b> · <b style="color:#0369a1;">' + (probLinesTxt || 'Linie offen') + '</b></div>' +
          '<div style="font-size:0.71rem; color:#475569; margin-top:2px;">🔒 Im Portal wird der Name verdeckt und nur <b>' + (probLinesTxt || cov.role) + '</b> angezeigt.</div>' +
        '</div>' +
        '<label style="display:inline-flex; align-items:center; gap:4px; font-size:0.74rem; font-weight:700; cursor:pointer;"><input type="checkbox" checked onchange="toggleAllCovCheckboxes(\'' + cov.id + '\', this)"> Alle an/ab</label>' +
      '</div>' +
      '<div style="display:flex; flex-direction:column; gap:5px; margin:8px 0;">' + daysRowsHtml + '</div>' +
      '<div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">' +
        '<button class="btn btn-primary" style="padding:5px 12px; font-size:0.75rem; background:#0284c7;" onclick="publishSelectedCoverageDays(\'' + cov.id + '\')">📢 Markierte Tage ans Portal senden</button>' +
        '<button class="btn btn-outline" style="padding:5px 10px; font-size:0.75rem; color:#dc2626;" onclick="dismissSelectedCoverageDays(\'' + cov.id + '\')">✖ Markierte Tage ausschließen</button>' +
        '<button class="btn btn-outline" style="padding:5px 10px; font-size:0.75rem; color:#dc2626;" onclick="decideCoveragePrompt(\'' + cov.id + '\', false)">🗑️ Komplett beenden</button>' +
      '</div></div>';
  });

  unreadEl.innerHTML = unreadHtml || '<p style="font-size:0.82rem; color:#64748b;">Keine offenen Anträge oder Anfragen.</p>';

  if (extraEl) {
    extraEl.innerHTML = extras.length ? extras.map(es => {
      const emp = employees.find(e => e.id === es.empId), bounds = getShiftTimeBounds(es.date, es.shift);
      const prepTimeStr = new Date(bounds.prepStartMs).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      return '<div class="sick-card extra-card" style="display:flex; justify-content:space-between; align-items:center;">' +
        '<div><b>' + (emp ? fullName(emp) : "Unbekannt") + '</b> · <span style="color:#166534; font-weight:700;">' + formatDateDe(es.date) + ' (' + (shiftsLabel[es.shift] || es.shift) + ')</span>' +
        '<br><small style="color:#0369a1; font-weight:600;">⏰ Bereitstellung im Bringschichtfenster am ' + formatDateDe(es.date) + ' ab ' + prepTimeStr + ' Uhr (1h vor Schichtbeginn)</small>' +
        (es.note ? '<br><small style="color:#475569;">' + es.note + '</small>' : '') + '</div>' +
        '<div style="display:flex; gap:6px;">' +
          '<button class="btn btn-outline" style="padding:3px 8px; font-size:0.72rem; color:#166534;" onclick="moveEmpToExtraZone(\'' + es.empId + '\')">📥 Jetzt in Box</button>' +
          '<button class="btn btn-outline" style="padding:3px 8px; font-size:0.72rem; color:#dc2626;" onclick="deleteExtraShift(\'' + es.id + '\')">🗑️</button>' +
        '</div></div>';
    }).join("") : '<p style="font-size:0.82rem; color:#64748b;">Keine eingetragenen Bringschichten.</p>';
  }

  let inboxActiveCatBar = document.getElementById("inboxHistoryFilterBar");
  if (!inboxActiveCatBar && activeEl && activeEl.parentNode) {
    inboxActiveCatBar = document.createElement("div"); inboxActiveCatBar.id = "inboxHistoryFilterBar";
    inboxActiveCatBar.style.cssText = "display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; align-items:center;";
    activeEl.parentNode.insertBefore(inboxActiveCatBar, activeEl);
  }
  if (typeof window.activeInboxHistoryCategory === "undefined") window.activeInboxHistoryCategory = "ALL";
  const inboxCats = [
    { id: "ALL", label: "📋 Alle" },
    { id: "URLAUB", label: "🌴 Urlaub" },
    { id: "KRANK", label: "🏥 Krank" },
    { id: "EXTRA", label: "➕ Bringschicht" }
  ];
  if (inboxActiveCatBar) {
    inboxActiveCatBar.innerHTML = inboxCats.map(c => {
      const activeBtn = window.activeInboxHistoryCategory === c.id;
      return '<button type="button" onclick="window.activeInboxHistoryCategory=\'' + c.id + '\'; renderInboxLists();" style="padding:4px 8px; border-radius:6px; font-size:0.73rem; font-weight:700; cursor:pointer; border:1px solid ' + (activeBtn ? '#0091df' : '#cbd5e1') + '; background:' + (activeBtn ? '#f0f9ff' : '#f8fafc') + '; color:' + (activeBtn ? '#0091df' : '#475569') + ';">' + c.label + '</button>';
    }).join("");
  }

  const activeSearchEl = document.getElementById("inboxActiveSearchInput"), activeQuery = activeSearchEl ? activeSearchEl.value.trim().toLowerCase() : "";

  const filteredActive = active.filter(sl => {
    const catUpper = classifyInboxActiveItem(sl);
    if (window.activeInboxHistoryCategory !== "ALL" && catUpper !== window.activeInboxHistoryCategory) return false;
    if (!activeQuery) return true;
    const emp = employees.find(e => e.id === sl.empId);
    const searchStr = ((emp ? fullName(emp) : "") + " " + (sl.category || "") + " " + (sl.reason || "") + " " + (sl.startDate || "")).toLowerCase();
    return searchStr.indexOf(activeQuery) !== -1;
  });

  activeEl.innerHTML = filteredActive.length ? filteredActive.map(sl => {
    const emp = employees.find(e => e.id === sl.empId), isFuture = sl.startDate > today;
    let statusBadge = sl.status === "approved"
      ? '<span style="color:#166534; font-weight:700;">✅ ' + (isFuture ? 'Vorgemerkt (ab ' + formatDateDe(sl.startDate) + ')' : 'Aktiv') + '</span>'
      : (sl.status === "rejected" ? '<span style="color:#b91c1c; font-weight:700;">❌ Abgelehnt</span>' : '<span style="color:#0284c7; font-weight:700;">⚠️ Teilgenehmigt</span>');
    return '<div class="sick-card" style="padding:10px; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:6px; font-size:0.85rem; display:flex; justify-content:space-between; align-items:center;">' +
      '<div><b>' + (emp ? fullName(emp) : "Unbekannt") + '</b> (' + (sl.category || 'Abwesend') + ')<br><small style="color:#64748b;">Von ' + formatDateDe(sl.startDate) + ' bis ' + formatDateDe(sl.endDate) + ' · ' + (sl.reviewedBy || 'Planer') + '</small></div>' +
      '<div style="display:flex; align-items:center; gap:8px;">' + statusBadge + '<button class="btn btn-outline" style="padding:2px 6px; font-size:0.7rem; color:#dc2626;" onclick="deleteSickLeave(\'' + sl.id + '\')">🗑️</button></div></div>';
  }).join("") : '<p style="font-size:0.82rem; color:#64748b;">Keine bearbeiteten Einträge gefunden.</p>';
}

window.quickApproveLeave = function(slId, isApproved) {
  const sl = sickLeaves.find(x => x.id === slId); if (!sl) return;
  if (!isApproved) {
    const reasonInput = prompt("Bitte gib einen Grund für die Ablehnung an (optional):", "Leider aktuell nicht möglich");
    if (reasonInput === null) return;
    sl.reason = reasonInput.trim() || "Vom Planer abgelehnt";
  }
  sl.status = isApproved ? "approved" : "rejected"; sl.plannerUnreadInfo = false;
  if (sl.blocks && sl.blocks.length) sl.blocks.forEach(b => { b.status = isApproved ? "approved" : "rejected"; });
  sl.reviewedBy = currentPlannerName || "Planer"; sl.reviewedAt = new Date().toLocaleString("de-DE");
  if (isApproved) generateCoveragePromptForLeave(sl);
  syncAbsentZones();
  saveToFirebase(); renderEmployees(); renderInboxLists(); updateInboxBadge();
  showToast(isApproved ? "Antrag angenommen" : "Antrag abgelehnt");
};

window.openReviewLeaveModal = function(slId) {
  let sl = sickLeaves.find(x => x.id === slId); if (!sl) return;
  const emp = employees.find(e => e.id === sl.empId);
  let modal = document.getElementById("reviewLeaveModal");
  if (!modal) {
    modal = document.createElement("div"); modal.id = "reviewLeaveModal"; modal.className = "modal-overlay";
    modal.style.cssText = "display:flex; position:fixed; inset:0; background:rgba(15,23,42,0.65); z-index:9999; align-items:center; justify-content:center; padding:16px;";
    document.body.appendChild(modal);
  }
  let blocksHtml = (sl.blocks && sl.blocks.length ? sl.blocks : [{ start: sl.startDate, end: sl.endDate, status: "approved", reason: "" }]).map(b =>
    '<div class="review-block-row" style="background:#f8fafc; border:1px solid #cbd5e1; padding:10px; border-radius:6px; margin-bottom:8px; display:flex; flex-direction:column; gap:6px;"><div style="display:flex; gap:8px; align-items:center;"><input type="date" class="rb-start form-control" value="' + b.start + '" style="font-size:0.8rem;"><input type="date" class="rb-end form-control" value="' + b.end + '" style="font-size:0.8rem;"><select class="rb-status form-control" style="font-size:0.8rem; font-weight:700;"><option value="approved"' + (b.status === 'approved' ? ' selected' : '') + '>✅ Genehmigt</option><option value="rejected"' + (b.status === 'rejected' ? ' selected' : '') + '>❌ Abgelehnt</option></select></div><input type="text" class="rb-reason form-control" placeholder="Begründung / Hinweis zum Gegenvorschlag..." value="' + (b.reason || '') + '" style="font-size:0.8rem;"></div>'
  ).join("");
  modal.innerHTML = '<div style="background:#fff; border-radius:12px; max-width:500px; width:100%; padding:22px; box-shadow:0 10px 25px rgba(0,0,0,0.2); max-height:90vh; overflow-y:auto;"><h3 style="margin:0 0 4px 0; color:#10384f; font-size:1.1rem;">Gegenvorschlag / Teilgenehmigung</h3><p style="font-size:0.84rem; color:#475569; margin-bottom:12px;">Mitarbeiter: <b>' + (emp ? fullName(emp) : 'Unbekannt') + '</b></p><div id="reviewBlocksContainer" style="margin-bottom:10px;">' + blocksHtml + '</div><button class="btn btn-outline" style="font-size:0.75rem; margin-bottom:14px;" onclick="addReviewBlockRow()">+ Weiteren Zeitraum hinzufügen</button><div style="display:flex; gap:8px;"><button class="btn btn-primary" style="flex:1;" onclick="saveReviewLeave(\'' + sl.id + '\')">Gegenvorschlag senden</button><button class="btn btn-outline" onclick="closeModal(\'reviewLeaveModal\')">Abbrechen</button></div></div>';
  modal.style.display = "flex";
};

window.addReviewBlockRow = function() {
  const c = document.getElementById("reviewBlocksContainer"); if (!c) return;
  const div = document.createElement("div"); div.className = "review-block-row";
  div.style.cssText = "background:#f8fafc; border:1px solid #cbd5e1; padding:10px; border-radius:6px; margin-bottom:8px; display:flex; flex-direction:column; gap:6px;";
  div.innerHTML = '<div style="display:flex; gap:8px; align-items:center;"><input type="date" class="rb-start form-control" style="font-size:0.8rem;"><input type="date" class="rb-end form-control" style="font-size:0.8rem;"><select class="rb-status form-control" style="font-size:0.8rem; font-weight:700;"><option value="approved">✅ Genehmigt</option><option value="rejected">❌ Abgelehnt</option></select></div><input type="text" class="rb-reason form-control" placeholder="Begründung für diesen Block..." style="font-size:0.8rem;">';
  c.appendChild(div);
};

window.saveReviewLeave = function(slId) {
  const sl = sickLeaves.find(x => x.id === slId); if (!sl) return;
  const newBlocks = []; let hasApproved = false, hasRejected = false, invalidOrder = false;
  document.querySelectorAll(".review-block-row").forEach(r => {
    const s = r.querySelector(".rb-start").value, e = r.querySelector(".rb-end").value, st = r.querySelector(".rb-status").value, rs = r.querySelector(".rb-reason").value.trim();
    if (s && e) { if (s > e) invalidOrder = true; newBlocks.push({ start: s, end: e, status: st, reason: rs }); if (st === "approved") hasApproved = true; if (st === "rejected") hasRejected = true; }
  });
  if (invalidOrder) { showToast("Startdatum darf nicht nach Enddatum liegen", true); return; }
  if (!newBlocks.length) { showToast("Bitte mind. einen Zeitraum angeben", true); return; }
  sl.blocks = newBlocks; sl.status = (hasApproved && hasRejected) ? "partial" : (hasApproved ? "approved" : "rejected");
  sl.reviewedBy = currentPlannerName || "Planer"; sl.reviewedAt = new Date().toLocaleString("de-DE");
  if (sl.status === "approved") generateCoveragePromptForLeave(sl);
  syncAbsentZones();
  saveToFirebase(); renderEmployees(); renderInboxLists(); updateInboxBadge(); closeModal("reviewLeaveModal"); showToast("Entscheidung gespeichert");
};

window.moveEmpToExtraZone = function(empId) {
  const emp = employees.find(e => e.id === empId);
  if (emp) { emp.zone = "extra"; saveToFirebase(); renderEmployees(); showToast(fullName(emp) + " in Bringschicht-Box gesetzt"); }
};
window.deleteSickLeave = function(id) {
  sickLeaves = sickLeaves.filter(x => x.id !== id); leaveRequests = leaveRequests.filter(r => r.slId !== id);
  syncAbsentZones(); saveToFirebase(); renderEmployees(); renderInboxLists(); updateInboxBadge(); showToast("Eintrag gelöscht");
};
window.markAllSickLeavesRead = function() {
  sickLeaves.forEach(sl => { sl.empRespondedUnread = false; sl.plannerUnreadInfo = false; });
  saveToFirebase(); renderInboxLists(); updateInboxBadge();
};
window.forceRefreshFromServer = function() { boardRef.get().then(doc => { if (doc.exists) applyIncomingDocData(doc.data()); }); };

// EINSTELLUNGEN, FILTER, HISTORIE & BACKUPS
function applyTeamStyles() {
  let st = document.getElementById("dynamicTeamStyles");
  if (!st) { st = document.createElement("style"); st.id = "dynamicTeamStyles"; document.head.appendChild(st); }
  st.textContent = Object.keys(teamsConfig).sort().map(k => '.employee-card[data-team="' + k + '"] { border-left-color: ' + teamsConfig[k].color + ' !important; }').join("\n");
}
function updateTeamDropdowns() {
  const keys = Object.keys(teamsConfig).sort(), freiSel = document.getElementById("teamSelect_frei");
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
  const clearBtn = document.getElementById("clearSearchBtn"); if (clearBtn) clearBtn.style.display = poolSearchQuery ? "block" : "none";
  renderEmployees();
}
function renderTeamFilterCheckboxes() {
  const c = document.getElementById("teamFilterContainer"); if (!c) return;
  c.innerHTML = Object.keys(teamsConfig).sort().map(k => '<label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer;"><input type="checkbox" ' + (activeTeamFilters[k] !== false ? 'checked' : '') + ' onchange="activeTeamFilters[\'' + k + '\']=this.checked; renderEmployees();"> <span style="color:' + teamsConfig[k].color + '; font-weight:700;">■</span> ' + teamsConfig[k].name + '</label>').join("");
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
function openLineEditModal(lineId) {
  if (plannerLevel === 2) return;
  const l = lines.find(x => x.id === lineId); if (!l) return;
  document.getElementById("editLineId").value = l.id; document.getElementById("lineEditTitle").textContent = l.name + " bearbeiten";
  document.getElementById("editLinePrio").value = l.prio || ""; document.getElementById("editLineTag").value = l.tag || ""; document.getElementById("editLineNote").value = l.note || "";
  document.getElementById("lineEditModal").style.display = "flex";
}
window.saveLineDetails = function(keepOpen) {
  if (plannerLevel === 2) return;
  const l = lines.find(x => x.id === document.getElementById("editLineId").value); if (!l) return;
  l.prio = document.getElementById("editLinePrio").value; l.tag = document.getElementById("editLineTag").value.trim(); l.note = document.getElementById("editLineNote").value.trim();
  saveToFirebase(); initBoard(); if (!keepOpen) closeModal("lineEditModal");
};
function openSettingsModal() {
  if (plannerLevel < 2) return;
  updateAccessLevelDropdownOptions(1); renderSettingsLists(); updateAutoRotationUI();
  const secChk = document.getElementById("secBoardPwEnabled"), secVal = document.getElementById("secBoardPwValue");
  if (secChk) secChk.checked = !!(securityConfig && securityConfig.boardPwEnabled);
  if (secVal) secVal.value = (securityConfig && securityConfig.boardPw) ? securityConfig.boardPw : "0110";
  document.getElementById("settingsModal").style.display = "flex";
  switchTab("tabEmployees", document.getElementById("tabBtnEmployees"));
}
function switchTab(t, btnEl) {
  if (plannerLevel === 2 && t !== "tabProfile") return;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  const target = document.getElementById(t); if (target) target.classList.add("active");
  if (t === "tabProfile") renderProfileTab();
  renderSettingsLists();
}
function updateRoleDropdown() {
  const sel = document.getElementById("newEmpRole"); if (sel) sel.innerHTML = roles.map(r => '<option value="' + r + '">' + r + '</option>').join("");
}
window.setSettingsEmpTeamFilter = function(val) { settingsEmpTeamFilter = val || "ALL"; renderSettingsLists(); };
window.setSettingsEmpRoleFilter = function(val) { settingsEmpRoleFilter = val || "ALL"; renderSettingsLists(); };
window.resetEmployeePin = function(empId) {
  const emp = employees.find(e => e.id === empId); if (!emp) return;
  if (!canManageEmployee(emp)) { showToast("❌ Keine Berechtigung für Stufe " + (emp.accessLevel || 1) + "!", true); return; }
  const newPin = generateStartPin(); emp.password = newPin; emp.mustChangePw = true;
  logHistory("Sicherheit", "Neue Start-PIN für " + fullName(emp) + " generiert");
  saveToFirebase(); renderSettingsLists(); showToast("🔑 Neue Start-PIN für " + fullName(emp) + ": " + newPin);
};

window.toggleAnchorDay = function(dayNum, btnEl) {
  const container = document.getElementById("anchorDaysContainer"); if (!container) return;
  let days = container._selectedDays || [1, 2, 3, 4, 5];
  const idx = days.indexOf(dayNum);
  if (idx !== -1) days.splice(idx, 1); else days.push(dayNum);
  container._selectedDays = days;
  renderAnchorDayButtons(days);
};

window.setAnchorPreset = function(preset) {
  const container = document.getElementById("anchorDaysContainer"); if (!container) return;
  let days = [1, 2, 3, 4, 5];
  if (preset === "mo-mi") days = [1, 2, 3];
  else if (preset === "mo-fr") days = [1, 2, 3, 4, 5];
  else if (preset === "alle") days = [0, 1, 2, 3, 4, 5, 6];
  container._selectedDays = days;
  renderAnchorDayButtons(days);
};

function renderAnchorDayButtons(selectedDays) {
  const container = document.getElementById("anchorDaysContainer"); if (!container) return;
  container._selectedDays = selectedDays || [1, 2, 3, 4, 5];
  const dayNames = [{n:1, l:"Mo"}, {n:2, l:"Di"}, {n:3, l:"Mi"}, {n:4, l:"Do"}, {n:5, l:"Fr"}, {n:6, l:"Sa"}, {n:0, l:"So"}];
  
  container.innerHTML =
    '<div style="display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap;">' +
      dayNames.map(d => {
        const active = container._selectedDays.indexOf(d.n) !== -1;
        return '<button type="button" onclick="toggleAnchorDay(' + d.n + ', this)" style="padding:6px 10px; border-radius:6px; font-size:0.78rem; font-weight:700; cursor:pointer; border:1px solid ' + (active ? '#0091df' : '#cbd5e1') + '; background:' + (active ? '#0091df' : '#fff') + '; color:' + (active ? '#fff' : '#475569') + ';">' + d.l + '</button>';
      }).join("") +
    '</div>' +
    '<div style="display:flex; gap:10px; font-size:0.75rem; align-items:center;">' +
      '<span style="color:#64748b;">Schnellwahl:</span>' +
      '<span onclick="setAnchorPreset(\'mo-mi\')" style="color:var(--bayer-blue); cursor:pointer; font-weight:600; text-decoration:underline;">Mo–Mi</span>' +
      '<span onclick="setAnchorPreset(\'mo-fr\')" style="color:var(--bayer-blue); cursor:pointer; font-weight:600; text-decoration:underline;">Mo–Fr</span>' +
      '<span onclick="setAnchorPreset(\'alle\')" style="color:var(--bayer-blue); cursor:pointer; font-weight:600; text-decoration:underline;">Ganze Woche</span>' +
    '</div>';
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
      filterBar.innerHTML = '<select class="form-control" style="flex:1; min-width:130px; padding:6px 8px; font-size:0.8rem;" onchange="setSettingsEmpTeamFilter(this.value)"><option value="ALL">👥 Alle Teams</option>' + teamKeys.map(k => '<option value="' + k + '"' + (settingsEmpTeamFilter === k ? ' selected' : '') + '>' + teamsConfig[k].name + '</option>').join("") + '</select><select class="form-control" style="flex:1; min-width:130px; padding:6px 8px; font-size:0.8rem;" onchange="setSettingsEmpRoleFilter(this.value)"><option value="ALL">🏷️ Alle Rollen</option>' + roles.map(r => '<option value="' + r + '"' + (settingsEmpRoleFilter === r ? ' selected' : '') + '>' + r + '</option>').join("") + '</select><span style="font-size:0.75rem; color:#64748b; font-weight:700; padding:0 4px;">' + filtered.length + ' / ' + employees.length + '</span>';
    }
    empListEl.innerHTML = filtered.map(e => {
      const tObj = teamsConfig[e.team] || { name: e.team, color: "#0091df" }, empLvl = Number(e.accessLevel || 1), manageable = canManageEmployee(e);
      const lvlBadge = '<span style="background:#e0f2fe; color:#0369a1; padding:1px 6px; border-radius:4px; font-size:0.7rem; font-weight:700; margin-left:4px;">Stufe ' + empLvl + '</span>';
      const pinBadge = manageable ? ((e.mustChangePw !== false) ? '<span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:1px 6px; border-radius:4px; font-size:0.72rem; font-weight:700; margin-left:6px;">🔑 Start-PIN: ' + (e.password || "1234") + '</span>' : '<span style="background:#dcfce7; color:#166534; padding:1px 6px; border-radius:4px; font-size:0.7rem; font-weight:600; margin-left:6px;">🔒 Eigene PIN</span>') : '<span style="background:#f1f5f9; color:#64748b; padding:1px 6px; border-radius:4px; font-size:0.7rem; font-weight:600; margin-left:6px;">🔒 Geschützt</span>';
      const actionBtns = manageable ? '<div style="display:flex; gap:5px;"><button class="btn btn-outline" style="padding:2px 8px; font-size:0.73rem; color:#b45309; border-color:#fcd34d;" onclick="resetEmployeePin(\'' + e.id + '\')">🔑 PIN-Reset</button>' + (plannerLevel > 2 ? '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem;" onclick="editEmployee(\'' + e.id + '\')">✏️</button><button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; color:#dc2626;" onclick="deleteEmployee(\'' + e.id + '\')">🗑️</button>' : '') + '</div>' : '<span style="font-size:0.72rem; color:#94a3b8; font-weight:600;">Nur Stufe ' + (empLvl + 1) + '+</span>';
      return '<div class="item-row" style="flex-wrap:wrap; gap:6px;"><span style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;"><span style="color:' + tObj.color + '; font-weight:700; margin-right:4px;">■</span> <b>' + fullName(e) + '</b> <small style="color:#64748b; margin-left:4px;">(' + tObj.name + ' · ' + e.role + ')</small>' + lvlBadge + pinBadge + '</span>' + actionBtns + '</div>';
    }).join("");
  }

  const roleListEl = document.getElementById("roleList");
  if (roleListEl) {
    roleListEl.innerHTML = roles.map(r => '<div class="item-row"><span><b>' + r + '</b></span>' + (plannerLevel > 2 ? '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; color:#dc2626;" onclick="deleteRole(\'' + r + '\')">🗑️ Löschen</button>' : '') + '</div>').join("");
  }

  const lineListEl = document.getElementById("lineSettingsList");
  if (lineListEl) {
    lineListEl.innerHTML = lines.map(l => '<div class="item-row"><span><b>' + l.name + '</b> ' + (l.prio ? '<small style="color:#b91c1c;">(' + l.prio + ')</small>' : '') + '</span>' + (plannerLevel > 2 ? '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; color:#dc2626;" onclick="deleteLine(\'' + l.id + '\')">🗑️ Löschen</button>' : '') + '</div>').join("");
  }

  const teamListEl = document.getElementById("teamSettingsList");
  if (teamListEl) {
    teamListEl.innerHTML = Object.keys(teamsConfig).sort().map(k => {
      const t = teamsConfig[k];
      const isRot = t.rotates !== false;
      return '<div class="item-row" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
        '<span style="display:flex; align-items:center; gap:8px;"><span style="width:14px; height:14px; background:' + t.color + '; border-radius:3px; display:inline-block;"></span><b>' + t.name + '</b></span>' +
        '<div style="display:flex; align-items:center; gap:10px;">' +
          '<label style="display:inline-flex; align-items:center; gap:4px; font-size:0.78rem; font-weight:600; cursor:pointer;" title="Direkt einstellen ob das Team rotiert">' +
            '<input type="checkbox" ' + (isRot ? 'checked' : '') + ' onchange="toggleTeamRotationSetting(\'' + k + '\', this.checked)"> Rotiert' +
          '</label>' +
          (plannerLevel > 2 ? '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.73rem; color:#dc2626;" onclick="deleteTeam(\'' + k + '\')">Löschen</button>' : '') +
        '</div>' +
      '</div>';
    }).join("");
  }
}

function renderProfileTab() {
  const box = document.getElementById("profileInfoBox"); if (!box) return;
  const emp = employees.find(e => e.id === currentPlannerEmpId);
  if (!emp && !isPlanner) { box.innerHTML = "<p>Bitte als Mitarbeiter/Planer anmelden.</p>"; return; }
  if (!emp && isPlanner) { box.innerHTML = "<p>System-Admin Account (globaler Admin). Stammdaten können über die Mitarbeiter-Tabelle bearbeitet werden.</p>"; return; }

  const teamKeys = Object.keys(teamsConfig).sort();
  const canEditDetails = plannerLevel >= 3;

  box.innerHTML =
    '<h4 style="font-size:0.9rem; color:var(--bayer-blue); margin-bottom:10px;">👤 Meine Stammdaten</h4>' +
    (!canEditDetails ? '<div style="background:#fef3c7; color:#b45309; padding:8px 10px; border-radius:6px; font-size:0.78rem; font-weight:700; margin-bottom:10px;">🔒 Stammdaten sind gesperrt. Du kannst hier deine persönliche PIN aktualisieren.</div>' : '') +
    '<div style="display:flex; gap:10px; margin-bottom:10px;"><div class="form-group" style="flex:1;"><label>Vorname</label><input type="text" id="profFirstName" class="form-control" value="' + (emp.firstName || "") + '" ' + (!canEditDetails ? 'disabled style="background:#f8fafc;"' : '') + '></div><div class="form-group" style="flex:1;"><label>Nachname</label><input type="text" id="profLastName" class="form-control" value="' + (emp.lastName || "") + '" ' + (!canEditDetails ? 'disabled style="background:#f8fafc;"' : '') + '></div></div>' +
    '<div style="display:flex; gap:10px; margin-bottom:10px;"><div class="form-group" style="flex:1;"><label>Team</label><select id="profTeam" class="form-control" ' + (!canEditDetails ? 'disabled style="background:#f8fafc;"' : '') + '>' + teamKeys.map(k => '<option value="' + k + '"' + (emp.team === k ? ' selected' : '') + '>' + teamsConfig[k].name + '</option>').join("") + '</select></div><div class="form-group" style="flex:1;"><label>Rolle</label><select id="profRole" class="form-control" ' + (!canEditDetails ? 'disabled style="background:#f8fafc;"' : '') + '>' + roles.map(r => '<option value="' + r + '"' + (emp.role === r ? ' selected' : '') + '>' + r + '</option>').join("") + '</select></div></div>' +
    (canEditDetails ? '<button class="btn btn-primary" style="width:100%; margin-top:6px;" onclick="saveMyProfileData()">Änderungen speichern</button>' : '');
}

window.saveMyProfileData = function() {
  if (plannerLevel === 2) return;
  const emp = employees.find(e => e.id === currentPlannerEmpId); if (!emp) return;
  emp.firstName = document.getElementById("profFirstName").value.trim();
  emp.lastName = document.getElementById("profLastName").value.trim();
  emp.team = document.getElementById("profTeam").value;
  emp.role = document.getElementById("profRole").value;
  
  currentPlannerName = fullName(emp);
  sessionStorage.setItem("planner_name", currentPlannerName);
  logHistory("Profil", fullName(emp) + " hat die eigenen Stammdaten aktualisiert");
  saveToFirebase(); initBoard(); showToast("✅ Deine Profildaten wurden gespeichert!");
};
