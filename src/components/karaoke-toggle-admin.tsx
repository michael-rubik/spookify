import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase/supabase-client'

type Props = {
  onChange?: () => void
}

export const KaraokeToggleAdmin = ({ onChange }: Props) => {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error: loadError } = await supabase.rpc('karaoke_enabled')
      if (cancelled) return
      if (loadError || typeof data !== 'boolean') {
        console.error('Failed to load karaoke setting:', loadError)
        setError('Could not load the karaoke setting.')
        return
      }
      setEnabled(data)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = async () => {
    if (enabled === null) return
    const next = !enabled
    setIsBusy(true)
    setError('')
    const { error: saveError } = await supabase.rpc('set_karaoke_enabled', { p_enabled: next })
    setIsBusy(false)
    if (saveError) {
      console.error('Failed to change karaoke setting:', saveError)
      setError(saveError.message || 'Could not change the karaoke setting.')
      return
    }
    setEnabled(next)
    onChange?.()
  }

  return (
    <div className="card stack" data-testid="karaoke-toggle-admin">
      <h3>Karaoke</h3>
      <p className="muted">
        {enabled === false
          ? '🎤 Karaoke is off: it is hidden from the menu and nobody can add songs to the queue.'
          : 'Karaoke is on: everyone can see the queue and add songs.'}
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button type="button" disabled={isBusy || enabled === null} onClick={toggle}>
        {enabled === false ? 'Enable karaoke' : 'Disable karaoke'}
      </button>
    </div>
  )
}
