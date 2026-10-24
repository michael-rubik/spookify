import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import { MAX_LEVEL_BONUS_FIGHTS, MAX_LEVEL_BONUS_SONGS, MAX_LEVEL_XP, type PassLevel } from '../utils/battle-pass'

const MAX_DAILY_SONG_LIMIT = 1000

const isWholeNumber = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max

type LevelRowProps = {
  level: PassLevel
  position: number
  disabled: boolean
  onSave: (level: PassLevel, xp: number, bonus: number, fights: number) => unknown
  onDelete: (level: PassLevel) => unknown
}

const LevelRow = ({ level, position, disabled, onSave, onDelete }: LevelRowProps) => {
  const [xp, setXp] = useState<string | null>(null)
  const [bonus, setBonus] = useState<string | null>(null)
  const [fights, setFights] = useState<string | null>(null)

  const commit = () => {
    if (xp === null && bonus === null && fights === null) return
    const nextXp = Number(xp ?? level.xp_required)
    const nextBonus = Number(bonus ?? level.bonus_songs)
    const nextFights = Number(fights ?? level.bonus_fights)
    setXp(null)
    setBonus(null)
    setFights(null)
    if (nextXp !== level.xp_required || nextBonus !== level.bonus_songs || nextFights !== level.bonus_fights) {
      void onSave(level, nextXp, nextBonus, nextFights)
    }
  }

  return (
    <li className="row row--between" data-testid="level-row">
      <strong>Milestone {position}</strong>
      <label className="row">
        <span className="muted">XP</span>
        <input
          type="number"
          min={0}
          max={MAX_LEVEL_XP}
          disabled={disabled}
          aria-label={`XP needed for milestone ${position}`}
          value={xp ?? String(level.xp_required)}
          onChange={(event) => setXp(event.target.value)}
          onBlur={commit}
        />
      </label>
      <label className="row">
        <span className="muted">Reward: bonus songs</span>
        <input
          type="number"
          min={0}
          max={MAX_LEVEL_BONUS_SONGS}
          disabled={disabled}
          aria-label={`Reward (bonus songs) for milestone ${position}`}
          value={bonus ?? String(level.bonus_songs)}
          onChange={(event) => setBonus(event.target.value)}
          onBlur={commit}
        />
      </label>
      <label className="row">
        <span className="muted">Reward: bonus fights</span>
        <input
          type="number"
          min={0}
          max={MAX_LEVEL_BONUS_FIGHTS}
          disabled={disabled}
          aria-label={`Reward (bonus fights) for milestone ${position}`}
          value={fights ?? String(level.bonus_fights)}
          onChange={(event) => setFights(event.target.value)}
          onBlur={commit}
        />
      </label>
      <button type="button" disabled={disabled} onClick={() => onDelete(level)}>
        Delete
      </button>
    </li>
  )
}

const fetchLevels = () =>
  supabase.from('battle_pass_levels').select('id, xp_required, bonus_songs, bonus_fights').order('xp_required', { ascending: true })

