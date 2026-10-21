import { useEffect, useState } from 'react'
import { getUnlockedBadges, grantBadges } from '../utils/badges'
import { supabase } from '../utils/supabase/supabase-client'

type WinnerBadge = { vote_id: string; category: string }

type ClickerProps = {
  userId: string
  clickCount: number
  badges: string[]
  dismissedBadgeIds: string[]
  onProgress?: (count: number, badges: string[]) => void
  onDismissBadge?: (badgeId: string) => void
}

export const Clicker = ({ userId, clickCount, badges, dismissedBadgeIds, onProgress, onDismissBadge }: ClickerProps) => {
  const [count, setCount] = useState(clickCount)
  const [isUpdating, setIsUpdating] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [winnerBadges, setWinnerBadges] = useState<WinnerBadge[]>([])

  useEffect(() => {
    let cancelled = false

    const loadWinnerBadges = async () => {
      const { data, error } = await supabase
        .from('vote_winners')
        .select('vote_id, votes(category)')
        .eq('user_id', userId)
      if (cancelled || error) return

      const rows = (data ?? []) as unknown as { vote_id: string; votes: { category: string } | null }[]
      setWinnerBadges(rows.flatMap((row) => (row.votes ? [{ vote_id: row.vote_id, category: row.votes.category }] : [])))
    }

    void loadWinnerBadges()
    return () => {
      cancelled = true
    }
  }, [userId])

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

  const unlocked = getUnlockedBadges(badges)
  const banners = unlocked.filter((badge) => !dismissedBadgeIds.includes(badge.id))

  return (
    <section className="clicker-section">
      <h2>Clicker</h2>
      <p className="clicker-count">{count}</p>
      <button type="button" onClick={handleClick} disabled={isUpdating}>
        {isUpdating ? 'Saving...' : 'Click me'}
      </button>
      {banners.map((badge) => (
        <div key={badge.id} className="row row--between form-success" role="status">
          <span>{badge.message}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => onDismissBadge?.(badge.id)}>
            ✕
          </button>
        </div>
      ))}
      {winnerBadges.length > 0 && (
        <ul className="list" aria-label="Winner badges">
          {winnerBadges.map((badge) => (
            <li key={badge.vote_id} data-testid="winner-badge">
              🏆 Gewinner von {badge.category}
            </li>
          ))}
        </ul>
      )}
      {unlocked.length > 0 && (
        <>
          <button type="button" onClick={() => setShowAll((current) => !current)}>
            {showAll ? 'Hide badge messages' : 'Show badge messages'}
          </button>
          {showAll && (
            <ul className="list">
              {unlocked.map((badge) => (
                <li key={badge.id}>{badge.message}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
