import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './utils/supabase/supabase-client'
import { AccountMenu } from './components/account-menu'
import { Auth } from './components/auth'
import { Clicker } from './components/clicker'
import { Karaoke } from './components/karaoke'
import { Poll } from './components/poll'
import { SignupCodes } from './components/signup-codes'
import { Spooks } from './components/spooks'
import { Spookify } from './components/spookify'
import { VotesAdmin } from './components/votes-admin'
import { badgeDisplayName, CUSTOM_BADGE_MAX_LENGTH, giveCustomBadge, grantBadges } from './utils/badges'
import { clampPoints, DEFAULT_CUSTOM_POINTS, hasUnseenBadges, MAX_BADGE_POINTS, PASS_BADGES } from './utils/battle-pass'
import { BattlePass } from './components/battle-pass'
import { BadgePointsAdmin } from './components/badge-points-admin'
import { formatSpookifyScore } from './utils/spookify'
import { usePolling } from './utils/use-polling'
import { navigate, useRoute } from './utils/use-route'
import { pathFor, type View } from './utils/routes'
import { getDevAdminUser, getDevSession, isDevLoginEnabled } from './utils/dev-login'

type UserProfile = {
  id: string
  name: string
  costume: string
  email: string
  avatar_url: string | null
  badges: string[]
  is_admin: boolean
  click_count: number
  spookify_score?: number | string | null
  signup_code_id?: string | null
  deletion_pending_at?: string | null
}

type ProfileDraft = {
  name: string
  costume: string
  email: string
}

const emptyProfileDraft: ProfileDraft = { name: '', costume: '', email: '' }

