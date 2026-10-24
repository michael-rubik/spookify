import { useState } from 'react'
import {
  buildTrack,
  computeXp,
  customLabelOf,
  DEFAULT_CUSTOM_POINTS,
  describeRewardGroup,
  LEGACY_WINNER,
  levelStatus,
  passScale,
  rewardGroups,
  type PassLevel,
  type PointsById,
} from '../utils/battle-pass'
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
  const [levels, setLevels] = useState<PassLevel[]>([])
  const [activeReward, setActiveReward] = useState<string | null>(null)
  const [error, setError] = useState('')

  usePolling(async (isCancelled) => {
    const [pointsResult, customResult, winnersResult, levelsResult] = await Promise.all([
      supabase.from('badge_points').select('badge_id, points'),
      supabase.from('custom_badge_points').select('label, points'),
      supabase.from('vote_winners').select('vote_id, votes(category, winner_points)').eq('user_id', userId),
      supabase.from('battle_pass_levels').select('id, xp_required, bonus_songs, bonus_fights, fmk_skips'),
      ])
    if (isCancelled()) return

    if (pointsResult.error || customResult.error || winnersResult.error || levelsResult.error) {
      console.error(
        'Failed to load battle pass:',
        pointsResult.error ?? customResult.error ?? winnersResult.error ?? levelsResult.error,
      )
      setError('Could not load the battle pass.')
      return
    }

    setError('')
    setLevels((levelsResult.data ?? []) as PassLevel[])
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
  const { xp, trackTotal, breakdown } = computeXp({
    heldIds: badges,
    points,
    customPoints,
    voteWinnerPoints: wonVotes.map((vote) => vote.points),
  })
  const scale = passScale(trackTotal, levels)
  const fill = Math.min(100, (xp / scale) * 100)
  const { level, bonusSongs, bonusFights, fmkSkips, next } = levelStatus(xp, levels)
  const perks = [
    bonusSongs > 0 ? `+${bonusSongs} bonus songs` : '',
    bonusFights > 0 ? `+${bonusFights} bonus fights` : '',
    fmkSkips > 0 ? `+${fmkSkips} FMK skips` : '',
  ].filter(Boolean)
  const perkSummary = perks.length > 0 ? `${perks.join(', ')} per day` : 'No bonus perks yet'
  const nextPerks = next
    ? [
        next.bonus_songs > 0 ? `+${next.bonus_songs} songs` : '',
        next.bonus_fights > 0 ? `+${next.bonus_fights} fights` : '',
        next.fmk_skips > 0 ? `+${next.fmk_skips} FMK skips` : '',
      ]
        .filter(Boolean)
        .join(', ')
    : ''
  const hasLegacy = badges.includes(LEGACY_WINNER.id)
  const groups = rewardGroups(levels, xp, scale)
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
          <span className="muted">of {scale} on the track</span>
        </div>
        <div className="battle-pass-bar-wrap">
          <div
            className="battle-pass-bar"
            role="progressbar"
            aria-label="Battle pass XP"
            aria-valuemin={0}
            aria-valuemax={scale}
            aria-valuenow={Math.min(xp, scale)}
          >
            <div className="battle-pass-bar-fill" style={{ width: `${fill}%` }} />
          </div>
          {groups.map((group) => {
            const text = describeRewardGroup(group)
            const state = group.reachedCount === group.milestones.length ? 'unlocked' : 'locked'
            const edge = group.positionPercent < 20 ? ' is-start' : group.positionPercent > 80 ? ' is-end' : ''
            return (
              <span
                key={group.key}
                className="battle-pass-reward"
                style={{ left: `${group.positionPercent}%` }}
              >
                <button
                  type="button"
                  className={`battle-pass-reward-icon is-${state}`}
                  data-testid="pass-reward"
                  data-state={state}
                  aria-label={text}
                  aria-expanded={activeReward === group.key}
                  onMouseEnter={() => setActiveReward(group.key)}
                  onMouseLeave={() => setActiveReward((current) => (current === group.key ? null : current))}
                  onFocus={() => setActiveReward(group.key)}
                  onBlur={() => setActiveReward((current) => (current === group.key ? null : current))}
                  onClick={() => setActiveReward((current) => (current === group.key ? null : group.key))}
                >
                  {group.bonusSongs === 0 && group.bonusFights === 0 && group.fmkSkips > 0
                    ? '⏭️'
                    : group.bonusSongs === 0 && group.bonusFights > 0
                      ? '⚔️'
                      : '🎵'}
                </button>
                {activeReward === group.key && (
                  <span role="tooltip" className={`battle-pass-tooltip${edge}`} data-testid="pass-reward-tooltip">
                    {text}
                  </span>
                )}
              </span>
            )
          })}
        </div>
        <div className="row row--between" data-testid="pass-level">
          <strong>Level {level}</strong>
          <span className="muted">
            {perkSummary}
            {next ? ` · next reward at ${next.xp_required} XP (${nextPerks})` : ''}
          </span>
        </div>
        <ul className="list" aria-label="XP breakdown" data-testid="pass-breakdown">
          <li className="row row--between">
            <span className="muted">Pass badges</span>
            <span data-testid="pass-xp-badges">{breakdown.badges} XP</span>
          </li>
          <li className="row row--between">
            <span className="muted">Custom badges</span>
            <span data-testid="pass-xp-custom">{breakdown.custom} XP</span>
          </li>
          <li className="row row--between">
            <span className="muted">Vote wins</span>
            <span data-testid="pass-xp-votes">{breakdown.votes} XP</span>
          </li>
        </ul>
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

      {(customLabels.length > 0 || wonVotes.length > 0 || hasLegacy) && (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Collected</h3>
          <ul className="list" aria-label="Collected badges">
            {wonVotes.map((vote) => (
              <li key={vote.vote_id} className="row row--between" data-testid="winner-badge">
                <span>🏆 Gewinner von {vote.category}</span>
                <span className="pill">+{vote.points} XP</span>
              </li>
            ))}
            {hasLegacy && (
              <li className="row row--between" data-testid="legacy-badge">
                <span>🏅 {LEGACY_WINNER.title}</span>
                <span className="pill">+{points[LEGACY_WINNER.id] ?? LEGACY_WINNER.defaultPoints} XP</span>
              </li>
            )}
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
