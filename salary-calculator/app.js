"use strict";

// Page access is restricted to portal admins by ensureAuth in index.html.

function $(id) { return document.getElementById(id); }

document.addEventListener("DOMContentLoaded", () => {
  initCalculatorBindings();
});

const OVERTIME_MULTIPLIER = 1.5;
const HOURS_PER_DAY = 8;

// Social insurance (employee insurable wage base) accepted range.
// Requirement: any value outside this range must show an error and stop calculation.
// These are fallbacks only: the real values come from the tracker's
// Settings page (app_settings si_wage_min / si_wage_max), loaded by
// loadSalarySettings() once the user is signed in.
let INSURABLE_BASE_MIN = 5500;
let INSURABLE_BASE_MAX = 16700;

// Annual progressive tax table. Fallback copy of the default table on the
// Settings page (app_settings salary_tax_brackets), replaced on load.
//   up_to           top of the bracket, null on the last (no limit)
//   rate            percent charged inside the bracket
//   all_from_above  when annual taxable income is above this, every
//                   earlier bracket is charged at this bracket's rate
let TAX_BRACKETS = [
  { up_to: 40000, rate: 0, all_from_above: null },
  { up_to: 55000, rate: 10, all_from_above: 600000 },
  { up_to: 70000, rate: 15, all_from_above: 700000 },
  { up_to: 200000, rate: 20, all_from_above: 800000 },
  { up_to: 400000, rate: 22.5, all_from_above: 900000 },
  { up_to: 1200000, rate: 25, all_from_above: 1200000 },
  { up_to: null, rate: 27.5, all_from_above: null }
];

let salarySettingsState = "loading"; // loading | ready | fallback

// Default parameters (not user-editable in UI)
const DEFAULT_EMPLOYEE_SI_RATE_PCT = 11;
const DEFAULT_COMPANY_SI_RATE_PCT = 18.75;
const DEFAULT_PERSONAL_EXEMPTION_ANNUAL = 20000;


let calculatorBindingsInitialized = false;

const CAP_TABLE = {
  2024: { min: 2000, max: 12600 },
  2025: { min: 2300, max: 14500 },
  2026: { min: 2700, max: 16700 },
  2027: { min: 3200, max: 19300 }
};


function parseNumber(v) {
  if (v == null) return NaN;
  const s = String(v).trim().replace(/,/g, "");
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function clamp(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi);
}

function fmtEGP(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " EGP";
}

function fmtNumber(n, maximumFractionDigits = 2) {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { maximumFractionDigits });
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function formatInputThousands(id, maximumFractionDigits = 2) {
  const el = $(id);
  if (!el) return;
  const raw = String(el.value ?? "").trim();
  if (raw === "") return;
  const n = parseNumber(raw);
  if (!Number.isFinite(n)) return;
  el.value = fmtNumber(n, maximumFractionDigits);
}

function wireThousandsSeparators() {
  // Amount-like fields
  const amountFields = [
    "basicGross",
    "solveTargetNet",
    "solveAllowances",
    "solveInsurableBase",
        "allowances",
    "incentive",
    "bonus",
    "salaryAdjustment",
    "medicalInsurance",
    "advanceLoan",
    "insurableBase"
  ];

  // Rate / hours fields (still formatted, but typically won't show separators)
  const otherFields = [
    "overtimeHours",
    "deductionHours",
    "deductionDays",
    "penaltiesDays"
  ];

  [...amountFields, ...otherFields].forEach((id) => {
    const el = $(id);
    if (!el) return;

    // Format when leaving the field to avoid cursor jump while typing.
    el.addEventListener("blur", () => {
      const mfd = 2;
      formatInputThousands(id, mfd);
    });
  });

  // Format defaults immediately (e.g., personal exemption).
  amountFields.forEach((id) => {
    const mfd = 2;
    formatInputThousands(id, mfd);
  });
}

/**
 * Annual progressive salary tax from TAX_BRACKETS (Settings page table).
 *
 * Standard case: each bracket's slice of income is charged at its rate.
 * Relief removal: find the LAST bracket whose all_from_above the income
 * exceeds; everything up to that bracket's top is then charged at its
 * rate, and the brackets after it as normal. With the default table this
 * reproduces the Egyptian rules exactly (e.g. above 1.2M: 25% of the first
 * 1.2M plus 27.5% above).
 */
