import { useState } from 'react'
import { POINT_BADGES, clampPoints, MAX_BADGE_POINTS, pointsFor, type PointsById } from '../utils/battle-pass'
import { supabase } from '../utils/supabase/supabase-client'
import { usePolling } from '../utils/use-polling'

export function BadgePointsAdmin() {
  const [points, setPoints] = useState<PointsById>({})
  const [customPoints, setCustomPoints] = useState<PointsById>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const reload = usePolling(
    async (isCancelled) => {
      const [base, custom] = await Promise.all([
        supabase.from('badge_points').select('badge_id, points'),
        supabase.from('custom_badge_points').select('label, points'),
      ])
      if (isCancelled() || base.error || custom.error) return
      setPoints(Object.fromEntries((base.data ?? []).map((row) => [row.badge_id as string, row.points as number])))
      setCustomPoints(Object.fromEntries((custom.data ?? []).map((row) => [row.label as string, row.points as number])))
    },
    15000,
    true,
  )

  const save = async (kind: 'badge' | 'custom', key: string, raw: string) => {
    const value = clampPoints(Number(raw))
    setError('')
    const { error: saveError } =
      kind === 'badge'
        ? await supabase.from('badge_points').upsert({ badge_id: key, points: value })
        : await supabase.from('custom_badge_points').upsert({ label: key, points: value })
    setDrafts((current) => {
      const { [`${kind}:${key}`]: _removed, ...rest } = current
      void _removed
      return rest
    })
    if (saveError) {
      console.error('Failed to save badge points:', saveError)
      setError('Could not save badge points.')
      return
    }
    await reload()
  }

  const field = (kind: 'badge' | 'custom', key: string, label: string, current: number) => {
    const draftKey = `${kind}:${key}`
    return (
      <label key={draftKey} className="row row--between">
        <span>{label}</span>
        <input
          type="number"
          min={0}
          max={MAX_BADGE_POINTS}
          aria-label={`${label} points`}
          value={drafts[draftKey] ?? String(current)}
          onChange={(event) => setDrafts((existing) => ({ ...existing, [draftKey]: event.target.value }))}
          onBlur={(event) => {
            if (drafts[draftKey] !== undefined) void save(kind, key, event.target.value)
          }}
        />
      </label>
    )
  }

  return (
    <div className="card stack" data-testid="badge-points-admin">
      <h3 style={{ margin: 0 }}>Badge points</h3>
      <p className="muted">XP each badge gives. Changes apply to everyone who already holds the badge.</p>
      {POINT_BADGES.map((badge) => field('badge', badge.id, badge.title, pointsFor(badge, points)))}
      {Object.keys(customPoints).length > 0 && <h4 style={{ margin: 0 }}>Custom badges</h4>}
      {Object.entries(customPoints)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, value]) => field('custom', label, label, value))}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
