export type SpookRecord = {
  id: string
  user_id: string
  caption: string
  image_url: string
  tagged_user_id: string | null
  created_at: string
}

export function sortSpooksByNewest<T extends { created_at: string }>(spooks: T[]): T[] {
  return [...spooks].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  )
}
