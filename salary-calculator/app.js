"use strict";

const PASSWORD = "iEnergy";
const AUTH_KEY = "salary_calc_authed_v1";
const AUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes

let headerLogoHandlersBound = false;

function syncHeaderLogoHeight() {
  const text = $("headerText");
  const logo = $("headerLogo");
  if (!text || !logo) return;

  // If the app is hidden, layout metrics will be zero.
  const rect = text.getBoundingClientRect();
  const h = Math.round(rect.height);
  if (h > 0) {
    logo.style.height = `${h}px`;
    // Fixed width as requested; keep aspect ratio inside the box.
    logo.style.width = "312px";
  }
}

function $(id) { return document.getElementById(id); }

function showAuthError(show) {
  const el = $("authError");
  if (!el) return;
  el.hidden = !show;
}

function lockApp() {
  sessionStorage.removeItem(AUTH_KEY);
  const auth = $("auth");
  const app = $("app");
  if (app) app.hidden = true;
  if (auth) auth.style.display = "grid";
  const input = $("passwordInput");
  if (input) { input.value = ""; input.focus(); }
}

let lockTimer = null;

function unlockApp() {
  const auth = $("auth");
  const app = $("app");
  if (auth) auth.style.display = "none";
  if (app) app.hidden = false;
  initCalculatorBindings();

  // Match the header logo height to the combined height of the title + sentence.
  syncHeaderLogoHeight();
  if (!headerLogoHandlersBound) {
    headerLogoHandlersBound = true;
    window.addEventListener("resize", () => {
      // Defer to allow layout to settle after resize.
      requestAnimationFrame(syncHeaderLogoHeight);
    });
    const logo = $("headerLogo");
    if (logo && !logo.complete) {
      logo.addEventListener("load", () => requestAnimationFrame(syncHeaderLogoHeight), { once: true });
    }
  }
  const expRaw = sessionStorage.getItem(AUTH_KEY);
  const exp = expRaw ? Number(expRaw) : NaN;
  if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
  if (Number.isFinite(exp)) {
    const remaining = exp - Date.now();
    if (remaining > 0) {
      lockTimer = setTimeout(lockApp, remaining);
    } else {
      lockApp();
    }
  }

}

function handleLogin() {
  const input = $("passwordInput");
  const pwd = input ? input.value : "";
  if (pwd === PASSWORD) {
    sessionStorage.setItem(AUTH_KEY, String(Date.now() + AUTH_TTL_MS));
    showAuthError(false);
    unlockApp();
  } else {
    showAuthError(true);
    if (input) input.focus();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const expRaw = sessionStorage.getItem(AUTH_KEY);
  const exp = expRaw ? Number(expRaw) : NaN;
  const already = Number.isFinite(exp) && exp > Date.now();
  const btn = $("btnLogin");
  const input = $("passwordInput");

  if (btn) btn.addEventListener("click", handleLogin);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleLogin();
      }
    });
    // focus on load
    setTimeout(() => input.focus(), 50);
  }

  if (already) {
    unlockApp();
  } else {
    sessionStorage.removeItem(AUTH_KEY);

    // clear any expired token
    sessionStorage.removeItem(AUTH_KEY);

    // Ensure app is hidden until authenticated
    const app = $("app");
    if (app) app.hidden = true;
  }
});

const OVERTIME_MULTIPLIER = 1.5;

