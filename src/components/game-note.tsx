import { useState } from 'react'
import type { ReactNode } from 'react'

type GameNoteProps = {
  gameId: string
  children: ReactNode
}

const storageKey = (gameId: string) => `spookify-note-dismissed:${gameId}`

function readDismissed(gameId: string): boolean {
  try {
    return window.sessionStorage.getItem(storageKey(gameId)) === '1'
  } catch {
    return false
  }
}

// A hint that stays dismissed for the browser session.
export function GameNote({ gameId, children }: GameNoteProps) {
  const [dismissed, setDismissed] = useState(() => readDismissed(gameId))

  if (dismissed) return null

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(storageKey(gameId), '1')
    } catch {
      // Storage can be unavailable; the note then only stays hidden until the next visit.
    }
    setDismissed(true)
  }

  return (
    <div className="game-note" role="note" data-testid={`game-note-${gameId}`}>
      <p>{children}</p>
      <button type="button" className="game-note-dismiss" aria-label="Dismiss note" onClick={dismiss}>
        ✕
      </button>
    </div>
  )
}
