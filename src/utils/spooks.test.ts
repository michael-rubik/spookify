import { describe, expect, it } from 'vitest'
import { sortSpooksByNewest } from './spooks'

describe('sortSpooksByNewest', () => {
  it('orders spooks from newest to oldest', () => {
    const spooks = [
      { id: '1', created_at: '2026-10-10T10:00:00.000Z' },
      { id: '2', created_at: '2026-10-11T12:00:00.000Z' },
      { id: '3', created_at: '2026-10-11T08:00:00.000Z' },
    ]

    const sorted = sortSpooksByNewest(spooks)

    expect(sorted.map((spook) => spook.id)).toEqual(['2', '3', '1'])
  })
})
