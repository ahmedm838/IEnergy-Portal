import { supabase, initError } from "./supabaseClient.js";
import { CONFIG } from "./config.js";
import { getSession, signOut, getCurrentEmployeeProfile, isAdmin } from "./auth.js";
import {
  qs, qsa, showToast, fmtDateISO, countWorkingDays, hoursBetween, round2,
  time12To24, time24To12, isNonEmptyString, fmtWeekDate
} from "./utils.js";

// UI
const whoami = qs("#whoami");
const btnPortal = qs("#btnPortal");
const btnLogout = qs("#btnLogout");

const employeeSelect = qs("#employeeSelect");
const fromDate = qs("#fromDate");
const toDate = qs("#toDate");
const btnLoad = qs("#btnLoad");
const btnExport = qs("#btnExport");

const recordsTbody = qs("#recordsTbody");

const kpiWorkingDays = qs("#kpiWorkingDays");
const kpiWorkedDays = qs("#kpiWorkedDays");
const kpiLeaveDays = qs("#kpiLeaveDays");
const kpiDeltaDays = qs("#kpiDeltaDays");
const kpiWorkingHours = qs("#kpiWorkingHours");
const kpiActualHours = qs("#kpiActualHours");
const kpiDeltaHours = qs("#kpiDeltaHours");

const adminPanel = qs("#adminPanel");
const adminEmployeeSelect = qs("#adminEmployeeSelect");
const btnAddRow = qs("#btnAddRow");
const btnSaveRows = qs("#btnSaveRows");
const entryTbody = qs("#entryTbody");

// State
let PROFILE = null;
let EMPLOYEES = [];
let LEAVE_TYPES = [];
let ADMIN = false;

// Last loaded data (for export)
let LAST_LOADED = [];

// Attendance table schema compatibility (the project has had multiple variants)
// - Date column: record_date (old) OR work_date (current in your screenshot)
// - Hours column: working_hours (old) OR absent (compute client-side)
const ATT = {
  dateCol: null,
  hasWorkingHoursCol: false
};

async function ensureAttendanceSchema(){
  if (ATT.dateCol) return ATT;

  // Probe for date column
  const probe = async (col) => {
    const { error } = await supabase.from("attendance_records").select(col).limit(1);
    return !error;
  };

  // Prefer the newer naming first
  if (await probe("work_date")) ATT.dateCol = "work_date";
  else if (await probe("record_date")) ATT.dateCol = "record_date";
  else {
    throw new Error(
      "attendance_records must have either work_date or record_date. Please align the table schema with the Attendance Tracker app."
    );
  }

  // Probe for working_hours
  ATT.hasWorkingHoursCol = await probe("working_hours");
  return ATT;
}

btnLogout.addEventListener("click", signOut);

// Back to iEnergy Portal (main page)
if (btnPortal) {
  btnPortal.addEventListener("click", () => {
    // Relative path works on GitHub Pages and local hosting
    window.location.href = "../index.html";
  });
}

function optionHtml(items, getValue, getLabel, placeholder){
  const parts = [];
  if(placeholder) parts.push(`<option value="">${placeholder}</option>`);
  for(const it of items){
    parts.push(`<option value="${getValue(it)}">${getLabel(it)}</option>`);
  }
  return parts.join("");
}

function leaveTypeOptionsHtml(selectedId=""){
  const parts = [`<option value="">(Attended)</option>`];
  for(const t of LEAVE_TYPES){
    const sel = String(t.id) === String(selectedId) ? "selected" : "";
    parts.push(`<option value="${t.id}" ${sel}>${t.name}</option>`);
  }
  return parts.join("");
}

