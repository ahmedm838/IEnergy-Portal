/* Employee Documents
   - Open to every signed-in user, admins included. The forms are filled
     the way HR Documents fills its own -- the same engine, started here
     with this page's list -- and row level security decides whose records
     a user can read: their own and those of the people below them.
   - Each document is a Word template whose blanks are written as (1),
     (2), ... in the text; see hr-documents/hr-documents.js.
*/
import {
  startDocumentsPage, todayUTC, has, parseISO, arDate, toArabicDigits,
  amountDigits, installment, jobTitle, department, parseAmount, arMonth,
} from '../hr-documents/hr-documents.js?v=117'

/* --- Salary advance with a guarantor (طلب سلفة بوجود ضامن) -------------- */

/* Dated today unless the user sets it. */
export function advanceDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
  }
}

const pounds = (a) => (a ? `${amountDigits(a)} جنيه` : '')

/* The amount and the number of installments are typed; the installment
   is the amount over that number, to the piaster. The requester is the
   employee chosen at the top, the guarantor the one chosen below. */
export function advanceValues(emp, d, inputs = {}, ctx = {}) {
  const g = ctx.find ? ctx.find(inputs.guarantor) : null
  const amount = inputs.amount || null
  const count = inputs.count || null
  return {
    1: arDate(d.today),
    2: pounds(amount),
    3: count ? toArabicDigits(count) : '',
    4: pounds(installment(amount, count)),
    5: emp?.arabic_name || '',
    6: jobTitle(emp),
    7: department(emp),
    8: arDate(d.hired),
    9: g?.arabic_name || '',
    10: jobTitle(g),
    11: department(g),
    12: g ? arDate(parseISO(g.hired_on)) : '',
  }
}

/* --- Financial grant request (طلب صرف منحة مالية) ---------------------- */

/* Dated today unless the user sets it. */
export function grantDates(emp, set = {}, today = todayUTC()) {
  return { today: has(set, 'today') ? set.today : today }
}

/* The grant is picked from the financial grants table (Settings in the
   tracker): its name is the reason (3), its amount and attachments fill
   (2) and (4), the amount grouped with ",". The requester is the
   employee chosen at the top; the department manager (8) is chosen from
   the employees. */
export function grantValues(emp, d, inputs = {}, ctx = {}) {
  const grant = ctx.choice ? ctx.choice('grant') : null
  return {
    1: arDate(d.today),
    2: grant ? pounds(parseAmount(String(grant.amount)) || null).replace(/٬/g, ',') : '',
    3: grant?.name || '',
    4: grant?.attachments || '',
    5: emp?.arabic_name || '',
    6: jobTitle(emp),
    7: department(emp),
    8: inputs.manager || '',
  }
}

/* --- Penalty notice (إخطار بشأن وقوع مخالفة) --------------------------- */

/* Dated today unless the user sets it. */
export function penaltyDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
  }
}

/* Only the heading is filled: the date and who the notice is about,
   with their hiring date (5) from the record.
   The violations are ticked, explained, signed and decided on by hand. */
export function penaltyValues(emp, d) {
  return {
    1: arDate(d.today),
    2: emp?.arabic_name || '',
    3: jobTitle(emp),
    4: department(emp),
    5: arDate(d.hired),
  }
}

/* --- Custody receipt (إقرار استلام عهدة) ------------------------------- */

/* Dated today unless the user sets it. The hiring date is the record's;
   the ID card's issue date starts as the record's and can be set here
   (month and year, as the card has it), for a record that lacks it. */
export function custodyDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
    idIssued: has(set, 'idIssued') ? set.idIssued : (emp ? parseISO(emp.id_issue_date) : null),
  }
}

/* The equipment handed over: five rows of description, specifications,
   model and serial number, and notes, blanks (11) to (30) row by row,
   typed on the form. Rows left empty print empty; at least one row is
   needed, and a row used needs its description (custodyCheck). */
const CUSTODY_TABLE = {
  title: 'الأجهزة والمعدات المسلّمة (صف واحد على الأقل)',
  first: 11,
  rows: 5,
  cols: [['item', 'وصف المعدة / الجهاز', 'text'], ['specs', 'المواصفات', 'text'], ['model', 'الموديل والرقم المسلسل', 'text'], ['notes', 'ملاحظات', 'text']],
}
const CUSTODY_CELLS = Array.from({ length: CUSTODY_TABLE.rows * CUSTODY_TABLE.cols.length }, (_, i) => CUSTODY_TABLE.first + i)
const custodyCell = (inputs, r, col) => String(inputs[`ref${r}_${col}`] || '').trim()

