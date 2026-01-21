
export type RoleName = "Admin" | "User";

export type Employee = {
  id: string;
  auth_user_id: string | null;
  code: string;
  name: string;
  user_id: string;
  hiring_date: string;
  planned_annual_balance: number;
  unplanned_annual_balance: number;
  roles?: { name: RoleName } | null;
};

export type LeaveType = { id: number; name: string; deduct_from: "planned" | "unplanned" | "none" };

export type LeaveRecord = {
  id: string;
  employee_id: string;
  code: string;
  start_date: string;
  end_date: string;
  leave_days: number;
  leave_type_id: number;
  remarks: string | null;
  leave_types?: { name: string; deduct_from: "planned" | "unplanned" | "none" } | null;
};

export type YearStatus = {
  employee_id: string;
  code: string;
  name: string;
  hiring_date: string;
  year: number;
  beginning_planned_balance: number;
  beginning_unplanned_balance: number;
  utilized_planned_days: number;
  utilized_unplanned_days: number;
  remaining_planned_days: number;
  remaining_unplanned_days: number;
  utilized_other_days: number;
};
