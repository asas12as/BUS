import jsQR from 'jsqr'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../context/useApp'
import { decodeQrPayload, paymentStateFor, type QrPayload } from '../lib/qr'
import { hasCamera } from '../lib/camera'
import {
  eligibleWeekKeys,
  formatDayNumber,
  formatDayShort,
  formatMonthRange,
  fromISO,
  subDays,
  weekDayMarks,
  weekDays
} from '../lib/date'
import { parseWeeklyNumber, weeklyNumberLabel } from '../lib/weeklyNumber'
import type { ScanResolution } from '../lib/mappers'
import { PassCard } from '../components/PassCard'
import { CameraIcon, CloseIcon, ScanFrameIcon, SearchIcon } from '../components/Icons'

/**
 * Reads a rider's pass instead of making a driver type numbers.
 *
 * The decoder runs in this page rather than in a service, so it works with no
 * backend at all. What it needs it asks the server for: the scanned code is only
 * an identifier, and everything the driver is shown comes from a fresh lookup of
 * the current books. A screenshot of a cancelled pass therefore fails, which is
 * the entire point of scanning rather than reading the picture.
 *
 * There is deliberately no offline path here, unlike the rest of the app. A
 * cached subscription cannot answer the only question this screen asks, and
 * "probably still valid" is not something to put in front of somebody deciding
 * whether to let a person on the bus.
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

/** How the server answered. `offline` is its own state, not a rejection. */
type Verdict =
  | { state: 'checking' }
  | { state: 'unreachable' }
  | { state: 'not-found' }
  | { state: 'valid' }
  | { state: 'pending' }
  | { state: 'cancelled' }

/**
 * Only three styles, on purpose: go, stop, or no idea yet. A pending pass and a
 * cancelled one are both "do not board yet", and giving them different colours
 * would suggest a distinction a driver cannot act on.
 */
function verdictClass(state: Verdict['state']): 'ok' | 'differs' | 'none' | 'pending' {
  if (state === 'valid') return 'ok'
  if (state === 'pending' || state === 'cancelled') return 'differs'
  return 'none'
}