function calcAnnualTaxEG(annualTaxableIncome) {
  const I = Math.max(0, Number(annualTaxableIncome) || 0);
  const brackets = TAX_BRACKETS;
  if (!brackets.length) return 0;

  let merged = -1;
  brackets.forEach((b, i) => {
    if (b.all_from_above != null && I > Number(b.all_from_above)) merged = i;
  });

  let tax = 0;
  let from = 0;
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    const top = b.up_to == null ? Infinity : Number(b.up_to);
    if (i < merged) { from = top; continue; }
    const lo = i === merged ? 0 : from;
    if (I > lo) tax += (Math.min(I, top) - lo) * (Number(b.rate) / 100);
    from = top;
    if (I <= top) break;
  }
  return tax;
}

function validateNonNegative(name, n, errs) {
  if (!Number.isFinite(n)) errs.push(`${name} is not a valid number.`);
  else if (n < 0) errs.push(`${name} must be 0 or more.`);
}

function validateMin(name, n, min, errs) {
  if (!Number.isFinite(n)) return;
  if (n < min) errs.push(`${name} must be at least ${min.toLocaleString("en-US")} EGP.`);
}

function validateMax(name, n, max, errs) {
  if (!Number.isFinite(n)) return;
  if (n > max) errs.push(`${name} must be at most ${max.toLocaleString("en-US")} EGP.`);
}

function validateRangeInclusive(name, n, min, max, errs) {
  if (!Number.isFinite(n)) return;
  if (n < min || n > max) {
    errs.push(`${name} must be between ${min.toLocaleString("en-US")} and ${max.toLocaleString("en-US")} EGP.`);
  }
}

function showErrors(errs) {
  const boxes = [$("errorsTop"), $("errors")].filter(Boolean);

  if (!errs.length) {
    boxes.forEach((box) => {
      box.hidden = true;
      box.innerHTML = "";
    });
    return;
  }

  const html = "<strong>Please fix:</strong><ul>" + errs.map(e => `<li>${e}</li>`).join("") + "</ul>";
  boxes.forEach((box) => {
    box.hidden = false;
    box.innerHTML = html;
  });

  // Bring the message into view (especially helpful on long pages)
  const topBox = $("errorsTop") || $("errors");
  try { topBox.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
}

function clearResults() {
  [
    "grossBeforeDeductions","grossMonthly","siMonthly","taxableMonthly","taxesAndFundsMonthly","advanceMonthly","netMonthly",
    "grossAnnual","grossAfterMedicalAnnual","insurableUsed","siAnnual","taxableAnnual","taxesAndFundsAnnual",
    "hourlyRate","overtimeValue","hourDeductionValue","dayDeductionValue","penaltiesValue",
    "companySiMonthly", "totalCostExcludingTransportation"
  ].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = "—";
  });
}


