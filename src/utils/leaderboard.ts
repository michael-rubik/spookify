export type LeaderboardUser = {
  id: string
  name: string
  costume: string
  avatar_url: string | null
  value: number
}

export type LeaderboardRow = LeaderboardUser & {
  rank: number
  fraction: number
  isOwn: boolean
}

export const LEADERBOARD_LIMIT = 10

// Ranks by value with shared ranks for ties; the viewer's own row is appended when outside the top.
// `ownValue` overrides the stored value so the viewer's latest value shows before the next fetch.
export function buildLeaderboard(
  users: readonly LeaderboardUser[],
  ownId: string,
  ownValue: number | undefined,
  limit: number = LEADERBOARD_LIMIT,
): LeaderboardRow[] {
  const counted = users
    .map((user) => ({ ...user, value: user.id === ownId ? (ownValue ?? user.value) : user.value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))

  const top = counted[0]?.value ?? 0
  const rows = counted.map((user): LeaderboardRow => {
    const firstWithValue = counted.findIndex((other) => other.value === user.value)
    return {
      ...user,
      rank: firstWithValue + 1,
      fraction: top > 0 ? user.value / top : 0,
      isOwn: user.id === ownId,
    }
  })

  const visible = rows.slice(0, limit)
  const own = rows.find((row) => row.isOwn)
  return own && !visible.includes(own) ? [...visible, own] : visible
}
