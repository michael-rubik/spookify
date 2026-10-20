import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { isDevLoginEnabled } from '../utils/dev-login'
import { supabase } from '../utils/supabase/supabase-client'
import {
  DEFAULT_KARAOKE_DURATION_SECONDS,
  getKaraokeQueueView,
  getNormalizedSongSchedule,
  rescheduleKaraokeQueue,
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

const DEV_KARAOKE_QUEUE_KEY = 'spookify-dev-karaoke-queue'

const readDevQueue = (): KaraokeQueueEntry[] => {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const storedValue = window.localStorage.getItem(DEV_KARAOKE_QUEUE_KEY)
    if (!storedValue) {
      return []
    }

    const parsed = JSON.parse(storedValue) as KaraokeQueueEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const writeDevQueue = (songs: KaraokeQueueEntry[]) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(DEV_KARAOKE_QUEUE_KEY, JSON.stringify(songs))
}

const readScheduledDevQueue = () => getNormalizedSongSchedule(readDevQueue(), new Date())

const saveDevQueue = (songs: KaraokeQueueEntry[]) => {
  const scheduled = rescheduleKaraokeQueue(songs, new Date())
  writeDevQueue(scheduled)
  return scheduled
}

export function Karaoke({ currentUserId, isCurrentUserAdmin }: KaraokeProps) {
  const [queue, setQueue] = useState<KaraokeQueueEntry[]>([])
  const [draft, setDraft] = useState({ title: '', artist: '' })
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [showPastSongs, setShowPastSongs] = useState(false)
  const [now, setNow] = useState(new Date())

  const updateDevQueue = (songs: KaraokeQueueEntry[]) => {
    setQueue(saveDevQueue(songs))
    setNow(new Date())
  }

  const loadQueue = useCallback(async () => {
    setIsLoading(true)
    setNow(new Date())

    if (isDevLoginEnabled()) {
      const scheduledSongs = readScheduledDevQueue()
      writeDevQueue(scheduledSongs)
      setQueue(scheduledSongs)
      setIsLoading(false)
      setError('')
      return
    }

    const { data, error: queueError } = await supabase
      .from('karaoke_queue')
      .select('*')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

    if (queueError) {
      console.error('Failed to load karaoke queue:', queueError)
      setError('Could not load the karaoke queue right now.')
      setQueue([])
      setIsLoading(false)
      return
    }

    setQueue((data ?? []) as KaraokeQueueEntry[])
    setIsLoading(false)
    setError('')
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadQueue()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadQueue])

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

    if (isDevLoginEnabled()) {
      const existingSongs = readScheduledDevQueue()
      const nextSong: KaraokeQueueEntry = {
        id: `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: nextTitle,
        artist: nextArtist || 'Unknown artist',
        queued_by: currentUserId,
        created_at: new Date().toISOString(),
        duration_seconds: DEFAULT_KARAOKE_DURATION_SECONDS,
        status: 'queued',
        started_at: null,
        ends_at: null,
        skipped_by: null,
        updated_at: new Date().toISOString(),
      }

      const nextQueue = [...existingSongs, nextSong]
      updateDevQueue(nextQueue)
      setDraft({ title: '', artist: '' })
      setStatusMessage('Song added to the karaoke queue.')
      setIsSubmitting(false)
      setError('')
      return
    }

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

    if (isDevLoginEnabled()) {
      const nextQueue: KaraokeQueueEntry[] = readScheduledDevQueue().map((song) =>
        song.id === songId
          ? {
              ...song,
              status: 'skipped',
              skipped_by: currentUserId,
              updated_at: new Date().toISOString(),
            }
          : song,
      )

      updateDevQueue(nextQueue)
      setStatusMessage('Song skipped.')
      setError('')
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

  const handleRemoveSong = async (songId: string) => {
    const song = queue.find((entry) => entry.id === songId)
    if (!song || (!isCurrentUserAdmin && song.queued_by !== currentUserId)) {
      setError('You can only remove your own songs.')
      return
    }

    setError('')
    setStatusMessage('')
    if (isDevLoginEnabled()) {
      const nextQueue = readScheduledDevQueue().filter((entry) => entry.id !== songId)
      updateDevQueue(nextQueue)
      setStatusMessage('Song removed from the queue.')
      setError('')
      return
    }

    const { error: deleteError } = await supabase
      .from('karaoke_queue').delete().eq('id', songId).select('id').single()

    if (deleteError) {
      console.error('Failed to remove karaoke song:', deleteError)
      setError('The song could not be removed right now.')
      return
    }

    setStatusMessage('Song removed from the queue.')
    await loadQueue()
  }

  const handleUpdateDuration = async (songId: string, nextDurationSeconds: number) => {
    if (!isCurrentUserAdmin) {
      return
    }

    const safeDuration = Math.max(1, Math.round(nextDurationSeconds))

    if (isDevLoginEnabled()) {
      const nextQueue: KaraokeQueueEntry[] = readScheduledDevQueue().map((song) =>
        song.id === songId
          ? {
              ...song,
              duration_seconds: safeDuration,
              updated_at: new Date().toISOString(),
            }
          : song,
      )

      updateDevQueue(nextQueue)
      setStatusMessage('Song length updated.')
      setError('')
      return
    }

    const { error: updateError } = await supabase
      .from('karaoke_queue')
      .update({
        duration_seconds: safeDuration,
        updated_at: new Date().toISOString(),
      })
      .eq('id', songId)

    if (updateError) {
      console.error('Failed to update karaoke song duration:', updateError)
      setError('The song length could not be updated right now.')
      return
    }

    setStatusMessage('Song length updated.')
    await loadQueue()
  }

  const { activeQueue, pastSongs } = getKaraokeQueueView(queue, now)

  return (
    <section style={{ maxWidth: '900px', margin: '0 auto', display: 'grid', gap: '1.25rem' }}>
      <div style={{ border: '1px solid #2a2a2a', borderRadius: '12px', padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Karaoke Queue</h2>
          <button type="button" onClick={() => void loadQueue()} disabled={isLoading}>
            {isLoading ? 'Refreshing...' : 'Refresh queue'}
          </button>
        </div>

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
        ) : activeQueue.length === 0 ? (
          <p>No songs queued yet. Add the first performance.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.9rem' }}>
            {activeQueue.map((song, index) => {
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
                        {isCurrentlyPlaying ? 'Now playing' : `Up next #${index + 1}`}
                      </div>
                      <strong style={{ fontSize: '1.15rem' }}>{song.title}</strong>
                      <div style={{ color: '#d8d8d8' }}>{song.artist || 'Unknown artist'}</div>
                    </div>

                    {(isCurrentUserAdmin || song.queued_by === currentUserId) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {isCurrentUserAdmin && (
                          <button type="button" onClick={() => void handleSkipSong(song.id)}>
                            Skip
                          </button>
                        )}
                        <button type="button" onClick={() => void handleRemoveSong(song.id)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.35rem', color: '#d9d9d9' }}>
                    <div>Should play at: {formatTime(playTime)}</div>
                    <div>Ends at: {formatTime(endTime)}</div>
                    <div>
                      {isCurrentlyPlaying
                        ? `Currently running • ${formatDuration(timeRemainingMs / 1000)} remaining`
                        : `Starts in ${formatDuration(startInMs / 1000)}`}
                    </div>
                    {isCurrentUserAdmin && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
                        <label htmlFor={`duration-${song.id}`} style={{ fontWeight: 600 }}>
                          Length
                        </label>
                        <input
                          id={`duration-${song.id}`}
                          type="number"
                          min={1}
                          step={1}
                          defaultValue={song.duration_seconds}
                          style={{ width: '5rem', padding: '0.4rem 0.5rem' }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const input = document.getElementById(`duration-${song.id}`) as HTMLInputElement | null
                            if (!input) {
                              return
                            }

                            const nextValue = Number(input.value)
                            if (Number.isFinite(nextValue)) {
                              void handleUpdateDuration(song.id, nextValue)
                            }
                          }}
                        >
                          Save length
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {pastSongs.length > 0 && (
          <div style={{ marginTop: '1.25rem', borderTop: '1px solid #2a2a2a', paddingTop: '1rem' }}>
            <button type="button" onClick={() => setShowPastSongs((current) => !current)}>
              {showPastSongs ? 'Hide' : 'Show'} past songs ({pastSongs.length})
            </button>

            {showPastSongs && (
              <ul style={{ listStyle: 'none', padding: '0.75rem 0 0', margin: 0, display: 'grid', gap: '0.7rem' }}>
                {pastSongs.map((song) => (
                  <li key={song.id} style={{ border: '1px solid #2a2a2a', borderRadius: '12px', padding: '0.7rem 0.9rem' }}>
                    <strong>{song.title}</strong>
                    <div style={{ color: '#d8d8d8' }}>{song.artist || 'Unknown artist'}</div>
                    <div style={{ color: '#a3a3a3', fontSize: '0.78rem' }}>
                      {song.normalizedStatus === 'completed' ? 'Completed' : 'Skipped'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
