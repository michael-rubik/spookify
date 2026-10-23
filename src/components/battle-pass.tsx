import { useState } from 'react'
import { buildTrack, computeXp, customLabelOf, DEFAULT_CUSTOM_POINTS, type PointsById } from '../utils/battle-pass'
import { supabase } from '../utils/supabase/supabase-client'
import { usePolling } from '../utils/use-polling'
import './battle-pass.css'

type BattlePassProps = {
  userId: string
  badges: string[]
  progress: Record<string, number>
}

type WonVote = { vote_id: string; category: string; points: number }

type VoteWinnerRow = { vote_id: string; votes: { category: string; winner_points: number } | null }

export const BattlePass = ({ userId, badges, progress }: BattlePassProps) => {
  const [points, setPoints] = useState<PointsById>({})
  const [customPoints, setCustomPoints] = useState<Record<string, number>>({})
  const [wonVotes, setWonVotes] = useState<WonVote[]>([])
  const [error, setError] = useState('')

  usePolling(async (isCancelled) => {
    const [pointsResult, customResult, winnersResult] = await Promise.all([
      supabase.from('badge_points').select('badge_id, points'),
      supabase.from('custom_badge_points').select('label, points'),
      supabase.from('vote_winners').select('vote_id, votes(category, winner_points)').eq('user_id', userId),
    ])
    if (isCancelled()) return

    if (pointsResult.error || customResult.error || winnersResult.error) {
      console.error('Failed to load battle pass:', pointsResult.error ?? customResult.error ?? winnersResult.error)
      setError('Could not load the battle pass.')
      return
    }

    setError('')
    setPoints(Object.fromEntries((pointsResult.data ?? []).map((row) => [row.badge_id as string, row.points as number])))
    setCustomPoints(Object.fromEntries((customResult.data ?? []).map((row) => [row.label as string, row.points as number])))
    const rows = (winnersResult.data ?? []) as unknown as VoteWinnerRow[]
    setWonVotes(
      rows.flatMap((row) =>
        row.votes ? [{ vote_id: row.vote_id, category: row.votes.category, points: row.votes.winner_points }] : [],
      ),
    )
  }, 15000)

  const track = buildTrack(badges, points, progress)
  const { xp, trackTotal } = computeXp({
    heldIds: badges,
    points,
    customPoints,
    voteWinnerPoints: wonVotes.map((vote) => vote.points),
  })
  const fill = trackTotal > 0 ? Math.min(100, (xp / trackTotal) * 100) : 0
  const customLabels = badges.flatMap((id) => {
    const label = customLabelOf(id)
    return label ? [label] : []
  })

  return (
    <section className="page-section battle-pass">
      <h2>Battle pass</h2>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      <div className="card battle-pass-xp">
        <div className="row row--between">
          <strong data-testid="pass-xp">{xp} XP</strong>
          <span className="muted">of {trackTotal} on the track</span>
        </div>
        <div
          className="battle-pass-bar"
          role="progressbar"
          aria-label="Battle pass XP"
          aria-valuemin={0}
          aria-valuemax={trackTotal}
          aria-valuenow={Math.min(xp, trackTotal)}
        >
          <div className="battle-pass-bar-fill" style={{ width: `${fill}%` }} />
        </div>
      </div>

      <ol className="battle-pass-track" aria-label="Badges">
        {track.map((node) => {
          const percent = Math.round((node.progress / node.badge.target) * 100)
          const state = node.earned ? 'earned' : node.progress > 0 ? 'progress' : 'locked'

          return (
            <li key={node.badge.id} className={`battle-pass-node is-${state}`} data-testid="pass-node" data-badge={node.badge.id} data-state={state}>
              <span className="battle-pass-marker" aria-hidden="true">
                {node.earned ? '✓' : '🔒'}
              </span>
              <div className="battle-pass-body">
                <div className="row row--between">
                  <strong>{node.badge.title}</strong>
                  <span className="pill">+{node.points} XP</span>
                </div>
                <div className="muted">{node.badge.goal}</div>
                {node.earned ? (
                  <p className="battle-pass-message">{node.badge.message}</p>
                ) : node.badge.id === 'winner-winner' ? (
                  <div className="muted">
                    {Math.min(track.filter((other) => other.earned && other.badge.id !== 'winner-winner').length, node.badge.target)}/
                    {node.badge.target} badges
                  </div>
                ) : (
                  <>
                    <div
                      className="battle-pass-bar battle-pass-bar--small"
                      role="progressbar"
                      aria-label={`${node.badge.title} progress`}
                      aria-valuemin={0}
                      aria-valuemax={node.badge.target}
                      aria-valuenow={node.progress}
                    >
                      <div className="battle-pass-bar-fill" style={{ width: `${percent}%` }} />
                    </div>
                    <div className="muted">
                      {Math.floor(node.progress)}/{node.badge.target}
                    </div>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {(customLabels.length > 0 || wonVotes.length > 0) && (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Collected</h3>
          <ul className="list" aria-label="Collected badges">
            {wonVotes.map((vote) => (
              <li key={vote.vote_id} className="row row--between" data-testid="winner-badge">
                <span>🏆 Gewinner von {vote.category}</span>
                <span className="pill">+{vote.points} XP</span>
              </li>
            ))}
            {customLabels.map((label) => (
              <li key={label} className="row row--between" data-testid="custom-badge">
                <span>🎖️ {label}</span>
                <span className="pill">+{customPoints[label] ?? DEFAULT_CUSTOM_POINTS} XP</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
