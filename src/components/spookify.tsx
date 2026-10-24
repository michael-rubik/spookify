import { useEffect, useRef, useState } from 'react'
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import {
  describeFmkSkips,
  describeSongAllowance,
  describeSpookifyError,
  fmkAssignmentComplete,
  FMK_CHOICES,
  formatSpookifyScore,
  markAlreadyAdded,
  SONG_ALREADY_ADDED_MESSAGE,
  type FmkChoice,
  type FmkSkips,
  type FmkSong,
  type SearchResult,
  type SongAllowance,
  type SpookifySong,
  type SpookifyTrack,
  type SwipeDirection,
} from '../utils/spookify'
import { usePolling } from '../utils/use-polling'
import type { SpookifyPanel } from '../utils/routes'
import './spookify.css'
import './leaderboard.css'
import { GameNote } from './game-note'
import { Leaderboard } from './leaderboard'
import { SongLeaderboard } from './song-leaderboard'

type SpookifyProps = {
  currentUserId: string
  panel: SpookifyPanel
  onPanelChange: (panel: SpookifyPanel) => void
}

const SWIPE_THRESHOLD = 80
const SEARCH_PAGE_SIZE = 10

type SearchField = 'title' | 'artist'
type SearchRequest = { query: string; fields: SearchField[] }

const FMK_LABELS: Record<FmkChoice, string> = { sing: '🎤 Sing', listen: '🎧 Listen', delete: '🗑️ Delete' }

function Artwork({ track }: { track: SpookifyTrack }) {
  return track.album_art_url ? (
    <img src={track.album_art_url} alt="" className="spookify-art" />
  ) : (
    <span className="spookify-art spookify-art--fallback" aria-hidden="true">
      🎵
    </span>
  )
}

