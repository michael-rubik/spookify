import { describe, expect, it } from 'vitest'
import {
  DAILY_LIMIT_MESSAGE,
  describeSongAllowance,
  describeFmkSkips,
  describeSpookifyError,
  fmkAssignmentComplete,
  fmkSubmitterReward,
  FMK_PLAYER_REWARD,
  formatSpookifyScore,
  markAlreadyAdded,
  submitterReward,
  swiperReward,
  type SpookifyTrack,
} from './spookify'
import {
  normalizeTracks,
  searchSpookifySongs,
  SearchError,
  type SearchDependencies,
} from '../../supabase/functions/spookify-search/core'
import { createSearchHandler } from '../../supabase/functions/spookify-search/handler'

const track = (id: string): SpookifyTrack => ({
  spotify_track_id: id,
  title: `Title ${id}`,
  artist: 'Artist',
  album_art_url: null,
  spotify_url: null,
})

describe('spookify rewards', () => {
  it('pays the swiper a point for a right swipe and half for a left swipe', () => {
    expect(swiperReward('right')).toBe(1)
    expect(swiperReward('left')).toBe(0.5)
  })

  it('pays the submitter a point per right swipe and nothing for a left swipe', () => {
    expect(submitterReward('right')).toBe(1)
    expect(submitterReward('left')).toBe(0)
  })
})

describe('fmk', () => {
  it('pays the player a flat point and the submitter one for sing and a half for listen', () => {
    expect(FMK_PLAYER_REWARD).toBe(1)
    expect(fmkSubmitterReward('sing')).toBe(1)
    expect(fmkSubmitterReward('listen')).toBe(0.5)
    expect(fmkSubmitterReward('delete')).toBe(0)
  })

  it('is complete only when each song has its own distinct choice', () => {
    const ids = ['a', 'b', 'c']
    expect(fmkAssignmentComplete(ids, { a: 'sing', b: 'listen', c: 'delete' })).toBe(true)
    expect(fmkAssignmentComplete(ids, { a: 'sing', b: 'listen' })).toBe(false)
    expect(fmkAssignmentComplete(ids, { a: 'sing', b: 'sing', c: 'delete' })).toBe(false)
  })

  it('keeps the own-song swipe error separate from FMK errors and explains skip errors', () => {
    expect(describeSpookifyError({ message: 'You cannot swipe on your own song' })).toBe('You cannot swipe on your own song.')
    expect(describeSpookifyError({ message: 'No skips left today' })).toContain('No skips left')
    expect(describeSpookifyError({ message: 'These songs are not your current trio' })).toContain('no longer valid')
  })

  it('describes the skips left, or how to unlock them', () => {
    expect(describeFmkSkips({ skips_left: 1, skips_total: 3 })).toBe('1 of 3 skips left today.')
    expect(describeFmkSkips({ skips_left: 0, skips_total: 0 })).toContain('Unlock skips')
  })
})

describe('formatSpookifyScore', () => {
  it('keeps quarters visible, drops trailing zeros and survives numeric strings from PostgREST', () => {
    expect(formatSpookifyScore(3.5)).toBe('3.5')
    expect(formatSpookifyScore(4)).toBe('4')
    expect(formatSpookifyScore('2.25')).toBe('2.25')
    expect(formatSpookifyScore('7.00')).toBe('7')
  })

  it('falls back to zero for missing or unreadable values', () => {
    expect(formatSpookifyScore(null)).toBe('0')
    expect(formatSpookifyScore(undefined)).toBe('0')
    expect(formatSpookifyScore('not a number')).toBe('0')
  })
})

describe('markAlreadyAdded', () => {
  it('flags the tracks that are already in the pool', () => {
    expect(markAlreadyAdded([track('a'), track('b')], ['b'])).toEqual([
      { track: track('a'), alreadyAdded: false },
      { track: track('b'), alreadyAdded: true },
    ])
  })
})

describe('describeSongAllowance', () => {
  it('shows what is left', () => {
    expect(describeSongAllowance({ xp: 0, level: 0, daily_limit: 10, added_today: 4 })).toBe(
      '6 of 10 songs left today.',
    )
  })

  it('explains when the limit is reached', () => {
    expect(describeSongAllowance({ xp: 0, level: 0, daily_limit: 10, added_today: 10 })).toContain('Daily song limit reached (10 of 10)')
  })
})

describe('describeSpookifyError', () => {
  it('explains the daily song limit', () => {
    expect(describeSpookifyError({ message: 'Daily song limit reached' })).toBe(DAILY_LIMIT_MESSAGE)
  })

  it('reports a duplicate submission as "Song already added"', () => {
    expect(describeSpookifyError({ message: 'Song already added' })).toBe('Song already added')
  })

  it('explains the one-swipe and self-swipe rules, and hides anything unexpected', () => {
    expect(describeSpookifyError({ message: 'You have already swiped on this song' }))
      .toBe('You have already swiped on this song.')
    expect(describeSpookifyError({ message: 'You cannot swipe on your own song' }))
      .toBe('You cannot swipe on your own song.')
    expect(describeSpookifyError({ message: 'relation "x" does not exist' }))
      .toBe('Something went wrong. Please try again.')
    expect(describeSpookifyError(null)).toBe('Something went wrong. Please try again.')
  })
})