function calculate() {
  const errs = [];

  const basicGross = parseNumber($("basicGross").value);
  const allowances = parseNumber($("allowances").value);
  const incentive = parseNumber($("incentive").value);
  const bonus = parseNumber($("bonus").value);
  const salaryAdjustment = parseNumber($("salaryAdjustment").value);

  const overtimeHours = parseNumber($("overtimeHours").value);
  const deductionHours = parseNumber($("deductionHours").value);
  const deductionDays = parseNumber($("deductionDays").value);
  const penaltiesDays = parseNumber($("penaltiesDays").value);

  const medicalInsurance = parseNumber($("medicalInsurance").value);
  const advanceLoan = parseNumber($("advanceLoan").value);

  const insurableBase = parseNumber($("insurableBase").value);

  validateNonNegative("Basic gross salary", basicGross, errs);
  validateMin("Basic gross salary", basicGross, 5500, errs);
  validateNonNegative("Allowances", allowances, errs);
  validateNonNegative("Incentive", incentive, errs);
  validateNonNegative("Bonus", bonus, errs);
  if (!Number.isFinite(salaryAdjustment)) errs.push("Salary adjustment is not a valid number.");

  validateNonNegative("Overtime hours", overtimeHours, errs);
  if (!Number.isFinite(deductionHours)) errs.push("Deduction hours is not a valid number.");
  validateNonNegative("Deduction days", deductionDays, errs);
  validateNonNegative("Penalties days", penaltiesDays, errs);

  validateNonNegative("Medical insurance", medicalInsurance, errs);
  validateNonNegative("Advance salary loan", advanceLoan, errs);

  validateNonNegative("S.I. Basic wage", insurableBase, errs);
  // Insurable base must be strictly within the allowed band; do NOT auto-clamp.
  validateRangeInclusive("S.I. Basic wage", insurableBase, INSURABLE_BASE_MIN, INSURABLE_BASE_MAX, errs);
  const siRatePct = DEFAULT_EMPLOYEE_SI_RATE_PCT;
  const companySiRatePct = DEFAULT_COMPANY_SI_RATE_PCT;
  const personalExemption = DEFAULT_PERSONAL_EXEMPTION_ANNUAL;


  if (errs.length) {
    clearResults();
    showErrors(errs);

    // Focus the most relevant field
    if (!Number.isFinite(basicGross) || basicGross < 5500) {
      try { $("basicGross").focus(); } catch (_) {}
    } else if (!Number.isFinite(insurableBase) || insurableBase < INSURABLE_BASE_MIN || insurableBase > INSURABLE_BASE_MAX) {
      try { $("insurableBase").focus(); } catch (_) {}
    }
    return;
  }

  const hourlyRate = basicGross / 240.0;
  const overtimeValueMonthly = overtimeHours * hourlyRate * OVERTIME_MULTIPLIER;
  const hourDeductionValueMonthly = deductionHours * hourlyRate;
  const dayDeductionValueMonthly = deductionDays * HOURS_PER_DAY * hourlyRate;
  const penaltiesValueMonthly = penaltiesDays * HOURS_PER_DAY * hourlyRate;

  // Gross before deductions includes salary adjustment and all earnings.
  // Requirement: exclude deductions (hour deductions, medical, SI, tax, etc.).
  const grossBeforeDeductionsMonthly = basicGross + allowances + incentive + bonus + salaryAdjustment + overtimeValueMonthly;

  // Gross before medical (gross earnings)
  const grossMonthly = grossBeforeDeductionsMonthly - hourDeductionValueMonthly - dayDeductionValueMonthly - penaltiesValueMonthly;

  // Deduct medical BEFORE tax & martyrs base
  const grossAfterMedicalMonthly = grossMonthly - medicalInsurance;

  if (grossAfterMedicalMonthly < 0) {
    clearResults();
    showErrors(["Gross after deductions became negative. Please review deductions, penalties and medical insurance."]);
    try { $('medicalInsurance').focus(); } catch (_) {}
    return;
  }

    const insurableUsed = insurableBase;
  const siRate = siRatePct / 100.0;
  const siMonthly = insurableUsed * siRate;

  const companySiRate = companySiRatePct / 100.0;
  const companySiMonthly = insurableUsed * companySiRate;

  // Taxable salary: gross after deductions minus employee SI share
  const taxableMonthly = grossAfterMedicalMonthly - siMonthly;

  // Martyrs deduction based on gross AFTER medical
  const martyrsMonthly = grossAfterMedicalMonthly * 0.0005;

  const grossAnnual = grossMonthly * 12;
  const grossAfterMedicalAnnual = grossAfterMedicalMonthly * 12;

  const siAnnual = siMonthly * 12;
  const companySiAnnual = companySiMonthly * 12;

  const medicalAnnual = medicalInsurance * 12;
  const martyrsAnnual = martyrsMonthly * 12;
  const advanceAnnual = advanceLoan * 12;

  // Taxable income: Gross after deductions (annual) minus employee SI (annual) minus personal exemption.
  // Requirement: taxable salary = Gross after deductions (annual) - Employee SI (annual) - 20,000.
  const taxableAnnual = Math.max(0, (grossAfterMedicalAnnual - siAnnual - personalExemption));
  const taxAnnualRaw = calcAnnualTaxEG(taxableAnnual);
  const taxAnnual = Number.isFinite(taxAnnualRaw) ? taxAnnualRaw : 0;
  const taxMonthly = taxAnnual / 12;

  // Employer total cost excluding transportation (monthly):
  // Displayed gross after deductions + company SI contribution.
  // Gross includes hour/day deductions, penalties and medical insurance.
  // Note: Taxes are excluded per requirement.
  const totalCostExcludingTransportationMonthly = grossAfterMedicalMonthly + companySiMonthly;

  // Net pay is calculated AFTER tax and martyrs; advance loan is a final net-pay deduction.
  const netBeforeLoan = grossMonthly - medicalInsurance - siMonthly - taxMonthly - martyrsMonthly;
  const netMonthly = netBeforeLoan - advanceLoan;

  showErrors([]);

  // Show gross AFTER deductions in the KPI area
  setText("grossBeforeDeductions", fmtEGP(grossBeforeDeductionsMonthly));
  setText("grossMonthly", fmtEGP(grossAfterMedicalMonthly));
setText("siMonthly", fmtEGP(siMonthly));
setText("taxableMonthly", fmtEGP(taxableMonthly));
setText("taxesAndFundsMonthly", fmtEGP(taxMonthly + martyrsMonthly));
setText("advanceMonthly", fmtEGP(advanceLoan));
setText("netMonthly", fmtEGP(netMonthly));

setText("grossAnnual", fmtEGP(grossAnnual));
setText("grossAfterMedicalAnnual", fmtEGP(grossAfterMedicalAnnual));

setText("insurableUsed", fmtEGP(insurableUsed));

setText("siAnnual", fmtEGP(siAnnual));

setText("taxableAnnual", fmtEGP(taxableAnnual));
setText("taxesAndFundsAnnual", fmtEGP(taxAnnual + martyrsAnnual));

setText("hourlyRate", fmtEGP(hourlyRate));
setText("overtimeValue", fmtEGP(overtimeValueMonthly));
setText("hourDeductionValue", fmtEGP(hourDeductionValueMonthly));
setText("dayDeductionValue", fmtEGP(dayDeductionValueMonthly));
setText("penaltiesValue", fmtEGP(penaltiesValueMonthly));

setText("companySiMonthly", fmtEGP(companySiMonthly));
setText("totalCostExcludingTransportation", fmtEGP(totalCostExcludingTransportationMonthly));
}


