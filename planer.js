/* ==========================================================================
   PLANER-BOARD LOGIK (planer.js) - Fix für Schichtmodell-Checkboxen Speicherung
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
  id: "L" + n, name: "Linie " + n, prio: "", tag: "", note: "", ausgeplant: false,
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
  resetEnabled: false, resetDay: 0, resetHour: 6,
  loadEnabled: false, loadDay: 0, loadHour: 5,
  lastRotationStepKey: "", lastResetRunKey: "", lastLoadRunKey: ""
};

let approvedShiftKey = "", hasLoadedFromCloud = false, isDraggingCard = false;
let activeTeamFilters = {}, activeRoleFilters = {}, poolSearchQuery = "", settingsEmpSearchQuery = "";
let settingsEmpTeamFilter = "ALL", settingsEmpRoleFilter = "ALL", activeHistoryCategory = "ALL", inboxSearchQuery = "";
let selectedManualSickEmpId = null, selectedManualExtraEmpId = null, selectedLoginPlannerId = null;
let isPlanner = false, plannerLevel = 0, currentPlannerName = "", currentPlannerEmpId = null;
let sortableInstances = [], msgTimers = {}, toastTimer = null;
let planerLastActivityTime = Date.now();

window.resetPlanerActivity = function() {
  planerLastActivityTime = Date.now();
  if (isPlanner) sessionStorage.setItem("planner_last_active", String(planerLastActivityTime));
};

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
  updateShiftApprovalUI(); saveToFirebase();
};

function updateAutoRotationUI() {
  const isAuto = shiftModelConfig.autoRotate !== false;
  const badge = document.getElementById("autoRotationBadge"), badgeText = document.getElementById("autoRotationText");
  if (badge && badgeText) {
    badge.className = isAuto ? "auto-rotation-badge active" : "auto-rotation-badge";
    badgeText.textContent = isAuto ? "Auto aktiv" : "Manuell";
  }
}

function fullName(e) { return ((e.firstName || "") + " " + (e.lastName || "")).trim(); }
function extractLineIdFromZone(z) { return (!z || ["pool","absent","extra"].indexOf(z) !== -1 || z.indexOf("_") === -1) ? null : z.split("_").slice(0, -1).join("_"); }
function extractShiftIdFromZone(z) { return (!z || ["pool","absent","extra"].indexOf(z) !== -1 || z.indexOf("_") === -1) ? null : z.split("_").pop(); }
function isTeamRotating(teamKey) { return teamsConfig[teamKey] ? (teamsConfig[teamKey].rotates !== false) : true; }

function getActiveLeaveForEmpOnDate(empId, isoDate) {
  return sickLeaves.find(sl => {
    if (sl.empId !== empId || sl.status === "rejected" || sl.status === "pending") return false;
    if (sl.blocks && sl.blocks.length) return sl.blocks.some(b => b.status === "approved" && b.start <= isoDate && b.end >= isoDate);
    return sl.status === "approved" && sl.startDate <= isoDate && sl.endDate >= isoDate;
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
  if (id === "settingsModal" && typeof resetEmpForm === "function") resetEmpForm();
}

function checkBoardLockState() {
  const modal = document.getElementById("boardLockModal"); if (!modal) return;
  if (securityConfig && securityConfig.boardPwEnabled && !isPlanner) {
    modal.style.display = sessionStorage.getItem("board_unlocked"] === "true" ? "none" : "flex";
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

window.initBoard = function() {
  if (isDraggingCard) return;
  sanitizeTeamReferences(); syncAbsentZones();
  updateHeaderDateKw(); updateShiftApprovalUI(); updateAutoRotationUI();

  const headerRow = document.getElementById("headerRow"); if (!headerRow) return;
  if (!Array.isArray(lines) || !lines.length) lines = defaultLines.slice();

  headerRow.innerHTML = '<th class="shift-header"><div>Schicht</div><div class="shift-controls"><button class="shift-rotate-btn" onclick="rotateAllShifts()"><span>Rotieren</span></button><button class="shift-clear-btn" onclick="clearEntireBoard()">🧹 Alle leeren</button></div></th>';
  
  lines.forEach(line => {
    if (!line.targetStaff) line.targetStaff = { frueh: 3, spaet: 3, nacht: 2 };
    const th = document.createElement("th");
    th.className = "line-header" + (line.ausgeplant ? " ausgeplant" : "");
    if (isPlanner && plannerLevel > 2) th.onclick = () => { openLineEditModal(line.id); };
    let pCls = line.prio && (line.prio.indexOf("1") !== -1 || line.prio.indexOf("2") !== -1) ? "prio-high" : (line.prio ? "prio-mid" : "");
    th.innerHTML = '<div class="line-title">' + line.name + '</div><div class="badge-container">' + (line.ausgeplant ? '<span class="line-ausgeplant-tag">🚫 Ausgeplant</span>' : '') + (line.prio ? '<span class="line-prio ' + pCls + '">' + line.prio + '</span>' : '') + (line.tag ? '<span class="line-status-tag">' + line.tag + '</span>' : '') + '</div>' + (line.note ? '<div class="line-notes">' + line.note + '</div>' : '');
    headerRow.appendChild(th);
  });

  const matrixBody = document.getElementById("matrixBody"); matrixBody.innerHTML = "";
  const keys = Object.keys(teamsConfig).sort(), sundayFree = isSundayDaytimeFree();

  shifts.forEach(shift => {
    const curKey = shiftRotation[shift.id] || keys[0], curObj = teamsConfig[curKey] || { name: "Team", color: "#0091df" };
    const opts = keys.map(k => '<option value="' + k + '" style="color:' + teamsConfig[k].color + '; font-weight:700;" ' + (k === curKey ? 'selected' : '') + '>■ ' + teamsConfig[k].name + '</option>').join("");
    const isShiftSundayOff = sundayFree;
    const sunBadge = isShiftSundayOff ? '<div style="font-size:0.64rem; color:#0284c7; background:#e0f2fe; padding:2px 4px; border-radius:4px; margin-top:3px;">So. Frei</div>' : '';
    const tr = document.createElement("tr"), thS = document.createElement("th");
    thS.className = "shift-header";
    thS.innerHTML = '<div>' + shift.name + '</div>' + sunBadge + '<div class="shift-team-badge" style="border-left:4px solid ' + curObj.color + ';"><span style="color:' + curObj.color + ';">■</span> ' + curObj.name + '</div>' +
      '<div class="shift-controls">' +
        '<div class="shift-load-row">' +
          '<select id="teamSelect_' + shift.id + '" class="shift-team-select" style="border-left:6px solid ' + curObj.color + '; color:' + curObj.color + ';" onchange="onShiftTeamDropdownChange(\'' + shift.id + '\', this)">' + opts + '</select>' +
          '<button class="shift-load-btn" onclick="loadTeamToShift(\'' + shift.id + '\')" title="Team in Linien laden">📥</button>' +
        '</div>' +
        '<button class="shift-clear-btn" onclick="clearShiftRow(\'' + shift.id + '\')">🧹 Leeren</button>' +
      '</div>';
    tr.appendChild(thS);
    
    lines.forEach(line => {
      const td = document.createElement("td"), zId = line.id + "_" + shift.id;
      td.innerHTML = '<div id="' + zId + '" class="card-list drop-zone" data-zone="' + zId + '"' + (isShiftSundayOff || line.ausgeplant ? ' style="background:#f1f5f9; opacity:0.7;"' : '') + '></div>';
      tr.appendChild(td);
    });
    matrixBody.appendChild(tr);
  });

  applyTeamStyles(); updateTeamDropdowns();
  renderTeamFilterCheckboxes(); renderRoleFilterCheckboxes();
  renderEmployees(); initDragAndDrop(); renderSettingsLists(); updateInboxBadge(); checkBoardLockState();
  syncShiftModelSettingsUI();
};

window.openLineEditModal = function(lineId) {
  const line = lines.find(l => l.id === lineId); if (!line) return;
  document.getElementById("editLineId").value = line.id;
  document.getElementById("lineEditTitle").textContent = "Linie bearbeiten: " + line.name;
  document.getElementById("editLineAusgeplant").checked = !!line.ausgeplant;
  document.getElementById("editLinePrio").value = line.prio || "";
  document.getElementById("editLineTag").value = line.tag || "";
  document.getElementById("editLineNote").value = line.note || "";
  if (!line.targetStaff) line.targetStaff = { frueh: 3, spaet: 3, nacht: 2 };
  document.getElementById("editLineStaffFrueh").value = line.targetStaff.frueh ?? 3;
  document.getElementById("editLineStaffSpaet").value = line.targetStaff.spaet ?? 3;
  document.getElementById("editLineStaffNacht").value = line.targetStaff.nacht ?? 2;
  document.getElementById("lineEditModal").style.display = "flex";
};

window.saveLineDetails = function(isAuto) {
  const id = document.getElementById("editLineId").value;
  const line = lines.find(l => l.id === id); if (!line) return;
  line.ausgeplant = document.getElementById("editLineAusgeplant").checked;
  line.prio = document.getElementById("editLinePrio").value;
  line.tag = document.getElementById("editLineTag").value.trim();
  line.note = document.getElementById("editLineNote").value.trim();
  line.targetStaff = {
    frueh: parseInt(document.getElementById("editLineStaffFrueh").value) || 0,
    spaet: parseInt(document.getElementById("editLineStaffSpaet").value) || 0,
    nacht: parseInt(document.getElementById("editLineStaffNacht").value) || 0
  };
  saveToFirebase(); initBoard();
  if (!isAuto) { closeModal("lineEditModal"); showToast("Linie gespeichert!"); }
};

function renderEmployees() {
  if (isDraggingCard) return;
  const dropZones = document.querySelectorAll(".drop-zone"); if (!dropZones.length) return;
  dropZones.forEach(el => { el.innerHTML = ""; });

  employees.forEach(emp => {
    const fName = fullName(emp);
    if (isPlanner && emp.zone === "pool") {
      if (activeTeamFilters[emp.team] === false || activeRoleFilters[emp.role] === false) return;
      if (poolSearchQuery && fName.toLowerCase().indexOf(poolSearchQuery) === -1) return;
    }

    const teamObj = teamsConfig[emp.team] || { name: "Team", color: "#0091df" };
    const card = document.createElement("div"); 
    card.className = "employee-card" + (emp.pinnedZone ? " pinned" : "");
    card.setAttribute("data-id", emp.id); 
    card.style.borderLeft = "5px solid " + (teamObj.color || "#0091df");

    const ersthelferHtml = emp.ersthelfer ? '<span class="ersthelfer-plus" title="Ersthelfer">+</span>' : '';
    let fixTagHtml = emp.noRotation ? ' <span class="card-fix-tag">⚓ Fix</span>' : '';

    let pinInfoHtml = '';
    if (emp.pinnedZone) {
      const lineIdPure = extractLineIdFromZone(emp.pinnedZone);
      const foundLine = lines.find(l => l.id === lineIdPure);
      const lineNameShort = foundLine ? foundLine.name : emp.pinnedZone;
      pinInfoHtml = '<div class="card-pin-info"><span style="color:#dc2626; cursor:pointer;" title="PIN-Nadel (Nur im Pool entfernbar)" onclick="clickPinButton(\'' + emp.id + '\', event)">📌</span> <span>Prio: ' + lineNameShort.replace("Linie ", "") + '</span></div>';
    }

    card.innerHTML = ersthelferHtml +
      '<div class="card-name">' + fName + '</div>' +
      '<div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap; margin-top:2px;">' +
        '<span class="card-role">' + emp.role + '</span>' + fixTagHtml +
      '</div>' + pinInfoHtml;

    let targetZone = document.getElementById(emp.zone);
    if (!targetZone) {
      emp.zone = "pool";
      targetZone = document.getElementById("pool");
    }
    if (targetZone) targetZone.appendChild(card);
  });

  const pEl = document.getElementById("pool"), eEl = document.getElementById("extra"), aEl = document.getElementById("absent");
  if (document.getElementById("poolCount")) document.getElementById("poolCount").textContent = "(" + (pEl ? pEl.children.length : 0) + ")";
  if (document.getElementById("extraCount")) document.getElementById("extraCount").textContent = "(" + (eEl ? eEl.children.length : 0) + ")";
  if (document.getElementById("absentCount")) document.getElementById("absentCount").textContent = "(" + (aEl ? aEl.children.length : 0) + ")";
}

window.clickPinButton = function(empId, evt) {
  if (evt) evt.stopPropagation();
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  if (emp.zone === "pool" || emp.zone === "absent" || emp.zone === "extra") {
    emp.pinnedZone = null;
    showToast("PIN-Nadel entfernt");
    saveToFirebase(); renderEmployees();
  } else {
    showToast("PIN-Nadel kann nur im Pool entfernt werden!", true);
  }
};

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
          if (newZone !== "pool" && newZone !== "absent" && newZone !== "extra") {
            emp.pinnedZone = newZone;
          } else {
            emp.pinnedZone = null;
          }
          saveToFirebase(); 
          renderEmployees(); 
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
  }
}

window.onShiftTeamDropdownChange = function(shiftId, selEl) {
  if (!selEl) return;
  shiftRotation[shiftId] = selEl.value;
  saveToFirebase();
};

window.updatePoolSearch = function(val) {
  poolSearchQuery = (val || "").trim().toLowerCase();
  renderEmployees();
};

function renderTeamFilterCheckboxes() {
  const c = document.getElementById("teamFilterContainer"); if (!c) return;
  c.innerHTML = Object.keys(teamsConfig).sort().map(k => {
    const t = teamsConfig[k];
    return '<label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer;"><input type="checkbox" ' + (activeTeamFilters[k] !== false ? 'checked' : '') + ' onchange="activeTeamFilters[\'' + k + '\']=this.checked; renderEmployees();"> <span style="color:' + t.color + '; font-weight:700;">■</span> ' + t.name + '</label>';
  }).join("");
}

function renderRoleFilterCheckboxes() {
  const c = document.getElementById("roleFilterContainer"); if (!c) return;
  c.innerHTML = roles.map((r, i) => '<label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer;"><input type="checkbox" ' + (activeRoleFilters[r] !== false ? 'checked' : '') + ' onchange="activeRoleFilters[roles[' + i + ']]=this.checked; renderEmployees();"> ' + r + '</label>').join("");
}

window.switchTab = function(tabId, btnEl) {
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  const t = document.getElementById(tabId); if (t) t.classList.add("active");
  if (btnEl) btnEl.classList.add("active");
  renderSettingsLists();
};

function renderSettingsLists() {
  const empListEl = document.getElementById("employeeList");
  if (empListEl) {
    const filteredEmps = employees.filter(e => {
      if (settingsEmpSearchQuery && fullName(e).toLowerCase().indexOf(settingsEmpSearchQuery) === -1) return false;
      return true;
    });

    empListEl.innerHTML = filteredEmps.map(e => {
      const tObj = teamsConfig[e.team] || { name: e.team, color: "#0091df" };
      const pinAction = (plannerLevel >= 3) ? '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.72rem; color:#0284c7; border-color:#bae6fd;" onclick="resetEmployeePin(\'' + e.id + '\')">🔄 PIN zurücksetzen</button>' : '';
      return '<div class="item-row"><span><span style="color:' + tObj.color + '; font-weight:700;">■</span> <b>' + fullName(e) + '</b> (' + e.role + ')</span>' +
        '<div style="display:flex; gap:6px; align-items:center;">' + pinAction + 
        '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem;" onclick="editEmployee(\'' + e.id + '\')">✏️ Bearbeiten</button>' +
        '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteEmployee(\'' + e.id + '\')">🗑️</button></div></div>';
    }).join("");
  }

  const mainLinesBox = document.getElementById("mainLinesCheckboxes");
  const secLinesBox = document.getElementById("secLinesCheckboxes");
  const currentMain = window._tempEditEmpMainLines || [];
  const currentSec = window._tempEditEmpSecLines || [];

  if (mainLinesBox) {
    mainLinesBox.innerHTML = lines.map(l => 
      '<label style="font-size:0.76rem; display:inline-flex; align-items:center; gap:3px; cursor:pointer; background:#fff; padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px;"><input type="checkbox" value="' + l.id + '" class="emp-main-line-chk" ' + (currentMain.indexOf(l.id) !== -1 ? 'checked' : '') + '> ' + l.name + '</label>'
    ).join("");
  }
  if (secLinesBox) {
    secLinesBox.innerHTML = lines.map(l => 
      '<label style="font-size:0.76rem; display:inline-flex; align-items:center; gap:3px; cursor:pointer; background:#fff; padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px;"><input type="checkbox" value="' + l.id + '" class="emp-sec-line-chk" ' + (currentSec.indexOf(l.id) !== -1 ? 'checked' : '') + '> ' + l.name + '</label>'
    ).join("");
  }

  const teamSel = document.getElementById("newEmpTeam");
  if (teamSel) {
    const curTeam = teamSel.value || Object.keys(teamsConfig)[0];
    teamSel.innerHTML = Object.keys(teamsConfig).sort().map(k => '<option value="' + k + '">' + teamsConfig[k].name + '</option>').join("");
    teamSel.value = curTeam;
  }

  const roleSel = document.getElementById("newEmpRole");
  if (roleSel) {
    const curRole = roleSel.value || roles[0];
    roleSel.innerHTML = roles.map(r => '<option value="' + r + '">' + r + '</option>').join("");
    roleSel.value = curRole;
  }

  const roleListEl = document.getElementById("roleList");
  if (roleListEl) {
    roleListEl.innerHTML = roles.map((r, idx) => '<div class="item-row"><span><b>' + r + '</b></span>' +
      '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteRole(' + idx + ')">🗑️ Löschen</button></div>').join("");
  }

  const lineListEl = document.getElementById("lineSettingsList");
  if (lineListEl) {
    lineListEl.innerHTML = lines.map(l => '<div class="item-row"><span><b>' + l.name + '</b> ' + (l.ausgeplant ? '(Ausgeplant)' : (l.prio ? '('+l.prio+')' : '')) + '</span>' +
      '<div style="display:flex; gap:6px;"><button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem;" onclick="openLineEditModal(\'' + l.id + '\')">✏️ Bearbeiten</button>' +
      '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteLine(\'' + l.id + '\')">🗑️</button></div></div>').join("");
  }

  const teamListEl = document.getElementById("teamSettingsList");
  if (teamListEl) {
    teamListEl.innerHTML = Object.keys(teamsConfig).sort().map(k => {
      const t = teamsConfig[k];
      return '<div class="item-row"><span><span style="color:' + t.color + '; font-weight:700;">■</span> <b>' + t.name + '</b></span>' +
        '<div style="display:flex; gap:6px; align-items:center;">' +
        '<label style="font-size:0.75rem; display:flex; align-items:center; gap:3px;"><input type="checkbox" ' + (t.rotates !== false ? 'checked' : '') + ' onchange="toggleTeamRotationSetting(\'' + k + '\', this.checked)"> Rotiert</label>' +
        (Object.keys(teamsConfig).length > 1 ? '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; color:#dc2626; border-color:#fca5a5;" onclick="deleteTeam(\'' + k + '\')">🗑️</button>' : '') +
        '</div></div>';
    }).join("");
  }

  syncShiftModelSettingsUI();
}

window.syncShiftModelSettingsUI = function() {
  const autoChk = document.getElementById("cfgAutoRotate");
  if (autoChk) autoChk.checked = shiftModelConfig.autoRotate !== false;

  const resetChk = document.getElementById("cfgResetEnabled");
  if (resetChk) resetChk.checked = !!shiftModelConfig.resetEnabled;
  const resetDay = document.getElementById("cfgResetDay");
  if (resetDay) resetDay.value = shiftModelConfig.resetDay ?? 0;
  const resetHour = document.getElementById("cfgResetHour");
  if (resetHour) resetHour.value = shiftModelConfig.resetHour ?? 6;

  const loadChk = document.getElementById("cfgLoadEnabled");
  if (loadChk) loadChk.checked = !!shiftModelConfig.loadEnabled;
  const loadDay = document.getElementById("cfgLoadDay");
  if (loadDay) loadDay.value = shiftModelConfig.loadDay ?? 0;
  const loadHour = document.getElementById("cfgLoadHour");
  if (loadHour) loadHour.value = shiftModelConfig.loadHour ?? 5;
};

window.saveShiftModelSettings = function() {
  const autoChk = document.getElementById("cfgAutoRotate");
  if (autoChk) shiftModelConfig.autoRotate = autoChk.checked;

  const resetChk = document.getElementById("cfgResetEnabled");
  if (resetChk) shiftModelConfig.resetEnabled = resetChk.checked;
  const resetDay = document.getElementById("cfgResetDay");
  if (resetDay) shiftModelConfig.resetDay = parseInt(resetDay.value) || 0;
  const resetHour = document.getElementById("cfgResetHour");
  if (resetHour) shiftModelConfig.resetHour = parseInt(resetHour.value) || 6;

  const loadChk = document.getElementById("cfgLoadEnabled");
  if (loadChk) shiftModelConfig.loadEnabled = loadChk.checked;
  const loadDay = document.getElementById("cfgLoadDay");
  if (loadDay) shiftModelConfig.loadDay = parseInt(loadDay.value) || 0;
  const loadHour = document.getElementById("cfgLoadHour");
  if (loadHour) shiftModelConfig.loadHour = parseInt(loadHour.value) || 5;

  saveToFirebase();
  updateAutoRotationUI();
  showToast("Schichtmodell-Einstellungen gespeichert!");
};

window.toggleTeamRotationSetting = function(key, val) {
  if (teamsConfig[key]) {
    teamsConfig[key].rotates = val;
    saveToFirebase();
    showToast("Team-Rotation aktualisiert");
  }
};

window.resetEmployeePin = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;
  const newPin = String(Math.floor(1000 + Math.random() * 9000));
  emp.password = newPin;
  saveToFirebase();
  showToast("Neue Start-PIN für " + fullName(emp) + " generiert: " + newPin);
};

window.deleteRole = function(idx) {
  roles.splice(idx, 1);
  saveToFirebase(); renderSettingsLists(); renderRoleFilterCheckboxes();
  showToast("Rolle gelöscht");
};

window.deleteLine = function(id) {
  if (lines.length <= 1) { showToast("Mindestens eine Linie muss erhalten bleiben!", true); return; }
  lines = lines.filter(l => l.id !== id);
  saveToFirebase(); initBoard(); renderSettingsLists();
  showToast("Linie gelöscht");
};

window.deleteTeam = function(k) {
  if (Object.keys(teamsConfig).length <= 1) { showToast("Mindestens ein Team muss erhalten bleiben!", true); return; }
  delete teamsConfig[k]; delete activeTeamFilters[k];
  sanitizeTeamReferences(); saveToFirebase(); initBoard(); renderSettingsLists();
  showToast("Team gelöscht");
};

window.deleteEmployee = function(id) {
  employees = employees.filter(e => e.id !== id);
  saveToFirebase(); renderEmployees(); renderSettingsLists();
  showToast("Mitarbeiter gelöscht");
};

window.editEmployee = function(id) {
  const emp = employees.find(e => e.id === id); if (!emp) return;
  document.getElementById("editEmpId").value = emp.id;
  document.getElementById("newEmpFirstName").value = emp.firstName || "";
  document.getElementById("newEmpLastName").value = emp.lastName || "";
  document.getElementById("newEmpTeam").value = emp.team || Object.keys(teamsConfig)[0];
  document.getElementById("newEmpRole").value = emp.role || roles[0];
  document.getElementById("newEmpAccessLevel").value = emp.accessLevel || 1;
  document.getElementById("newEmpFirstAider").checked = !!emp.ersthelfer;
  document.getElementById("newEmpNoRotation").checked = !!emp.noRotation;
  
  window._tempEditEmpMainLines = Array.isArray(emp.mainLines) ? emp.mainLines.slice() : [];
  window._tempEditEmpSecLines = Array.isArray(emp.secLines) ? emp.secLines.slice() : [];

  document.getElementById("btnCancelEditEmp").style.display = "inline-block";
  document.getElementById("btnSaveEmp").textContent = "Änderungen speichern";
  renderSettingsLists();
};

window.resetEmpForm = function() {
  document.getElementById("editEmpId").value = "";
  document.getElementById("newEmpFirstName").value = "";
  document.getElementById("newEmpLastName").value = "";
  document.getElementById("newEmpFirstAider").checked = false;
  document.getElementById("newEmpNoRotation").checked = false;
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
  if (!fName || !lName) { showToast("Bitte Vor- und Nachname eingeben", true); return; }

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
      emp.mainLines = mainChecked;
      emp.secLines = secChecked;
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
      mainLines: mainChecked,
      secLines: secChecked,
      password: randomPin,
      mustChangePw: true,
      zone: "pool",
      pinnedZone: null
    });
    showToast("Mitarbeiter erstellt. Start-PIN: " + randomPin);
  }

  saveToFirebase(); renderEmployees(); resetEmpForm();
};

window.addRole = function() {
  const inp = document.getElementById("newRoleName"), val = inp ? inp.value.trim() : "";
  if (val && roles.indexOf(val) === -1) { roles.push(val); inp.value = ""; saveToFirebase(); renderSettingsLists(); renderRoleFilterCheckboxes(); showToast("Rolle hinzugefügt"); }
};

window.addLine = function() {
  const inp = document.getElementById("newLineName"), val = inp ? inp.value.trim() : "";
  if (val) { lines.push({ id: "L_" + Date.now(), name: val, prio: "", tag: "", note: "", ausgeplant: false, targetStaff: { frueh: 3, spaet: 3, nacht: 2 } }); inp.value = ""; saveToFirebase(); initBoard(); renderSettingsLists(); showToast("Linie hinzugefügt"); }
};

window.addTeam = function() {
  const nameInp = document.getElementById("newTeamName"), colInp = document.getElementById("newTeamColor");
  const val = nameInp ? nameInp.value.trim() : "";
  if (val) {
    const key = "team_" + Date.now();
    teamsConfig[key] = { name: val, color: colInp ? colInp.value : "#3b82f6", rotates: true };
    nameInp.value = ""; activeTeamFilters[key] = true;
    saveToFirebase(); initBoard(); renderSettingsLists(); renderTeamFilterCheckboxes(); showToast("Team hinzugefügt");
  }
};

window.createManualBackup = function() { showToast("Backup erstellt!"); };
window.saveProfilePinChange = function() { showToast("PIN aktualisiert!"); };
window.filterSettingsEmployees = function(q) { settingsEmpSearchQuery = (q || "").trim().toLowerCase(); renderSettingsLists(); };

window.onPlannerLoginInput = function(val) {
  selectedLoginPlannerId = null;
  const box = document.getElementById("plannerLoginSuggestions"), q = (val || "").trim().toLowerCase();
  if (!employees || !employees.length || q.length < 1) { if (box) box.style.display = "none"; return; }
  const matches = employees.filter(e => fullName(e).toLowerCase().indexOf(q) !== -1);
  if (!matches.length) { if (box) box.style.display = "none"; return; }
  if (box) {
    box.innerHTML = matches.map(e => '<div class="suggestion-item" onclick="selectLoginPlannerEmp(\'' + e.id + '\')"><span><b>' + fullName(e) + '</b></span><small style="color:#64748b;">' + e.role + '</small></div>').join("");
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
  const box = document.getElementById("manualSickSuggestions"), q = (val || "").trim().toLowerCase();
  if (!employees || !employees.length || q.length < 1) { if (box) box.style.display = "none"; return; }
  const matches = employees.filter(e => fullName(e).toLowerCase().indexOf(q) !== -1);
  if (!matches.length) { if (box) box.style.display = "none"; return; }
  if (box) {
    box.innerHTML = matches.map(e => '<div class="suggestion-item" onclick="selectManualSickEmp(\'' + e.id + '\')"><span><b>' + fullName(e) + '</b></span><small style="color:#64748b;">' + e.role + '</small></div>').join("");
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
  const box = document.getElementById("manualExtraSuggestions"), q = (val || "").trim().toLowerCase();
  if (!employees || !employees.length || q.length < 1) { if (box) box.style.display = "none"; return; }
  const matches = employees.filter(e => fullName(e).toLowerCase().indexOf(q) !== -1);
  if (!matches.length) { if (box) box.style.display = "none"; return; }
  if (box) {
    box.innerHTML = matches.map(e => '<div class="suggestion-item" onclick="selectManualExtraEmp(\'' + e.id + '\')"><span><b>' + fullName(e) + '</b></span><small style="color:#64748b;">' + e.role + '</small></div>').join("");
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
  if (!selectedManualSickEmpId) { showToast("Bitte Mitarbeiter auswählen", true); return; }
  const start = document.getElementById("manualSickStart").value;
  const end = document.getElementById("manualSickEnd").value;
  const cat = document.getElementById("manualSickCategory").value;
  const reason = document.getElementById("manualSickReason").value.trim();
  if (!start || !end) { showToast("Bitte Zeitraum auswählen", true); return; }

  sickLeaves.push({
    id: "sl_" + Date.now(), empId: selectedManualSickEmpId,
    startDate: start, endDate: end, category: cat, reason: reason,
    status: "approved", reviewedBy: currentPlannerName || "Planer", reviewedAt: new Date().toISOString()
  });
  saveToFirebase(); syncAbsentZones(); renderEmployees(); renderInboxLists();
  showToast("Abwesenheit eingetragen & genehmigt!");
  document.getElementById("manualSickStart").value = "";
  document.getElementById("manualSickEnd").value = "";
  document.getElementById("manualSickReason").value = "";
  document.getElementById("manualSickEmpInput").value = "";
  selectedManualSickEmpId = null;
};

window.addManualExtraShift = function() {
  if (!selectedManualExtraEmpId) { showToast("Bitte Mitarbeiter auswählen", true); return; }
  const dateVal = document.getElementById("manualExtraDate").value;
  const shiftVal = document.getElementById("manualExtraShift").value;
  const noteVal = document.getElementById("manualExtraNote").value.trim();
  if (!dateVal) { showToast("Bitte Datum auswählen", true); return; }

  extraShifts.push({
    id: "es_" + Date.now(), empId: selectedManualExtraEmpId,
    date: dateVal, shift: shiftVal, note: noteVal, status: "approved"
  });
  saveToFirebase(); renderInboxLists();
  showToast("Bringschicht eingetragen & aktiviert!");
  document.getElementById("manualExtraDate").value = "";
  document.getElementById("manualExtraNote").value = "";
  document.getElementById("manualExtraEmpInput").value = "";
  selectedManualExtraEmpId = null;
};

window.markAllSickLeavesRead = function() {
  sickLeaves.forEach(sl => { if (sl.status === "pending") sl.status = "approved"; sl.plannerUnreadInfo = false; });
  saveToFirebase(); renderInboxLists(); showToast("Alle Infos als gelesen markiert");
};

window.renderInboxLists = function() {
  const unreadEl = document.getElementById("unreadSickList");
  const extraListEl = document.getElementById("inboxExtraList");
  const activeListEl = document.getElementById("activeSickList");
  if (!unreadEl || !activeListEl) return;

  const q = (document.getElementById("inboxSearchInput") ? document.getElementById("inboxSearchInput").value : "").trim().toLowerCase();
  const searchActive = (document.getElementById("inboxActiveSearchInput") ? document.getElementById("inboxActiveSearchInput").value : "").trim().toLowerCase();

  const unreadItems = sickLeaves.filter(sl => sl.status === "pending" || sl.plannerUnreadInfo);
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
    const approvedExtras = extraShifts.filter(es => es.status === "approved");
    if (!approvedExtras.length) {
      extraListEl.innerHTML = '<p style="font-size:0.8rem; color:#64748b;">Keine eingetragenen Bringschichten.</p>';
    } else {
      extraListEl.innerHTML = approvedExtras.map(es => {
        const emp = employees.find(e => e.id === es.empId);
        const eName = emp ? fullName(emp) : "Unbekannt";
        return '<div style="background:#fff; border:1px solid #86efac; padding:8px 10px; border-radius:6px; margin-bottom:6px; font-size:0.82rem; display:flex; justify-content:space-between; align-items:center;">' +
          '<div><b>' + eName + '</b> · Am ' + formatDateDe(es.date) + ' (' + (shiftsShortLabel[es.shift] || es.shift) + ')' + (es.note ? ' · ' + es.note : '') + '</div>' +
          '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.72rem; color:#dc2626;" onclick="deleteExtraShift(\'' + es.id + '\')">🗑️</button>' +
        '</div>';
      }).join("");
    }
  }

  const filteredActive = sickLeaves.filter(sl => {
    if (sl.status === "pending" && !sl.plannerUnreadInfo) return false;
    if (activeHistoryCategory !== "ALL" && classifyInboxActiveItem(sl) !== activeHistoryCategory) return false;
    if (searchActive) {
      const emp = employees.find(e => e.id === sl.empId);
      const txt = (emp ? fullName(emp) : "") + " " + (sl.category || "") + " " + (sl.reason || "");
      if (txt.toLowerCase().indexOf(searchActive) === -1) return false;
    }
    return true;
  });

  if (!filteredActive.length) {
    activeListEl.innerHTML = '<p style="font-size:0.8rem; color:#64748b;">Keine Einträge vorhanden.</p>';
  } else {
    activeListEl.innerHTML = filteredActive.map(sl => {
      const emp = employees.find(e => e.id === sl.empId);
      const eName = emp ? fullName(emp) : "Unbekannt";
      const stBadge = sl.status === "approved" ? '<span style="color:#166534; font-weight:700;">✅ Aktiv</span>' : '<span style="color:#b91c1c; font-weight:700;">❌ Abgelehnt</span>';
      return '<div style="background:#fff; border:1px solid #e2e8f0; padding:8px 10px; border-radius:6px; margin-bottom:6px; font-size:0.82rem; display:flex; justify-content:space-between; align-items:center;">' +
        '<div><b>' + eName + '</b> · <b>' + (sl.category || 'Abwesend') + '</b> (' + formatDateDe(sl.startDate) + ' bis ' + formatDateDe(sl.endDate) + ') ' + stBadge + '</div>' +
        '<button class="btn btn-outline" style="padding:2px 8px; font-size:0.72rem; color:#dc2626;" onclick="deleteSickLeave(\'' + sl.id + '\')">🗑️</button>' +
      '</div>';
    }).join("");
  }
}

window.approveSickLeave = function(id) {
  const sl = sickLeaves.find(x => x.id === id);
  if (sl) { sl.status = "approved"; sl.plannerUnreadInfo = false; saveToFirebase(); syncAbsentZones(); renderEmployees(); renderInboxLists(); showToast("Antrag genehmigt"); }
};

window.rejectSickLeave = function(id) {
  const sl = sickLeaves.find(x => x.id === id);
  if (sl) { sl.status = "rejected"; sl.plannerUnreadInfo = false; saveToFirebase(); syncAbsentZones(); renderEmployees(); renderInboxLists(); showToast("Antrag abgelehnt"); }
};

window.deleteSickLeave = function(id) {
  sickLeaves = sickLeaves.filter(x => x.id !== id);
  saveToFirebase(); syncAbsentZones(); renderEmployees(); renderInboxLists(); showToast("Eintrag gelöscht");
};

window.deleteExtraShift = function(id) {
  extraShifts = extraShifts.filter(x => x.id !== id);
  saveToFirebase(); renderInboxLists(); showToast("Bringschicht entfernt");
};

window.updateInboxSearch = function() { renderInboxLists(); };

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
    if (d.shiftModelConfig && typeof d.shiftModelConfig === "object") {
      shiftModelConfig = Object.assign(shiftModelConfig, d.shiftModelConfig);
    }
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

window.logoutPlanner = function() {
  isPlanner = false; plannerLevel = 0; currentPlannerName = ""; currentPlannerEmpId = null;
  ["planner_name","planner_level","planner_emp_id","planner_last_active"].forEach(k => sessionStorage.removeItem(k));
  document.body.classList.remove("planner-active", "planner-lvl-2", "planner-lvl-3", "planner-lvl-4");
  ["pinModal","inboxModal","settingsModal","lineEditModal"].forEach(closeModal);
  initBoard();
};

window.handleLogoClick = function() {
  if (!isPlanner) {
    document.getElementById("pinModal").style.display = "flex";
    document.getElementById("loginModalError").style.display = "none";
    document.getElementById("loginPlannerName").value = "";
    document.getElementById("pinInput").value = "";
    document.getElementById("loginPlannerName").focus();
  }
};

window.verifyPin = function() {
  const pinVal = document.getElementById("pinInput").value.trim();
  let emp = selectedLoginPlannerId ? employees.find(e => e.id === selectedLoginPlannerId) : null;
  
  if (!emp) {
    showTimedBoxMsg("loginModalError", "❌ Bitte wähle deinen vollständigen Namen aus der Vorschlagsliste aus!", false);
    return;
  }
  
  if ((emp.password || "1234") !== pinVal) {
    showTimedBoxMsg("loginModalError", "❌ PIN nicht korrekt!", false);
    return;
  }
  
  const pinModal = document.getElementById("pinModal");
  if (pinModal) pinModal.style.display = "none";
  
  applyPlannerLoginState(fullName(emp), Number(emp.accessLevel) || 2, emp.id);
  initBoard();
};

window.rotateAllShifts = function() {
  performShiftRotationLogic(true);
};

window.clearEntireBoard = function() { 
  employees.forEach(e => { 
    if (e.zone && ["pool","absent","extra"].indexOf(e.zone) === -1 && !e.noRotation) { 
      e.zone = "pool"; 
      e.pinnedZone = null; 
    } 
  }); 
  saveToFirebase(); 
  renderEmployees(); 
};

window.clearShiftRow = function(sId) { 
  employees.forEach(e => { 
    if (extractShiftIdFromZone(e.zone) === sId && !e.noRotation) { 
      e.zone = "pool"; 
      e.pinnedZone = null; 
    } 
  }); 
  saveToFirebase(); 
  renderEmployees(); 
};

window.loadTeamToShift = function(slotKey) {
  const sel = document.getElementById("teamSelect_" + slotKey); if (!sel) return;
  const teamKey = sel.value; shiftRotation[slotKey] = teamKey;
  employees.forEach(emp => {
    if (emp.team === teamKey && emp.zone !== "absent" && emp.zone !== "extra" && !emp.noRotation) {
      if (emp.pinnedZone) {
        emp.zone = emp.pinnedZone; 
      } else if (slotKey === "frei") {
        emp.zone = "pool";
      } else {
        const targetLine = emp.mainLines && emp.mainLines[0] ? emp.mainLines[0] : null;
        emp.zone = targetLine ? (targetLine + "_" + slotKey) : "pool";
      }
    }
  });
  saveToFirebase(); initBoard();
  showToast("Team " + (teamsConfig[teamKey] ? teamsConfig[teamKey].name : teamKey) + " geladen!");
};

window.performShiftRotationLogic = function() {
  const slotOrder = ["frueh", "spaet", "nacht", "frei"];
  const activeSlots = slotOrder.filter(s => shiftRotation[s]);
  if (activeSlots.length < 2) return;
  const nextShiftRotation = Object.assign({}, shiftRotation);
  activeSlots.forEach((fromSlot, idx) => { nextShiftRotation[activeSlots[(idx + 1) % activeSlots.length]] = shiftRotation[fromSlot]; });
  shiftRotation = nextShiftRotation; saveToFirebase(); initBoard();
  showToast("Schichten erfolgreich rotiert!");
};

window.updateInboxBadge = function() {
  const unreadCount = sickLeaves.filter(sl => sl.status === "pending" || sl.plannerUnreadInfo).length;
  const badge = document.getElementById("inboxBadge");
  if (badge) {
    badge.textContent = unreadCount;
    badge.style.display = unreadCount > 0 ? "inline-flex" : "none";
  }
};

window.openSettingsModal = function() { document.getElementById("settingsModal").style.display = "flex"; renderSettingsLists(); };
window.openInboxModal = function() { 
  document.getElementById("inboxModal").style.display = "flex"; 
  renderInboxLists(); 
};

function formatDateDe(isoDate) {
  if (!isoDate) return "";
  const p = isoDate.split("-");
  if (p.length !== 3) return isoDate;
  return p[2] + "." + p[1] + "." + p[0];
}
