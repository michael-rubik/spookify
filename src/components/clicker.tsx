import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase/supabase-client'

type ClickerProps = {
  userId: string
  clickCount: number
  onCountChange?: (count: number) => void
}

export const Clicker = ({ userId, clickCount, onCountChange }: ClickerProps) => {
  const [count, setCount] = useState(clickCount)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    setCount(clickCount)
  }, [clickCount])

  const handleClick = async () => {
    const nextCount = count + 1
    const previousCount = count

    setCount(nextCount)
    onCountChange?.(nextCount)
    setIsUpdating(true)

    const { error } = await supabase.from('users').update({ click_count: nextCount }).eq('id', userId)

    if (error) {
      console.error('Failed to save click count:', error)
      setCount(previousCount)
      onCountChange?.(previousCount)
    }

    setIsUpdating(false)
  }

  return (
    <section style={{ maxWidth: '420px', margin: '0 auto', textAlign: 'center' }}>
      <h2>Clicker</h2>
      <p style={{ fontSize: '2rem', margin: '1rem 0' }}>{count}</p>
      <button type="button" onClick={handleClick} disabled={isUpdating} style={{ fontSize: '1rem', padding: '0.75rem 1.25rem' }}>
        {isUpdating ? 'Saving...' : 'Click me'}
      </button>
    </section>
  )
}
