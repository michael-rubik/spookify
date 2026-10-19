import { type FormEvent, useEffect, useRef, useState } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import {
  DEFAULT_KARAOKE_DURATION_SECONDS,
  getNormalizedSongSchedule,
  type KaraokeQueueEntry,
} from '../utils/karaoke'

type KaraokeProps = {
  currentUserId: string
  isCurrentUserAdmin: boolean
}

const formatTime = (date: Date) =>
  date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

const formatDuration = (seconds: number) => {
  const totalSeconds = Math.max(0, Math.ceil(seconds))
  const minutes = Math.floor(totalSeconds / 60)
  const remainder = totalSeconds % 60

  if (minutes === 0) {
    return `${remainder}s`
  }

  return `${minutes}m ${remainder}s`
}

export function Karaoke({ currentUserId, isCurrentUserAdmin }: KaraokeProps) {
  const [queue, setQueue] = useState<KaraokeQueueEntry[]>([])
  const [draft, setDraft] = useState({ title: '', artist: '' })
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [now, setNow] = useState(new Date())
  const loadQueueRef = useRef<() => Promise<void>>(async () => {})

  const syncQueueState = async (rawSongs: KaraokeQueueEntry[]) => {
    const scheduledSongs = getNormalizedSongSchedule(rawSongs, new Date())

    const updates = scheduledSongs.filter((song) => {
      const rawSong = rawSongs.find((entry) => entry.id === song.id)

      if (!rawSong) {
        return false
      }

      return (
        rawSong.status !== song.normalizedStatus ||
        (rawSong.started_at ?? '') !== song.shouldPlayAt ||
        (rawSong.ends_at ?? '') !== song.shouldEndAt
      )
    })

    if (updates.length === 0) {
      return scheduledSongs
    }

    await Promise.all(
      updates.map(async (song) => {
        const { error: updateError } = await supabase
          .from('karaoke_queue')
          .update({
            status: song.normalizedStatus,
            started_at: song.shouldPlayAt,
            ends_at: song.shouldEndAt,
            updated_at: new Date().toISOString(),
          })
          .eq('id', song.id)

        if (updateError) {
          console.error('Failed to sync karaoke queue state:', updateError)
        }
      }),
    )

    return scheduledSongs
  }

  useEffect(() => {
    const loadQueue = async () => {
      const { data, error: queueError } = await supabase
        .from('karaoke_queue')
        .select('*')
        .order('created_at', { ascending: true })

      if (queueError) {
        console.error('Failed to load karaoke queue:', queueError)
        setError('Could not load the karaoke queue right now.')
        setQueue([])
        setIsLoading(false)
        return
      }

      const scheduledSongs = await syncQueueState((data ?? []) as KaraokeQueueEntry[])
      setQueue(scheduledSongs)
      setIsLoading(false)
      setError('')
    }

    loadQueueRef.current = loadQueue

    void loadQueue()

    const syncTicker = window.setInterval(() => {
      setNow(new Date())
      void loadQueue()
    }, 5000)

    return () => {
      window.clearInterval(syncTicker)
    }
  }, [])

  const handleAddSong = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextTitle = draft.title.trim()
    const nextArtist = draft.artist.trim()

    if (!nextTitle) {
      setError('Please add a song title before queueing it.')
      return
    }

    setIsSubmitting(true)
    setError('')
    setStatusMessage('')

    const { error: insertError } = await supabase.from('karaoke_queue').insert({
      title: nextTitle,
      artist: nextArtist || 'Unknown artist',
      queued_by: currentUserId,
      duration_seconds: DEFAULT_KARAOKE_DURATION_SECONDS,
      status: 'queued',
      started_at: null,
      ends_at: null,
      skipped_by: null,
    })

    setIsSubmitting(false)

    if (insertError) {
      console.error('Failed to queue karaoke song:', insertError)
      setError('The song could not be queued. Please try again.')
      return
    }

    setDraft({ title: '', artist: '' })
    setStatusMessage('Song added to the karaoke queue.')
    await loadQueueRef.current()
  }

  const handleSkipSong = async (songId: string) => {
    if (!isCurrentUserAdmin) {
      return
    }

    const { error: skipError } = await supabase
      .from('karaoke_queue')
      .update({
        status: 'skipped',
        skipped_by: currentUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', songId)

    if (skipError) {
      console.error('Failed to skip karaoke song:', skipError)
      setError('The song could not be skipped right now.')
      return
    }

    setStatusMessage('Song skipped.')
    await loadQueueRef.current()
  }

  const scheduledQueue = getNormalizedSongSchedule(queue, now)

  return (
    <section className="page-section">
      <div className="card">
        <h2>Karaoke Queue</h2>

        <form onSubmit={handleAddSong} className="stack">
          <label htmlFor="karaoke-title">
            Song title
          </label>
          <input
            id="karaoke-title"
            type="text"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            placeholder="Enter a song title"
          />

          <label htmlFor="karaoke-artist">
            Artist
          </label>
          <input
            id="karaoke-artist"
            type="text"
            value={draft.artist}
            onChange={(event) => setDraft((current) => ({ ...current, artist: event.target.value }))}
            placeholder="Optional artist"
          />

          <div className="muted" style={{ fontSize: '0.9rem' }}>
            Default queue duration: {formatDuration(DEFAULT_KARAOKE_DURATION_SECONDS)}
          </div>

          {error && <p role="alert" className="form-error">{error}</p>}
          {statusMessage && <p role="status" className="form-success">{statusMessage}</p>}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Queuing...' : 'Add to karaoke queue'}
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Scheduled songs</h3>

        {isLoading ? (
          <p>Loading queue...</p>
        ) : scheduledQueue.length === 0 ? (
          <p>No songs queued yet. Add the first performance.</p>
        ) : (
          <ul className="list" style={{ gap: '0.9rem' }}>
            {scheduledQueue.map((song, index) => {
              const playTime = new Date(song.shouldPlayAt)
              const endTime = new Date(song.shouldEndAt)
              const startInMs = playTime.getTime() - now.getTime()
              const timeRemainingMs = endTime.getTime() - now.getTime()
              const isCurrentlyPlaying = song.normalizedStatus === 'playing'

              return (
                <li
                  key={song.id}
                  className={`card karaoke-entry${isCurrentlyPlaying ? ' karaoke-entry--playing' : ''}`}
                >
                  <div className="row row--between">
                    <div>
                      <div className="karaoke-entry-status">
                        {index === 0 ? 'Now playing' : song.normalizedStatus === 'completed' ? 'Completed' : song.normalizedStatus === 'skipped' ? 'Skipped' : `Up next #${index + 1}`}
                      </div>
                      <strong className="karaoke-entry-title">{song.title}</strong>
                      <div>{song.artist || 'Unknown artist'}</div>
                    </div>

                    {isCurrentUserAdmin && song.normalizedStatus !== 'completed' && song.normalizedStatus !== 'skipped' && (
                      <button type="button" onClick={() => void handleSkipSong(song.id)}>
                        Skip
                      </button>
                    )}
                  </div>

                  <div className="karaoke-entry-meta">
                    <div>Should play at: {formatTime(playTime)}</div>
                    <div>Ends at: {formatTime(endTime)}</div>
                    <div>
                      {isCurrentlyPlaying
                        ? `Currently running • ${formatDuration(timeRemainingMs / 1000)} remaining`
                        : song.normalizedStatus === 'completed' || song.normalizedStatus === 'skipped'
                          ? 'Queue status: completed'
                          : `Starts in ${formatDuration(startInMs / 1000)}`}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
