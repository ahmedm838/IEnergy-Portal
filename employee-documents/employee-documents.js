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
  amountDigits, installment, jobTitle, department, parseAmount,
} from '../hr-documents/hr-documents.js?v=58'

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
   (2) and (4). The requester is the employee chosen at the top. The four
   approvers, (8) to (11), are left empty: they are written by hand when
   the form is signed. */
export function grantValues(emp, d, inputs = {}, ctx = {}) {
  const grant = ctx.choice ? ctx.choice('grant') : null
  return {
    1: arDate(d.today),
    2: grant ? pounds(parseAmount(String(grant.amount)) || null) : '',
    3: grant?.name || '',
    4: grant?.attachments || '',
    5: emp?.arabic_name || '',
    6: jobTitle(emp),
    7: department(emp),
  }
}

/* --- Penalty notice (إخطار بشأن وقوع مخالفة) --------------------------- */

/* Dated today unless the user sets it. */
export function penaltyDates(emp, set = {}, today = todayUTC()) {
  return { today: has(set, 'today') ? set.today : today }
}

/* Only the heading is filled: the date and who the notice is about.
   The violations are ticked, explained, signed and decided on by hand. */
export function penaltyValues(emp, d) {
  return {
    1: arDate(d.today),
    2: emp?.arabic_name || '',
    3: jobTitle(emp),
    4: department(emp),
  }
}

const DOCUMENTS = [
  {
    id: 'salary-advance',
    title: 'طلب سلفة (بوجود ضامن)',
    subtitle: 'Salary advance request with a guarantor',
    template: 'templates/salary-advance.docx?v=2',
    fileName: 'طلب سلفة',
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
    template: 'templates/financial-grant.docx?v=2',
    fileName: 'طلب صرف منحة مالية',
    fields: {
      1: 'تاريخ الطلب', 2: 'نوع المنحة', 3: 'نوع المنحة', 4: 'نوع المنحة',
      5: 'الاسم بالعربية', 6: 'الوظيفة', 7: 'الإدارة',
      8: 'مدير الإدارة', 9: 'الشئون الإدارية', 10: 'العضو المنتدب', 11: 'الإدارة المالية',
    },
    // Approvers' names are written by hand: dots on screen, room on paper.
    optional: [8, 9, 10, 11],
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
    ],
  },
  {
    id: 'penalty-notice',
    title: 'إخطار بشأن وقوع مخالفة',
    subtitle: 'Penalty notice',
    template: 'templates/penalty-notice.docx?v=3',
    fileName: 'إخطار بشأن وقوع مخالفة',
    fields: { 1: 'تاريخ الإخطار', 2: 'الاسم بالعربية', 3: 'الوظيفة', 4: 'الإدارة' },
    // The violations table is right to left in Word, its first column on
    // the right; the page keeps that.
    ownDirection: true,
    dates: penaltyDates,
    values: penaltyValues,
    info: [
      [3, 'الوظيفة'],
      [4, 'الإدارة'],
    ],
    dateFields: [['today', 'تاريخ الإخطار', [1]]],
    inputs: [],
  },
]

if (window.IEnergyAuth) startDocumentsPage({ documents: DOCUMENTS, allowedRoles: ['user', 'admin'] })
