export type SpotifyTrackSummary = {
  spotify_track_id: string
  title: string
  artist: string
  album_art_url: string | null
  spotify_url: string | null
}

export type SearchDependencies = {
  verifyUser: (token: string) => Promise<string | null>
  getAccessToken: () => Promise<string>
  searchTracks: (query: string, accessToken: string) => Promise<unknown>
}

export class SearchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'SearchError'
  }
}

export const MAX_QUERY_LENGTH = 100
export const SEARCH_RESULT_LIMIT = 10

type JsonObject = Record<string, unknown>

const asObject = (value: unknown): JsonObject | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null

const asText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// Spotify payloads are untrusted input: keep only the fields the pool stores.
export function normalizeTracks(payload: unknown, limit = SEARCH_RESULT_LIMIT): SpotifyTrackSummary[] {
  const items = asObject(asObject(payload)?.tracks)?.items
  if (!Array.isArray(items)) return []

  const seen = new Set<string>()
  const tracks: SpotifyTrackSummary[] = []

  for (const item of items) {
    if (tracks.length >= limit) break
    const track = asObject(item)
    if (!track) continue

    const id = asText(track.id)
    const title = asText(track.name)
    const artists = Array.isArray(track.artists)
      ? track.artists.map((artist) => asText(asObject(artist)?.name)).filter((name): name is string => name !== null)
      : []
    if (!id || !title || artists.length === 0 || seen.has(id)) continue
    seen.add(id)

    const images = asObject(track.album)?.images
    tracks.push({
      spotify_track_id: id,
      title,
      artist: artists.join(', '),
      album_art_url: Array.isArray(images) ? asText(asObject(images[0])?.url) : null,
      spotify_url: asText(asObject(track.external_urls)?.spotify),
    })
  }

  return tracks
}

export async function searchSpookifySongs(
  bearer: string,
  rawQuery: string,
  deps: SearchDependencies,
): Promise<{ status: number; body: unknown }> {
  const userId = await deps.verifyUser(bearer)
  if (!userId) return { status: 401, body: { error: 'Authentication required.' } }

  const query = rawQuery.trim()
  if (query === '') return { status: 400, body: { error: 'A search query is required.' } }
  if (query.length > MAX_QUERY_LENGTH) return { status: 400, body: { error: 'The search query is too long.' } }

  try {
    const payload = await deps.searchTracks(query, await deps.getAccessToken())
    return { status: 200, body: { tracks: normalizeTracks(payload) } }
  } catch (error) {
    if (error instanceof SearchError) return { status: error.status, body: { error: error.message } }
    return { status: 502, body: { error: 'Spotify search is unavailable.' } }
  }
}
