import { useEffect } from 'react'

/**
 * Closes a sheet on Escape.
 *
 * Every sheet in the app dismisses the same way, and the listener has to be
 * torn down again on unmount or a closed sheet keeps swallowing the key for the
 * rest of the session. Doing that in one place means a new sheet cannot forget
 * the cleanup.
 */
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
}
