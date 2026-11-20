/* HR Documents
   - Admins and super admins only: ensureAuth turns everyone else away,
     and row level security on employee_profiles says the same thing from
     the database's side.
   - The same engine runs Employee Documents (employee-documents/), open
     to every signed-in user: that page calls startDocumentsPage with its
     own list and roles, and row level security limits the employees it
     can read to the user and the people below them.
   - Each document is a Word template whose blanks are written as (1),
     (2), ... in the text. The template is rendered in the page as it
     looks in Word; every blank becomes a locked field, filled from the
     employee database, and the rest of the text can be edited in place.
   - Save PDF downloads the page as a PDF; Print sends that same PDF
     to the printer.
*/
import { renderAsync, JSZip, toCanvas, jsPDF } from '../vendor/hr-docs-libs-1.js'

const $ = (id) => document.getElementById(id)

/* ------------------------------------------------------------------ */
/* Arabic formatting                                                   */
/* ------------------------------------------------------------------ */

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export const toArabicDigits = (s) => String(s ?? '').replace(/[0-9]/g, (d) => AR_DIGITS[d])

/* Dates are plain calendar days. They are built and read in UTC so a
   time zone can never move one across midnight. */
export function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
}
export const todayUTC = () => {
  const n = new Date()
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))
}
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000)

/* One calendar year on, the day before: a year that starts on 11 Nov
   2026 ends on 10 Nov 2027. Worked out as the database works out
   contract_expiry -- the day before, then a year on, a 29 Feb that
   does not exist becoming 28 Feb -- so the two never disagree. */
export function oneYearFrom(start) {
  const less = addDays(start, -1)
  const y = less.getUTCFullYear() + 1
  const m = less.getUTCMonth()
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(less.getUTCDate(), last)))
}

/* dd/mm/yyyy, laid out the way an Arabic reader reads it: from the right,
   day first, so the year ends up on the left (٢٠٢٦/١١/١٢ reads 12 Nov
   2026). Left alone, the browser keeps Arabic-Indic digits joined by "/"
   together as one left-to-right number and puts the day on the left; a
   right-to-left mark on each side of every slash makes the three parts
   separate and ordered right to left, as Word shows a date in Arabic text.
   The marks take no space and print nothing. */
const RLM = '\u200F'
export const dmy = (d) => d
  ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
  : ''
export const arDate = (d) => (d ? toArabicDigits(dmy(d)).split('/').join(`${RLM}/${RLM}`) : '')
export const arDay = (d) => (d ? AR_DAYS[d.getUTCDay()] : '')
export const isoOf = (d) => (d ? d.toISOString().slice(0, 10) : '')

/* Month and year only, mm/yyyy -- the ID card gives no day -- laid out
   right to left like the full dates. */
export const my = (d) => (d ? `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` : '')
export const arMonth = (d) => (d ? toArabicDigits(my(d)).split('/').join(`${RLM}/${RLM}`) : '')

/* A month typed as mm/yyyy, in Western or Arabic digits. Empty gives
   null; anything that is not a real month gives undefined. Stored as the
   first of the month. */
export function parseMY(text) {
  const s = String(text ?? '').replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).trim()
  if (!s) return null
  const m = /^(\d{1,2})\s*[/\-.]\s*(\d{4})$/.exec(s)
  if (!m || +m[1] < 1 || +m[1] > 12) return undefined
  return new Date(Date.UTC(+m[2], +m[1] - 1, 1))
}

/* A date typed as dd/mm/yyyy, in Western or Arabic digits, with / - or .
   between the parts. Empty gives null; anything else that is not a real
   calendar day gives undefined. */
export function parseDMY(text) {
  const s = String(text ?? '').replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).trim()
  if (!s) return null
  const m = /^(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})$/.exec(s)
  if (!m) return undefined
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]))
  return d.getUTCDate() === +m[1] && d.getUTCMonth() === +m[2] - 1 ? d : undefined
}

/* ------------------------------------------------------------------ */
/* Amounts                                                              */
/* ------------------------------------------------------------------ */

/* An amount typed in English digits (Arabic ones are accepted too), with
   or without thousands commas, and at most two decimals: "8500",
   "8,500", "8500.50". Empty gives null; anything else undefined. */
export function parseAmount(text) {
  const s = String(text ?? '').replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).replace(/[,\s]/g, '')
  if (!s) return null
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return undefined
  return { pounds: +m[1], piasters: m[2] ? +m[2].padEnd(2, '0') : 0 }
}

/* The amount in Arabic digits, grouped in thousands: ٨٬٥٠٠ or ٨٬٥٠٠٫٥٠. */
export function amountDigits(a) {
  if (!a) return ''
  const n = a.pounds + a.piasters / 100
  return new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: a.piasters ? 2 : 0,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(n)
}

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة']
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
  'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة',
  'سبعمائة', 'ثمانمائة', 'تسعمائة']
/* One, two, three to ten, eleven and up: ألف، ألفان، ثلاثة آلاف، أحد عشر ألفًا. */
const SCALES = [
  [1e9, ['مليار', 'ملياران', 'مليارات', 'مليارًا']],
  [1e6, ['مليون', 'مليونان', 'ملايين', 'مليونًا']],
  [1e3, ['ألف', 'ألفان', 'آلاف', 'ألفًا']],
]

function belowThousand(n) {
  const parts = []
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h) parts.push(HUNDREDS[h])
  if (r >= 20) parts.push(r % 10 ? `${ONES[r % 10]} و${TENS[Math.floor(r / 10)]}` : TENS[r / 10])
  else if (r >= 10) parts.push(TEENS[r - 10])
  else if (r) parts.push(ONES[r])
  return parts.join(' و')
}

/* A whole number in Arabic words: 8500 -> ثمانية آلاف وخمسمائة. */
export function arabicWords(n) {
  if (!n) return 'صفر'
  const parts = []
  for (const [size, [one, two, few, many]] of SCALES) {
    const c = Math.floor(n / size)
    n %= size
    if (!c) continue
    if (c === 1) parts.push(one)
    else if (c === 2) parts.push(two)
    else {
      const r = c % 100
      // Two hundred before a noun loses its nun: مائتا ألف, not مائتان ألف.
      const count = belowThousand(c).replace(/مائتان$/, 'مائتا')
      parts.push(`${count} ${r >= 3 && r <= 10 ? few : r >= 11 ? many : one}`)
    }
  }
  if (n) parts.push(belowThousand(n))
  return parts.join(' و')
}

/* The amount as a contract writes it after "فقط":
   ثمانية آلاف وخمسمائة جنيه مصري لا غير. */
export function amountWords(a) {
  if (!a) return ''
  let s = a.pounds ? `${arabicWords(a.pounds)} جنيه مصري` : ''
  if (a.piasters) {
    const p = a.piasters
    const piasters = p === 1 ? 'قرش واحد' : p === 2 ? 'قرشان'
      : `${arabicWords(p)} ${p <= 10 ? 'قروش' : 'قرشًا'}`
    s += `${s ? ' و' : ''}${piasters}`
  }
  return `${s} لا غير`
}

/* An amount split into equal installments, rounded to the piaster:
   8500 over 6 is 1416.67. */
export function installment(a, count) {
  if (!a || !count) return null
  const each = Math.round((a.pounds * 100 + a.piasters) / count)
  return { pounds: Math.floor(each / 100), piasters: each % 100 }
}

/* For searching Arabic names: the spellings people type interchangeably
   are folded together, and diacritics are dropped. */
export const foldArabic = (s) => String(s ?? '')
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

/* ------------------------------------------------------------------ */
/* The documents                                                        */
/* ------------------------------------------------------------------ */

export const has = (set, k) => Object.prototype.hasOwnProperty.call(set, k)

/* --- Shared ---------------------------------------------------------- */

export const isFemale = (emp) => emp?.gender === 'Female'

/* The job title as the forms state it: the official social-insurance
   title, in Arabic; the English title when there is none. */
export const jobTitle = (emp) => emp?.si_title || emp?.title || ''

/* The department and sector in Arabic, as set in the tracker's Settings.
   Arabic only: a department without an Arabic name leaves the blank
   empty, so the form says the data is missing rather than printing an
   English name in an Arabic document. */
export const department = (emp) => emp?.department_ar || ''
export const sector = (emp) => emp?.sector_ar || ''

/* A mobile number as one run of Arabic digits: 010-1234-5678 becomes
   ٠١٠١٢٣٤٥٦٧٨. With the hyphens kept, Arabic text would lay the three
   groups out right to left and scramble the number. */
const phone = (s) => toArabicDigits(String(s || '').replace(/\D/g, ''))

/* The qualification as the contract states it: the degree, then the
   field when there is one -- بكالوريوس هندسة. */
const qualification = (emp) =>
  [emp?.qualification_degree_ar, emp?.education_field].filter(Boolean).join(' ')

/* The record's English values in the forms' Arabic, in the employee's
   gender where Arabic has one. */
const AR = {
  gender: { Male: ['ذكر', 'ذكر'], Female: ['أنثى', 'أنثى'] },
  religion: { Muslim: ['مسلم', 'مسلمة'], Christian: ['مسيحي', 'مسيحية'] },
  marital: { Single: ['أعزب', 'عزباء'], Married: ['متزوج', 'متزوجة'], Divorced: ['مطلق', 'مطلقة'] },
}
const inArabic = (list, value, emp) => (AR[list][value] || [])[isFemale(emp) ? 1 : 0] || ''

/* --- Contract renewal ------------------------------------------------ */

/* The agreement date is today unless the user has set it (`set.today`,
   null when cleared). The others come from the employee record; the end
   is one year on from the start, less a day. */
export function renewalDates(emp, set = {}, today = todayUTC()) {
  const lastExpiry = emp ? parseISO(emp.contract_expiry) : null
  const start = lastExpiry ? addDays(lastExpiry, 1) : null
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
    start,
    end: start ? oneYearFrom(start) : null,
  }
}

/* The contract renewal's blanks, by the number written in the template. */
export function renewalValues(emp, d) {
  const name = emp?.arabic_name || ''
  return {
    1: arDay(d.today),
    2: arDate(d.today),
    3: name,
    4: toArabicDigits(emp?.national_id || ''),
    5: arDate(d.hired),
    6: arDate(d.start),
    7: arDate(d.end),
    8: name,
  }
}

/* --- Termination notice (contract not renewed) ----------------------- */

/* The notice is dated today unless the user sets it. The last working
   day is the end of the contract on the record (contract_expiry, which
   counts the renewals). */
export function terminationDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
    lastDay: emp ? parseISO(emp.contract_expiry) : null,
  }
}

/* The termination notice's blanks. (5) is when the last renewal ends --
   the contract expiry on the record -- and only for a contract renewed
   at least once (renewals on the record); never renewed, it is left
   empty and its line is not printed (dropLines). (6)-(7) and (8)-(9)
   are the last working day, in the company's letter and in the
   employee's acknowledgement; (10) is the employee's name above the
   signature, which is signed by hand; (11) the address on the record. */
export function terminationValues(emp, d) {
  const name = emp?.arabic_name || ''
  return {
    1: arDate(d.today),
    2: name,
    3: toArabicDigits(emp?.national_id || ''),
    4: arDate(d.hired),
    5: Number(emp?.renewals) > 0 ? arDate(d.lastDay) : '',
    6: arDay(d.lastDay),
    7: arDate(d.lastDay),
    8: arDay(d.lastDay),
    9: arDate(d.lastDay),
    10: name,
    11: emp?.address || '',
  }
}

/* --- Hiring contract ------------------------------------------------- */

/* The ID issue month comes from the employee record (id_issue_date, the
   first of the month on the card). The contract runs one year from the
   hiring date, less a day. */
export function hiringDates(emp, set = {}, today = todayUTC()) {
  const hired = emp ? parseISO(emp.hired_on) : null
  return {
    today: has(set, 'today') ? set.today : today,
    idIssued: emp ? parseISO(emp.id_issue_date) : null,
    start: hired,
    end: hired ? oneYearFrom(hired) : null,
  }
}

/* The hiring contract's blanks. (10) and (11) are the monthly wage, typed
   by the user in English digits: (10) shows it in Arabic digits, (11) in
   Arabic words. (6) is the address on the employee record. */
export function hiringValues(emp, d, inputs = {}) {
  const name = emp?.arabic_name || ''
  const wage = inputs.salary || null
  return {
    1: arDay(d.today),
    2: arDate(d.today),
    3: name,
    4: toArabicDigits(emp?.national_id || ''),
    5: arMonth(d.idIssued),
    6: emp?.address || '',
    7: qualification(emp),
    8: toArabicDigits(emp?.si_no || ''),
    9: jobTitle(emp),
    10: amountDigits(wage),
    11: amountWords(wage),
    12: arDate(d.start),
    13: arDate(d.end),
  }
}

/* --- Work start acknowledgement (إقرار استلام عمل) --------------------- */

/* The acknowledgement is dated today unless the user sets it, at the top
   and at the bottom alike; the work start date is the hiring date, and
   the ID issue month the one on the record. */
export function workStartDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
    idIssued: emp ? parseISO(emp.id_issue_date) : null,
  }
}

export function workStartValues(emp, d, inputs = {}) {
  const name = emp?.arabic_name || ''
  return {
    1: name,
    2: toArabicDigits(emp?.national_id || ''),
    // No 3 or 4: the mobile and current address lines were taken off the form.
    5: jobTitle(emp),
    6: department(emp),
    7: arDate(d.hired),
    8: name,
    9: arDate(d.today),
    10: inputs.admin || '',
    11: arDate(d.today),
    // "صادرة بتاريخ": the card's issue month, as the hiring contract prints it.
    12: arMonth(d.idIssued),
    13: toArabicDigits(emp?.si_no || ''),
  }
}

/* --- Clearance notice (إخلاء طرف) -------------------------------------- */

/* Both dates come from the record, as on the resignation form, and
   cannot be changed here: the notice is dated on the notice date, and
   the last working day is the resignation date. */
export function clearanceDates(emp) {
  return {
    noticed: emp ? parseISO(emp.notice_date) : null,
    lastDay: emp ? parseISO(emp.resignation_date) : null,
    hired: emp ? parseISO(emp.hired_on) : null,
  }
}

/* The clearance notice's blanks. (2) is the weekday of the last working
   day, "يوم (2) الموافق (3)"; (8) is the employee's own department, in the
   first row of the table. (9)-(12) are the employee who takes over the
   work, chosen from the list: name, job, department and hiring date from
   that employee's record. (13) is the name above the employee's signature. */
export function clearanceValues(emp, d, inputs = {}, ctx = {}) {
  const name = emp?.arabic_name || ''
  const r = ctx.find ? ctx.find(inputs.receiver) : null
  const v = {
    1: arDate(d.noticed),
    2: arDay(d.lastDay),
    3: arDate(d.lastDay),
    4: name,
    5: jobTitle(emp),
    6: department(emp),
    7: arDate(d.hired),
    8: department(emp),
    13: name,
  }
  if (r) {
    v[9] = r.arabic_name || ''
    v[10] = jobTitle(r)
    v[11] = department(r)
    v[12] = arDate(parseISO(r.hired_on))
  }
  return v
}

/* --- Termination and final settlement (اتفاق إنهاء علاقة عمل والتسوية النهائية) */

/* Dated today unless the user sets it. The end of employment is the
   resignation date on the record, as on the resignation form; it cannot
   be changed here. */
export function settlementDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    lastDay: emp ? parseISO(emp.resignation_date) : null,
  }
}

/* "انه في يوم (1) الموافق (2)": the agreement date; (3)-(5) the employee's
   name, address on the record and national ID; "اعتبارًا من يوم (6)
   الموافق (7)": the resignation date. */
export function settlementValues(emp, d) {
  return {
    1: arDay(d.today),
    2: arDate(d.today),
    3: emp?.arabic_name || '',
    4: emp?.address || '',
    5: toArabicDigits(emp?.national_id || ''),
    6: arDay(d.lastDay),
    7: arDate(d.lastDay),
  }
}

/* --- Social status declaration (إقرار الحالة الاجتماعية) ---------------- */

/* Dated today unless the user sets it. */
export function socialStatusDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    birth: emp ? parseISO(emp.birth_date) : null,
    idIssued: emp ? parseISO(emp.id_issue_date) : null,
  }
}

/* Military service in the form's Arabic, in the employee's gender. */
const MILITARY = {
  Served: ['أدى الخدمة', 'أدت الخدمة'],
  'Served-Reserve Forces': ['أدى الخدمة (احتياط)', 'أدت الخدمة (احتياط)'],
  Postponed: ['مؤجل', 'مؤجلة'],
  Exempted: ['معفى', 'معفاة'],
}
const militaryService = (emp) => (MILITARY[emp?.military_service] || [])[isFemale(emp) ? 1 : 0] || ''

/* Gender, nationality, birth date and governorate are read out of the
   national ID by the database; the rest is on the record, in the
   employee's gender where Arabic has one. (10) is the governorate. */
export function socialStatusValues(emp, d, inputs = {}) {
  const name = emp?.arabic_name || ''
  return {
    1: arDate(d.today),
    2: name,
    3: toArabicDigits(emp?.si_no || ''),
    4: jobTitle(emp),
    5: department(emp),
    7: inArabic('gender', emp?.gender, emp),
    8: emp?.national_id ? (isFemale(emp) ? 'مصرية' : 'مصري') : '',
    9: inArabic('religion', emp?.religion, emp),
    10: emp?.governorate || '',
    12: arDate(d.birth),
    23: inArabic('marital', emp?.marital_status, emp),
    24: name,
    25: arDate(d.today),
    ...refTableValues(REF_TABLE, inputs),
    38: toArabicDigits(emp?.national_id || ''),
    39: militaryService(emp),
    // "صادرة بتاريخ": the card's issue month, as the hiring contract prints it.
    40: arMonth(d.idIssued),
    41: phone(emp?.personal_mobile),
    42: qualification(emp),
    // The address on the record is the one on the ID card.
    43: emp?.address || '',
    // Typed on the form every time; starts empty and must be filled.
    44: inputs.currentAddress || '',
  }
}

/* The references table, "أشخاص يمكن الرجوع اليهم للاستفسار": three rows
   of name, job, relation and phone, blanks (26) to (37) row by row. */
const REF_TABLE = {
  title: 'أشخاص يمكن الرجوع إليهم للاستفسار',
  first: 26,
  rows: 3,
  cols: [['name', 'الاسم', 'text'], ['job', 'الوظيفة', 'text'], ['relation', 'صلة القرابة', 'text'], ['phone', 'التليفون', 'phone']],
}
const refKey = (r, col) => `ref${r}_${col}`
const refBlank = (t, r, c) => t.first + r * t.cols.length + c

function refTableValues(t, inputs) {
  const out = {}
  for (let r = 0; r < t.rows; r++) {
    t.cols.forEach(([col, , kind], c) => {
      const v = inputs[refKey(r, col)] || ''
      out[refBlank(t, r, c)] = kind === 'phone' ? phone(v) : v
    })
  }
  return out
}

/* The first row starts as the secondary contact on the record: name,
   job title, relationship and number, each a field of its own on the
   Employee Database page. A name still written the old way, "اسم (صلة
   القرابة)", with no relationship beside it, is split as before. Every
   box can still be changed. */
function socialStatusDefaults(emp) {
  if (!emp) return {}
  const raw = emp.secondary_mobile_name || ''
  const m = emp.secondary_contact_relation ? null : /^\s*(.*?)\s*\((.*?)\)\s*$/.exec(raw)
  return {
    [refKey(0, 'name')]: m ? m[1] : raw,
    [refKey(0, 'job')]: emp.secondary_contact_title || '',
    [refKey(0, 'relation')]: emp.secondary_contact_relation || (m ? m[2] : ''),
    [refKey(0, 'phone')]: emp.secondary_mobile ? String(emp.secondary_mobile).replace(/\D/g, '') : '',
  }
}

/* --- Confidentiality declaration (إقرار سرية البيانات) ------------------ */

