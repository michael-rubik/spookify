export type SpookRecord = {
  id: string
  user_id: string
  caption: string
  image_url: string
  tagged_user_ids: string[]
  created_at: string
}

type SpookRow = Omit<SpookRecord, 'tagged_user_ids'> & {
  spook_tagged_users: { user_id: string }[] | null
}

export function normalizeSpookRow(row: SpookRow): SpookRecord {
  const { spook_tagged_users, ...spook } = row
  const taggedUserIds = (spook_tagged_users ?? []).map((tag) => tag.user_id)

  return {
    ...spook,
    tagged_user_ids: [...new Set(taggedUserIds)],
  }
}

export function sortSpooksByNewest<T extends { created_at: string }>(spooks: T[]): T[] {
  return [...spooks].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  )
}
