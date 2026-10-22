import { useEffect, useRef, useState } from 'react'
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import {
  describeSpookifyError,
  formatSpookifyScore,
  markAlreadyAdded,
  SONG_ALREADY_ADDED_MESSAGE,
  type SearchResult,
  type SpookifySong,
  type SpookifyTrack,
  type SwipeDirection,
} from '../utils/spookify'
import './spookify.css'

type SpookifyProps = {
  currentUserId: string
}

const SWIPE_THRESHOLD = 80

function Artwork({ track }: { track: SpookifyTrack }) {
  return track.album_art_url ? (
    <img src={track.album_art_url} alt="" className="spookify-art" />
  ) : (
    <span className="spookify-art spookify-art--fallback" aria-hidden="true">
      🎵
    </span>
  )
}

export function Spookify({ currentUserId }: SpookifyProps) {
  const [panel, setPanel] = useState<'source' | 'tinder'>('source')
  const [score, setScore] = useState<number | string | null>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState('')
  const [sourceMessage, setSourceMessage] = useState('')
  const [pooledTrackIds, setPooledTrackIds] = useState<string[]>([])

  const [song, setSong] = useState<SpookifySong | null>(null)
  const [isLoadingSong, setIsLoadingSong] = useState(true)
  const [tinderError, setTinderError] = useState('')
  const [isSwiping, setIsSwiping] = useState(false)
  const [drag, setDrag] = useState(0)

  const reloadRef = useRef<() => Promise<void>>(async () => {})
  const dragStart = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoadingSong(true)
      const [pool, next, profile] = await Promise.all([
        supabase.from('spookify_songs').select('spotify_track_id'),
        supabase.rpc('next_spookify_song'),
        supabase.from('users').select('spookify_score').eq('id', currentUserId).maybeSingle(),
      ])
      if (cancelled) return

      setPooledTrackIds((pool.data ?? []).map((row) => row.spotify_track_id as string))
      setScore(profile.data?.spookify_score ?? 0)
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

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) {
      setSourceError('Type a song title or an artist.')
      return
    }

    setIsSearching(true)
    setSourceError('')
    setSourceMessage('')
    const { data, error } = await supabase.functions.invoke('spookify-search', { body: { query: trimmed } })
    setIsSearching(false)

    if (error) {
      console.error('Spotify search failed:', error)
      setResults([])
      setSourceError('Spotify search is unavailable right now.')
      return
    }

    const tracks = (data as { tracks?: SpookifyTrack[] } | null)?.tracks ?? []
    setResults(markAlreadyAdded(tracks, pooledTrackIds))
    if (tracks.length === 0) setSourceMessage('No songs matched that search.')
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
      return
    }

    markPooled(track.spotify_track_id)
    setSourceMessage(`Added "${track.title}" to the pool. +0.5 Spookify score.`)
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
    await reloadRef.current()
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
          onClick={() => setPanel('source')}
        >
          Source
        </button>
        <button
          type="button"
          className={`nav-button${panel === 'tinder' ? ' is-active' : ''}`}
          onClick={() => setPanel('tinder')}
        >
          Tinder
        </button>
      </div>

      {panel === 'source' ? (
        <div className="card stack">
          <p className="muted">Search Spotify and add songs to the pool. Every added song is worth +0.5.</p>

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
                  disabled={alreadyAdded || addingTrackId === track.spotify_track_id}
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
        </div>
      ) : (
        <div className="card stack spookify-tinder">
          <p className="muted">Swipe right if you like the song (+1), left if you do not (+0.5). One swipe per song.</p>

          {tinderError && <p role="alert" className="form-error">{tinderError}</p>}

          {isLoadingSong ? (
            <p className="muted">Loading a song...</p>
          ) : !song ? (
            <p className="muted" data-testid="spookify-empty">
              No songs left to swipe. Add more in Source.
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
        </div>
      )}
    </section>
  )
}