/* Dated today unless the user sets it, at the top and above the name at
   the bottom alike; the hiring date is the one on the record. */
export function confidentialityDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
    idIssued: emp ? parseISO(emp.id_issue_date) : null,
  }
}

export function confidentialityValues(emp, d) {
  const name = emp?.arabic_name || ''
  return {
    1: arDate(d.today),
    2: name,
    3: toArabicDigits(emp?.national_id || ''),
    4: arDate(d.hired),
    5: jobTitle(emp),
    6: department(emp),
    7: name,
    8: arDate(d.today),
    // "صادرة بتاريخ": the card's issue month, as the hiring contract prints it.
    9: arMonth(d.idIssued),
    10: toArabicDigits(emp?.si_no || ''),
    // "المقيم في": the address on the record.
    11: emp?.address || '',
  }
}

/* --- Salary account letter to ABK (خطاب فتح حساب مرتب) ----------------- */

/* The company's letter asking Al Ahli Bank of Kuwait - Egypt to open a
   salary account for the new employee. Dated today unless the user sets
   it; the hiring date is the one on the record. */
export function bankAccountDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
  }
}

/* (6) is the total monthly salary, typed by the user in English digits
   and shown in Arabic digits. In the hiring papers it is the same box as
   the contract's monthly wage, typed once. */
export function bankAccountValues(emp, d, inputs = {}) {
  const wage = inputs.salary || null
  return {
    1: arDate(d.today),
    2: emp?.arabic_name || '',
    3: toArabicDigits(emp?.national_id || ''),
    4: jobTitle(emp),
    5: arDate(d.hired),
    6: wage ? `${amountDigits(wage)} جنيه مصري` : '',
  }
}

/* --- Employment certificate (إفادة عمل) ------------------------------- */

/* A letter, at the employee's request, stating that they work here: to
   whom it is addressed is typed, the rest is from the record, and the
   total salary is typed in English digits: (8) shows it in Arabic digits,
   (10) in Arabic words after "فقط", as in the hiring contract. The
   company's address is written in the template. Signed and stamped by hand. */
export function employmentCertificateDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    idIssued: emp ? parseISO(emp.id_issue_date) : null,
    hired: emp ? parseISO(emp.hired_on) : null,
  }
}

export function employmentCertificateValues(emp, d, inputs = {}) {
  const wage = inputs.salary || null
  return {
    1: arDate(d.today),
    2: (inputs.addressee || '').trim(),
    3: emp?.arabic_name || '',
    4: toArabicDigits(emp?.national_id || ''),
    5: arMonth(d.idIssued),
    6: jobTitle(emp),
    7: arDate(d.hired),
    // The thousands separator is a plain comma here: ٨,٥٠٠.
    8: amountDigits(wage).replace(/٬/g, ','),
    9: department(emp),
    10: amountWords(wage),
  }
}

/* --- Resignation (استقالة مسببة) --------------------------------------- */

/* The resignation date (1) is the notice date on the record and the last
   working day the resignation date; neither can be changed here. Only
   the employee's acknowledgement date is the user's, and it starts empty. */
export function resignationDates(emp, set = {}) {
  const d = (k) => (has(set, k) ? set[k] : null)
  return {
    submitted: emp ? parseISO(emp.notice_date) : null,
    lastDay: emp ? parseISO(emp.resignation_date) : null,
    acknowledgedOn: d('acknowledgedOn'),
  }
}

/* The name, job title, last working day and reasons come from the
   record -- the reasons are the resignation reason on it; the two
   approvers are chosen. (2) is the weekday of the last working day,
   "يوم (2) الموافق (3)". */
export function resignationValues(emp, d, inputs = {}) {
  const name = emp?.arabic_name || ''
  return {
    1: arDate(d.submitted),
    2: arDay(d.lastDay),
    3: arDate(d.lastDay),
    4: emp?.resignation_reason || '',
    5: name,
    6: jobTitle(emp),
    7: inputs.manager || '',
    9: inputs.admin || '',
    12: name,
    13: arDate(d.acknowledgedOn),
  }
}

/* --- Experience certificate (شهادة خبرة) ------------------------------ */

/* Dated today unless the user sets it; the period runs from the hiring
   date to the last working day, the resignation date on the record. */
export function experienceDates(emp, set = {}, today = todayUTC()) {
  return {
    certificateDate: has(set, 'certificateDate') ? set.certificateDate : today,
    hired: emp ? parseISO(emp.hired_on) : null,
    lastDay: emp ? parseISO(emp.resignation_date) : null,
  }
}

export function experienceValues(emp, d) {
  return {
    1: arDate(d.certificateDate),
    2: emp?.arabic_name || '',
    3: toArabicDigits(emp?.national_id || ''),
    4: jobTitle(emp),
    5: arDate(d.hired),
    6: arDate(d.lastDay),
  }
}

/* --- Form 1 Social Insurance (طلب اشتراك مؤمن عليه) ------------------- */

/* Dated today unless the user sets it ("تحريرًا في"); the subscription
   starts on the social insurance date on the record. */
export function form1Dates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    siStart: emp ? parseISO(emp.si_date) : null,
  }
}

/* A date for its boxes digit by digit: the day's two boxes, the month's,
   then the year's four. */
