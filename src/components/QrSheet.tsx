import { useCallback, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  buildQrPayload,
  encodeQrPayload,
  paymentStateFor,
  qrMatrix,
  qrMatrixPath
} from '../lib/qr'
import { ticketFileName, ticketPng, ticketSvg } from '../lib/ticket'
import {
  formatDayNumber,
  formatDayShort,
  formatMonthRange,
  fromISO,
  subDays,
  weekDayMarks,
  weekDays
} from '../lib/date'
import { weeklyNumberLabel } from '../lib/storage'
import { PAYMENT_LABEL_KEY, SUB_STATUS_LABEL } from '../lib/status'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import type { SubStatus } from '../lib/types'
import { PassCard } from './PassCard'
import { BusIcon, CloseIcon, ShareIcon } from './Icons'

/**
 * A rider's scannable pass for one week.
 *
 * Laid out as a ticket rather than a settings list, because this is the thing
 * a driver actually looks at: the weekly number is the number they call, so it
 * gets the largest type on the page, and the day strip shows the whole week at
 * once so a rider can see their off days without counting.
 *
 * The sheet follows the same week rule as subscribing: it shows the week in
 * progress when the rider holds it, and otherwise the week that is on offer. So
 * a rider without a subscription still gets a code, showing none for the weekly
 * ID, rather than an empty panel.
 */
export function QrSheet({ requestedWeek, onClose }: { requestedWeek: string; onClose: () => void }) {
  const { t, lang, currentUser, weekSubFor, weekStatusFor, targetableWeek } = useApp()
  const [note, setNote] = useState<{ key: 'ticketSaved' | 'ticketShareUnsupported' | 'ticketExportFailed' } | null>(
    null
  )

  const resolved = useMemo(() => {
    if (!currentUser) return null
    const holdsRequested = weekStatusFor(currentUser.id, requestedWeek) !== 'none'
    return holdsRequested ? requestedWeek : targetableWeek
  }, [currentUser, requestedWeek, targetableWeek, weekStatusFor])

  const view = useMemo(() => {
    if (!currentUser || !resolved) return null
    const sub = weekSubFor(currentUser.id, resolved)
    const status: SubStatus = weekStatusFor(currentUser.id, resolved)
    const days = sub ? subDays(sub) : []
    const pickup = sub?.pickupName ?? currentUser.pickupLocation ?? null
    const text = encodeQrPayload(
      buildQrPayload({
        name: currentUser.name,
        number: sub?.number ?? null,
        days,
        pickup,
        status,
        weekStart: resolved
      })
    )
    const matrix = qrMatrix(text)
    // The full week, marked up rather than filtered, so Thursday and Friday are
    // visible as days the service does not run. A rider counting chips should see
    // why five is the maximum, not just find two days missing.
    const strip = weekDayMarks(fromISO(resolved), days).map((m) => ({
      label: formatDayShort(m.date, lang),
      number: formatDayNumber(m.date, lang),
      state: m.state
    }))
    return {
      weekStart: resolved,
      status,
      days,
      pickup,
      number: sub?.number ?? null,
      matrix,
      path: matrix ? qrMatrixPath(matrix) : null,
      payment: paymentStateFor(status),
      strip,
      range: formatMonthRange(weekDays(fromISO(resolved)), lang)
    }
  }, [currentUser, resolved, weekSubFor, weekStatusFor, lang])

  /**
   * The same pass flattened into one image, so a rider can keep it after the app
   * is closed. Rebuilt whenever the panel is, because the drawn ticket and the
   * panel must never disagree about what the pass says.
   */
  const ticket = useMemo(() => {
    if (!currentUser || !view || view.matrix === null || view.path === null) return null
    const paymentKey = PAYMENT_LABEL_KEY[view.payment]
    return ticketSvg({
      brand: t('appName'),
      idLabel: t('weeklyId'),
      number: view.number !== null ? weeklyNumberLabel(view.number) : t('none'),
      hasNumber: view.number !== null,
      name: currentUser.name,
      weekPrefix: t('weekOf'),
      weekRange: view.range,
      days: view.strip,
      pickup: view.pickup ?? '',
      pickupLabel: t('pickup'),
      payment: view.payment,
      paymentLabel: t(paymentKey),
      statusLabel: t(SUB_STATUS_LABEL[view.status]),
      qrPath: view.path,
      qrCount: view.matrix.count
    })
  }, [currentUser, view, t])

  const saveTicket = useCallback(async () => {
    setNote(null)
    if (!ticket || !view) return
    const blob = await ticketPng(ticket)
    if (!blob) {
      setNote({ key: 'ticketExportFailed' })
      return
    }
    const file = new File([blob], ticketFileName(view.number !== null ? weeklyNumberLabel(view.number) : null, view.weekStart), {
      type: 'image/png'
    })
    // Sharing is the better path on a phone, where a download usually ends up in
    // a downloads folder nobody looks at. It is not available everywhere though,
    // so a save always follows it.
    try {
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: t('ticketImage') })
        setNote({ key: 'ticketSaved' })
        return
      }
    } catch (e) {
      // A cancelled share sheet is not a failure, but there is nothing to
      // distinguish it from a real error here, so it falls through to the save.
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setNote({ key: 'ticketSaved' })
  }, [ticket, view, t])

  useEscapeToClose(onClose)

  if (!currentUser || !resolved || !view) return null

  const hasNumber = view.number !== null

  const strip = view.strip.map((m, i) => ({ key: `${view.weekStart}-${i}`, ...m }))

  return (
    <div className="sheet-backdrop anim-fade" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--pass anim-pop"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('myQr')}
      >
        {/* The close control sits outside the pass. Inside, it would have to fight the
            weekly number for the same corner, and the number is the thing a
            driver calls out. */}
        <div className="sheet__bar">
          <span className="sheet__barTitle">{t('myQr')}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <CloseIcon />
          </button>
        </div>

        <PassCard
          number={hasNumber ? weeklyNumberLabel(view.number) : null}
          name={currentUser.name}
          avatar={currentUser.avatar}
          weekRange={view.range}
          days={strip}
          pickup={view.pickup ?? t('none')}
          status={view.status}
          payment={view.payment}
          qr={
            view.matrix === null || view.path === null ? (
              <p className="qr__unavailable">{t('qrUnavailable')}</p>
            ) : (
              /* Always black on white. Inverting for the dark theme would cost
                 the contrast scanners need, and the quiet zone around the symbol
                 is what lets a camera lock on. */
              <svg
                className="pass__code"
                viewBox={`0 0 ${view.matrix.count} ${view.matrix.count}`}
                shapeRendering="crispEdges"
                role="img"
                aria-label={`${t('qrCodeFor')}: ${currentUser.name}`}
              >
                <rect width={view.matrix.count} height={view.matrix.count} fill="#fff" />
                <path d={view.path} fill="#000" />
              </svg>
            )
          }
        />

        {/* The panel above is the live pass. This is the same thing as a file,
            for a rider who wants to keep it or send it on. The code inside is
            identical, so a saved ticket scans to the same details. */}
        <div className="pass__save">
          <button
            type="button"
            className="btn btn--block"
            onClick={saveTicket}
            disabled={ticket === null}
          >
            <ShareIcon />
            {t('saveTicket')}
          </button>
          {note && <span className="pass__saveNote">{t(note.key)}</span>}
        </div>

        <p className="pass__hint">
          <BusIcon />
          {t('showAtBoarding')}
        </p>
      </div>
    </div>
  )
}