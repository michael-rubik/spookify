import { useEffect, useRef, useState } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import { isDevLoginEnabled } from '../utils/dev-login'
import {
  buildSongLeaderboard,
  SONG_LEADERBOARD_LIMIT,
  songSubmitters,
  type LeaderboardSong,
} from '../utils/song-leaderboard'
import { formatSpookifyScore } from '../utils/spookify'
import { usePolling } from '../utils/use-polling'
import './leaderboard.css'

type SongRecord = {
  id: string
  title: string
  artist: string
  album_art_url: string | null
  points: number | string
  added_by: string
  submitter: { name: string } | { name: string }[] | null
}

const submitterName = (submitter: SongRecord['submitter']): string =>
  (Array.isArray(submitter) ? submitter[0]?.name : submitter?.name) ?? 'Unknown'

export const SongLeaderboard = ({ refreshKey }: { refreshKey?: number }) => {
  const [songs, setSongs] = useState<LeaderboardSong[]>([])
  const [error, setError] = useState('')
  const [submitterId, setSubmitterId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const reload = usePolling(
    async (isCancelled) => {
      const { data, error: loadError } = await supabase
        .from('spookify_songs')
        .select('id, title, artist, album_art_url, points, added_by, submitter:users!added_by(name)')
      if (isCancelled()) return

      if (loadError) {
        console.error('Failed to load song leaderboard:', loadError)
        setError('Could not load the song leaderboard.')
        return
      }

      setError('')
      const records = (data ?? []) as unknown as SongRecord[]
      setSongs(
        records.map((record) => ({
          id: record.id,
          title: record.title,
          artist: record.artist,
          album_art_url: record.album_art_url,
          points: Number(record.points) || 0,
          added_by: record.added_by,
          submitter_name: submitterName(record.submitter),
        })),
      )
    },
    10000,
    !isDevLoginEnabled(),
  )

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    void reload()
  }, [refreshKey, reload])

  if (isDevLoginEnabled()) return null

  const submitters = songSubmitters(songs)
  const activeFilter = submitters.some((submitter) => submitter.id === submitterId) ? submitterId : null
  const all = buildSongLeaderboard(songs, activeFilter, Number.POSITIVE_INFINITY)
  const rows = expanded ? all : all.slice(0, SONG_LEADERBOARD_LIMIT)

  return (
    <section className="leaderboard" aria-label="Song leaderboard">
      <div className="row row--between">
        <h3>Song leaderboard</h3>
        <label className="sr-only" htmlFor="song-leaderboard-user">
          Show songs of
        </label>
        <select
          id="song-leaderboard-user"
          value={activeFilter ?? ''}
          onChange={(event) => setSubmitterId(event.target.value || null)}
        >
          <option value="">All users</option>
          {submitters.map((submitter) => (
            <option key={submitter.id} value={submitter.id}>
              {submitter.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      {rows.length === 0 && !error && <p className="muted">No songs yet.</p>}
      <ol className="leaderboard-rows">
        {rows.map((row) => (
          <li key={row.id} className="leaderboard-row" data-testid="song-leaderboard-row">
            <span className="leaderboard-fill" style={{ width: `${Math.round(row.fraction * 100)}%` }} />
            <span className="leaderboard-content">
              <span className="leaderboard-rank">{row.rank}</span>
              <span className="leaderboard-text">
                <strong>{row.title}</strong>
                <small>{row.artist} · added by {row.submitter_name}</small>
              </span>
              <span className="leaderboard-count">{formatSpookifyScore(row.points)}</span>
            </span>
          </li>
        ))}
      </ol>
      {all.length > SONG_LEADERBOARD_LIMIT && (
        <button type="button" className="link-button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Show top 10' : `Show all (${all.length})`}
        </button>
      )}
    </section>
  )
}