export function Spookify({ currentUserId, panel, onPanelChange }: SpookifyProps) {
  const [score, setScore] = useState<number | string | null>(null)
  // Bumped after the user's own plays so the leaderboards refetch at once instead of on the next poll.
  const [scoreVersion, setScoreVersion] = useState(0)

  const reloadScore = usePolling(
    async (isCancelled) => {
      const { data } = await supabase.from('users').select('spookify_score').eq('id', currentUserId).maybeSingle()
      if (isCancelled() || !data) return
      setScore(data.spookify_score ?? 0)
    },
    5000,
  )
  const refreshScores = () => {
    void reloadScore()
    setScoreVersion((version) => version + 1)
  }

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState('')
  const [sourceMessage, setSourceMessage] = useState('')
  const [allowance, setAllowance] = useState<SongAllowance | null>(null)
  const [pooledTrackIds, setPooledTrackIds] = useState<string[]>([])
  const [searchFields, setSearchFields] = useState<SearchField[]>(['title', 'artist'])
  const [lastSearch, setLastSearch] = useState<SearchRequest | null>(null)
  const [searchOffset, setSearchOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const limitReached = allowance !== null && allowance.added_today >= allowance.daily_limit

  const [song, setSong] = useState<SpookifySong | null>(null)
  const [isLoadingSong, setIsLoadingSong] = useState(true)
  const [tinderError, setTinderError] = useState('')
  const [isSwiping, setIsSwiping] = useState(false)
  const [drag, setDrag] = useState(0)

  const [fmkSongs, setFmkSongs] = useState<FmkSong[]>([])
  const [maxTier, setMaxTier] = useState(0)
  const [skips, setSkips] = useState<FmkSkips | null>(null)
  const [isSkipping, setIsSkipping] = useState(false)
  const [assignment, setAssignment] = useState<Record<string, FmkChoice | undefined>>({})
  const [isLoadingFmk, setIsLoadingFmk] = useState(true)
  const [isSubmittingFmk, setIsSubmittingFmk] = useState(false)
  const [fmkError, setFmkError] = useState('')

  const reloadRef = useRef<() => Promise<void>>(async () => {})
  const reloadFmkRef = useRef<() => Promise<void>>(async () => {})
  const reloadAllowanceRef = useRef<() => Promise<void>>(async () => {})
  const dragStart = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadAllowance = async () => {
      const { data, error } = await supabase.rpc('my_song_allowance')
      if (cancelled) return
      const row = ((data ?? []) as SongAllowance[])[0]
      setAllowance(error || !row ? null : row)
    }

    reloadAllowanceRef.current = loadAllowance
    void loadAllowance()
    return () => {
      cancelled = true
    }
  }, [currentUserId])

  useEffect(() => {
    let cancelled = false

    const loadFmk = async () => {
      const [round, max, skipRows] = await Promise.all([
        supabase.rpc('next_spookify_fmk'),
        supabase.rpc('spookify_fmk_max_tier'),
        supabase.rpc('my_fmk_skips'),
      ])
      if (cancelled) return

      setFmkError(round.error ? describeSpookifyError(round.error) : '')
      setFmkSongs(round.error ? [] : ((round.data ?? []) as FmkSong[]))
      setAssignment({})
      setMaxTier(typeof max.data === 'number' ? max.data : 0)
      setSkips(skipRows.error ? null : (((skipRows.data ?? []) as FmkSkips[])[0] ?? null))
      setIsLoadingFmk(false)
    }

    reloadFmkRef.current = loadFmk
    void loadFmk()
    return () => {
      cancelled = true
    }
  }, [currentUserId])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoadingSong(true)
      const [pool, next] = await Promise.all([
        supabase.from('spookify_songs').select('spotify_track_id'),
        supabase.rpc('next_spookify_song'),
      ])
      if (cancelled) return

      setPooledTrackIds((pool.data ?? []).map((row) => row.spotify_track_id as string))
      setTinderError(next.error ? describeSpookifyError(next.error) : '')
      setSong(((next.data ?? []) as SpookifySong[])[0] ?? null)
      setIsLoadingSong(false)
    }

    reloadRef.current = load
    void load()
    return () => {
      cancelled = true
    }
  }, [currentUserId])

  const markPooled = (trackId: string) => {
    setPooledTrackIds((current) => (current.includes(trackId) ? current : [...current, trackId]))
    setResults((current) =>
      current.map((result) =>
        result.track.spotify_track_id === trackId ? { ...result, alreadyAdded: true } : result,
      ),
    )
  }

  const runSearch = async (search: SearchRequest, offset: number) => {
    setIsSearching(true)
    setSourceError('')
    setSourceMessage('')
    const { data, error } = await supabase.functions.invoke('spookify-search', {
      body: { query: search.query, fields: search.fields, offset },
    })
    setIsSearching(false)

    if (error) {
      console.error('Spotify search failed:', error)
      setResults([])
      setHasMore(false)
      setSourceError('Spotify search is unavailable right now.')
      return
    }

    const payload = data as { tracks?: SpookifyTrack[]; hasMore?: boolean } | null
    const tracks = payload?.tracks ?? []
    setLastSearch(search)
    setSearchOffset(offset)
    setHasMore(Boolean(payload?.hasMore))
    setResults(markAlreadyAdded(tracks, pooledTrackIds))
    if (tracks.length === 0) setSourceMessage(offset > 0 ? 'No more songs.' : 'No songs matched that search.')
  }

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) {
      setSourceError('Type a song title or an artist.')
      return
    }

    await runSearch({ query: trimmed, fields: searchFields }, 0)
  }

  const toggleSearchField = (field: SearchField) => {
    setSearchFields((current) => {
      if (!current.includes(field)) return [...current, field]
      // Keep at least one field selected.
      return current.length > 1 ? current.filter((value) => value !== field) : current
    })
  }

  const handleAdd = async (track: SpookifyTrack) => {
    setSourceError('')
    setSourceMessage('')
    setAddingTrackId(track.spotify_track_id)
    const { error } = await supabase.rpc('add_spookify_song', {
      p_spotify_track_id: track.spotify_track_id,
      p_title: track.title,
      p_artist: track.artist,
      p_album_art_url: track.album_art_url,
      p_spotify_url: track.spotify_url,
    })
    setAddingTrackId(null)

    if (error) {
      const message = describeSpookifyError(error)
      setSourceError(message)
      if (message === SONG_ALREADY_ADDED_MESSAGE) markPooled(track.spotify_track_id)
      void reloadAllowanceRef.current()
      return
    }

    markPooled(track.spotify_track_id)
    setSourceMessage(`Added "${track.title}" to the pool.`)
    refreshScores()
    void reloadAllowanceRef.current()
    await reloadRef.current()
  }

  const handleSwipe = async (direction: SwipeDirection) => {
    if (!song || isSwiping) return

    setIsSwiping(true)
    setTinderError('')
    const { error } = await supabase.rpc('swipe_spookify_song', { p_song_id: song.id, p_direction: direction })
    setIsSwiping(false)

    if (error) {
      setTinderError(describeSpookifyError(error))
    }
    refreshScores()
    await reloadRef.current()
  }

  const handleChoose = (songId: string, choice: FmkChoice) => {
    setAssignment((current) => {
      const next: Record<string, FmkChoice | undefined> = {}
      // Each choice belongs to one song, so picking it elsewhere moves it.
      for (const [id, picked] of Object.entries(current)) {
        if (picked !== choice && id !== songId) next[id] = picked
      }
      next[songId] = choice
      return next
    })
  }

  const handleSubmitFmk = async () => {
    const bySong = (choice: FmkChoice) => fmkSongs.find((song) => assignment[song.id] === choice)?.id
    const [sing, listen, remove] = FMK_CHOICES.map(bySong)
    if (!sing || !listen || !remove || isSubmittingFmk) return

    setIsSubmittingFmk(true)
    setFmkError('')
    const { error } = await supabase.rpc('submit_spookify_fmk', { p_sing: sing, p_listen: listen, p_delete: remove })
    setIsSubmittingFmk(false)

    if (error) {
      const message = describeSpookifyError(error)
      await reloadFmkRef.current()
      setFmkError(message)
      return
    }
    refreshScores()
    await Promise.all([reloadFmkRef.current(), reloadRef.current()])
  }

  const handleSkipFmk = async () => {
    if (isSkipping || isSubmittingFmk) return
    setIsSkipping(true)
    setFmkError('')
    const { error } = await supabase.rpc('skip_spookify_fmk')
    await reloadFmkRef.current()
    setIsSkipping(false)
    if (error) setFmkError(describeSpookifyError(error))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!song || isSwiping) return
    dragStart.current = event.clientX
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return
    setDrag(event.clientX - dragStart.current)
  }

  const handlePointerUp = () => {
    if (dragStart.current === null) return
    const travelled = drag
    dragStart.current = null
    setDrag(0)
    if (Math.abs(travelled) >= SWIPE_THRESHOLD) {
      void handleSwipe(travelled > 0 ? 'right' : 'left')
    }
  }

  return (
    <section className="page-section spookify-section">
      <div className="row row--between">
        <h2>Spookify</h2>
        <span className="pill" data-testid="spookify-score">
          Score {formatSpookifyScore(score)}
        </span>
      </div>

      <div className="row spookify-tabs">
        <button
          type="button"
          className={`nav-button${panel === 'source' ? ' is-active' : ''}`}
          onClick={() => onPanelChange('source')}
        >
          Add song to game
        </button>
        <button
          type="button"
          className={`nav-button${panel === 'tinder' ? ' is-active' : ''}`}
          onClick={() => onPanelChange('tinder')}
        >
          Spookify Tinder
        </button>
        <button
          type="button"
          className={`nav-button${panel === 'fmk' ? ' is-active' : ''}`}
          onClick={() => {
            onPanelChange('fmk')
            // Songs may have been added since the round was dealt; keep a round the user has started.
            if (Object.keys(assignment).length === 0) void reloadFmkRef.current()
          }}
        >
          Spookify FMK
        </button>
      </div>

      {panel === 'source' ? (
        <div className="card stack">
          <GameNote gameId="source">
            Adding a song pays nothing. You earn points when others play your songs: +1 per right swipe in Tinder,
            +1 each time a song is sung and +0.5 each time it is listened to in FMK.
          </GameNote>
          <p className="muted">Search Spotify and add songs to the pool.</p>

          <form onSubmit={handleSearch} className="row spookify-search">
            <label className="sr-only" htmlFor="spookify-query">
              Song title or artist
            </label>
            <input
              id="spookify-query"
              type="search"
              value={query}
              placeholder="Song title or artist"
              onChange={(event) => {
                setQuery(event.target.value)
                if (sourceError) setSourceError('')
              }}
            />
            <button type="submit" disabled={isSearching}>
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </form>

          <div className="row spookify-search-fields" role="group" aria-label="Search in">
            {(['title', 'artist'] as const).map((field) => (
              <button
                key={field}
                type="button"
                className={`tag-chip${searchFields.includes(field) ? ' is-selected' : ''}`}
                aria-pressed={searchFields.includes(field)}
                onClick={() => toggleSearchField(field)}
              >
                {field === 'title' ? 'Title' : 'Artist'}
              </button>
            ))}
          </div>

          {allowance && (
            <p
              className={limitReached ? 'form-error' : 'muted'}
              data-testid="song-allowance"
              role={limitReached ? 'alert' : undefined}
            >
              {describeSongAllowance(allowance)}
            </p>
          )}
          {sourceError && <p role="alert" className="form-error">{sourceError}</p>}
          {sourceMessage && <p role="status" className="form-success">{sourceMessage}</p>}

          <ul className="spookify-results">
            {results.map(({ track, alreadyAdded }) => (
              <li key={track.spotify_track_id} className="spookify-result">
                <Artwork track={track} />
                <span className="spookify-result-text">
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </span>
                <button
                  type="button"
                  disabled={alreadyAdded || limitReached || addingTrackId === track.spotify_track_id}
                  onClick={() => void handleAdd(track)}
                >
                  {alreadyAdded
                    ? SONG_ALREADY_ADDED_MESSAGE
                    : addingTrackId === track.spotify_track_id
                      ? 'Adding...'
                      : 'Add'}
                </button>
              </li>
            ))}
          </ul>
          {lastSearch && (searchOffset > 0 || hasMore) && (
            <div className="row row--between spookify-pagination">
              <button
                type="button"
                disabled={isSearching || searchOffset === 0}
                onClick={() => void runSearch(lastSearch, Math.max(0, searchOffset - SEARCH_PAGE_SIZE))}
              >
                Previous
              </button>
              <span className="muted">Page {searchOffset / SEARCH_PAGE_SIZE + 1}</span>
              <button
                type="button"
                disabled={isSearching || !hasMore}
                onClick={() => void runSearch(lastSearch, searchOffset + SEARCH_PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          )}
          <Leaderboard userId={currentUserId} column="submitter_score" label="Add song to game" refreshKey={scoreVersion} />
          <SongLeaderboard refreshKey={scoreVersion} />
        </div>
      ) : panel === 'tinder' ? (
        <div className="card stack spookify-tinder">
          <GameNote gameId="tinder">
            Swipe right for +1 and left for +0.5. When you swipe right, the person who added the song also earns +1.
          </GameNote>
          <p className="muted">Swipe right if you like the song, left if you do not. One swipe per song.</p>

          {tinderError && <p role="alert" className="form-error">{tinderError}</p>}

          {isLoadingSong ? (
            <p className="muted">Loading a song...</p>
          ) : !song ? (
            <p className="muted" data-testid="spookify-empty">
              No songs left to swipe. Add more in Add song to game.
            </p>
          ) : (
            <>
              <div
                className="spookify-card"
                data-testid="spookify-card"
                style={{ transform: `translateX(${drag}px) rotate(${drag / 25}deg)` }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                <Artwork track={song} />
                <strong>{song.title}</strong>
                <small>{song.artist}</small>
                {song.spotify_url && (
                  <a href={song.spotify_url} target="_blank" rel="noreferrer noopener">
                    Open in Spotify
                  </a>
                )}
              </div>

              <div className="row spookify-swipe-actions">
                <button type="button" disabled={isSwiping} onClick={() => void handleSwipe('left')}>
                  👎 Nope
                </button>
                <button type="button" disabled={isSwiping} onClick={() => void handleSwipe('right')}>
                  👍 Like
                </button>
              </div>
            </>
          )}
          <Leaderboard userId={currentUserId} column="tinder_score" label="Spookify Tinder" refreshKey={scoreVersion} />
        </div>
      ) : (
        <div className="card stack spookify-fmk">
          <GameNote gameId="fmk">
            Every round you play earns +1. The person who added the song you sing earns +1, and the one you listen to
            earns +0.5. Your own songs can show up too, but they pay only half.
          </GameNote>
          <p className="muted">
            Give each song a different choice: sing, listen or delete. Sing and listen move a song up a tier; delete
            removes it from your rounds. You keep this trio until you lock it in{skips && skips.skips_total > 0 ? ' or skip it' : ''}.
          </p>
          <p className="row spookify-fmk-tiers" data-testid="spookify-fmk-tiers">
            <span className="pill">Current tier {fmkSongs[0]?.tier ?? '–'}</span>
            <span className="pill">Max tier {maxTier}</span>
          </p>

          {fmkError && <p role="alert" className="form-error">{fmkError}</p>}

          {isLoadingFmk ? (
            <p className="muted">Loading songs...</p>
          ) : fmkSongs.length < FMK_CHOICES.length ? (
            <p className="muted" data-testid="spookify-fmk-empty">
              No new matchups. Add more songs in{' '}
              <button type="button" className="link-button" onClick={() => onPanelChange('source')}>
                Add song to game
              </button>
              .
            </p>
          ) : (
            <>
              <ul className="spookify-results">
                {fmkSongs.map((fmkSong) => (
                  <li key={fmkSong.id} className="spookify-result spookify-fmk-song" data-testid="spookify-fmk-song">
                    <Artwork track={fmkSong} />
                    <span className="spookify-result-text">
                      <strong>{fmkSong.title}</strong>
                      <small>
                        {fmkSong.artist}
                        {fmkSong.added_by === currentUserId && ' · 🎃 your song, pays half'}
                      </small>
                    </span>
                    <span className="row spookify-fmk-choices" role="group" aria-label={`Choice for ${fmkSong.title}`}>
                      {FMK_CHOICES.map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          className={assignment[fmkSong.id] === choice ? 'is-selected' : undefined}
                          aria-pressed={assignment[fmkSong.id] === choice}
                          disabled={isSubmittingFmk}
                          onClick={() => handleChoose(fmkSong.id, choice)}
                        >
                          {FMK_LABELS[choice]}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={isSubmittingFmk || !fmkAssignmentComplete(fmkSongs.map((fmkSong) => fmkSong.id), assignment)}
                onClick={() => void handleSubmitFmk()}
              >
                {isSubmittingFmk ? 'Saving...' : 'Lock in'}
              </button>
              {skips && (
                <p className="row">
                  <button
                    type="button"
                    data-testid="skip-fmk"
                    disabled={isSkipping || isSubmittingFmk || skips.skips_left <= 0}
                    onClick={() => void handleSkipFmk()}
                  >
                    {isSkipping ? 'Skipping...' : '⏭️ Skip trio'}
                  </button>
                  <span className="muted" data-testid="fmk-skips-left">{describeFmkSkips(skips)}</span>
                </p>
              )}
            </>
          )}
          <Leaderboard userId={currentUserId} column="fmk_score" label="Spookify FMK" refreshKey={scoreVersion} />
        </div>
      )}
    </section>
  )
}
