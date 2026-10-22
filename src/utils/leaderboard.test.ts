import { describe, expect, it } from 'vitest'
import { buildLeaderboard, type LeaderboardUser } from './leaderboard'

const user = (id: string, clicks: number, name = id): LeaderboardUser => ({
  id,
  name,
  costume: '',
  avatar_url: null,
  value: clicks,
})

describe('buildLeaderboard', () => {
  it('orders by clicks and scales bars to the leader', () => {
    const rows = buildLeaderboard([user('a', 10), user('b', 40), user('c', 20)], 'a', 10)
    expect(rows.map((row) => [row.id, row.rank, row.fraction])).toEqual([
      ['b', 1, 1],
      ['c', 2, 0.5],
      ['a', 3, 0.25],
    ])
  })

  it('shares a rank between tied users and orders them by name', () => {
    const rows = buildLeaderboard([user('x', 5, 'Zed'), user('y', 5, 'Amy'), user('z', 1)], 'z', 1)
    expect(rows.map((row) => [row.name, row.rank])).toEqual([['Amy', 1], ['Zed', 1], ['z', 3]])
  })

  it('caps the list and appends the viewer when outside the top', () => {
    const users = Array.from({ length: 12 }, (_, index) => user(`u${index}`, 100 - index))
    const rows = buildLeaderboard(users, 'u11', 89, 10)
    expect(rows).toHaveLength(11)
    expect(rows[10]).toMatchObject({ id: 'u11', rank: 12, isOwn: true })
    expect(buildLeaderboard(users, 'u0', 100, 10)).toHaveLength(10)
  })

  it('uses the viewer\'s local count over the stored one', () => {
    const rows = buildLeaderboard([user('a', 1), user('b', 3)], 'a', 5)
    expect(rows[0]).toMatchObject({ id: 'a', rank: 1, fraction: 1 })
  })

  it('shows empty bars while nobody has clicked', () => {
    expect(buildLeaderboard([user('a', 0)], 'a', 0)[0].fraction).toBe(0)
    expect(buildLeaderboard([], 'a', 0)).toEqual([])
  })
})
