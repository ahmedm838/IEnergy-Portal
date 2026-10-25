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
  const header = sheet.addRow(keys)
  header.height = 28
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side =>
      [side, { style: 'thin', color: { argb: 'FFCCCCCC' } }]))
  })
  const decimalColumns = new Set([
    'Annual leave (days)', 'Un-planned leave (days)', 'S.I. basic wage', 'S.I. gross wage',
  ])
  rows.forEach(data => {
    const row = sheet.addRow(keys.map(key => data[key] ?? null))
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
  sheet.autoFilter = {
    from: { row: header.number, column: 1 },
    to: { row: header.number, column: keys.length },
  }
  return book
}
