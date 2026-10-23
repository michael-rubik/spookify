import { describe, expect, it } from 'vitest'
import {
  ALL_PASS_BADGES,
  PASS_BADGES,
  WINNER_WINNER,
  buildTrack,
  clampPoints,
  computeXp,
  hasUnseenBadges,
  levelStatus,
} from './battle-pass'

describe('battle pass catalog', () => {
  it('has nine regular badges plus Winner winner, all with a message', () => {
    expect(PASS_BADGES).toHaveLength(9)
    expect(ALL_PASS_BADGES.every((badge) => badge.message.length > 0)).toBe(true)
    expect(WINNER_WINNER.message).toBe('chicken dinner')
  })

  it('totals 1,700 default XP for the regular badges', () => {
    expect(PASS_BADGES.reduce((sum, badge) => sum + badge.defaultPoints, 0)).toBe(1700)
  })
})

describe('buildTrack', () => {
  it('orders cheapest first and ends with Winner winner', () => {
    const track = buildTrack([], {}, {})
    const points = track.slice(0, -1).map((node) => node.points)
    expect(points).toEqual([...points].sort((a, b) => a - b))
    expect(track.at(-1)?.badge.id).toBe('winner-winner')
  })

  it('reorders when an admin changes an amount and keeps Winner winner last', () => {
    const track = buildTrack([], { fmk: 1, 'winner-winner': 0 }, {})
    expect(track[0].badge.id).toBe('fmk')
    expect(track.at(-1)?.badge.id).toBe('winner-winner')
  })

  it('accumulates milestones, marks earned nodes and caps progress at the target', () => {
    const track = buildTrack(['voter'], {}, { voter: 1, clicker: 9999, tagged: 4 })
    expect(track.at(-1)?.milestone).toBe(2200)
    expect(track.find((node) => node.badge.id === 'voter')?.earned).toBe(true)
    expect(track.find((node) => node.badge.id === 'clicker')?.progress).toBe(500)
    expect(track.find((node) => node.badge.id === 'tagged')?.progress).toBe(4)
  })
})

describe('levelStatus', () => {
  const levels = [
    { id: 'b', xp_required: 500, bonus_songs: 2 },
    { id: 'a', xp_required: 200, bonus_songs: 1 },
    { id: 'c', xp_required: 1000, bonus_songs: 3 },
  ]

  it('is level 0 with no bonus below the first threshold', () => {
    expect(levelStatus(199, levels)).toEqual({ level: 0, bonusSongs: 0, next: levels[1] })
  })

  it('stacks bonuses of every reached level, whatever the input order', () => {
    expect(levelStatus(500, levels)).toEqual({ level: 2, bonusSongs: 3, next: levels[2] })
  })

  it('has no next level at the top', () => {
    expect(levelStatus(5000, levels)).toEqual({ level: 3, bonusSongs: 6, next: null })
  })
})

describe('computeXp', () => {
  const base = { points: {}, customPoints: {}, voteWinnerPoints: [] }

  it('sums only held badges at their current points', () => {
    expect(computeXp({ ...base, heldIds: ['voter', 'fmk'] }).xp).toBe(400)
    expect(computeXp({ ...base, heldIds: ['voter', 'fmk'], points: { voter: 1 } }).xp).toBe(301)
  })

  it('adds custom badges (default 10) and vote wins', () => {
    const summary = computeXp({
      heldIds: ['custom:Party MVP', 'custom:Other'],
      points: {},
      customPoints: { 'Party MVP': 25 },
      voteWinnerPoints: [10, 40],
    })
    expect(summary.xp).toBe(25 + 10 + 50)
    expect(summary.breakdown).toEqual({ badges: 0, custom: 35, votes: 50 })
  })

  it('splits xp by source', () => {
    expect(computeXp({ ...base, heldIds: ['voter'], voteWinnerPoints: [5] }).breakdown)
      .toEqual({ badges: 100, custom: 0, votes: 5 })
  })

  it('reports the track total including Winner winner', () => {
    expect(computeXp({ ...base, heldIds: [] }).trackTotal).toBe(2200)
  })

  it('tolerates missing badges', () => {
    expect(computeXp({ ...base, heldIds: null }).xp).toBe(0)
  })
})

describe('helpers', () => {
  it('clamps points to a whole number from 0 to 1000', () => {
    expect(clampPoints(-5)).toBe(0)
    expect(clampPoints(1500)).toBe(1000)
    expect(clampPoints(12.9)).toBe(12)
    expect(clampPoints(Number.NaN)).toBe(0)
  })

  it('detects badges the user has not seen yet', () => {
    expect(hasUnseenBadges(['clicker'], [])).toBe(true)
    expect(hasUnseenBadges(['clicker'], ['clicker', 'old'])).toBe(false)
    expect(hasUnseenBadges([], null)).toBe(false)
  })
})
