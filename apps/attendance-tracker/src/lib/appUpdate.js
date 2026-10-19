/**
 * Noticing that the deployed app has moved on under an open tab.
 *
 * The build splits ExcelJS into its own chunk and every deploy gives that
 * chunk a new hashed filename, replacing the old one. A tab opened before
 * a deploy is still running the previous bundle, which asks for a file
 * that no longer exists -- so the first thing the person sees is "Failed
 * to fetch dynamically imported module" when they click Export.
 *
 * Reloading fixes it, but the page must not reload itself: the Attendance
 * grid can be holding a week of unsaved entries, and throwing those away
 * to fix an export is a far worse outcome than the export failing. So
 * this only raises a flag, and the banner asks.
 */

let updated = false
const listeners = new Set()

/** True once a chunk has failed to load because the build changed. */
export function isUpdatePending() {
  return updated
}

export function markUpdateAvailable() {
  if (updated) return
  updated = true
  for (const listener of listeners) listener(true)
}

export function onUpdateAvailable(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Did that import fail because the build moved, or because the network is
 * down?
 *
 * A chunk that 404s while the site itself is reachable means the file was
 * replaced by a deploy. If the probe fails too, the connection is the
 * problem and telling someone to reload would be wrong -- a reload on a
 * dead connection loses the page entirely.
 */
export async function looksLikeStaleBuild() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}index.html`, {
      method: 'HEAD',
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}
