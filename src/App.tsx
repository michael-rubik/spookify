import { useEffect, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './utils/supabase/supabase-client'
import { Auth } from './components/auth'
import { Clicker } from './components/clicker'
import { Karaoke } from './components/karaoke'
import { Spooks } from './components/spooks'
import { getUserBadges } from './utils/badges'

type UserProfile = {
  id: string
  name: string
  costume: string
  email: string
  avatar_url: string | null
  badges: string[]
  is_admin: boolean
  click_count: number
  signup_email_status: string | null
}

type ProfileDraft = {
  name: string
  costume: string
  email: string
}

const signupStatusLabels: Record<string, string> = {
  not_sent: 'Not sent',
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
}

const signupStatusOptions = Object.keys(signupStatusLabels)
const emptyProfileDraft: ProfileDraft = { name: '', costume: '', email: '' }

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [view, setView] = useState<'clicker' | 'profile' | 'users' | 'spooks' | 'karaoke' | 'admin'>('clicker')
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(emptyProfileDraft)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileMessage, setProfileMessage] = useState('')

  useEffect(() => {
    const loadSession = async () => {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession()
      setSession(currentSession)
    }

    loadSession()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession)
      setView(currentSession ? 'clicker' : 'clicker')
      if (!currentSession) {
        setUsers([])
      }
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  const ensureCurrentUserProfile = async (user: Session['user']) => {
    if (!user) {
      return
    }

    const nextName = (user.user_metadata?.name as string | undefined)?.trim() || user.email?.split('@')[0] || 'User'
    const nextCostume = (user.user_metadata?.costume as string | undefined)?.trim() || 'Unknown'
    const nextEmail = (user.email ?? '').trim()

    if (!nextEmail) {
      return
    }

    const { data: existingUser, error: lookupError } = await supabase
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()

    if (lookupError && lookupError.code !== 'PGRST116') {
      console.error('Failed to look up current user profile:', lookupError)
      return
    }

    if (existingUser) {
      return
    }

    const { error: insertError } = await supabase.from('users').insert({
      id: user.id,
      name: nextName,
      costume: nextCostume,
      email: nextEmail,
      avatar_url: null,
      badges: [],
      is_admin: false,
      click_count: 0,
      signup_email_status: 'not_sent',
    })

    if (insertError) {
      console.error('Failed to create current user profile:', insertError)
    }
  }

  useEffect(() => {
    if (!session) {
      return
    }

    const loadUsers = async () => {
      await ensureCurrentUserProfile(session.user)

      setLoadingUsers(true)

      const { data, error } = await supabase.from('users').select('*').order('name', { ascending: true })

      if (error) {
        console.error('Failed to load users:', error)
        setUsers([])
        setLoadingUsers(false)
        return
      }

      setUsers((data ?? []) as UserProfile[])
      setLoadingUsers(false)
    }

    loadUsers()
  }, [session])

  

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('Logout failed:', error)
    }
  }

  const currentUser = users.find((user) => user.id === session?.user.id) ?? null
  const isCurrentUserAdmin = Boolean(currentUser?.is_admin)
  const hasAnyAdminUsers = users.some((user) => user.is_admin)
  const pendingLogins = users.filter((user) => user.signup_email_status === 'pending' || user.signup_email_status === 'not_sent').length
  const verificationLinksSent = users.filter((user) => user.signup_email_status === 'sent').length


  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!session) {
      return
    }

    const nextName = profileDraft.name.trim()
    const nextCostume = profileDraft.costume.trim()
    const nextEmail = profileDraft.email.trim()

    if (!nextName || !nextCostume || !nextEmail) {
      setProfileError('Please fill in your name, costume, and email.')
      return
    }

    setIsSavingProfile(true)
    setProfileError('')
    setProfileMessage('')

    try {
      if (nextEmail !== (currentUser?.email ?? session.user.email ?? '')) {
        const { error: authUpdateError } = await supabase.auth.updateUser({ email: nextEmail })

        if (authUpdateError) {
          console.warn('Could not update auth email:', authUpdateError)
        }
      }

      const { data, error } = await supabase
        .from('users')
        .update({
          name: nextName,
          costume: nextCostume,
          email: nextEmail,
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
                email: savedUser?.email ?? nextEmail,
              }
            : user,
        ),
      )

      setProfileDraft({ name: nextName, costume: nextCostume, email: nextEmail })
      setProfileMessage('Profile saved successfully.')
    } catch (error) {
      console.error('Failed to save profile:', error)
      setProfileError('Could not save your profile. Please try again.')
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

  const handleRefreshBadges = async () => {
    if (!isCurrentUserAdmin) {
      return
    }

    const updatedUsers = users.map((user) => ({
      ...user,
      badges: getUserBadges(user.click_count, user.badges),
    }))

    await Promise.all(
      updatedUsers.map(async (user) => {
        const { error } = await supabase.from('users').update({ badges: user.badges }).eq('id', user.id)

        if (error) {
          console.error('Failed to refresh badges for user:', user.id, error)
        }
      }),
    )

    setUsers(updatedUsers)
  }

  const handleUpdateSignupStatus = async (userId: string, nextStatus: string) => {
    if (!isCurrentUserAdmin) {
      return
    }

    const { error } = await supabase.from('users').update({ signup_email_status: nextStatus }).eq('id', userId)

    if (error) {
      console.error('Failed to update signup email status:', error)
      return
    }

    setUsers((currentUsers) =>
      currentUsers.map((user) =>
        user.id === userId ? { ...user, signup_email_status: nextStatus } : user,
      ),
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

    const confirmed = window.confirm(`Delete ${targetUser.name}? This cannot be undone.`)

    if (!confirmed) {
      return
    }

    const { error } = await supabase.from('users').delete().eq('id', userId)

    if (error) {
      console.error('Failed to delete user:', error)
      return
    }

    setUsers((currentUsers) => currentUsers.filter((user) => user.id !== userId))
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

  const updateUserCount = (userId: string, nextCount: number) => {
    setUsers((currentUsers) =>
      currentUsers.map((user) => {
        if (user.id !== userId) {
          return user
        }

        const nextBadges = getUserBadges(nextCount, user.badges)

        return {
          ...user,
          click_count: nextCount,
          badges: nextBadges,
        }
      }),
    )

    void supabase
      .from('users')
      .update({
        click_count: nextCount,
        badges: getUserBadges(nextCount, users.find((user) => user.id === userId)?.badges ?? []),
      })
      .eq('id', userId)
  }

  const navItems: { key: typeof view; label: string; icon: string }[] = [
    { key: 'clicker', label: 'Clicker', icon: '👻' },
    { key: 'spooks', label: 'Spooks', icon: '🎃' },
    { key: 'karaoke', label: 'Karaoke', icon: '🎤' },
    { key: 'users', label: 'Users', icon: '🧟' },
    { key: 'profile', label: 'Profile', icon: '🎭' },
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
        </header>
      )}

      {!session ? (
        <Auth />
      ) : view === 'clicker' ? (
        <Clicker
          userId={session.user.id}
          clickCount={currentUser?.click_count ?? 0}
          onCountChange={(nextCount) => updateUserCount(session.user.id, nextCount)}
        />
      ) : view === 'admin' ? (
        <section className="page-section">
          <h2>Admin Panel</h2>

          {!isCurrentUserAdmin ? (
            <p>You do not have admin access.</p>
          ) : (
            <>
              <div className="stat-grid">
                <div className="card">
                  <div className="stat-label">Pending logins</div>
                  <strong className="stat-value">{pendingLogins}</strong>
                </div>
                <div className="card">
                  <div className="stat-label">Email verification links sent</div>
                  <strong className="stat-value">{verificationLinksSent}</strong>
                </div>
              </div>

              <div className="card">
                <div className="row row--between">
                  <h3 style={{ margin: 0 }}>Badge refresh</h3>
                  <button type="button" onClick={handleRefreshBadges}>Refresh all badges</button>
                </div>
              </div>

              <div className="card">
                <h3 style={{ marginTop: 0 }}>Signup tracking</h3>
                <ul className="list">
                  {users.map((user) => (
                    <li key={user.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                      <div className="row row--between">
                        <strong>{user.name}</strong>
                        <span className="muted" style={{ fontSize: '0.8rem' }}>{signupStatusLabels[user.signup_email_status ?? 'not_sent']}</span>
                      </div>
                      <div className="muted">{user.email}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>
      ) : view === 'users' ? (
        <section className="page-section">
          <h2>Users</h2>

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
                const signupStatus = user.signup_email_status ?? 'not_sent'

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
                        <strong>{user.name}</strong>
                      </div>
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
                          Badges: {user.badges?.length ? user.badges.join(', ') : 'None'}
                        </div>

                        <div className="row row--between">
                          <label htmlFor={`admin-${user.id}`} style={{ fontWeight: 600 }}>
                            Admin user
                          </label>
                          <input
                            id={`admin-${user.id}`}
                            type="checkbox"
                            checked={user.is_admin}
                            onChange={() => handleToggleAdmin(user.id, user.is_admin)}
                          />
                        </div>

                        <label className="stack" style={{ gap: '0.35rem' }}>
                          <span style={{ fontWeight: 600 }}>Signup email status</span>
                          <select
                            value={signupStatus}
                            onChange={(event) => handleUpdateSignupStatus(user.id, event.target.value)}
                          >
                            {signupStatusOptions.map((option) => (
                              <option key={option} value={option}>
                                {signupStatusLabels[option]}
                              </option>
                            ))}
                          </select>
                        </label>

                        {user.id !== session.user.id && (
                          <button type="button" onClick={() => handleDeleteUser(user.id)}>
                            Delete user
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
        <Spooks users={users} currentUserId={session.user.id} />
      ) : view === 'karaoke' ? (
        <Karaoke currentUserId={session.user.id} isCurrentUserAdmin={isCurrentUserAdmin} />
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

            {currentUser && (
              <p>
                <strong>Signup email status:</strong> {signupStatusLabels[currentUser.signup_email_status ?? 'not_sent']}
              </p>
            )}

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
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setProfileDraft((current) => ({ ...current, email: event.target.value }))
                  if (profileError) {
                    setProfileError('')
                  }
                  if (profileMessage) {
                    setProfileMessage('')
                  }
                }}
                placeholder="Your email"
              />

              {profileError && <p role="alert" className="form-error">{profileError}</p>}
              {profileMessage && <p role="status" className="form-success">{profileMessage}</p>}

              <button type="submit" disabled={isSavingProfile}>
                {isSavingProfile ? 'Saving...' : 'Save profile'}
              </button>
            </form>

            <div className="row profile-actions">
              {isCurrentUserAdmin && (
                <button type="button" className="nav-button nav-button--admin" onClick={() => setView('admin')}>
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