const dmyDigits = (d) => (d ? toArabicDigits(dmy(d).replace(/\//g, '')) : '')
/* A wage for its six boxes, in whole pounds: the 2026 form has no
   piasters. An amount with piasters, or past 999999, is left blank, so
   the form cannot be saved until it is put right. */
const wagePounds = (a) => (a && !a.piasters && a.pounds <= 999999 ? toArabicDigits(a.pounds) : '')

/* The 2026 form. The applicant (مقدم الطلب) is chosen from the employees:
   their name, job title as their capacity, insurance number, mobile and
   national ID from their record. The employee's details come from the
   record, the company's from the company details in the tracker's
   Settings, the two wages are typed. The category is "working for
   others" and the establishment type "standard" (نمطي). The sector, the
   subscription code and the period type are the company's, from the same
   Settings. Left as they are, for the office or the signer: disability,
   the first medical check, the house number, village and district, the
   signatures and the signature check. */
export function form1Values(emp, d, inputs = {}, ctx = {}) {
  const c = ctx.company || {}
  const a = ctx.find ? ctx.find(inputs.applicant) : null
  const name = emp?.arabic_name || ''
  const v = {
    1: c.si_office || '',
    2: emp ? '✓' : '',
    8: toArabicDigits(emp?.si_no || ''),
    9: name,
    10: toArabicDigits(emp?.national_id || ''),
    11: emp?.national_id ? (isFemale(emp) ? 'مصرية' : 'مصري') : '',
    12: qualification(emp),
    13: jobTitle(emp),
    14: dmyDigits(d.siStart),
    15: wagePounds(inputs.subWage),
    16: wagePounds(inputs.fullWage),
    17: emp ? '✓' : '',
    18: c.name_ar || '',
    19: toArabicDigits(c.establishment_no || ''),
    20: emp?.address || '',
    21: emp?.governorate || '',
    22: phone(emp?.personal_mobile),
    23: d.today ? toArabicDigits(dmy(d.today)).split('/').join('|') : '',
    24: c.name_ar || '',
    25: toArabicDigits(c.establishment_no || ''),
    26: c.address_ar || '',
    27: name,
    28: c.si_sector || '',
    29: toArabicDigits(c.si_subscription_code || ''),
    30: c.si_period_type || '',
  }
  if (a) {
    v[3] = a.arabic_name || ''
    v[4] = jobTitle(a)
    v[5] = toArabicDigits(a.si_no || '')
    v[6] = phone(a.personal_mobile)
    v[7] = toArabicDigits(a.national_id || '')
  }
  return v
}

/* Where each blank sits on the 2026 scan, in the pictures' pixels (1275
   x 2100, 150 to the inch), measured off the form: lines at their dots,
   boxes left to right in the order their characters go. */
const step = (...xs) => xs.slice(1).map((x, i) => [xs[i], x])
const FORM1_LINES = [
  { n: 1, kind: 'line', x: [920, 1159], y: [0, 103] },
  { n: 2, kind: 'mark', x: [827, 868], y: [228, 268] },
  // The applicant.
  { n: 3, kind: 'line', x: [683, 1086], y: [0, 436] },
  { n: 4, kind: 'line', x: [89, 496], y: [0, 436] },
  { n: 5, kind: 'cells', cells: step(714, 756, 798, 838, 880, 922, 963, 1004, 1046, 1087), y: [472, 513], align: 'end' },
  { n: 6, kind: 'line', x: [94, 536], y: [0, 498] },
  { n: 7, kind: 'cells', cells: step(514, 554, 597, 639, 680, 722, 763, 802, 844, 886, 926, 968, 1010, 1050, 1092), y: [538, 579] },
  // The insured.
  { n: 8, kind: 'cells', cells: step(648, 688, 730, 772, 813, 854, 896, 937, 978, 1020), y: [679, 720], align: 'end' },
  { n: 9, kind: 'line', x: [82, 459], y: [0, 709] },
  { n: 10, kind: 'cells', cells: step(440, 481, 523, 566, 606, 648, 690, 729, 770, 812, 853, 894, 936, 977, 1018), y: [736, 778] },
  { n: 11, kind: 'line', x: [84, 271], y: [0, 762] },
  { n: 12, kind: 'line', x: [690, 1101], y: [0, 816] },
  { n: 13, kind: 'line', x: [280, 636], y: [0, 816] },
  // Day, month, year -- right to left on the page, each read left to right.
  { n: 14, kind: 'cells', cells: [...step(864, 900, 935), ...step(765, 800, 836), ...step(602, 637, 672, 708, 743)], y: [838, 873] },
  // The wages' boxes, under their "جنيه" heading.
  { n: 15, kind: 'cells', cells: step(686, 731, 775, 819, 863, 908, 952), y: [977, 1008], align: 'end' },
  { n: 16, kind: 'cells', cells: step(230, 274, 319, 363, 407, 451, 491), y: [981, 1013], align: 'end' },
  // Beside the start date and under it: the company's sector,
  // subscription code and period type.
  { n: 28, kind: 'line', x: [280, 511], y: [0, 870] },
  { n: 29, kind: 'line', x: [893, 1071], y: [0, 924] },
  { n: 30, kind: 'line', x: [557, 755], y: [0, 924] },
  // The establishment.
  { n: 17, kind: 'mark', x: [962, 1004], y: [1259, 1300] },
  { n: 18, kind: 'line', x: [720, 1087], y: [0, 1348] },
  { n: 19, kind: 'cells', cells: step(116, 156, 198, 240, 280, 322, 364, 405, 446, 488), y: [1320, 1360], align: 'end' },
  // Residence: the address on the street line, the governorate by name.
  { n: 20, kind: 'line', x: [496, 853], y: [0, 1496] },
  { n: 21, kind: 'line', x: [574, 793], y: [0, 1550] },
  { n: 22, kind: 'line', x: [781, 1033], y: [0, 1747] },
  // "تحريرًا في: / /": the day right of the slashes, the year left.
  { n: 23, kind: 'cells', cells: [[1056, 1110], [1008, 1043], [925, 997]], y: [1772, 1800] },
  // The back: the declaration.
  { n: 24, kind: 'line', page: 2, x: [568, 1030], y: [0, 881] },
  { n: 25, kind: 'line', page: 2, x: [65, 322], y: [0, 881] },
  { n: 26, kind: 'line', page: 2, x: [64, 1028], y: [0, 934] },
  { n: 27, kind: 'line', page: 2, x: [872, 1098], y: [0, 1303] },
]
/* Spots are measured with a line's y at its dots. Each line's box then
   reaches up 40 pixels from just under them, so the large lettering fits
   in it whole, and sits 6 pixels lower, on the dots rather than above
   them -- and 6 pixels (1 mm) to the left. For pictures at 150 to the
   inch. */
const MM = 150 / 25.4
const onLines = (spots) => spots.map((sp) => (sp.kind === 'line'
  ? { ...sp, x: [sp.x[0] - MM, sp.x[1] - MM], y: [sp.y[1] + 6 - 40, sp.y[1] + 6] }
  : sp))
const FORM1_SPOTS = onLines(FORM1_LINES)

/* --- Form 6 Social Insurance (إخطار بانتهاء اشتراك مؤمن عليه) --------- */

/* The subscription ends on the resignation date on the record. */
export function form6Dates(emp) {
  return { lastDay: emp ? parseISO(emp.resignation_date) : null }
}

/* The applicant (مقدم الطلب) is chosen from the employees: their name,
   job title as their capacity, insurance number, mobile and national ID
   from their record. The employee's details come from the record, the
   company's from the company details, the reason is typed (it starts as
   استقالة). */
export function form6Values(emp, d, inputs = {}, ctx = {}) {
  const c = ctx.company || {}
  const a = ctx.find ? ctx.find(inputs.applicant) : null
  const name = emp?.arabic_name || ''
  const v = {
    1: c.si_office || '',
    7: toArabicDigits(emp?.si_no || ''),
    8: name,
    9: toArabicDigits(emp?.national_id || ''),
    10: toArabicDigits(c.establishment_no || ''),
    11: c.name_ar || '',
    12: dmyDigits(d.lastDay),
    13: inputs.reason || '',
    14: c.name_ar || '',
    15: toArabicDigits(c.establishment_no || ''),
    16: c.address_ar || '',
    17: name,
    18: toArabicDigits(emp?.si_no || ''),
  }
  if (a) {
    v[2] = a.arabic_name || ''
    v[3] = jobTitle(a)
    v[4] = toArabicDigits(a.si_no || '')
    v[5] = phone(a.personal_mobile)
    v[6] = toArabicDigits(a.national_id || '')
  }
  return v
}

/* Where each blank sits, in the pictures' pixels (1276 x 2101, 150 to
   the inch); lines at their dots, boxes left to right. */
const FORM6_SPOTS = onLines([
  { n: 1, kind: 'line', x: [941, 1123], y: [0, 113] },
  { n: 2, kind: 'line', x: [682, 1080], y: [0, 354] },
  { n: 3, kind: 'line', x: [87, 491], y: [0, 354] },
  { n: 4, kind: 'cells', cells: step(714, 756, 798, 838, 880, 922, 963, 1004, 1046, 1087), y: [389, 431], align: 'end' },
  { n: 5, kind: 'line', x: [117, 552], y: [0, 415] },
  { n: 6, kind: 'cells', cells: step(496, 538, 580, 622, 664, 704, 746, 786, 827, 868, 910, 951, 992, 1034, 1075), y: [476, 517] },
  { n: 7, kind: 'cells', cells: step(720, 762, 803, 846, 886, 928, 968, 1010, 1051), y: [620, 662], align: 'end' },
  { n: 8, kind: 'line', x: [111, 536], y: [0, 645] },
  { n: 9, kind: 'cells', cells: step(472, 514, 556, 596, 638, 680, 720, 762, 804, 845, 886, 928, 969, 1010, 1052), y: [671, 713] },
  { n: 10, kind: 'cells', cells: step(678, 720, 762, 802, 844, 886, 927, 968, 1010, 1051), y: [730, 772], align: 'end' },
  { n: 11, kind: 'line', x: [108, 521], y: [0, 757] },
  // Day, month, year -- right to left on the page, each read left to right.
  { n: 12, kind: 'cells', cells: [...step(900, 942, 984), ...step(776, 818, 860), ...step(570, 612, 652, 694, 736)], y: [791, 836] },
  { n: 13, kind: 'line', x: [108, 318], y: [0, 810] },
  { n: 14, kind: 'line', page: 2, x: [658, 1041], y: [0, 696] },
  { n: 15, kind: 'cells', page: 2, cells: step(82, 122, 164, 206, 248, 290, 330, 371, 412, 454), y: [670, 712], align: 'end' },
  { n: 16, kind: 'line', page: 2, x: [87, 1050], y: [0, 777] },
  { n: 17, kind: 'line', page: 2, x: [643, 959], y: [0, 841] },
  { n: 18, kind: 'cells', page: 2, cells: step(81, 122, 164, 206, 248, 289, 330, 370, 412, 454), y: [817, 859], align: 'end' },
])

/* --- Absence warning (إخطار رسمي بشأن الغياب عن العمل) ----------------- */

/* Dated today unless the user sets it. The period runs from the start
   of the year to today unless the user sets it: the law counts scattered
   absences within one year. */
export function absenceDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    idIssued: emp ? parseISO(emp.id_issue_date) : null,
    hired: emp ? parseISO(emp.hired_on) : null,
    from: has(set, 'from') ? set.from : new Date(Date.UTC(today.getUTCFullYear(), 0, 1)),
    to: has(set, 'to') ? set.to : today,
  }
}

/* The employee's attendance in the period, from the attendance records:
   every day's date and the code and effect of its type. */
async function loadAttendance(supabase, emp, d) {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('work_date, attendance_types!inner(code, effect)')
    .eq('employee_id', emp.id)
    .gte('work_date', isoOf(d.from))
    .lte('work_date', isoOf(d.to))
    .order('work_date')
  if (error) throw error
  return (data || []).map((r) => ({ date: parseISO(r.work_date), code: r.attendance_types.code, effect: r.attendance_types.effect }))
}

/* Days that do not break a run of absences: a weekly rest or a holiday
   between two days absent leaves them one continuous absence. */
const RUN_KEEPS = new Set(['weekly_rest', 'holiday'])

/* The days absent and the longest run of them. Two days absent are one
   run when every day between them is recorded as a rest day or a
   holiday; any other day between -- worked, on leave, or not recorded --
   ends the run. */
export function absenceDays(records = []) {
  const byDay = new Map(records.map((r) => [isoOf(r.date), r]))
  const days = records.filter((r) => r.effect === 'absence').map((r) => r.date)
  let longest = days.length ? 1 : 0
  let run = 1
  for (let i = 1; i < days.length; i++) {
    let joined = true
    for (let d = addDays(days[i - 1], 1); d < days[i]; d = addDays(d, 1)) {
      if (!RUN_KEEPS.has(byDay.get(isoOf(d))?.code)) { joined = false; break }
    }
    run = joined ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  return { days, longest }
}

/* The table of days absent: two columns of eleven, the right one first. */
const ABSENCE_CELLS = 22
const ABSENCE_FIRST = 14

/* The employee's details come from the record; the counts and the days
   absent from the attendance records in the period (ctx.fetched). */
export function absenceValues(emp, d, inputs = {}, ctx = {}) {
  const v = {
    1: arDate(d.today),
    2: emp?.arabic_name || '',
    3: toArabicDigits(emp?.national_id || ''),
    // "صادرة بتاريخ": the card's issue month, as the hiring contract prints it.
    4: arMonth(d.idIssued),
    5: toArabicDigits(emp?.si_no || ''),
    6: emp?.address || '',
    7: arDate(d.hired),
    8: jobTitle(emp),
    9: department(emp),
    10: arDate(d.from),
    11: arDate(d.to),
  }
  if (!ctx.fetched) return v
  const { days, longest } = absenceDays(ctx.fetched)
  // No day absent, or more than the table holds: the blanks stay empty
  // and the form says why (absenceCheck).
  if (!days.length || days.length > ABSENCE_CELLS) return v
  v[12] = toArabicDigits(days.length)
  v[13] = toArabicDigits(longest)
  days.forEach((day, i) => { v[ABSENCE_FIRST + i] = arDate(day) })
  return v
}

/* What stops the form beyond an empty blank: the records still loading
   or not read, no day absent, too many for the table, or a period that
   ends before it starts. */
export function absenceCheck(emp, d, inputs = {}, ctx = {}) {
  if (!emp) return ''
  if (d.from && d.to && d.to < d.from) return 'تاريخ نهاية الفترة قبل تاريخ بدايتها.'
  if (ctx.fetchError) return `تعذر تحميل سجل الحضور: ${ctx.fetchError}`
  if (!ctx.fetched) return d.from && d.to ? 'جارٍ تحميل أيام الغياب من سجل الحضور…' : ''
  const n = absenceDays(ctx.fetched).days.length
  if (!n) return 'لا يوجد غياب مسجل لهذا الموظف في سجل الحضور خلال الفترة المحددة.'
  if (n > ABSENCE_CELLS) {
    return `عدد أيام الغياب في الفترة ${toArabicDigits(n)} يومًا، والجدول يتسع لـ ${toArabicDigits(ABSENCE_CELLS)} يومًا فقط. اختر فترة أقصر.`
  }
  return ''
}

/* --- The list -------------------------------------------------------- */

/* For each document:
   fields      every blank, by the number in brackets in the template,
               with what it is. Any other bracketed number in the text,
               a law number say, is text. Every blank must be filled
               before the document can be saved or printed.
   info        [blank, label] shown read-only beside the document
   dateFields  [key, label, blanks, { month }?] dates the user sets;
               month ones are month and year only
   inputs      [key, label, kind, blanks, hint] values the user types;
               kind is text, longtext, amount (English digits, shown in
               Arabic digits and words), count (a whole number), year,
               person (an employee chosen from the list, by Arabic name)
               or employee (an employee chosen from the list, other than
               the one the form is for; its id is kept, and values() reads
               the rest of that employee's record through ctx.find). For
               an employee box, the first blank is the name, the rest come
               from that employee's record. choice is a row picked from a
               table, given as a sixth item { table, label }; values()
               reads the row through ctx.choice(key), and every blank it
               fills is the box's to fill
   optional    blanks that may be left empty (they print as nothing)
   wrap        blanks of free text whose line may wrap onto more lines
   tabsWrap    a tab whose next stop is past the line's end starts the
               next line, as in Word (see layoutPartTabs)
   fitPages    each of Word's pages (split by its page breaks) prints on
               exactly one sheet, smaller if it has to be, never cut
   duplex      printed on both sides: true flips on the long edge,
               'short' on the short edge
   pool        whose form it is: 'active' employees (the default) or
               'resigned' ones, those with a notice date
   fetch       { key(emp, dates), load(supabase, emp, dates) }: more data
               to read for the employee, given to values() as ctx.fetched
               (see fetchFor)
   fetchedFields  the blanks filled from that data
   check       (emp, dates, inputs, ctx) -> a message that stops saving and
               printing, or ''
   sections    [{ input, from }]: from the paragraph starting with the text
               `from` to the end of the page, shown -- on screen, in the PDF
               and in print -- only while the flag input `input` is ticked.
               A flag is a box to tick; it fills no blank and starts unticked */
const DOCUMENTS = [
  {
    id: 'hiring',
    title: 'عقد عمل محدد المدة',
    subtitle: 'Limited hiring contract',
    template: 'templates/hiring-contract.docx?v=15',
    fields: {
      1: 'اليوم', 2: 'تاريخ تحرير العقد', 3: 'الاسم بالعربية', 4: 'الرقم القومي',
      5: 'شهر وسنة إصدار البطاقة', 6: 'العنوان', 7: 'المؤهل', 8: 'الرقم التأميني',
      9: 'الوظيفة', 10: 'الأجر الشهري', 11: 'الأجر الشهري', 12: 'تاريخ التعيين',
      13: 'تاريخ التعيين',
    },
    dates: hiringDates,
    values: hiringValues,
    info: [
      [1, 'اليوم'],
      [4, 'الرقم القومي'],
      [5, 'تاريخ إصدار البطاقة'],
      [6, 'محل الإقامة'],
      [7, 'المؤهل'],
      [8, 'الرقم التأميني'],
      [9, 'الوظيفة'],
      [12, 'بداية العقد'],
      [13, 'نهاية العقد'],
    ],
    // The ID issue month (5) is no longer typed here: it is read from the
    // employee record, where it is entered as mm/yy.
    dateFields: [
      ['today', 'تاريخ تحرير العقد', [1, 2]],
    ],
    inputs: [
      ['salary', 'الأجر الشهري (بالأرقام الإنجليزية)', 'amount', [10, 11], 'مثال: 8500 أو 8500.50'],
    ],
  },
  {
    id: 'renewal',
    title: 'اتفاق تجديد عقد عمل محدد المدة',
    subtitle: 'Contract renewal',
    template: 'templates/contract-renewal.docx?v=3',
    fields: {
      1: 'اليوم', 2: 'تاريخ الاتفاق', 3: 'الاسم بالعربية', 4: 'الرقم القومي',
      5: 'تاريخ التعيين', 6: 'تاريخ انتهاء العقد', 7: 'تاريخ انتهاء العقد', 8: 'الاسم بالعربية',
    },
    dates: renewalDates,
    values: renewalValues,
    info: [
      [1, 'اليوم'],
      [4, 'الرقم القومي'],
      [5, 'تاريخ التعيين'],
      [6, 'بداية التجديد'],
      [7, 'نهاية التجديد'],
    ],
    dateFields: [['today', 'تاريخ الاتفاق', [1, 2]]],
    inputs: [],
  },
  {
    id: 'work-start',
    title: 'إقرار استلام عمل',
    subtitle: 'Work start acknowledgement',
    template: 'templates/work-start.docx?v=6',
    fields: {
      1: 'الاسم بالعربية', 2: 'الرقم القومي',
      5: 'الوظيفة', 6: 'الإدارة', 7: 'تاريخ التعيين', 8: 'الاسم بالعربية', 9: 'تاريخ الإقرار',
      10: 'الشئون الإدارية', 11: 'تاريخ الإقرار', 12: 'شهر وسنة إصدار البطاقة',
      13: 'الرقم التأميني',
    },
    dates: workStartDates,
    values: workStartValues,
    info: [
      [2, 'الرقم القومي'],
      [12, 'تاريخ إصدار البطاقة'],
      [13, 'الرقم التأميني'],
      [5, 'الوظيفة'],
      [6, 'الإدارة'],
      [7, 'تاريخ استلام العمل'],
    ],
    dateFields: [['today', 'تاريخ الإقرار', [11, 9]]],
    // Who signs for administrative affairs, chosen from the employees.
    inputs: [['admin', 'الشئون الإدارية', 'person', [10]]],
  },
  {
    id: 'social-status',
    title: 'إقرار الحالة الاجتماعية',
    subtitle: 'Social status declaration',
    template: 'templates/social-status.docx?v=8',
    fields: {
      1: 'تاريخ الإقرار', 2: 'الاسم بالعربية', 3: 'الرقم التأميني', 4: 'الوظيفة', 5: 'الإدارة',
      7: 'النوع (من الرقم القومي)', 8: 'الجنسية (من الرقم القومي)', 9: 'الديانة',
      10: 'المحافظة (من الرقم القومي)', 12: 'تاريخ الميلاد (من الرقم القومي)',
      23: 'الحالة الاجتماعية', 24: 'الاسم بالعربية', 25: 'تاريخ الإقرار',
      38: 'الرقم القومي', 39: 'الخدمة العسكرية', 40: 'تاريخ إصدار البطاقة',
      41: 'رقم التليفون', 42: 'المؤهل الدراسي', 43: 'العنوان', 44: 'العنوان الحالي',
      // One name for the whole table, so a missing box reads as one line.
      ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [26 + i, 'بيانات جدول الأشخاص الذين يمكن الرجوع إليهم'])),
    },
    refTable: REF_TABLE,
    // The second and third people in the references table may be left
    // out; the first must be given.
    optional: [30, 31, 32, 33, 34, 35, 36, 37],
    defaults: socialStatusDefaults,
    dates: socialStatusDates,
    values: socialStatusValues,
    info: [
      [3, 'الرقم التأميني'],
      [4, 'الوظيفة'],
      [5, 'الإدارة'],
      [7, 'النوع'],
      [8, 'الجنسية'],
      [9, 'الديانة'],
      [10, 'المحافظة'],
      [12, 'تاريخ الميلاد'],
      [23, 'الحالة الاجتماعية'],
      [38, 'الرقم القومي'],
      [40, 'تاريخ إصدار البطاقة'],
      [39, 'الخدمة العسكرية'],
      [41, 'رقم التليفون'],
      [42, 'المؤهل الدراسي'],
      [43, 'العنوان من الرقم القومي'],
    ],
    dateFields: [['today', 'تاريخ الإقرار', [1, 25]]],
    // Starts empty; save and print stay off until it is typed.
    inputs: [['currentAddress', 'العنوان الحالي', 'longtext', [44]]],
  },
]
DOCUMENTS.push({
  id: 'confidentiality',
  title: 'إقرار سرية البيانات',
  subtitle: 'Confidentiality declaration',
  template: 'templates/confidentiality.docx?v=5',
  // The signature line is left for the employee to sign by hand.
  fields: {
    1: 'تاريخ الإقرار', 2: 'الاسم بالعربية', 3: 'الرقم القومي', 4: 'تاريخ التعيين',
    5: 'الوظيفة', 6: 'الإدارة', 7: 'الاسم بالعربية', 8: 'تاريخ الإقرار',
    9: 'شهر وسنة إصدار البطاقة', 10: 'الرقم التأميني', 11: 'العنوان',
  },
  // The address can run onto a second line.
  wrap: [11],
  dates: confidentialityDates,
  values: confidentialityValues,
  info: [
    [3, 'الرقم القومي'],
    [4, 'تاريخ التعيين'],
    [5, 'الوظيفة'],
    [6, 'الإدارة'],
  ],
  dateFields: [['today', 'تاريخ الإقرار', [1, 8]]],
  inputs: [],
})
DOCUMENTS.push({
  id: 'bank-account',
  title: 'خطاب فتح حساب مرتب - البنك الأهلي الكويتي',
  subtitle: 'Salary account letter (ABK)',
  template: 'templates/bank-account.docx?v=2',
  // Signed and stamped by hand.
  /* Each paragraph keeps the direction and alignment it has in Word: the
     logo at the top and the company stamp line sit on the left. */
  ownDirection: true,
  fields: {
    1: 'تاريخ الخطاب', 2: 'الاسم بالعربية', 3: 'الرقم القومي', 4: 'الوظيفة',
    5: 'تاريخ التعيين', 6: 'إجمالي الراتب الشهري',
  },
  dates: bankAccountDates,
  values: bankAccountValues,
  info: [
    [3, 'الرقم القومي'],
    [4, 'الوظيفة'],
    [5, 'تاريخ التعيين'],
  ],
  dateFields: [['today', 'تاريخ الخطاب', [1]]],
  inputs: [
    ['salary', 'الأجر الشهري (بالأرقام الإنجليزية)', 'amount', [6], 'مثال: 8500 أو 8500.50'],
  ],
})
/* Third in the list, after the contract renewal. */
DOCUMENTS.splice(DOCUMENTS.findIndex((d) => d.id === 'renewal') + 1, 0, {
  id: 'employment-certificate',
  title: 'إفادة عمل',
  subtitle: 'Employment certificate',
  template: 'templates/employment-certificate.docx?v=4',
  fields: {
    1: 'تاريخ الإفادة', 2: 'الجهة الموجه إليها', 3: 'الاسم بالعربية', 4: 'الرقم القومي',
    5: 'شهر وسنة إصدار البطاقة', 6: 'الوظيفة', 7: 'تاريخ التعيين', 8: 'الراتب الشامل',
    9: 'الإدارة', 10: 'الراتب الشامل',
  },
  dates: employmentCertificateDates,
  values: employmentCertificateValues,
  info: [
    [4, 'الرقم القومي'],
    [5, 'تاريخ إصدار البطاقة'],
    [6, 'الوظيفة'],
    [9, 'الإدارة'],
    [7, 'تاريخ التعيين'],
  ],
  dateFields: [['today', 'تاريخ الإفادة', [1]]],
  inputs: [
    ['addressee', 'إلى السادة (الجهة الموجه إليها الإفادة)', 'text', [2], 'مثال: البنك الأهلي المصري'],
    ['salary', 'الراتب الشامل (بالأرقام الإنجليزية)', 'amount', [8, 10], 'مثال: 8500 أو 8500.50'],
  ],
})
DOCUMENTS.push({
  id: 'resignation',
  title: 'استقالة مسببة',
  subtitle: 'Resignation',
  template: 'templates/resignation.docx?v=3',
  pool: 'resigned',
  fields: {
    1: 'تاريخ الاستقالة', 2: 'تاريخ الاستقالة (آخر يوم عمل)', 3: 'تاريخ الاستقالة (آخر يوم عمل)',
    4: 'سبب الاستقالة',
    5: 'الاسم بالعربية', 6: 'الوظيفة', 7: 'مدير الإدارة', 9: 'الشئون الإدارية',
    12: 'الاسم بالعربية', 13: 'تاريخ إقرار الموظف',
  },
  dates: resignationDates,
  values: resignationValues,
  info: [
    [6, 'الوظيفة'],
    // From the notice date on the record, not typed here.
    [1, 'تاريخ تقديم الاستقالة'],
    [3, 'آخر يوم عمل'],
    [2, 'اليوم'],
    [4, 'سبب الاستقالة'],
  ],
  dateFields: [
    ['acknowledgedOn', 'تاريخ إقرار الموظف بالقبول', [13]],
  ],
  inputs: [
    ['manager', 'اعتماد مدير الإدارة', 'person', [7]],
    ['admin', 'اعتماد الشئون الإدارية', 'person', [9]],
  ],
})
DOCUMENTS.push({
  id: 'termination-notice',
  title: 'إخطار بعدم تجديد عقد العمل',
  subtitle: 'Termination notice (contract not renewed)',
  template: 'templates/termination-notice.docx?v=3',
  fields: {
    1: 'تاريخ الإخطار', 2: 'الاسم بالعربية', 3: 'الرقم القومي', 4: 'تاريخ التعيين',
    5: 'تاريخ انتهاء آخر تجديد', 6: 'تاريخ انتهاء العقد', 7: 'تاريخ انتهاء العقد',
    8: 'تاريخ انتهاء العقد', 9: 'تاريخ انتهاء العقد', 10: 'الاسم بالعربية',
    11: 'العنوان',
  },
  // No renewals: (5) is empty, and its line is left out of the notice.
  optional: [5],
  dropLines: [5],
  dates: terminationDates,
  values: terminationValues,
  info: [
    [3, 'الرقم القومي'],
    [4, 'تاريخ العقد (التعيين)'],
    [11, 'العنوان'],
    [5, 'تاريخ انتهاء آخر تجديد'],
    [6, 'آخر يوم عمل'],
    [7, 'تاريخ انتهاء العقد'],
  ],
  dateFields: [
    ['today', 'تاريخ الإخطار', [1]],
  ],
  inputs: [],
})
DOCUMENTS.push({
  id: 'clearance',
  title: 'إخلاء طرف',
  subtitle: 'Clearance notice',
  template: 'templates/clearance-notice.docx?v=1',
  // Its dates are the resignation's, so it is for those who have resigned.
  pool: 'resigned',
  // The delivered / not delivered boxes, the signatures and the line on
  // unfinished work are filled in by hand.
  fields: {
    1: 'تاريخ إشعار الاستقالة', 2: 'تاريخ الاستقالة (آخر يوم عمل)', 3: 'تاريخ الاستقالة (آخر يوم عمل)', 4: 'الاسم بالعربية',
    5: 'الوظيفة', 6: 'الإدارة', 7: 'تاريخ التعيين', 8: 'الإدارة',
    9: 'الموظف المستلم للأعمال', 10: 'وظيفة الموظف المستلم', 11: 'إدارة الموظف المستلم',
    12: 'تاريخ تعيين الموظف المستلم', 13: 'الاسم بالعربية',
  },
  dates: clearanceDates,
  values: clearanceValues,
  info: [
    [5, 'الوظيفة'],
    [6, 'الإدارة'],
    [7, 'تاريخ التعيين'],
    // From the record, not set here.
    [1, 'تاريخ إشعار الاستقالة'],
    [3, 'آخر يوم عمل'],
    [2, 'اليوم'],
  ],
  dateFields: [],
  inputs: [['receiver', 'الموظف المستلم للأعمال', 'employee', [9, 10, 11, 12]]],
})
DOCUMENTS.push({
  id: 'termination-settlement',
  title: 'اتفاق إنهاء علاقة عمل والتسوية النهائية',
  subtitle: 'Termination and final settlement',
  template: 'templates/termination-settlement.docx?v=1',
  // It rests on the employee's resignation.
  pool: 'resigned',
  // The address can run onto a second line.
  wrap: [4],
  fields: {
    1: 'اليوم', 2: 'تاريخ الاتفاق', 3: 'الاسم بالعربية', 4: 'العنوان', 5: 'الرقم القومي',
    6: 'تاريخ الاستقالة (آخر يوم عمل)', 7: 'تاريخ الاستقالة (آخر يوم عمل)',
  },
  dates: settlementDates,
  values: settlementValues,
  info: [
    [5, 'الرقم القومي'],
    [4, 'العنوان'],
    [7, 'تاريخ إنهاء العلاقة (الاستقالة)'],
    [6, 'اليوم'],
  ],
  dateFields: [['today', 'تاريخ الاتفاق', [1, 2]]],
  inputs: [],
})
/* A form handed out empty, for the applicant to fill in by hand: no
   employee, no blanks, nothing to check. It prints on both sides of the
   paper (duplex). */
DOCUMENTS.push({
  id: 'experience-certificate',
  title: 'شهادة خبرة',
  subtitle: 'Experience certificate',
  template: 'templates/experience-certificate.docx?v=1',
  pool: 'resigned',
  fields: {
    1: 'تاريخ الشهادة', 2: 'الاسم بالعربية', 3: 'الرقم القومي', 4: 'الوظيفة',
    5: 'تاريخ التعيين', 6: 'تاريخ الاستقالة (آخر يوم عمل)',
  },
  dates: experienceDates,
  values: experienceValues,
  info: [
    [3, 'الرقم القومي'],
    [4, 'الوظيفة'],
    [5, 'تاريخ التعيين'],
    [6, 'آخر يوم عمل'],
  ],
  dateFields: [['certificateDate', 'تاريخ شهادة الخبرة', [1]]],
  inputs: [],
})
DOCUMENTS.push({
  id: 'job-application',
  title: 'طلب توظيف',
  subtitle: 'Job application · blank form',
  template: 'templates/job-application.docx?v=1',
  blankForm: true,
  duplex: true,
  ownDirection: true,
  // Its two pages stay two, front and back: a page that runs a little
  // long here is shrunk onto its sheet, never cut onto a third.
  shrinkPages: true,
  fields: {},
  dates: () => ({}),
  values: () => ({}),
  info: [],
  dateFields: [],
  inputs: [],
})
/* The social insurance office's own form, kept as it is -- a scan of
   both sides, legal size -- and written over (see drawScan). */
