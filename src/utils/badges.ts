export const CLICKER_BADGE_ID = 'clicker'

export function getUserBadges(clickCount: number, existingBadges: string[] | null | undefined = []): string[] {
  const badges = new Set(
    (existingBadges ?? []).filter(
      (badge): badge is string => typeof badge === 'string' && badge.trim().length > 0,
    ),
  )

  if (clickCount >= 500) {
    badges.add(CLICKER_BADGE_ID)
  } else {
    badges.delete(CLICKER_BADGE_ID)
  }

  return Array.from(badges)
}
