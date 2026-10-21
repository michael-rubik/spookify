export type VoteRecord = {
  id: string
  category: string
  status: 'open' | 'ended'
  created_at: string
  ended_at: string | null
}

export type TallyRow = {
  vote_id: string
  candidate_id: string
  ballots: number
}

export type LeaderboardEntry = {
  candidate_id: string
  ballots: number
  rank: number
  isWinner: boolean
}

export const COLLAPSED_LIMIT = 3

// Standard competition ranking: tied candidates share a rank and the next rank is skipped (1, 2, 2, 4).
export function buildLeaderboard(tallies: readonly { candidate_id: string; ballots: number }[]): LeaderboardEntry[] {
  const sorted = tallies
    .filter((tally) => tally.ballots > 0)
    .toSorted((left, right) => right.ballots - left.ballots || left.candidate_id.localeCompare(right.candidate_id))

  return sorted.map((tally) => {
    const rank = sorted.findIndex((other) => other.ballots === tally.ballots) + 1
    return { candidate_id: tally.candidate_id, ballots: tally.ballots, rank, isWinner: rank === 1 }
  })
}

export function progressPercent(voted: number, eligible: number): number {
  if (eligible <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((voted / eligible) * 100)))
}

// Deterministic pseudo-random number in [0, 1) so the decorative chart needs no stored state.
export function hash01(input: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) / 9007199254740992
}

export type FakeBar = { id: string; label: string; fraction: number }

// Decorative bars shown while a vote is open: random labels, lengths and order, never real data.
export function buildFakeBars(candidateIds: readonly string[], seed: string, tick: number): FakeBar[] {
  const labelOrder = candidateIds.toSorted((left, right) => hash01(`${seed}:${left}`) - hash01(`${seed}:${right}`))

  return candidateIds
    .map((id) => ({
      id,
      label: `Costume #${labelOrder.indexOf(id) + 1}`,
      fraction: 0.12 + 0.88 * hash01(`${seed}:${id}:${tick}`),
    }))
    .toSorted((left, right) => right.fraction - left.fraction)
}