describe('normalizeTracks', () => {
  const payload = {
    tracks: {
      items: [
        {
          id: '1',
          name: 'Thriller',
          artists: [{ name: 'Michael Jackson' }, { name: 'Vincent Price' }],
          album: { images: [{ url: 'https://img/large.jpg' }, { url: 'https://img/small.jpg' }] },
          external_urls: { spotify: 'https://open.spotify.com/track/1' },
        },
      ],
    },
  }

  it('keeps only the pool fields and joins every credited artist', () => {
    expect(normalizeTracks(payload)).toEqual([
      {
        spotify_track_id: '1',
        title: 'Thriller',
        artist: 'Michael Jackson, Vincent Price',
        album_art_url: 'https://img/large.jpg',
        spotify_url: 'https://open.spotify.com/track/1',
      },
    ])
  })

  it('drops unusable entries, de-duplicates ids and tolerates a malformed response', () => {
    const messy = {
      tracks: {
        items: [
          { id: '1', name: 'Thriller', artists: [{ name: 'MJ' }] },
          { id: '1', name: 'Thriller', artists: [{ name: 'MJ' }] },
          { id: '2', name: '   ', artists: [{ name: 'MJ' }] },
          { id: '3', name: 'No artist', artists: [] },
          'nonsense',
        ],
      },
    }
    expect(normalizeTracks(messy).map((item) => item.spotify_track_id)).toEqual(['1'])
    expect(normalizeTracks({ tracks: {} })).toEqual([])
    expect(normalizeTracks(null)).toEqual([])
  })

  it('never returns more than the requested number of tracks', () => {
    const many = { tracks: { items: Array.from({ length: 25 }, (_, index) => ({ id: `${index}`, name: 'Song', artists: [{ name: 'A' }] })) } }
    expect(normalizeTracks(many)).toHaveLength(10)
    expect(normalizeTracks(many, 3)).toHaveLength(3)
  })
})

function searchFixture() {
  const deps: SearchDependencies = {
    verifyUser: async (token) => (token === 'valid' ? 'user-1' : null),
    getAccessToken: async () => 'spotify-token',
    searchTracks: async (query, accessToken) => ({
      tracks: { items: [{ id: query, name: accessToken, artists: [{ name: 'A' }] }] },
    }),
  }
  return deps
}

describe('searchSpookifySongs', () => {
  it('requires a signed-in caller before talking to Spotify', async () => {
    const deps = searchFixture()
    let reached = false
    deps.getAccessToken = async () => { reached = true; return 'x' }
    expect(await searchSpookifySongs('invalid', 'thriller', deps)).toMatchObject({ status: 401 })
    expect(reached).toBe(false)
  })

  it('rejects an empty or oversized query', async () => {
    const deps = searchFixture()
    expect(await searchSpookifySongs('valid', '   ', deps)).toMatchObject({ status: 400 })
    expect(await searchSpookifySongs('valid', 'x'.repeat(101), deps)).toMatchObject({ status: 400 })
  })

  it('returns normalized tracks for a trimmed query', async () => {
    const result = await searchSpookifySongs('valid', '  thriller  ', searchFixture())
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      offset: 0,
      hasMore: false,
      tracks: [{
        spotify_track_id: 'thriller',
        title: 'spotify-token',
        artist: 'A',
        album_art_url: null,
        spotify_url: null,
      }],
    })
  })

  it('narrows the Spotify query to one field and pages with an offset', async () => {
    const seen: { query: string; offset: number }[] = []
    const deps = searchFixture()
    deps.searchTracks = async (query, _token, offset) => {
      seen.push({ query, offset })
      return { tracks: { items: [{ id: 'x', name: 'N', artists: [{ name: 'A' }] }], next: 'https://next' } }
    }
    const artistOnly = await searchSpookifySongs('valid', 'Queen', deps, { fields: ['artist'], offset: 10 })
    await searchSpookifySongs('valid', 'He said "hi"', deps, { fields: ['title'] })
    await searchSpookifySongs('valid', 'Queen', deps, { fields: ['title', 'artist'] })
    expect(seen).toEqual([
      { query: 'artist:"Queen"', offset: 10 },
      { query: 'track:"He said hi"', offset: 0 },
      { query: 'Queen', offset: 0 },
    ])
    expect(artistOnly.body).toMatchObject({ offset: 10, hasMore: true })
  })

  it('reports the last page and rejects an out-of-range offset', async () => {
    const last = await searchSpookifySongs('valid', 'thriller', searchFixture())
    expect(last.body).toMatchObject({ hasMore: false })
    expect(await searchSpookifySongs('valid', 'thriller', searchFixture(), { offset: -1 })).toMatchObject({ status: 400 })
    expect(await searchSpookifySongs('valid', 'thriller', searchFixture(), { offset: 1000 })).toMatchObject({ status: 400 })
  })

  it('passes a Spotify rate limit through and hides unexpected failures', async () => {
    const limited = searchFixture()
    limited.searchTracks = async () => { throw new SearchError(429, 'Spotify is busy. Please try again shortly.') }
    expect(await searchSpookifySongs('valid', 'thriller', limited)).toMatchObject({ status: 429 })

    const broken = searchFixture()
    broken.searchTracks = async () => { throw new Error('ECONNRESET at 10.0.0.1') }
    expect(await searchSpookifySongs('valid', 'thriller', broken))
      .toEqual({ status: 502, body: { error: 'Spotify search is unavailable.' } })
  })
})

describe('search handler', () => {
  const handler = createSearchHandler(searchFixture(), {})
  const post = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer valid' }) =>
    handler(new Request('https://example.test/spookify-search', { method: 'POST', headers, body: JSON.stringify(body) }))

  it('rejects other methods and anonymous callers', async () => {
    expect((await handler(new Request('https://example.test', { method: 'GET' }))).status).toBe(405)
    expect((await post({ query: 'thriller' }, {})).status).toBe(401)
  })

  it('rejects a body without a string query', async () => {
    expect((await post({ query: 7 })).status).toBe(400)
    expect((await post({})).status).toBe(400)
  })

  it('answers a valid search with tracks', async () => {
    const response = await post({ query: 'thriller' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ tracks: [{ spotify_track_id: 'thriller' }] })
  })
})