DOCUMENTS.push({
  id: 'form1-social-insurance',
  title: 'نموذج ١ - طلب اشتراك مؤمن عليه',
  subtitle: 'Form 1 Social Insurance',
  template: 'templates/form1-social-insurance-1.jpg?v=2',
  scan: {
    pages: ['templates/form1-social-insurance-1.jpg?v=2', 'templates/form1-social-insurance-2.jpg?v=2'],
    size: [1275, 2100],
    paper: 'legal',
    spots: FORM1_SPOTS,
  },
  fields: {
    1: 'مكتب التأمينات', 2: 'الفئة (عاملين لدى الغير)',
    3: 'مقدم الطلب', 4: 'صفة مقدم الطلب (وظيفته)', 5: 'الرقم التأميني لمقدم الطلب',
    6: 'موبايل مقدم الطلب', 7: 'الرقم القومي لمقدم الطلب',
    8: 'الرقم التأميني', 9: 'الاسم بالعربية', 10: 'الرقم القومي', 11: 'الجنسية (من الرقم القومي)',
    12: 'المؤهل', 13: 'المهنة (المسمى التأميني)', 14: 'تاريخ الاشتراك في التأمينات',
    15: 'أجر / دخل الاشتراك', 16: 'الأجر الشامل',
    17: 'نوع المنشأة (نمطي)', 18: 'اسم المنشأة', 19: 'رقم المنشأة',
    20: 'العنوان', 21: 'المحافظة', 22: 'الموبايل الشخصي', 23: 'تاريخ التحرير',
    24: 'اسم المنشأة', 25: 'رقم المنشأة', 26: 'عنوان المنشأة', 27: 'الاسم بالعربية',
    28: 'القطاع', 29: 'كود الاشتراك', 30: 'نوع المدة',
  },
  // From the company details in the tracker's Settings, not the employee.
  companyFields: [1, 18, 19, 24, 25, 26, 28, 29, 30],
  // Front and back of one sheet, flipped on the short edge.
  duplex: 'short',
  dates: form1Dates,
  values: form1Values,
  info: [
    [8, 'الرقم التأميني'],
    [13, 'المهنة'],
    [14, 'تاريخ بدء الاشتراك'],
    [21, 'المحافظة'],
    [22, 'التليفون'],
    [4, 'صفة مقدم الطلب'],
  ],
  dateFields: [['today', 'تحريرًا في', [23]]],
  inputs: [
    ['applicant', 'مقدم الطلب', 'employee', [3, 4, 5, 6, 7]],
    ['subWage', 'أجر / دخل الاشتراك (بالأرقام الإنجليزية)', 'amount', [15], 'بالجنيه الصحيح، حتى 999999 — مثال: 8500'],
    ['fullWage', 'الأجر الشامل (بالأرقام الإنجليزية)', 'amount', [16], 'بالجنيه الصحيح، حتى 999999'],
  ],
})

/* The office's notice that a subscription has ended, for an employee
   who has resigned: kept as it is, legal size, both sides. */
DOCUMENTS.push({
  id: 'form6-social-insurance',
  title: 'نموذج ٦ - إخطار بانتهاء اشتراك مؤمن عليه',
  subtitle: 'Form 6 Social Insurance',
  template: 'templates/form6-social-insurance-1.jpg?v=1',
  scan: {
    pages: ['templates/form6-social-insurance-1.jpg?v=1', 'templates/form6-social-insurance-2.jpg?v=1'],
    size: [1276, 2101],
    paper: 'legal',
    spots: FORM6_SPOTS,
  },
  pool: 'resigned',
  duplex: 'short',
  fields: {
    1: 'مكتب التأمينات', 2: 'مقدم الطلب', 3: 'صفة مقدم الطلب (وظيفته)', 4: 'الرقم التأميني لمقدم الطلب',
    5: 'موبايل مقدم الطلب', 6: 'الرقم القومي لمقدم الطلب',
    7: 'الرقم التأميني', 8: 'الاسم بالعربية', 9: 'الرقم القومي', 10: 'رقم المنشأة', 11: 'اسم المنشأة',
    12: 'تاريخ الاستقالة (انتهاء الاشتراك)', 13: 'سبب انتهاء الاشتراك',
    14: 'اسم المنشأة', 15: 'رقم المنشأة', 16: 'عنوان المنشأة', 17: 'الاسم بالعربية', 18: 'الرقم التأميني',
  },
  companyFields: [1, 10, 11, 14, 15, 16],
  // The reason starts as a resignation; it can be changed.
  defaults: () => ({ reason: 'استقالة' }),
  dates: form6Dates,
  values: form6Values,
  info: [
    [7, 'الرقم التأميني'],
    [9, 'الرقم القومي'],
    [12, 'تاريخ انتهاء الاشتراك'],
    [3, 'صفة مقدم الطلب'],
  ],
  dateFields: [],
  inputs: [
    ['applicant', 'مقدم الطلب', 'employee', [2, 3, 4, 5, 6]],
    ['reason', 'سبب انتهاء الاشتراك', 'text', [13]],
  ],
})

/* --- Leave balance acknowledgement (إقرار برصيد الإجازات) -------------- */

/* Dated today unless the user sets it; the period runs from the start
   of the year to today unless the user sets it, as the opening balances
   on the employee record are the year's. */
export function leaveBalanceDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
    from: has(set, 'from') ? set.from : new Date(Date.UTC(today.getUTCFullYear(), 0, 1)),
    to: has(set, 'to') ? set.to : today,
  }
}

/* The days that count against the balance, by the effect of their type:
   اعتيادي (planned), عارضة (un-planned) and بدل راحة (taken from the
   added days). */
const LEAVE_KINDS = { annual: 'اعتيادي', unplanned: 'عارضة', added_days: 'بدل راحة' }

/* The employee's attendance in the period: every day's date, the effect
   of its type, and whether it was added to the balance. */
async function loadLeaveDays(supabase, emp, d) {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('work_date, add_to_leave_balance, attendance_types!inner(effect)')
    .eq('employee_id', emp.id)
    .gte('work_date', isoOf(d.from))
    .lte('work_date', isoOf(d.to))
    .order('work_date')
  if (error) throw error
  return (data || []).map((r) => ({ date: parseISO(r.work_date), effect: r.attendance_types.effect, added: !!r.add_to_leave_balance }))
}

/* The balance, as the database keeps it: the total is the planned and
   un-planned opening balances on the record plus the days added to the
   balance in the period; the days used are those taken as planned,
   un-planned or a rest day (بدل راحة). */
export function leaveBalance(emp, records = []) {
  const planned = Number(emp?.annual_leave_balance) || 0
  const unplanned = Number(emp?.unplanned_leave_balance) || 0
  const added = records.filter((r) => r.added).length
  const used = records.filter((r) => LEAVE_KINDS[r.effect])
  const total = planned + unplanned + added
  return { planned, unplanned, added, total, used, remaining: total - used.length }
}

/* A number of days in Arabic digits, with a decimal comma when there is
   a half day: 21 -> ٢١, 1.5 -> ١٫٥. */
const arDays = (n) => toArabicDigits(String(Math.round(n * 100) / 100)).replace('.', '٫').replace('-', '‏-')

/* The table of days used: 45 rows, type then date, in date order. */
const LEAVE_CELLS = 45
const LEAVE_TYPE_FIRST = 12
const LEAVE_DATE_FIRST = 57

export function leaveBalanceValues(emp, d, inputs = {}, ctx = {}) {
  const v = {
    1: arDate(d.today),
    2: emp?.arabic_name || '',
    3: jobTitle(emp),
    4: department(emp),
    5: arDate(d.hired),
    6: arDate(d.from),
    7: arDate(d.to),
    8: inputs.manager || '',
    102: emp?.arabic_name || '',
    103: arDate(d.today),
  }
  if (!emp || !ctx.fetched) return v
  const b = leaveBalance(emp, ctx.fetched)
  // Shown beside the document (info), not printed.
  v.planned = arDays(b.planned)
  v.unplanned = arDays(b.unplanned)
  v.added = arDays(b.added)
  // More days than the table holds: the blanks stay empty and the form
  // says why (leaveBalanceCheck).
  if (b.used.length > LEAVE_CELLS) return v
  v[9] = arDays(b.total)
  v[10] = arDays(b.used.length)
  v[11] = arDays(b.remaining)
  b.used.forEach((r, i) => {
    v[LEAVE_TYPE_FIRST + i] = LEAVE_KINDS[r.effect]
    v[LEAVE_DATE_FIRST + i] = arDate(r.date)
  })
  return v
}

/* What stops the form beyond an empty blank: the records still loading
   or not read, too many days for the table, or a period that ends
   before it starts. */
export function leaveBalanceCheck(emp, d, inputs = {}, ctx = {}) {
  if (!emp) return ''
  if (d.from && d.to && d.to < d.from) return 'تاريخ نهاية الفترة قبل تاريخ بدايتها.'
  if (ctx.fetchError) return `تعذر تحميل سجل الحضور: ${ctx.fetchError}`
  if (!ctx.fetched) return d.from && d.to ? 'جارٍ تحميل الإجازات من سجل الحضور…' : ''
  const n = leaveBalance(emp, ctx.fetched).used.length
  if (n > LEAVE_CELLS) {
    return `عدد أيام الإجازات المستخدمة في الفترة ${toArabicDigits(n)} يومًا، والجدول يتسع لـ ${toArabicDigits(LEAVE_CELLS)} يومًا فقط. اختر فترة أقصر.`
  }
  return ''
}

const LEAVE_TABLE = Array.from({ length: LEAVE_CELLS * 2 }, (_, i) => LEAVE_TYPE_FIRST + i)

/* The employee's acknowledgement of their annual leave balance. The
   balances come from the employee record and the days used and added
   from the attendance records; the signature is by hand. */
DOCUMENTS.push({
  id: 'leave-balance',
  title: 'إقرار برصيد الإجازات',
  subtitle: 'Leave balance acknowledgement',
  template: 'templates/leave-balance.docx?v=2',
  fields: {
    1: 'تاريخ الإقرار', 2: 'الاسم بالعربية', 3: 'الوظيفة', 4: 'الإدارة', 5: 'تاريخ التعيين',
    6: 'بداية الفترة', 7: 'نهاية الفترة', 8: 'المدير المباشر',
    9: 'رصيد الإجازات المستحق', 10: 'إجمالي الإجازات المستخدمة', 11: 'الرصيد المتبقي',
    ...Object.fromEntries(Array.from({ length: LEAVE_CELLS }, (_, i) => [LEAVE_TYPE_FIRST + i, 'نوع الإجازة'])),
    ...Object.fromEntries(Array.from({ length: LEAVE_CELLS }, (_, i) => [LEAVE_DATE_FIRST + i, 'تاريخ الإجازة'])),
    102: 'الاسم بالعربية', 103: 'تاريخ الإقرار',
  },
  // From the attendance records, not the employee record.
  fetchedFields: [9, 10, 11, ...LEAVE_TABLE],
  // The table has room for 45 days; those past the days used stay empty.
  optional: LEAVE_TABLE,
  fetch: {
    key: (emp, d) => (emp && d.from && d.to && d.from <= d.to ? `${emp.id}|${isoOf(d.from)}|${isoOf(d.to)}` : ''),
    load: loadLeaveDays,
  },
  check: leaveBalanceCheck,
  dates: leaveBalanceDates,
  values: leaveBalanceValues,
  info: [
    [3, 'الوظيفة'],
    [4, 'الإدارة'],
    [5, 'تاريخ التعيين'],
    ['planned', 'رصيد اعتيادي'],
    ['unplanned', 'رصيد عارضة'],
    ['added', 'أيام بدل راحة مضافة'],
    [9, 'إجمالي الرصيد المستحق'],
    [10, 'الإجازات المستخدمة'],
    [11, 'الرصيد المتبقي'],
  ],
  dateFields: [
    ['today', 'تاريخ الإقرار', [1, 103]],
    ['from', 'بداية الفترة', [6]],
    ['to', 'نهاية الفترة', [7]],
  ],
  inputs: [
    ['manager', 'المدير المباشر', 'person', [8]],
  ],
})

/* A warning to an employee absent without leave, under article 166 of
   the labour law. The days absent come from the attendance records. The
   employee's acknowledgement at the foot is printed only when the box
   for it is ticked; the signatures and the date are by hand. */
DOCUMENTS.push({
  id: 'absence-warning',
  title: 'إخطار رسمي بشأن الغياب عن العمل',
  subtitle: 'Absence warning',
  template: 'templates/absence-warning.docx?v=3',
  fields: {
    1: 'تاريخ الإخطار', 2: 'الاسم بالعربية', 3: 'الرقم القومي', 4: 'شهر وسنة إصدار البطاقة',
    5: 'الرقم التأميني', 6: 'العنوان', 7: 'تاريخ التعيين', 8: 'الوظيفة', 9: 'الإدارة',
    10: 'بداية الفترة', 11: 'نهاية الفترة',
    12: 'عدد أيام الغياب المتقطعة', 13: 'عدد أيام الغياب المتصلة',
    ...Object.fromEntries(Array.from({ length: ABSENCE_CELLS }, (_, i) => [ABSENCE_FIRST + i, 'أيام الغياب'])),
  },
  // From the attendance records, not the employee record.
  fetchedFields: [12, 13, ...Array.from({ length: ABSENCE_CELLS }, (_, i) => ABSENCE_FIRST + i)],
  // The table has room for 22 days; those past the days absent stay empty.
  optional: Array.from({ length: ABSENCE_CELLS - 1 }, (_, i) => ABSENCE_FIRST + 1 + i),
  // The address can run onto a second line.
  wrap: [6],
  fetch: {
    key: (emp, d) => (emp && d.from && d.to && d.from <= d.to ? `${emp.id}|${isoOf(d.from)}|${isoOf(d.to)}` : ''),
    load: loadAttendance,
  },
  check: absenceCheck,
  dates: absenceDates,
  values: absenceValues,
  info: [
    [3, 'الرقم القومي'],
    [5, 'الرقم التأميني'],
    [7, 'تاريخ التعيين'],
    [8, 'الوظيفة'],
    [9, 'الإدارة'],
    [12, 'أيام الغياب في الفترة'],
    [13, 'أطول غياب متصل'],
  ],
  dateFields: [
    ['today', 'تاريخ الإخطار', [1]],
    ['from', 'بداية الفترة', [10]],
    ['to', 'نهاية الفترة', [11]],
  ],
  inputs: [
    ['acknowledge', 'الموظف سيوقع بالاستلام (طباعة إقرار الموظف)', 'flag', []],
  ],
  // From the acknowledgement to the end of the page.
  sections: [{ input: 'acknowledge', from: 'أقر أنا الموقع أدناه' }],
})

for (const def of DOCUMENTS) def.blanks = Object.keys(def.fields).map(Number)

/* Several forms as one: their templates drawn one after another, for one
   employee, with what they have in common chosen once. Part i's blanks
   are numbered from (i + 1) * 100 -- blank (3) of the first part is 103
   -- and each part is still filled by its own form's rules. Dates and
   values the user gives are shared by key: one date "today", one admin,
   whichever parts use them. */
export function combine(head, parts) {
  const at = parts.map((def, i) => ({ def, off: (i + 1) * 100 }))
  const move = (off, list) => list.map((n) => off + n)
  const merged = (pick) => {
    const out = new Map()
    for (const { def, off } of at) {
      for (const [key, label, ...rest] of pick(def)) {
        const fields = move(off, Array.isArray(rest[0]) ? rest[0] : rest[1])
        const was = out.get(key)
        if (was) was.fields.push(...fields)
        else out.set(key, { key, label, rest, fields })
      }
    }
    return [...out.values()]
  }
  const ref = at.find(({ def }) => def.refTable)
  return {
    ...head,
    parts: at,
    fields: Object.assign({}, ...at.map(({ def, off }) =>
      Object.fromEntries(Object.entries(def.fields).map(([n, label]) => [off + +n, label])))),
    optional: at.flatMap(({ def, off }) => move(off, def.optional || [])),
    dropLines: at.flatMap(({ def, off }) => move(off, def.dropLines || [])),
    wrap: at.flatMap(({ def, off }) => move(off, def.wrap || [])),
    // Each label once, at its first place.
    info: at.flatMap(({ def, off }) => def.info.map(([n, label]) => [off + n, label]))
      .filter(([, label], i, all) => all.findIndex(([, l]) => l === label) === i),
    dateFields: merged((def) => def.dateFields).map(({ key, label, rest, fields }) => [key, label, fields, ...rest.slice(1)]),
    inputs: merged((def) => def.inputs).map(({ key, label, rest, fields }) => [key, label, rest[0], fields, ...rest.slice(2)]),
    refTable: ref ? { ...ref.def.refTable, first: ref.def.refTable.first + ref.off } : undefined,
    defaults: (emp) => Object.assign({}, ...at.map(({ def }) => def.defaults?.(emp) || {})),
    dates: (emp, set) => {
      const each = at.map(({ def }) => def.dates(emp, set))
      return Object.assign({}, ...each, { parts: each })
    },
    values: (emp, d, inputs, ctx) => Object.assign({}, ...at.map(({ def, off }, i) => {
      const v = def.values(emp, d.parts[i], inputs, ctx)
      return Object.fromEntries(Object.entries(v).map(([n, x]) => [off + +n, x]))
    })),
  }
}

/* Forms put together as one (combine), in the list where the earliest of
   them was, whatever order the pack prints them in; the single forms
   leave the list. */
function pack(head, ids, fix = (p) => p) {
  const at = Math.min(...ids.map((id) => DOCUMENTS.findIndex((d) => d.id === id)).filter((i) => i >= 0))
  const p = fix(combine(head, ids.map((id) => DOCUMENTS.find((d) => d.id === id))))
  p.template = p.parts[0].def.template
  p.blanks = Object.keys(p.fields).map(Number)
  for (let i = DOCUMENTS.length - 1; i >= 0; i--) if (ids.includes(DOCUMENTS[i].id)) DOCUMENTS.splice(i, 1)
  DOCUMENTS.splice(Math.min(at, DOCUMENTS.length), 0, p)
}

/* The hiring papers, signed together on the first day: the contract,
   the work start acknowledgement, the social status declaration, the
   confidentiality declaration and, last, the letter to the bank to open
   the salary account. One form in place of the five. */
pack({
  id: 'hiring-pack',
  title: 'مستندات التعيين',
  subtitle: 'Hiring papers · contract, work start, social status, confidentiality, bank account letter',
}, ['hiring', 'work-start', 'social-status', 'confidentiality', 'bank-account'], (p) => {
  // One date for all five.
  p.dateFields = p.dateFields.map(([key, label, ...rest]) => [key, key === 'today' ? 'تاريخ المستندات' : label, ...rest])
  // The contract is signed in four copies: Print gives it four times.
  p.parts[0].copies = 4
  return p
})

/* The leaving papers, for an employee with a resignation on record: the
   notice that the contract is not renewed, the resignation, the
   clearance notice, the termination and final settlement agreement and,
   last, the experience certificate.
   Each keeps its own dates: the resignation's from the record, the
   notice's own date and its contract expiry. */
pack({
  id: 'leaving-pack',
  title: 'مستندات إنهاء الخدمة',
  subtitle: 'Leaving papers · non-renewal notice, resignation, clearance, settlement, experience certificate',
  pool: 'resigned',
}, ['termination-notice', 'resignation', 'clearance', 'termination-settlement', 'experience-certificate'], (p) => {
  // The notice and the agreement share one date.
  p.dateFields = p.dateFields.map(([key, label, ...rest]) => [key, key === 'today' ? 'تاريخ الإخطار والاتفاق' : label, ...rest])
  return p
})

/* ------------------------------------------------------------------ */
/* Template preparation                                                 */
/* ------------------------------------------------------------------ */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
/* A blank as typed in the template: a number in brackets. Word often
   stores "(", "3" and ")" as three separate runs, and one of the
   template's brackets is typed backwards, so either bracket is
   accepted on either side. Up to three digits: the leave balance
   acknowledgement has more than 99 blanks (it is never part of a pack,
   whose parts are numbered by hundreds). */
const BLANK = /[()]\s*(\d{1,3})\s*[()]/g
const MARK = (n) => `⟦${n}⟧` // ⟦n⟧
const MARK_RE = /⟦(\d{1,4})⟧/g

/* Rewrite every blank in document.xml as a single ⟦n⟧ inside one run,
   keeping that run's formatting, so it can be found again once the
   document is drawn. In a form made of several templates (parts), each
   template's blanks are moved up by its part's offset -- blank (3) of
   the second part is ⟦203⟧ -- so no two parts share a number. */
export function markBlanks(xml, blanks, off = 0) {
  const allowed = new Set(blanks.map(String))
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  for (const p of Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))) {
    const nodes = Array.from(p.getElementsByTagNameNS(W_NS, 't'))
    if (!nodes.length) continue
    const text = nodes.map((t) => t.textContent).join('')
    const matches = Array.from(text.matchAll(BLANK)).filter((m) => allowed.has(String(+m[1])))
    // Last first, so earlier offsets stay valid.
    for (const m of matches.reverse()) {
      const from = m.index
      const to = m.index + m[0].length
      let pos = 0
      let first = true
      for (const t of nodes) {
        const s = t.textContent
        const a = pos
        const b = pos + s.length
        pos = b
        if (b <= from || a >= to) continue
        const keepBefore = s.slice(0, Math.max(0, from - a))
        const keepAfter = s.slice(Math.max(0, to - a))
        t.textContent = first ? keepBefore + MARK(off + +m[1]) + keepAfter : keepBefore + keepAfter
        t.setAttributeNS(XML_NS, 'xml:space', 'preserve')
        first = false
      }
    }
  }
  return new XMLSerializer().serializeToString(doc)
}

