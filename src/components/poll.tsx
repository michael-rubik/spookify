import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import { usePolling } from '../utils/use-polling'
import {
  buildFakeBars,
  buildLeaderboard,
  COLLAPSED_LIMIT,
  progressPercent,
  type TallyRow,
  type VoteRecord,
} from '../utils/votes'
import { Costume } from './costume'
import './poll.css'

export type PollUser = {
  id: string
  name: string
  costume: string
  avatar_url: string | null
  deletion_pending_at?: string | null
}

type Progress = { voted: number; eligible: number }

type ChartBar = {
  id: string
  label: string
  fraction: number
  user?: PollUser
  ballots?: number
  isWinner?: boolean
}

type PollProps = {
  currentUserId: string
  users: PollUser[]
}

const ROW_HEIGHT = 60
const FAKE_TICK_MS = 3000

function Avatar({ user }: { user: PollUser | undefined }) {
  return user?.avatar_url ? (
    <img src={user.avatar_url} alt="" className="avatar avatar--sm" />
  ) : (
    <span className="avatar avatar--sm avatar--fallback">{user?.name?.slice(0, 1).toUpperCase() ?? '?'}</span>
  )
}

function ProgressBar({ progress }: { progress: Progress | null }) {
  const percent = progress ? progressPercent(progress.voted, progress.eligible) : 0

  return (
    <div className="vote-progress">
      <div
        className="vote-progress-track"
        role="progressbar"
        aria-label="Voting progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="vote-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="muted">{percent}% have voted</span>
    </div>
  )
}

function VoteChart({ bars, revealed, label }: { bars: ChartBar[]; revealed: boolean; label: string }) {
  const [expanded, setExpanded] = useState(false)
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const visible = expanded ? bars : bars.slice(0, COLLAPSED_LIMIT)

  return (
    <div className="vote-chart">
      <div className="vote-chart-rows" role="list" aria-label={label} style={{ height: visible.length * ROW_HEIGHT }}>
        {visible.map((bar, index) => {
          const inspected = inspectedId === bar.id && Boolean(bar.user)
          const showIdentity = revealed || inspected

          return (
            <button
              key={bar.id}
              type="button"
              role="listitem"
              data-testid="vote-bar"
              data-rank={index + 1}
              data-winner={bar.isWinner ? 'true' : undefined}
              className={`vote-chart-row${bar.isWinner ? ' is-winner' : ''}`}
              style={{ transform: `translateY(${index * ROW_HEIGHT}px)` }}
              onMouseEnter={() => setInspectedId(bar.id)}
              onMouseLeave={() => setInspectedId(null)}
              onFocus={() => setInspectedId(bar.id)}
              onBlur={() => setInspectedId(null)}
              onClick={() => setInspectedId(bar.id)}
            >
              <span className="vote-chart-fill" style={{ width: `${Math.round(bar.fraction * 100)}%` }} />
              <span className="vote-chart-content">
                {showIdentity && <Avatar user={bar.user} />}
                <span className="vote-chart-text">
                  {revealed ? (
                    <>
                      <strong>{bar.isWinner ? '🏆 ' : ''}{bar.user?.costume || bar.label}</strong>
                      <small>{bar.user?.name}</small>
                    </>
                  ) : inspected ? (
                    <>
                      <strong>{bar.user?.name}</strong>
                      <small>{<Costume costume={bar.user?.costume} />}</small>
                    </>
                  ) : (
                    <strong>{bar.label}</strong>
                  )}
                </span>
                {bar.ballots !== undefined && <span className="vote-chart-count">{bar.ballots}</span>}
              </span>
            </button>
          )
        })}
      </div>
      {bars.length > COLLAPSED_LIMIT && (
        <button type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? `Show top ${COLLAPSED_LIMIT}` : `Show all (${bars.length})`}
        </button>
      )}
    </div>
  )
}

