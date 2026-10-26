// Match the Attendance Tracker monthly report's workbook presentation.
export function buildEmployeeWorkbook(ExcelJS, rows, generated = new Date()) {
  const book = new ExcelJS.Workbook()
  book.creator = 'IEnergy Portal'
  book.created = generated
  const sheet = book.addWorksheet('Employees', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  sheet.addRow(['Employees Database']).font = {
    bold: true, size: 14, color: { argb: 'FF1E3A5F' },
  }
  sheet.addRow(['Employees', rows.length]).getCell(1).font = { bold: true }
  sheet.addRow(['Generated', generated.toLocaleString()]).getCell(1).font = { bold: true }
  sheet.addRow([])

  const keys = Object.keys(rows[0])
  const headerRow = sheet.rowCount + 1

  /* A real Excel table rather than a styled range: banded rows, filter
     buttons, and a range that grows when somebody types under it.

     Excel requires every column name to be present and unique and will
     not open the file otherwise -- it reports unreadable content and
     offers to repair, which loses the sheet. These names come from
     exportRow, which is edited whenever a field is added, so this checks
     instead of trusting, and falls back to the old navy header when the
     check fails. A duller sheet beats one that will not open. */
  const names = keys.map(k => String(k ?? '').trim())
  const safe = names.every(Boolean) && new Set(names).size === names.length

  if (safe) {
    sheet.addTable({
      name: 'tblEmployees',
      ref: `A${headerRow}`,
      headerRow: true,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: keys.map(k => ({ name: k, filterButton: true })),
      rows: rows.map(data => keys.map(key => data[key] ?? null)),
    })
  } else {
    const header = sheet.addRow(keys)
    header.height = 28
    header.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.border = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side =>
        [side, { style: 'thin', color: { argb: 'FFCCCCCC' } }]))
    })
    rows.forEach(data => sheet.addRow(keys.map(key => data[key] ?? null)))
  }

  /* Formatting goes on afterwards either way: addTable writes the values
     but takes no cell formats, so this is the only place the wage columns
     and the Arabic ones get their treatment. */
  const decimalColumns = new Set([
    'Annual leave (days)', 'Un-planned leave (days)', 'S.I. basic wage', 'S.I. gross wage',
  ])
  rows.forEach((data, r) => {
    const row = sheet.getRow(headerRow + 1 + r)
    keys.forEach((key, i) => {
      const cell = row.getCell(i + 1)
      if (decimalColumns.has(key)) cell.numFmt = '#,##0.00'
      if (key === 'Arabic name' || key === 'Qualification degree (Arabic)') {
        cell.alignment = { horizontal: 'right', readingOrder: 'rtl' }
      }
    })
  })
  keys.forEach((key, i) => {
    let longest = key.length
    for (const row of rows) longest = Math.max(longest, String(row[key] ?? '').length)
    sheet.getColumn(i + 1).width = Math.min(Math.max(longest + 3, 10), 42)
  })
  sheet.views = [{ state: 'normal' }]
  // Only when there is no table. A table carries its own filter buttons,
  // and a sheet-level filter over the same range fights with them.
  if (!safe) {
    sheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow, column: keys.length },
    }
  }
  return book
}