/* The page border the template sets, in pixels: line width, and how far
   in from the page edge. Null when there is none. */
export function pageBorder(xml) {
  const b = /<w:pgBorders\b([^>]*)>([\s\S]*?)<\/w:pgBorders>/.exec(xml)
  if (!b) return null
  const top = /<w:top\b[^>]*>/.exec(b[2])
  if (!top || /w:val="(none|nil)"/.test(top[0])) return null
  const num = (re, dflt) => { const m = re.exec(top[0]); return m ? +m[1] : dflt }
  const px = (pt) => (pt * 4) / 3
  const space = num(/w:space="(\d+)"/, 24)
  const fromText = /w:offsetFrom="text"/.test(b[1])
  return {
    width: Math.max(1, Math.round(px(num(/w:sz="(\d+)"/, 4) / 8))),
    // Measured from the page edge, or from the text, which starts 0.5in
    // (48px) in on both templates.
    inset: fromText ? Math.max(0, 48 - px(space)) : px(space),
  }
}

/* Arabic text takes its size, bold and italic from Word's complex-script
   settings (szCs, bCs, iCs); the Latin ones (sz, b, i) apply to Latin
   text only. The renderer reads only the Latin ones, so a title set at
   16pt bold for Arabic would show at whatever the Latin size is -- 7pt,
   in the hiring contract. These documents are Arabic, so the complex-
   script settings are written over the Latin ones, everywhere. */
export function useArabicRunProps(xml) {
  return xml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (all, body) => {
    const pick = (tag) => {
      const m = new RegExp(`<w:${tag}(\\s[^>]*)?/>`).exec(body)
      return m ? (m[1] || '') : null
    }
    const b = pick('bCs')
    const i = pick('iCs')
    const sz = pick('szCs')
    let out = body.replace(/<w:(?:b|i|sz)(?:\s[^>]*)?\/>/g, '')
    if (b !== null) out += `<w:b${b}/>`
    if (i !== null) out += `<w:i${i}/>`
    if (sz !== null) out += `<w:sz${sz}/>`
    return `<w:rPr>${out}</w:rPr>`
  })
}

/* An empty paragraph in Word is a full line, as tall as its paragraph
   mark's font. The renderer gives it the browser's default height
   instead, which in a template that lines rows up with empty lines puts
   everything after them out of place. Each empty paragraph is given one
   invisible character (a zero-width space) in its paragraph mark's
   formatting, so it is exactly one line of the right size. */
export function holdEmptyLines(xml) {
  return xml.replace(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, (p) => {
    if (/<w:p\b[^>]*\/>/.test(p.slice(0, p.indexOf('>') + 1))) return p
    const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] || ''
    const rest = p.replace(pPr, '')
    if (/<w:(t|tab|br|drawing|pict|object|sym|fldSimple|instrText)\b/.test(rest)) return p
    const mark = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(pPr.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/, ''))?.[0] || ''
    return p.replace(/<\/w:p>$/, `<w:r>${mark}<w:t>\u200b</w:t></w:r></w:p>`)
  })
}

/* Word draws one box around consecutive paragraphs that have the same
   borders: the top border over the first of them, the bottom border under
   the last, none in between. The renderer borders each paragraph on its
   own, so an empty paragraph above a title, bordered like it, drew a
   second line above the title. Within each such run, only the first
   keeps its top border and only the last its bottom border. */
export function mergeParagraphBorders(xml) {
  const body = xml.indexOf('<w:body')
  const paras = [...xml.slice(body).matchAll(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g)]
  const border = (p) => /<w:pBdr>[\s\S]*?<\/w:pBdr>/.exec(/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] || '')?.[0] || ''
  const edits = []
  for (let i = 0; i < paras.length; i++) {
    const b = border(paras[i][0])
    if (!b) continue
    // Next to each other in the document, with nothing between them.
    const prevSame = i > 0 && border(paras[i - 1][0]) === b && paras[i - 1].index + paras[i - 1][0].length === paras[i].index
    const nextSame = i + 1 < paras.length && border(paras[i + 1][0]) === b && paras[i].index + paras[i][0].length === paras[i + 1].index
    if (!prevSame && !nextSame) continue
    let nb = b
    if (prevSame) nb = nb.replace(/<w:top\b[^>]*\/>/, '')
    if (nextSame) nb = nb.replace(/<w:bottom\b[^>]*\/>/, '')
    if (nb !== b) edits.push([body + paras[i].index, paras[i][0], paras[i][0].replace(b, nb)])
  }
  for (const [at, from, to] of edits.reverse()) xml = xml.slice(0, at) + to + xml.slice(at + from.length)
  return xml
}

/* For every table in the body, in document order (nested ones too),
   whether Word lays it out right to left (bidiVisual: the first column
   on the right). The renderer does not read it, so it is turned here. */
export function readTableDirections(xml) {
  return [...xml.matchAll(/<w:tbl>\s*<w:tblPr>([\s\S]*?)<\/w:tblPr>/g)].map((m) => /<w:bidiVisual(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(m[1]))
}

const templateCache = new Map()
async function loadTemplate(def, off = 0) {
  const url = def.template
  const key = `${url}|${off}`
  if (!templateCache.has(key)) {
    templateCache.set(key, (async () => {
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`Template not found (${res.status})`)
      const zip = await JSZip.loadAsync(await res.arrayBuffer())
      let xml = await zip.file('word/document.xml').async('string')
      const border = pageBorder(xml)
      const tabStops = readTabStops(xml)
      const rtlTables = readTableDirections(xml)
      const settings = zip.file('word/settings.xml') ? await zip.file('word/settings.xml').async('string') : ''
      const defaultTab = +(/<w:defaultTabStop w:val="(\d+)"/.exec(settings)?.[1] || 720) / 20
      // Kashida justification is how Word justifies Arabic; the renderer
      // does not know it and would leave those paragraphs unaligned.
      xml = xml.replace(/(<w:jc w:val=")(?:low|medium|high)Kashida(")/g, '$1both$2')
      zip.file('word/document.xml', markBlanks(useArabicRunProps(holdEmptyLines(mergeParagraphBorders(xml))), def.blanks, off))
      for (const name of Object.keys(zip.files)) {
        if (/^word\/(styles|header\d*|footer\d*)\.xml$/.test(name)) {
          zip.file(name, useArabicRunProps(await zip.file(name).async('string')))
        }
      }
      return { blob: await zip.generateAsync({ type: 'blob' }), border, tabStops, defaultTab, rtlTables }
    })())
  }
  return templateCache.get(key)
}

/* ------------------------------------------------------------------ */
/* Tabs in right-to-left paragraphs                                     */
/* ------------------------------------------------------------------ */

/* The tab stops of every paragraph in the body that has a tab in its
   text, in document order, in points: [{ pos, type }]. Read from the
   template, since the renderer keeps them to itself. */
export function readTabStops(xml) {
  const out = []
  const body = xml.slice(xml.indexOf('<w:body'))
  for (const m of body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0]
    const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] || ''
    if (!p.replace(pPr, '').includes('<w:tab/>')) continue
    const stops = [...pPr.matchAll(/<w:tab w:val="(\w+)"[^>]*w:pos="(-?\d+)"/g)]
      .filter((t) => t[1] !== 'clear')
      .map((t) => ({ type: t[1], pos: +t[2] / 20 }))
      .sort((a, b) => a.pos - b.pos)
    out.push(stops)
  }
  return out
}

/* The renderer draws a tab as a span holding one em space and nothing
   else; mark them, so layoutTabs can find them. */
function markTabs(root) {
  for (const span of root.querySelectorAll('section.docx span')) {
    if (span.childNodes.length === 1 && span.firstChild.nodeType === Node.TEXT_NODE
        && span.firstChild.nodeValue === '\u2003' && !span.className) {
      span.className = 'docx-tab-stop'
    }
  }
}

/* Word measures tab stops in a right-to-left paragraph from the right
   edge; the renderer measures them from the left, as for English, and
   only once, before the blanks are filled. So every tab in a right-to-
   left paragraph is laid out again here, from the right, each time the
   values change: a "center" stop centres the text that follows it on the
   stop, an "end" stop ends it there, any other starts it there. Past the
   last stop, stops fall every defaultTab points. */
function layoutTabs(root) {
  const parts = root.classList.contains('hr-part') ? [root] : [...root.querySelectorAll('.hr-part')]
  for (const part of parts) layoutPartTabs(part, part._hr || {})
}

/* One template's tabs: its tab stops and default tab, as read from it. */
function layoutPartTabs(root, { tabStops: stopsList, defaultTab = 36, def }) {
  if (!stopsList) return
  const paras = [...root.querySelectorAll('section.docx article p')].filter((p) => p.querySelector('.docx-tab-stop'))
  if (paras.length !== stopsList.length) return // not the paragraphs we read; leave them be
  const PT = 0.75 // CSS px to points
  paras.forEach((p, i) => {
    if (p.dir !== 'rtl') return
    /* A tab is drawn as an empty box of the width it spans. The renderer
       draws it as a non-breaking space stretched by word spacing, which
       the browser will not end a line on: a tab after a blank pulled the
       blank onto a line of its own, where in Word it stays put. */
    const tabs = [...p.querySelectorAll('.docx-tab-stop')]
    for (const br of p.querySelectorAll('br.docx-tab-wrap')) br.remove()
    for (const t of tabs) {
      t.innerHTML = ''
      t.style.wordSpacing = ''
      t.style.textDecoration = ''
      t.style.display = 'inline-block'
      t.style.width = '0'
    }
    const pb0 = p.getBoundingClientRect()
    const scale = pb0.width ? p.offsetWidth / pb0.width : 1 // undoes any zoom on the preview
    const stops = [...stopsList[i]]
    const last = stops.length ? stops[stops.length - 1].pos : 0
    for (let pos = last + defaultTab; pos < 1000; pos += defaultTab) stops.push({ type: 'start', pos })
    tabs.forEach((tab, k) => {
      const pb = p.getBoundingClientRect()
      const right = pb.right - parseFloat(getComputedStyle(p).paddingRight) / scale
      const where = () => (right - tab.getBoundingClientRect().right) * scale * PT // where the tab starts, from the right
      let at = where()
      let stop = stops.find((s) => s.pos > at + 0.5)
      if (!stop) return
      /* A tab whose next stop lies past the line's end goes to the start
         of the next line, as in Word, and is measured from there: a row
         of options set out with tabs goes on under the row above, column
         under column. Only where text follows it; tabs at the very end
         of a paragraph stay where they are. Only for a form that asks
         for it (tabsWrap): the forms before it were set out without. */
      const line = (pb.width * scale - parseFloat(getComputedStyle(p).paddingLeft) - parseFloat(getComputedStyle(p).paddingRight)) * PT
      if (def?.tabsWrap && stop.pos > line + 0.5 && at > 0.5 && textAfter(p, tab)) {
        const br = document.createElement('br')
        br.className = 'docx-tab-wrap'
        tab.before(br)
        at = where()
        stop = stops.find((s) => s.pos > at + 0.5)
        if (!stop) return
      }
      const range = document.createRange()
      range.setStartAfter(tab)
      if (tabs[k + 1]) range.setEndBefore(tabs[k + 1])
      else range.setEndAfter(p.lastChild)
      const w = range.getBoundingClientRect().width * scale * PT // the text that follows
      let width = stop.pos - at
      if (stop.type === 'center') width -= w / 2
      else if (stop.type === 'end' || stop.type === 'right' || stop.type === 'decimal') width -= w
      // No further than the line has room for, with what follows: a tab
      // that runs past the margin does not start a line of its own in
      // Word, and must not here either.
      const room = (pb.width * scale - parseFloat(getComputedStyle(p).paddingLeft) - parseFloat(getComputedStyle(p).paddingRight)) * PT - at - w - 1
      width = Math.min(width, room)
      tab.style.width = `${Math.max(0, width).toFixed(1)}pt`
    })
  })
}

/* Whether any text that shows comes after this node in the paragraph. */
function textAfter(p, node) {
  const range = document.createRange()
  range.setStartAfter(node)
  range.setEndAfter(p.lastChild)
  return /[^\s\u00a0\u2003\u200b\u200f\u2066-\u2069]/.test(range.toString())
}

/* ------------------------------------------------------------------ */
/* Keeping the template's lines                                         */
/* ------------------------------------------------------------------ */

/* How many lines a paragraph takes on screen. */
function lineCount(p) {
  // Only text that shows counts: a tab or spaces at the end of a line
  // hang off it in Word, and must not count as a line of their own.
  const tops = []
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.nodeValue.replace(/[\s\u00a0\u200b\u200f\u2066-\u2069]/g, '')) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const r of range.getClientRects()) if (r.width > 0.5) tops.push(r.top)
  }
  tops.sort((x, y) => x - y)
  // Runs of different sizes on one line sit a pixel or two apart, so
  // tops closer than 5px are the same line.
  let lines = 0
  let last = -Infinity
  for (const t of tops) {
    if (t - last > 5) lines++
    last = t
  }
  return Math.max(1, lines)
}

/* A line that is one line in the template stays one line when filled,
   so the page keeps the Word file's layout -- rows in two columns stay
   level with each other, nothing below moves down. When a value makes
   such a line too long, its text is narrowed to fit, as little as it
   takes, instead of wrapping. Paragraphs that already run over several
   lines reflow as Word reflows them. The count is taken once, when the
   document is drawn, with the blanks still empty. */
function rememberLines(root) {
  // Blanks a document lists in `wrap` take free text of any length: the
  // line they are on wraps as Word would wrap it, rather than squeezing.
  const wrap = new Set((state.def?.wrap || []).map(String))
  for (const p of root.querySelectorAll('section.docx p')) {
    if (!p.querySelector('.hr-field')) continue
    if ([...p.querySelectorAll('.hr-field')].some((f) => wrap.has(f.dataset.field))) continue
    p.dataset.lines = String(lineCount(p))
  }
  /* In a section set in columns, every short line is one line in Word --
     the template lines its two columns up row by row -- so it is held to
     one line here too, filled in or not, whatever the browser's font. */
  for (const article of root.querySelectorAll('section.docx article')) {
    if (!article.style.columnCount) continue
    for (const p of article.querySelectorAll('p')) {
      if (!p.closest('table') && p.textContent.trim().length < 80) p.dataset.lines = '1'
    }
  }
}

/* Word fills the columns of a section like that by balancing them: with
   every paragraph one line, the first column takes the first half of the
   paragraphs and the second the rest. The browser balances by its own
   measure and can be a line out, which moves a row to the wrong column;
   so the second column is made to start where Word starts it. */
function splitColumns(root) {
  for (const article of root.querySelectorAll('section.docx article')) {
    const cols = +article.style.columnCount
    if (cols !== 2) continue
    const paras = [...article.children]
    if (paras.some((el) => el.tagName !== 'P')) continue // a table or a list: leave it to the browser
    const first = paras[Math.ceil(paras.length / 2)]
    if (first) first.style.breakBefore = 'column'
  }
}

function releaseLines(root) {
  for (const p of root.querySelectorAll('section.docx p[data-lines]')) {
    p.classList.remove('hr-one-line')
    p.style.transform = ''
    p.style.transformOrigin = ''
  }
}

function keepLines(root) {
  for (const p of root.querySelectorAll('section.docx p[data-lines="1"]')) {
    if (!p.textContent.replace(/\u200b/g, '').trim()) continue
    if (lineCount(p) <= 1) continue
    // On the paragraph and every run in it: the renderer sets pre-wrap
    // on each run, which a rule on the paragraph alone would not reach.
    p.classList.add('hr-one-line')
    // The width the text takes on one line. scrollWidth will not do: text
    // running right to left spills over the left edge, which it ignores.
    const pb = p.getBoundingClientRect()
    const scale = pb.width ? p.clientWidth / pb.width : 1
    const range = document.createRange()
    range.selectNodeContents(p)
    const need = range.getBoundingClientRect().width * scale
    const room = p.clientWidth - parseFloat(getComputedStyle(p).paddingLeft) - parseFloat(getComputedStyle(p).paddingRight)
    if (need <= room || !room) continue
    p.style.transformOrigin = p.dir === 'rtl' ? 'right center' : 'left center'
    p.style.transform = `scaleX(${(room / need).toFixed(4)})`
  }
}

/* ------------------------------------------------------------------ */
/* Drawing the document                                                 */
/* ------------------------------------------------------------------ */

/* The document's text, and only that: the renderer puts its stylesheet
   in the same element, and rewriting the digits in it ("12pt" into
   "١٢pt", ".docx_style1" into ".docx_style١") would quietly drop every
   style -- bold titles, sizes, spacing. */
function textNodes(root) {
  const out = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest('section.docx') && !n.parentElement.closest('style, script')
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  })
  while (walker.nextNode()) out.push(walker.currentNode)
  return out
}

/* Turn each ⟦n⟧ into a locked field, and write every other number in
   the document in Arabic digits. */
function lockBlanks(root) {
  for (const node of textNodes(root)) {
    const s = node.nodeValue
    MARK_RE.lastIndex = 0
    if (!MARK_RE.test(s)) {
      if (/[0-9]/.test(s)) node.nodeValue = toArabicDigits(s)
      continue
    }
    const frag = document.createDocumentFragment()
    let last = 0
    MARK_RE.lastIndex = 0
    for (const m of s.matchAll(MARK_RE)) {
      if (m.index > last) frag.appendChild(document.createTextNode(toArabicDigits(s.slice(last, m.index))))
      const span = document.createElement('span')
      span.className = 'hr-field is-empty'
      span.dataset.field = m[1]
      span.contentEditable = 'false'
      span.textContent = '……'
      frag.appendChild(span)
      last = m.index + m[0].length
    }
    if (last < s.length) frag.appendChild(document.createTextNode(toArabicDigits(s.slice(last))))
    node.parentNode.replaceChild(frag, node)
  }
}

/* Every paragraph reads right to left. The template marks only some of
   its paragraphs that way, and the Word renderer takes "left" literally,
   so a paragraph aligned to its start is aligned right here. Centred and
   justified paragraphs keep their alignment; a justified paragraph's
   last line now ends on the right. The signature table keeps its column
   order, the company on the right. */
function rightToLeft(root, rtlTables = []) {
  /* A section in columns fills them from the right, as Word does in a
     right-to-left document: CSS columns follow the direction of the
     element that holds them. Tables inside keep the column order they
     have in Word, which is left to right. */
  for (const article of root.querySelectorAll('section.docx article')) {
    if (!article.style.columnCount) continue
    article.dir = 'rtl'
    for (const table of article.querySelectorAll('table')) table.dir = 'ltr'
  }
  /* A table set right to left in Word keeps its first column on the
     right, as in Word. */
  const tables = [...root.querySelectorAll('section.docx article table')]
  if (tables.length === rtlTables.length) tables.forEach((t, i) => { if (rtlTables[i]) t.dir = 'rtl' })
  for (const p of root.querySelectorAll('section.docx p')) {
    p.dir = 'rtl'
    const align = getComputedStyle(p).textAlign
    if (align === 'left' || align === 'start' || align === '-webkit-left') p.style.textAlign = 'right'
  }
}

/* A bilingual form whose template sets each paragraph's direction itself
   -- Arabic right to left, English left to right -- keeps it. Its tables
   are right to left in Word (bidiVisual: the first column on the right),
   which the renderer does not read, so they are turned here; each cell's
   paragraphs keep the direction they had before. In a right-to-left
   paragraph Word reads "left" and "right" alignment the other way round
   ("right" puts it on the left, at the line's end); the renderer takes
   them as written, so they are swapped back. */