export function Scan() {
  const { t, lang, online, resolveWeeklyNumber } = useApp()

  const [camera, setCamera] = useState<CameraState>(() => (hasCamera() ? 'idle' : 'unavailable'))
  const [result, setResult] = useState<QrPayload | null>(null)
  const [rejected, setRejected] = useState(false)
  const [manualId, setManualId] = useState('')
  const [week, setWeek] = useState<string>(() => eligibleWeekKeys()[0])
  /**
   * Which of the two failures a typed number produced. Both leave the screen
   * empty, so the reason has to be said out loud: a wrong number is the
   * driver's typo to fix, an unreachable server is a signal to move to.
   */
  const [manualError, setManualError] = useState<'not-found' | 'unreachable' | null>(null)
  const [resolution, setResolution] = useState<ScanResolution | null>(null)
  const [verdict, setVerdict] = useState<Verdict>({ state: 'checking' })

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

  /**
   * Asks the server what a weekly number means right now, and records the attempt.
   *
   * The verdict is stored separately from the decoded payload on purpose: the
   * payload is what the code claimed, the verdict is what the books say. Showing
   * the rider's own claimed status as if it were the answer would defeat the
   * check.
   */
  const verify = useCallback(
    async (weekStart: string, number: number) => {
      setVerdict({ state: 'checking' })
      const found = await resolveWeeklyNumber(weekStart, number)
      if (found === null) {
        setResolution(null)
        setVerdict({ state: 'unreachable' })
        return null
      }
      setResolution(found)
      // `not_found` is the one resolution with no subscription behind it, so it
      // is the same state as a code carrying no usable number.
      setVerdict({ state: found.result === 'not_found' ? 'not-found' : found.result })
      // The rider's real name and pickup come from the lookup, not the code. A
      // pass is a photograph of somebody's phone, and the photograph can be old.
      return found
    },
    [resolveWeeklyNumber]
  )

  const read = useCallback(
    (payload: QrPayload) => {
      heldRef.current = true
      setResult(payload)
      setRejected(false)
      // A short buzz is the only confirmation available without a speaker, and it
      // is the one a driver feels through the phone rather than looks for.
      navigator.vibrate?.(60)

      const number = payload.q ? parseWeeklyNumber(payload.q) : null
      if (number === null || !Number.isFinite(number)) {
        // A code with no usable number cannot be checked, so nothing is shown
        // as verified against it.
        setResolution(null)
        setVerdict({ state: 'not-found' })
        return
      }
      void verify(payload.w, number)
    },
    [verify]
  )

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
   * The way round a refused camera. The number goes through the same server
   * lookup a scan does, so both doors produce the same card and the same
   * recorded attempt.
   */
  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault()
    const number = parseWeeklyNumber(manualId)
    setManualError(null)
    if (number === null) {
      setManualError('not-found')
      return
    }

    heldRef.current = true
    setRejected(false)
    const found = await verify(week, number)
    if (found === null || !found.sub) {
      setResult(null)
      // Not found and could not reach the server are different failures, and a
      // driver can only act on one of them.
      setManualError(found === null ? 'unreachable' : 'not-found')
      return
    }

    setResult({
      n: found.user?.name ?? '',
      q: weeklyNumberLabel(found.sub.number ?? null),
      d: subDays(found.sub),
      p: found.sub.pickupName ?? found.user?.pickupLocation ?? '',
      s: found.sub.status,
      w: week
    })
    navigator.vibrate?.(40)
  }

  /** Puts the card away and lets the loop look for the next rider. */
  const clearResult = () => {
    heldRef.current = false
    lastRef.current = null
    setResult(null)
    setResolution(null)
    setRejected(false)
    setManualError(null)
    setVerdict({ state: 'checking' })
  }

  const payment = resolution?.sub ? paymentStateFor(resolution.sub.status) : null
  const weeks = eligibleWeekKeys()
  /**
   * The days rendered on the card are the server's, not the code's.
   *
   * Showing the scanned days would let a rider edit the picture and appear to
   * ride a different week. The one case the code wins is a miss, where there is
   * nothing to show and the driver's only question is which pass this was.
   */
  const serverDays = resolution?.sub ? subDays(resolution.sub) : result?.d ?? []
  const strip = result
    ? weekDayMarks(fromISO(result.w), serverDays).map((m) => ({
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

      {/* The offline warning sits above the camera because scanning is the one
          screen that cannot be faked from a cache, and a driver who does not
          notice that will read "checking…" as "fine". */}
      {!online && (
        <p className="scan__reject" role="status">
          {t('offlineReadOnly')}
        </p>
      )}

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
          {/* The photo comes from the server's record of the rider, not from the
              code: a QR carrying an image would be far too dense to scan. */}
          <PassCard
            number={result.q || null}
            name={resolution?.user?.name || t('none')}
            avatar={resolution?.user?.avatar ?? null}
            weekRange={range}
            days={strip}
            pickup={resolution?.sub?.pickupName ?? (result.p || t('none'))}
            status={resolution?.sub?.status ?? 'none'}
            payment={payment ?? 'none'}
          />

          {/* One line per outcome, because the driver is making a decision from
              it: let them travel, do not, or try again elsewhere. 'unreachable'
              is deliberately not styled as a rejection, so nobody is turned
              away because a phone had no signal. */}
          <p
            className={`scan__verdict scan__verdict--${verdictClass(verdict.state)}`}
            aria-live="polite"
          >
            <span className="scan__verdictLabel">{t('scanRecord')}</span>
            {verdict.state === 'checking' && t('scanChecking')}
            {verdict.state === 'valid' && t('scanVerdictValid')}
            {verdict.state === 'pending' && t('scanVerdictPending')}
            {verdict.state === 'cancelled' && t('scanVerdictCancelled')}
            {verdict.state === 'not-found' && t('scanVerdictNotFound')}
            {verdict.state === 'unreachable' && t('scanUnreachable')}
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
              {t(manualError === 'not-found' ? 'scanVerdictNotFound' : 'scanUnreachable')}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