// Social insurance (employee insurable wage base) accepted range.
// Requirement: any value outside this range must show an error and stop calculation.
const INSURABLE_BASE_MIN = 5500;
const INSURABLE_BASE_MAX = 16700;

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
    "medicalInsurance",
    "advanceLoan",
    "insurableBase"
  ];

  // Rate / hours fields (still formatted, but typically won't show separators)
  const otherFields = [
    "overtimeHours",
    "deductionHours"
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
 * Annual progressive tax template (Egypt-style bracket structure).
 * IMPORTANT: This is a template; validate against your payroll rules.
 */
function calcAnnualTaxEG(annualTaxableIncome) {
  // Annual progressive salary tax (Egypt-style structure).
  // Brackets (annual taxable):
  // - 0% up to 40,000
  // - 10% 40,001–55,000
  // - 15% 55,001–70,000
  // - 20% 70,001–200,000
  // - 22.5% 200,001–400,000
  // - 25% 400,001–1,200,000
  // - 27.5% above 1,200,000
  //
  // For higher income bands (above 600k/700k/800k/900k), Egyptian payroll practice often
  // removes certain lower-band reliefs. The piecewise cases below model that so results
  // match common payroll calculators.

  const I = Math.max(0, Number(annualTaxableIncome) || 0);

  // Standard-table constants (<= 600k)
  const T_10 = 15000 * 0.10;        // 40k–55k
  const T_15 = 15000 * 0.15;        // 55k–70k
  const T_20 = 130000 * 0.20;       // 70k–200k
  const T_225 = 200000 * 0.225;     // 200k–400k
  const T_BASE_400 = T_10 + T_15 + T_20 + T_225; // tax up to 400k (standard)

  if (I > 1200000) {
    // 25% of first 1.2M + 27.5% above
    return 300000 + (I - 1200000) * 0.275;
  }

  if (I > 900000) {
    // 22.5% up to 400k, then 25% above
    return (400000 * 0.225) + (I - 400000) * 0.25;
  }

  if (I > 800000) {
    // 20% up to 200k, 22.5% to 400k, then 25% above
    return (200000 * 0.20) + (200000 * 0.225) + (I - 400000) * 0.25;
  }

  if (I > 700000) {
    // 15% up to 70k, 20% to 200k, 22.5% to 400k, then 25% above
    return (70000 * 0.15) + (130000 * 0.20) + (200000 * 0.225) + (I - 400000) * 0.25;
  }

  if (I > 600000) {
    // 10% up to 55k, 15% to 70k, 20% to 200k, 22.5% to 400k, then 25% above
    return (55000 * 0.10) + (15000 * 0.15) + (130000 * 0.20) + (200000 * 0.225) + (I - 400000) * 0.25;
  }

  // Standard table (<= 600k)
  if (I <= 40000) return 0;
  if (I <= 55000) return (I - 40000) * 0.10;
  if (I <= 70000) return T_10 + (I - 55000) * 0.15;
  if (I <= 200000) return T_10 + T_15 + (I - 70000) * 0.20;
  if (I <= 400000) return T_10 + T_15 + T_20 + (I - 200000) * 0.225;

  // 400k–600k
  return T_BASE_400 + (I - 400000) * 0.25;
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
    "grossMonthly","siMonthly","taxMonthly","martyrsMonthly","advanceMonthly","netMonthly",
    "grossAnnual","grossAfterMedicalAnnual","insurableUsed","siAnnual","companySiAnnual","taxableAnnual","taxAnnual",
    "hourlyRate","overtimeValue","hourDeductionValue"
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

  const overtimeHours = parseNumber($("overtimeHours").value);
  const deductionHours = parseNumber($("deductionHours").value);

  const medicalInsurance = parseNumber($("medicalInsurance").value);
  const advanceLoan = parseNumber($("advanceLoan").value);

  const insurableBase = parseNumber($("insurableBase").value);

  validateNonNegative("Basic gross salary", basicGross, errs);
  validateMin("Basic gross salary", basicGross, 5500, errs);
  validateNonNegative("Allowances", allowances, errs);
  validateNonNegative("Incentive", incentive, errs);
  validateNonNegative("Bonus", bonus, errs);

  validateNonNegative("Overtime hours", overtimeHours, errs);
  validateNonNegative("Deduction hours", deductionHours, errs);

  validateNonNegative("Medical insurance", medicalInsurance, errs);
  validateNonNegative("Advance salary loan", advanceLoan, errs);

  validateNonNegative("Insurable salary base", insurableBase, errs);
  // Insurable base must be strictly within the allowed band; do NOT auto-clamp.
  validateRangeInclusive("Insurable salary base", insurableBase, INSURABLE_BASE_MIN, INSURABLE_BASE_MAX, errs);
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

  // Gross before medical (gross earnings)
  const grossMonthly = basicGross + allowances + incentive + bonus + overtimeValueMonthly - hourDeductionValueMonthly;

  // Deduct medical BEFORE tax & martyrs base
  const grossAfterMedicalMonthly = grossMonthly - medicalInsurance;

  if (grossAfterMedicalMonthly < 0) {
    clearResults();
    showErrors(["Gross after medical became negative. Please review hour deductions and medical insurance."]);
    try { $('medicalInsurance').focus(); } catch (_) {}
    return;
  }

    const insurableUsed = insurableBase;
  const siRate = siRatePct / 100.0;
  const siMonthly = insurableUsed * siRate;

  const companySiRate = companySiRatePct / 100.0;
  const companySiMonthly = insurableUsed * companySiRate;

  // Martyrs deduction based on gross AFTER medical
  const martyrsMonthly = grossAfterMedicalMonthly * 0.0005;

  const grossAnnual = grossMonthly * 12;
  const grossAfterMedicalAnnual = grossAfterMedicalMonthly * 12;

  const siAnnual = siMonthly * 12;
  const companySiAnnual = companySiMonthly * 12;

  const medicalAnnual = medicalInsurance * 12;
  const martyrsAnnual = martyrsMonthly * 12;
  const advanceAnnual = advanceLoan * 12;

  // Taxable income: Gross annual minus medical (deductible), employee SI, and personal exemption
  const taxableAnnual = Math.max(0, (grossAnnual - medicalAnnual - siAnnual - personalExemption));
  const taxAnnualRaw = calcAnnualTaxEG(taxableAnnual);
  const taxAnnual = Number.isFinite(taxAnnualRaw) ? taxAnnualRaw : 0;
  const taxMonthly = taxAnnual / 12;

  // Net pay is calculated AFTER tax and martyrs; advance loan is a final net-pay deduction.
  const netBeforeLoan = grossMonthly - medicalInsurance - siMonthly - taxMonthly - martyrsMonthly;
  const netMonthly = netBeforeLoan - advanceLoan;

  showErrors([]);

  // Show gross AFTER medical in the KPI area (as requested)
  setText("grossMonthly", fmtEGP(grossAfterMedicalMonthly));
setText("siMonthly", fmtEGP(siMonthly));
setText("taxMonthly", fmtEGP(taxMonthly));
setText("martyrsMonthly", fmtEGP(martyrsMonthly));
setText("advanceMonthly", fmtEGP(advanceLoan));
setText("netMonthly", fmtEGP(netMonthly));

setText("grossAnnual", fmtEGP(grossAnnual));
setText("grossAfterMedicalAnnual", fmtEGP(grossAfterMedicalAnnual));

setText("insurableUsed", fmtEGP(insurableUsed));

setText("siAnnual", fmtEGP(siAnnual));
setText("companySiAnnual", fmtEGP(companySiAnnual));

setText("taxableAnnual", fmtEGP(taxableAnnual));
setText("taxAnnual", fmtEGP(taxAnnual));

setText("hourlyRate", fmtEGP(hourlyRate));
setText("overtimeValue", fmtEGP(overtimeValueMonthly));
setText("hourDeductionValue", fmtEGP(hourDeductionValueMonthly));
}


function computeNetMonthlyForBasicGross(basicGross, p) {
  const hourlyRate = basicGross / 240.0;
  const overtimeValueMonthly = p.overtimeHours * hourlyRate * OVERTIME_MULTIPLIER;
  const hourDeductionValueMonthly = p.deductionHours * hourlyRate;

  const grossMonthly = basicGross + p.allowances + p.incentive + p.bonus + overtimeValueMonthly - hourDeductionValueMonthly;
  const grossAfterMedicalMonthly = grossMonthly - p.medicalInsurance;

  if (grossAfterMedicalMonthly < 0) {
    return { ok: false, reason: "Gross after medical became negative. Please review hour deductions and medical insurance." };
  }

  const insurableUsed = p.insurableBase;
  const siMonthly = insurableUsed * (DEFAULT_EMPLOYEE_SI_RATE_PCT / 100.0);

  const martyrsMonthly = grossAfterMedicalMonthly * 0.0005;

  const grossAnnual = grossMonthly * 12;
  const medicalAnnual = p.medicalInsurance * 12;
  const siAnnual = siMonthly * 12;

  const taxableAnnual = Math.max(0, (grossAnnual - medicalAnnual - siAnnual - DEFAULT_PERSONAL_EXEMPTION_ANNUAL));
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
  validateNonNegative("Insurable salary base", insurableBase, errs);
  validateRangeInclusive("Insurable salary base", insurableBase, INSURABLE_BASE_MIN, INSURABLE_BASE_MAX, errs);

  if (errs.length) {
    $("solveOutBasicGross").value = "";
    $("solveOutTax").value = "";
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

  // We solve for the BASIC gross salary that produces the user's target net salary
  // (the target net salary is already the total net paid, including allowances).
  const targetNetTotal = targetNet;

  let low = MIN_BASIC_GROSS;
  let high = Math.max(20000, targetNetTotal * 2 + 50000);

  const lowRes = computeNetMonthlyForBasicGross(low, p);
  if (!lowRes.ok) {
    showErrorsIn("errorsSolve", [lowRes.reason]);
    return;
  }
  if (lowRes.netMonthly > targetNetTotal) {
    showErrorsIn("errorsSolve", [
      `Target net salary is too low. Even the minimum basic gross salary (${MIN_BASIC_GROSS.toLocaleString("en-US")} EGP) produces a higher net.`
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
  $("solveOutTax").value = fmtNumber(best.taxMonthly, 2);
  $("solveOutNet").value = fmtNumber(best.netMonthly, 2);
}



function resetForm() {
  $("basicGross").value = "";  $("allowances").value = "";
  $("incentive").value = "";
  $("bonus").value = "";

  $("overtimeHours").value = "";
  $("deductionHours").value = "";

  $("medicalInsurance").value = "";
  $("advanceLoan").value = "";

  $("insurableBase").value = "";

  // Reset Basic Gross from Net section
  $("solveTargetNet").value = "";
  $("solveInsurableBase").value = "";
  $("solveAllowances").value = "";
  $("solveOutBasicGross").value = "";
  $("solveOutTax").value = "";
  $("solveOutNet").value = "";


  [
    "grossMonthly","siMonthly","taxMonthly","martyrsMonthly","advanceMonthly","netMonthly",
    "grossAnnual","grossAfterMedicalAnnual","insurableUsed","siAnnual","companySiAnnual","taxableAnnual","taxAnnual",
    "hourlyRate","overtimeValue","hourDeductionValue"
  ].forEach(id => {
    const el = $(id);
    if (el) el.textContent = "—";
  });

  showErrors([]);

}

function initCalculatorBindings() {
  if (calculatorBindingsInitialized) return;
  calculatorBindingsInitialized = true;
  const btnCalc = $("btnCalc");  const btnReset = $("btnReset");
  const btnSolveGross = $("btnSolveGross");
  if (btnCalc) btnCalc.addEventListener("click", calculate);  if (btnReset) btnReset.addEventListener("click", resetForm);
  if (btnSolveGross) btnSolveGross.addEventListener("click", solveBasicGrossSection);

  // Apply thousands separators to all numeric inputs.
  wireThousandsSeparators();

  // Enter-to-calc handlers (includes all inputs)
  [
    "basicGross","allowances","incentive","bonus",
    "overtimeHours","deductionHours",
    "medicalInsurance","advanceLoan",
    "insurableBase",
    "solveTargetNet","solveInsurableBase","solveAllowances"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        calculate();
      }
    });
  });
}
