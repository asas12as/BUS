import { useCallback, useState } from 'react'
import type { AppData } from './types'
import { readData, storageAvailable, writeData } from './storage'

/**
 * The single place app state is written.
 *
 * Every mutation in the app is the same three steps: take the pure function in
 * storage, hand back the new state, then save it. Only the pure function
 * changes, so that pairing lives once here.
 *
 * The storage failure is handled in one place too, because it is the same
 * failure everywhere: the browser refusing localStorage. That flips a flag the
 * UI reads to say the save did not stick, rather than letting a silent failure
 * look like a working save.
 */
export function useAppData() {
  const [data, setData] = useState<AppData>(() => readData())
  const [storageOk, setStorageOk] = useState<boolean>(() => storageAvailable())

  const persist = useCallback((next: AppData) => {
    setData(next)
    try {
      writeData(next)
      setStorageOk(true)
    } catch {
      setStorageOk(false)
    }
  }, [])

  /**
   * Builds a stable action for an unconditional change.
   *
   * For the admin and settings edits there is nothing to validate: the pure
   * function already refuses anything it cannot do, and the screen has already
   * confirmed with the rider. Actions that do validate keep their own
   * `useCallback` so the rules and the error they return stay readable side by
   * side.
   */
  const simpleAction = useCallback(
    <A extends unknown[]>(apply: (data: AppData, ...args: A) => AppData) =>
      (...args: A): void => {
        persist(apply(data, ...args))
      },
    [data, persist]
  )

  return { data, persist, simpleAction, storageOk }
}
