export type LeaderboardSong = {
  id: string
  title: string
  artist: string
  album_art_url: string | null
  points: number
  added_by: string
  submitter_name: string
}

export type SongLeaderboardRow = LeaderboardSong & { rank: number; fraction: number }

export const SONG_LEADERBOARD_LIMIT = 10

// Ranks songs by earned points with shared ranks for ties; a submitter id narrows it to their songs.
export function buildSongLeaderboard(
  songs: readonly LeaderboardSong[],
  submitterId: string | null,
  limit: number = SONG_LEADERBOARD_LIMIT,
): SongLeaderboardRow[] {
  const sorted = songs
    .filter((song) => submitterId === null || song.added_by === submitterId)
    .sort((a, b) => b.points - a.points || a.title.localeCompare(b.title))
  const top = sorted[0]?.points ?? 0

  return sorted.slice(0, limit).map((song) => ({
    ...song,
    rank: sorted.findIndex((other) => other.points === song.points) + 1,
    fraction: top > 0 ? song.points / top : 0,
  }))
}

// Distinct submitters of the given songs, by name, for the filter.
export function songSubmitters(songs: readonly LeaderboardSong[]): { id: string; name: string }[] {
  const byId = new Map<string, string>()
  for (const song of songs) byId.set(song.added_by, song.submitter_name)
  return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}
