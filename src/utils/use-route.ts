import { useEffect, useSyncExternalStore } from 'react'
import { canonicalPath, parseRoute, type Route } from './routes'

const NAVIGATE_EVENT = 'app:navigate'

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

const getPathname = () => window.location.pathname

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (path === window.location.pathname) return
  if (options.replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

// Reads the current route from the URL and rewrites non-canonical URLs in place.
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, getPathname)

  useEffect(() => {
    const canonical = canonicalPath(pathname)
    if (canonical !== pathname) navigate(canonical, { replace: true })
  }, [pathname])

  return parseRoute(pathname)
}
