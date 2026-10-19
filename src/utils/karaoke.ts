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

  const firstSongStart = orderedSongs[0]?.created_at ? new Date(orderedSongs[0].created_at) : new Date(now)
  let scheduleCursor = new Date(firstSongStart)
  let hasActiveSong = false

  return orderedSongs.map((song) => {
    const durationSeconds = Math.max(
      1,
      Number(song.duration_seconds ?? DEFAULT_KARAOKE_DURATION_SECONDS),
    )

    const shouldPlayAt = new Date(scheduleCursor)
    const shouldEndAt = new Date(shouldPlayAt.getTime() + durationSeconds * 1000)
    const rawStatus = (song.status ?? 'queued') as KaraokeSongStatus
    const isExpired =
      rawStatus !== 'completed' &&
      rawStatus !== 'skipped' &&
      shouldEndAt.getTime() <= now.getTime()

    if (isExpired) {
      scheduleCursor = new Date(now)
    } else {
      scheduleCursor = shouldEndAt
    }

    const isCurrentSong =
      rawStatus !== 'completed' &&
      rawStatus !== 'skipped' &&
      !isExpired &&
      !hasActiveSong

    if (isCurrentSong) {
      hasActiveSong = true
    }

    const normalizedStatus: KaraokeSongStatus =
      rawStatus === 'completed' || rawStatus === 'skipped'
        ? rawStatus
        : isExpired
          ? 'completed'
          : isCurrentSong
            ? 'playing'
            : 'queued'

    return {
      ...(song as KaraokeQueueEntry),
      duration_seconds: durationSeconds,
      normalizedStatus,
      shouldPlayAt: shouldPlayAt.toISOString(),
      shouldEndAt: shouldEndAt.toISOString(),
      isExpired,
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
