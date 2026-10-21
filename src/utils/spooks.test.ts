import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  getSpookPermissions,
  getSpookStoragePath,
  normalizeSpookRow,
  sortSpooksByNewest,
} from './spooks'

describe('getSpookPermissions', () => {
  const spook = { user_id: 'owner' }

  it('lets the owner edit and delete', () => {
    expect(getSpookPermissions(spook, 'owner', false)).toEqual({ canEdit: true, canDelete: true })
  })

  it('lets admins delete but not edit others spooks', () => {
    expect(getSpookPermissions(spook, 'admin', true)).toEqual({ canEdit: false, canDelete: true })
  })

  it('gives other members no controls', () => {
    expect(getSpookPermissions(spook, 'other', false)).toEqual({ canEdit: false, canDelete: false })
  })
})

describe('getSpookStoragePath', () => {
  it('extracts the object path from a public url', () => {
    expect(
      getSpookStoragePath('https://x.supabase.co/storage/v1/object/public/spooks/u-1-a%20b.png'),
    ).toBe('u-1-a b.png')
  })

  it('returns null for foreign urls', () => {
    expect(getSpookStoragePath('https://example.test/boo.png')).toBeNull()
  })
})

const spookStyles = fs.readFileSync(new URL('../components/spooks.css', import.meta.url), 'utf8')

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

describe('spook image sizing', () => {
  it('keeps the entire image visible without cropping to the container', () => {
    expect(spookStyles).toContain('object-fit: contain')
    expect(spookStyles).not.toContain('object-fit: cover')
  })
})
