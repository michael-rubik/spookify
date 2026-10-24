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

// The ten regular badges. Targets mirror the thresholds in public.my_badge_progress().
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
  { id: 'fight-winner', title: 'Clicker champion', goal: 'Win a clicker fight', target: 1, message: 'Du hast deinen ersten Clicker-Fight gewonnen.', defaultPoints: 200 },
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

export const LEGACY_WINNER_ID = 'legacy-winner'

// Kept by former Winner winner holders. It earns XP but is off the track and never counts towards Winner winner.
export const LEGACY_WINNER: PassBadge = {
  id: LEGACY_WINNER_ID,
  title: 'Ich war schon mal winner',
  goal: 'Held Winner winner before clicker fights',
  target: 1,
  message: 'Du warst schon mal Winner winner',
  defaultPoints: 100,
}

// Every badge with editable points: the track plus the legacy badge.
export const POINT_BADGES: readonly PassBadge[] = [...ALL_PASS_BADGES, LEGACY_WINNER]

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
  for (const badge of POINT_BADGES) {
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

export type PassLevel = { id: string; xp_required: number; bonus_songs: number; bonus_fights: number }

export const MAX_LEVEL_XP = 100000
export const MAX_LEVEL_BONUS_SONGS = 100
export const MAX_LEVEL_BONUS_FIGHTS = 100

// The bar ends at the larger of the badge total and the highest milestone, so no reward icon falls off it.
export const passScale = (trackTotal: number, levels: readonly PassLevel[]): number =>
  Math.max(trackTotal, ...levels.map((entry) => entry.xp_required), 1)

// Icons closer than this share of the bar width merge into one group (about 24px on a phone).
export const REWARD_GROUP_GAP_PERCENT = 7

export type RewardGroup = {
  key: string
  positionPercent: number
  bonusSongs: number
  bonusFights: number
  milestones: PassLevel[]
  reachedCount: number
}

export function rewardGroups(levels: readonly PassLevel[], xp: number, scale: number): RewardGroup[] {
  const sorted = [...levels].sort((a, b) => a.xp_required - b.xp_required)
  const percentOf = (entry: PassLevel) => Math.min(100, (entry.xp_required / scale) * 100)
  const groups: PassLevel[][] = []
  for (const entry of sorted) {
    const current = groups[groups.length - 1]
    if (current && percentOf(entry) - percentOf(current[current.length - 1]) < REWARD_GROUP_GAP_PERCENT) {
      current.push(entry)
    } else {
      groups.push([entry])
    }
  }

  return groups.map((milestones) => ({
    key: milestones.map((entry) => entry.id).join('+'),
    positionPercent: percentOf(milestones[0]),
    bonusSongs: milestones.reduce((sum, entry) => sum + entry.bonus_songs, 0),
    bonusFights: milestones.reduce((sum, entry) => sum + entry.bonus_fights, 0),
    milestones,
    reachedCount: milestones.filter((entry) => entry.xp_required <= xp).length,
  }))
}

export function describeRewardGroup(group: RewardGroup): string {
  const perks = [
    group.bonusSongs > 0 ? `+${group.bonusSongs} ${group.bonusSongs === 1 ? 'song' : 'songs'} per day` : '',
    group.bonusFights > 0 ? `+${group.bonusFights} ${group.bonusFights === 1 ? 'fight' : 'fights'} per day` : '',
  ].filter(Boolean)
  const songs = perks.length > 0 ? perks.join(', ') : 'No perk'
  const { milestones, reachedCount } = group
  if (reachedCount === milestones.length) return `${songs} · Unlocked`
  if (reachedCount === 0) {
    const first = milestones[0].xp_required
    const last = milestones[milestones.length - 1].xp_required
    return `${songs} · Unlocked at ${first === last ? first : `${first}–${last}`} XP`
  }
  return `${songs} · ${reachedCount} of ${milestones.length} unlocked, next at ${milestones[reachedCount].xp_required} XP`
}

export type LevelStatus = {
  level: number
  bonusSongs: number
  bonusFights: number
  next: PassLevel | null
}

// Level 1 is the lowest XP threshold; a level's bonus songs stack with every level below it.
export function levelStatus(xp: number, levels: readonly PassLevel[]): LevelStatus {
  const sorted = [...levels].sort((a, b) => a.xp_required - b.xp_required)
  const reached = sorted.filter((entry) => entry.xp_required <= xp)
  return {
    level: reached.length,
    bonusSongs: reached.reduce((sum, entry) => sum + entry.bonus_songs, 0),
    bonusFights: reached.reduce((sum, entry) => sum + entry.bonus_fights, 0),
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
