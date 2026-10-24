import { supabase } from './supabase/supabase-client'

export const HIDDEN_COSTUME_LABEL = 'Costume hidden'

// Everything on public.users except costume, which is only readable through visible_costumes().
export const USER_COLUMNS =
  'id, name, email, avatar_url, badges, is_admin, click_count, spookify_score, tinder_score, fmk_score, submitter_score, signup_code_id, deletion_pending_at, created_at'

export const costumeLabel = (costume: string | null | undefined) => costume || HIDDEN_COSTUME_LABEL

export const withCostumes = <T extends { id: string }>(
  rows: T[],
  costumes: { id: string; costume: string }[] | null,
): (T & { costume: string })[] => {
  const byId = new Map((costumes ?? []).map((entry) => [entry.id, entry.costume]))
  return rows.map((row) => ({ ...row, costume: byId.get(row.id) ?? '' }))
}

export const fetchCostumes = async () => {
  const { data } = await supabase.rpc('visible_costumes')
  return (data ?? null) as { id: string; costume: string }[] | null
}
