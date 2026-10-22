import { describe, expect, it } from 'vitest'
import { canonicalPath, parseRoute, pathFor } from './routes'

describe('routes', () => {
  it('maps each view to its own path and back', () => {
    for (const view of ['clicker', 'profile', 'users', 'spooks', 'karaoke', 'poll', 'admin'] as const) {
      expect(pathFor(view)).toBe(`/${view}`)
      expect(parseRoute(`/${view}`)).toEqual({ view, panel: 'source' })
    }
  })

  it('puts the Spookify games under /spookify', () => {
    expect(pathFor('spookify', 'source')).toBe('/spookify/add')
    expect(pathFor('spookify', 'tinder')).toBe('/spookify/tinder')
    expect(pathFor('spookify', 'fmk')).toBe('/spookify/fmk')
    expect(parseRoute('/spookify/tinder')).toEqual({ view: 'spookify', panel: 'tinder' })
    expect(parseRoute('/spookify/fmk')).toEqual({ view: 'spookify', panel: 'fmk' })
    expect(parseRoute('/spookify/add')).toEqual({ view: 'spookify', panel: 'source' })
  })

  it('redirects the root, a bare /spookify and unknown paths to a canonical path', () => {
    expect(canonicalPath('/')).toBe('/clicker')
    expect(canonicalPath('/nope')).toBe('/clicker')
    expect(canonicalPath('/spookify')).toBe('/spookify/add')
    expect(canonicalPath('/spookify/unknown')).toBe('/spookify/add')
    expect(canonicalPath('/Admin/')).toBe('/admin')
    expect(canonicalPath('/spookify/fmk')).toBe('/spookify/fmk')
  })
})
