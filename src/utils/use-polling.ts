import { useCallback, useEffect, useRef } from 'react'

type Loader = (isCancelled: () => boolean) => Promise<void>

/**
 * Runs `load` on mount, then every `intervalMs` while the tab is visible, and
 * again whenever the tab becomes visible. Returns a stable `reload` for use
 * after mutations. `load` receives `isCancelled` to drop results that arrive
 * after unmount or after polling was disabled.
 */
export const usePolling = (load: Loader, intervalMs: number, enabled = true) => {
  const loadRef = useRef(load)
  const generationRef = useRef(0)

  useEffect(() => {
    loadRef.current = load
  })

  const reload = useCallback(() => {
    const generation = generationRef.current
    return loadRef.current(() => generationRef.current !== generation)
  }, [])

  useEffect(() => {
    if (!enabled) return

    void reload()
    const timer = window.setInterval(() => {
      if (!document.hidden) void reload()
    }, intervalMs)
    const onVisibility = () => {
      if (!document.hidden) void reload()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      generationRef.current += 1
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, intervalMs, reload])

  return reload
}
