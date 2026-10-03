import jsQR from 'jsqr'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { decodeQrPayload, paymentStateFor, type QrPayload } from '../lib/qr'
import { hasCamera } from '../lib/camera'
import {
  eligibleWeekKeys,
  formatDayNumber,
  formatDayShort,
  formatMonthRange,
  fromISO,
  normalizeDays,
  subDays,
  weekDayMarks,
  weekDays
} from '../lib/date'
import { ownerOfWeeklyNumber, weeklyNumberLabel } from '../lib/storage'
import { parseWeeklyNumber } from '../lib/weeklyNumber'
import type { SubStatus } from '../lib/types'
import { PassCard } from '../components/PassCard'
import { CameraIcon, CloseIcon, ScanFrameIcon, SearchIcon } from '../components/Icons'

/**
 * Reads a rider's pass instead of making a driver type numbers.
 *
 * The decoder runs in this page rather than in a service, so it works with no
 * backend at all, which is the whole premise of the app. Everything it needs
 * comes out of one video frame: the code is decoded, parsed by the same reader
 * the rider's own panel writes with, and then checked against the subscriptions
 * this device already holds.
 *
 * Admin only. The pass carries a rider's name, pickup and weekly number, so
 * scanning one is a driver's job and there is no reason to hand that to every
 * signed-in account.
 */

/**
 * Frames are decoded at this longest edge. The decoder cost is linear in pixel
 * count and a 1080p frame every animation frame will not keep up on a budget
 * phone, so the frame is scaled down. There is plenty to spare: the smallest
 * version of this payload is 69 modules and even at this size each module is
 * several pixels wide, which is what the locator needs.
 */
const MAX_EDGE = 640

/**
 * One pass stays "just read" for this long. Without it the decoder keeps
 * finding the same code in every frame of a held-up phone and the result
 * flickers between read and unread.
 */
const COOLDOWN_MS = 1200

type CameraState = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable'

/** What the code claimed, next to what this device has on file. */
interface Verdict {
  match: 'ok' | 'differs' | 'none'
  status: SubStatus | null
  name: string | null
}

