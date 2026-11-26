/**
 * One rule for finding an employee by what is typed, on every page:
 * a code, or a name in English or Arabic.
 *
 * Arabic is folded so the spellings people type interchangeably match
 * (أ/إ/آ → ا, ى → ي, ة → ه, diacritics and tatweel dropped), and
 * Arabic-Indic digits count as the same digits for the code.
 */
export const foldText = (s) =>
  String(s ?? '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

export const westernDigits = (s) =>
  String(s ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))

/** A test for one search term, reused across a list. */
export function employeeMatcher(term) {
  const needle = foldText(westernDigits(term))
  const digits = /^\d+$/.test(needle) ? needle : ''
  return (e) =>
    !needle ||
    foldText(e?.name).includes(needle) ||
    foldText(e?.arabic_name).includes(needle) ||
    (!!digits && String(e?.code ?? '').includes(digits))
}
