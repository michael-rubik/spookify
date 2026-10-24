import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import { isDevLoginEnabled } from '../utils/dev-login'
import { fetchCostumes, withCostumes } from '../utils/costumes'
import { buildLeaderboard, type LeaderboardUser } from '../utils/leaderboard'
import { usePolling } from '../utils/use-polling'
import { Costume } from './costume'
import './leaderboard.css'

export const FIGHT_MIN_CLICKS = 250

type FightState = {
  fight_id: string | null
  started_at: string | null
  ends_at: string | null
  running: boolean | null
  server_now: string
  fighters: number
  daily_limit: number
  calls_today: number
  next_call_at: string | null
}

type ScoreRow = { user_id: string; clicks: number; won: boolean }

type ClickerFightProps = {
  userId: string
  clickCount: number
}

const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const formatWait = (ms: number) => {
  const minutes = Math.max(1, Math.ceil(ms / 60000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

const callError = (message: string) => {
  if (message.includes('already running')) return 'A clicker fight is already running.'
  if (message.includes('limit')) return 'You have used all your fight calls for now.'
  if (message.includes('250 clicks')) return `You need ${FIGHT_MIN_CLICKS} clicks to call a clicker fight.`
  return 'Could not call the clicker fight.'
}

export const ClickerFight = ({ userId, clickCount }: ClickerFightProps) => {
  const [state, setState] = useState<FightState | null>(null)
  const [rows, setRows] = useState<{ user: LeaderboardUser; won: boolean }[]>([])
  const [skew, setSkew] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dev = isDevLoginEnabled()

  const reload = usePolling(
    async (isCancelled) => {
      const { data, error: stateError } = await supabase.rpc('clicker_fight_state')
      if (isCancelled()) return
      const next = (data as FightState[] | null)?.[0]
      if (stateError || !next) {
        console.error('Failed to load clicker fight:', stateError)
        return
      }
      setState(next)
      setSkew(new Date(next.server_now).getTime() - Date.now())

      if (!next.fight_id) {
        setRows([])
        return
      }
      const { data: scores, error: scoresError } = await supabase
        .from('clicker_fight_scores')
        .select('user_id, clicks, won')
        .eq('fight_id', next.fight_id)
      if (isCancelled()) return
      if (scoresError) {
        console.error('Failed to load fight scores:', scoresError)
        return
      }
      const scoreRows = (scores ?? []) as ScoreRow[]
      const ids = scoreRows.map((row) => row.user_id)
      const [{ data: users }, costumes] = await Promise.all([
        ids.length > 0
          ? supabase.from('users').select('id, name, avatar_url').in('id', ids)
          : Promise.resolve({ data: [] }),
        fetchCostumes(),
      ])
      if (isCancelled()) return
      const people = withCostumes(
        (users ?? []) as { id: string; name: string; avatar_url: string | null }[],
        costumes,
      )
      const byId = new Map(people.map((person) => [person.id, person]))
      setRows(
        scoreRows.flatMap((row) => {
          const person = byId.get(row.user_id)
          return person
            ? [{ user: { id: person.id, name: person.name, costume: person.costume, avatar_url: person.avatar_url, value: row.clicks }, won: row.won }]
            : []
        }),
      )
    },
    state?.running ? 3000 : 10000,
    !dev,
  )

  const running = Boolean(state?.running)
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const endsAt = state?.ends_at ? new Date(state.ends_at).getTime() : 0
  const remaining = endsAt - (now + skew)

  // The fight is over locally before the server confirms it: refresh once.
  useEffect(() => {
    if (running && remaining <= 0) void reload()
  }, [running, remaining, reload])

  if (dev) return null

  const isFighter = clickCount >= FIGHT_MIN_CLICKS
  const nextCallMs = state?.next_call_at ? new Date(state.next_call_at).getTime() - (now + skew) : 0
  const atLimit = state ? state.calls_today >= state.daily_limit : false
  const canCall = isFighter && !running && !atLimit && !busy

  const handleCall = async () => {
    setBusy(true)
    setError('')
    const { error: rpcError } = await supabase.rpc('call_clicker_fight')
    setBusy(false)
    if (rpcError) {
      setError(callError(rpcError.message))
    }
    await reload()
  }

  const board = buildLeaderboard(
    rows.map((row) => row.user),
    userId,
    undefined,
    Number.POSITIVE_INFINITY,
  )
  const wonIds = new Set(rows.filter((row) => row.won).map((row) => row.user.id))

  let hint: string
  if (!isFighter) hint = `Reach ${FIGHT_MIN_CLICKS} clicks to join clicker fights (${clickCount}/${FIGHT_MIN_CLICKS}).`
  else if (running) hint = 'Every click beyond 250 counts. Go!'
  else if (atLimit) hint = nextCallMs > 0 ? `Next fight call in ${formatWait(nextCallMs)}.` : 'No fight calls left.'
  else hint = `Fight calls left: ${Math.max(0, (state?.daily_limit ?? 0) - (state?.calls_today ?? 0))}`

  return (
    <section className="leaderboard clicker-fight" aria-label="Clicker fight" data-testid="clicker-fight">
      <h3>⚔️ Clicker fight</h3>
      {running ? (
        <p data-testid="fight-status" data-state="running">
          <strong>Fight running · {formatDuration(remaining)}</strong>
          {state ? ` · ${state.fighters} fighters` : ''}
        </p>
      ) : (
        <p className="muted" data-testid="fight-status" data-state="idle">
          {state?.fight_id ? 'Last fight finished.' : 'No fight yet.'}
        </p>
      )}
      <button type="button" data-testid="call-fight" disabled={!canCall} onClick={() => void handleCall()}>
        {isFighter ? '⚔️ Call a clicker fight' : `🔒 ${FIGHT_MIN_CLICKS} clicks needed`}
      </button>
      <p className="muted">{hint}</p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {board.length > 0 && (
        <ol className="leaderboard-rows" aria-label="Clicker fight leaderboard">
          {board.map((row) => (
            <li
              key={row.id}
              className={`leaderboard-row${row.isOwn ? ' is-own' : ''}`}
              data-testid="fight-row"
              data-winner={wonIds.has(row.id) ? 'true' : undefined}
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
                  <strong>
                    {wonIds.has(row.id) ? '🏆 ' : ''}
                    {row.name}
                    {row.isOwn ? ' (you)' : ''}
                  </strong>
                  <small>
                    <Costume costume={row.costume} />
                  </small>
                </span>
                <span className="leaderboard-count">{row.value}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
