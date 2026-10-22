import { createClient } from '@supabase/supabase-js'
import { SearchError, SEARCH_RESULT_LIMIT, type SearchDependencies } from './core.ts'

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'
const SEARCH_ENDPOINT = 'https://api.spotify.com/v1/search'

export function createSearchDependencies(
  url: string,
  serviceKey: string,
  clientId: string,
  clientSecret: string,
): SearchDependencies {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let cachedToken: { value: string; expiresAt: number } | null = null

  return {
    async verifyUser(token) {
      const { data, error } = await admin.auth.getUser(token)
      return error ? null : data.user?.id ?? null
    },
    async getAccessToken() {
      // Client credentials reach the public catalogue only, and the secret never leaves the server.
      if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      })
      if (!response.ok) throw new SearchError(502, 'Spotify search is unavailable.')
      const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown }
      if (typeof payload.access_token !== 'string') throw new SearchError(502, 'Spotify search is unavailable.')
      const lifetime = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
      cachedToken = { value: payload.access_token, expiresAt: Date.now() + Math.max(0, lifetime - 60) * 1000 }
      return cachedToken.value
    },
    async searchTracks(query, accessToken, offset) {
      const endpoint = new URL(SEARCH_ENDPOINT)
      endpoint.searchParams.set('q', query)
      endpoint.searchParams.set('type', 'track')
      endpoint.searchParams.set('limit', String(SEARCH_RESULT_LIMIT))
      endpoint.searchParams.set('offset', String(offset))
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (response.status === 429) throw new SearchError(429, 'Spotify is busy. Please try again shortly.')
      if (response.status === 401) cachedToken = null
      if (!response.ok) throw new SearchError(502, 'Spotify search is unavailable.')
      return await response.json()
    },
  }
}