function renderEntryRow(rowId, preset={}){
  const todayISO = fmtDateISO(new Date());
  const dateVal = preset.date || todayISO;
  const leaveTypeId = preset.leave_type_id || "";
  const signIn12 = preset.sign_in ? time24To12(preset.sign_in) : time24To12(CONFIG.DEFAULT_SIGN_IN);
  const signOut12 = preset.sign_out ? time24To12(preset.sign_out) : time24To12(CONFIG.DEFAULT_SIGN_OUT);

  const tr = document.createElement("tr");
  tr.dataset.rowId = rowId;

  tr.innerHTML = `
    <td><input type="date" class="inDate" value="${dateVal}"/></td>
    <td>
      <select class="inLeaveType">
        ${leaveTypeOptionsHtml(leaveTypeId)}
      </select>
    </td>
    <td><input type="text" class="inSignIn" placeholder="08:00 AM" value="${signIn12}"/></td>
    <td><input type="text" class="inSignOut" placeholder="04:00 PM" value="${signOut12}"/></td>
    <td style="text-align:right"><button class="btn danger btnDel" title="Remove">X</button></td>
  `;

  const leaveSel = tr.querySelector(".inLeaveType");
  const inEl = tr.querySelector(".inSignIn");
  const outEl = tr.querySelector(".inSignOut");

  function applyLeaveRule(){
    const hasLeave = isNonEmptyString(leaveSel.value);
    if(hasLeave){
      inEl.value = time24To12(CONFIG.DEFAULT_SIGN_IN);
      outEl.value = time24To12(CONFIG.DEFAULT_SIGN_OUT);
      inEl.disabled = true;
      outEl.disabled = true;
    }else{
      inEl.disabled = false;
      outEl.disabled = false;
    }
  }

  leaveSel.addEventListener("change", applyLeaveRule);
  applyLeaveRule();

  tr.querySelector(".btnDel").addEventListener("click", () => tr.remove());
  entryTbody.appendChild(tr);
}

function setKpis({workingDays, workedDays, leaveDays, deltaDays, workingHours, actualHours, deltaHours}){
  kpiWorkingDays.textContent = String(workingDays);
  kpiWorkedDays.textContent = String(workedDays);
  kpiLeaveDays.textContent = String(leaveDays);
  kpiDeltaDays.textContent = (deltaDays>=0?`+${round2(deltaDays)}`:String(round2(deltaDays)));
  kpiWorkingHours.textContent = String(round2(workingHours));
  kpiActualHours.textContent = String(round2(actualHours));
  kpiDeltaHours.textContent = (deltaHours>=0?`+${round2(deltaHours)}`:String(round2(deltaHours)));
}

function clearTable(){
  recordsTbody.innerHTML = "";
  LAST_LOADED = [];
  if (btnExport) btnExport.disabled = true;
}

function renderRecords(records){
  clearTable();
  if(!records || records.length===0){
    recordsTbody.innerHTML = `<tr><td colspan="6" class="muted">No records.</td></tr>`;
    return;
  }

  // Records are expected in normalized form:
  // { date, employee_code, employee_name, sign_in, sign_out, leave_type_id, working_hours, leave_label }
  for(const r of records){
    const signIn = r.sign_in ? time24To12(r.sign_in) : "";
    const signOut = r.sign_out ? time24To12(r.sign_out) : "";
    const wh = Number(r.working_hours || 0);

    const employeeLabel = [r.employee_code, r.employee_name].filter(Boolean).join(" - ");
    const leaveLabel = r.leave_label || "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtWeekDate(r.date)}</td>
      <td>${employeeLabel}</td>
      <td>${signIn}</td>
      <td>${signOut}</td>
      <td>${leaveLabel}</td>
      <td>${round2(wh)}</td>
    `;
    recordsTbody.appendChild(tr);
  }

  LAST_LOADED = records;
  if (btnExport) btnExport.disabled = false;
}

function downloadBlob(content, mimeType, filename){
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportLoadedToExcel(){
  if(!LAST_LOADED || LAST_LOADED.length === 0){
    showToast("Load records first.", "warn");
    return;
  }

  // Build a clean export view
  const rows = LAST_LOADED.map(r => ({
    Date: fmtWeekDate(r.date),
    EmployeeCode: r.employee_code || "",
    EmployeeName: r.employee_name || "",
    SignIn: r.sign_in ? time24To12(r.sign_in) : "",
    SignOut: r.sign_out ? time24To12(r.sign_out) : "",
    LeaveType: r.leave_label || "",
    WorkingHours: round2(Number(r.working_hours || 0))
  }));

  const f = fromDate.value || "from";
  const t = toDate.value || "to";
  const scope = (ADMIN && !isNonEmptyString(employeeSelect.value)) ? "all-employees" : "employee";
  const filenameBase = `attendance-${scope}-${f}-to-${t}`;

  // Prefer real XLSX if library is available, otherwise fallback to CSV (Excel opens it fine).
  try{
    if(window.XLSX && XLSX.utils && XLSX.writeFile){
      const ws = XLSX.utils.json_to_sheet(rows);
      // Set sensible column widths (prevents wrapping, especially the Date column).
      ws["!cols"] = [
        { wch: 26 }, // Date: "04-02-2026,Wednesday"
        { wch: 14 }, // EmployeeCode
        { wch: 28 }, // EmployeeName
        { wch: 12 }, // SignIn
        { wch: 12 }, // SignOut
        { wch: 18 }, // LeaveType
        { wch: 14 }  // WorkingHours
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Attendance");
      XLSX.writeFile(wb, `${filenameBase}.xlsx`);
      return;
    }
  }catch(e){
    // Fall through to CSV
    console.warn("XLSX export failed, falling back to CSV.", e);
  }

  // CSV fallback
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? "");
    return /[\n\r,\"]/g.test(s) ? `"${s.replace(/\"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for(const row of rows){
    lines.push(headers.map(h => esc(row[h])).join(","));
  }
  downloadBlob(lines.join("\n"), "text/csv;charset=utf-8", `${filenameBase}.csv`);
}

