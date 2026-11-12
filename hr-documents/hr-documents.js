/* HR Documents
   - Admins and super admins only: ensureAuth turns everyone else away,
     and row level security on employee_profiles says the same thing from
     the database's side.
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
const todayUTC = () => {
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

const has = (set, k) => Object.prototype.hasOwnProperty.call(set, k)

/* --- Shared ---------------------------------------------------------- */

const isFemale = (emp) => emp?.gender === 'Female'

/* The job title as the forms state it: the official social-insurance
   title, in Arabic; the English title when there is none. */
const jobTitle = (emp) => emp?.si_title || emp?.title || ''

/* The department in Arabic when it has an Arabic name, else as stored. */
const department = (emp) => emp?.department_ar || emp?.department_en || ''

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

/* --- Hiring contract ------------------------------------------------- */

/* The ID issue month is typed by the user; it starts empty. The contract
   runs one year from the hiring date, less a day. */
export function hiringDates(emp, set = {}, today = todayUTC()) {
  const hired = emp ? parseISO(emp.hired_on) : null
  return {
    today: has(set, 'today') ? set.today : today,
    idIssued: has(set, 'idIssued') ? set.idIssued : null,
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

/* The acknowledgement is dated today unless the user sets it; the work
   start date is the hiring date. */
export function workStartDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
  }
}

export function workStartValues(emp, d) {
  const name = emp?.arabic_name || ''
  return {
    1: name,
    2: toArabicDigits(emp?.national_id || ''),
    3: phone(emp?.personal_mobile),
    4: emp?.address || '',
    5: jobTitle(emp),
    6: department(emp),
    7: arDate(d.hired),
    8: name,
    9: arDate(d.today),
  }
}

/* --- Social status declaration (إقرار الحالة الاجتماعية) ---------------- */

/* Dated today unless the user sets it. */
export function socialStatusDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    birth: emp ? parseISO(emp.birth_date) : null,
  }
}

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

/* The first row starts as the secondary contact on the record: its
   number, and its owner as the record writes it, "اسم (صلة القرابة)".
   Every box can still be changed. */
