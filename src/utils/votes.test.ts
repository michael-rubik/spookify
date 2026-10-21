import { describe, expect, it } from 'vitest'
import { buildFakeBars, buildLeaderboard, hash01, progressPercent } from './votes'

describe('buildLeaderboard', () => {
  it('ranks by ballots with shared ranks for ties and marks every tied leader as winner', () => {
    const board = buildLeaderboard([
      { candidate_id: 'c', ballots: 1 },
      { candidate_id: 'a', ballots: 3 },
      { candidate_id: 'b', ballots: 3 },
      { candidate_id: 'd', ballots: 2 },
    ])

    expect(board.map((entry) => [entry.candidate_id, entry.rank, entry.isWinner])).toEqual([
      ['a', 1, true],
      ['b', 1, true],
      ['d', 3, false],
      ['c', 4, false],
    ])
  })

  it('returns an empty board when nobody received a ballot', () => {
    expect(buildLeaderboard([])).toEqual([])
    expect(buildLeaderboard([{ candidate_id: 'a', ballots: 0 }])).toEqual([])
  })
})

describe('progressPercent', () => {
  it('rounds and clamps', () => {
    expect(progressPercent(1, 3)).toBe(33)
    expect(progressPercent(5, 4)).toBe(100)
    expect(progressPercent(0, 0)).toBe(0)
  })
})

describe('buildFakeBars', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('is deterministic per seed and tick, and changes between ticks', () => {
    expect(buildFakeBars(ids, 's1', 0)).toEqual(buildFakeBars(ids, 's1', 0))
    expect(buildFakeBars(ids, 's1', 0)).not.toEqual(buildFakeBars(ids, 's1', 1))
  })

  it('gives each candidate a unique anonymous label and sorts by length', () => {
    const bars = buildFakeBars(ids, 's1', 3)
    expect(new Set(bars.map((bar) => bar.label)).size).toBe(ids.length)
    expect(bars.every((bar) => /^Costume #\d+$/.test(bar.label))).toBe(true)
    expect(bars.map((bar) => bar.fraction)).toEqual(bars.map((bar) => bar.fraction).toSorted((x, y) => y - x))
  })

  it('never uses real vote data and stays within bounds', () => {
    for (const bar of buildFakeBars(ids, 'x', 7)) {
      expect(bar.fraction).toBeGreaterThanOrEqual(0.12)
      expect(bar.fraction).toBeLessThanOrEqual(1)
    }
    expect(hash01('anything')).toBeGreaterThanOrEqual(0)
    expect(hash01('anything')).toBeLessThan(1)
  })
})
