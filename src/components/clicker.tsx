import { useState } from 'react'
import { grantBadges } from '../utils/badges'
import { supabase } from '../utils/supabase/supabase-client'
import { Leaderboard } from './leaderboard'
import './clicker.css'

// From this many clicks on, the button hops to a random spot on every click.
const JUMP_AFTER_CLICKS = 250

type ClickerProps = {
  userId: string
  clickCount: number
  badges: string[]
  onProgress?: (count: number, badges: string[]) => void
}

export const Clicker = ({ userId, clickCount, badges, onProgress }: ClickerProps) => {
  const [count, setCount] = useState(clickCount)
  const [isUpdating, setIsUpdating] = useState(false)
  const [spot, setSpot] = useState({ x: 0.5, y: 0.5 })

  const [prevClickCount, setPrevClickCount] = useState(clickCount)
  if (prevClickCount !== clickCount) {
    setPrevClickCount(clickCount)
    setCount(clickCount)
  }

  const handleClick = async () => {
    const nextCount = count + 1
    const previousCount = count
    const previousBadges = badges
    const nextBadges = grantBadges(nextCount, badges)

    setCount(nextCount)
    if (nextCount >= JUMP_AFTER_CLICKS) setSpot({ x: Math.random(), y: Math.random() })
    onProgress?.(nextCount, nextBadges)
    setIsUpdating(true)

    const { error } = await supabase
      .from('users')
      .update({ click_count: nextCount, badges: nextBadges })
      .eq('id', userId)

    if (error) {
      console.error('Failed to save click count:', error)
      setCount(previousCount)
      onProgress?.(previousCount, previousBadges)
    }

    setIsUpdating(false)
  }

  const isJumping = count >= JUMP_AFTER_CLICKS

  return (
    <section className="clicker-section">
      <h2>Clicker</h2>
      <p className="clicker-count">{count}</p>
      <div className={`clicker-arena${isJumping ? ' is-jumping' : ''}`}>
        <button
          type="button"
          className="clicker-button"
          style={isJumping ? { left: `calc((100% - 8rem) * ${spot.x})`, top: `calc((100% - 3rem) * ${spot.y})` } : undefined}
          onClick={handleClick}
          disabled={isUpdating}
        >
          {isUpdating ? 'Saving...' : 'Click me'}
        </button>
      </div>
      <Leaderboard userId={userId} column="click_count" label="Click" ownValue={count} />
    </section>
  )
}