function computeNetMonthlyForBasicGross(basicGross, p) {
  const hourlyRate = basicGross / 240.0;
  const overtimeValueMonthly = p.overtimeHours * hourlyRate * OVERTIME_MULTIPLIER;
  const hourDeductionValueMonthly = p.deductionHours * hourlyRate;

  const grossMonthly = basicGross + p.allowances + p.incentive + p.bonus + overtimeValueMonthly - hourDeductionValueMonthly;
  const grossAfterMedicalMonthly = grossMonthly - p.medicalInsurance;

  if (grossAfterMedicalMonthly < 0) {
    return { ok: false, reason: "Gross after deductions became negative. Please review deductions, penalties and medical insurance." };
  }

  const insurableUsed = p.insurableBase;
  const siMonthly = insurableUsed * (DEFAULT_EMPLOYEE_SI_RATE_PCT / 100.0);

  const martyrsMonthly = grossAfterMedicalMonthly * 0.0005;

  const grossAnnual = grossMonthly * 12;
  const grossAfterMedicalAnnual = grossAfterMedicalMonthly * 12;
  const siAnnual = siMonthly * 12;

  // Taxable income follows the same rule as the forward calculator.
  const taxableAnnual = Math.max(0, (grossAfterMedicalAnnual - siAnnual - DEFAULT_PERSONAL_EXEMPTION_ANNUAL));
  const taxAnnualRaw = calcAnnualTaxEG(taxableAnnual);
  const taxAnnual = Number.isFinite(taxAnnualRaw) ? taxAnnualRaw : 0;
  const taxMonthly = taxAnnual / 12;

  const netBeforeLoan = grossMonthly - p.medicalInsurance - siMonthly - taxMonthly - martyrsMonthly;
  const netMonthly = netBeforeLoan - p.advanceLoan;

  return { ok: true, netMonthly, taxMonthly, martyrsMonthly, siMonthly, grossMonthly, grossAfterMedicalMonthly };
}

