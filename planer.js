/* PLANER-BOARD LOGIK (planer.js) - Version 4.9.33 */
firebase.initializeApp({
  apiKey: "AIzaSyBPOYRYyUm5gA-j7YSAZl7EJoxedFhDTl4", authDomain: "schichtplan-bayer.firebaseapp.com",
  projectId: "schichtplan-bayer", storageBucket: "schichtplan-bayer.firebasestorage.app",
  messagingSenderId: "152929285194", appId: "1:152929285194:web:00b73aa6058a70aed3a2b3"
});
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
  if (nightBefore && shiftId === "nacht") {
    return { ok: true, regularShift: null, reason: "" };
  }

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

function openLineEditModal(lineId) {
  if (plannerLevel === 2) return;
  const l = lines.find(x => x.id === lineId); if (!l) return;
  if (!l.targetStaff) l.targetStaff = { frueh: 3, spaet: 3, nacht: 2 };

  document.getElementById("editLineId").value = l.id; 
  document.getElementById("lineEditTitle").textContent = l.name + " bearbeiten";
  document.getElementById("editLinePrio").value = l.prio || ""; 
  document.getElementById("editLineTag").value = l.tag || ""; 
  document.getElementById("editLineNote").value = l.note || "";
  
  if (document.getElementById("editLineStaffFrueh")) document.getElementById("editLineStaffFrueh").value = l.targetStaff.frueh;
  if (document.getElementById("editLineStaffSpaet")) document.getElementById("editLineStaffSpaet").value = l.targetStaff.spaet;
  if (document.getElementById("editLineStaffNacht")) document.getElementById("editLineStaffNacht").value = l.targetStaff.nacht;

  document.getElementById("lineEditModal").style.display = "flex";
}

window.saveLineDetails = function(keepOpen) {
  if (plannerLevel === 2) return;
  const l = lines.find(x => x.id === document.getElementById("editLineId").value); if (!l) return;
  l.prio = document.getElementById("editLinePrio").value; 
  l.tag = document.getElementById("editLineTag").value.trim(); 
  l.note = document.getElementById("editLineNote").value.trim();
  
  if (!l.targetStaff) l.targetStaff = { frueh: 3, spaet: 3, nacht: 2 };
  if (document.getElementById("editLineStaffFrueh")) l.targetStaff.frueh = Number(document.getElementById("editLineStaffFrueh").value) || 0;
  if (document.getElementById("editLineStaffSpaet")) l.targetStaff.spaet = Number(document.getElementById("editLineStaffSpaet").value) || 0;
  if (document.getElementById("editLineStaffNacht")) l.targetStaff.nacht = Number(document.getElementById("editLineStaffNacht").value) || 0;

  saveToFirebase(); initBoard(); if (!keepOpen) closeModal("lineEditModal");
};
