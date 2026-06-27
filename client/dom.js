/**
 * Replaces container.innerHTML while preserving focus and cursor position.
 * Only acts if the focused element was *inside* the container being replaced —
 * if it was outside, it survives the replacement untouched and needs no restore.
 */
export function setHTML(container, html) {
  const active    = document.activeElement
  const id        = active?.id || null
  const wasInside = id ? container.contains(active) : false
  const selStart  = wasInside ? (active.selectionStart ?? null) : null
  const selEnd    = wasInside ? (active.selectionEnd   ?? null) : null

  container.innerHTML = html

  if (!wasInside) return

  const el = container.querySelector(`#${id}`)
  if (!el) return

  el.focus()
  if (selStart !== null) {
    try { el.setSelectionRange(selStart, selEnd) } catch (_) {}
  }
}
