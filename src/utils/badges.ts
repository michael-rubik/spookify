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

export const CUSTOM_BADGE_PREFIX = 'custom:'
export const CUSTOM_BADGE_MAX_LENGTH = 40

export const customBadgeId = (label: string): string => `${CUSTOM_BADGE_PREFIX}${label.trim()}`

// Admin-given badges carry their own text; the prefix keeps them apart from built-in ids.
export function getCustomBadgeLabels(ids: readonly string[] | null | undefined): string[] {
  return cleanIds(ids)
    .filter((id) => id.startsWith(CUSTOM_BADGE_PREFIX))
    .map((id) => id.slice(CUSTOM_BADGE_PREFIX.length).trim())
    .filter((label) => label.length > 0)
}

// Add-only and idempotent: giving the same text twice keeps a single badge.
export function giveCustomBadge(label: string, existingIds: readonly string[] | null | undefined = []): string[] {
  const text = label.trim()
  const ids = cleanIds(existingIds)
  if (!text) return ids
  const id = customBadgeId(text)
  return ids.includes(id) ? ids : [...ids, id]
}

export const badgeDisplayName = (id: string): string =>
  id.startsWith(CUSTOM_BADGE_PREFIX) ? id.slice(CUSTOM_BADGE_PREFIX.length) : id

// Pure lookup of unlocked badges in threshold order; unknown ids are ignored.
export function getUnlockedBadges(ids: readonly string[] | null | undefined): BadgeDefinition[] {
  const unlocked = new Set(cleanIds(ids))
  return BADGES.filter((badge) => unlocked.has(badge.id))
}
