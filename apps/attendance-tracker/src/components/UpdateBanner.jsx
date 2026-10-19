import { useEffect, useState } from 'react'
import { isUpdatePending, onUpdateAvailable } from '../lib/appUpdate'
import { Alert, Button } from './ui'

/**
 * Shown once the running tab is known to be out of date.
 *
 * It asks rather than reloading on its own. The Attendance grid warns
 * before a navigation precisely because it can be holding unsaved
 * entries, and discarding those to fix an export would be a worse
 * outcome than the export failing.
 */
export default function UpdateBanner() {
  const [pending, setPending] = useState(isUpdatePending)

  useEffect(() => onUpdateAvailable(setPending), [])

  if (!pending) return null

  return (
    <div className="no-print mb-4">
      <Alert tone="warning" title="A newer version of the tracker is available">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            This page was opened before the latest update, so parts of it — the Excel export
            among them — can no longer load. Reloading picks up the new version.
          </span>
          <Button size="sm" onClick={() => window.location.reload()}>
            Reload now
          </Button>
        </div>
      </Alert>
    </div>
  )
}
