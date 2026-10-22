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
  searchTracks: (query: string, accessToken: string, offset: number) => Promise<unknown>
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

export type SearchField = 'title' | 'artist'

export type SearchOptions = {
  fields?: readonly string[]
  offset?: number
}

// Spotify caps the search offset at 1000.
export const MAX_SEARCH_OFFSET = 1000

function normalizeOffset(offset: unknown): number | null {
  if (offset === undefined) return 0
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset >= MAX_SEARCH_OFFSET) return null
  return offset
}

// Both fields (or none) is a plain search; a single field narrows it to that Spotify field filter.
export function buildSpotifyQuery(query: string, fields: readonly string[] | undefined): string {
  const selected = new Set((fields ?? []).filter((field): field is SearchField => field === 'title' || field === 'artist'))
  if (selected.size !== 1) return query
  const quoted = `"${query.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`
  return selected.has('artist') ? `artist:${quoted}` : `track:${quoted}`
}

function hasMoreResults(payload: unknown, offset: number): boolean {
  const tracks = asObject(asObject(payload)?.tracks)
  const items = tracks?.items
  const itemCount = Array.isArray(items) ? items.length : 0
  return tracks?.next != null && itemCount > 0 && offset + itemCount < MAX_SEARCH_OFFSET
}

export async function searchSpookifySongs(
  bearer: string,
  rawQuery: string,
  deps: SearchDependencies,
  options: SearchOptions = {},
): Promise<{ status: number; body: unknown }> {
  const userId = await deps.verifyUser(bearer)
  if (!userId) return { status: 401, body: { error: 'Authentication required.' } }

  const query = rawQuery.trim()
  if (query === '') return { status: 400, body: { error: 'A search query is required.' } }
  if (query.length > MAX_QUERY_LENGTH) return { status: 400, body: { error: 'The search query is too long.' } }

  const offset = normalizeOffset(options.offset)
  if (offset === null) return { status: 400, body: { error: 'The page is out of range.' } }

  try {
    const payload = await deps.searchTracks(buildSpotifyQuery(query, options.fields), await deps.getAccessToken(), offset)
    return { status: 200, body: { tracks: normalizeTracks(payload), offset, hasMore: hasMoreResults(payload, offset) } }
  } catch (error) {
    if (error instanceof SearchError) return { status: error.status, body: { error: error.message } }
    return { status: 502, body: { error: 'Spotify search is unavailable.' } }
  }
}