export function Scan() {
  const { t, lang, data, adminUsers } = useApp()

  const [camera, setCamera] = useState<CameraState>(() => (hasCamera() ? 'idle' : 'unavailable'))
  const [result, setResult] = useState<QrPayload | null>(null)
  const [rejected, setRejected] = useState(false)
  const [manualId, setManualId] = useState('')
  const [week, setWeek] = useState<string>(() => eligibleWeekKeys()[0])
  const [manualError, setManualError] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastRef = useRef<{ text: string; at: number } | null>(null)
  /**
   * Set once a pass is on screen so the loop stops looking for new ones until
   * the driver says they are ready. Without it the same code in a stationary
   * frame is decoded again the moment the cooldown lapses, and the result card
   * re-renders on top of itself. A ref, not state, because the loop must see it
   * without being torn down and rebuilt on every result.
   */
  const heldRef = useRef(false)

  /** Releases the camera without touching what is on screen. */
  const release = useCallback(() => {
    // Stopping the tracks is what actually turns the camera light off; leaving
    // the stream attached keeps the device capturing with nothing showing it.
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  /** Releases the camera and returns the page to its idle state. */
  const stop = useCallback(() => {
    release()
    heldRef.current = false
    setCamera('idle')
    setResult(null)
  }, [release])

  const read = useCallback((payload: QrPayload) => {
    heldRef.current = true
    setResult(payload)
    setRejected(false)
    // A short buzz is the only confirmation available without a speaker, and it
    // is the one a driver feels through the phone rather than looks for.
    navigator.vibrate?.(60)
  }, [])

  /** Any QR that is not one of ours is refused rather than half-read. */
  const onText = useCallback(
    (text: string) => {
      const now = Date.now()
      if (lastRef.current?.text === text && now - lastRef.current.at < COOLDOWN_MS) return
      lastRef.current = { text, at: now }
      const payload = decodeQrPayload(text)
      if (payload === null) {
        setResult(null)
        setRejected(true)
        return
      }
      read(payload)
    },
    [read]
  )

  /**
   * The decode loop, owned by the live state so it starts and stops with the
   * stream. A named function rather than a self-referencing callback, because
   * referring to a binding while it is still being initialised is the kind of
   * thing that breaks the moment the call shape changes.
   */
  useEffect(() => {
    if (camera !== 'live') return
    let frame = 0
    const tick = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video && canvas && !heldRef.current && video.readyState >= 2) {
        const vw = video.videoWidth
        const vh = video.videoHeight
        if (vw > 0 && vh > 0) {
          const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh))
          const w = Math.max(1, Math.round(vw * scale))
          const h = Math.max(1, Math.round(vh * scale))
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h)
            const shot = ctx.getImageData(0, 0, w, h)
            const found = jsQR(shot.data, w, h, { inversionAttempts: 'attemptBoth' })
            if (found?.data) onText(found.data)
          }
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [camera, onText])

  const start = useCallback(async () => {
    heldRef.current = false
    setResult(null)
    setRejected(false)
    setCamera('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      })
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        // Muted and inline, without which iOS refuses to play its own camera
        // stream back.
        video.muted = true
        video.playsInline = true
        await video.play().catch(() => undefined)
      }
      setCamera('live')
    } catch {
      release()
      setCamera('denied')
    }
  }, [release])

  // Releasing the camera on unmount matters: without it, navigating away would
  // leave the light on with no page showing it.
  useEffect(() => release, [release])

  /**
   * Cross-checks the pass against this device. A code can be perfectly valid and
   * still disagree with the books: printed once, then cancelled or re-issued.
   * Showing that difference is the point of scanning rather than reading a
   * number off a screen.
   */
  /**
   * Whoever holds the scanned number on this device, if anybody does.
   *
   * Pulled out of the verdict so the card and the comparison cannot disagree
   * about who was found: one lookup, one answer. Null covers both "no such
   * number here" and "the pass carries no usable number", which is why the card
   * falls back to the name printed on the code itself.
   */
  const foundOwner = useMemo(() => {
    if (!result) return null
    const number = result.q ? parseWeeklyNumber(result.q) : null
    if (number === null || !Number.isFinite(number)) return null
    return ownerOfWeeklyNumber(data, adminUsers, result.w, number)
  }, [result, adminUsers, data])

  const verdict: Verdict | null = useMemo(() => {
    if (!result) return null
    if (!foundOwner) return { match: 'none', status: null, name: null }
    const storedDays = subDays(foundOwner.sub)
    const same =
      foundOwner.sub.status === result.s &&
      normalizeDays(result.d).join(',') === storedDays.join(',') &&
      (foundOwner.sub.pickupName ?? '') === result.p
    return {
      match: same ? 'ok' : 'differs',
      status: foundOwner.sub.status,
      name: foundOwner.user.name
    }
  }, [result, foundOwner])

  /**
   * The way round a refused camera. The number is looked up in the chosen week
   * and turned into the same payload a scan produces, so both doors lead to the
   * same card and the same comparison against the books.
   */
  const submitManual = (e: React.FormEvent) => {
    e.preventDefault()
    const number = parseWeeklyNumber(manualId)
    setManualError(false)
    if (number === null) {
      setManualError(true)
      return
    }
    const found = ownerOfWeeklyNumber(data, adminUsers, week, number)
    if (!found) {
      setManualError(true)
      setResult(null)
      return
    }
    const owner = found.user
    const sub = found.sub
    heldRef.current = true
    setRejected(false)
    setResult({
      n: owner.name,
      q: weeklyNumberLabel(sub.number ?? null),
      d: subDays(sub),
      p: sub.pickupName ?? owner.pickupLocation ?? '',
      s: sub.status,
      w: week
    })
    navigator.vibrate?.(40)
  }

  /** Puts the card away and lets the loop look for the next rider. */
  const clearResult = () => {
    heldRef.current = false
    lastRef.current = null
    setResult(null)
    setRejected(false)
    setManualError(false)
  }

  const payment = result ? paymentStateFor(result.s) : null
  const weeks = eligibleWeekKeys()
  const strip = result
    ? weekDayMarks(fromISO(result.w), result.d).map((m) => ({
        key: `${result.w}-${m.day}`,
        label: formatDayShort(m.date, lang),
        number: formatDayNumber(m.date, lang),
        state: m.state
      }))
    : []
  const range = result ? formatMonthRange(weekDays(fromISO(result.w)), lang) : ''

  return (
    <div className="page">
      <section className="page__head">
        <h1 className="page__title">{t('scanTitle')}</h1>
        <p className="page__sub">{t('scanSub')}</p>
      </section>

      {/* The viewport stays mounted for the life of the page, so assigning a
          stream to the video element never races the element appearing. It is
          the stream itself that gets released, on stop and on unmount. */}
      <div className={`scan__view ${camera === 'live' ? 'is-live' : ''}`}>
        <video ref={videoRef} className="scan__video" muted playsInline />
        <canvas ref={canvasRef} className="scan__canvas" aria-hidden="true" />
        {camera === 'live' && <span className="scan__reticle" aria-hidden="true" />}
        {camera === 'idle' && (
          <div className="scan__overlay">
            <CameraIcon />
            <p className="scan__overlayText">{t('scanSub')}</p>
          </div>
        )}
        {camera === 'starting' && <div className="scan__overlay"><p className="scan__overlayText">{t('scanStart')}</p></div>}
        {(camera === 'unavailable' || camera === 'denied') && (
          <div className="scan__overlay scan__overlay--warn">
            <p className="scan__overlayTitle">{t(camera === 'denied' ? 'scanDenied' : 'scanSecureTitle')}</p>
            <p className="scan__overlayText">{t(camera === 'denied' ? 'scanDeniedBody' : 'scanSecureBody')}</p>
          </div>
        )}
      </div>

      <div className="scan__actions">
        {camera === 'live' ? (
          <button type="button" className="btn btn--block" onClick={() => { stop(); setCamera('idle') }}>
            <CloseIcon />
            {t('scanStop')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={start}
            disabled={camera === 'unavailable'}
          >
            <CameraIcon />
            {t('scanStart')}
          </button>
        )}
      </div>

      {rejected && (
        <p className="scan__reject" role="alert">
          {t('scanNotAPass')}
        </p>
      )}

      {result && (
        <>
          {/* The photo comes from this device's own records, not from the code:
              a QR carrying an image would be far too dense to scan. */}
          <PassCard
            number={result.q || null}
            name={result.n || t('none')}
            avatar={foundOwner?.user.avatar ?? null}
            weekRange={range}
            days={strip}
            pickup={result.p || t('none')}
            status={result.s}
            payment={payment ?? 'none'}
          />

          <p
            className={`scan__verdict scan__verdict--${
              verdict?.match === 'ok' ? 'ok' : verdict?.match === 'differs' ? 'differs' : 'none'
            }`}
          >
            <span className="scan__verdictLabel">{t('scanRecord')}</span>
            {verdict?.match === 'ok' && t('scanRecordOk')}
            {verdict?.match === 'differs' && t('scanRecordDiffers')}
            {verdict?.match === 'none' && t('scanRecordNone')}
          </p>

          <button
            type="button"
            className="btn btn--shrink btn--ticket"
            onClick={clearResult}
          >
            <ScanFrameIcon />
            {t('scanStartAgain')}
          </button>
        </>
      )}

      {/* Hidden while a pass is on screen, so the result is the only thing the
          driver looks at. Still reachable at any other time, which is what
          matters for the phone that refuses the camera: that device never gets
          a result, so the box is never hidden from it. "Scan another" clears
          the result and brings the form straight back. */}
      {!result && (
        <form className="scan__manual" onSubmit={submitManual}>
          <h2 className="scan__manualTitle">{t('scanManual')}</h2>
          <p className="scan__manualHint">{t('scanManualHint')}</p>
          <div className="scan__manualRow">
            <select
              className="field__input"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              aria-label={t('schedule')}
            >
              {weeks.map((w) => (
                <option key={w} value={w}>
                  {formatMonthRange(weekDays(fromISO(w)), lang)}
                </option>
              ))}
            </select>
            <input
              className="field__input"
              // Not numeric: that opens a digits-only keypad on a phone, and
              // numbers past 1000 carry a letter. This box is the fallback when
              // the camera will not focus, so it has to stay typeable.
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder={t('weeklyId')}
              aria-label={t('weeklyId')}
            />
            <button type="submit" className="btn btn--primary">
              <SearchIcon />
              {t('scanManual')}
            </button>
          </div>
          {manualError && (
            <p className="scan__reject" role="alert">
              {t('scanNoSuchId')}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