function readSeenBadges(userId: string | undefined): string[] {
  if (!userId) return []
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(`spookify:seen-badges:${userId}`) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function App() {
  const initialDevUser = getDevAdminUser()

  const [session, setSession] = useState<Session | null>(() => (isDevLoginEnabled() ? getDevSession() : null))
  const [users, setUsers] = useState<UserProfile[]>(() =>
    initialDevUser
      ? [
          {
            id: initialDevUser.id,
            name: initialDevUser.name,
            costume: initialDevUser.costume,
            email: initialDevUser.email,
            avatar_url: initialDevUser.avatar_url,
            badges: initialDevUser.badges,
            is_admin: initialDevUser.is_admin,
            click_count: initialDevUser.click_count,
          },
        ]
      : [],
  )
  const [loadingUsers, setLoadingUsers] = useState(false)
  const route = useRoute()
  const view = route.view
  const setView = (nextView: View) => navigate(pathFor(nextView))
  const [hasVotes, setHasVotes] = useState(false)
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(emptyProfileDraft)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [renamingUserId, setRenamingUserId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [seenByUser, setSeenByUser] = useState<Record<string, string[]>>({})
  const [badgeProgress, setBadgeProgress] = useState<Record<string, number>>({})
  const [badgeLabel, setBadgeLabel] = useState('')
  const [badgePoints, setBadgePoints] = useState(String(DEFAULT_CUSTOM_POINTS))
  const [pointsRefresh, setPointsRefresh] = useState(0)
  const [badgeRecipientIds, setBadgeRecipientIds] = useState<string[]>([])
  const [isGivingBadge, setIsGivingBadge] = useState(false)
  const [badgeFeedback, setBadgeFeedback] = useState('')
  const [deletionError, setDeletionError] = useState('')
  const [deletionMessage, setDeletionMessage] = useState('')
  const [accountStatus, setAccountStatus] = useState<'checking' | 'active' | 'pending' | 'missing' | 'error'>(
    () => isDevLoginEnabled() ? 'active' : 'checking',
  )

  useEffect(() => {
    if (isDevLoginEnabled()) {
      return
    }

    const loadSession = async () => {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession()
      setSession(currentSession)
    }

    loadSession()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession)
      if (!currentSession) {
        setUsers([])
      }
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  const pollingEnabled = !!session && !isDevLoginEnabled()

  const hasLoadedUsers = useRef(false)
  const sessionUserId = session?.user.id
  useEffect(() => {
    hasLoadedUsers.current = false
  }, [sessionUserId])

  const reloadUsers = usePolling(
    async (isCancelled) => {
      if (!session) return
      // Only the first load shows a loading state; background refetches swap values in silently.
      if (!hasLoadedUsers.current) setLoadingUsers(true)

      const { data, error } = await supabase.from('users').select('*').order('name', { ascending: true })
      if (isCancelled()) return

      if (error) {
        console.error('Failed to load users:', error)
        if (!hasLoadedUsers.current) setAccountStatus('error')
        setLoadingUsers(false)
        return
      }

      const profiles = (data ?? []) as UserProfile[]
      const ownProfile = profiles.find((user) => user.id === session.user.id)
      hasLoadedUsers.current = true
      setAccountStatus(!ownProfile ? 'missing' : ownProfile.deletion_pending_at ? 'pending' : 'active')
      setUsers(profiles)
      setLoadingUsers(false)
    },
    15000,
    pollingEnabled,
  )

  // The Poll view stays hidden until the first vote has been started.
  usePolling(
    async (isCancelled) => {
      const { count, error } = await supabase.from('votes').select('id', { count: 'exact', head: true })
      if (isCancelled() || error) return
      setHasVotes((count ?? 0) > 0)
    },
    15000,
    pollingEnabled,
  )


  const handleLogout = async () => {
    if (isDevLoginEnabled()) {
      setSession(null)
      setUsers([])
      setView('clicker')
      return
    }

    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('Logout failed:', error)
    }
  }

  const currentUser = users.find((user) => user.id === session?.user.id) ?? null
  const isCurrentUserAdmin = accountStatus === 'active' && Boolean(currentUser?.is_admin && !currentUser.deletion_pending_at)
  const activeUsers = users.filter((user) => !user.deletion_pending_at)
  const hasAnyAdminUsers = users.some((user) => user.is_admin)

  // Asking for progress also awards any badge whose goal was reached; reload the users when that happens.
  usePolling(
    async (isCancelled) => {
      const { data, error } = await supabase.rpc('my_badge_progress')
      if (isCancelled() || error) return

      const rows = (data ?? []) as { badge_id: string; progress: number | string }[]
      const progress = Object.fromEntries(rows.map((row) => [row.badge_id, Number(row.progress)]))
      setBadgeProgress(progress)

      const held = currentUser?.badges ?? []
      if (PASS_BADGES.some((badge) => (progress[badge.id] ?? 0) >= badge.target && !held.includes(badge.id))) {
        await reloadUsers()
      }
    },
    15000,
    pollingEnabled && accountStatus === 'active',
  )

  const heldBadgeIds = currentUser?.badges ?? []
  const seenBadgeIds = seenByUser[sessionUserId ?? ''] ?? readSeenBadges(sessionUserId)
  // Opening the pass marks everything held as seen (adjusted during render, like the clicker's count sync).
  if (sessionUserId && view === 'battlepass' && hasUnseenBadges(heldBadgeIds, seenBadgeIds)) {
    setSeenByUser((current) => ({ ...current, [sessionUserId]: heldBadgeIds }))
  }
  const hasNewBadges = view !== 'battlepass' && hasUnseenBadges(heldBadgeIds, seenBadgeIds)

  useEffect(() => {
    for (const [userId, ids] of Object.entries(seenByUser)) {
      window.localStorage.setItem(`spookify:seen-badges:${userId}`, JSON.stringify(ids))
    }
  }, [seenByUser])


  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!session) {
      return
    }

    const nextName = profileDraft.name.trim()
    const nextCostume = profileDraft.costume.trim()

    if (!nextName || !nextCostume) {
      setProfileError('Please fill in your name and costume.')
      return
    }

    setIsSavingProfile(true)
    setProfileError('')
    setProfileMessage('')

    try {
      const { data, error } = await supabase
        .from('users')
        .update({
          name: nextName,
          costume: nextCostume,
        })
        .eq('id', session.user.id)
        .select()
        .single()

      if (error) {
        throw error
      }

      const savedUser = data as UserProfile | null

      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          user.id === session.user.id
            ? {
                ...user,
                name: savedUser?.name ?? nextName,
                costume: savedUser?.costume ?? nextCostume,
              }
            : user,
        ),
      )

      setProfileDraft((current) => ({ ...current, name: nextName, costume: nextCostume }))
      setProfileMessage('Profile saved successfully.')
    } catch (error) {
      console.error('Failed to save profile:', error)
      setProfileError(
        (error as { code?: string } | null)?.code === '23505'
          ? 'Someone already has that costume. Please pick another one.'
          : 'Could not save your profile. Please try again.',
      )
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file || !session) {
      return
    }

    if (!file.type.startsWith('image/')) {
      setProfileError('Please choose a valid image file for your profile picture.')
      return
    }

    const safeFileName = `${session.user.id}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(safeFileName, file, { upsert: true, cacheControl: '3600' })

    if (uploadError) {
      console.error('Avatar upload failed:', uploadError)
      setProfileError('Could not upload your profile picture. Please try again.')
      return
    }

    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(uploadData.path)
    const nextAvatarUrl = publicUrlData.publicUrl

    const { data, error } = await supabase
      .from('users')
      .update({ avatar_url: nextAvatarUrl })
      .eq('id', session.user.id)
      .select()
      .single()

    if (error) {
      console.error('Failed to save avatar URL:', error)
      setProfileError('Your picture uploaded, but the profile could not be saved.')
      return
    }

    const savedUser = data as UserProfile | null

    setUsers((currentUsers) =>
      currentUsers.map((user) =>
        user.id === session.user.id
          ? {
              ...user,
              avatar_url: savedUser?.avatar_url ?? nextAvatarUrl,
            }
          : user,
      ),
    )

    setProfileMessage('Profile picture updated successfully.')
    setProfileError('')
  }

  const handleToggleAdmin = async (userId: string, currentValue: boolean) => {
    if (!isCurrentUserAdmin) {
      return
    }

    const nextValue = !currentValue

    const { error } = await supabase.from('users').update({ is_admin: nextValue }).eq('id', userId)

    if (error) {
      console.error('Failed to update admin status:', error)
      return
    }

    setUsers((currentUsers) =>
      currentUsers.map((user) => (user.id === userId ? { ...user, is_admin: nextValue } : user)),
    )
  }

  const handleRenameUser = async (event: FormEvent<HTMLFormElement>, userId: string) => {
    event.preventDefault()

    const nextName = renameDraft.trim()

    if (!isCurrentUserAdmin || !nextName) {
      setRenameError('Name cannot be empty.')
      return
    }

    setIsRenaming(true)
    setRenameError('')

    const { error } = await supabase.from('users').update({ name: nextName }).eq('id', userId)

    setIsRenaming(false)

    if (error) {
      console.error('Failed to rename user:', error)
      setRenameError('Could not rename user.')
      return
    }

    setUsers((currentUsers) =>
      currentUsers.map((user) => (user.id === userId ? { ...user, name: nextName } : user)),
    )
    setRenamingUserId(null)
  }

  const handleRefreshBadges = async () => {
    if (!isCurrentUserAdmin) {
      return
    }

    const updatedUsers = users.filter((user) => !user.deletion_pending_at).map((user) => ({
      ...user,
      badges: grantBadges(user.click_count, user.badges),
    }))

    await Promise.all(
      updatedUsers.map(async (user) => {
        const { error } = await supabase.from('users').update({ badges: user.badges }).eq('id', user.id)

        if (error) {
          console.error('Failed to refresh badges for user:', user.id, error)
        }
      }),
    )

    setUsers((current) => current.map((user) => updatedUsers.find((updated) => updated.id === user.id) ?? user))
  }

  const handleGiveBadge = async () => {
    const label = badgeLabel.trim()
    if (!isCurrentUserAdmin || !label || isGivingBadge) {
      return
    }

    setIsGivingBadge(true)
    setBadgeFeedback('')
    const { error: pointsError } = await supabase
      .from('custom_badge_points')
      .upsert({ label, points: clampPoints(Number(badgePoints)) })
    if (pointsError) {
      console.error('Failed to save custom badge points:', pointsError)
      setBadgeFeedback('Could not save the badge points; badge not given.')
      setIsGivingBadge(false)
      return
    }
    setPointsRefresh((count) => count + 1)
    const targets = users.filter((user) => !user.deletion_pending_at && badgeRecipientIds.includes(user.id))
    const results = await Promise.all(
      targets.map(async (user) => {
        const badges = giveCustomBadge(label, user.badges)
        const { error } = await supabase.from('users').update({ badges }).eq('id', user.id)

        if (error) {
          console.error('Failed to give badge to user:', user.id, error)
          return null
        }

        return { id: user.id, badges }
      }),
    )
    const given = results.filter((result): result is { id: string; badges: string[] } => result !== null)

    setUsers((current) =>
      current.map((user) => {
        const updated = given.find((result) => result.id === user.id)
        return updated ? { ...user, badges: updated.badges } : user
      }),
    )
    setBadgeFeedback(
      given.length === targets.length
        ? `Gave "${label}" to ${given.length} user(s).`
        : `Gave "${label}" to ${given.length} of ${targets.length} user(s); the rest failed.`,
    )
    if (given.length > 0) {
      setBadgeLabel('')
      setBadgeRecipientIds([])
    }
    setIsGivingBadge(false)
  }

  const handleResetBadges = async () => {
    if (!isCurrentUserAdmin) {
      return
    }

    if (!window.confirm('Reset all badges and click counts for every user? This cannot be undone.')) {
      return
    }

    const targets = users.filter((user) => !user.deletion_pending_at)
    const results = await Promise.all(
      targets.map(async (user) => {
        const { error } = await supabase.from('users').update({ badges: [], click_count: 0 }).eq('id', user.id)

        if (error) {
          console.error('Failed to reset badges for user:', user.id, error)
        }

        return error ? null : user.id
      }),
    )
    const resetIds = new Set(results.filter((id): id is string => id !== null))

    setUsers((current) =>
      current.map((user) => (resetIds.has(user.id) ? { ...user, badges: [], click_count: 0 } : user)),
    )
  }

  const handleDeleteUser = async (userId: string) => {
    if (!isCurrentUserAdmin || userId === session?.user.id) {
      return
    }

    const targetUser = users.find((user) => user.id === userId)

    if (!targetUser) {
      return
    }

    setDeletionError('')
    setDeletionMessage('')
    if (isDevLoginEnabled()) {
      setDeletionError('Account deletion requires a real Supabase admin session, not development login.')
      return
    }

    const confirmed = window.confirm(
      `Permanently delete ${targetUser.name} (${targetUser.email})? Their login account, avatar, spooks, images, and karaoke entries will be deleted, and their tags removed from other spooks. This cannot be undone.`,
    )

    if (!confirmed) {
      return
    }

    setDeletingUserId(userId)
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { userId } })
      if (error) {
        let message = 'Deletion could not be confirmed. Refresh the user list and retry if the account remains.'
        if ('context' in error && error.context instanceof Response) {
          const body: unknown = await error.context.json().catch(() => null)
          if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
            message = body.error
          }
        }
        throw new Error(message)
      }
      if (!data || data.success !== true) {
        throw new Error('Deletion could not be confirmed. Refresh the user list before retrying.')
      }
      setUsers((current) => current.filter((user) => user.id !== userId))
      setDeletionMessage(`${targetUser.name}'s account and owned content were permanently deleted.`)
    } catch (error) {
      console.error('Account deletion did not complete:', error)
      setDeletionError(error instanceof Error ? error.message : 'Deletion could not be confirmed.')
    } finally {
      const { data, error } = await supabase.from('users').select('*').order('name', { ascending: true })
      if (error) {
        console.error('Failed to refresh users after deletion:', error)
        setDeletionError((message) => `${message ? `${message} ` : ''}The user list could not be refreshed. Reload before retrying.`)
      } else {
        setUsers((data ?? []) as UserProfile[])
      }
      setDeletingUserId(null)
    }
  }

  const handlePromoteSelfToAdmin = async () => {
    if (!session || hasAnyAdminUsers) {
      return
    }

    const { error } = await supabase.from('users').update({ is_admin: true }).eq('id', session.user.id)

    if (error) {
      console.error('Failed to promote self to initial admin:', error)
      return
    }

    setUsers((currentUsers) =>
      currentUsers.map((user) =>
        user.id === session.user.id ? { ...user, is_admin: true } : user,
      ),
    )
  }

  const updateUserProgress = (userId: string, nextCount: number, nextBadges: string[]) => {
    setUsers((currentUsers) =>
      currentUsers.map((user) =>
        user.id === userId ? { ...user, click_count: nextCount, badges: nextBadges } : user,
      ),
    )
  }

  const navItems: { key: View; label: string; icon: string }[] = [
    { key: 'spooks', label: 'Spooks', icon: '🎃' },
    { key: 'karaoke', label: 'Karaoke', icon: '🎤' },
    ...(isDevLoginEnabled() ? [] : [{ key: 'spookify' as const, label: 'Spookify', icon: '🎧' }]),
    { key: 'battlepass', label: 'Pass', icon: '🏆' },
    ...(hasVotes ? [{ key: 'poll' as const, label: 'Poll', icon: '🗳️' }] : []),
    ...(isCurrentUserAdmin ? [{ key: 'admin' as const, label: 'Admin', icon: '🛡️' }] : []),
  ]

  return (
    <div className="app-shell">
      {session && (
        <header className="app-header">
          <button type="button" className="app-brand" onClick={() => setView('clicker')}>
            Spookify
          </button>

          <nav className="header-nav">
            <button
              type="button"
              className={`nav-button${view === 'clicker' ? ' is-active' : ''}`}
              onClick={() => setView('clicker')}
            >
              Clicker
            </button>
            <button
              type="button"
              className={`nav-button${view === 'profile' ? ' is-active' : ''}`}
              onClick={() => setView('profile')}
            >
              Profile
            </button>
            <button
              type="button"
              className={`nav-button${view === 'users' ? ' is-active' : ''}`}
              onClick={() => setView('users')}
            >
              Users
            </button>
            <button
              type="button"
              className={`nav-button${view === 'spooks' ? ' is-active' : ''}`}
              onClick={() => setView('spooks')}
            >
              Spooks
            </button>
            <button
              type="button"
              className={`nav-button${view === 'karaoke' ? ' is-active' : ''}`}
              onClick={() => setView('karaoke')}
            >
              Karaoke
            </button>
            {!isDevLoginEnabled() && (
              <button
                type="button"
                className={`nav-button${view === 'spookify' ? ' is-active' : ''}`}
                onClick={() => setView('spookify')}
              >
                Spookify
              </button>
            )}
            <button
              type="button"
              className={`nav-button${view === 'battlepass' ? ' is-active' : ''}`}
              onClick={() => setView('battlepass')}
            >
              Pass
              {hasNewBadges && <span className="nav-dot" data-testid="pass-dot" aria-hidden="true" />}
            </button>
            {hasVotes && (
              <button
                type="button"
                className={`nav-button${view === 'poll' ? ' is-active' : ''}`}
                onClick={() => setView('poll')}
              >
                Poll
              </button>
            )}
            {isCurrentUserAdmin && (
              <button
                type="button"
                className={`nav-button nav-button--admin${view === 'admin' ? ' is-active' : ''}`}
                onClick={() => setView('admin')}
              >
                Admin
              </button>
            )}
            <button type="button" className="nav-button" onClick={handleLogout}>
              Logout
            </button>
          </nav>

          <AccountMenu
            name={currentUser?.name ?? null}
            avatarUrl={currentUser?.avatar_url ?? null}
            view={view}
            onNavigate={setView}
            onLogout={handleLogout}
          />
        </header>
      )}

      {!session ? (
        <Auth
          onDevLogin={() => {
            const devUser = getDevAdminUser()
            const devSession = getDevSession()

            if (!devUser || !devSession) {
              return
            }

            setSession(devSession)
            setAccountStatus('active')
            setUsers([
              {
                id: devUser.id,
                name: devUser.name,
                costume: devUser.costume,
                email: devUser.email,
                avatar_url: devUser.avatar_url,
                badges: devUser.badges,
                is_admin: devUser.is_admin,
                click_count: devUser.click_count,
              },
            ])
            setView('clicker')
          }}
        />
      ) : accountStatus !== 'active' ? (
        <section className="page-section">
          <h2>Account access</h2>
          <p role="alert">
            {accountStatus === 'checking' ? 'Checking your account...'
              : accountStatus === 'pending' ? 'Your account is pending permanent deletion. Changes and uploads are blocked.'
                : accountStatus === 'missing' ? 'Your account is no longer available. Sign out to continue.'
                  : 'Your account could not be checked. Changes are unavailable; refresh to retry.'}
          </p>
        </section>
      ) : view === 'clicker' ? (
        <Clicker
          userId={session.user.id}
          clickCount={currentUser?.click_count ?? 0}
          badges={currentUser?.badges ?? []}
          onProgress={(nextCount, nextBadges) => updateUserProgress(session.user.id, nextCount, nextBadges)}
        />
      ) : view === 'battlepass' ? (
        <BattlePass userId={session.user.id} badges={currentUser?.badges ?? []} progress={badgeProgress} />
      ) : view === 'admin' ? (
        <section className="page-section">
          <h2>Admin Panel</h2>

          {!isCurrentUserAdmin ? (
            <p>You do not have admin access.</p>
          ) : (
            <>
              <div className="card">
                <div className="row row--between">
                  <h3 style={{ margin: 0 }}>Badges</h3>
                  <div className="row">
                    <button type="button" onClick={handleRefreshBadges}>Refresh all badges</button>
                    <button type="button" onClick={handleResetBadges}>Reset all badges</button>
                  </div>
                </div>
              </div>

              <div className="card stack">
                <h3 style={{ margin: 0 }}>Give a badge</h3>
                <form
                  className="stack"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleGiveBadge()
                  }}
                >
                  <label htmlFor="custom-badge-label">Badge text</label>
                  <input
                    id="custom-badge-label"
                    type="text"
                    value={badgeLabel}
                    maxLength={CUSTOM_BADGE_MAX_LENGTH}
                    onChange={(event) => setBadgeLabel(event.target.value)}
                  />
                  <label htmlFor="custom-badge-points">Points (XP)</label>
                  <input
                    id="custom-badge-points"
                    type="number"
                    required
                    min={0}
                    max={MAX_BADGE_POINTS}
                    value={badgePoints}
                    onChange={(event) => setBadgePoints(event.target.value)}
                  />
                  <fieldset className="stack">
                    <legend>Users</legend>
                    {activeUsers.map((user) => (
                      <label key={user.id} className="row">
                        <input
                          type="checkbox"
                          checked={badgeRecipientIds.includes(user.id)}
                          onChange={() =>
                            setBadgeRecipientIds((current) =>
                              current.includes(user.id)
                                ? current.filter((id) => id !== user.id)
                                : [...current, user.id],
                            )
                          }
                        />
                        {user.name}
                      </label>
                    ))}
                  </fieldset>
                  <div className="row">
                    <button
                      type="button"
                      onClick={() =>
                        setBadgeRecipientIds(
                          badgeRecipientIds.length === activeUsers.length ? [] : activeUsers.map((user) => user.id),
                        )
                      }
                    >
                      {badgeRecipientIds.length === activeUsers.length ? 'Select none' : 'Select all'}
                    </button>
                    <button
                      type="submit"
                      disabled={isGivingBadge || !badgeLabel.trim() || badgePoints.trim() === '' || badgeRecipientIds.length === 0}
                    >
                      {isGivingBadge ? 'Giving...' : `Give badge to ${badgeRecipientIds.length} user(s)`}
                    </button>
                  </div>
                  {badgeFeedback && <p role="status">{badgeFeedback}</p>}
                </form>
              </div>

              <BadgePointsAdmin key={pointsRefresh} />

              <SignupCodes />
              <VotesAdmin />
            </>
          )}
        </section>
      ) : view === 'users' ? (
        <section className="page-section">
          <h2>Users</h2>
          {deletionError && <p role="alert">{deletionError}</p>}
          {deletionMessage && <p role="status">{deletionMessage}</p>}

          {!hasAnyAdminUsers && currentUser && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', border: '1px solid #3b3b3b', borderRadius: '10px' }}>
              <p style={{ margin: 0, marginBottom: '0.5rem' }}>
                No admins are assigned yet. Promote yourself to be the initial admin.
              </p>
              <button type="button" onClick={handlePromoteSelfToAdmin}>
                Make me the initial admin
              </button>
            </div>
          )}

          {loadingUsers ? (
            <p>Loading users...</p>
          ) : users.length === 0 ? (
            <p>No users found yet.</p>
          ) : (
            <ul className="list">
              {users.map((user) => {
                const showAllDetails = isCurrentUserAdmin

                return (
                  <li
                    key={user.id}
                    className="card user-card"
                  >
                    <div className="user-card-header">
                      <div className="row">
                        {user.avatar_url ? (
                          <img
                            src={user.avatar_url}
                            alt={`${user.name} avatar`}
                            className="avatar avatar--lg"
                          />
                        ) : (
                          <span className="avatar avatar--lg avatar--fallback">
                            {user.name.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        {renamingUserId === user.id ? (
                          <form className="row" onSubmit={(event) => handleRenameUser(event, user.id)}>
                            <input
                              aria-label={`Name for ${user.name}`}
                              value={renameDraft}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              autoFocus
                            />
                            <button type="submit" disabled={isRenaming}>
                              {isRenaming ? 'Saving...' : 'Save'}
                            </button>
                            <button type="button" disabled={isRenaming} onClick={() => setRenamingUserId(null)}>
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <strong>{user.name}</strong>
                        )}
                        {user.deletion_pending_at && <span className="pill">Deletion pending</span>}
                      </div>
                      {renamingUserId === user.id && renameError && (
                        <p role="alert" className="form-error">{renameError}</p>
                      )}
                      {showAllDetails && (
                        <span className={`pill${user.is_admin ? ' pill--admin' : ''}`}>
                          {user.is_admin ? 'Admin' : 'Member'}
                        </span>
                      )}
                    </div>

                    {!showAllDetails ? (
                      <div>{user.costume}</div>
                    ) : (
                      <>
                        <div>{user.costume}</div>
                        <div>{user.email}</div>
                        <div>Clicks: {user.click_count}</div>
                        <div>
                          Badges: {user.badges?.length ? user.badges.map(badgeDisplayName).join(', ') : 'None'}
                        </div>

                        <div className="row row--between">
                          <label htmlFor={`admin-${user.id}`} style={{ fontWeight: 600 }}>
                            Admin user
                          </label>
                          <input
                            id={`admin-${user.id}`}
                            type="checkbox"
                            checked={user.is_admin}
                            disabled={Boolean(user.deletion_pending_at) || deletingUserId !== null}
                            onChange={() => handleToggleAdmin(user.id, user.is_admin)}
                          />
                        </div>

                        {!user.deletion_pending_at && renamingUserId !== user.id && (
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingUserId(user.id)
                              setRenameDraft(user.name)
                              setRenameError('')
                            }}
                          >
                            Edit name
                          </button>
                        )}

                        {user.id !== session.user.id && (
                          <button type="button" disabled={deletingUserId !== null} onClick={() => handleDeleteUser(user.id)}>
                            {deletingUserId === user.id ? 'Deleting account...' : user.deletion_pending_at ? 'Retry permanent deletion' : 'Delete user permanently'}
                          </button>
                        )}
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ) : view === 'spooks' ? (
        <Spooks users={users} currentUserId={session.user.id} isAdmin={isCurrentUserAdmin} />
      ) : view === 'karaoke' ? (
        <Karaoke currentUserId={session.user.id} isCurrentUserAdmin={isCurrentUserAdmin} />
      ) : view === 'poll' ? (
        <Poll currentUserId={session.user.id} users={users} />
      ) : view === 'spookify' ? (
        <Spookify
          currentUserId={session.user.id}
          panel={route.panel}
          onPanelChange={(panel) => navigate(pathFor('spookify', panel))}
        />
      ) : (
        <section className="page-section">
          <h2>Profile</h2>

          <div className="card stack">
            <p>
              <strong>Name:</strong> {currentUser?.name ?? session.user.email}
            </p>
            <p>
              <strong>Costume:</strong> {currentUser?.costume ?? 'Not set'}
            </p>
            <p>
              <strong>Email:</strong> {currentUser?.email ?? session.user.email}
            </p>
            <p>
              <strong>Admin:</strong> {isCurrentUserAdmin ? 'Yes' : 'No'}
            </p>
            <p>
              <strong>Click count:</strong> {currentUser?.click_count ?? 0}
            </p>
            <p>
              <strong>Spookify score:</strong> {formatSpookifyScore(currentUser?.spookify_score)}
            </p>
            <p>
              <strong>Badges:</strong> {currentUser?.badges?.length ? currentUser.badges.join(', ') : 'None'}
            </p>

            {currentUser?.avatar_url ? (
              <img
                src={currentUser.avatar_url}
                alt="Profile avatar"
                className="profile-avatar"
              />
            ) : (
              <div className="profile-avatar profile-avatar--fallback">
                {currentUser?.name?.slice(0, 1)?.toUpperCase() ?? 'U'}
              </div>
            )}

            <label htmlFor="profile-avatar">
              Profile picture
            </label>
            <input id="profile-avatar" type="file" accept="image/*" onChange={handleAvatarUpload} />

            <form onSubmit={handleSaveProfile} className="stack">
              <label htmlFor="profile-name">
                Name
              </label>
              <input
                id="profile-name"
                type="text"
                value={profileDraft.name}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setProfileDraft((current) => ({ ...current, name: event.target.value }))
                  if (profileError) {
                    setProfileError('')
                  }
                  if (profileMessage) {
                    setProfileMessage('')
                  }
                }}
                placeholder="Your name"
              />

              <label htmlFor="profile-costume">
                Costume
              </label>
              <input
                id="profile-costume"
                type="text"
                value={profileDraft.costume}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setProfileDraft((current) => ({ ...current, costume: event.target.value }))
                  if (profileError) {
                    setProfileError('')
                  }
                  if (profileMessage) {
                    setProfileMessage('')
                  }
                }}
                placeholder="Your costume"
              />

              <label htmlFor="profile-email">
                Email
              </label>
              <input
                id="profile-email"
                type="email"
                value={profileDraft.email}
                readOnly
              />

              {profileError && <p role="alert" className="form-error">{profileError}</p>}
              {profileMessage && <p role="status" className="form-success">{profileMessage}</p>}

              <button type="submit" disabled={isSavingProfile}>
                {isSavingProfile ? 'Saving...' : 'Save profile'}
              </button>
            </form>

            <div className="row profile-actions">
              {isCurrentUserAdmin && (
                <button type="button" className="nav-button nav-button--admin profile-admin-link" onClick={() => setView('admin')}>
                  Admin panel
                </button>
              )}
              <button type="button" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        </section>
      )}

      {session && (
        <nav className="bottom-nav" aria-label="Primary">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`bottom-nav-button${view === item.key ? ' is-active' : ''}`}
              aria-current={view === item.key ? 'page' : undefined}
              onClick={() => setView(item.key)}
            >
              <span className="bottom-nav-icon" aria-hidden="true">
                {item.icon}
                {item.key === 'battlepass' && hasNewBadges && <span className="nav-dot" data-testid="pass-dot" />}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}

export default App
