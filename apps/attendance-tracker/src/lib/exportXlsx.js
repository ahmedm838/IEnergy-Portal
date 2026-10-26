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

import { looksLikeStaleBuild, markUpdateAvailable } from './appUpdate'

let excelPromise = null

function loadExcelJS() {
  if (!excelPromise) {
    excelPromise = import('exceljs').then(
      (m) => m.default ?? m,
      async (err) => {
        // Do not keep a rejected promise: it would be handed to every
        // later attempt, so one dropped connection used to break Export
        // for the rest of the session even after the network came back.
        excelPromise = null

        if (await looksLikeStaleBuild()) {
          markUpdateAvailable()
          throw new Error(
            'The tracker was updated since this page was opened, so part of it is no longer ' +
              'available. Reload the page and the export will work.',
          )
        }
        throw new Error(
          `The Excel component could not be downloaded (${err.message}). Check your connection and try again.`,
        )
      },
    )
  }
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


/* A real Excel table: banded rows, filter buttons, and a range that
   grows when somebody types under it.

   A table is stricter than a styled range. Excel requires every column
   name to be present and unique, and refuses to open the file at all if
   they are not -- it reports unreadable content and offers to repair,
   which loses the sheet. The columns here are built from report code
   that changes often, so rather than trusting that it will always be
   right, this checks, and falls back to the plain styled header when it
   is not. A sheet that looks a little duller is worth more than one
   that will not open.

   Zero rows falls back too: an empty table is legal but opens with a
   phantom blank row inside the border, which reads as a missing record
   rather than an empty report. */
function tableIsSafe(columns, rows) {
  if (!rows.length) return false
  const names = columns.map((c) => String(c.header ?? "").trim())
  if (names.some((n) => !n)) return false
  return new Set(names).size === names.length
}

/* Excel table names are an identifier, not a label: letters, digits and
   underscores, never starting with a digit, and unique in the workbook.
   The name is not shown to anybody, so anything legal will do. */
function tableName(sheetName, index) {
  const base = String(sheetName || "Report").replace(/[^A-Za-z0-9]/g, "") || "Report"
  return `tbl${base}${index}`
}

function writeTable(sheet, { startRow, columns, rows, name }) {
  const values = rows.map((data) => columns.map((c) => data[c.key] ?? ""))

  if (!tableIsSafe(columns, rows)) {
    const headerRow = sheet.getRow(startRow)
    columns.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header })
    styleHeaderRow(headerRow)
    headerRow.commit()
    values.forEach((line) => {
      const row = sheet.getRow(sheet.rowCount + 1)
      line.forEach((v, i) => { row.getCell(i + 1).value = v })
      row.commit()
    })
    if (rows.length) {
      sheet.autoFilter = {
        from: { row: startRow, column: 1 },
        to: { row: startRow, column: columns.length },
      }
    }
  } else {
    sheet.addTable({
      name,
      ref: `A${startRow}`,
      headerRow: true,
      style: {
        // Medium 2 is the blue banded style, which is close to the navy
        // header these sheets already used.
        theme: "TableStyleMedium2",
        showRowStripes: true,
        showFirstColumn: false,
        showLastColumn: false,
      },
      columns: columns.map((c) => ({ name: String(c.header), filterButton: true })),
      rows: values,
    })
    // No autoFilter beside it: the table carries its own filter buttons,
    // and a sheet-level filter over the same range fights with them.
    sheet.autoFilter = undefined
  }

  /* Number formats and right-to-left alignment go on afterwards either
     way. addTable writes the values but takes no formatting, so this is
     the only place the currency columns and the Arabic ones get their
     treatment. */
  for (let r = 0; r < rows.length; r++) {
    const row = sheet.getRow(startRow + 1 + r)
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      if (c.numFmt) cell.numFmt = c.numFmt
      if (c.arabic) cell.alignment = { horizontal: "right", readingOrder: "rtl" }
    })
  }
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

  writeTable(sheet, {
    startRow: headerRowIndex,
    columns: spec.columns,
    rows: spec.rows,
    name: tableName(spec.sheetName, 1),
  })

  // No frozen pane: exported sheets open plain, so they can be sorted,
  // filtered and copied without a split getting in the way.
  sheet.views = [{ state: 'normal' }]
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

  writeTable(sheet, {
    startRow: headerRowIndex,
    columns,
    rows,
    name: tableName('EmployeeReport', 1),
  })

  sheet.views = [{ state: 'normal' }]
  autoFit(sheet, columns)

  await download(
    workbook,
    `employee-report-${employee.code}-${from}_${to}.xlsx`,
  )
}
