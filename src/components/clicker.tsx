import { useCallback, useEffect, useRef, useState } from 'react'
import { grantBadges } from '../utils/badges'
import { supabase } from '../utils/supabase/supabase-client'
import { Leaderboard } from './leaderboard'
import './clicker.css'

// From this many clicks on, the button hops to a random spot on every click.
const JUMP_AFTER_CLICKS = 250
// Clicks are sent to the server in batches rather than one request per tap.
const FLUSH_DELAY_MS = 1000

type ClickerProps = {
  userId: string
  clickCount: number
  badges: string[]
  onProgress?: (count: number, badges: string[]) => void
}

export const Clicker = ({ userId, clickCount, badges, onProgress }: ClickerProps) => {
  // Clicks not yet confirmed by the server; the shown count is the saved count plus these.
  const [pending, setPending] = useState(0)
  const [spot, setSpot] = useState({ x: 0.5, y: 0.5 })
  const unsent = useRef(0)
  const timer = useRef<number | null>(null)
  const latest = useRef({ badges, onProgress })

  useEffect(() => {
    latest.current = { badges, onProgress }
  })

  const flush = useCallback(async () => {
    const batch = unsent.current
    if (!batch) return
    unsent.current = 0

    const { data, error } = await supabase.rpc('register_clicks', { p_count: batch })

    if (error) {
      console.error('Failed to save clicks:', error)
      unsent.current += batch
      return
    }

    const saved = Number(data)
    setPending((current) => current - batch)
    latest.current.onProgress?.(saved, grantBadges(saved, latest.current.badges))
  }, [])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      void flush()
    },
    [flush],
  )

  const count = clickCount + pending

  const handleClick = () => {
    unsent.current += 1
    setPending((current) => current + 1)
    if (count + 1 >= JUMP_AFTER_CLICKS) setSpot({ x: Math.random(), y: Math.random() })
    if (timer.current === null) {
      timer.current = window.setTimeout(() => {
        timer.current = null
        void flush()
      }, FLUSH_DELAY_MS)
    }
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
        >
          Click me
        </button>
      </div>
      <Leaderboard userId={userId} column="click_count" label="Click" ownValue={count} />
    </section>
  )
}