function keepDirection(root) {
  // A table centred on the page is not centred text: the renderer lets
  // the one pass into the other, centring every cell that sets nothing.
  for (const el of root.querySelectorAll('section.docx table, section.docx tr, section.docx td')) el.style.textAlign = 'start'
  const paras = [...root.querySelectorAll('section.docx p')]
  const looks = paras.map((p) => {
    const cs = getComputedStyle(p)
    return [cs.direction, cs.textAlign]
  })
  for (const t of root.querySelectorAll('section.docx table')) t.dir = 'rtl'
  paras.forEach((p, i) => {
    const [dir, align] = looks[i]
    p.dir = dir
    if (dir === 'rtl' && align === 'right') p.style.textAlign = 'left'
    else if (dir === 'rtl' && align === 'left') p.style.textAlign = 'right'
  })
}

/* A line around each page, as thick and as far in as the template's page
   border sets it. The Word renderer reads page borders but does not draw
   them, so the line is drawn here; it is part of the page, so it is in
   the PDF too. */
function frame(root, border) {
  if (!border) return
  for (const page of root.querySelectorAll('section.docx')) {
    const line = document.createElement('div')
    line.className = 'hr-page-frame'
    line.contentEditable = 'false'
    line.setAttribute('aria-hidden', 'true')
    line.style.inset = `${border.inset}px`
    line.style.borderWidth = `${border.width}px`
    page.prepend(line)
  }
}

/* The template's footer carries the page number as Word last saved it,
   the same on every page; each page gets its own here. */
function numberPages(root) {
  root.querySelectorAll('section.docx').forEach((page, i) => {
    const footer = page.querySelector('footer')
    if (!footer) return
    for (const node of textNodes(footer)) {
      if (/^\s*[0-9٠-٩]+\s*$/.test(node.nodeValue)) node.nodeValue = toArabicDigits(i + 1)
    }
  })
}

async function drawDocument(def) {
  const preview = $('preview')
  const status = $('previewStatus')
  preview.innerHTML = ''
  status.hidden = false
  status.textContent = 'Loading document…'
  /* A form is one template, or several drawn one after another (parts),
     each in a box of its own with what was read from its template: its
     page border, tab stops and table directions. */
  if (def.scan) {
    drawScan(def, preview)
    status.hidden = true
    fitPreview()
    return
  }
  const parts = def.parts || [{ def, off: 0 }]
  for (const [i, part] of parts.entries()) {
    const t = await loadTemplate(part.def, part.off)
    const box = document.createElement('div')
    box.className = 'hr-part'
    box.dataset.part = String(i)
    if (state.skip.has(i)) box.classList.add('is-skipped')
    box._hr = { ...t, def: part.def, copies: part.copies || 1 }
    preview.appendChild(box)
    await renderAsync(t.blob, box, null, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      // Start a new page where Word last did when the template was saved,
      // so a contract of several pages splits where it does in Word.
      ignoreLastRenderedPageBreak: false,
      // Off: its only effect is the renderer's own tab layout, which
      // measures from the left and runs again half a second after drawing,
      // over the right-to-left layout done here (layoutTabs).
      experimental: false,
      renderHeaders: true,
      renderFooters: true,
    })
    countLists(box)
    if (parts.length > 1) scopeStyles(box)
    markTabs(box)
    lockBlanks(box)
    matchFieldSize(box)
    if (part.def.ownDirection) keepDirection(box)
    else rightToLeft(box, t.rtlTables)
    frame(box, t.border)
    numberPages(box)
    layoutTabs(box)
    rememberLines(box)
    splitColumns(box)
  }
  status.hidden = true
  fitPreview()
}

/* ------------------------------------------------------------------ */
/* Scanned forms                                                        */
/* ------------------------------------------------------------------ */

/* A form that comes as a scan -- a picture of each page, with no text to
   fill -- keeps the picture as it is, and each blank is written over it
   where it sits on the page (def.scan.spots), measured in the picture's
   own pixels (def.scan.size):
     line   text on a dotted line, ending at its right end, as Arabic is
            written; it is made smaller rather than run past the line
     cells  one character to a box, the boxes listed in the order the
            characters go in; align 'end' fills the last boxes first, so a
            number shorter than its row still ends in the last box. A value
            with "|" in it gives each box a part of its own (a date's day,
            month and year).
     mark   a tick in a box
   The pages are A4 or legal (def.scan.paper) and print at that size.
   typed: true sets the text on lines as plain Times New Roman, 12 pt, as
   if typed in Word -- for pages saved from Word itself, whose labels are
   set that way -- instead of the large bold lettering a scan needs. */
export const PAPER = { a4: { w: 210, h: 297 }, legal: { w: 215.9, h: 355.6 } }

function drawScan(def, preview) {
  const { pages, size: [W, H], spots, paper = 'a4' } = def.scan
  const box = document.createElement('div')
  box.className = 'hr-part'
  box.dataset.part = '0'
  box._hr = { def, border: null }
  const wrap = document.createElement('div')
  wrap.className = 'docx-wrapper'
  box.appendChild(wrap)
  preview.appendChild(box)
  const pct = (v, of) => `${((v / of) * 100).toFixed(4)}%`
  const { w, h } = PAPER[paper]
  pages.forEach((src, i) => {
    const page = document.createElement('section')
    page.className = 'docx hr-scan'
    // Full size: 96 CSS pixels to the inch.
    page.style.width = `${((w / 25.4) * 96).toFixed(2)}px`
    page.style.height = `${((h / 25.4) * 96).toFixed(2)}px`
    const img = document.createElement('img')
    img.className = 'hr-scan-page'
    img.src = src
    img.alt = ''
    img.draggable = false
    page.appendChild(img)
    for (const spot of spots.filter((sp) => (sp.page || 1) === i + 1)) {
      const span = document.createElement('span')
      span.className = `hr-field is-empty hr-spot hr-spot-${spot.kind}`
      span.dataset.field = String(spot.n)
      span.contentEditable = 'false'
      const [x0, x1] = spot.kind === 'cells'
        ? [Math.min(...spot.cells.map((c) => c[0])), Math.max(...spot.cells.map((c) => c[1]))]
        : spot.x
      const [y0, y1] = spot.y
      Object.assign(span.style, { left: pct(x0, W), width: pct(x1 - x0, W), top: pct(y0, H), height: pct(y1 - y0, H) })
      if (spot.kind === 'cells') {
        span._cells = spot.cells.map(([a, b]) => {
          const cell = document.createElement('span')
          cell.className = 'hr-cell'
          Object.assign(cell.style, { left: pct(a - x0, x1 - x0), width: pct(b - a, x1 - x0) })
          return cell
        })
        span._align = spot.align || 'start'
      } else {
        span.dir = spot.dir || 'rtl'
        if (def.scan.typed && spot.kind === 'line') span.classList.add('hr-spot-typed')
      }
      span.textContent = '……'
      page.appendChild(span)
    }
    wrap.appendChild(page)
  })
}

/* A value written into a row of boxes. */
function fillCells(span, v) {
  const cells = span._cells
  let parts = !v ? [] : String(v).includes('|') ? String(v).split('|') : [...String(v)]
  if (span._align === 'end' && parts.length < cells.length) parts = [...Array(cells.length - parts.length).fill(''), ...parts]
  span.textContent = ''
  cells.forEach((cell, i) => {
    cell.textContent = parts[i] || ''
    span.appendChild(cell)
  })
  if (!v) span.appendChild(document.createTextNode('……'))
}

/* Text on a line is made smaller, as little as it takes, to stay on it. */
function fitSpot(span) {
  span.style.fontSize = ''
  if (!span.classList.contains('hr-spot-line')) return
  let size = parseFloat(getComputedStyle(span).fontSize)
  /* The text's own width: scrollWidth misses text that runs out on the
     left, which is where a line ending on the right overflows. */
  const room = () => span.clientWidth - parseFloat(getComputedStyle(span).paddingLeft) - parseFloat(getComputedStyle(span).paddingRight)
  const need = () => {
    const range = document.createRange()
    range.selectNodeContents(span)
    const box = span.getBoundingClientRect()
    return range.getBoundingClientRect().width * (box.width ? span.offsetWidth / box.width : 1)
  }
  while (need() > room() + 0.5 && size > 8) {
    size -= 0.5
    span.style.fontSize = `${size}px`
  }
}

/* Word's numbered lists are drawn with a CSS counter that each item's
   marker (::before) steps on. The browser does not carry a count made in
   one item's marker over to the next item, so every item came out "1.".
   The step is moved to the item itself, which does carry over; the
   marker still shows the count. */
function countLists(box) {
  for (const style of box.querySelectorAll('style')) {
    const sheet = style.sheet
    if (!sheet) continue
    const add = []
    for (const rule of sheet.cssRules) {
      const sel = rule.selectorText || ''
      const step = rule.style?.counterIncrement
      if (!/::?before$/.test(sel) || !step || step === 'none') continue
      add.push(`${sel.replace(/::?before$/, '')} { counter-increment: ${step}; }`)
      rule.style.counterIncrement = 'none'
    }
    for (const text of add) sheet.insertRule(text, sheet.cssRules.length)
  }
}

/* Each template's styles are named alike -- docx_heading1 in one is not
   docx_heading1 in another -- and the renderer writes them for the whole
   page. With several templates on the page, each one's styles are kept
   to its own box. */
function scopeStyles(box) {
  const scope = `.hr-part[data-part="${box.dataset.part}"]`
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.selectorText) {
        rule.selectorText = rule.selectorText.split(',').map((sel) => `${scope} ${sel.trim()}`).join(', ')
      } else if (rule.cssRules) {
        walk(rule.cssRules)
      }
    }
  }
  for (const style of box.querySelectorAll('style')) if (style.sheet) walk(style.sheet.cssRules)
}

/* A filled blank takes the size of the text around it, so the document
   reads as if typed in one go: the size of the nearest text before it in
   the same paragraph, or after it when it starts the paragraph. (The
   font is Times New Roman throughout; see the stylesheet.) */
function matchFieldSize(root) {
  for (const span of root.querySelectorAll('.hr-field')) {
    const p = span.closest('p')
    if (!p) continue
    const texts = textNodes(p).filter((n) => n.nodeValue.trim() && !n.parentElement.closest('.hr-field'))
    const before = texts.filter((n) => span.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING).pop()
    const after = texts.find((n) => span.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)
    const near = before || after
    if (near) span.style.fontSize = getComputedStyle(near.parentElement).fontSize
  }
}

function fillFields(values) {
  const optional = new Set(state.def?.optional || [])
  for (const span of $('preview').querySelectorAll('.hr-field')) {
    const v = values[span.dataset.field]
    if (span._cells) fillCells(span, v)
    else span.textContent = v || '……'
    if (span.classList.contains('hr-spot')) fitSpot(span)
    span.classList.toggle('is-empty', !v)
    // An optional blank left empty prints as nothing at all.
    span.classList.toggle('is-optional', optional.has(+span.dataset.field))
  }
}

/* ------------------------------------------------------------------ */
/* PDF                                                                  */
/* ------------------------------------------------------------------ */

/* The page is A4 at full size; it is shrunk to fit the column it sits
   in, and drawn at full size again for the PDF. */
function fitPreview() {
  // Not while a PDF is being made: the pages are measured at full size,
  // and a resize in the middle would shrink the ones not yet measured.
  if (state.capturing) return
  const preview = $('preview')
  const page = preview.querySelector('section.docx')
  const wrap = preview.parentElement
  if (!page || !wrap) return
  preview.style.zoom = ''
  const needed = page.offsetWidth + 40
  const room = wrap.clientWidth
  preview.style.zoom = needed > room ? String(Math.max(0.4, room / needed)) : ''
}
new ResizeObserver(() => fitPreview()).observe(document.documentElement)

/* How far down the page its content goes, in CSS pixels from the top of
   the page: the bottom of the last paragraph or table row, the footer
   left out (the page number is drawn on the sheet instead). */
function contentBottom(page, { ignoreEmpty = false } = {}) {
  const top = page.getBoundingClientRect().top
  let bottom = 0
  for (const el of page.querySelectorAll('p, tr')) {
    if (el.closest('footer, header')) continue
    // Empty lines left at the foot of a page hold nothing to print.
    if (ignoreEmpty && el.tagName === 'P' && !el.closest('td') &&
        !el.textContent.replace(/\u200b/g, '').trim() && !el.querySelector('img, svg')) continue
    const r = el.getBoundingClientRect()
    if (r.height) bottom = Math.max(bottom, r.bottom - top)
  }
  return Math.ceil(bottom)
}

/* Where a long page may be cut between sheets: under each paragraph and
   table row, in CSS pixels from the top of the page -- never straight
   under a title (a short centred line with text after it), which stays
   with what it heads. */
function cutPoints(page) {
  const top = page.getBoundingClientRect().top
  const out = new Set()
  const blocks = [...page.querySelectorAll('p, tr')]
    .filter((el) => !el.closest('footer, header') && !(el.tagName === 'P' && el.closest('tr')))
  blocks.forEach((el, i) => {
    const r = el.getBoundingClientRect()
    if (!r.height) return
    const rest = blocks.slice(i + 1).some((n) => n.textContent.replace(/\u200b/g, '').trim())
    const title = el.tagName === 'P' && rest && getComputedStyle(el).textAlign === 'center'
      && el.textContent.trim().length < 60 && r.height < 48
    if (!title) out.add(Math.ceil(r.bottom - top))
  })
  return [...out].sort((a, b) => a - b)
}

/* One A4 sheet: the page image, then the frame and the page number,
   drawn on the sheet itself so they sit in the same place on every
   sheet. */
