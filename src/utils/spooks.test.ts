import { describe, expect, it } from 'vitest'
import { normalizeSpookRow, sortSpooksByNewest } from './spooks'

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

describe('normalizeSpookRow', () => {
  const baseRow = {
    id: 'spook-1',
    user_id: 'creator-1',
    caption: 'Boo!',
    image_url: 'https://example.test/boo.png',
    created_at: '2026-10-19T10:00:00.000Z',
  }

  it('flattens join rows into tagged_user_ids', () => {
    const normalized = normalizeSpookRow({
      ...baseRow,
      spook_tagged_users: [{ user_id: 'user-a' }, { user_id: 'user-b' }],
    })

    expect(normalized.tagged_user_ids).toEqual(['user-a', 'user-b'])
    expect(normalized).not.toHaveProperty('spook_tagged_users')
  })

  it('returns an empty array when no users are tagged', () => {
    const normalized = normalizeSpookRow({ ...baseRow, spook_tagged_users: null })

    expect(normalized.tagged_user_ids).toEqual([])
  })

  it('dedupes repeated tag rows', () => {
    const normalized = normalizeSpookRow({
      ...baseRow,
      spook_tagged_users: [{ user_id: 'user-a' }, { user_id: 'user-a' }],
    })

    expect(normalized.tagged_user_ids).toEqual(['user-a'])
  })
})