function showErrorsIn(containerId, messages) {
  const box = $(containerId);
  if (!box) return;
  if (!messages || !messages.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = "<ul>" + messages.map((m) => `<li>${m}</li>`).join("") + "</ul>";
}

function solveBasicGrossSection() {
  const errs = [];

  const targetNet = parseNumber($("solveTargetNet").value);
  const allowances = parseNumber($("solveAllowances").value);
  const insurableBase = parseNumber($("solveInsurableBase").value);

  validateNonNegative("Target net salary", targetNet, errs);
  validateNonNegative("Allowances", allowances, errs);
  validateNonNegative("S.I. Basic wage", insurableBase, errs);
  validateRangeInclusive("S.I. Basic wage", insurableBase, INSURABLE_BASE_MIN, INSURABLE_BASE_MAX, errs);

  if (errs.length) {
    $("solveOutBasicGross").value = "";
    $("solveOutTaxesAndFunds").value = "";
    $("solveOutNet").value = "";
    showErrorsIn("errorsSolve", errs);
    return;
  }

  showErrorsIn("errorsSolve", []);

  const p = {
    allowances,
    incentive: 0,
    bonus: 0,
    overtimeHours: 0,
    deductionHours: 0,
    medicalInsurance: 0,
    advanceLoan: 0,
    insurableBase
  };

  // Enforce the same minimum basic gross salary rule used by the forward calculator.
  const MIN_BASIC_GROSS = 5500;

  // We solve for the BASIC gross salary that produces a total net paid equal to:
  // (Target net salary + Allowances).
  // This matches the requirement that the basic gross net after deductions equals the sum of target net and allowances.
  const targetNetTotal = targetNet + allowances;

  let low = MIN_BASIC_GROSS;
  let high = Math.max(20000, targetNetTotal * 2 + 50000);

  const lowRes = computeNetMonthlyForBasicGross(low, p);
  if (!lowRes.ok) {
    showErrorsIn("errorsSolve", [lowRes.reason]);
    return;
  }
  if (targetNetTotal < MIN_BASIC_GROSS) {
    showErrorsIn("errorsSolve", [
      `Target net salary is too low. The sum of target net salary and allowances must be at least ${MIN_BASIC_GROSS.toLocaleString("en-US")} EGP.`
    ]);
    return;
  }

  // Increase upper bound until we bracket the target.
  let highRes = computeNetMonthlyForBasicGross(high, p);
  let guard = 0;
  while ((highRes.ok && highRes.netMonthly < targetNetTotal) && high < 5000000 && guard < 40) {
    high *= 1.5;
    highRes = computeNetMonthlyForBasicGross(high, p);
    guard += 1;
  }
  if (!highRes.ok) {
    showErrorsIn("errorsSolve", [highRes.reason]);
    return;
  }
  if (highRes.netMonthly < targetNetTotal) {
    showErrorsIn("errorsSolve", [
      "Unable to solve: target net salary is too high given the current assumptions. Please review allowances or try a lower net."
    ]);
    return;
  }

  // Higher-accuracy solve:
  // Search on 0.01 EGP steps (piastres) and pick the closest match to the target net.
  // This eliminates drift that can appear when we later format the basic gross for display.

  const toCents = (x) => Math.round(x * 100);
  const fromCents = (c) => c / 100;

  let lo = toCents(low);
  let hi = toCents(high);

  for (let i = 0; i < 120 && lo < hi; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const res = computeNetMonthlyForBasicGross(fromCents(mid), p);
    if (!res.ok) {
      showErrorsIn("errorsSolve", [res.reason]);
      return;
    }
    if (res.netMonthly < targetNetTotal) lo = mid + 1;
    else hi = mid;
  }

  const candidates = [];
  const window = 500; // +/- 5.00 EGP
  const start = Math.max(toCents(MIN_BASIC_GROSS), lo - window);
  const end = lo + window;
  for (let c = start; c <= end; c++) {
    const g = fromCents(c);
    const r = computeNetMonthlyForBasicGross(g, p);
    if (r.ok) candidates.push({ g, ...r, diff: Math.abs(r.netMonthly - targetNetTotal) });
  }

  if (!candidates.length) {
    showErrorsIn("errorsSolve", ["Unable to solve due to invalid intermediate values."]);
    return;
  }

  candidates.sort((a, b) => a.diff - b.diff || a.g - b.g);
  const best = candidates[0];

  $("solveOutBasicGross").value = fmtNumber(best.g, 2);
  $("solveOutTaxesAndFunds").value = fmtNumber(best.taxMonthly + best.martyrsMonthly, 2);
  $("solveOutNet").value = fmtNumber(best.netMonthly, 2);
}



function resetForm() {
  $("basicGross").value = "";  $("allowances").value = "";
  $("incentive").value = "";
  $("bonus").value = "";
  $("salaryAdjustment").value = "";

  $("overtimeHours").value = "";
  $("deductionHours").value = "";
  $("deductionDays").value = "";
  $("penaltiesDays").value = "";

  $("medicalInsurance").value = "";
  $("advanceLoan").value = "";

  $("insurableBase").value = "";

  // Reset Basic Gross from Net section
  $("solveTargetNet").value = "";
  $("solveInsurableBase").value = "";
  $("solveAllowances").value = "";
  $("solveOutBasicGross").value = "";
  $("solveOutTaxesAndFunds").value = "";
  $("solveOutNet").value = "";


  clearResults();
  showErrorsIn("errorsSolve", []);
  applySiRangeToFields();

  showErrors([]);

}

function siRangeText() {
  return `${INSURABLE_BASE_MIN.toLocaleString("en-US")} – ${INSURABLE_BASE_MAX.toLocaleString("en-US")}`;
}

/** Show the S.I. wage range from Settings on both S.I. fields. */
function applySiRangeToFields() {
  ["insurableBase", "solveInsurableBase"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.placeholder = `${siRangeText()} (e.g. ${Math.max(INSURABLE_BASE_MIN, Math.min(6000, INSURABLE_BASE_MAX)).toLocaleString("en-US")})`;
    const hint = el.parentElement && el.parentElement.querySelector(".hint");
    if (hint) {
      hint.textContent = `Must be between ${INSURABLE_BASE_MIN.toLocaleString("en-US")} and ${INSURABLE_BASE_MAX.toLocaleString("en-US")} (from Settings).`;
    }
    checkSiField(el);
  });
}

