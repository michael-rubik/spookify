import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase/supabase-client'

type Props = {
  onChange?: () => void
}

export const CostumeVisibilityAdmin = ({ onChange }: Props) => {
  const [hidden, setHidden] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error: loadError } = await supabase.rpc('costumes_hidden')
      if (cancelled) return
      if (loadError || typeof data !== 'boolean') {
        console.error('Failed to load costume visibility:', loadError)
        setError('Could not load the costume visibility.')
        return
      }
      setHidden(data)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = async () => {
    if (hidden === null) return
    const next = !hidden
    setIsBusy(true)
    setError('')
    const { error: saveError } = await supabase.rpc('set_costumes_hidden', { p_hidden: next })
    setIsBusy(false)
    if (saveError) {
      console.error('Failed to change costume visibility:', saveError)
      setError(saveError.message || 'Could not change the costume visibility.')
      return
    }
    setHidden(next)
    onChange?.()
  }

  return (
    <div className="card stack" data-testid="costume-visibility-admin">
      <h3>Costume visibility</h3>
      <p className="muted">
        {hidden
          ? 'All costumes are hidden: every user only sees their own costume.'
          : 'All costumes are visible to every user.'}
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button type="button" disabled={isBusy || hidden === null} onClick={toggle}>
        {hidden ? 'Show all costumes' : 'Hide all costumes'}
      </button>
    </div>
  )
}
