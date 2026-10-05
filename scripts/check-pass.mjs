/**
 * Geometry probe for the ticket pass.
 *
 * The pass is drawn with two masked halves rather than one rounded card, and a
 * mask is the kind of thing that can silently do nothing: the element still
 * occupies the right box, so a screenshot looks fine and the perforation is
 * simply absent. So this asserts on computed style, not on pixels.
 *
 * Run against the dev server:  node scripts/check-pass.mjs
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 5199
const CDP = `http://127.0.0.1:${PORT}`

const fail = []
const note = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`)
  if (!ok) fail.push(label)
}

// A page that mounts the pass with fixed props, so the probe does not depend on
// stored data, a logged-in rider, or the scanner.
const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/src/styles.css">
</head><body><div id="root"></div>
<script type="module">
import { createRoot } from 'react-dom/client'
import { PassCard } from '/src/components/PassCard.tsx'
const days = [
  { key: 'a', label: 'Sat', number: '14', state: 'ride' },
  { key: 'b', label: 'Sun', number: '15', state: 'ride' },
  { key: 'c', label: 'Mon', number: '16', state: 'off' },
  { key: 'd', label: 'Tue', number: '17', state: 'ride' },
  { key: 'e', label: 'Wed', number: '18', state: 'off' },
  { key: 'f', label: 'Thu', number: '19', state: 'closed' },
  { key: 'g', label: 'Fri', number: '20', state: 'closed' }
]
createRoot(document.getElementById('root')).render(
  <div style={{ padding: 24, display: 'grid', gap: 24, justifyItems: 'center' }}>
    <PassCard number="12A" name="Mariam Hassan" avatar={null}
      weekRange="14-20 Mar" days={days} pickup="Maadi Terminal"
      status="subscribed" payment="paid" />
    <PassCard number={null} name="Unknown Rider" avatar={null}
      weekRange="14-20 Mar" days={days} pickup="—" status="none" payment="none" />
  </div>
)
</script></body></html>`

// Chrome is expected to be listening already: start it headless with
// --remote-debugging-port=5199 and a throwaway profile, then run this. The dev
// server is this script's job because it needs one to serve the module graph.
const server = spawn('npx.cmd', ['vite', '--port', String(PORT), '--strictPort'], {
  shell: true,
  stdio: 'ignore'
})

const cleanup = () => {
  try { server.kill() } catch {}
}
process.on('exit', cleanup)

try {
  await sleep(6000)
  const r = await fetch(`${CDP}/json/new?${encodeURIComponent(HARNESS)}`, { method: 'PUT' })
  const target = await r.json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })

  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((res) => {
      const n = ++id
      pending.set(n, res)
      ws.send(JSON.stringify({ id: n, method, params }))
    })

  await send('Runtime.enable')
  await sleep(3500)

  const evaluate = async (expr) => {
    const m = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    })
    return m.result?.result?.value
  }

  const probe = async (label) => {
    const css = await evaluate(`(() => {
      const passes = [...document.querySelectorAll('.pass')]
      if (!passes.length) return { error: 'no .pass rendered' }
      const top = passes[0].querySelector('.pass__top')
      const bottom = passes[0].querySelector('.pass__bottom')
      const cs = (el) => { const s = getComputedStyle(el); return {
        mask: s.maskImage || s.webkitMaskImage,
        radius: s.borderRadius, bg: s.backgroundColor, overflow: s.overflow
      } }
      const r = (el) => el.getBoundingClientRect()
      return {
        count: passes.length,
        top: cs(top), bottom: cs(bottom),
        seamDelta: +(r(bottom).top - r(top).bottom).toFixed(2),
        topRadius: getComputedStyle(top).borderTopLeftRadius,
        bottomRadius: getComputedStyle(bottom).borderBottomLeftRadius,
        paper: getComputedStyle(document.documentElement).getPropertyValue('--ticket-paper').trim(),
        ink: getComputedStyle(document.documentElement).getPropertyValue('--ticket-ink').trim(),
        accent: getComputedStyle(document.documentElement).getPropertyValue('--ticket-accent').trim(),
        days: passes[0].querySelectorAll('.pass__day').length,
        ride: passes[0].querySelectorAll('.pass__day--ride').length,
        off: passes[0].querySelectorAll('.pass__day--off').length,
        closed: passes[0].querySelectorAll('.pass__day--closed').length,
        legend: [...passes[0].querySelectorAll('.pass__legendItem')].map((n) => n.textContent.trim()),
        closedStrike: getComputedStyle(passes[0].querySelector('.pass__day--closed .pass__dayNumber')).textDecorationLine,
        offBorder: getComputedStyle(passes[0].querySelector('.pass__day--off')).borderTopStyle,
        footBleed: (() => {
          const b = passes[0].querySelector('.pass__bottom').getBoundingClientRect()
          const f = passes[0].querySelector('.pass__foot').getBoundingClientRect()
          return { left: +(f.left - b.left).toFixed(2), right: +(b.right - f.right).toFixed(2) }
        })(),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        idFont: getComputedStyle(passes[0].querySelector('.pass__id')).fontFamily,
        fontLoaded: document.fonts.check('16px "Bricolage Grotesque"')
      }
    })()`)

    if (css.error) {
      note(false, `${label}: renders`, css.error)
      return
    }
    note(true, `${label}: renders`)
    note(css.count === 2, `${label}: both paid and unpaid variants render`, `count=${css.count}`)
    note(
      /radial-gradient/.test(css.top.mask || ''),
      `${label}: top half is masked (notches present)`,
      (css.top.mask || '').slice(0, 58) + '...'
    )
    note(
      /radial-gradient/.test(css.bottom.mask || ''),
      `${label}: bottom half is masked`
    )
    note(Math.abs(css.seamDelta) < 0.6, `${label}: halves meet with no gap`, `delta=${css.seamDelta}px`)
    note(css.topRadius !== css.bottomRadius, `${label}: radii are per-corner`, `${css.topRadius} / ${css.bottomRadius}`)
    note(css.days === 7, `${label}: seven day tiles`, `days=${css.days}`)
    note(
      css.ride === 4 && css.off === 2 && css.closed === 1,
      `${label}: all three states kept and distinct`,
      `ride=${css.ride} off=${css.off} closed=${css.closed}`
    )
    note(css.offBorder === 'dashed', `${label}: off is dashed, not merely dimmed`, css.offBorder)
    note(
      /line-through/.test(css.closedStrike || ''),
      `${label}: closed number is struck through`,
      css.closedStrike
    )
    note(css.legend.length >= 2, `${label}: legend explains the states`, JSON.stringify(css.legend))
    note(
      Math.abs(css.footBleed.left) < 0.6 && Math.abs(css.footBleed.right) < 0.6,
      `${label}: payment bar is full-bleed`,
      `l=${css.footBleed.left} r=${css.footBleed.right}`
    )
    note(css.overflowX <= 0, `${label}: no horizontal overflow`, `overflow=${css.overflowX}px`)
    note(/Bricolage/.test(css.idFont || ''), `${label}: weekly number uses Bricolage`, css.idFont)
    note(css.fontLoaded === true, `${label}: font face loaded`)
    console.log(`      ${label} tokens  paper=${css.paper} ink=${css.ink} accent=${css.accent}`)
  }

  await probe('light')

  await evaluate(`document.documentElement.setAttribute('data-theme','dark')`)
  await sleep(700)
  await probe('dark')

  await evaluate(`
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.setAttribute('dir','rtl')
  `)
  await sleep(700)
  const rtl = await evaluate(`(() => {
    const av = document.querySelector('.avatar--ticket')
    const route = document.querySelector('.pass__route')
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dir: document.documentElement.dir,
      routeDir: route ? getComputedStyle(route).direction : null,
      avatarTilt: av ? getComputedStyle(av).transform : null
    }
  })()`)
  note(rtl.dir === 'rtl', 'rtl: document direction applied', rtl.dir)
  note(rtl.overflow <= 0, 'rtl: no horizontal overflow', `overflow=${rtl.overflow}px`)
  note(
    rtl.routeDir === 'rtl',
    'rtl: route row follows reading direction',
    rtl.routeDir
  )

  console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall pass geometry checks passed')
  process.exitCode = fail.length ? 1 : 0
} finally {
  cleanup()
}
