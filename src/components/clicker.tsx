import { useState } from 'react'
import { getUserBadges } from '../utils/badges'
import { supabase } from '../utils/supabase/supabase-client'

type ClickerProps = {
  userId: string
  clickCount: number
  onCountChange?: (count: number) => void
}

export const Clicker = ({ userId, clickCount, onCountChange }: ClickerProps) => {
  const [count, setCount] = useState(clickCount)
  const [isUpdating, setIsUpdating] = useState(false)
  const [badges, setBadges] = useState<string[]>(getUserBadges(clickCount))

  const [prevClickCount, setPrevClickCount] = useState(clickCount)
  if (prevClickCount !== clickCount) {
    setPrevClickCount(clickCount)
    setCount(clickCount)
    setBadges(getUserBadges(clickCount))
  }

  const handleClick = async () => {
    const nextCount = count + 1
    const previousCount = count
    const nextBadges = getUserBadges(nextCount)

    setCount(nextCount)
    setBadges(nextBadges)
    onCountChange?.(nextCount)
    setIsUpdating(true)

    const { error } = await supabase.from('users').update({ click_count: nextCount }).eq('id', userId)

    if (error) {
      console.error('Failed to save click count:', error)
      setCount(previousCount)
      setBadges(getUserBadges(previousCount))
      onCountChange?.(previousCount)
    }

    setIsUpdating(false)
  }

  return (
    <section className="clicker-section">
      <h2>Clicker</h2>
      <p className="clicker-count">{count}</p>
      <p className={badges.includes('clicker') ? 'form-success' : 'muted'}>
        {badges.includes('clicker') ? 'Badge unlocked: clicker' : 'Reach 500 clicks to unlock the clicker badge.'}
      </p>
      <button type="button" onClick={handleClick} disabled={isUpdating}>
        {isUpdating ? 'Saving...' : 'Click me'}
      </button>
    </section>
  )
}
