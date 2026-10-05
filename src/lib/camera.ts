/**
 * Whether this document may ask for the camera at all.
 *
 * The browser refuses getUserMedia outside a secure context, and a page opened
 * straight from disk is not one. Checking up front turns a silent failure into
 * an explanation, so the caller can offer another way in instead of showing a
 * camera that never starts.
 *
 * Lives outside the page component so it can be exercised on its own, and so the
 * page file only exports the component.
 */
export function hasCamera(): boolean {
  return (
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}