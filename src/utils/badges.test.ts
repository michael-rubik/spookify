import { describe, expect, it } from 'vitest'
import { BADGES, badgeDisplayName, getCustomBadgeLabels, getUnlockedBadges, giveCustomBadge, grantBadges } from './badges'

describe('custom badges', () => {
  it('adds a trimmed custom badge once and keeps existing badges', () => {
    expect(giveCustomBadge('  Best Costume ', ['clicker'])).toEqual(['clicker', 'custom:Best Costume'])
    expect(giveCustomBadge('Best Costume', ['custom:Best Costume'])).toEqual(['custom:Best Costume'])
  })

  it('ignores a blank label', () => {
    expect(giveCustomBadge('   ', ['clicker'])).toEqual(['clicker'])
  })

  it('lists only custom badge labels and survives click grants', () => {
    const ids = giveCustomBadge('Party MVP', ['clicker'])
    expect(getCustomBadgeLabels(ids)).toEqual(['Party MVP'])
    expect(grantBadges(0, ids)).toEqual(ids)
    expect(getUnlockedBadges(ids).map((badge) => badge.id)).toEqual(['clicker'])
    expect(badgeDisplayName('custom:Party MVP')).toBe('Party MVP')
  })
})

describe('grantBadges', () => {
  it('awards the clicker badge at exactly 500 clicks', () => {
    expect(grantBadges(500)).toContain('clicker')
  })

  it('does not award the clicker badge below the threshold', () => {
    expect(grantBadges(499)).not.toContain('clicker')
  })

  it('is add-only: keeps existing and unknown badges regardless of count', () => {
    expect(grantBadges(0, ['clicker', 'legacy'])).toEqual(['clicker', 'legacy'])
  })

  it('does not duplicate ids and drops blank values', () => {
    expect(grantBadges(600, ['clicker', ' ', 'clicker'])).toEqual(['clicker'])
  })

  it('tolerates null existing badges', () => {
    expect(grantBadges(10, null)).toEqual([])
  })
})

describe('getUnlockedBadges', () => {
  it('returns the 500-click message verbatim', () => {
    expect(getUnlockedBadges(['clicker'])[0].message).toBe(
      'Kostüm Hack entdeckt! Du kannst Michi fragen, wenn du Gewand ausborgen magst.',
    )
  })

  it('ignores unknown ids and handles empty input', () => {
    expect(getUnlockedBadges(['nope'])).toEqual([])
    expect(getUnlockedBadges(null)).toEqual([])
  })

  it('keeps the badge list sorted by threshold', () => {
    const thresholds = BADGES.map((badge) => badge.threshold)
    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b))
  })
})
