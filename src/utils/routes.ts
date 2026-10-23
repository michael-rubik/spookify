export type View = 'clicker' | 'profile' | 'users' | 'spooks' | 'karaoke' | 'poll' | 'battlepass' | 'spookify' | 'admin'
export type SpookifyPanel = 'source' | 'tinder' | 'fmk'

export type Route = { view: View; panel: SpookifyPanel }

const VIEWS: readonly View[] = [
  'clicker', 'profile', 'users', 'spooks', 'karaoke', 'poll', 'battlepass', 'spookify', 'admin',
]

// The "source" panel lives at /spookify/add.
const PANEL_SEGMENTS: Record<SpookifyPanel, string> = { source: 'add', tinder: 'tinder', fmk: 'fmk' }

export const DEFAULT_ROUTE: Route = { view: 'clicker', panel: 'source' }

export function parseRoute(pathname: string): Route {
  const [first = '', second = ''] = pathname.toLowerCase().split('/').filter(Boolean)
  const view = VIEWS.find((candidate) => candidate === first)
  if (!view) return DEFAULT_ROUTE
  if (view !== 'spookify') return { view, panel: 'source' }

  const panel = (Object.keys(PANEL_SEGMENTS) as SpookifyPanel[]).find((key) => PANEL_SEGMENTS[key] === second)
  return { view, panel: panel ?? 'source' }
}

export function pathFor(view: View, panel: SpookifyPanel = 'source'): string {
  return view === 'spookify' ? `/spookify/${PANEL_SEGMENTS[panel]}` : `/${view}`
}

// The one URL a route is shown under, so /, /spookify and unknown paths can be redirected to it.
export function canonicalPath(pathname: string): string {
  const route = parseRoute(pathname)
  return pathFor(route.view, route.panel)
}
