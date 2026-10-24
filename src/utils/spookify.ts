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

const SWIPER_REWARD: Record<SwipeDirection, number> = { right: 1, left: 0.5 }
const SUBMITTER_REWARD: Record<SwipeDirection, number> = { right: 1, left: 0 }

export const swiperReward = (direction: SwipeDirection): number => SWIPER_REWARD[direction]
export const submitterReward = (direction: SwipeDirection): number => SUBMITTER_REWARD[direction]

export const SONG_ALREADY_ADDED_MESSAGE = 'Song already added'

export const DAILY_LIMIT_MESSAGE =
  'Daily song limit reached. Limits reset at midnight; level up the battle pass for more.'

export type SongAllowance = { xp: number; level: number; daily_limit: number; added_today: number }

export function describeSongAllowance({ daily_limit, added_today }: SongAllowance): string {
  const left = Math.max(0, daily_limit - added_today)
  if (left === 0) return `Daily song limit reached (${added_today} of ${daily_limit}).   Limits reset at midnight; level up the battle pass for more.`
    return `${left} of ${daily_limit} songs left today.`
}

export type FmkChoice = 'sing' | 'listen' | 'delete'

export type FmkSong = SpookifySong & { tier: number }

export const FMK_CHOICES: readonly FmkChoice[] = ['sing', 'listen', 'delete']

export const FMK_PLAYER_REWARD = 1

const FMK_TIER_POINTS: Record<FmkChoice, number> = { sing: 2, listen: 1, delete: 0 }
const FMK_SUBMITTER_REWARD: Record<FmkChoice, number> = { sing: 1, listen: 0.5, delete: 0 }

export const fmkTierPoints = (choice: FmkChoice): number => FMK_TIER_POINTS[choice]
export const fmkSubmitterReward = (choice: FmkChoice): number => FMK_SUBMITTER_REWARD[choice]

// A round is ready once every song has its own distinct choice.
export function fmkAssignmentComplete(
  songIds: readonly string[],
  assignment: Readonly<Record<string, FmkChoice | undefined>>,
): boolean {
  const chosen = songIds.map((id) => assignment[id])
  return chosen.length === FMK_CHOICES.length
    && chosen.every((choice) => choice !== undefined)
    && new Set(chosen).size === FMK_CHOICES.length
}

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
  if (message.includes('Daily song limit')) return DAILY_LIMIT_MESSAGE
  if (message.includes('already swiped')) return 'You have already swiped on this song.'
  if (message.includes('choose your own')) return 'You cannot choose your own song.'
  if (message.includes('your own song')) return 'You cannot swipe on your own song.'
  if (message.includes('three different songs')) return 'Give each song a different choice.'
  if (message.includes('already deleted')) return 'One of those songs was already deleted.'
  if (message.includes('not in the same tier') || message.includes('already faced each other')) {
    return 'That round is no longer valid. Loading a new one.'
  }
  if (message.includes('Account is not active')) return 'Your account is not active.'
  if (message.includes('Unknown song')) return 'That song is no longer in the pool.'
  if (message.includes('needs a Spotify track')) return 'That song is missing a title or artist.'
  return 'Something went wrong. Please try again.'
}