export function custodyCheck(emp, d, inputs = {}) {
  const rows = Array.from({ length: CUSTODY_TABLE.rows }, (_, r) => CUSTODY_TABLE.cols.map(([col]) => custodyCell(inputs, r, col)))
  const used = rows.map((cells, r) => [r, cells]).filter(([, cells]) => cells.some(Boolean))
  if (!used.length) return 'أدخل صفًا واحدًا على الأقل في جدول الأجهزة والمعدات.'
  const noItem = used.filter(([, cells]) => !cells[0]).map(([r]) => toArabicDigits(r + 1))
  if (noItem.length) return `أدخل وصف المعدة / الجهاز في الصف ${noItem.join('، ')} من الجدول.`
  return ''
}

/* The employee's details at the top, with only the last four digits of
   the national ID ("بطاقة رقم قومي منتهية بـ"), and their name above the
   signature. The direct manager (10) and whoever hands the custody over
   (9) are chosen from the employees; the equipment table is typed. */
export function custodyValues(emp, d, inputs = {}) {
  const name = emp?.arabic_name || ''
  const id = String(emp?.national_id || '').replace(/\D/g, '')
  const table = {}
  for (let r = 0; r < CUSTODY_TABLE.rows; r++) {
    CUSTODY_TABLE.cols.forEach(([col], c) => {
      table[CUSTODY_TABLE.first + r * CUSTODY_TABLE.cols.length + c] = custodyCell(inputs, r, col)
    })
  }
  return {
    1: arDate(d.today),
    2: name,
    3: id.length >= 4 ? toArabicDigits(id.slice(-4)) : '',
    // "صادرة بتاريخ": the card's issue month, as the card has it.
    4: arMonth(d.idIssued),
    5: jobTitle(emp),
    6: department(emp),
    7: arDate(d.hired),
    8: name,
    9: inputs.handover || '',
    10: inputs.manager || '',
    ...table,
  }
}

/* --- Lost custody memo (مذكرة إدارية - فقد عهدة) ----------------------- */

/* A memo to the legal affairs manager referring the loss of an
   employee's custody for investigation. The date and the employee's
   details come from the record; the custody's description (6) and serial
   number (7) are typed, the dates it was received (8) and found lost (9)
   set here, and the department manager (10) chosen from the employees.
   Only the signature is written by hand. */
export function custodyLossDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
    received: has(set, 'received') ? set.received : null,
    lost: has(set, 'lost') ? set.lost : null,
  }
}

export function custodyLossValues(emp, d, inputs = {}) {
  const serial = String(inputs.serial || '').trim()
  return {
    1: arDate(d.today),
    2: emp?.arabic_name || '',
    3: jobTitle(emp),
    4: department(emp),
    5: arDate(d.hired),
    6: String(inputs.item || '').trim(),
    // "إن وجد": left empty, the memo says there is none.
    7: serial || 'لا يوجد',
    8: arDate(d.received),
    9: arDate(d.lost),
    10: inputs.manager || '',
  }
}

/* The loss is found after the custody was received, and neither after
   the memo's date. */
export function custodyLossCheck(emp, d) {
  if (d.received && d.lost && d.lost < d.received) return 'تاريخ اكتشاف الفقد قبل تاريخ استلام العهدة.'
  if (d.today && d.lost && d.lost > d.today) return 'تاريخ اكتشاف الفقد بعد تاريخ المذكرة.'
  if (d.today && d.received && d.received > d.today) return 'تاريخ استلام العهدة بعد تاريخ المذكرة.'
  return ''
}

/* --- Hiring request (طلب تعيين) --------------------------------------- */

/* Dated today unless the user sets it; the hiring date asked for starts
   empty and is set here. */
export function hiringRequestDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    wanted: has(set, 'wanted') ? set.wanted : null,
  }
}

/* The requesting department is picked from the departments, by its
   Arabic name (Settings in the tracker); the job asked for is typed. The
   ticks, the requirements and the signatures are filled in by hand. */
export function hiringRequestValues(emp, d, inputs = {}, ctx = {}) {
  const dept = ctx.choice ? ctx.choice('department') : null
  return {
    1: arDate(d.today),
    2: dept?.name_ar || '',
    3: inputs.jobTitle || '',
    4: arDate(d.wanted),
  }
}

/* --- Purchase request (طلب شراء) ------------------------------------- */

