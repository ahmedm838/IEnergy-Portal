
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Employee, LeaveRecord, LeaveType, RoleName, YearStatus } from "../types";

function yearNow(): number {
  return new Date().getFullYear();
}

async function fetchMyEmployee(): Promise<Employee> {
  // Prefer getSession() on initial load; it reads from persisted storage.
  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) throw new Error(`Auth session error: ${sessErr.message}`);
  const uid = sessData.session?.user?.id;
  if (!uid) throw new Error("Not authenticated (no session)");

  // Validate token with the Auth API to provide a clear error if JWT is invalid/expired.
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw new Error(`Auth user error: ${userErr.message}`);
  if (!userData.user?.id) throw new Error("Not authenticated (no user)");

  const { data, error } = await supabase
    .from("employees")
    .select("id, auth_user_id, code, name, user_id, hiring_date, planned_annual_balance, unplanned_annual_balance, roles(name)")
    .eq("auth_user_id", uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error(
      "No employee profile is linked to this login. Ask Admin to create your employee record (and set auth_user_id to your Auth user id).",
    );
  }
  return data as any;
}

export default function DashboardPage() {
  const [me, setMe] = useState<Employee | null>(null);
  const [status, setStatus] = useState<YearStatus | null>(null);
  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [year, setYear] = useState<number>(yearNow());

  const role: RoleName | null = (me?.roles?.name ?? null) as any;

  useEffect(() => {
    (async () => {
      try {
        setErr(null);
        const emp = await fetchMyEmployee();
        setMe(emp);

        const { data: types, error: tErr } = await supabase
          .from("leave_types")
          .select("id, name, deduct_from")
          .order("id", { ascending: true });
        if (tErr) throw tErr;
        setLeaveTypes(types as any);

      } catch (e: any) {
        setErr(e?.message ?? String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!me) return;
    (async () => {
      try {
        setErr(null);

        // Ensure the year row exists by selecting/creating via admin? For non-admin, it exists once admin recorded leaves.
        const { data: st, error: stErr } = await supabase
          .from("v_employee_year_status")
          .select("*")
          .eq("employee_id", me.id)
          .eq("year", year)
          .maybeSingle();
        if (stErr) throw stErr;
        setStatus(st as any);

        const { data: rec, error: recErr } = await supabase
          .from("leave_records")
          .select("id, employee_id, code, start_date, end_date, leave_days, leave_type_id, remarks, leave_types(name, deduct_from)")
          .eq("employee_id", me.id)
          .gte("start_date", `${year}-01-01`)
          .lte("start_date", `${year}-12-31`)
          .order("start_date", { ascending: false });
        if (recErr) throw recErr;
        setRecords(rec as any);

      } catch (e: any) {
        setErr(e?.message ?? String(e));
      }
    })();
  }, [me, year]);

  return (
    <div className="space-y-6">
      {err && (
        <div className="rounded-xl border border-red-300/60 bg-red-50 dark:bg-red-950/40 dark:border-red-800/60 p-3 text-sm">
          {err}
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">
            {me ? (
              <>
                <span className="font-semibold">{me.name}</span> · Code {me.code} · Hired {me.hiring_date} · Role {role}
              </>
            ) : (
              "Loading profile…"
            )}
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <div className="label">Year</div>
          <input
            className="input w-28"
            type="number"
            value={year}
            min={2000}
            max={2100}
            onChange={(e) => setYear(parseInt(e.target.value || `${yearNow()}`, 10))}
          />
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="text-sm font-semibold">Planned</div>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Beginning: <span className="font-semibold">{status?.beginning_planned_balance ?? "—"}</span>
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            Utilized: <span className="font-semibold">{status?.utilized_planned_days ?? "—"}</span>
          </div>
          <div className="mt-2 text-lg font-bold">
            Remaining: {status?.remaining_planned_days ?? "—"}
          </div>
        </div>

        <div className="card p-5">
          <div className="text-sm font-semibold">Un-Planned</div>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Beginning: <span className="font-semibold">{status?.beginning_unplanned_balance ?? "—"}</span>
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            Utilized: <span className="font-semibold">{status?.utilized_unplanned_days ?? "—"}</span>
          </div>
          <div className="mt-2 text-lg font-bold">
            Remaining: {status?.remaining_unplanned_days ?? "—"}
          </div>
        </div>

        <div className="card p-5">
          <div className="text-sm font-semibold">Other Leave Types</div>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Total utilized (non-deducted): <span className="font-semibold">{status?.utilized_other_days ?? "—"}</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Includes: {leaveTypes.filter(t => t.deduct_from === "none").map(t => t.name).join(", ")}
          </div>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">My Leave Records ({year})</h2>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Leave days are inclusive (end - start + 1). Cross-year records are not allowed.
          </div>
        </div>

        <div className="mt-4 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600 dark:text-slate-300">
              <tr>
                <th className="py-2 pr-3">Start</th>
                <th className="py-2 pr-3">End</th>
                <th className="py-2 pr-3">Days</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td className="py-3 text-slate-500 dark:text-slate-400" colSpan={5}>No records for this year.</td></tr>
              ) : (
                records.map(r => (
                  <tr key={r.id} className="border-t border-slate-200/60 dark:border-slate-800/60">
                    <td className="py-2 pr-3">{r.start_date}</td>
                    <td className="py-2 pr-3">{r.end_date}</td>
                    <td className="py-2 pr-3 font-semibold">{r.leave_days}</td>
                    <td className="py-2 pr-3">{r.leave_types?.name ?? r.leave_type_id}</td>
                    <td className="py-2 pr-3">{r.remarks ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {role === "Admin" && <AdminSection currentYear={year} leaveTypes={leaveTypes} />}
    </div>
  );
}

function AdminSection({ currentYear, leaveTypes }: { currentYear: number; leaveTypes: LeaveType[] }) {
  const [tab, setTab] = useState<"employees" | "leaves" | "status" | "password">("employees");
  return (
    <section className="card p-5">
      <div className="flex flex-wrap gap-2">
        <button className={tab==="employees" ? "btn" : "btn-secondary"} onClick={() => setTab("employees")}>Add Employee</button>
        <button className={tab==="leaves" ? "btn" : "btn-secondary"} onClick={() => setTab("leaves")}>Record Leave</button>
        <button className={tab==="status" ? "btn" : "btn-secondary"} onClick={() => setTab("status")}>Employee Status</button>
        <button className={tab==="password" ? "btn" : "btn-secondary"} onClick={() => setTab("password")}>Reset Password</button>
      </div>

      <div className="mt-6">
        {tab === "employees" && <AdminEmployees />}
        {tab === "leaves" && <AdminBulkLeaves currentYear={currentYear} leaveTypes={leaveTypes} />}
        {tab === "status" && <AdminEmployeeStatus currentYear={currentYear} leaveTypes={leaveTypes} />}
        {tab === "password" && <AdminResetPassword />}
      </div>
    </section>
  );
}

function AdminEmployees() {
  const [employees, setEmployees] = useState<Array<Pick<Employee, "id" | "code" | "name">>>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [hiringDate, setHiringDate] = useState("");
  const [role, setRole] = useState<RoleName>("User");
  const [password, setPassword] = useState("");
  const [planned, setPlanned] = useState(14);
  const [unplanned, setUnplanned] = useState(7);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const jwt = sess.session?.access_token;
      if (!jwt) throw new Error("No session");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-invite`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          code, name, user_id: userId, hiring_date: hiringDate, role,
          password,
          planned_annual_balance: planned,
          unplanned_annual_balance: unplanned,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setMsg(`Created/updated user: ${j.email}`);
    } catch (e:any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-600 dark:text-slate-300">
        Create or update an employee and their login. User ID must be letters/numbers and dots only.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="label mb-1">Code (6 digits, starts with 2)</div>
          <input className="input" value={code} onChange={(e)=>setCode(e.target.value)} />
        </div>
        <div>
          <div className="label mb-1">Name (at least 3 words)</div>
          <input className="input" value={name} onChange={(e)=>setName(e.target.value)} />
        </div>
        <div>
          <div className="label mb-1">User ID</div>
          <input className="input" value={userId} onChange={(e)=>setUserId(e.target.value)} placeholder="e.g. ahmed.moustafa" />
        </div>
        <div>
          <div className="label mb-1">Hiring date</div>
          <input className="input" type="date" value={hiringDate} onChange={(e)=>setHiringDate(e.target.value)} />
        </div>
        <div>
          <div className="label mb-1">Role</div>
          <select className="input" value={role} onChange={(e)=>setRole(e.target.value as RoleName)}>
            <option value="User">User</option>
            <option value="Admin">Admin</option>
          </select>
        </div>
        <div>
          <div className="label mb-1">Initial password (min 6)</div>
          <input className="input" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} />
        </div>
        <div>
          <div className="label mb-1">Planned annual balance</div>
          <input className="input" type="number" value={planned} onChange={(e)=>setPlanned(parseInt(e.target.value||"14",10))} />
        </div>
        <div>
          <div className="label mb-1">Un-Planned annual balance</div>
          <input className="input" type="number" value={unplanned} onChange={(e)=>setUnplanned(parseInt(e.target.value||"7",10))} />
        </div>
      </div>

      {err && <div className="rounded-xl border border-red-300/60 bg-red-50 dark:bg-red-950/40 dark:border-red-800/60 p-3 text-sm">{err}</div>}
      {msg && <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800/60 p-3 text-sm">{msg}</div>}

      <button className="btn" disabled={busy} onClick={invite}>{busy ? "Saving…" : "Save Employee"}</button>
    </div>
  );
}

type BulkRow = { code: string; start_date: string; end_date: string; leave_type_id: number; remarks: string };

function AdminBulkLeaves({ currentYear, leaveTypes }: { currentYear: number; leaveTypes: LeaveType[] }) {
  const defaultTypeId = leaveTypes.find(t => t.name === "Planned")?.id ?? (leaveTypes[0]?.id ?? 1);
  const [rows, setRows] = useState<BulkRow[]>([
    { code: "", start_date: `${currentYear}-01-01`, end_date: `${currentYear}-01-01`, leave_type_id: defaultTypeId, remarks: "" },
  ]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  type EmployeeOption = Pick<Employee, "id" | "code" | "name">;
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  const loadEmployees = async () => {
    setLoadingEmployees(true);
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("id, code, name")
        .order("code", { ascending: true });
      if (error) throw error;
      setEmployees((data ?? []) as EmployeeOption[]);
    } finally {
      setLoadingEmployees(false);
    }
  };

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  function addRow() {
    setRows(r => [...r, { code: "", start_date: `${currentYear}-01-01`, end_date: `${currentYear}-01-01`, leave_type_id: defaultTypeId, remarks: "" }]);
  }
  function update(i: number, patch: Partial<BulkRow>) {
    setRows(r => r.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  }
  function remove(i: number) {
    setRows(r => r.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setBusy(true); setErr(null); setMsg(null);

    const daysInclusive = (start: string, end: string): number => {
      const s = new Date(start);
      const e = new Date(end);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
      const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
      return diff + 1;
    };

    const yearOf = (dateStr: string) => new Date(dateStr).getFullYear();

    const typeById = new Map<number, LeaveType>();
    for (const t of leaveTypes) typeById.set(Number(t.id), t);

    const getDeductFrom = (typeId: number): "planned" | "unplanned" | "none" => {
      const t = typeById.get(Number(typeId));
      const d = (t?.deduct_from ?? "none") as any;
      return (d === "planned" || d === "unplanned" || d === "none") ? d : "none";
    };

    const getTypeName = (typeId: number): string => typeById.get(Number(typeId))?.name ?? String(typeId);

    // Normalize employee code to avoid mismatches (spaces, zero-width chars, Arabic-Indic digits)
    const normalizeCode = (input: string) => {
      const map: Record<string, string> = {
        "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9",
        "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
      };
      return (input ?? "")
        .trim()
        .replace(/[\u200B\uFEFF]/g, "")        // zero-width space / BOM
        .replace(/\s+/g, "")                  // all whitespace
        .replace(/[٠-٩۰-۹]/g, (d) => map[d] ?? d);
    };

    let insertedCount = 0;
    const missingCodes: string[] = [];
    const balanceExceeded: string[] = [];

    try {
      const normalizedRows = rows.map(r => ({
        ...r,
        code: normalizeCode(r.code),
      }));

      const distinctCodes = Array.from(new Set(normalizedRows.map(r => r.code).filter(Boolean)));

      if (distinctCodes.length === 0) {
        throw new Error("Please enter at least one employee code.");
      }

      // Load employees (and balances) so one missing code does not block other inserts
      const { data: empRows, error: empErr } = await supabase
        .from("employees")
        .select("id, code, planned_annual_balance, unplanned_annual_balance")
        .in("code", distinctCodes);

      if (empErr) throw empErr;

      const employeesByCode = new Map<string, { id: string; planned: number; unplanned: number }>();
      for (const e of (empRows ?? []) as any[]) {
        employeesByCode.set(normalizeCode(e.code), {
          id: e.id,
          planned: Number(e.planned_annual_balance ?? 0),
          unplanned: Number(e.unplanned_annual_balance ?? 0),
        });
      }

      const existing = new Set(Array.from(employeesByCode.keys()));

      // Filter out missing codes first
      const candidateRows = normalizedRows.filter(r => {
        if (!r.code) return false;
        if (!existing.has(r.code)) {
          if (!missingCodes.includes(r.code)) missingCodes.push(r.code);
          return false;
        }
        return true;
      });

      // Compute current remaining balances per employee for this year (client-side, for UX)
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear}-12-31`;
      const employeeIds = Array.from(new Set(Array.from(employeesByCode.values()).map(v => v.id)));

      const usedByEmp = new Map<string, { planned: number; unplanned: number }>();
      for (const id of employeeIds) usedByEmp.set(id, { planned: 0, unplanned: 0 });

      // Page through leave_records for the selected employees in the selected year
      const pageSize = 1000;
      let from = 0;
      while (employeeIds.length > 0) {
        const { data: batch, error: bErr } = await supabase
          .from("leave_records")
          .select("employee_id, leave_days, leave_types(deduct_from)")
          .in("employee_id", employeeIds)
          .gte("start_date", yearStart)
          .lte("start_date", yearEnd)
          .range(from, from + pageSize - 1);
        if (bErr) throw bErr;

        const rows = (batch ?? []) as any[];
        for (const r of rows) {
          const empId = r.employee_id as string;
          const d = (r.leave_types?.deduct_from ?? "none") as string;
          const days = Number(r.leave_days ?? 0);
          const cur = usedByEmp.get(empId) ?? { planned: 0, unplanned: 0 };
          if (d === "planned") cur.planned += days;
          if (d === "unplanned") cur.unplanned += days;
          usedByEmp.set(empId, cur);
        }

        if (rows.length < pageSize) break;
        from += pageSize;
      }

      const remainingByEmpId = new Map<string, { planned: number; unplanned: number }>();
      for (const { id, planned, unplanned } of employeesByCode.values()) {
        const used = usedByEmp.get(id) ?? { planned: 0, unplanned: 0 };
        remainingByEmpId.set(id, {
          planned: Math.max(0, planned - used.planned),
          unplanned: Math.max(0, unplanned - used.unplanned),
        });
      }

      // Validate balances per row, and skip any row that would exceed remaining (do not submit it)
      const rowsToInsert: BulkRow[] = [];
      for (const r of candidateRows) {
        // Cross-year check (same as DB constraint, but clearer message)
        if (yearOf(r.start_date) !== yearOf(r.end_date)) {
          balanceExceeded.push(`${r.code}: Cross-year record is not allowed (${r.start_date} → ${r.end_date}).`);
          continue;
        }
        if (yearOf(r.start_date) !== currentYear) {
          balanceExceeded.push(`${r.code}: Dates must be inside year ${currentYear}.`);
          continue;
        }

        const emp = employeesByCode.get(r.code);
        if (!emp) continue;

        const d = getDeductFrom(r.leave_type_id);
        const reqDays = daysInclusive(r.start_date, r.end_date);
        if (reqDays <= 0) {
          balanceExceeded.push(`${r.code}: Invalid dates (${r.start_date} → ${r.end_date}).`);
          continue;
        }

        const rem = remainingByEmpId.get(emp.id) ?? { planned: 0, unplanned: 0 };
        if (d === "planned") {
          if (reqDays > rem.planned) {
            balanceExceeded.push(`${r.code}: Planned requested ${reqDays} day(s) exceeds remaining ${rem.planned}.`);
            continue;
          }
          rem.planned -= reqDays;
          remainingByEmpId.set(emp.id, rem);
        } else if (d === "unplanned") {
          if (reqDays > rem.unplanned) {
            balanceExceeded.push(`${r.code}: Un-Planned requested ${reqDays} day(s) exceeds remaining ${rem.unplanned}.`);
            continue;
          }
          rem.unplanned -= reqDays;
          remainingByEmpId.set(emp.id, rem);
        }

        rowsToInsert.push(r);
      }

      // Insert one by one to preserve clear balance/validation errors
      for (const row of rowsToInsert) {
        const { error } = await supabase.from("leave_records").insert({
          code: row.code,
          start_date: row.start_date,
          end_date: row.end_date,
          leave_type_id: row.leave_type_id,
          remarks: row.remarks || null,
        });
        if (error) throw error;
        insertedCount += 1;
      }

      setMsg(`Inserted ${insertedCount} record(s).`);

      const warnings: string[] = [];
      if (missingCodes.length > 0) warnings.push(`Employee not found for code(s): ${missingCodes.join(", ")}.`);
      if (balanceExceeded.length > 0) {
        const preview = balanceExceeded.slice(0, 10);
        warnings.push(
          `Skipped ${balanceExceeded.length} row(s) due to insufficient balance or invalid dates. ` +
          `${preview.join(" | ")}` +
          (balanceExceeded.length > 10 ? " | …" : "")
        );
      }
      if (warnings.length > 0) setErr(warnings.join("\n"));
    } catch (e:any) {
      const base = e?.message ?? String(e);
      setErr(insertedCount > 0 ? `Inserted ${insertedCount} record(s) before failure. ${base}` : base);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-600 dark:text-slate-300">
        Add multiple leave records in one shot. Rows that exceed the remaining Planned/Un-Planned balance are skipped (not submitted).
      </div>

      <div className="flex items-center gap-2">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Select employees from the list (loaded from the Employees table).
        </div>
        <button
          className="btn-secondary"
          onClick={loadEmployees}
          disabled={loadingEmployees}
          title="Reload employees list"
        >
          {loadingEmployees ? "Refreshing…" : "Refresh employees"}
        </button>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-600 dark:text-slate-300">
            <tr>
              <th className="py-2 pr-3">Code</th>
              <th className="py-2 pr-3">Start</th>
              <th className="py-2 pr-3">End</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Remarks</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-200/60 dark:border-slate-800/60">
                <td className="py-2 pr-3">
                  <select
                    className="input"
                    value={r.code}
                    onChange={(e)=>update(i,{code:e.target.value})}
                    disabled={loadingEmployees || employees.length === 0}
                  >
                    <option value="">Select employee…</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.code}>
                        {emp.code} — {emp.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3"><input className="input" type="date" value={r.start_date} onChange={(e)=>update(i,{start_date:e.target.value})} /></td>
                <td className="py-2 pr-3"><input className="input" type="date" value={r.end_date} onChange={(e)=>update(i,{end_date:e.target.value})} /></td>
                <td className="py-2 pr-3">
                  <select className="input" value={r.leave_type_id} onChange={(e)=>update(i,{leave_type_id:parseInt(e.target.value,10)})}>
                    {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-3"><input className="input" value={r.remarks} onChange={(e)=>update(i,{remarks:e.target.value})} /></td>
                <td className="py-2 pr-3">
                  <button className="btn-secondary" onClick={()=>remove(i)} disabled={rows.length===1}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {err && <div className="rounded-xl border border-red-300/60 bg-red-50 dark:bg-red-950/40 dark:border-red-800/60 p-3 text-sm">{err}</div>}
      {msg && <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800/60 p-3 text-sm">{msg}</div>}

      <div className="flex gap-2">
        <button className="btn-secondary" onClick={addRow}>Add row</button>
        <button className="btn" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Submit"}</button>
      </div>
    </div>
  );
}

function AdminEmployeeStatus({ currentYear, leaveTypes }: { currentYear: number; leaveTypes: LeaveType[] }) {
  const [code, setCode] = useState("");
  const [year, setYear] = useState(currentYear);
  const [status, setStatus] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [selectedEmployee, setSelectedEmployee] = useState<{ id: string; code: string; name: string } | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const downloadCsv = (rows: any[], filename: string) => {
    if (!rows || rows.length === 0) return;

    const escape = (val: any) => {
      if (val === null || val === undefined) return "";
      const s = String(val);
      const needsQuotes = /[",\n\r]/.test(s);
      const escaped = s.replace(/"/g, '""');
      return needsQuotes ? `"${escaped}"` : escaped;
    };

    const headers = Object.keys(rows[0]);
    const lines = [
      headers.join(","),
      ...rows.map((r: any) => headers.map((h) => escape(r[h])).join(",")),
    ];

    // Add UTF-8 BOM so Excel opens Arabic/Unicode correctly.
    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  async function exportCurrentView() {
    setErr(null);
    setInfo(null);
    if (!records || records.length === 0) {
      setErr("No records loaded to export. Click Load first.");
      return;
    }
    setExportBusy(true);
    try {
      const empCode = selectedEmployee?.code ?? code;
      const empName = selectedEmployee?.name ?? "";
      const rows = records.map((r: any) => ({
        EmployeeCode: empCode,
        EmployeeName: empName,
        Year: year,
        StartDate: r.start_date,
        EndDate: r.end_date,
        LeaveDays: r.leave_days,
        LeaveType: r.leave_types?.name ?? r.leave_type_id,
        DeductFrom: r.leave_types?.deduct_from ?? "",
        Remarks: r.remarks ?? "",
      }));
      const safeCode = (empCode || "employee").replace(/[^A-Za-z0-9_-]/g, "_");
      const fname = `leave-records-${safeCode}-${year}.csv`;
      downloadCsv(rows, fname);
      setInfo(`Exported ${rows.length} record(s) (current view).`);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setExportBusy(false);
    }
  }

  async function exportAllRecords() {
    setErr(null);
    setInfo(null);
    setExportBusy(true);
    try {
      const pageSize = 1000;
      let from = 0;
      const all: any[] = [];

      while (true) {
        const { data, error } = await supabase
          .from("leave_records")
          .select("id, code, start_date, end_date, leave_days, leave_type_id, remarks, created_at, updated_at, leave_types(name, deduct_from)")
          .order("start_date", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = (data ?? []) as any[];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }

      // Build a code -> employee details map (avoids FK relationship ambiguity in select).
      const codes = Array.from(new Set(all.map((r: any) => r.code).filter(Boolean)));
      const empByCode = new Map<string, { name: string; user_id: string }>();

      const chunk = <T,>(arr: T[], size: number) => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      for (const c of chunk(codes, 500)) {
        const { data: emps, error: eErr } = await supabase
          .from("employees")
          .select("code, name, user_id")
          .in("code", c);

        if (eErr) throw eErr;
        for (const e of (emps ?? []) as any[]) {
          empByCode.set(e.code, { name: e.name, user_id: e.user_id });
        }
      }

      const rows = all.map((r: any) => ({
        RecordId: r.id,
        EmployeeCode: r.code,
        EmployeeName: (empByCode.get(r.code)?.name ?? ""),
        UserId: (empByCode.get(r.code)?.user_id ?? ""),
        StartDate: r.start_date,
        EndDate: r.end_date,
        LeaveDays: r.leave_days,
        LeaveType: r.leave_types?.name ?? r.leave_type_id,
        DeductFrom: r.leave_types?.deduct_from ?? "",
        Remarks: r.remarks ?? "",
        CreatedAt: r.created_at,
        UpdatedAt: r.updated_at,
      }));

      const today = new Date().toISOString().slice(0, 10);
      const fname = `leave-records-all-${today}.csv`;
      downloadCsv(rows, fname);
      setInfo(`Exported ${rows.length} record(s) (all records).`);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setExportBusy(false);
    }
  }

  type EmployeeOption = Pick<Employee, "id" | "code" | "name">;
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);


  const [edit, setEdit] = useState<any | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<{ id: string; start_date: string; end_date: string; leave_type: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);


  async function loadEmployees() {
    setLoadingEmployees(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("id, code, name")
        .order("code", { ascending: true });
      if (error) throw error;
      const list = (data ?? []) as EmployeeOption[];
      setEmployees(list);

      // Auto-select first employee if none selected
      if (!code && list.length > 0) {
        setCode(list[0].code);
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoadingEmployees(false);
    }
  }

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setErr(null);
    setInfo(null);
    try {
      if (!code) throw new Error("Please select an employee.");
      const { data: emp, error: empErr } = await supabase.from("employees").select("id, code, name, hiring_date").eq("code", code).single();
      if (empErr) throw empErr;

      setSelectedEmployee({ id: emp.id, code: emp.code, name: emp.name });

      const { data: st, error: stErr } = await supabase
        .from("v_employee_year_status")
        .select("*")
        .eq("employee_id", emp.id)
        .eq("year", year)
        .maybeSingle();
      if (stErr) throw stErr;
      setStatus(st);

      const { data: rec, error: recErr } = await supabase
        .from("leave_records")
        .select("id, start_date, end_date, leave_days, leave_type_id, leave_types(name, deduct_from), remarks")
        .eq("employee_id", emp.id)
        .gte("start_date", `${year}-01-01`)
        .lte("start_date", `${year}-12-31`)
        .order("start_date", { ascending: false });
      if (recErr) throw recErr;
      setRecords(rec as any);
    } catch (e:any) {
      setErr(e?.message ?? String(e));
      setStatus(null);
      setRecords([]);
    }
  }

  async function saveEdit() {
    if (!edit) return;
    setEditBusy(true);
    setErr(null);
    setInfo(null);
    try {
      // Client-side balance guard for Planned / Un-Planned (DB trigger enforces this too).
      const daysInclusive = (start: string, end: string): number => {
        const s = new Date(start);
        const e = new Date(end);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
        const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
        return diff + 1;
      };

      const typeById = new Map<number, LeaveType>();
      for (const t of leaveTypes) typeById.set(Number(t.id), t);
      const getDeductFrom = (typeId: number): "planned" | "unplanned" | "none" => {
        const t = typeById.get(Number(typeId));
        const d = (t?.deduct_from ?? "none") as any;
        return (d === "planned" || d === "unplanned" || d === "none") ? d : "none";
      };

      const y1 = new Date(edit.start_date).getFullYear();
      const y2 = new Date(edit.end_date).getFullYear();
      if (y1 !== y2) throw new Error("Cross-year record is not allowed.");
      if (y1 !== year) throw new Error(`Dates must be inside year ${year}.`);

      const newDays = daysInclusive(edit.start_date, edit.end_date);
      if (newDays <= 0) throw new Error("Invalid dates.");

      // Reconstruct what the remaining would be if we remove the old record, then apply the edited record.
      if (status) {
        const original = records.find((r: any) => r.id === edit.id);
        const oldDays = Number(original?.leave_days ?? 0);
        const oldTypeId = Number(original?.leave_type_id ?? edit.leave_type_id);

        const oldDeduct = (original?.leave_types?.deduct_from as any) ?? getDeductFrom(oldTypeId);
        const newDeduct = getDeductFrom(Number(edit.leave_type_id));

        const basePlannedRemaining = Number(status.remaining_planned_days ?? 0);
        const baseUnplannedRemaining = Number(status.remaining_unplanned_days ?? 0);

        // Add back the old record (since it is already included in remaining), then validate the new one.
        const plannedAvail = basePlannedRemaining + (oldDeduct === "planned" ? oldDays : 0);
        const unplannedAvail = baseUnplannedRemaining + (oldDeduct === "unplanned" ? oldDays : 0);

        if (newDeduct === "planned" && newDays > plannedAvail) {
          throw new Error(`Insufficient planned balance. Requested ${newDays} day(s), remaining ${plannedAvail}.`);
        }
        if (newDeduct === "unplanned" && newDays > unplannedAvail) {
          throw new Error(`Insufficient un-planned balance. Requested ${newDays} day(s), remaining ${unplannedAvail}.`);
        }
      }

      const { error } = await supabase.from("leave_records").update({
        start_date: edit.start_date,
        end_date: edit.end_date,
        leave_type_id: edit.leave_type_id,
        remarks: edit.remarks || null,
      }).eq("id", edit.id);
      if (error) throw error;

      setInfo("Leave record updated.");
      setEdit(null);
      await load();
    } catch (e:any) {
      setErr(e?.message ?? String(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteRecord(id: string) {
    setErr(null);
    setInfo(null);
    const { error } = await supabase.from("leave_records").delete().eq("id", id);
    if (error) throw error;
    setInfo("Leave record deleted.");
    await load();
  }

  function askDelete(r: any) {
    setPendingDelete({
      id: r.id,
      start_date: r.start_date,
      end_date: r.end_date,
      leave_type: r.leave_types?.name ?? "",
    });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    try {
      await deleteRecord(pendingDelete.id);
      setPendingDelete(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="label mb-1">Employee</div>
          <div className="flex gap-2">
            <select
              className="input"
              value={code}
              onChange={(e) => {
                const v = e.target.value;
                setCode(v);
                const found = employees.find((x) => x.code === v);
                setSelectedEmployee(found ? { id: found.id as any, code: found.code as any, name: found.name as any } : null);
              }}
              disabled={loadingEmployees || employees.length === 0}
            >
              <option value="">Select employee…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.code}>
                  {e.code} — {e.name}
                </option>
              ))}
            </select>

            <button
              className="btn-secondary whitespace-nowrap"
              onClick={loadEmployees}
              disabled={loadingEmployees}
              title="Reload employees list"
            >
              {loadingEmployees ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <div>
          <div className="label mb-1">Year</div>
          <input className="input" type="number" value={year} onChange={(e)=>setYear(parseInt(e.target.value||`${currentYear}`,10))} />
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <button className="btn" onClick={load}>Load</button>
          <button className="btn-secondary" onClick={exportCurrentView} disabled={exportBusy || records.length === 0}>
            {exportBusy ? "Exporting…" : "Export view"}
          </button>
          <button className="btn-secondary" onClick={exportAllRecords} disabled={exportBusy}>
            {exportBusy ? "Exporting…" : "Export all"}
          </button>
        </div>
      </div>

      {err && <div className="rounded-xl border border-red-300/60 bg-red-50 dark:bg-red-950/40 dark:border-red-800/60 p-3 text-sm">{err}</div>}
      {info && <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800/60 p-3 text-sm">{info}</div>}

      {status && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-5">
            <div className="text-sm font-semibold">Planned</div>
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">Beginning: <span className="font-semibold">{status.beginning_planned_balance}</span></div>
            <div className="text-sm text-slate-600 dark:text-slate-300">Utilized: <span className="font-semibold">{status.utilized_planned_days}</span></div>
            <div className="mt-2 text-lg font-bold">Remaining: {status.remaining_planned_days}</div>
          </div>
          <div className="card p-5">
            <div className="text-sm font-semibold">Un-Planned</div>
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">Beginning: <span className="font-semibold">{status.beginning_unplanned_balance}</span></div>
            <div className="text-sm text-slate-600 dark:text-slate-300">Utilized: <span className="font-semibold">{status.utilized_unplanned_days}</span></div>
            <div className="mt-2 text-lg font-bold">Remaining: {status.remaining_unplanned_days}</div>
          </div>
          <div className="card p-5">
            <div className="text-sm font-semibold">Other</div>
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">Utilized (non-deducted): <span className="font-semibold">{status.utilized_other_days}</span></div>
          </div>
        </div>
      )}

      <div className="card p-5">
        <h3 className="font-bold">Leave history ({year})</h3>
        <div className="mt-4 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600 dark:text-slate-300">
              <tr>
                <th className="py-2 pr-3">Start</th>
                <th className="py-2 pr-3">End</th>
                <th className="py-2 pr-3">Days</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Remarks</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td className="py-3 text-slate-500 dark:text-slate-400" colSpan={6}>No records.</td></tr>
              ) : (
                records.map((r:any) => (
                  <tr key={r.id} className="border-t border-slate-200/60 dark:border-slate-800/60">
                    <td className="py-2 pr-3">{r.start_date}</td>
                    <td className="py-2 pr-3">{r.end_date}</td>
                    <td className="py-2 pr-3 font-semibold">{r.leave_days}</td>
                    <td className="py-2 pr-3">{r.leave_types?.name}</td>
                    <td className="py-2 pr-3">{r.remarks ?? ""}</td>
                    <td className="py-2 pr-3">
                      <div className="flex gap-2">
                        <button className="btn-secondary" onClick={() => setEdit({ ...r })}>Edit</button>
                        <button className="btn-secondary" onClick={() => askDelete(r)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card p-5 w-full max-w-md">
            <div className="text-lg font-bold">Confirm deletion</div>
            <div className="mt-2 text-sm">Are you sure you want to delete this leave</div>

            <div className="mt-4 rounded-xl border border-slate-200/60 dark:border-slate-800/60 p-3 text-sm">
              <div><span className="font-semibold">Start:</span> {pendingDelete.start_date}</div>
              <div className="mt-1"><span className="font-semibold">End:</span> {pendingDelete.end_date}</div>
              <div className="mt-1"><span className="font-semibold">Type:</span> {pendingDelete.leave_type || "—"}</div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setPendingDelete(null)} disabled={deleteBusy}>No</button>
              <button className="btn" onClick={confirmDelete} disabled={deleteBusy}>{deleteBusy ? "Deleting…" : "Yes"}</button>
            </div>
          </div>
        </div>
      )}


      {edit && (
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <h4 className="font-bold">Edit leave</h4>
            <button className="btn-secondary" onClick={() => setEdit(null)}>Close</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
            <div>
              <div className="label mb-1">Start</div>
              <input className="input" type="date" value={edit.start_date} onChange={(e)=>setEdit({ ...edit, start_date: e.target.value })} />
            </div>
            <div>
              <div className="label mb-1">End</div>
              <input className="input" type="date" value={edit.end_date} onChange={(e)=>setEdit({ ...edit, end_date: e.target.value })} />
            </div>
            <div>
              <div className="label mb-1">Leave type</div>
              {leaveTypes.length > 0 ? (
                <select
                  className="input"
                  value={String(edit.leave_type_id ?? "")}
                  onChange={(e) => setEdit({ ...edit, leave_type_id: parseInt(e.target.value, 10) })}
                >
                  {leaveTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  type="number"
                  value={edit.leave_type_id}
                  onChange={(e) => setEdit({ ...edit, leave_type_id: parseInt(e.target.value || "0", 10) })}
                />
              )}
            </div>
            <div>
              <div className="label mb-1">Remarks</div>
              <input className="input" value={edit.remarks ?? ""} onChange={(e)=>setEdit({ ...edit, remarks: e.target.value })} />
            </div>
          </div>

          <div className="mt-4">
            <button className="btn" disabled={editBusy} onClick={saveEdit}>{editBusy ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminResetPassword() {
  const [employees, setEmployees] = useState<Array<Pick<Employee, "id" | "code" | "name" | "user_id">>>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [newPass, setNewPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function loadEmployees() {
    setLoadingEmployees(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("id, code, name, user_id")
        .order("code", { ascending: true });
      if (error) throw error;

      const list = (data ?? []) as Array<Pick<Employee, "id" | "code" | "name" | "user_id">>;
      setEmployees(list);

      // Auto-select first employee if none selected
      if (!selectedUserId && list.length > 0) {
        setSelectedUserId(list[0].user_id);
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoadingEmployees(false);
    }
  }

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reset() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      if (!selectedUserId) throw new Error("Please select an employee.");
      if (!newPass || newPass.length < 6) throw new Error("Password must be at least 6 characters.");

      const { data: sess } = await supabase.auth.getSession();
      const jwt = sess.session?.access_token;
      if (!jwt) throw new Error("No session");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-reset-password`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${jwt}`,
        },
        body: JSON.stringify({ user_id: selectedUserId, new_password: newPass }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as any).error || "Failed");

      setMsg("Password updated.");
      setNewPass("");
    } catch (e:any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-600 dark:text-slate-300">
        Reset an employee's login password (Admin only).
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="label mb-1">Employee</div>
          <div className="flex gap-2">
            <select
              className="input"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              disabled={loadingEmployees || employees.length === 0}
            >
              {employees.length === 0 ? (
                <option value="">No employees found</option>
              ) : (
                employees.map((e) => (
                  <option key={e.id} value={e.user_id}>
                    {e.code} — {e.name}
                  </option>
                ))
              )}
            </select>

            <button
              className="btn-secondary whitespace-nowrap"
              onClick={loadEmployees}
              disabled={loadingEmployees}
              title="Reload employees list"
            >
              {loadingEmployees ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Select an employee, then set a new password.
          </div>
        </div>

        <div>
          <div className="label mb-1">New password (min 6)</div>
          <input className="input" type="password" value={newPass} onChange={(e)=>setNewPass(e.target.value)} />
        </div>
      </div>

      {err && <div className="rounded-xl border border-red-300/60 bg-red-50 dark:bg-red-950/40 dark:border-red-800/60 p-3 text-sm">{err}</div>}
      {msg && <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800/60 p-3 text-sm">{msg}</div>}

      <button className="btn" disabled={busy || loadingEmployees || employees.length===0} onClick={reset}>
        {busy ? "Updating…" : "Update password"}
      </button>
    </div>
  );
}

