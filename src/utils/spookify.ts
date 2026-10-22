export type SwipeDirection = 'left' | 'right'

export type SpookifyTrack = {
  spotify_track_id: string
  title: string
  artist: string
  album_art_url: string | null
  spotify_url: string | null
}

export type SpookifySong = SpookifyTrack & {
  id: string
  added_by: string
}

export const SUBMISSION_REWARD = 0.5

const SWIPER_REWARD: Record<SwipeDirection, number> = { right: 1, left: 0.5 }
const SUBMITTER_REWARD: Record<SwipeDirection, number> = { right: 1, left: 0 }

export const swiperReward = (direction: SwipeDirection): number => SWIPER_REWARD[direction]
export const submitterReward = (direction: SwipeDirection): number => SUBMITTER_REWARD[direction]

export const SONG_ALREADY_ADDED_MESSAGE = 'Song already added'

// Scores move in halves, and PostgREST can hand a numeric column back as a string.
export function formatSpookifyScore(score: number | string | null | undefined): string {
  const value = typeof score === 'string' ? Number.parseFloat(score) : (score ?? 0)
  if (!Number.isFinite(value)) return '0'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export type SearchResult = {
  track: SpookifyTrack
  alreadyAdded: boolean
}

export function markAlreadyAdded(
  tracks: readonly SpookifyTrack[],
  pooledTrackIds: readonly string[],
): SearchResult[] {
  const pooled = new Set(pooledTrackIds)
  return tracks.map((track) => ({ track, alreadyAdded: pooled.has(track.spotify_track_id) }))
}

export function describeSpookifyError(error: { message?: string | null } | null | undefined): string {
  const message = error?.message ?? ''
  if (message.includes('Song already added')) return SONG_ALREADY_ADDED_MESSAGE
  if (message.includes('already swiped')) return 'You have already swiped on this song.'
  if (message.includes('your own song')) return 'You cannot swipe on your own song.'
  if (message.includes('Account is not active')) return 'Your account is not active.'
  if (message.includes('Unknown song')) return 'That song is no longer in the pool.'
  if (message.includes('needs a Spotify track')) return 'That song is missing a title or artist.'
  return 'Something went wrong. Please try again.'
}
