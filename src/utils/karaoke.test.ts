import { describe, it, expect } from 'vitest'
import {
  DEFAULT_KARAOKE_DURATION_SECONDS,
  getKaraokeQueueView,
  getNormalizedSongSchedule,
  rescheduleKaraokeQueue,
} from './karaoke'

describe('getNormalizedSongSchedule', () => {
  it('starts a new song now when only archived songs remain', () => {
    const now = new Date('2026-01-01T12:00:00.000Z')
    const scheduled = getNormalizedSongSchedule([
      {
        id: 'archived',
        created_at: '2026-01-01T10:00:00.000Z',
        status: 'completed',
        duration_seconds: 300,
      },
      {
        id: 'new',
        created_at: now.toISOString(),
        status: 'queued',
        duration_seconds: 300,
      },
    ], now)

    expect(scheduled[1].shouldPlayAt).toBe(now.toISOString())
    expect(scheduled[1].normalizedStatus).toBe('playing')
  })

  it('preserves server queue order for timestamps within the same millisecond', () => {
    const scheduled = getNormalizedSongSchedule([
      { id: 'z', created_at: '2026-01-01T12:00:00.000100Z' },
      { id: 'a', created_at: '2026-01-01T12:00:00.000200Z' },
    ], new Date('2026-01-01T12:00:00.000Z'))
    expect(scheduled.map((song) => song.id)).toEqual(['z', 'a'])
  })

  it('keeps songs in queue order and marks the active song as playing', () => {
    const now = new Date('2026-01-01T12:00:00.000Z')

    const scheduled = getNormalizedSongSchedule(
      [
        {
          id: 'song-1',
          title: 'First song',
          artist: 'Tester',
          queued_by: 'user-1',
          created_at: '2026-01-01T11:58:00.000Z',
          duration_seconds: 300,
          status: 'queued',
          started_at: null,
          ends_at: null,
          skipped_by: null,
        },
        {
          id: 'song-2',
          title: 'Second song',
          artist: 'Tester',
          queued_by: 'user-2',
          created_at: '2026-01-01T11:59:00.000Z',
          duration_seconds: 300,
          status: 'queued',
          started_at: null,
          ends_at: null,
          skipped_by: null,
        },
      ],
      now,
    )

    expect(scheduled[0].normalizedStatus).toBe('playing')
    expect(scheduled[1].normalizedStatus).toBe('queued')
    expect(scheduled[0].duration_seconds).toBe(300)
  })

  it('marks expired songs as completed without restarting the next queue slot', () => {
    const now = new Date('2026-01-01T12:06:00.000Z')

    const scheduled = getNormalizedSongSchedule(
      [
        {
          id: 'song-1',
          title: 'First song',
          artist: 'Tester',
          queued_by: 'user-1',
          created_at: '2026-01-01T11:58:00.000Z',
          duration_seconds: 300,
          status: 'queued',
          started_at: null,
          ends_at: null,
          skipped_by: null,
        },
        {
          id: 'song-2',
          title: 'Second song',
          artist: 'Tester',
          queued_by: 'user-2',
          created_at: '2026-01-01T12:00:00.000Z',
          duration_seconds: 300,
          status: 'queued',
          started_at: null,
          ends_at: null,
          skipped_by: null,
        },
      ],
      now,
    )

    expect(scheduled[0].normalizedStatus).toBe('completed')
    expect(scheduled[1].normalizedStatus).toBe('playing')
    expect(scheduled[1].shouldPlayAt).toBe('2026-01-01T12:03:00.000Z')
  })

  it('uses the default 5 minute duration when the queue item does not specify one', () => {
    const now = new Date('2026-01-01T12:00:00.000Z')

    const scheduled = getNormalizedSongSchedule([
      {
        id: 'song-1',
        title: 'Default song',
        artist: 'Tester',
        queued_by: 'user-1',
        created_at: '2026-01-01T11:59:00.000Z',
        duration_seconds: null,
        status: 'queued',
        started_at: null,
        ends_at: null,
        skipped_by: null,
      },
    ], now)

    expect(scheduled[0].duration_seconds).toBe(DEFAULT_KARAOKE_DURATION_SECONDS)
    expect(scheduled[0].shouldEndAt).toBe('2026-01-01T12:04:00.000Z')
  })

  it('starts newly queued songs at the current time and after the active song ends', () => {
    const now = new Date('2026-01-01T12:00:05.000Z')

    const queueAtCurrentTime = getNormalizedSongSchedule(
      [
        {
          id: 'song-new',
          title: 'New song',
          artist: 'Tester',
          queued_by: 'user-2',
          created_at: '2026-01-01T12:00:05.000Z',
          duration_seconds: 300,
          status: 'queued',
          started_at: null,
          ends_at: null,
          skipped_by: null,
        },
      ],
      now,
    )

    expect(queueAtCurrentTime[0].normalizedStatus).toBe('playing')
    expect(queueAtCurrentTime[0].shouldPlayAt).toBe('2026-01-01T12:00:05.000Z')

    const queueAfterCurrentSong = getNormalizedSongSchedule(
      [
        {
          id: 'song-current',
          title: 'Current song',
          artist: 'Tester',
          queued_by: 'user-1',
          created_at: '2026-01-01T11:57:00.000Z',
          duration_seconds: 300,
          status: 'playing',
          started_at: '2026-01-01T11:59:00.000Z',
          ends_at: '2026-01-01T12:04:00.000Z',
          skipped_by: null,
        },
        {
          id: 'song-new',
          title: 'New song',
          artist: 'Tester',
          queued_by: 'user-2',
          created_at: '2026-01-01T12:00:05.000Z',
          duration_seconds: 300,
          status: 'queued',
          started_at: null,
          ends_at: null,
          skipped_by: null,
        },
      ],
      now,
    )

    expect(queueAfterCurrentSong[0].normalizedStatus).toBe('playing')
    expect(queueAfterCurrentSong[0].shouldPlayAt).toBe('2026-01-01T11:59:00.000Z')
    expect(queueAfterCurrentSong[1].normalizedStatus).toBe('queued')
    expect(queueAfterCurrentSong[1].shouldPlayAt).toBe('2026-01-01T12:04:00.000Z')
  })

  it('archives all elapsed songs alongside completed and skipped songs', () => {
    const now = new Date('2026-01-01T12:10:00.000Z')

    const { activeQueue, pastSongs } = getKaraokeQueueView(
      [
        {
          id: 'song-1',
          title: 'First song',
          artist: 'Tester',
          queued_by: 'user-1',
          created_at: '2026-01-01T11:58:00.000Z',
          duration_seconds: 300,
          status: 'completed',
          started_at: null,
          ends_at: null,
          skipped_by: null,
        },
        {
          id: 'song-2',
          title: 'Second song',
          artist: 'Tester',
          queued_by: 'user-2',
          created_at: '2026-01-01T12:00:00.000Z',
          duration_seconds: 300,
          status: 'queued',
          started_at: null,
          ends_at: null,
          skipped_by: null,
        },
        {
          id: 'song-3',
          title: 'Skipped song',
          artist: 'Tester',
          queued_by: 'user-3',
          created_at: '2026-01-01T11:57:00.000Z',
          duration_seconds: 300,
          status: 'skipped',
          started_at: null,
          ends_at: null,
          skipped_by: 'user-4',
        },
      ],
      now,
    )

    expect(activeQueue).toEqual([])
    expect(pastSongs.map((song) => song.id)).toEqual(['song-3', 'song-1', 'song-2'])
    expect(pastSongs.every((song) => song.normalizedStatus === 'completed' || song.normalizedStatus === 'skipped')).toBe(true)
  })

  it('preserves an active song and appends multiple additions after every waiting song', () => {
    const now = new Date('2026-01-01T12:01:00.000Z')
    const queue = getNormalizedSongSchedule([
      { id: 'history', created_at: '2026-01-01T10:00:00.000Z', status: 'skipped' },
      { id: 'playing', created_at: '2026-01-01T12:00:00.000Z' },
      { id: 'waiting', created_at: '2026-01-01T12:00:01.000Z' },
    ], now)
    const newSong = {
      ...queue[2],
      id: 'new',
      created_at: now.toISOString(),
      started_at: null,
      ends_at: null,
    }
    const scheduled = rescheduleKaraokeQueue([...queue, newSong], now)
    expect(scheduled[1].started_at).toBe('2026-01-01T12:00:00.000Z')
    expect(scheduled[2].started_at).toBe('2026-01-01T12:05:00.000Z')
    expect(scheduled[3].started_at).toBe('2026-01-01T12:10:00.000Z')
    expect(getKaraokeQueueView(scheduled, new Date('2026-01-01T12:06:00.000Z'))
      .activeQueue.map((song) => [song.id, song.normalizedStatus]))
      .toEqual([['waiting', 'playing'], ['new', 'queued']])
  })

  it('moves waiting songs ahead on removal without restarting the current song', () => {
    const now = new Date('2026-01-01T12:01:00.000Z')
    const queue = getNormalizedSongSchedule([
      { id: 'playing', created_at: '2026-01-01T12:00:00.000Z' },
      { id: 'remove', created_at: '2026-01-01T12:00:01.000Z' },
      { id: 'last', created_at: '2026-01-01T12:00:02.000Z' },
    ], now).map((song) => ({ ...song, started_at: song.shouldPlayAt, ends_at: song.shouldEndAt }))

    const withoutWaiting = rescheduleKaraokeQueue(queue.filter((song) => song.id !== 'remove'), now)
    expect(withoutWaiting[0].started_at).toBe(queue[0].started_at)
    expect(withoutWaiting[1].started_at).toBe(queue[0].ends_at)

    const withoutPlaying = rescheduleKaraokeQueue(queue.filter((song) => song.id !== 'playing'), now)
    expect(withoutPlaying[0].started_at).toBe(now.toISOString())
    expect(withoutPlaying[0].status).toBe('playing')
    expect(withoutPlaying[1].started_at).toBe(withoutPlaying[0].ends_at)
  })
})
