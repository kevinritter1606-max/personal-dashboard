/* ==========================================================================
   PLANER-BOARD LOGIK (planer.js) - Vollständige finale Korrektur
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
  return ["frueh", "spaet", "nacht"].find(s => rot[s] === emp.team) || null;
};

function syncAbsentZones() {
  if (!hasLoadedFromCloud) return false;
  const now = new Date(), calToday = getTodayIso(now);
  let changed = false;
  employees.forEach(emp => {
    const activeLeave = getActiveLeaveForEmpOnDate(emp.id, calToday);
    if (activeLeave && emp.zone !== "absent") { emp.zone = "absent"; changed = true; }
    else if (!activeLeave && emp.zone === "absent") { emp.zone = "pool"; changed = true; }
  });
  return changed;
}

function getActiveLeaveForEmpOnDate(empId, isoDate) {
  return sickLeaves.find(sl => {
    if (sl.empId !== empId || sl.status === "rejected" || sl.status === "pending") return false;
    if (sl.blocks && sl.blocks.length) return sl.blocks.some(b => b.status === "approved" && b.start <= isoDate && b.end >= isoDate);
    return sl.status === "approved" && sl.startDate <= isoDate && sl.endDate >= isoDate;
  });
}

function sanitizeTeamReferences() {
  const validKeys = Object.keys(teamsConfig);
  if (!validKeys.length) { teamsConfig["team-1"] = { name: "Team 1", color: "#0091df", rotates: true }; validKeys.push("team-1"); }
  const fallbackKey = validKeys[0];
  ["frueh", "spaet", "nacht", "frei"].forEach(slot => { if (!shiftRotation[slot] || !teamsConfig[shiftRotation[slot]]) shiftRotation[slot] = fallbackKey; });
  employees.forEach(emp => { if (!emp.team || !teamsConfig[emp.team]) emp.team = fallbackKey; });
  Object.keys(activeTeamFilters).forEach(k => { if (!teamsConfig[k]) delete activeTeamFilters[k]; });
}

function fullName(e) { return ((e.firstName || "") + " " + (e.lastName || "")).trim(); }
function isTeamRotating(teamKey) { return teamsConfig[teamKey] ? (teamsConfig[teamKey].rotates !== false) : true; }

function updateHeaderDateKw() {
  const el = document.getElementById("headerDateKw"); if (!el) return;
  const now = new Date(), ld = getLogicalDateObj(now);
  el.textContent = now.toLocaleDateString("de-DE", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }) + " · KW " + getCalendarWeek(ld);
}

// Ergänzte Funktion, die den Fehler behoben hat:
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

function updateAutoRotationUI() {
  const isAuto = shiftModelConfig.autoRotate !== false;
  const badge = document.getElementById("autoRotationBadge"), badgeIcon = document.getElementById("autoRotationIcon"), badgeText = document.getElementById("autoRotationText");
  if (badge && badgeIcon && badgeText) {
    badge.className = isAuto ? "auto-rotation-badge active" : "auto-rotation-badge";
    badgeText.textContent = isAuto ? "Auto aktiv" : "Manuell";
  }
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

function initBoard() {
  if (isDraggingCard) return;
  sanitizeTeamReferences(); syncAbsentZones();
  updateHeaderDateKw(); updateShiftApprovalUI(); updateAutoRotationUI();

  const headerRow = document.getElementById("headerRow"); if (!headerRow) return;
  if (!Array.isArray(lines) || !lines.length) lines = defaultLines.slice();

  headerRow.innerHTML = '<th class="shift-header"><div>Schicht</div><div class="shift-controls"><button class="shift-rotate-btn" onclick="rotateAllShifts()"><span>Rotieren</span></button><button class="shift-clear-btn" onclick="clearEntireBoard()">🧹 Alle leeren</button></div></th>';
  
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
    const opts = keys.map(k => '<option value="' + k + '" style="color:' + teamsConfig[k].color + '; font-weight:700;" ' + (k === curKey ? 'selected' : '') + '>■ ' + teamsConfig[k].name + '</option>').join("");
    const isShiftSundayOff = sundayFree;
    const sunBadge = isShiftSundayOff ? '<div style="font-size:0.64rem; color:#0284c7; background:#e0f2fe; padding:2px 4px; border-radius:4px; margin-top:3px;">So. Frei</div>' : '';
    const tr = document.createElement("tr"), thS = document.createElement("th");
    thS.className = "shift-header";
    thS.innerHTML = '<div>' + shift.name + '</div>' + sunBadge + '<div class="shift-team-badge" style="border-left:4px solid ' + curObj.color + ';"><span style="color:' + curObj.color + ';">■</span> ' + curObj.name + '</div><div class="shift-controls"><div style="display:flex; gap:4px;"><select id="teamSelect_' + shift.id + '" class="shift-team-select" style="flex:1; border-left:6px solid ' + curObj.color + '; color:' + curObj.color + ';" onchange="onShiftTeamDropdownChange(\'' + shift.id + '\', this)">' + opts + '</select></div><button class="shift-clear-btn" onclick="clearShiftRow(\'' + shift.id + '\')">🧹 Leeren</button></div>';
    tr.appendChild(thS);
    
    lines.forEach(line => {
      const td = document.createElement("td"), zId = line.id + "_" + shift.id;
      td.innerHTML = '<div id="' + zId + '" class="card-list drop-zone" data-zone="' + zId + '"' + (isShiftSundayOff ? ' style="background:#f1f5f9; opacity:0.8;"' : '') + '></div>';
      tr.appendChild(td);
    });
    matrixBody.appendChild(tr);
  });

  applyTeamStyles(); updateTeamDropdowns();
  renderTeamFilterCheckboxes(); renderRoleFilterCheckboxes();
  renderEmployees(); initDragAndDrop(); renderSettingsLists(); updateInboxBadge(); checkBoardLockState();
}

window.onShiftTeamDropdownChange = function(shiftId, selEl) {
  shiftRotation[shiftId] = selEl.value; saveToFirebase();
};

function renderEmployees() {
  if (isDraggingCard) return;
  const dropZones = document.querySelectorAll(".drop-zone"); if (!dropZones.length) return;
  dropZones.forEach(el => { el.innerHTML = ""; });
  const today = getTodayIso();

  employees.forEach(emp => {
    const fName = fullName(emp);
    const teamObj = teamsConfig[emp.team] || { name: "Team", color: "#0091df" };
    const card = document.createElement("div"); card.className = "employee-card";
    card.setAttribute("data-id", emp.id); card.style.borderLeft = "5px solid " + (teamObj.color || "#0091df");

    card.innerHTML =
      '<div class="card-name">' + fName + '</div>' +
      '<div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">' +
        '<div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap;"><span class="card-role">' + emp.role + '</span></div>' +
      '</div>';

    const targetZone = document.getElementById(emp.zone) || document.getElementById("pool");
    if (targetZone) targetZone.appendChild(card);
  });

  const pEl = document.getElementById("pool"), eEl = document.getElementById("extra"), aEl = document.getElementById("absent");
  if (document.getElementById("poolCount")) document.getElementById("poolCount").textContent = "(" + (pEl ? pEl.children.length : 0) + ")";
  if (document.getElementById("extraCount")) document.getElementById("extraCount").textContent = "(" + (eEl ? eEl.children.length : 0) + ")";
  if (document.getElementById("absentCount")) document.getElementById("absentCount").textContent = "(" + (aEl ? aEl.children.length : 0) + ")";
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
        if (emp) { emp.zone = newZone; saveToFirebase(); renderEmployees(); }
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

function renderSettingsLists() {}

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
    if (d.shiftRotation && typeof d.shiftRotation === "object") shiftRotation = d.shiftRotation;
    if (d.teamsConfig && typeof d.teamsConfig === "object") teamsConfig = d.teamsConfig;
    if (d.securityConfig && typeof d.securityConfig === "object") securityConfig = Object.assign(securityConfig, d.securityConfig);
    if (typeof d.approvedShiftKey === "string") approvedShiftKey = d.approvedShiftKey;
    if (Array.isArray(d.employees)) employees = d.employees;

    sanitizeTeamReferences(); initBoard();
  } catch (err) { console.error("Fehler:", err); }
}

boardRef.onSnapshot(doc => {
  if (doc.exists && !isDraggingCard) applyIncomingDocData(doc.data());
});

window.addEventListener("DOMContentLoaded", function() {
  Object.keys(teamsConfig).forEach(k => { activeTeamFilters[k] = true; });
  roles.forEach(r => { activeRoleFilters[r] = true; });
  updateHeaderDateKw(); updateShiftApprovalUI(); updateAutoRotationUI();

  const savedName = sessionStorage.getItem("planner_name"), savedLvl = Number(sessionStorage.getItem("planner_level") || 0);
  if (savedName && savedLvl >= 2) applyPlannerLoginState(savedName, savedLvl, null);
  
  initBoard();
  setTimeout(() => { if (!hasLoadedFromCloud) { hasLoadedFromCloud = true; initBoard(); } }, 600);
});

function applyPlannerLoginState(name, lvl, empId) {
  isPlanner = true; plannerLevel = lvl; currentPlannerName = name;
  sessionStorage.setItem("planner_name", name); sessionStorage.setItem("planner_level", lvl);
  document.body.classList.add("planner-active");
  const badge = document.getElementById("plannerStatusBadge");
  if (badge) badge.textContent = "👤 " + name + " (Stufe " + lvl + ")";
  checkBoardLockState();
}

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
  const nameVal = document.getElementById("loginPlannerName").value.trim().toLowerCase();
  const pinVal = document.getElementById("pinInput").value.trim();
  if ((nameVal === "admin" || nameVal === "planer") && pinVal === "1234") {
    sessionStorage.setItem("board_unlocked", "true");
    applyPlannerLoginState("Admin", 4, null); closeModal("pinModal"); initBoard(); return;
  }
  let emp = employees.find(e => fullName(e).toLowerCase() === nameVal);
  if (!emp && nameVal) { const p = employees.filter(e => fullName(e).toLowerCase().indexOf(nameVal) !== -1); if (p.length === 1) emp = p[0]; }
  if (!emp || (emp.password || "1234") !== pinVal) { showTimedBoxMsg("loginModalError", "❌ Name oder PIN nicht korrekt!", false); return; }
  
  applyPlannerLoginState(fullName(emp), Number(emp.accessLevel) || 2, emp.id);
  closeModal("pinModal"); initBoard();
};

window.rotateAllShifts = function() { performShiftRotationLogic(true); };
window.clearEntireBoard = function() { employees.forEach(e => { if (e.zone && ["pool","absent","extra"].indexOf(e.zone) === -1 && !e.noRotation) e.zone = "pool"; }); saveToFirebase(); renderEmployees(); };
window.clearShiftRow = function(sId) { employees.forEach(e => { if (extractShiftIdFromZone(e.zone) === sId && !e.noRotation) e.zone = "pool"; }); saveToFirebase(); renderEmployees(); };
window.loadTeamToShift = function(slotKey) {
  const sel = document.getElementById("teamSelect_" + slotKey); if (!sel) return;
  const teamKey = sel.value; shiftRotation[slotKey] = teamKey;
  employees.forEach(emp => {
    if (emp.team === teamKey && emp.zone !== "absent" && emp.zone !== "extra" && !emp.noRotation) {
      if (slotKey === "frei") emp.zone = "pool";
      else {
        const targetLine = emp.mainLines && emp.mainLines[0] ? emp.mainLines[0] : null;
        emp.zone = targetLine ? (targetLine + "_" + slotKey) : "pool";
      }
    }
  });
  saveToFirebase(); initBoard();
};
window.performShiftRotationLogic = function() {
  const slotOrder = ["frueh", "spaet", "nacht", "frei"];
  const activeSlots = slotOrder.filter(s => shiftRotation[s]);
  if (activeSlots.length < 2) return;
  const nextShiftRotation = Object.assign({}, shiftRotation);
  activeSlots.forEach((fromSlot, idx) => { nextShiftRotation[activeSlots[(idx + 1) % activeSlots.length]] = shiftRotation[fromSlot]; });
  shiftRotation = nextShiftRotation; saveToFirebase(); initBoard();
};
window.updateInboxBadge = function() {};
window.openSettingsModal = function() { document.getElementById("settingsModal").style.display = "flex"; };
window.openInboxModal = function() { document.getElementById("inboxModal").style.display = "flex"; };
