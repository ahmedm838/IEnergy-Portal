import { Button } from './ui'

/**
 * The Save / Discard footer every editable Settings card carries.
 *
 * Always rendered once a card can be edited, rather than appearing when
 * the first change is made: a control that materialises under the
 * pointer is how people click the wrong thing, and a greyed Save tells
 * somebody the card works this way before they touch it.
 */
export default function SaveBar({ count, busy, onSave, onDiscard, hint }) {
  const dirty = count > 0
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
      <Button size="sm" onClick={onSave} disabled={!dirty || busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDiscard} disabled={!dirty || busy}>
        Discard
      </Button>
      <span className="text-xs text-ink-4" aria-live="polite">
        {dirty
          ? `${count} unsaved change${count === 1 ? '' : 's'}`
          : (hint ?? 'No unsaved changes.')}
      </span>
    </div>
  )
}
