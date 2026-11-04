/**
 * Reading a spreadsheet somebody picked off their disk.
 *
 * ExcelJS, which this app already carries, writes .xlsx and reads only
 * .xlsx. The fingerprint machine exports .xls -- the old BIFF format,
 * and in this case a bare BIFF stream rather than even an OLE
 * container. ExcelJS cannot open it at all. SheetJS can, along with
 * .xlsx and .csv, so it is loaded for reading and ExcelJS kept for
 * writing; neither does the other's job.
 *
 * It is another large chunk and most sessions never import anything, so
 * it is fetched on first use.
 */

import { looksLikeStaleBuild, markUpdateAvailable } from './appUpdate'

let sheetPromise = null

function loadSheetJS() {
  if (!sheetPromise) {
    sheetPromise = import('xlsx').then(
      (m) => m.default ?? m,
      async (err) => {
        // Not kept when it fails: a rejected promise handed to every
        // later attempt would break Upload for the rest of the session
        // over one dropped connection.
        sheetPromise = null

        if (await looksLikeStaleBuild()) {
          markUpdateAvailable()
          throw new Error(
            'The tracker was updated since this page was opened, so part of it is no longer ' +
              'available. Reload the page and the upload will work.',
          )
        }
        throw new Error(
          `The spreadsheet reader could not be downloaded (${err.message}). ` +
            'Check your connection and try again.',
        )
      },
    )
  }
  return sheetPromise
}

/** Start fetching the reader, so the first Upload does not wait for it. */
export function prefetchWorkbookReader() {
  if (sheetPromise) return
  const warm = () => {
    loadSheetJS().catch(() => {
      // The real upload will surface a failure; a failed prefetch must
      // not put an error in front of someone who never clicked Upload.
      sheetPromise = null
    })
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 2000 })
  else setTimeout(warm, 300)
}

/**
 * The first sheet of a file, as rows of raw cell values.
 *
 * Arrays, not objects keyed by heading. A sheet is a file somebody was
 * handed, and a heading cell reading "__proto__" or "constructor"
 * becomes a dangerous key the moment rows are built as objects. Arrays
 * have no such edge, and the caller finds its columns by reading the
 * header row itself.
 *
 * raw: true keeps dates and times as the numbers or strings the file
 * holds, rather than letting the reader apply a locale's idea of what
 * 01-07-2026 means. Working that out is the caller's job, where the
 * decision is written down.
 */
export async function readSheetRows(file) {
  const XLSX = await loadSheetJS()
  const buffer = await file.arrayBuffer()

  let workbook
  try {
    workbook = XLSX.read(buffer, { type: 'array', raw: true, cellDates: false })
  } catch (err) {
    throw new Error(
      `This file could not be read as a spreadsheet (${err.message}). ` +
        'Export it again from the attendance machine, or save it as .xlsx and try that.',
    )
  }

  const name = workbook.SheetNames?.[0]
  if (!name) throw new Error('This workbook has no sheets in it.')

  return XLSX.utils.sheet_to_json(workbook.Sheets[name], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  })
}
