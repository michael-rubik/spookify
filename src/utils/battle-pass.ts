import { BADGES, SONGMASTER_BADGE } from './badges'

export type PassBadge = {
  id: string
  title: string
  goal: string
  target: number
  message: string
  defaultPoints: number
}

export const WINNER_WINNER_ID = 'winner-winner'
export const DEFAULT_CUSTOM_POINTS = 10
export const MAX_BADGE_POINTS = 1000

const clickerMessage = BADGES[0].message

// The nine regular badges. Targets mirror the thresholds in public.my_badge_progress().
export const PASS_BADGES: readonly PassBadge[] = [
  { id: 'clicker', title: 'Clicker', goal: 'Click 500 times', target: 500, message: clickerMessage, defaultPoints: 200 },
  { id: 'songmaster', title: 'Songmaster', goal: 'Collect 100 Spookify points', target: 100, message: SONGMASTER_BADGE.message, defaultPoints: 200 },
  { id: 'spooker', title: 'Spooker', goal: 'Post your first spook', target: 1, message: 'Dein erster Spook! Der Feed gehört dir.', defaultPoints: 100 },
  { id: 'tagged', title: 'Popular', goal: 'Get tagged in 10 spooks by others', target: 10, message: 'Alle wollen dich auf ihren Fotos haben.', defaultPoints: 200 },
  { id: 'fan', title: 'Fan favourite', goal: 'Get 10 swipes right on one song you added', target: 10, message: 'Dein Song ist ein echter Hit.', defaultPoints: 300 },
  { id: 'karaoke', title: 'Karaoke star', goal: 'Perform 3 karaoke songs', target: 3, message: 'Das Mikrofon gehört dir.', defaultPoints: 100 },
  { id: 'swipes', title: 'Swipe marathon', goal: 'Swipe 50 songs in Spookify Tinder', target: 50, message: 'Dein Daumen braucht eine Pause.', defaultPoints: 200 },
  { id: 'fmk', title: 'FMK veteran', goal: 'Finish 25 FMK rounds', target: 25, message: 'Du hast schwere Entscheidungen getroffen.', defaultPoints: 300 },
  { id: 'voter', title: 'Voter', goal: 'Cast a ballot in a vote that has ended', target: 1, message: 'Deine Stimme zählt.', defaultPoints: 100 },
]

export const WINNER_WINNER: PassBadge = {
  id: WINNER_WINNER_ID,
  title: 'Winner winner',
  goal: 'Earn every other badge',
  target: PASS_BADGES.length,
  message: 'chicken dinner',
  defaultPoints: 500,
}

export const ALL_PASS_BADGES: readonly PassBadge[] = [...PASS_BADGES, WINNER_WINNER]

export type PointsById = Record<string, number>

export const pointsFor = (badge: PassBadge, overrides: PointsById): number => overrides[badge.id] ?? badge.defaultPoints

export type PassNode = {
  badge: PassBadge
  points: number
  // XP the track has accumulated once this node is reached.
  milestone: number
  earned: boolean
  progress: number
}

// Cheapest first with a stable tie order; Winner winner always closes the track.
export function buildTrack(
  heldIds: readonly string[] | null | undefined,
  overrides: PointsById,
  progress: Record<string, number>,
): PassNode[] {
  const held = new Set(heldIds ?? [])
  const regular = PASS_BADGES.map((badge, index) => ({ badge, index, points: pointsFor(badge, overrides) }))
    .sort((a, b) => a.points - b.points || a.index - b.index)
  const ordered = [
    ...regular.map(({ badge, points }) => ({ badge, points })),
    { badge: WINNER_WINNER, points: pointsFor(WINNER_WINNER, overrides) },
  ]

  let milestone = 0
  return ordered.map(({ badge, points }) => {
    milestone += points
    return {
      badge,
      points,
      milestone,
      earned: held.has(badge.id),
      progress: Math.min(progress[badge.id] ?? 0, badge.target),
    }
  })
}

export type XpInput = {
  heldIds: readonly string[] | null | undefined
  points: PointsById
  customPoints: Record<string, number>
  // winner_points of every ended vote the user won
  voteWinnerPoints: readonly number[]
}

export type XpSummary = {
  xp: number
  trackTotal: number
  // xp split by source: track badges, custom badges, vote wins
  breakdown: { badges: number; custom: number; votes: number }
}

export const customLabelOf = (id: string): string | null =>
  id.startsWith('custom:') ? id.slice('custom:'.length).trim() || null : null

// XP is always derived from the current point values, so an admin edit corrects everyone at once.
export function computeXp({ heldIds, points, customPoints, voteWinnerPoints }: XpInput): XpSummary {
  const held = new Set(heldIds ?? [])
  let badges = 0
  let custom = 0
  for (const badge of ALL_PASS_BADGES) {
    if (held.has(badge.id)) badges += pointsFor(badge, points)
  }
  for (const id of held) {
    const label = customLabelOf(id)
    if (label) custom += customPoints[label] ?? DEFAULT_CUSTOM_POINTS
  }
  const votes = voteWinnerPoints.reduce((sum, won) => sum + won, 0)

  const trackTotal = ALL_PASS_BADGES.reduce((sum, badge) => sum + pointsFor(badge, points), 0)
  return { xp: badges + custom + votes, trackTotal, breakdown: { badges, custom, votes } }
}

export const clampPoints = (value: number): number =>
  Number.isFinite(value) ? Math.min(MAX_BADGE_POINTS, Math.max(0, Math.trunc(value))) : 0

export type PassLevel = { id: string; xp_required: number; bonus_songs: number }

export const MAX_LEVEL_XP = 100000
export const MAX_LEVEL_BONUS_SONGS = 100

export type LevelStatus = {
  level: number
  bonusSongs: number
  next: PassLevel | null
}

// Level 1 is the lowest XP threshold; a level's bonus songs stack with every level below it.
export function levelStatus(xp: number, levels: readonly PassLevel[]): LevelStatus {
  const sorted = [...levels].sort((a, b) => a.xp_required - b.xp_required)
  const reached = sorted.filter((entry) => entry.xp_required <= xp)
  return {
    level: reached.length,
    bonusSongs: reached.reduce((sum, entry) => sum + entry.bonus_songs, 0),
    next: sorted.find((entry) => entry.xp_required > xp) ?? null,
  }
}

// The Pass tab shows a dot while the user holds badges they have not seen on the pass yet.
export const hasUnseenBadges = (
  heldIds: readonly string[] | null | undefined,
  seenIds: readonly string[] | null | undefined,
): boolean => {
  const seen = new Set(seenIds ?? [])
  return (heldIds ?? []).some((id) => !seen.has(id))
}
