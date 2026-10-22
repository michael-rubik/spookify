import { supabase } from '../utils/supabase/supabase-client'
import { isDevLoginEnabled } from '../utils/dev-login'
import { buildLeaderboard, LEADERBOARD_LIMIT, type LeaderboardUser } from '../utils/leaderboard'
import { formatSpookifyScore } from '../utils/spookify'
import { usePolling } from '../utils/use-polling'
import { useEffect, useRef, useState } from 'react'
import './leaderboard.css'

type LeaderboardColumn = 'click_count' | 'submitter_score' | 'tinder_score' | 'fmk_score'

type LeaderboardProps = {
  userId: string
  column: LeaderboardColumn
  label: string
  // Overrides the stored value for the viewer so a local count shows before the next fetch.
  ownValue?: number
  // Changing this value triggers an immediate refetch.
  refreshKey?: number
}

type LeaderboardRecord = {
  id: string
  name: string
  costume: string
  avatar_url: string | null
} & Record<string, unknown>

export const Leaderboard = ({ userId, column, label, ownValue, refreshKey }: LeaderboardProps) => {
  const [users, setUsers] = useState<LeaderboardUser[]>([])
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  const reload = usePolling(
    async (isCancelled) => {
      const { data, error: loadError } = await supabase
        .from('users')
        .select(`id, name, costume, avatar_url, ${column}`)
        .is('deletion_pending_at', null)
      if (isCancelled()) return

      if (loadError) {
        console.error('Failed to load leaderboard:', loadError)
        setError('Could not load the leaderboard.')
        return
      }

      setError('')
      const records = (data ?? []) as unknown as LeaderboardRecord[]
      setUsers(
        records.map(({ id, name, costume, avatar_url, ...rest }) => ({
          id,
          name,
          costume,
          avatar_url,
          value: Number(rest[column] ?? 0) || 0,
        })),
      )
    },
    10000,
    !isDevLoginEnabled(),
  )

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    void reload()
  }, [refreshKey, reload])

  if (isDevLoginEnabled()) return null

  const rows = buildLeaderboard(users, userId, ownValue, expanded ? Number.POSITIVE_INFINITY : LEADERBOARD_LIMIT)

  return (
    <section className="leaderboard" aria-label={`${label} leaderboard`}>
      <h3>Leaderboard</h3>
      {error && <p role="alert" className="form-error">{error}</p>}
      <ol className="leaderboard-rows">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`leaderboard-row${row.isOwn ? ' is-own' : ''}`}
            data-testid="leaderboard-row"
          >
            <span className="leaderboard-fill" style={{ width: `${Math.round(row.fraction * 100)}%` }} />
            <span className="leaderboard-content">
              <span className="leaderboard-rank">{row.rank}</span>
              {row.avatar_url ? (
                <img src={row.avatar_url} alt="" className="avatar avatar--sm" />
              ) : (
                <span className="avatar avatar--sm avatar--fallback">{row.name.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="leaderboard-text">
                <strong>{row.name}{row.isOwn ? ' (you)' : ''}</strong>
                <small>{row.costume}</small>
              </span>
              <span className="leaderboard-count">              {formatSpookifyScore(row.value)}</span>
            </span>
          </li>
        ))}
      </ol>
                    {users.length > LEADERBOARD_LIMIT && (
                      <button type="button" className="link-button" onClick={() => setExpanded((value) => !value)}>
                        {expanded ? 'Show top 10' : `Show all (${users.length})`}
                      </button>
                    )}
    </section>
  )
}