async function loadLeaveTypes(){
  // Keep the dropdown in the same order as the database (typically the PK/sequence order).
  // Without an explicit ORDER BY, PostgREST may return rows in an arbitrary order.
  const { data, error } = await supabase
    .from("leave_types")
    .select("id, name")
    .order("id", { ascending: true });
  if(error) throw error;
  LEAVE_TYPES = data || [];
}

async function loadEmployees(){
  if(ADMIN){
    const { data, error } = await supabase
      .from("employees")
      .select("id, code, name")
      .order("code");
    if(error) throw error;
    EMPLOYEES = data || [];

    // If employees table has strict RLS without an admin SELECT policy, PostgREST
    // will return an empty array (not an error). Provide a helpful warning and
    // fall back to showing the current employee so the page remains usable.
    if(EMPLOYEES.length === 0 && PROFILE){
      showToast(
        "Employees list returned empty. This is usually due to RLS on the employees table. " +
        "Run the Attendance Tracker SQL schema to add an admin SELECT policy on employees.",
        "warn"
      );
      EMPLOYEES = [{ id: PROFILE.id, code: PROFILE.code, name: PROFILE.name }];
    }
  }else{
    // Only own profile
    EMPLOYEES = PROFILE ? [{ id: PROFILE.id, code: PROFILE.code, name: PROFILE.name }] : [];
  }

  employeeSelect.innerHTML = optionHtml(
    EMPLOYEES,
    e=>e.id,
    e=>`${e.code} - ${e.name}`,
    EMPLOYEES.length ? (ADMIN ? "All employees" : "Select employee") : "No employees"
  );

  if(EMPLOYEES.length===1){
    employeeSelect.value = EMPLOYEES[0].id;
  }

  // Admin panel employee selector
  if(ADMIN){
    adminEmployeeSelect.innerHTML = optionHtml(
      EMPLOYEES,
      e=>e.id,
      e=>`${e.code} - ${e.name}`,
      "Select employee"
    );
  }
}

function initDates(){
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth()+1, 0);
  fromDate.value = fmtDateISO(first);
  toDate.value = fmtDateISO(last);
}

