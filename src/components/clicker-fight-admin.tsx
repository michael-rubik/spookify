import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'

type Settings = { duration_minutes: number; daily_limit: number }

export const ClickerFightAdmin = () => {
  const [minutes, setMinutes] = useState('')
  const [limit, setLimit] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data, error: loadError } = await supabase.rpc('clicker_fight_settings')
      if (cancelled) return
      const settings = (data as Settings[] | null)?.[0]
      if (loadError || !settings) {
        console.error('Failed to load clicker fight settings:', loadError)
        setError('Could not load the clicker fight settings.')
        return
      }
      setMinutes(String(settings.duration_minutes))
      setLimit(String(settings.daily_limit))
      setLoaded(true)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const m = Number(minutes)
    const l = Number(limit)
    if (!Number.isInteger(m) || m < 1 || m > 120 || !Number.isInteger(l) || l < 0 || l > 100) {
      setError('A fight lasts 1 to 120 minutes and the daily limit is 0 to 100.')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    const { error: saveError } = await supabase.rpc('set_clicker_fight_settings', { p_minutes: m, p_limit: l })
    setBusy(false)
    if (saveError) {
      console.error('Failed to save clicker fight settings:', saveError)
      setError(saveError.message || 'That action failed.')
      return
    }
    setMessage('Clicker fight settings saved.')
  }

  return (
    <div className="card stack" data-testid="clicker-fight-admin">
      <h3>Clicker fights</h3>
      <p className="muted">
        Players with 250+ clicks may call a fight. Milestones can add bonus fights per day on top of the base limit.
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
      <form onSubmit={handleSave} className="row">
        <label htmlFor="fight-minutes">Fight length (minutes)</label>
        <input
          id="fight-minutes"
          type="number"
          min={1}
          max={120}
          required
          disabled={!loaded}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
        />
        <label htmlFor="fight-daily-limit">Base fight calls per day</label>
        <input
          id="fight-daily-limit"
          type="number"
          min={0}
          max={100}
          required
          disabled={!loaded}
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
        />
        <button type="submit" disabled={busy || !loaded}>
          Save
        </button>
      </form>
    </div>
  )
}