/* Dated today unless the user sets it. */
export function purchaseDates(emp, set = {}, today = todayUTC()) {
  return { today: has(set, 'today') ? set.today : today }
}

/* Only the heading is filled: the date and who is asking. The items
   table, the purpose, the supply date (5), the priority and the
   signatures are filled in by hand. */
export function purchaseValues(emp, d) {
  return {
    1: arDate(d.today),
    2: emp?.arabic_name || '',
    3: jobTitle(emp),
    4: department(emp),
  }
}

/* --- Performance evaluation (تقييم أداء) ------------------------------ */

/* Dated today unless the user sets it; the evaluation period starts
   empty and is set here, from and to. */
export function evaluationDates(emp, set = {}, today = todayUTC()) {
  return {
    today: has(set, 'today') ? set.today : today,
    hired: emp ? parseISO(emp.hired_on) : null,
    from: has(set, 'from') ? set.from : null,
    to: has(set, 'to') ? set.to : null,
  }
}

/* The employee's details and the period at the top, the direct manager
   chosen from the employees, and the employee's name again above their
   signature. The scores, notes and signatures are written by hand. */
export function evaluationValues(emp, d, inputs = {}) {
  const name = emp?.arabic_name || ''
  return {
    1: arDate(d.today),
    2: name,
    3: jobTitle(emp),
    4: department(emp),
    5: arDate(d.hired),
    6: arDate(d.from),
    7: arDate(d.to),
    8: inputs.manager || '',
    9: name,
  }
}

