export const DEFAULT_KARAOKE_DURATION_SECONDS = 300

export type KaraokeSongStatus = 'queued' | 'playing' | 'completed' | 'skipped'

export type KaraokeQueueEntry = {
  id: string
  title: string
  artist: string | null
  queued_by: string
  created_at: string
  duration_seconds: number | null
  status: KaraokeSongStatus
  started_at: string | null
  ends_at: string | null
  skipped_by: string | null
  updated_at?: string | null
}

export type NormalizedKaraokeQueueEntry = KaraokeQueueEntry & {
  duration_seconds: number
  normalizedStatus: KaraokeSongStatus
  shouldPlayAt: string
  shouldEndAt: string
  isExpired: boolean
}

export type KaraokeQueueView = {
  activeQueue: NormalizedKaraokeQueueEntry[]
  pastSongs: NormalizedKaraokeQueueEntry[]
}

export function getNormalizedSongSchedule(
  songs: Partial<KaraokeQueueEntry>[],
  now: Date = new Date(),
): NormalizedKaraokeQueueEntry[] {
  const orderedSongs = [...songs].sort(
    (left, right) => new Date(left.created_at ?? 0).getTime() - new Date(right.created_at ?? 0).getTime(),
  )

  let scheduleCursor: number | undefined

  return orderedSongs.map((song) => {
    const durationSeconds = Math.max(
      1,
      Number(song.duration_seconds ?? DEFAULT_KARAOKE_DURATION_SECONDS),
    )

    const rawStatus = (song.status ?? 'queued') as KaraokeSongStatus
    const isArchived = rawStatus === 'completed' || rawStatus === 'skipped'
    const createdAt = new Date(song.created_at ?? now).getTime()
    const shouldPlayAt = song.started_at
      ? new Date(song.started_at)
      : new Date(Math.max(scheduleCursor ?? createdAt, createdAt))
    const shouldEndAt = isArchived && song.ends_at
      ? new Date(song.ends_at)
      : new Date(shouldPlayAt.getTime() + durationSeconds * 1000)
    const isExpired = !isArchived && shouldEndAt.getTime() <= now.getTime()

    if (!isArchived) {
      scheduleCursor = shouldEndAt.getTime()
    }

    const normalizedStatus: KaraokeSongStatus =
      isArchived
        ? rawStatus
        : isExpired
          ? 'completed'
          : shouldPlayAt.getTime() <= now.getTime()
            ? 'playing'
            : 'queued'

    return {
      ...(song as KaraokeQueueEntry),
      status: normalizedStatus,
      started_at: shouldPlayAt.toISOString(),
      ends_at: shouldEndAt.toISOString(),
      duration_seconds: durationSeconds,
      normalizedStatus,
      shouldPlayAt: shouldPlayAt.toISOString(),
      shouldEndAt: shouldEndAt.toISOString(),
      isExpired,
    }
  })
}

// Call after a mutation, with statuses normalized before changing the queue.
export function rescheduleKaraokeQueue(
  songs: KaraokeQueueEntry[],
  now: Date = new Date(),
): KaraokeQueueEntry[] {
  let cursor = now.getTime()
  return [...songs].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  ).map((song) => {
    if (song.status === 'completed' || song.status === 'skipped') {
      return song
    }

    const start = song.status === 'playing' && song.started_at
      ? new Date(song.started_at).getTime()
      : cursor
    const end = start + (song.duration_seconds ?? DEFAULT_KARAOKE_DURATION_SECONDS) * 1000
    cursor = Math.max(now.getTime(), end)
    return {
      ...song,
      status: end <= now.getTime() ? 'completed' : start <= now.getTime() ? 'playing' : 'queued',
      started_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
    }
  })
}

export function getKaraokeQueueView(
  songs: Partial<KaraokeQueueEntry>[],
  now: Date = new Date(),
): KaraokeQueueView {
  const allSongs = getNormalizedSongSchedule(songs, now)

  const activeQueue = allSongs.filter((song) => {
    const isArchivedStatus = song.normalizedStatus === 'completed' || song.normalizedStatus === 'skipped'
    return !isArchivedStatus
  })

  const pastSongs = allSongs.filter((song) => {
    const isArchivedStatus = song.normalizedStatus === 'completed' || song.normalizedStatus === 'skipped'
    return isArchivedStatus
  })

  return { activeQueue, pastSongs }
}