function sheet(width, draw, border, number, scale, stamp, ratio = 297 / 210) {
  const c = document.createElement('canvas')
  c.width = width
  c.height = Math.round(width * ratio)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  draw(ctx, c.height)
  if (border) {
    const w = border.width * scale
    const inset = border.inset * scale + w / 2
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = w
    ctx.strokeRect(inset, inset, c.width - 2 * inset, c.height - 2 * inset)
  }
  if (number) {
    ctx.fillStyle = '#000000'
    ctx.font = `bold ${Math.round(11 * scale)}px 'Times New Roman', Times, serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(toArabicDigits(number), c.width / 2, c.height - 14 * scale)
  }
  /* When the PDF was made, at the foot of every page, on the right where
     an Arabic line starts. */
  if (stamp) {
    ctx.fillStyle = '#000000'
    ctx.font = `${Math.round(9 * scale)}px 'Times New Roman', Times, serif`
    ctx.direction = 'rtl'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(stamp, c.width - 30 * scale, c.height - 14 * scale)
  }
  return c
}

/* "تاريخ ووقت الطباعة: ١٨/١١/٢٠٢٦ - ١٢:٣٥ ص", in the computer's own
   time, as the clock on the wall reads it. */
export function printStamp(now = new Date()) {
  const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const h = now.getHours()
  const time = `${h % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`
  return `تاريخ ووقت الطباعة: ${arDate(day)} - ${toArabicDigits(time)} ${h < 12 ? 'ص' : 'م'}`
}

/* One sheet per page, as a rule. The pages are the template's own --
   split where Word split them -- so the PDF and the printout have as many
   pages as the Word file. A page that comes out a little longer than A4
   here, because a font measures differently in the browser than in Word,
   is shrunk onto its sheet rather than spilling onto another. A page far
   longer than A4 -- a template saved without the page breaks Word made,
   so that it comes out as one long page -- is cut into sheets between
   paragraphs instead, with the page margins at the top and bottom of
   each. */
/* How much longer than A4 a page may run before it is cut rather than
   shrunk: a fifth. */
const LONG_PAGE = 1.2

/* print: the PDF sent to the printer, where a part that is signed in
   several copies (copies, on the part) comes out that many times, one
   copy after another. Save PDF keeps one of each. */
async function buildPdf({ print = false } = {}) {
  const preview = $('preview')
  // In a pack, only the parts ticked to print (state.skip lists the rest).
  const pages = Array.from(preview.querySelectorAll('section.docx'))
    .filter((page) => !state.skip.has(+page.closest('.hr-part')?.dataset.part))
  // A scanned form prints on its own paper size; every other form on A4.
  const paper = PAPER[state.def?.scan?.paper || 'a4']
  const pdf = new jsPDF({ unit: 'mm', format: [paper.w, paper.h], orientation: 'portrait', compress: true })
  // A two-sided form asks the print dialog for both sides: duplex: true
  // flips them on the long edge, as a book turns; duplex: 'short' on the
  // short edge, as a notepad turns.
  if (state.def?.duplex) {
    pdf.viewerPreferences({ Duplex: state.def.duplex === 'short' ? 'DuplexFlipShortEdge' : 'DuplexFlipLongEdge' })
  }
  // Scaled to the paper in the print dialog, as far as a PDF can ask it.
  pdf.viewerPreferences({ PrintScaling: 'AppDefault' })
  // One time for the whole PDF, the same on every page.
  const stamp = printStamp()
  state.capturing = true
  preview.style.zoom = ''
  if (document.activeElement && preview.contains(document.activeElement)) document.activeElement.blur()
  preview.classList.add('is-capturing')
  const sheets = []
  /* Each part keeps what its own template sets: its page border, whether
     it numbers its pages (in the footer) -- counted from one in each
     part -- and how its pages are kept. */
  let part = null
  let first = 0
  let numbered = false
  let border = null
  let def = null
  // Where each part's sheets start, and how many copies it prints in.
  const runs = []
  try {
    for (const page of pages) {
      const box = page.closest('.hr-part')
      if (box !== part) {
        part = box
        first = sheets.length
        runs.push({ first, copies: (print && box?._hr?.copies) || 1 })
        border = box?._hr?.border || null
        def = box?._hr?.def || state.def
        numbered = [...(box || preview).querySelectorAll('section.docx')]
          .some((p) => /\d|[٠-٩]/.test(p.querySelector('footer')?.textContent || ''))
      }
      const number = () => (numbered ? sheets.length - first + 1 : 0)
      const cssWidth = page.offsetWidth
      const cssSheet = cssWidth * (paper.h / paper.w)
      const padBottom = parseFloat(getComputedStyle(page).paddingBottom) || 48
      const needed = contentBottom(page, { ignoreEmpty: !!def?.fitPages }) + padBottom
      /* The page is copied into an SVG image with its styles and drawn
         by the browser itself, so Arabic is shaped and laid out exactly
         as it is on screen. Drawing it text run by text run, as
         html2canvas does, breaks letters apart wherever Word split a
         word across runs. */
      const canvas = await toCanvas(page, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: false,
        style: { margin: '0', boxShadow: 'none' },
      })
      const k = canvas.width / cssWidth
      /* A document that names where its pages start (pageStarts: the
         opening words of the paragraph that begins each page after the
         first) keeps Word's pages: the page is split there and each part
         drawn on one sheet, smaller if it has to be, never cut further. */
      const starts = (def?.pageStarts || [])
        .map((words) => [...page.querySelectorAll('p')].find((p) => !p.closest('footer, header, td') &&
          p.textContent.replace(/\u200b/g, '').trim().startsWith(words)))
        .filter(Boolean)
        .map((p) => Math.floor(p.getBoundingClientRect().top - page.getBoundingClientRect().top))
      if (starts.length) {
        const padTop = parseFloat(getComputedStyle(page).paddingTop) || 48
        const edges = [0, ...starts, needed - padBottom]
        for (let i = 0; i < edges.length - 1; i++) {
          const from = edges[i]
          const to = edges[i + 1]
          const at = i ? padTop : 0
          const f = Math.min(1, (cssSheet - padBottom - at) / (to - from))
          sheets.push(sheet(canvas.width, (ctx) => {
            ctx.drawImage(canvas, 0, from * k, canvas.width, (to - from) * k,
              (canvas.width * (1 - f)) / 2, at * k, canvas.width * f, (to - from) * k * f)
          }, border, number(), k, stamp, paper.h / paper.w))
        }
        continue
      }
      // fitPages: each of Word's pages on exactly one sheet, drawn
      // smaller if it runs long here, never cut onto another.
      if (needed > cssSheet * LONG_PAGE && !def?.fitPages) {
        const padTop = parseFloat(getComputedStyle(page).paddingTop) || 48
        const cuts = cutPoints(page)
        const end = needed - padBottom
        /* Where the sheets split, for sheets h CSS pixels high. */
        const plan = (h) => {
          const out = []
          let start = 0
          while (start < end - 1) {
            const first = start === 0
            const limit = first ? h - padBottom : start + h - padTop - padBottom
            let cut = cuts.filter((y) => y > start + 1 && y <= limit).pop()
            if (cut === undefined) cut = Math.min(limit, end)
            out.push([start, cut, first ? 0 : padTop])
            start = cut
          }
          return out
        }
        /* A form that must keep its page count (shrinkPages) is drawn a
           little smaller, as little as it takes, rather than spill onto
           one more sheet: as many sheets as its length in A4 pages. */
        let f = 1
        let pieces = plan(cssSheet)
        if (def?.shrinkPages) {
          const target = Math.ceil(needed / cssSheet)
          while (pieces.length > target && f > 0.8) {
            f = Math.round((f - 0.01) * 100) / 100
            pieces = plan(cssSheet / f)
          }
        }
        for (const [from, cut, at] of pieces) {
          sheets.push(sheet(canvas.width, (ctx) => {
            ctx.drawImage(canvas, 0, from * k, canvas.width, (cut - from) * k,
              (canvas.width * (1 - f)) / 2, at * k * f, canvas.width * f, (cut - from) * k * f)
          }, border, number(), k, stamp, paper.h / paper.w))
        }
        continue
      }
      sheets.push(sheet(canvas.width, (ctx, sheetHeight) => {
        if (needed <= cssSheet) {
          // Fits: the top of the page, A4 high, at full size.
          const h = Math.min(canvas.height, sheetHeight)
          ctx.drawImage(canvas, 0, 0, canvas.width, h, 0, 0, canvas.width, h)
        } else {
          // Too long: the whole page, scaled down to the sheet's height
          // and centred across it.
          const fit = cssSheet / needed
          const w = canvas.width * fit
          ctx.drawImage(canvas, 0, 0, canvas.width, Math.min(canvas.height, needed * k),
            (canvas.width - w) / 2, 0, w, sheetHeight)
        }
      }, border, number(), k, stamp, paper.h / paper.w))
    }
    const out = []
    runs.forEach(({ first: from, copies }, r) => {
      const run = sheets.slice(from, r + 1 < runs.length ? runs[r + 1].first : sheets.length)
      for (let c = 0; c < copies; c++) out.push(...run)
    })
    if (!runs.length) out.push(...sheets)
    out.forEach((c, i) => {
      if (i) pdf.addPage()
      pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, paper.w, paper.h)
    })
  } finally {
    preview.classList.remove('is-capturing')
    state.capturing = false
    fitPreview()
  }
  return pdf.output('blob')
}

/* A saved PDF is named for the form, by its Arabic title, and for the
   employee: "عقد عمل محدد المدة - محمد أحمد.pdf". */
function pdfName(def, emp) {
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return emp ? `${safe(def.title)} - ${safe(emp.arabic_name)}.pdf` : `${safe(def.title)}.pdf`
}

async function savePdf() {
  const blob = await buildPdf()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = pdfName(state.def, state.employee)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/* The PDF is loaded into a hidden frame and printed from there, so what
   comes out of the printer is the file Save PDF writes -- with a part
   signed in several copies (the hiring contract) repeated that many
   times. Where a browser will not print a PDF from a frame, it opens in
   a new tab with its own print button. */
async function printPdf() {
  const blob = await buildPdf({ print: true })
  const url = URL.createObjectURL(blob)
  const frame = $('printFrame')
  const done = () => setTimeout(() => URL.revokeObjectURL(url), 120000)
  frame.onload = () => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } catch (_) {
      window.open(url, '_blank')
    }
    done()
  }
  frame.src = url
}

/* ------------------------------------------------------------------ */
/* Employees                                                            */
/* ------------------------------------------------------------------ */

/* dateSet: dates the user has set by hand, by key. inputs: what the user
   has typed (the wage, the address), by key. Both are kept while the
   document is open, so changing the employee keeps them. */
const state = { def: null, employee: null, employees: [], dateSet: {}, inputs: {}, loaded: false, capturing: false, busy: false, choices: {}, choiceLabel: {}, company: null, fetched: { key: '' }, fetching: '', skip: new Set() }

const EMPLOYEE_COLUMNS = ['id', 'code', 'arabic_name', 'national_id', 'hired_on', 'contract_expiry',
  'si_no', 'si_title', 'title', 'annual_leave_balance', 'unplanned_leave_balance', 'qualification_degree_ar', 'education_field', 'address', 'id_issue_date', 'is_active',
  'department_id', 'personal_mobile', 'gender', 'birth_date', 'governorate', 'religion',
  'marital_status', 'military_service', 'secondary_mobile', 'secondary_mobile_name',
  'secondary_contact_relation', 'secondary_contact_title',
  'status_id', 'notice_date', 'resignation_date', 'resignation_reason',
  'email', 'si_date', 'si_code', 'governorate_code', 'renewals']

/* Department names by id, in Arabic where the department has one
   (departments.name_ar, from migration 20261112160001) and as stored
   otherwise. A database without that column yet gives the stored names. */
/* Reference lists (departments, sectors, statuses) change rarely, and
   were asked for every time the page opened. Kept for a quarter of an
   hour in this tab; the tracker's Settings page drops the copies when it
   changes one. Only these small lists -- never employee records. */
const LOOKUP_MS = 15 * 60 * 1000
async function cachedLookup(key, load) {
  try {
    const hit = JSON.parse(sessionStorage.getItem('ienergy-lookups:' + key))
    if (hit && Date.now() - hit.at < LOOKUP_MS) return hit.rows
  } catch { /* no storage */ }
  const rows = await load()
  if (rows) {
    try { sessionStorage.setItem('ienergy-lookups:' + key, JSON.stringify({ at: Date.now(), rows })) } catch { /* full */ }
  }
  return rows || []
}

async function loadDepartments(supabase) {
  const [data, sectors] = await Promise.all([
    cachedLookup('hr-departments', () => fetchDepartments(supabase)),
    cachedLookup('hr-sectors', async () => {
      const r = await supabase.from('sectors').select('id, name_ar')
      return r.error ? null : r.data || []
    }),
  ])
  const sectorAr = new Map(sectors.map((x) => [x.id, x.name_ar || '']))
  return new Map(data.map((d) => [d.id, { en: d.name, ar: d.name_ar || '', sectorAr: sectorAr.get(d.sector_id) || '' }]))
}

async function fetchDepartments(supabase) {
  let { data, error } = await supabase.from('departments').select('id, name, name_ar, sector_id')
  if (error && error.code === '42703') ({ data, error } = await supabase.from('departments').select('id, name, sector_id'))
  return error ? null : data || []
}

async function loadEmployees() {
  const supabase = await IEnergyAuth.getClient()
  const query = (columns) => supabase
    .from('employee_profiles')
    .select(columns.join(', '))
    .not('arabic_name', 'is', null)
    .order('arabic_name')
  /* A database a newer migration has not reached yet lacks that column:
     address (20261112150001) or id_issue_date (20261116100001). The page
     still opens without it; that blank prints empty until the migration
     is applied. Dropped one at a time, as the error names them. */
  // The small lists load alongside the employees rather than after them.
  const lists = Promise.all([loadDepartments(supabase), loadStatuses(supabase)])
  lists.catch(() => {})
  let columns = EMPLOYEE_COLUMNS
  let { data, error } = await query(columns)
  let missing
  while (error && error.code === '42703' &&
         (missing = ['address', 'id_issue_date', 'secondary_contact_relation', 'secondary_contact_title'].find((c) => columns.includes(c) && (error.message || '').includes(c)))) {
    columns = columns.filter((c) => c !== missing)
    ;({ data, error } = await query(columns))
  }
  if (error) throw error
  const [departments, statuses] = await lists
  state.employees = (data || []).map((e) => ({
    ...e,
    department_ar: departments.get(e.department_id)?.ar || '',
    department_en: departments.get(e.department_id)?.en || '',
    sector_ar: departments.get(e.department_id)?.sectorAr || '',
    status_name: statuses.get(e.status_id) || '',
    _key: foldArabic(e.arabic_name),
  }))
  return state.employees
}

async function loadStatuses(supabase) {
  const data = await cachedLookup('hr-statuses', async () => {
    const r = await supabase.from('employee_statuses').select('id, name')
    return r.error ? null : r.data || []
  })
  return new Map(data.map((s) => [s.id, s.name]))
}

/* The employees a form is for: those working here, or, for the
   resignation, those who have handed in their notice -- a notice date
   saved on the record. */
const isResigned = (e) => !!e.notice_date
function pool(def = state.def) {
  if (def?.pool === 'resigned') return state.employees.filter(isResigned)
  return state.employees.filter((e) => e.is_active)
}

function showPoolHint() {
  const hint = $('employeeHint')
  if (!hint) return
  if (state.def?.blankForm) {
    hint.textContent = 'نموذج فارغ يُطبع كما هو ليملأه المتقدم بخط اليد، على وجهي الورقة.'
    return
  }
  if (!state.loaded) return
  const n = toArabicDigits(pool().length)
  hint.textContent = state.def?.pool === 'resigned'
    ? `${n} موظف له تاريخ إشعار استقالة — ابحث بالاسم أو الكود.`
    : `${n} موظف — ابحث بالاسم أو الكود.`
}

function showOptions(list) {
  const ul = $('employeeOptions')
  const input = $('employeeSearch')
  ul.innerHTML = ''
  for (const e of list.slice(0, 50)) {
    const li = document.createElement('li')
    li.className = 'hr-option'
    li.setAttribute('role', 'option')
    li.dataset.id = e.id
    const n = document.createElement('span')
    n.textContent = e.arabic_name
    const c = document.createElement('small')
    c.textContent = toArabicDigits(e.code ?? '')
    li.append(n, c)
    li.addEventListener('mousedown', (ev) => { ev.preventDefault(); pickEmployee(e) })
    ul.appendChild(li)
  }
  if (!list.length) {
    const li = document.createElement('li')
    li.className = 'hr-option is-none'
    li.textContent = 'لا توجد نتائج'
    ul.appendChild(li)
  }
  ul.hidden = false
  input.setAttribute('aria-expanded', 'true')
}

function hideOptions() {
  $('employeeOptions').hidden = true
  $('employeeSearch').setAttribute('aria-expanded', 'false')
}

function search(term) {
  const q = foldArabic(term)
  const digits = String(term).replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).replace(/\D/g, '')
  const list = pool()
  if (!q) return list
  return list.filter((e) =>
    e._key.includes(q) || (digits && String(e.code ?? '').includes(digits)))
}

function wirePicker() {
  const input = $('employeeSearch')
  input.addEventListener('input', () => {
    if (state.employee) setEmployee(null)
    showOptions(search(input.value))
  })
  input.addEventListener('focus', () => showOptions(search(state.employee ? '' : input.value)))
  input.addEventListener('blur', () => setTimeout(hideOptions, 100))
  input.addEventListener('keydown', (e) => {
    const ul = $('employeeOptions')
    const items = Array.from(ul.querySelectorAll('.hr-option:not(.is-none)'))
    if (!items.length) return
    let i = items.findIndex((li) => li.classList.contains('is-active'))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (ul.hidden) showOptions(search(input.value))
      i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
      items.forEach((li, k) => li.classList.toggle('is-active', k === i))
      items[i].scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const li = items[Math.max(0, i)]
      const emp = pool().find((x) => String(x.id) === li.dataset.id)
      if (emp) pickEmployee(emp)
    } else if (e.key === 'Escape') {
      hideOptions()
    }
  })
}

function pickEmployee(emp) {
  $('employeeSearch').value = emp.arabic_name
  hideOptions()
  setEmployee(emp)
}

function setEmployee(emp) {
  // The references are the employee's own: a new employee starts again.
  for (const k of Object.keys(state.inputs)) if (k.startsWith('ref')) delete state.inputs[k]
  for (const box of document.querySelectorAll('.hr-ref-input')) box.value = ''
  state.employee = emp
  fillEmployeeLists()
  refresh()
}

/* ------------------------------------------------------------------ */
/* The editable date                                                    */
/* ------------------------------------------------------------------ */

/* One row per editable date: a dd/mm/yyyy box, a calendar button that
   opens the browser's date picker, and a button back to the default. */
function buildDateInputs(def) {
  const box = $('dateFields')
  box.innerHTML = ''
  for (const [key, label, , opts = {}] of def.dateFields) {
    const month = !!opts.month
    const row = document.createElement('div')
    row.className = 'hr-date-row'
    const l = document.createElement('label')
    l.className = 'hr-label'
    l.htmlFor = `date-${key}`
    l.textContent = label
    const group = document.createElement('div')
    group.className = 'hr-date-group'
    group.dir = 'ltr'

    const input = document.createElement('input')
    input.id = `date-${key}`
    input.className = 'hr-input hr-date-input'
    input.type = 'text'
    input.inputMode = 'numeric'
    input.placeholder = month ? 'mm/yyyy' : 'dd/mm/yyyy'
    input.autocomplete = 'off'
    input.dataset.key = key

    const picker = document.createElement('input')
    picker.type = month ? 'month' : 'date'
    picker.className = 'hr-date-picker'
    picker.tabIndex = -1
    picker.setAttribute('aria-hidden', 'true')

    const cal = document.createElement('button')
    cal.type = 'button'
    cal.className = 'btn hr-date-btn'
    cal.title = 'اختر من التقويم'
    cal.textContent = '📅'

    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'btn hr-date-btn'
    reset.title = 'إرجاع التاريخ التلقائي'
    reset.textContent = '↺'

    const apply = (d) => {
      state.dateSet[key] = d
      refresh()
    }
    input.addEventListener('input', () => {
      const d = month ? parseMY(input.value) : parseDMY(input.value)
      input.classList.toggle('is-invalid', d === undefined)
      if (d !== undefined) apply(d)
    })
    // On leaving the box, show the date as it was understood: 1/2/2026
    // becomes 01/02/2026; something unreadable goes back to the last date.
    input.addEventListener('blur', () => {
      input.classList.remove('is-invalid')
      refresh()
    })
    cal.addEventListener('click', () => {
      picker.value = isoOf(currentDates()[key]).slice(0, month ? 7 : 10)
      if (picker.showPicker) {
        try { picker.showPicker(); return } catch (_) { /* fall through */ }
      }
      picker.click()
    })
    picker.addEventListener('change', () => apply(month ? parseMY(picker.value.split('-').reverse().join('/')) : parseISO(picker.value)))
    reset.addEventListener('click', () => {
      delete state.dateSet[key]
      refresh()
    })

    group.append(input, cal, reset, picker)
    row.append(l, group)
    box.appendChild(row)
  }
}

/* One box per value the user types. An amount is typed in English
   digits and shown in the document in Arabic digits and Arabic words. */
/* The references table as boxes: a block per row, name, job, relation
   and phone. Text in Arabic; the phone in English digits. */
function buildRefTable(t) {
  const box = $('dateFields')
  const wrap = document.createElement('div')
  wrap.className = 'hr-ref'
  const h = document.createElement('div')
  h.className = 'hr-label'
  h.textContent = t.title
  wrap.appendChild(h)
  for (let r = 0; r < t.rows; r++) {
    const row = document.createElement('div')
    row.className = 'hr-ref-row'
    const num = document.createElement('span')
    num.className = 'hr-ref-num'
    num.textContent = toArabicDigits(r + 1)
    row.appendChild(num)
    for (const [col, label, kind] of t.cols) {
      const input = document.createElement('input')
      input.id = `input-${refKey(r, col)}`
      input.className = 'hr-input hr-ref-input'
      input.type = 'text'
      input.autocomplete = 'off'
      input.placeholder = label
      input.title = label
      if (kind === 'phone') {
        input.dir = 'ltr'
        input.inputMode = 'tel'
        input.addEventListener('input', () => {
          const v = input.value.replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d))
          const ok = /^[\d\s+-]*$/.test(v) && (v.replace(/\D/g, '').length >= 7 || !v.trim())
          input.classList.toggle('is-invalid', !ok)
          state.inputs[refKey(r, col)] = ok ? v.replace(/\D/g, '') : ''
          refresh()
        })
        input.addEventListener('blur', () => input.classList.remove('is-invalid'))
      } else {
        input.addEventListener('input', () => {
          state.inputs[refKey(r, col)] = input.value.trim()
          refresh()
        })
      }
      row.appendChild(input)
    }
    wrap.appendChild(row)
  }
  box.appendChild(wrap)
}

function buildInputs(def) {
  const box = $('dateFields')
  for (const [key, label, kind, , hint] of def.inputs) {
    const row = document.createElement('div')
    row.className = 'hr-date-row'
    const l = document.createElement('label')
    l.className = 'hr-label'
    l.htmlFor = `input-${key}`
    l.textContent = label
    if (kind === 'flag') {
      // A box to tick, its label beside it. Starts unticked.
      const box2 = document.createElement('input')
      box2.type = 'checkbox'
      box2.id = `input-${key}`
      box2.className = 'hr-check'
      l.classList.add('hr-check-label')
      l.prepend(box2)
      box2.addEventListener('change', () => {
        state.inputs[key] = box2.checked
        refresh()
      })
      row.append(l)
      box.appendChild(row)
      continue
    }
    if (kind === 'person' || kind === 'employee' || kind === 'choice' || kind === 'longtext') {
      const box2 = kind === 'longtext' ? document.createElement('textarea') : document.createElement('select')
      box2.id = `input-${key}`
      box2.className = 'hr-input'
      if (kind === 'person') {
        box2.dataset.person = '1'
      } else if (kind === 'employee') {
        box2.dataset.employee = '1'
      } else if (kind === 'choice') {
        box2.dataset.choice = key
      } else {
        box2.rows = 3
        box2.dir = 'rtl'
      }
      box2.addEventListener(kind === 'person' ? 'change' : 'input', () => {
        state.inputs[key] = box2.value.trim()
        refresh()
      })
      row.append(l, box2)
      if (hint) {
        const h = document.createElement('p')
        h.className = 'hr-hint'
        h.textContent = hint
        row.appendChild(h)
      }
      box.appendChild(row)
      continue
    }
    const input = document.createElement('input')
    input.id = `input-${key}`
    input.className = 'hr-input'
    input.type = 'text'
    input.autocomplete = 'off'
    if (kind === 'count') {
      // A whole number from 1, in English digits; shown in Arabic digits.
      input.dir = 'ltr'
      input.inputMode = 'numeric'
      input.maxLength = 3
      input.placeholder = '0'
      input.addEventListener('input', () => {
        const v = input.value.replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).trim()
        const ok = /^[1-9]\d{0,2}$/.test(v)
        input.classList.toggle('is-invalid', !!v && !ok)
        state.inputs[key] = ok ? +v : ''
        refresh()
      })
      input.addEventListener('blur', () => input.classList.remove('is-invalid'))
    } else if (kind === 'year') {
      // Four English digits; shown in Arabic digits in the document.
      input.dir = 'ltr'
      input.inputMode = 'numeric'
      input.maxLength = 4
      input.placeholder = 'yyyy'
      input.addEventListener('input', () => {
        const v = input.value.replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).trim()
        const ok = /^(19|20)\d{2}$/.test(v)
        input.classList.toggle('is-invalid', !!v && !ok)
        state.inputs[key] = ok ? v : ''
        refresh()
      })
      input.addEventListener('blur', () => input.classList.remove('is-invalid'))
    } else if (kind === 'amount') {
      input.dir = 'ltr'
      input.inputMode = 'decimal'
      input.placeholder = '0'
      input.addEventListener('input', () => {
        const a = parseAmount(input.value)
        input.classList.toggle('is-invalid', a === undefined)
        if (a !== undefined) {
          state.inputs[key] = a
          refresh()
        }
      })
      input.addEventListener('blur', () => input.classList.remove('is-invalid'))
    } else {
      input.addEventListener('input', () => {
        state.inputs[key] = input.value.trim()
        refresh()
      })
    }
    row.append(l, input)
    if (hint) {
      const h = document.createElement('p')
      h.className = 'hr-hint'
      h.textContent = hint
      row.appendChild(h)
    }
    box.appendChild(row)
  }
}

/* The approvers are chosen from the employees working here, by Arabic
   name; filled in once the list has loaded. */
function fillPersonLists() {
  const people = state.employees.filter((e) => e.is_active)
  for (const sel of document.querySelectorAll('select[data-person]')) {
    const keep = sel.value
    sel.innerHTML = ''
    const none = document.createElement('option')
    none.value = ''
    none.textContent = state.loaded ? '— اختر —' : 'جارٍ التحميل…'
    sel.appendChild(none)
    for (const e of people) {
      const o = document.createElement('option')
      o.value = e.arabic_name
      o.textContent = e.arabic_name
      sel.appendChild(o)
    }
    sel.value = keep
  }
  fillEmployeeLists()
}

/* Employee boxes list the employees working here, by Arabic name and
   code, without the one the form is for: nobody guarantees themselves.
   A choice that is no longer in the list is cleared. */
function fillEmployeeLists() {
  const people = state.employees.filter((e) => e.is_active && e.id !== state.employee?.id)
  for (const sel of document.querySelectorAll('select[data-employee]')) {
    const key = sel.id.replace(/^input-/, '')
    const keep = state.inputs[key] || ''
    sel.innerHTML = ''
    const none = document.createElement('option')
    none.value = ''
    none.textContent = state.loaded ? '— اختر —' : 'جارٍ التحميل…'
    sel.appendChild(none)
    for (const e of people) {
      const o = document.createElement('option')
      o.value = e.id
      o.textContent = `${e.arabic_name} — ${toArabicDigits(e.code ?? '')}`
      sel.appendChild(o)
    }
    sel.value = people.some((e) => String(e.id) === String(keep)) ? keep : ''
    if (sel.value !== String(keep)) delete state.inputs[key]
  }
  fillChoiceLists()
}

/* Rows for each choice box, by key, read from their table once the user
   is signed in. */
async function loadChoices() {
  const supabase = await IEnergyAuth.getClient()
  const wanted = new Map()
  for (const def of pageDocs) {
    for (const [key, , kind, , , opts] of def.inputs) if (kind === 'choice') wanted.set(key, opts)
  }
  for (const [key, opts] of wanted) {
    const { data, error } = await supabase.from(opts.table).select('*').order('sort_order').order('id')
    state.choices[key] = error ? [] : data || []
    state.choiceLabel[key] = opts.label || 'name'
  }
}

function fillChoiceLists() {
  for (const sel of document.querySelectorAll('select[data-choice]')) {
    const key = sel.dataset.choice
    const rows = state.choices[key]
    const keep = state.inputs[key] || ''
    sel.innerHTML = ''
    const none = document.createElement('option')
    none.value = ''
    none.textContent = !rows ? 'جارٍ التحميل…' : rows.length ? '— اختر —' : 'لا توجد بيانات بعد'
    sel.appendChild(none)
    for (const r of rows || []) {
      const o = document.createElement('option')
      o.value = r.id
      o.textContent = r[state.choiceLabel[key]] ?? ''
      sel.appendChild(o)
    }
    sel.value = (rows || []).some((r) => String(r.id) === String(keep)) ? keep : ''
  }
}

const chosen = (key) => (state.choices[key] || []).find((r) => String(r.id) === String(state.inputs[key])) || null

const findEmployee = (id) => (id ? state.employees.find((e) => String(e.id) === String(id)) || null : null)

function currentDates() {
  return state.def.dates(state.employee, state.dateSet)
}

/* The blanks the user can change, each with the box that changes it. */
function editableBlanks(def) {
  const out = new Map()
  for (const [key, , fields] of def.dateFields) for (const f of fields) out.set(f, `date-${key}`)
  for (const [key, , kind, fields] of def.inputs) {
    // An employee box fills its other blanks from that employee's record:
    // until one is chosen they are the user's to fill, once one is they
    // are the record's.
    const own = kind === 'employee' && state.inputs[key] ? fields.slice(0, 1) : fields
    for (const f of own) out.set(f, `input-${key}`)
  }
  const t = def.refTable
  if (t) {
    for (let r = 0; r < t.rows; r++) {
      t.cols.forEach(([col], c) => out.set(refBlank(t, r, c), `input-${refKey(r, col)}`))
    }
  }
  return out
}

/* What the user has typed, over what the document fills in by itself. */
function currentInputs() {
  return { ...(state.def?.defaults?.(state.employee) || {}), ...state.inputs }
}

/* Clicking such a blank in the document goes to its box. */
function focusDateFor(field) {
  const id = state.def && editableBlanks(state.def).get(+field)
  if (!id) return false
  const input = $(id)
  input.focus()
  input.select()
  return true
}

/* Fill the document and the read-only list beside it, and decide whether
   the document is complete enough to be issued. */
/* The parts of a form shown only while their box is ticked
   (def.sections): hidden, they take no room and are not in the PDF. */
function showSections(def, inputs) {
  if (!def.sections) return
  for (const page of $('preview').querySelectorAll('section.docx')) {
    const paras = Array.from(page.querySelectorAll('p'))
    for (const { input, from } of def.sections) {
      const at = paras.findIndex((p) => p.textContent.trim().startsWith(from))
      if (at < 0) continue
      for (const p of paras.slice(at)) p.style.display = inputs[input] ? '' : 'none'
    }
  }
}

/* Lines left out when their blank is empty (def.dropLines): the whole
   paragraph goes, on screen and in the PDF, rather than printing a
   sentence with nothing in it. */
function dropEmptyLines(def, values) {
  for (const n of def.dropLines || []) {
    for (const span of $('preview').querySelectorAll(`.hr-field[data-field="${n}"]`)) {
      const p = span.closest('p')
      if (p) p.style.display = values[n] ? '' : 'none'
    }
  }
}

/* A form that reads more than the employee record (def.fetch): what it
   read for this employee and these dates, as ctx.fetched, or
   ctx.fetchError. Read once for each employee and set of dates, then kept
   until either changes; the form is drawn again when it arrives. */
function fetchFor(def, emp, dates) {
  if (!def.fetch || !emp) return {}
  const key = def.fetch.key(emp, dates)
  if (!key) return {}
  const full = `${def.id}|${key}`
  if (state.fetched.key === full) return { fetched: state.fetched.data, fetchError: state.fetched.error }
  if (state.fetching !== full) {
    state.fetching = full
    IEnergyAuth.getClient()
      .then((supabase) => def.fetch.load(supabase, emp, dates))
      .then((data) => ({ data }), (err) => ({ error: err.message || String(err) }))
      .then((got) => {
        if (state.fetching !== full) return
        state.fetching = ''
        state.fetched = { key: full, ...got }
        if (state.def === def) refresh()
      })
  }
  return {}
}

function refresh() {
  const def = state.def
  if (!def) return
  const emp = state.employee
  const dates = currentDates()
  const inputs = currentInputs()
  const ctx = { find: findEmployee, choice: chosen, company: state.company, ...fetchFor(def, emp, dates) }
  const values = def.values(emp, dates, inputs, ctx)
  releaseLines($('preview'))
  fillFields(values)
  showSections(def, inputs)
  dropEmptyLines(def, values)
  layoutTabs($('preview'))
  keepLines($('preview'))
  const editable = editableBlanks(def)
  /* Boxes that start from the record (the references table) show what
     the document is printing. Lists are left alone. */
  if (def.defaults) {
    for (const [k, v] of Object.entries(inputs)) {
      const box = $(`input-${k}`)
      if (box && box.tagName !== 'SELECT' && document.activeElement !== box &&
          !box.classList.contains('is-invalid')) box.value = v
    }
  }
  for (const span of $('preview').querySelectorAll('.hr-field')) {
    span.classList.toggle('is-editable', editable.has(+span.dataset.field))
  }

  for (const [key, , , opts = {}] of def.dateFields) {
    const input = $(`date-${key}`)
    if (input && document.activeElement !== input) input.value = opts.month ? my(dates[key]) : dmy(dates[key])
    const reset = input?.parentElement.querySelectorAll('.hr-date-btn')[1]
    if (reset) reset.hidden = !(key in state.dateSet)
  }
  const box = $('autoFields')
  box.innerHTML = ''
  for (const [n, label] of def.info) {
    const row = document.createElement('div')
    row.className = 'hr-auto-row'
    const l = document.createElement('span')
    l.textContent = label
    const v = document.createElement('output')
    // Boxes filled part by part (a date) read with slashes here.
    v.textContent = String(values[n] || '—').split('|').join('/')
    row.append(l, v)
    box.appendChild(row)
  }

  /* The rule for every form: nothing is saved or printed with a blank
     left empty. What is missing is named -- from the employee record,
     to be put right there, or from the boxes here, to be filled in. */
  const optional = new Set(def.optional || [])
  // In a pack, a part left out of the print (state.skip) asks for nothing.
  const inPrint = (n) => !def.parts || !state.skip.has(Math.floor(n / 100) - 1)
  const empty = def.blanks.filter((n) => !values[n] && !optional.has(n) && inPrint(n))
  const nothing = !!def.parts && state.skip.size >= def.parts.length
  const names = (list) => [...new Set(list.map((n) => def.fields[n]))].join('، ')
  // Company details (def.companyFields) are kept in the tracker's Settings.
  const ofCompany = new Set(def.companyFields || [])
  const fromCompany = empty.filter((n) => ofCompany.has(n))
  // Blanks read from other tables (def.fetch) are def.check's to explain.
  const ofFetch = new Set(def.fetchedFields || [])
  const fromRecord = empty.filter((n) => !editable.has(n) && !ofCompany.has(n) && !ofFetch.has(n))
  /* An employee box not yet chosen is one thing to do, not one per
     blank it fills: only its first blank, the name, is named. */
  const later = new Set(def.inputs.filter(([key, , kind]) => kind === 'employee' && !state.inputs[key])
    .flatMap(([, , , fields]) => fields.slice(1)))
  const toFill = empty.filter((n) => editable.has(n) && !later.has(n))
  const warn = $('fieldWarning')
  const notes = []
  if (emp && fromRecord.length) notes.push(`بيانات ناقصة في قاعدة بيانات الموظفين: ${names(fromRecord)}. أكملها أولاً ثم أعد الاختيار.`)
  if (emp && fromCompany.length) notes.push(`بيانات الشركة ناقصة في صفحة الإعدادات (Settings ← Company details): ${names(fromCompany)}.`)
  if (emp && toFill.length) notes.push(`أدخل ${names(toFill)}.`)
  const problem = def.check ? def.check(emp, dates, inputs, ctx) : ''
  if (problem) notes.push(problem)
  if (nothing) notes.push('اختر مستندًا واحدًا على الأقل للطباعة.')
  if (notes.length) notes.push('لا يمكن الحفظ أو الطباعة قبل استكمال كل البيانات.')
  warn.hidden = !notes.length
  warn.textContent = notes.join(' ')

  const ready = (!!emp || !!def.blankForm) && !empty.length && !problem && !nothing && !state.busy
  $('savePdfBtn').disabled = !ready
  $('printBtn').disabled = !ready
}

/* ------------------------------------------------------------------ */
/* Views                                                                */
/* ------------------------------------------------------------------ */

function drawList() {
  const list = $('docList')
  list.innerHTML = ''
  pageDocs.forEach((def, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'hr-doc'
    /* Read from the right: number, Arabic name, English name, with the
       Word mark at the far left. Shared with Employee Documents. */
    btn.dir = 'rtl'
    btn.disabled = !def.template
    const num = document.createElement('span')
    num.className = 'hr-doc-num'
    num.textContent = toArabicDigits(i + 1)
    const text = document.createElement('span')
    text.className = 'hr-doc-text'
    const t = document.createElement('span')
    t.className = 'hr-doc-title'
    t.dir = 'rtl'
    t.textContent = def.title
    const s = document.createElement('span')
    s.className = 'hr-doc-sub'
    s.dir = 'ltr'
    s.textContent = def.template ? def.subtitle : `${def.subtitle} · coming soon`
    text.append(t, s)
    const icon = document.createElement('span')
    icon.className = 'hr-doc-icon'
    icon.textContent = 'W'
    btn.append(num, text, icon)
    if (def.template) btn.addEventListener('click', () => openDocument(def))
    list.appendChild(btn)
  })
}

/* The company's details (Settings in the tracker), for the forms that
   print them: read once, when such a form is first opened. */
async function loadCompany() {
  const supabase = await IEnergyAuth.getClient()
  const { data, error } = await supabase.from('company_details').select('*').eq('id', 1)
  state.company = error ? {} : (data || [])[0] || {}
}

/* A form of several parts (a pack) lists them with a tick box each:
   what is ticked is what Save PDF and Print give. All ticked to begin
   with. A part left out is dimmed in the preview and its blanks no
   longer have to be filled. */
function buildPartPicker(def) {
  const box = $('partPicker')
  if (!box) return
  box.innerHTML = ''
  const parts = def.parts || []
  box.hidden = parts.length < 2
  if (parts.length < 2) return
  const head = document.createElement('div')
  head.className = 'hr-parts-head'
  const title = document.createElement('span')
  title.className = 'hr-label'
  title.textContent = 'المستندات المطلوب طباعتها'
  const all = document.createElement('button')
  all.type = 'button'
  all.className = 'hr-parts-all'
  head.append(title, all)
  box.appendChild(head)
  const checks = []
  const sync = () => {
    const none = state.skip.size === 0
    all.textContent = none ? 'إلغاء الكل' : 'تحديد الكل'
    for (const el of $('preview').querySelectorAll('.hr-part')) {
      el.classList.toggle('is-skipped', state.skip.has(+el.dataset.part))
    }
    refresh()
  }
  parts.forEach((part, i) => {
    const row = document.createElement('label')
    row.className = 'hr-part-option'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = !state.skip.has(i)
    cb.addEventListener('change', () => {
      if (cb.checked) state.skip.delete(i)
      else state.skip.add(i)
      sync()
    })
    const num = document.createElement('span')
    num.className = 'hr-part-num'
    num.textContent = toArabicDigits(i + 1)
    const name = document.createElement('span')
    name.textContent = part.def.title + (part.copies > 1 ? ` (${toArabicDigits(part.copies)} نسخ عند الطباعة)` : '')
    row.append(cb, num, name)
    box.appendChild(row)
    checks.push(cb)
  })
  all.addEventListener('click', () => {
    const select = state.skip.size > 0
    state.skip.clear()
    if (!select) parts.forEach((_, i) => state.skip.add(i))
    checks.forEach((cb) => { cb.checked = select })
    sync()
  })
  all.textContent = 'إلغاء الكل'
}

async function openDocument(def) {
  if (def.companyFields && !state.company) loadCompany().then(() => refresh()).catch((err) => console.error(err))
  state.def = def
  state.employee = null
  state.dateSet = {}
  state.inputs = {}
  state.skip = new Set()
  buildPartPicker(def)
  $('employeeSearch').value = ''
  // A blank form is for no one in particular: no employee to choose.
  $('employeeSearch').closest('.hr-picker').hidden = !!def.blankForm
  document.querySelector('label[for="employeeSearch"]').hidden = !!def.blankForm
  if ($('fieldsHint')) $('fieldsHint').hidden = !!def.blankForm
  $('editorTitle').textContent = def.title
  buildDateInputs(def)
  buildInputs(def)
  fillPersonLists()
  showPoolHint()
  if (def.refTable) buildRefTable(def.refTable)
  $('listView').hidden = true
  $('editorView').hidden = false
  history.replaceState(null, '', `#${def.id}`)
  try {
    await drawDocument(def)
  } catch (err) {
    $('previewStatus').textContent = `Could not load the document: ${err.message || err}`
    return
  }
  refresh()
}

function closeDocument() {
  state.def = null
  state.employee = null
  state.dateSet = {}
  state.inputs = {}
  state.skip = new Set()
  $('editorView').hidden = true
  $('listView').hidden = false
  $('preview').innerHTML = ''
  history.replaceState(null, '', location.pathname)
}

function busy(btn, label, work) {
  return async () => {
    if (state.busy) return
    state.busy = true
    const text = btn.textContent
    btn.textContent = label
    refresh()
    try {
      await work()
    } catch (err) {
      console.error(err)
      alertError(err)
    } finally {
      state.busy = false
      btn.textContent = text
      refresh()
    }
  }
}

function alertError(err) {
  const warn = $('fieldWarning')
  warn.hidden = false
  warn.textContent = `تعذر إنشاء ملف PDF: ${err.message || err}`
}

/* ------------------------------------------------------------------ */
/* Start                                                                */
/* ------------------------------------------------------------------ */

function fillPageBar() {
  const me = IEnergyAuth.getProfile && IEnergyAuth.getProfile()
  const who = $('whoami')
  const badge = $('roleBadge')
  if (!me || !who || !badge) return
  who.textContent = ''
  const name = document.createElement('span')
  name.className = 'who-name'
  name.textContent = me.name || ''
  who.appendChild(name)
  const LABEL = { super_admin: 'Super admin', admin: 'Admin', user: 'User' }
  badge.textContent = LABEL[me.trackerRole] || me.trackerRole || ''
  badge.className = 'role-badge' + (me.trackerRole === 'super_admin' ? ' is-super'
    : me.trackerRole === 'admin' ? ' is-admin' : '')
  badge.hidden = false
  const slot = $('themeSlot')
  const toggle = document.querySelector('.theme-toggle')
  if (slot && toggle) slot.appendChild(toggle)
}

async function onAuthed() {
  fillPageBar()
  drawList()
  wirePicker()
  $('preview').addEventListener('click', (e) => {
    const f = e.target.closest && e.target.closest('.hr-field')
    if (f && focusDateFor(f.dataset.field)) e.preventDefault()
  })
  $('backBtn').addEventListener('click', closeDocument)
  $('savePdfBtn').addEventListener('click', busy($('savePdfBtn'), 'Saving…', savePdf))
  $('printBtn').addEventListener('click', busy($('printBtn'), 'Preparing…', printPdf))

  const hint = $('employeeHint')
  loadEmployees()
    .then(() => {
      state.loaded = true
      showPoolHint()
      fillPersonLists()
    })
    .catch((err) => { hint.textContent = `تعذر تحميل الموظفين: ${err.message || err}` })
  loadChoices().then(() => { fillChoiceLists(); refresh() }).catch((err) => console.error(err))

  const wanted = pageDocs.find((d) => d.template && `#${d.id}` === location.hash)
  if (wanted) openDocument(wanted)
}

/* The documents this page lists: HR Documents' own unless another page
   (Employee Documents) has started the engine with its list. */
let pageDocs = DOCUMENTS

export function startDocumentsPage({ documents, allowedRoles }) {
  pageDocs = documents
  for (const def of pageDocs) def.blanks = Object.keys(def.fields).map(Number)
  start(allowedRoles)
}

function start(allowedRoles = ['admin']) {
  $('year').textContent = String(new Date().getFullYear())
  const out = $('logoutBtn')
  out.addEventListener('click', () => {
    out.disabled = true
    out.textContent = 'Signing out…'
    IEnergyAuth.signOutAndLeave('../index.html')
  })
  IEnergyAuth.ensureAuth({ allowedRoles, homeHref: '../index.html', onAuthed })
}

/* HR Documents starts itself. A page that marks its <html> with
   data-documents-page starts the engine through startDocumentsPage. */
if (window.IEnergyAuth && !document.documentElement.dataset.documentsPage) start()