function socialStatusDefaults(emp) {
  if (!emp) return {}
  const m = /^\s*(.*?)\s*\((.*?)\)\s*$/.exec(emp.secondary_mobile_name || '')
  return {
    [refKey(0, 'name')]: m ? m[1] : (emp.secondary_mobile_name || ''),
    [refKey(0, 'relation')]: m ? m[2] : '',
    [refKey(0, 'phone')]: emp.secondary_mobile ? String(emp.secondary_mobile).replace(/\D/g, '') : '',
  }
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
               kind is text, amount (English digits, shown in Arabic
               digits and words) or year */
const DOCUMENTS = [
  {
    id: 'hiring',
    title: 'عقد عمل',
    subtitle: 'Hiring contract',
    template: 'templates/hiring-contract.docx?v=1',
    fileName: 'عقد عمل',
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
      [6, 'محل الإقامة'],
      [7, 'المؤهل'],
      [8, 'الرقم التأميني'],
      [9, 'الوظيفة'],
      [12, 'بداية العقد'],
      [13, 'نهاية العقد'],
    ],
    dateFields: [
      ['today', 'تاريخ تحرير العقد', [1, 2]],
      // Month and year: the card gives no day.
      ['idIssued', 'شهر وسنة إصدار البطاقة', [5], { month: true }],
    ],
    inputs: [
      ['salary', 'الأجر الشهري (بالأرقام الإنجليزية)', 'amount', [10, 11], 'مثال: 8500 أو 8500.50'],
    ],
  },
  {
    id: 'renewal',
    title: 'اتفاق تجديد عقد عمل محدد المدة',
    subtitle: 'Contract renewal',
    template: 'templates/contract-renewal.docx?v=2',
    fileName: 'تجديد عقد',
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
    template: 'templates/work-start.docx?v=2',
    fileName: 'إقرار استلام عمل',
    fields: {
      1: 'الاسم بالعربية', 2: 'الرقم القومي', 3: 'الموبايل الشخصي', 4: 'العنوان',
      5: 'الوظيفة', 6: 'الإدارة', 7: 'تاريخ التعيين', 8: 'الاسم بالعربية', 9: 'تاريخ الإقرار',
    },
    dates: workStartDates,
    values: workStartValues,
    info: [
      [2, 'الرقم القومي'],
      [3, 'الموبايل'],
      [4, 'العنوان'],
      [5, 'الوظيفة'],
      [6, 'الإدارة'],
      [7, 'تاريخ استلام العمل'],
    ],
    dateFields: [['today', 'تاريخ الإقرار', [9]]],
    inputs: [],
  },
  {
    id: 'social-status',
    title: 'إقرار الحالة الاجتماعية',
    subtitle: 'Social status declaration',
    template: 'templates/social-status.docx?v=4',
    fileName: 'إقرار الحالة الاجتماعية',
    fields: {
      1: 'تاريخ الإقرار', 2: 'الاسم بالعربية', 3: 'الرقم التأميني', 4: 'الوظيفة', 5: 'الإدارة',
      7: 'النوع (من الرقم القومي)', 8: 'الجنسية (من الرقم القومي)', 9: 'الديانة',
      10: 'المحافظة (من الرقم القومي)', 12: 'تاريخ الميلاد (من الرقم القومي)',
      23: 'الحالة الاجتماعية', 24: 'الاسم بالعربية', 25: 'تاريخ الإقرار',
      // One name for the whole table, so a missing box reads as one line.
      ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [26 + i, 'بيانات جدول الأشخاص الذين يمكن الرجوع إليهم'])),
    },
    refTable: REF_TABLE,
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
    ],
    dateFields: [['today', 'تاريخ الإقرار', [1, 25]]],
    inputs: [],
  },
]
for (const def of DOCUMENTS) def.blanks = Object.keys(def.fields).map(Number)

/* ------------------------------------------------------------------ */
/* Template preparation                                                 */
/* ------------------------------------------------------------------ */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
/* A blank as typed in the template: a number in brackets. Word often
   stores "(", "3" and ")" as three separate runs, and one of the
   template's brackets is typed backwards, so either bracket is
   accepted on either side. */
const BLANK = /[()]\s*(\d{1,2})\s*[()]/g
const MARK = (n) => `⟦${n}⟧` // ⟦n⟧
const MARK_RE = /⟦(\d{1,2})⟧/g

/* Rewrite every blank in document.xml as a single ⟦n⟧ inside one run,
   keeping that run's formatting, so it can be found again once the
   document is drawn. */
