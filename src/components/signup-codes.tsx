import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'

type SignupCode = {
  id: string
  code: string
  seats: number
  seats_used: number
}

export const SignupCodes = () => {
  const [codes, setCodes] = useState<SignupCode[]>([])
  const [code, setCode] = useState('')
  const [seats, setSeats] = useState('10')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const reloadRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const { data, error: loadError } = await supabase
        .from('signup_codes')
        .select('id, code, seats, seats_used')
        .order('created_at', { ascending: false })

      if (cancelled) return

      if (loadError) {
        console.error('Failed to load signup codes:', loadError)
        setError('Could not load signup codes.')
        return
      }

      setCodes((data ?? []) as SignupCode[])
    }

    reloadRef.current = load
    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    const cleanedCode = code.trim()
    const seatCount = Number(seats)

    if (!cleanedCode || !Number.isInteger(seatCount) || seatCount < 1) {
      setError('Enter a code and a whole number of seats (at least 1).')
      return
    }

    setIsSaving(true)
    const { error: insertError } = await supabase.from('signup_codes').insert({ code: cleanedCode, seats: seatCount })
    setIsSaving(false)

    if (insertError) {
      console.error('Failed to add signup code:', insertError)
      setError(insertError.code === '23505' ? 'That code already exists.' : 'Could not add the signup code.')
      return
    }

    setCode('')
    await reloadRef.current()
  }

  const handleRemove = async (target: SignupCode) => {
    setError('')

    if (!window.confirm(`Remove signup code "${target.code}"? It will stop working immediately.`)) {
      return
    }

    const { error: deleteError } = await supabase.from('signup_codes').delete().eq('id', target.id)

    if (deleteError) {
      console.error('Failed to remove signup code:', deleteError)
      setError('Could not remove the signup code.')
      return
    }

    await reloadRef.current()
  }

  return (
    <div className="card stack">
      <h3 style={{ margin: 0 }}>Signup codes</h3>

      <form onSubmit={handleAdd} className="row">
        <input
          type="text"
          placeholder="Code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          required
        />
        <input
          type="number"
          min={1}
          step={1}
          aria-label="Seats"
          placeholder="Seats"
          value={seats}
          onChange={(event) => setSeats(event.target.value)}
          required
        />
        <button type="submit" disabled={isSaving}>Add code</button>
      </form>

      {error && <p role="alert">{error}</p>}

      {codes.length === 0 ? (
        <p className="muted">No signup codes yet. Nobody can sign up until you add one.</p>
      ) : (
        <ul className="list">
          {codes.map((entry) => (
            <li key={entry.id} className="row row--between">
              <span>
                <strong>{entry.code}</strong>{' '}
                <span className="muted">
                  {Math.max(entry.seats - entry.seats_used, 0)} of {entry.seats} seats left
                </span>
              </span>
              <button type="button" onClick={() => void handleRemove(entry)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
