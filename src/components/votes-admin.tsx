import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import { usePolling } from '../utils/use-polling'
import { progressPercent, type VoteRecord } from '../utils/votes'
import { clampPoints, DEFAULT_CUSTOM_POINTS, MAX_BADGE_POINTS } from '../utils/battle-pass'

type Progress = { voted: number; eligible: number }

type WinnerPointsFieldProps = {
  vote: VoteRecord
  disabled: boolean
  onSave: (vote: VoteRecord, value: number) => unknown
}

const WinnerPointsField = ({ vote, disabled, onSave }: WinnerPointsFieldProps) => {
  const [draft, setDraft] = useState<string | null>(null)
  const current = vote.winner_points ?? DEFAULT_CUSTOM_POINTS

  return (
    <label className="row">
      <span className="muted">Winner XP</span>
      <input
        type="number"
        min={0}
        max={MAX_BADGE_POINTS}
        disabled={disabled}
        aria-label={`Winner XP for ${vote.category}`}
        value={draft ?? String(current)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === null) return
          const next = clampPoints(Number(draft))
          setDraft(null)
          if (next !== current) void onSave(vote, next)
        }}
      />
    </label>
  )
}

export const VotesAdmin = () => {
  const [votes, setVotes] = useState<VoteRecord[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [category, setCategory] = useState('')
  const [winnerPoints, setWinnerPoints] = useState(String(DEFAULT_CUSTOM_POINTS))
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const reload = usePolling(async (isCancelled) => {
    const { data, error: loadError } = await supabase
      .from('votes')
      .select('id, category, status, created_at, ended_at, winner_points')
      .order('created_at', { ascending: false })
    if (isCancelled()) return

    if (loadError) {
      console.error('Failed to load votes:', loadError)
      setError('Could not load votes.')
      return
    }

    const loaded = (data ?? []) as VoteRecord[]
    const open = loaded.find((vote) => vote.status === 'open')
    const progressResult = open ? await supabase.rpc('vote_progress', { p_vote_id: open.id }) : null
    if (isCancelled()) return

    setVotes(loaded)
    setProgress(((progressResult?.data ?? []) as Progress[])[0] ?? null)
  }, 10000)

  const run = async (action: () => PromiseLike<{ error: { message: string } | null }>, success: string) => {
    setIsBusy(true)
    setError('')
    setMessage('')
    const { error: actionError } = await action()
    setIsBusy(false)

    if (actionError) {
      console.error('Vote action failed:', actionError)
      setError(actionError.message || 'That action failed.')
      return false
    }

    setMessage(success)
    await reload()
    return true
  }

  const handleStart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleaned = category.trim()
    if (!cleaned || cleaned.length > 60) {
      setError('Enter a category of 1 to 60 characters.')
      return
    }

    if (await run(() => supabase.rpc('start_vote', { p_category: cleaned, p_winner_points: clampPoints(Number(winnerPoints)) }), 'Vote started.')) {
      setCategory('')
    }
  }

  const handleWinnerPoints = (vote: VoteRecord, value: number) =>
    run(() => supabase.rpc('set_vote_winner_points', { p_vote_id: vote.id, p_points: value }), 'Winner XP saved.')

  const handleEnd = (vote: VoteRecord) => {
    if (!window.confirm(`End "${vote.category}" and publish the results?`)) return
    void run(() => supabase.rpc('end_vote', { p_vote_id: vote.id }), 'Vote ended.')
  }

  const handleDelete = (vote: VoteRecord) => {
    const isOpen = vote.status === 'open'
    const prompt = isOpen
      ? `Reset "${vote.category}"? All ballots are deleted and nobody sees results.`
      : `Delete "${vote.category}"? Its results and winner badges are removed.`
    if (!window.confirm(prompt)) return
    void run(() => supabase.rpc('delete_vote', { p_vote_id: vote.id }), isOpen ? 'Vote reset.' : 'Vote deleted.')
  }

  const openVote = votes.find((vote) => vote.status === 'open')
  const endedVotes = votes.filter((vote) => vote.status === 'ended')

  return (
    <div className="card" data-testid="votes-admin">
      <h3>Votes</h3>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="form-success">
          {message}
        </p>
      )}

      {openVote ? (
        <div className="stack" data-testid="open-vote">
          <div className="row row--between">
            <strong>{openVote.category}</strong>
            <span className="pill pill--admin">Open</span>
          </div>
          <p className="muted">
            {progress ? `${progress.voted} of ${progress.eligible} voted (${progressPercent(progress.voted, progress.eligible)}%)` : 'Loading progress...'}
          </p>
          <WinnerPointsField vote={openVote} disabled={isBusy} onSave={handleWinnerPoints} />
          <div className="row">
            <button type="button" disabled={isBusy} onClick={() => handleEnd(openVote)}>
              End vote
            </button>
            <button type="button" disabled={isBusy} onClick={() => handleDelete(openVote)}>
              Reset vote
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleStart} className="row">
          <label htmlFor="vote-category" className="visually-hidden">
            Category
          </label>
          <input
            id="vote-category"
            value={category}
            maxLength={60}
            placeholder="Category, e.g. Best costume"
            onChange={(event) => setCategory(event.target.value)}
          />
          <button type="submit" disabled={isBusy}>
            Start vote
          </button>
          <label htmlFor="vote-winner-points">Winner XP</label>
          <input
            id="vote-winner-points"
            type="number"
            min={0}
            max={MAX_BADGE_POINTS}
            required
            value={winnerPoints}
            onChange={(event) => setWinnerPoints(event.target.value)}
          />
        </form>
      )}

      {endedVotes.length > 0 && (
        <ul className="list" aria-label="Ended votes">
          {endedVotes.map((vote) => (
            <li key={vote.id} className="row row--between">
              <span>
                {vote.category} <span className="muted">· ended {vote.ended_at ? new Date(vote.ended_at).toLocaleString() : ''}</span>
              </span>
              <WinnerPointsField vote={vote} disabled={isBusy} onSave={handleWinnerPoints} />
              <button type="button" disabled={isBusy} onClick={() => handleDelete(vote)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
