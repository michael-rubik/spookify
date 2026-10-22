import { describe, expect, it } from 'vitest'
import { buildSongLeaderboard, songSubmitters, type LeaderboardSong } from './song-leaderboard'

const song = (id: string, points: number, added_by = 'u1', title = id): LeaderboardSong => ({
  id,
  title,
  artist: 'Artist',
  album_art_url: null,
  points,
  added_by,
  submitter_name: added_by === 'u1' ? 'Ann' : 'Ben',
})

describe('buildSongLeaderboard', () => {
  it('orders songs by points, shares ranks for ties and scales bars to the leader', () => {
    const rows = buildSongLeaderboard([song('a', 1), song('b', 4), song('c', 4, 'u2', 'Z'), song('d', 2)], null)
    expect(rows.map((row) => [row.id, row.rank, row.fraction])).toEqual([
      ['b', 1, 1],
      ['c', 1, 1],
      ['d', 3, 0.5],
      ['a', 4, 0.25],
    ])
  })

  it('narrows to one submitter and ranks within their songs', () => {
    const rows = buildSongLeaderboard([song('a', 5), song('b', 9, 'u2'), song('c', 1)], 'u1')
    expect(rows.map((row) => [row.id, row.rank])).toEqual([['a', 1], ['c', 2]])
  })

  it('caps the list and shows empty bars without points', () => {
    const many = Array.from({ length: 12 }, (_, index) => song(`s${index}`, 0))
    expect(buildSongLeaderboard(many, null, 10)).toHaveLength(10)
    expect(buildSongLeaderboard(many, null)[0].fraction).toBe(0)
  })
})

describe('songSubmitters', () => {
  it('lists each submitter once by name', () => {
    expect(songSubmitters([song('a', 1), song('b', 1, 'u2'), song('c', 1)])).toEqual([
      { id: 'u1', name: 'Ann' },
      { id: 'u2', name: 'Ben' },
    ])
  })
})
