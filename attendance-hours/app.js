import { supabase, initError } from "./supabaseClient.js";
import { CONFIG } from "./config.js";
import { getSession, signOut, getCurrentEmployeeProfile, isAdmin } from "./auth.js";
import {
  qs, qsa, showToast, fmtDateISO, countWorkingDays, hoursBetween, round2,
  time12To24, time24To12, isNonEmptyString
} from "./utils.js";

// UI
const whoami = qs("#whoami");
const btnLogout = qs("#btnLogout");

const employeeSelect = qs("#employeeSelect");
const fromDate = qs("#fromDate");
const toDate = qs("#toDate");
const btnLoad = qs("#btnLoad");

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

btnLogout.addEventListener("click", signOut);

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
}

function renderRecords(records){
  clearTable();
  if(!records || records.length===0){
    recordsTbody.innerHTML = `<tr><td colspan="5" class="muted">No records.</td></tr>`;
    return;
  }

  for(const r of records){
    const leave = LEAVE_TYPES.find(x=>String(x.id)===String(r.leave_type_id));
    const leaveName = leave ? leave.name : "";
    const signIn = r.sign_in ? time24To12(r.sign_in) : "";
    const signOut = r.sign_out ? time24To12(r.sign_out) : "";
    const wh = Number(r.working_hours || 0);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.record_date}</td>
      <td>${signIn}</td>
      <td>${signOut}</td>
      <td>${leaveName || (r.leave_type_id ? String(r.leave_type_id) : "")}</td>
      <td>${round2(wh)}</td>
    `;
    recordsTbody.appendChild(tr);
  }
}

async function loadLeaveTypes(){
  const { data, error } = await supabase.from("leave_types").select("id, name").order("name");
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
    EMPLOYEES.length ? "Select employee" : "No employees"
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

  if(!isNonEmptyString(empId)) { showToast("Select employee.", "warn"); return; }
  if(!isNonEmptyString(f) || !isNonEmptyString(t)) { showToast("Select date range.", "warn"); return; }
  if(f>t){ showToast("From date must be before To date.", "warn"); return; }

  btnLoad.disabled = true;
  try{
    const { data, error } = await supabase
      .from("attendance_records")
      .select("record_date, sign_in, sign_out, leave_type_id, working_hours")
      .eq("employee_id", empId)
      .gte("record_date", f)
      .lte("record_date", t)
      .order("record_date", { ascending: true });

    if(error) throw error;

    const records = data || [];
    renderRecords(records);

    // KPIs
    const workingDays = countWorkingDays(f, t, CONFIG.WEEKEND_DAYS_JS);
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
      record_date: date,
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
    // Upsert based on unique (employee_id, record_date)
    const payload = rows.map(r=>({ ...r, employee_id: empId }));
    const { error } = await supabase
      .from("attendance_records")
      .upsert(payload, { onConflict: "employee_id,record_date" });

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
