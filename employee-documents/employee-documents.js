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
  amountDigits, installment, jobTitle, department,
} from '../hr-documents/hr-documents.js?v=36'

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

const DOCUMENTS = [
  {
    id: 'salary-advance',
    title: 'طلب سلفة (بوجود ضامن)',
    subtitle: 'Salary advance request with a guarantor',
    template: 'templates/salary-advance.docx?v=1',
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
]

if (window.IEnergyAuth) startDocumentsPage({ documents: DOCUMENTS, allowedRoles: ['user', 'admin'] })