export const SongLimitAdmin = () => {
  const [limit, setLimit] = useState('')
  const [levels, setLevels] = useState<PassLevel[]>([])
  const [newXp, setNewXp] = useState('')
  const [newBonus, setNewBonus] = useState('1')
  const [newFights, setNewFights] = useState('0')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [loadedLimit, setLoadedLimit] = useState<number | null>(null)

  const reloadLevels = async () => {
    const { data, error: levelsError } = await fetchLevels()
    if (levelsError) {
      console.error('Failed to load levels:', levelsError)
      setError('Could not load the battle pass milestones.')
      return
    }
    setLevels((data ?? []) as PassLevel[])
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [limitResult, levelsResult] = await Promise.all([supabase.rpc('daily_song_limit'), fetchLevels()])
      if (cancelled) return
      if (limitResult.error || typeof limitResult.data !== 'number' || levelsResult.error) {
        console.error('Failed to load song limits:', limitResult.error ?? levelsResult.error)
        setError('Could not load the song limits.')
        return
      }
      setLoadedLimit(limitResult.data)
      setLimit(String(limitResult.data))
      setLevels((levelsResult.data ?? []) as PassLevel[])
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const run = async (action: () => PromiseLike<{ error: { message: string } | null }>, success: string) => {
    setIsBusy(true)
    setError('')
    setMessage('')
    const { error: actionError } = await action()
    setIsBusy(false)

    if (actionError) {
      console.error('Song limit action failed:', actionError)
      const duplicate = actionError.message.includes('duplicate key')
      setError(duplicate ? 'Another milestone already needs that much XP.' : actionError.message || 'That action failed.')
      await reloadLevels()
      return false
    }

    setMessage(success)
    await reloadLevels()
    return true
  }

  const handleSaveLimit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = Number(limit)
    if (!isWholeNumber(value, MAX_DAILY_SONG_LIMIT)) {
      setError(`Enter a whole number from 0 to ${MAX_DAILY_SONG_LIMIT}.`)
      return
    }

    if (await run(() => supabase.rpc('set_daily_song_limit', { p_limit: value }), 'Song limit saved.')) {
      setLoadedLimit(value)
    }
  }

  const validLevel = (xp: number, bonus: number, fights: number) => {
    if (isWholeNumber(xp, MAX_LEVEL_XP) && isWholeNumber(bonus, MAX_LEVEL_BONUS_SONGS) && isWholeNumber(fights, MAX_LEVEL_BONUS_FIGHTS)) {
      return true
    }
    setError(`XP must be 0 to ${MAX_LEVEL_XP}, bonus songs 0 to ${MAX_LEVEL_BONUS_SONGS} and bonus fights 0 to ${MAX_LEVEL_BONUS_FIGHTS}.`)
    return false
  }

  const handleAddLevel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const xp = Number(newXp)
    const bonus = Number(newBonus)
    const fights = Number(newFights)
    if (!validLevel(xp, bonus, fights)) return

    if (await run(() => supabase.from('battle_pass_levels').insert({ xp_required: xp, bonus_songs: bonus, bonus_fights: fights }), 'Milestone added.')) {
      setNewXp('')
    }
  }

  const handleSaveLevel = (level: PassLevel, xp: number, bonus: number, fights: number) => {
    if (!validLevel(xp, bonus, fights)) return
    return run(
      () => supabase.from('battle_pass_levels').update({ xp_required: xp, bonus_songs: bonus, bonus_fights: fights }).eq('id', level.id),
      'Milestone saved.',
    )
  }

  const handleDeleteLevel = (level: PassLevel) => {
    if (!window.confirm(`Delete the milestone at ${level.xp_required} XP?`)) return
    void run(() => supabase.from('battle_pass_levels').delete().eq('id', level.id), 'Milestone deleted.')
  }

  return (
    <div className="card stack" data-testid="song-limit-admin">
      <h3>Song limit</h3>
      <p className="muted">
        Songs each user may add to the Spookify pool per day (resets at midnight): the base limit plus the bonus songs of every battle pass reward they have unlocked.
      </p>
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
      <form onSubmit={handleSaveLimit} className="row">
        <label htmlFor="daily-song-limit">Base songs per day</label>
        <input
          id="daily-song-limit"
          type="number"
          min={0}
          max={MAX_DAILY_SONG_LIMIT}
          required
          disabled={loadedLimit === null}
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
        />
        <button type="submit" disabled={isBusy || loadedLimit === null}>
          Save
        </button>
      </form>

      <h4 style={{ margin: 0 }}>Battle pass milestones</h4>
      {levels.length > 0 && (
        <ul className="list" aria-label="Battle pass milestones">
          {levels.map((level, index) => (
            <LevelRow
              key={`${level.id}-${level.xp_required}-${level.bonus_songs}`}
              level={level}
              position={index + 1}
              disabled={isBusy}
              onSave={handleSaveLevel}
              onDelete={handleDeleteLevel}
            />
          ))}
        </ul>
      )}
      <form onSubmit={handleAddLevel} className="row">
        <label htmlFor="new-level-xp">XP needed</label>
        <input
          id="new-level-xp"
          type="number"
          min={0}
          max={MAX_LEVEL_XP}
          required
          value={newXp}
          onChange={(event) => setNewXp(event.target.value)}
        />
        <label htmlFor="new-level-bonus">Reward: bonus songs</label>
        <input
          id="new-level-bonus"
          type="number"
          min={0}
          max={MAX_LEVEL_BONUS_SONGS}
          required
          value={newBonus}
          onChange={(event) => setNewBonus(event.target.value)}
        />
        <label htmlFor="new-level-fights">Reward: bonus fights</label>
        <input
          id="new-level-fights"
          type="number"
          min={0}
          max={MAX_LEVEL_BONUS_FIGHTS}
          required
          value={newFights}
          onChange={(event) => setNewFights(event.target.value)}
        />
        <button type="submit" disabled={isBusy}>
          Add milestone
        </button>
      </form>
    </div>
  )
}
