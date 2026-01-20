// Simple touch controls: single-finger drag -> look, two-finger drag -> move axes
export function startTouchControls(container, { onLook = () => {}, onMove = () => {} } = {}) {
  if (!container || typeof container.addEventListener !== 'function') return () => {}

  const pointers = new Map()
  let lastSingle = null
  let lastMultiMid = null

  const lookSensitivity = 0.0025 // radians per pixel
  // reduce sensitivity for two-finger drag: smaller value -> less movement per pixel
  const moveScale = 1 / 120 // pixels -> axis magnitude
  const moveDeadzone = 0.03 // ignore tiny drags

  function getMid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }

  function onPointerDown(e) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
    container.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 1) {
      lastSingle = { x: e.clientX, y: e.clientY }
    } else if (pointers.size === 2) {
      const it = pointers.values()
      const a = it.next().value
      const b = it.next().value
      lastMultiMid = getMid(a, b)
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return
    const prev = pointers.get(e.pointerId)
    const cur = { x: e.clientX, y: e.clientY }
    pointers.set(e.pointerId, cur)
    if (pointers.size === 1) {
      // look
      const dx = cur.x - (lastSingle ? lastSingle.x : cur.x)
      const dy = cur.y - (lastSingle ? lastSingle.y : cur.y)
      lastSingle = cur
      // convert to radians
      const rx = dx * lookSensitivity
      const ry = dy * lookSensitivity
      onLook(rx, ry)
      e.preventDefault()
    } else if (pointers.size >= 2) {
      // movement: use midpoint delta
      const vals = Array.from(pointers.values())
      const mid = getMid(vals[0], vals[1])
      if (lastMultiMid) {
        const mdx = mid.x - lastMultiMid.x
        const mdy = mid.y - lastMultiMid.y
        // map vertical drag to forward/back (negative mdy -> forward)
        let forwardVal = clamp(-mdy * moveScale, -1, 1)
        let strafeVal = clamp(mdx * moveScale, -1, 1)
        if (Math.abs(forwardVal) < moveDeadzone) forwardVal = 0
        if (Math.abs(strafeVal) < moveDeadzone) strafeVal = 0
        onMove({ x: strafeVal, z: forwardVal })
      }
      lastMultiMid = mid
      e.preventDefault()
    }
  }

  function onPointerUp(e) {
    if (pointers.has(e.pointerId)) pointers.delete(e.pointerId)
    try { container.releasePointerCapture(e.pointerId) } catch (err) {}
    if (pointers.size === 1) {
      const remaining = pointers.values().next().value
      lastSingle = { x: remaining.x, y: remaining.y }
    } else if (pointers.size === 0) {
      lastSingle = null
      lastMultiMid = null
      // ensure movement stops
      onMove({ x: 0, z: 0 })
    }
  }

  container.addEventListener('pointerdown', onPointerDown, { passive: false })
  container.addEventListener('pointermove', onPointerMove, { passive: false })
  window.addEventListener('pointerup', onPointerUp, { passive: false })
  window.addEventListener('pointercancel', onPointerUp, { passive: false })

  // prevent gestures like double-tap zoom on the container
  const prevTouchAction = container.style.touchAction
  container.style.touchAction = 'none'

  return function stop() {
    container.removeEventListener('pointerdown', onPointerDown)
    container.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    container.style.touchAction = prevTouchAction || ''
  }
}