export function markBlanks(xml, blanks) {
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
        t.textContent = first ? keepBefore + MARK(+m[1]) + keepAfter : keepBefore + keepAfter
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

const templateCache = new Map()
async function loadTemplate(def) {
  const url = def.template
  if (!templateCache.has(url)) {
    templateCache.set(url, (async () => {
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`Template not found (${res.status})`)
      const zip = await JSZip.loadAsync(await res.arrayBuffer())
      let xml = await zip.file('word/document.xml').async('string')
      const border = pageBorder(xml)
      const tabStops = readTabStops(xml)
      const settings = zip.file('word/settings.xml') ? await zip.file('word/settings.xml').async('string') : ''
      const defaultTab = +(/<w:defaultTabStop w:val="(\d+)"/.exec(settings)?.[1] || 720) / 20
      // Kashida justification is how Word justifies Arabic; the renderer
      // does not know it and would leave those paragraphs unaligned.
      xml = xml.replace(/(<w:jc w:val=")(?:low|medium|high)Kashida(")/g, '$1both$2')
      zip.file('word/document.xml', markBlanks(useArabicRunProps(holdEmptyLines(xml)), def.blanks))
      for (const name of Object.keys(zip.files)) {
        if (/^word\/(styles|header\d*|footer\d*)\.xml$/.test(name)) {
          zip.file(name, useArabicRunProps(await zip.file(name).async('string')))
        }
      }
      return { blob: await zip.generateAsync({ type: 'blob' }), border, tabStops, defaultTab }
    })())
  }
  return templateCache.get(url)
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
  const stopsList = state.tabStops
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
    for (let pos = last + state.defaultTab; pos < 1000; pos += state.defaultTab) stops.push({ type: 'start', pos })
    tabs.forEach((tab, k) => {
      const pb = p.getBoundingClientRect()
      const right = pb.right - parseFloat(getComputedStyle(p).paddingRight) / scale
      const tb = tab.getBoundingClientRect()
      const at = (right - tb.right) * scale * PT // where the tab starts, from the right
      const stop = stops.find((s) => s.pos > at + 0.5)
      if (!stop) return
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
  for (const p of root.querySelectorAll('section.docx p')) {
    if (p.querySelector('.hr-field')) p.dataset.lines = String(lineCount(p))
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
function rightToLeft(root) {
  /* A section in columns fills them from the right, as Word does in a
     right-to-left document: CSS columns follow the direction of the
     element that holds them. Tables inside keep the column order they
     have in Word, which is left to right. */
  for (const article of root.querySelectorAll('section.docx article')) {
    if (!article.style.columnCount) continue
    article.dir = 'rtl'
    for (const table of article.querySelectorAll('table')) table.dir = 'ltr'
  }
  for (const p of root.querySelectorAll('section.docx p')) {
    p.dir = 'rtl'
    const align = getComputedStyle(p).textAlign
    if (align === 'left' || align === 'start' || align === '-webkit-left') p.style.textAlign = 'right'
  }
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
  const { blob, border, tabStops, defaultTab } = await loadTemplate(def)
  state.border = border
  state.tabStops = tabStops
  state.defaultTab = defaultTab
  await renderAsync(blob, preview, null, {
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
  markTabs(preview)
  lockBlanks(preview)
  matchFieldSize(preview)
  rightToLeft(preview)
  frame(preview, border)
  numberPages(preview)
  layoutTabs(preview)
  rememberLines(preview)
  splitColumns(preview)
  status.hidden = true
  fitPreview()
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
  for (const span of $('preview').querySelectorAll('.hr-field')) {
    const v = values[span.dataset.field]
    span.textContent = v || '……'
    span.classList.toggle('is-empty', !v)
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
function contentBottom(page) {
  const top = page.getBoundingClientRect().top
  let bottom = 0
  for (const el of page.querySelectorAll('p, tr')) {
    if (el.closest('footer, header')) continue
    const r = el.getBoundingClientRect()
    if (r.height) bottom = Math.max(bottom, r.bottom - top)
  }
  return Math.ceil(bottom)
}

/* One A4 sheet: the page image, then the frame and the page number,
   drawn on the sheet itself so they sit in the same place on every
   sheet. */
function sheet(width, draw, border, number, scale) {
  const c = document.createElement('canvas')
  c.width = width
  c.height = Math.round(width * (297 / 210))
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
  return c
}

/* One sheet per page, always. The pages are the template's own -- split
   where Word split them -- so the PDF and the printout have exactly as
   many pages as the Word file. A page that comes out a little longer
   than A4 here, because a font measures differently in the browser than
   in Word, is shrunk onto its sheet rather than spilling onto another. */
async function buildPdf() {
  const preview = $('preview')
  const pages = Array.from(preview.querySelectorAll('section.docx'))
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  state.capturing = true
  preview.style.zoom = ''
  if (document.activeElement && preview.contains(document.activeElement)) document.activeElement.blur()
  // The template numbers its pages in the footer.
  const numbered = pages.some((p) => /\d|[٠-٩]/.test(p.querySelector('footer')?.textContent || ''))
  const border = state.border
  preview.classList.add('is-capturing')
  try {
    for (const [i, page] of pages.entries()) {
      const cssWidth = page.offsetWidth
      const cssSheet = cssWidth * (297 / 210)
      const padBottom = parseFloat(getComputedStyle(page).paddingBottom) || 48
      const needed = contentBottom(page) + padBottom
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
      const c = sheet(canvas.width, (ctx, sheetHeight) => {
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
      }, border, numbered ? i + 1 : 0, k)
      if (i) pdf.addPage()
      pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297)
    }
  } finally {
    preview.classList.remove('is-capturing')
    state.capturing = false
    fitPreview()
  }
  return pdf.output('blob')
}

function pdfName(def, emp) {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').trim()
  return `${safe(def.fileName)} - ${safe(emp?.arabic_name)} - ${stamp}.pdf`
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
   comes out of the printer is exactly the file Save PDF writes. Where a
   browser will not print a PDF from a frame, it opens in a new tab with
   its own print button. */
async function printPdf() {
  const blob = await buildPdf()
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
const state = { def: null, employee: null, employees: [], dateSet: {}, inputs: {}, border: null, tabStops: null, defaultTab: 36, capturing: false, busy: false }

const EMPLOYEE_COLUMNS = ['id', 'code', 'arabic_name', 'national_id', 'hired_on', 'contract_expiry',
  'si_no', 'si_title', 'title', 'qualification_degree_ar', 'education_field', 'address', 'is_active',
  'department_id', 'personal_mobile', 'gender', 'birth_date', 'governorate', 'religion',
  'marital_status', 'military_service', 'secondary_mobile', 'secondary_mobile_name']

/* Department names by id, in Arabic where the department has one
   (departments.name_ar, from migration 20261112160001) and as stored
   otherwise. A database without that column yet gives the stored names. */
async function loadDepartments(supabase) {
  let { data, error } = await supabase.from('departments').select('id, name, name_ar')
  if (error && error.code === '42703') ({ data, error } = await supabase.from('departments').select('id, name'))
  if (error) return new Map()
  return new Map((data || []).map((d) => [d.id, { en: d.name, ar: d.name_ar || '' }]))
}

async function loadEmployees() {
  const supabase = await IEnergyAuth.getClient()
  const query = (columns) => supabase
    .from('employee_profiles')
    .select(columns.join(', '))
    .eq('is_active', true)
    .not('arabic_name', 'is', null)
    .order('arabic_name')
  let { data, error } = await query(EMPLOYEE_COLUMNS)
  /* A database the address migration (20261112150001) has not reached
     yet has no address column. The page still opens; the address prints
     blank until the migration is applied. */
  if (error && error.code === '42703' && /address/.test(error.message || '')) {
    ({ data, error } = await query(EMPLOYEE_COLUMNS.filter((c) => c !== 'address')))
  }
  if (error) throw error
  const departments = await loadDepartments(supabase)
  state.employees = (data || []).map((e) => ({
    ...e,
    department_ar: departments.get(e.department_id)?.ar || '',
    department_en: departments.get(e.department_id)?.en || '',
    _key: foldArabic(e.arabic_name),
  }))
  return state.employees
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
  if (!q) return state.employees
  return state.employees.filter((e) =>
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
      const emp = state.employees.find((x) => String(x.id) === li.dataset.id)
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
    const input = document.createElement('input')
    input.id = `input-${key}`
    input.className = 'hr-input'
    input.type = 'text'
    input.autocomplete = 'off'
    if (kind === 'year') {
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

function currentDates() {
  return state.def.dates(state.employee, state.dateSet)
}

/* The blanks the user can change, each with the box that changes it. */
function editableBlanks(def) {
  const out = new Map()
  for (const [key, , fields] of def.dateFields) for (const f of fields) out.set(f, `date-${key}`)
  for (const [key, , , fields] of def.inputs) for (const f of fields) out.set(f, `input-${key}`)
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
function refresh() {
  const def = state.def
  if (!def) return
  const emp = state.employee
  const dates = currentDates()
  const inputs = currentInputs()
  const values = def.values(emp, dates, inputs)
  releaseLines($('preview'))
  fillFields(values)
  layoutTabs($('preview'))
  keepLines($('preview'))
  const editable = editableBlanks(def)
  if (def.refTable) {
    for (const [k, v] of Object.entries(inputs)) {
      const box = k.startsWith('ref') && $(`input-${k}`)
      if (box && document.activeElement !== box && !box.classList.contains('is-invalid')) box.value = v
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
    v.textContent = values[n] || '—'
    row.append(l, v)
    box.appendChild(row)
  }

  /* The rule for every form: nothing is saved or printed with a blank
     left empty. What is missing is named -- from the employee record,
     to be put right there, or from the boxes here, to be filled in. */
  const empty = def.blanks.filter((n) => !values[n])
  const names = (list) => [...new Set(list.map((n) => def.fields[n]))].join('، ')
  const fromRecord = empty.filter((n) => !editable.has(n))
  const toFill = empty.filter((n) => editable.has(n))
  const warn = $('fieldWarning')
  const notes = []
  if (emp && fromRecord.length) notes.push(`بيانات ناقصة في قاعدة بيانات الموظفين: ${names(fromRecord)}. أكملها أولاً ثم أعد الاختيار.`)
  if (emp && toFill.length) notes.push(`أدخل ${names(toFill)}.`)
  if (notes.length) notes.push('لا يمكن الحفظ أو الطباعة قبل استكمال كل البيانات.')
  warn.hidden = !notes.length
  warn.textContent = notes.join(' ')

  const ready = !!emp && !empty.length && !state.busy
  $('savePdfBtn').disabled = !ready
  $('printBtn').disabled = !ready
}

/* ------------------------------------------------------------------ */
/* Views                                                                */
/* ------------------------------------------------------------------ */

function drawList() {
  const list = $('docList')
  list.innerHTML = ''
  DOCUMENTS.forEach((def, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'hr-doc'
    btn.disabled = !def.template
    const num = document.createElement('span')
    num.className = 'hr-doc-num'
    num.textContent = String(i + 1)
    const text = document.createElement('span')
    text.className = 'hr-doc-text'
    const t = document.createElement('span')
    t.className = 'hr-doc-title'
    t.dir = 'rtl'
    t.textContent = def.title
    const s = document.createElement('span')
    s.className = 'hr-doc-sub'
    s.textContent = def.template ? def.subtitle : `${def.subtitle} · coming soon`
    text.append(t, s)
    const icon = document.createElement('span')
    icon.className = 'hr-doc-icon'
    icon.textContent = 'W'
    btn.append(icon, text, num)
    if (def.template) btn.addEventListener('click', () => openDocument(def))
    list.appendChild(btn)
  })
}

async function openDocument(def) {
  state.def = def
  state.employee = null
  state.dateSet = {}
  state.inputs = {}
  $('employeeSearch').value = ''
  $('editorTitle').textContent = def.title
  buildDateInputs(def)
  buildInputs(def)
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
  const LABEL = { super_admin: 'Super admin', admin: 'Admin' }
  badge.textContent = LABEL[me.trackerRole] || me.trackerRole || ''
  badge.className = 'role-badge' + (me.trackerRole === 'super_admin' ? ' is-super' : ' is-admin')
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
    .then((list) => { hint.textContent = `${toArabicDigits(list.length)} موظف — ابحث بالاسم أو الكود.` })
    .catch((err) => { hint.textContent = `تعذر تحميل الموظفين: ${err.message || err}` })

  const wanted = DOCUMENTS.find((d) => d.template && `#${d.id}` === location.hash)
  if (wanted) openDocument(wanted)
}

function start() {
  $('year').textContent = String(new Date().getFullYear())
  const out = $('logoutBtn')
  out.addEventListener('click', () => {
    out.disabled = true
    out.textContent = 'Signing out…'
    IEnergyAuth.signOutAndLeave('../index.html')
  })
  IEnergyAuth.ensureAuth({ allowedRoles: ['admin'], homeHref: '../index.html', onAuthed })
}

if (window.IEnergyAuth) start()
