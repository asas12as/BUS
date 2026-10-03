/**
 * Client-side image handling for profile pictures.
 *
 * The app has no backend, so a photo is stored as a data URL inside the same
 * localStorage blob as everything else. Two problems follow from that and are
 * handled here:
 *
 *  - Raw phone photos are 2-8MB, and localStorage caps out around 5MB total.
 *    Anything close to that would break every other write in the app.
 *  - They are also far larger than a 40px avatar ever needs.
 *
 * So the image is decoded, cropped square from the centre, scaled down, and
 * re-encoded. That keeps a typical avatar to a few kilobytes.
 */

export const AVATAR_SIZE = 160
/** WebP at ~0.8 usually lands under 12KB for a small square. */
const QUALITY = 0.82

export const MAX_AVATAR_BYTES = 400 * 1024

export type AvatarError = 'notAnImage' | 'tooLarge' | 'encodeFailed'

export type AvatarResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: AvatarError }

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode failed'))
    }
    img.src = url
  })
}

/**
 * Center-crops to a square then scales to AVATAR_SIZE. Canvas is used rather
 * than `toDataURL` on the original because we need the crop.
 */
export function resizeToSquare(img: HTMLImageElement, size: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')

  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2

  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/webp', QUALITY)
}

/** Fallback for browsers without canvas encoding, e.g. very old Safari. */
function encodeJpeg(img: HTMLImageElement, size: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')

  const side = Math.min(img.naturalWidth, img.naturalHeight)
  ctx.drawImage(
    img,
    (img.naturalWidth - side) / 2,
    (img.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size
  )
  return canvas.toDataURL('image/jpeg', 0.82)
}

export async function processAvatarFile(file: File | Blob): Promise<AvatarResult> {
  if (!file.type.startsWith('image/')) return { ok: false, error: 'notAnImage' }

  let img: HTMLImageElement
  try {
    img = await loadImage(file)
  } catch {
    return { ok: false, error: 'notAnImage' }
  }

  let dataUrl: string
  try {
    dataUrl = resizeToSquare(img, AVATAR_SIZE)
    // Some browsers ignore an unsupported type and hand back a PNG anyway, which
    // is far larger. If we got something unexpectedly heavy, fall back to JPEG.
    if (!dataUrl.startsWith('data:image/webp')) {
      const jpeg = encodeJpeg(img, AVATAR_SIZE)
      if (jpeg.length < dataUrl.length) dataUrl = jpeg
    }
  } catch {
    return { ok: false, error: 'encodeFailed' }
  }

  // Approximate decoded bytes: the base64 payload is ~4/3 of the raw image.
  const approxBytes = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
  if (approxBytes > MAX_AVATAR_BYTES) return { ok: false, error: 'tooLarge' }

  return { ok: true, dataUrl }
}

/**
 * Picks a readable single character for the avatar fallback.
 * Uses the first letter of the first word, so Arabic and Latin names both work.
 */
export function initialsOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const first = [...trimmed][0]
  return first.toUpperCase()
}