const DOCUMENTS = [
  {
    id: 'salary-advance',
    title: 'طلب سلفة (بوجود ضامن)',
    subtitle: 'Salary advance request with a guarantor',
    template: 'templates/salary-advance.docx?v=8',
    // The company letterhead: logo and title in the header, address in the
    // footer printed as it is, as on the performance evaluation.
    keepFooter: true,
    fields: {
      1: 'تاريخ الطلب', 2: 'قيمة السلفة', 3: 'عدد الأقساط', 4: 'قيمة القسط',
      5: 'الاسم بالعربية', 6: 'الوظيفة', 7: 'الإدارة', 8: 'تاريخ التعيين',
      9: 'الموظف الضامن', 10: 'وظيفة الضامن', 11: 'إدارة الضامن', 12: 'تاريخ تعيين الضامن',
    },
    dates: advanceDates,
    values: advanceValues,
    info: [
      [6, 'الوظيفة'],
      [7, 'الإدارة'],
      [8, 'تاريخ التعيين'],
      [4, 'قيمة القسط'],
      [10, 'وظيفة الضامن'],
      [11, 'إدارة الضامن'],
      [12, 'تاريخ تعيين الضامن'],
    ],
    dateFields: [['today', 'تاريخ الطلب', [1]]],
    inputs: [
      ['amount', 'قيمة السلفة (بالأرقام الإنجليزية)', 'amount', [2, 4], 'مثال: 6000 أو 6000.50'],
      ['count', 'عدد الأقساط', 'count', [3, 4], 'قيمة القسط = قيمة السلفة ÷ عدد الأقساط'],
      ['guarantor', 'الموظف الضامن', 'employee', [9, 10, 11, 12]],
    ],
  },
  {
    id: 'financial-grant',
    title: 'طلب صرف منحة مالية',
    subtitle: 'Financial grant request',
    template: 'templates/financial-grant.docx?v=9',
    // The company letterhead: logo and title in the header, address in the
    // footer printed as it is, as on the performance evaluation.
    keepFooter: true,
    fields: {
      1: 'تاريخ الطلب', 2: 'نوع المنحة', 3: 'نوع المنحة', 4: 'نوع المنحة',
      5: 'الاسم بالعربية', 6: 'الوظيفة', 7: 'الإدارة',
      8: 'مدير الإدارة',
    },
    wrap: [3, 4],
    dates: grantDates,
    values: grantValues,
    info: [
      [6, 'الوظيفة'],
      [7, 'الإدارة'],
      [3, 'السبب'],
      [2, 'قيمة المنحة'],
      [4, 'المرفقات'],
    ],
    dateFields: [['today', 'تاريخ الطلب', [1]]],
    inputs: [
      ['grant', 'نوع المنحة', 'choice', [2, 3, 4], 'السبب والقيمة والمرفقات تُملأ تلقائيًا من جدول المنح المالية.',
        { table: 'financial_grants', label: 'name' }],
      ['manager', 'مدير الإدارة', 'person', [8]],
    ],
  },
  {
    id: 'penalty-notice',
    title: 'إخطار بشأن وقوع مخالفة',
    subtitle: 'Penalty notice',
    template: 'templates/penalty-notice.docx?v=10',
    // The company letterhead: logo and title in the header, address in the
    // footer printed as it is, as on the performance evaluation.
    keepFooter: true,
    fields: { 1: 'تاريخ الإخطار', 2: 'الاسم بالعربية', 3: 'الوظيفة', 4: 'الإدارة', 5: 'تاريخ التعيين' },
    // Its table and lines measured as Word measures them, so each page is
    // as long here as it is in Word.
    wordMetrics: true,
    // The violations table is right to left in Word, its first column on
    // the right; the page keeps that.
    ownDirection: true,
    // Printed on both sides, flipped on the long edge.
    duplex: true,
    // Two pages, as in Word: the second starts at this row of the table.
    pageStarts: ['العبث أو ارتكاب أي فعل'],
    dates: penaltyDates,
    values: penaltyValues,
    info: [
      [3, 'الوظيفة'],
      [4, 'الإدارة'],
      [5, 'تاريخ التعيين'],
    ],
    dateFields: [['today', 'تاريخ الإخطار', [1]]],
    inputs: [],
  },
  {
    id: 'custody',
    title: 'إقرار استلام عهدة',
    subtitle: 'Custody receipt',
    template: 'templates/custody.docx?v=7',
    // The company letterhead: logo and title in the header, address in the
    // footer printed as it is, as on the performance evaluation.
    keepFooter: true,
    fields: {
      1: 'تاريخ الإقرار', 2: 'الاسم بالعربية', 3: 'الرقم القومي', 4: 'تاريخ إصدار البطاقة',
      5: 'الوظيفة', 6: 'الإدارة', 7: 'تاريخ التعيين', 8: 'الاسم بالعربية',
      9: 'المسئول عن تسليم العهدة', 10: 'المدير المباشر',
      // One name for the whole table, so a missing box reads as one line.
      ...Object.fromEntries(CUSTODY_CELLS.map((n) => [n, 'جدول الأجهزة والمعدات'])),
    },
    refTable: CUSTODY_TABLE,
    // Rows may be left empty (they print empty); custodyCheck asks for
    // at least one, with its description.
    optional: CUSTODY_CELLS,
    // What is typed in the table may run onto a second line in its cell.
    wrap: CUSTODY_CELLS,
    dates: custodyDates,
    values: custodyValues,
    check: custodyCheck,
    info: [
      [3, 'الرقم القومي (آخر ٤ أرقام)'],
      [5, 'الوظيفة'],
      [6, 'الإدارة'],
      [7, 'تاريخ التعيين'],
    ],
    dateFields: [
      ['today', 'تاريخ الإقرار', [1]],
      ['idIssued', 'تاريخ إصدار البطاقة', [4], { month: true }],
    ],
    inputs: [
      ['manager', 'المدير المباشر', 'person', [10]],
      ['handover', 'المسئول عن تسليم العهدة', 'person', [9]],
    ],
  },
  {
    id: 'custody-loss',
    title: 'مذكرة إدارية (فقد عهدة)',
    subtitle: 'Lost custody memo',
    template: 'templates/custody-loss.docx?v=9',
    // The company letterhead: logo and title in the header, address in the
    // footer printed as it is, as on the performance evaluation.
    keepFooter: true,
    fields: {
      1: 'تاريخ المذكرة', 2: 'الاسم بالعربية', 3: 'الوظيفة', 4: 'الإدارة', 5: 'تاريخ التعيين',
      6: 'بيان العهدة المفقودة', 7: 'الرقم المسلسل', 8: 'تاريخ استلام العهدة', 9: 'تاريخ اكتشاف الفقد',
      10: 'مدير الإدارة',
    },
    // The description may run onto a second line.
    wrap: [6],
    dates: custodyLossDates,
    values: custodyLossValues,
    check: custodyLossCheck,
    info: [
      [3, 'الوظيفة'],
      [4, 'الإدارة'],
      [5, 'تاريخ التعيين'],
    ],
    dateFields: [
      ['today', 'تاريخ المذكرة', [1]],
      ['received', 'تاريخ استلام العهدة', [8]],
      ['lost', 'تاريخ اكتشاف الفقد', [9]],
    ],
    inputs: [
      ['item', 'بيان العهدة المفقودة (الاسم والمواصفات)', 'text', [6], 'مثال: لابتوب Dell Latitude 5420، معالج i5، رام 16 جيجا'],
      ['serial', 'الرقم المسلسل (إن وجد)', 'text', [7], 'اتركه فارغًا إن لم يوجد، ويُكتب «لا يوجد».'],
      ['manager', 'مدير الإدارة', 'person', [10]],
    ],
  },
  {
    id: 'hiring-request',
    title: 'طلب تعيين',
    subtitle: 'Hiring request',
    template: 'templates/hiring-request.docx?v=7',
    // The company letterhead: logo and title in the header, address in the
    // footer printed as it is, as on the performance evaluation.
    keepFooter: true,
    fields: { 1: 'تاريخ الطلب', 2: 'الإدارة الطالبة', 3: 'المسمى الوظيفي المطلوب', 4: 'تاريخ التعيين المطلوب' },
    dates: hiringRequestDates,
    values: hiringRequestValues,
    info: [],
    dateFields: [
      ['today', 'تاريخ الطلب', [1]],
      ['wanted', 'تاريخ التعيين المطلوب', [4]],
    ],
    inputs: [
      ['department', 'الإدارة الطالبة', 'choice', [2], null, { table: 'departments', label: 'name_ar' }],
      ['jobTitle', 'المسمى الوظيفي المطلوب', 'text', [3]],
    ],
  },
  {
    id: 'purchase-request',
    title: 'طلب شراء',
    subtitle: 'Purchase request',
    template: 'templates/purchase-request.docx?v=7',
    // The company letterhead: logo and title in the header, address in the
    // footer printed as it is, as on the performance evaluation.
    keepFooter: true,
    fields: { 1: 'تاريخ الطلب', 2: 'الاسم بالعربية', 3: 'الوظيفة', 4: 'الإدارة', 5: 'تاريخ التوريد المطلوب' },
    // The supply date is written by hand: dots on screen, room on paper.
    optional: [5],
    // The items table is right to left in Word, its first column on the
    // right; the page keeps that.
    ownDirection: true,
    // The purposes are set out with tabs in two rows, column under column.
    tabsWrap: true,
    dates: purchaseDates,
    values: purchaseValues,
    info: [
      [3, 'الوظيفة'],
      [4, 'الإدارة'],
    ],
    dateFields: [['today', 'تاريخ الطلب', [1]]],
    inputs: [],
  },
  {
    id: 'performance-evaluation',
    title: 'تقييم أداء',
    subtitle: 'Performance evaluation',
    template: 'templates/performance-evaluation.docx?v=21',
    /* Drawn from the Word file, so it can be changed in Word and
       uploaded again. Two pages, the second starting at the strengths
       section, whether or not the file has a page break there: each
       prints on exactly one A4 sheet, drawn smaller only if it runs long
       here, never cut onto a third. */
    fitPages: true,
    pageStarts: ['نقاط القوة الرئيسية'],
    // Its tables and lines measured as Word measures them, so page 1 is as
    // long on screen and in the PDF as it is in Word.
    wordMetrics: true,
    // Its footer (the company address) prints on both pages, as in Word,
    // its numbers in English digits as written; no page number is drawn
    // over it.
    keepFooter: true,
    // The score tables are right to left in Word, their first column on
    // the right; the page keeps that.
    ownDirection: true,
    fields: {
      1: 'تاريخ التقييم', 2: 'الاسم بالعربية', 3: 'الوظيفة', 4: 'الإدارة', 5: 'تاريخ التعيين',
      6: 'فترة التقييم من', 7: 'فترة التقييم حتى', 8: 'المدير المباشر', 9: 'الاسم بالعربية',
    },
    // Its two pages print front and back of one sheet, flipped on the
    // long edge.
    duplex: true,
    dates: evaluationDates,
    values: evaluationValues,
    info: [
      [3, 'الوظيفة'],
      [4, 'الإدارة'],
      [5, 'تاريخ التعيين'],
    ],
    dateFields: [
      ['today', 'تاريخ التقييم', [1]],
      ['from', 'فترة التقييم من', [6]],
      ['to', 'فترة التقييم حتى', [7]],
    ],
    inputs: [['manager', 'المدير المباشر', 'person', [8]]],
  },
]

if (window.IEnergyAuth) // Any employee can be picked -- the person a request is for, a
// guarantor, a manager -- from the whole company, not only the user's
// sector (see employee_directory).
startDocumentsPage({ documents: DOCUMENTS, allowedRoles: ['user', 'admin'], page: 'employee-documents', anyEmployee: true })
