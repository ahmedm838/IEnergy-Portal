/**
 * Workbook export.
 *
 * ExcelJS is used rather than a CSV dump because the reports carry Arabic
 * attendance labels and currency columns; a CSV loses both the encoding
 * and the number formats the payroll team expects.
 *
 * It is also around 900 kB, and most sessions never export anything, so it
 * is loaded on first use rather than bundled into the initial payload.
 */
let excelPromise = null
function loadExcelJS() {
  if (!excelPromise) excelPromise = import('exceljs').then((m) => m.default ?? m)
  return excelPromise
}

/**
 * Start fetching ExcelJS before anyone clicks Export.
 *
 * The chunk is ~940 kB. Loading it inside the click handler puts a long
 * await between the click and the download, which outlives the browser's
 * user-activation window: Chrome then stops attributing the download to
 * the click, treats it as site-initiated, and shows the "wants to
 * download multiple files" permission prompt instead of saving the file.
 *
 * Warming it on page load keeps the click-to-download gap down to
 * building the workbook, which is milliseconds.
 */
export function prefetchExcel() {
  if (excelPromise) return
  const warm = () => {
    loadExcelJS().catch(() => {
      // Let the real export surface the failure; a failed prefetch should
      // not put an error in front of someone who never clicked Export.
      excelPromise = null
    })
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 2000 })
  else setTimeout(warm, 300)
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
const TITLE_FONT = { bold: true, size: 14, color: { argb: 'FF1E3A5F' } }

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = HEADER_FILL
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    }
  })
  row.height = 28
}

function autoFit(sheet, columns) {
  sheet.columns.forEach((column, i) => {
    const header = String(columns[i]?.header ?? '')
    let longest = header.length
    column.eachCell({ includeEmpty: false }, (cell) => {
      const length = String(cell.value ?? '').length
      if (length > longest) longest = length
    })
    column.width = Math.min(Math.max(longest + 3, 10), 42)
  })
}

async function download(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Generic sheet writer.
 * @param {{title: string, subtitle?: string, meta?: Array<[string, any]>,
 *          columns: Array<{header: string, key: string, numFmt?: string}>,
 *          rows: Array<object>, sheetName?: string}} spec
 */
export async function exportSheet(spec, filename) {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'IEnergy Attendance Tracker'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(spec.sheetName || 'Report', {
    views: [{ state: 'frozen', ySplit: 0 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  sheet.addRow([spec.title]).font = TITLE_FONT
  if (spec.subtitle) {
    sheet.addRow([spec.subtitle]).font = { italic: true, color: { argb: 'FF666666' } }
  }
  for (const [label, value] of spec.meta ?? []) {
    sheet.addRow([label, value]).getCell(1).font = { bold: true }
  }
  sheet.addRow([])

  const headerRowIndex = sheet.rowCount + 1
  sheet.columns = spec.columns.map((c) => ({ key: c.key, width: 14 }))

  const headerRow = sheet.getRow(headerRowIndex)
  spec.columns.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.header
  })
  styleHeaderRow(headerRow)
  headerRow.commit()

  spec.rows.forEach((data) => {
    const row = sheet.getRow(sheet.rowCount + 1)
    spec.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.value = data[c.key] ?? (typeof data[c.key] === 'number' ? 0 : '')
      if (c.numFmt) cell.numFmt = c.numFmt
      if (c.arabic) cell.alignment = { horizontal: 'right', readingOrder: 'rtl' }
    })
    row.commit()
  })

  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRowIndex }]
  sheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: spec.columns.length },
  }
  autoFit(sheet, spec.columns)

  await download(workbook, filename)
}

/** Employee report: a summary block followed by the day-by-day grid. */
export async function exportEmployeeReport({ employee, from, to, summary, columns, rows }) {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'IEnergy Attendance Tracker'

  const sheet = workbook.addWorksheet('Employee Report', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  sheet.addRow([`Employee report — ${employee.name} (#${employee.code})`]).font = TITLE_FONT
  sheet.addRow([`${from} to ${to}`]).font = { italic: true, color: { argb: 'FF666666' } }
  sheet.addRow([])

  sheet.addRow(['Summary']).font = { bold: true, size: 12 }
  for (const [label, value] of summary) {
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { bold: true }
  }
  sheet.addRow([])

  const headerRowIndex = sheet.rowCount + 1
  const headerRow = sheet.getRow(headerRowIndex)
  columns.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.header
  })
  styleHeaderRow(headerRow)

  rows.forEach((data) => {
    const row = sheet.getRow(sheet.rowCount + 1)
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.value = data[c.key] ?? ''
      if (c.numFmt) cell.numFmt = c.numFmt
    })
  })

  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }]
  autoFit(sheet, columns)

  await download(
    workbook,
    `employee-report-${employee.code}-${from}_${to}.xlsx`,
  )
}
