import { describe, it, expect } from 'vitest'
import {
  DEFAULT_KARAOKE_DURATION_SECONDS,
  getKaraokeQueueView,
  getNormalizedSongSchedule,
} from './karaoke'

describe('getNormalizedSongSchedule', () => {
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

  it('marks expired songs as completed and advances them to the next queue slot', () => {
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
    expect(scheduled[1].shouldPlayAt).toBe('2026-01-01T12:06:00.000Z')
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

  it('hides completed and skipped songs from the live queue while keeping them in the past-song archive', () => {
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

    expect(activeQueue.map((song) => song.id)).toEqual(['song-2'])
    expect(pastSongs.map((song) => song.id)).toEqual(['song-3', 'song-1'])
    expect(pastSongs.every((song) => song.normalizedStatus === 'completed' || song.normalizedStatus === 'skipped')).toBe(true)
  })
})