function BallotForm({ vote, candidates, onVoted }: { vote: VoteRecord; candidates: PollUser[]; onVoted: () => void }) {
  const [choice, setChoice] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!choice) {
      setError('Pick a costume first.')
      return
    }
    if (!window.confirm('Cast your ballot? It is anonymous and cannot be changed.')) return

    setIsSubmitting(true)
    setError('')
    const { error: castError } = await supabase.rpc('cast_ballot', { p_vote_id: vote.id, p_candidate_id: choice })
    setIsSubmitting(false)

    if (castError) {
      console.error('Failed to cast ballot:', castError)
      setError(castError.message || 'Your ballot could not be cast.')
      return
    }
    onVoted()
  }

  if (candidates.length === 0) {
    return <p className="muted">There is nobody else to vote for yet.</p>
  }

  return (
    <form onSubmit={handleSubmit} className="ballot-form">
      <fieldset className="ballot-candidates">
        <legend>Pick your favourite</legend>
        {candidates.map((candidate) => (
          <label key={candidate.id} className={`candidate-option${choice === candidate.id ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name={`ballot-${vote.id}`}
              value={candidate.id}
              checked={choice === candidate.id}
              onChange={() => {
                setChoice(candidate.id)
                setError('')
              }}
            />
            <Avatar user={candidate} />
            <span className="candidate-text">
              <strong>{candidate.name}</strong>
              <small>{<Costume costume={candidate.costume} />}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Casting...' : 'Cast ballot'}
      </button>
    </form>
  )
}

type VoteCardProps = {
  vote: VoteRecord
  users: PollUser[]
  currentUserId: string
  hasVoted: boolean
  progress: Progress | null
  tallies: TallyRow[]
  onVoted: () => void
}

function VoteCard({ vote, users, currentUserId, hasVoted, progress, tallies, onVoted }: VoteCardProps) {
  const [seed] = useState(() => Math.random().toString(36).slice(2))
  const [tick, setTick] = useState(0)
  const isOpen = vote.status === 'open'
  const showLiveChart = isOpen && hasVoted
  const activeUsers = users.filter((user) => !user.deletion_pending_at)

  useEffect(() => {
    if (!showLiveChart) return
    const timer = window.setInterval(() => setTick((current) => current + 1), FAKE_TICK_MS)
    return () => window.clearInterval(timer)
  }, [showLiveChart])

  let bars: ChartBar[] = []
  if (showLiveChart) {
    // Decorative only: nothing here depends on real ballots until the vote has ended.
    bars = buildFakeBars(
      activeUsers.map((user) => user.id),
      seed,
      tick,
    ).map((bar) => ({ ...bar, user: users.find((user) => user.id === bar.id) }))
  } else if (!isOpen) {
    const board = buildLeaderboard(tallies.filter((tally) => tally.vote_id === vote.id))
    const top = board[0]?.ballots ?? 1
    bars = board.map((entry) => {
      const user = users.find((candidate) => candidate.id === entry.candidate_id)
      return {
        id: entry.candidate_id,
        label: user?.costume || 'Unknown costume',
        fraction: entry.ballots / top,
        user,
        ballots: entry.ballots,
        isWinner: entry.isWinner,
      }
    })
  }

  return (
    <article className="card vote-card" data-testid="vote-card" data-status={vote.status}>
      <div className="row row--between">
        <h3>{vote.category}</h3>
        <span className={`pill${isOpen ? ' pill--admin' : ''}`}>{isOpen ? 'Open' : 'Ended'}</span>
      </div>

      {isOpen && <ProgressBar progress={progress} />}

      {isOpen && !hasVoted && (
        <BallotForm vote={vote} candidates={activeUsers.filter((user) => user.id !== currentUserId)} onVoted={onVoted} />
      )}
      {isOpen && hasVoted && (
        <p role="status" className="form-success">
          You&apos;ve voted ✓ The results are revealed when the vote ends.
        </p>
      )}

      {(showLiveChart || !isOpen) &&
        (bars.length > 0 ? (
          <VoteChart bars={bars} revealed={!isOpen} label={`${vote.category} ${isOpen ? 'live chart' : 'leaderboard'}`} />
        ) : (
          <p className="muted">No ballots were cast.</p>
        ))}
    </article>
  )
}

export function Poll({ currentUserId, users }: PollProps) {
  const [votes, setVotes] = useState<VoteRecord[]>([])
  const [tallies, setTallies] = useState<TallyRow[]>([])
  const [votedIds, setVotedIds] = useState<string[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const reload = usePolling(async (isCancelled) => {
    const { data: voteRows, error: votesError } = await supabase
      .from('votes')
      .select('id, category, status, created_at, ended_at')
      .order('created_at', { ascending: false })
    if (isCancelled()) return

    if (votesError) {
      console.error('Failed to load votes:', votesError)
      setError('Could not load the poll right now.')
      setIsLoading(false)
      return
    }

    const loaded = (voteRows ?? []) as VoteRecord[]
    const open = loaded.find((vote) => vote.status === 'open')
    const [tallyResult, participationResult, progressResult] = await Promise.all([
      supabase.from('vote_tallies').select('vote_id, candidate_id, ballots'),
      supabase.from('vote_participation').select('vote_id'),
      open ? supabase.rpc('vote_progress', { p_vote_id: open.id }) : null,
    ])
    if (isCancelled()) return

    if (tallyResult.error || participationResult.error || progressResult?.error) {
      console.error('Failed to load poll details:', tallyResult.error ?? participationResult.error ?? progressResult?.error)
      setError('Could not load the poll right now.')
      setIsLoading(false)
      return
    }

    setError('')
    setVotes(loaded)
    setTallies((tallyResult.data ?? []) as TallyRow[])
    setVotedIds(((participationResult.data ?? []) as { vote_id: string }[]).map((row) => row.vote_id))
    setProgress(((progressResult?.data ?? []) as Progress[])[0] ?? null)
    setIsLoading(false)
  }, 10000)

  return (
    <section className="page-section poll-section">
      <h2>Poll</h2>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {isLoading ? (
        <p>Loading poll...</p>
      ) : votes.length === 0 ? (
        <p>No vote yet.</p>
      ) : (
        votes.map((vote) => (
          <VoteCard
            key={vote.id}
            vote={vote}
            users={users}
            currentUserId={currentUserId}
            hasVoted={votedIds.includes(vote.id)}
            progress={vote.status === 'open' ? progress : null}
            tallies={tallies}
            onVoted={() => void reload()}
          />
        ))
      )}
    </section>
  )
}
