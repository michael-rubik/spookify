export type BadgeDefinition = {
  id: string
  threshold: number
  message: string
}

export const CLICKER_BADGE_ID = 'clicker'

// Ordered by ascending threshold. Add future badges here.
export const BADGES: readonly BadgeDefinition[] = [
  {
    id: CLICKER_BADGE_ID,
    threshold: 500,
    message: 'Kostüm Hack entdeckt! Du kannst Michi fragen, wenn du Gewand ausborgen magst.',
  },
]

const cleanIds = (ids: readonly unknown[] | null | undefined): string[] =>
  (ids ?? []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0)

// Add-only: returns the existing ids plus any badge whose threshold has been reached.
export function grantBadges(clickCount: number, existingIds: readonly string[] | null | undefined = []): string[] {
  const granted = new Set(cleanIds(existingIds))
  for (const badge of BADGES) {
    if (clickCount >= badge.threshold) {
      granted.add(badge.id)
    }
  }
  return Array.from(granted)
}

// Pure lookup of unlocked badges in threshold order; unknown ids are ignored.
export function getUnlockedBadges(ids: readonly string[] | null | undefined): BadgeDefinition[] {
  const unlocked = new Set(cleanIds(ids))
  return BADGES.filter((badge) => unlocked.has(badge.id))
}
