import { useEffect, useRef, useState } from 'react'
import type { View } from '../utils/routes'

type AccountMenuProps = {
  name: string | null
  avatarUrl: string | null
  view: View
  onNavigate: (view: View) => void
  onLogout: () => void
}

export function AccountMenu({ name, avatarUrl, view, onNavigate, onLogout }: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const isActive = view === 'profile' || view === 'users'

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const select = (action: () => void) => {
    setIsOpen(false)
    action()
  }

  return (
    <div className="account-menu" ref={containerRef}>
      <button
        type="button"
        className={`account-menu-trigger${isActive ? ' is-active' : ''}`}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="avatar avatar--lg" />
        ) : (
          <span className="avatar avatar--lg avatar--fallback" aria-hidden="true">
            {name?.slice(0, 1)?.toUpperCase() ?? 'U'}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="account-menu-list" role="menu">
          <button type="button" role="menuitem" onClick={() => select(() => onNavigate('profile'))}>
            Profile
          </button>
          <button type="button" role="menuitem" onClick={() => select(() => onNavigate('users'))}>
            Users
          </button>
          <button type="button" role="menuitem" onClick={() => select(onLogout)}>
            Logout
          </button>
        </div>
      )}
    </div>
  )
}