/** Mark an S.I. field red while its value is outside the allowed range. */
function checkSiField(el) {
  const raw = String(el.value ?? "").trim();
  const n = parseNumber(raw);
  const bad = raw !== "" && (!Number.isFinite(n) || n < INSURABLE_BASE_MIN || n > INSURABLE_BASE_MAX);
  el.classList.toggle("invalid", bad);
  el.setAttribute("aria-invalid", bad ? "true" : "false");
}

function setCalcButtonsEnabled(on) {
  ["btnCalc", "btnSolveGross"].forEach((id) => {
    const b = $(id);
    if (b) b.disabled = !on;
  });
}

/**
 * Load the tax table and S.I. wage limits from the Settings page.
 * Called once the user is signed in. Until it finishes the Calculate
 * buttons are disabled, so no result is ever worked out from stale
 * numbers. If it fails, the built-in defaults are used and a note says so.
 */
async function loadSalarySettings() {
  setCalcButtonsEnabled(false);
  const note = $("settingsNote");
  try {
    const supabase = await window.IEnergyAuth.getClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["salary_tax_brackets", "si_wage_min", "si_wage_max"]);
    if (error) throw error;
    const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));

    const min = Number(map.si_wage_min);
    const max = Number(map.si_wage_max);
    if (Number.isFinite(min) && min > 0) INSURABLE_BASE_MIN = min;
    if (Number.isFinite(max) && max > INSURABLE_BASE_MIN) INSURABLE_BASE_MAX = max;

    const b = map.salary_tax_brackets;
    if (Array.isArray(b) && b.length && b.every((x) => x && Number.isFinite(Number(x.rate)))) {
      TAX_BRACKETS = b.map((x) => ({
        up_to: x.up_to == null ? null : Number(x.up_to),
        rate: Number(x.rate),
        all_from_above: x.all_from_above == null ? null : Number(x.all_from_above)
      }));
    }
    salarySettingsState = "ready";
    if (note) note.hidden = true;
  } catch (err) {
    salarySettingsState = "fallback";
    if (note) {
      note.hidden = false;
      note.textContent = "Could not load the salary tax settings; using the built-in 2026 table and S.I. range " + siRangeText() + ".";
    }
  } finally {
    applySiRangeToFields();
    setCalcButtonsEnabled(true);
  }
}
window.loadSalarySettings = loadSalarySettings;

function initCalculatorBindings() {
  if (calculatorBindingsInitialized) return;
  calculatorBindingsInitialized = true;
  const btnCalc = $("btnCalc");  const btnReset = $("btnReset");
  const btnSolveGross = $("btnSolveGross");
  if (btnCalc) btnCalc.addEventListener("click", calculate);  if (btnReset) btnReset.addEventListener("click", resetForm);
  if (btnSolveGross) btnSolveGross.addEventListener("click", solveBasicGrossSection);

  // Apply thousands separators to all numeric inputs.
  wireThousandsSeparators();

  // S.I. fields go red as soon as they hold a wage outside the range.
  ["insurableBase", "solveInsurableBase"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => checkSiField(el));
    el.addEventListener("blur", () => checkSiField(el));
  });
  applySiRangeToFields();
  setCalcButtonsEnabled(false);

  // Enter-to-calc handlers (includes all inputs)
  [
    "basicGross","allowances","incentive","bonus","salaryAdjustment",
    "overtimeHours","deductionHours","deductionDays","penaltiesDays",
    "medicalInsurance","advanceLoan",
    "insurableBase",
    "solveTargetNet","solveInsurableBase","solveAllowances"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if ($("btnCalc") && $("btnCalc").disabled) return;
        calculate();
      }
    });
  });
}
