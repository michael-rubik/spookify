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

export function getSpookPermissions(
  spook: { user_id: string },
  currentUserId: string,
  isAdmin: boolean,
): { canEdit: boolean; canDelete: boolean } {
  const isOwner = spook.user_id === currentUserId
  return { canEdit: isOwner, canDelete: isOwner || isAdmin }
}

export function getSpookStoragePath(imageUrl: string, bucket = 'spooks'): string | null {
  const marker = `/${bucket}/`
  const index = imageUrl.indexOf(marker)
  if (index === -1) return null

  const path = imageUrl.slice(index + marker.length).split('?')[0]
  return path ? decodeURIComponent(path) : null
}

export function sortSpooksByNewest<T extends { created_at: string }>(spooks: T[]): T[] {
  return [...spooks].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  )
}
