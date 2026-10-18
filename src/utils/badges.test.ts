import { describe, expect, it } from 'vitest'
import { getUserBadges } from './badges'

describe('getUserBadges', () => {
  it('awards the clicker badge at exactly 500 clicks', () => {
    expect(getUserBadges(500)).toContain('clicker')
  })

  it('does not award the clicker badge below the threshold', () => {
    expect(getUserBadges(499)).not.toContain('clicker')
  })
})
