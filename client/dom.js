export function showConfirm(message, confirmLabel = 'Confirmar') {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal">
        <p class="modal-message">${message}</p>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel">Cancelar</button>
          <button class="modal-btn modal-btn-confirm">${confirmLabel}</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    overlay.querySelector('.modal-btn-cancel').addEventListener('click',  () => { overlay.remove(); resolve(false) })
    overlay.querySelector('.modal-btn-confirm').addEventListener('click', () => { overlay.remove(); resolve(true)  })
  })
}

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