async function loadRecords(){
  const empId = employeeSelect.value;
  const f = fromDate.value;
  const t = toDate.value;

  // In Admin mode: if no employee is selected, load ALL employees.
  if(!isNonEmptyString(empId) && !ADMIN) { showToast("Select employee.", "warn"); return; }
  if(!isNonEmptyString(f) || !isNonEmptyString(t)) { showToast("Select date range.", "warn"); return; }
  if(f>t){ showToast("From date must be before To date.", "warn"); return; }

  btnLoad.disabled = true;
  try{
    const { dateCol, hasWorkingHoursCol } = await ensureAttendanceSchema();

    const selectCols = [
      "employee_id",
      dateCol,
      "sign_in",
      "sign_out",
      "leave_type_id",
      ...(hasWorkingHoursCol ? ["working_hours"] : []),
      // Join employees to show employee name when loading all employees
      "employees(code,name)"
    ].join(", ");

    let q = supabase
      .from("attendance_records")
      .select(selectCols)
      .gte(dateCol, f)
      .lte(dateCol, t)
      .order("employee_id", { ascending: true })
      .order(dateCol, { ascending: true });

    if(isNonEmptyString(empId)){
      q = q.eq("employee_id", empId);
    }

    const { data, error } = await q;

    if(error) throw error;

    const raw = data || [];
    const records = raw.map(r => {
      const leaveSelected = r.leave_type_id !== null && r.leave_type_id !== undefined && String(r.leave_type_id).length > 0;
      const wh = hasWorkingHoursCol
        ? Number(r.working_hours || 0)
        : (leaveSelected ? CONFIG.STANDARD_HOURS_PER_DAY : round2(hoursBetween(r.sign_in, r.sign_out)));

      const empRel = Array.isArray(r.employees) ? r.employees[0] : r.employees;
      const employee_code = empRel?.code || "";
      const employee_name = empRel?.name || "";

      const leave = LEAVE_TYPES.find(x=>String(x.id)===String(r.leave_type_id));
      const leaveName = leave ? leave.name : "";

      const hasAttendanceTime = isNonEmptyString(r.sign_in) || isNonEmptyString(r.sign_out);
      const hasLeaveType = r.leave_type_id !== null && r.leave_type_id !== undefined && String(r.leave_type_id).length > 0;
      const leave_label = leaveName || (hasAttendanceTime && !hasLeaveType ? "Attended" : (hasLeaveType ? String(r.leave_type_id) : ""));

      return {
        employee_id: r.employee_id,
        employee_code,
        employee_name,
        date: r[dateCol],
        sign_in: r.sign_in,
        sign_out: r.sign_out,
        leave_type_id: r.leave_type_id,
        working_hours: wh,
        leave_label
      };
    });

    renderRecords(records);

    // KPIs
    const workingDaysPerEmployee = countWorkingDays(f, t, CONFIG.WEEKEND_DAYS_JS);
    const distinctEmployees = new Set(records.map(r=>r.employee_id).filter(Boolean));
    const employeeCount = isNonEmptyString(empId) ? 1 : (distinctEmployees.size || (EMPLOYEES.length || 1));
    const workingDays = workingDaysPerEmployee * employeeCount;
    const leaveDays = records.filter(r=>r.leave_type_id!==null && r.leave_type_id!==undefined && String(r.leave_type_id).length>0).length;
    const workedDays = records.length - leaveDays;

    const workingHours = workingDays * CONFIG.STANDARD_HOURS_PER_DAY;
    const actualHours = round2(records.reduce((sum,r)=>sum + Number(r.working_hours||0), 0));

    const deltaDays = (workedDays + leaveDays) - workingDays; // recorded days vs expected
    const deltaHours = actualHours - workingHours;

    setKpis({workingDays, workedDays, leaveDays, deltaDays, workingHours, actualHours, deltaHours});
  }catch(e){
    console.error(e);
    showToast(e?.message || "Failed to load records.", "danger");
  }finally{
    btnLoad.disabled = false;
  }
}

btnLoad.addEventListener("click", loadRecords);

if (btnExport) {
  btnExport.addEventListener("click", exportLoadedToExcel);
}

