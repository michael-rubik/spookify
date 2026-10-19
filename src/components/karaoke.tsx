import { type FormEvent, useEffect, useState } from 'react'
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

  const loadQueue = async () => {
    setIsLoading(true)

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

  useEffect(() => {
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
    await loadQueue()
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
    await loadQueue()
  }

  const scheduledQueue = getNormalizedSongSchedule(queue, now)

  return (
    <section style={{ maxWidth: '900px', margin: '0 auto', display: 'grid', gap: '1.25rem' }}>
      <div style={{ border: '1px solid #2a2a2a', borderRadius: '12px', padding: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Karaoke Queue</h2>

        <form onSubmit={handleAddSong} style={{ display: 'grid', gap: '0.8rem' }}>
          <label htmlFor="karaoke-title" style={{ fontWeight: 600 }}>
            Song title
          </label>
          <input
            id="karaoke-title"
            type="text"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            placeholder="Enter a song title"
            style={{ padding: '0.6rem 0.75rem' }}
          />

          <label htmlFor="karaoke-artist" style={{ fontWeight: 600 }}>
            Artist
          </label>
          <input
            id="karaoke-artist"
            type="text"
            value={draft.artist}
            onChange={(event) => setDraft((current) => ({ ...current, artist: event.target.value }))}
            placeholder="Optional artist"
            style={{ padding: '0.6rem 0.75rem' }}
          />

          <div style={{ color: '#bdbdbd', fontSize: '0.9rem' }}>
            Default queue duration: {formatDuration(DEFAULT_KARAOKE_DURATION_SECONDS)}
          </div>

          {error && <p role="alert" style={{ margin: 0, color: '#ffb4b4' }}>{error}</p>}
          {statusMessage && <p role="status" style={{ margin: 0, color: '#b7f7c7' }}>{statusMessage}</p>}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Queuing...' : 'Add to karaoke queue'}
          </button>
        </form>
      </div>

      <div style={{ border: '1px solid #2a2a2a', borderRadius: '12px', padding: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Scheduled songs</h3>

        {isLoading ? (
          <p>Loading queue...</p>
        ) : scheduledQueue.length === 0 ? (
          <p>No songs queued yet. Add the first performance.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.9rem' }}>
            {scheduledQueue.map((song, index) => {
              const playTime = new Date(song.shouldPlayAt)
              const endTime = new Date(song.shouldEndAt)
              const startInMs = playTime.getTime() - now.getTime()
              const timeRemainingMs = endTime.getTime() - now.getTime()
              const isCurrentlyPlaying = song.normalizedStatus === 'playing'

              return (
                <li
                  key={song.id}
                  style={{
                    border: '1px solid #2a2a2a',
                    borderRadius: '12px',
                    padding: '0.9rem',
                    background: isCurrentlyPlaying ? '#1d2e22' : '#171717',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: '#a3a3a3', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {index === 0 ? 'Now playing' : song.normalizedStatus === 'completed' ? 'Completed' : song.normalizedStatus === 'skipped' ? 'Skipped' : `Up next #${index + 1}`}
                      </div>
                      <strong style={{ fontSize: '1.15rem' }}>{song.title}</strong>
                      <div style={{ color: '#d8d8d8' }}>{song.artist || 'Unknown artist'}</div>
                    </div>

                    {isCurrentUserAdmin && song.normalizedStatus !== 'completed' && song.normalizedStatus !== 'skipped' && (
                      <button type="button" onClick={() => void handleSkipSong(song.id)}>
                        Skip
                      </button>
                    )}
                  </div>

                  <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.35rem', color: '#d9d9d9' }}>
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