function collectEntryRows(){
  const rows = [];
  for(const tr of Array.from(entryTbody.querySelectorAll("tr"))){
    const date = tr.querySelector(".inDate")?.value;
    const leaveTypeId = tr.querySelector(".inLeaveType")?.value || null;
    const signIn12 = tr.querySelector(".inSignIn")?.value || "";
    const signOut12 = tr.querySelector(".inSignOut")?.value || "";

    if(!isNonEmptyString(date)) throw new Error("Each row must have a date.");

    let sign_in = null;
    let sign_out = null;

    if(isNonEmptyString(leaveTypeId)){
      sign_in = CONFIG.DEFAULT_SIGN_IN;
      sign_out = CONFIG.DEFAULT_SIGN_OUT;
    }else{
      const tIn = time12To24(signIn12);
      const tOut = time12To24(signOut12);
      if(!tIn || !tOut) throw new Error("For attended days, enter Sign In/Out in 12-hour format like 08:00 AM.");
      // No cross-day shifts
      if(hoursBetween(tIn, tOut) <= 0) throw new Error("Sign Out must be after Sign In (same day).");
      sign_in = tIn;
      sign_out = tOut;
    }

    const wh = isNonEmptyString(leaveTypeId) ? CONFIG.STANDARD_HOURS_PER_DAY : round2(hoursBetween(sign_in, sign_out));
    rows.push({
      date,
      leave_type_id: isNonEmptyString(leaveTypeId) ? Number(leaveTypeId) : null,
      sign_in,
      sign_out,
      working_hours: wh
    });
  }
  return rows;
}

async function saveEntryRows(){
  const empId = adminEmployeeSelect.value;
  if(!isNonEmptyString(empId)) { showToast("Select employee (Admin panel).", "warn"); return; }

  let rows;
  try{
    rows = collectEntryRows();
  }catch(e){
    showToast(e.message, "warn");
    return;
  }
  if(rows.length===0){ showToast("Add at least one row.", "warn"); return; }

  btnSaveRows.disabled = true;
  try{
    const { dateCol, hasWorkingHoursCol } = await ensureAttendanceSchema();

    // Upsert based on unique (employee_id, <dateCol>)
    const payload = rows.map(r=>({
      employee_id: empId,
      [dateCol]: r.date,
      leave_type_id: r.leave_type_id,
      sign_in: r.sign_in,
      sign_out: r.sign_out,
      ...(hasWorkingHoursCol ? { working_hours: r.working_hours } : {})
    }));
    const { error } = await supabase
      .from("attendance_records")
      .upsert(payload, { onConflict: `employee_id,${dateCol}` });

    if(error) throw error;

    showToast(`Saved ${payload.length} record(s).`, "good");
    entryTbody.innerHTML = "";
    renderEntryRow(String(Date.now()));
    // refresh main table if same employee
    if(employeeSelect.value === empId) await loadRecords();
  }catch(e){
    console.error(e);
    showToast(e?.message || "Failed to save.", "danger");
  }finally{
    btnSaveRows.disabled = false;
  }
}

btnAddRow.addEventListener("click", () => renderEntryRow(String(Date.now())));
btnSaveRows.addEventListener("click", saveEntryRows);

async function boot(){
  if (initError || !supabase) {
    showToast(initError || "Supabase is not initialized.", "danger");
    return;
  }
  const session = await getSession();
  if(!session){
    window.location.href = "./login.html";
    return;
  }

  PROFILE = await getCurrentEmployeeProfile();
  if(!PROFILE){
    showToast("Employee profile not found for this account.", "danger");
    return;
  }

  ADMIN = isAdmin(PROFILE);
  whoami.textContent = `${PROFILE.code} - ${PROFILE.name} (${ADMIN ? "Admin" : "User"})`;

  initDates();
  await loadLeaveTypes();
  await loadEmployees();

  if(ADMIN){
    adminPanel.style.display = "block";
    // defaults
    if(EMPLOYEES.length===1){
      adminEmployeeSelect.value = EMPLOYEES[0].id;
    }
    renderEntryRow(String(Date.now()));
  }else{
    adminPanel.style.display = "none";
  }
}

boot().catch((e)=>{
  console.error(e);
  showToast(e?.message || "Failed to start app.", "danger");
});
