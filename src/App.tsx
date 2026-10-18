import { useEffect, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './utils/supabase/supabase-client'
import './App.css'
import { Auth } from './components/auth'
import { Clicker } from './components/clicker'

type UserProfile = {
  id: string
  name: string
  costume: string
  email: string
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
  const [view, setView] = useState<'clicker' | 'profile' | 'users' | 'admin'>('clicker')
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
      is_admin: false,
      click_count: 0,
      signup_email_status: 'not_sent',
    })

    if (insertError) {
      console.error('Failed to create current user profile:', insertError)
    }
  }

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

  useEffect(() => {
    if (!session) {
      setProfileDraft(emptyProfileDraft)
      setProfileError('')
      setProfileMessage('')
      return
    }

    setProfileDraft({
      name: currentUser?.name ?? session.user.email ?? '',
      costume: currentUser?.costume ?? '',
      email: currentUser?.email ?? session.user.email ?? '',
    })
    setProfileError('')
    setProfileMessage('')
  }, [session, currentUser])

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
      currentUsers.map((user) =>
        user.id === userId
          ? { ...user, click_count: nextCount }
          : user,
      ),
    )
  }

  return (
    <div style={{ minHeight: '100vh', padding: '2rem 1rem', fontFamily: 'sans-serif' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.75rem 1.25rem',
          borderBottom: '1px solid #2a2a2a',
          marginBottom: '2rem',
        }}
      >
        <h1 style={{ margin: 0 }}>Spookify</h1>

        {session && (
          <nav style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button type="button" onClick={() => setView('clicker')}>
              Clicker
            </button>
            <button type="button" onClick={() => setView('profile')}>
              Profile
            </button>
            <button type="button" onClick={() => setView('users')}>
              Users
            </button>
            {isCurrentUserAdmin && (
              <button
                type="button"
                onClick={() => setView('admin')}
                style={{
                  background: '#b42318',
                  color: '#fff',
                  border: '1px solid #b42318',
                  borderRadius: '8px',
                  padding: '0.5rem 0.8rem',
                }}
              >
                Admin
              </button>
            )}
            <button type="button" onClick={handleLogout}>
              Logout
            </button>
          </nav>
        )}
      </header>

      {!session ? (
        <Auth />
      ) : view === 'clicker' ? (
        <Clicker
          userId={session.user.id}
          clickCount={currentUser?.click_count ?? 0}
          onCountChange={(nextCount) => updateUserCount(session.user.id, nextCount)}
        />
      ) : view === 'admin' ? (
        <section style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2>Admin Panel</h2>

          {!isCurrentUserAdmin ? (
            <p>You do not have admin access.</p>
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1.5rem',
                }}
              >
                <div style={{ border: '1px solid #2a2a2a', borderRadius: '12px', padding: '1rem' }}>
                  <div style={{ color: '#aaa', fontSize: '0.8rem' }}>Pending logins</div>
                  <strong style={{ fontSize: '2rem' }}>{pendingLogins}</strong>
                </div>
                <div style={{ border: '1px solid #2a2a2a', borderRadius: '12px', padding: '1rem' }}>
                  <div style={{ color: '#aaa', fontSize: '0.8rem' }}>Email verification links sent</div>
                  <strong style={{ fontSize: '2rem' }}>{verificationLinksSent}</strong>
                </div>
              </div>

              <div style={{ border: '1px solid #2a2a2a', borderRadius: '12px', padding: '1rem' }}>
                <h3 style={{ marginTop: 0 }}>Signup tracking</h3>
                <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.75rem' }}>
                  {users.map((user) => (
                    <li key={user.id} style={{ borderBottom: '1px solid #2a2a2a', paddingBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                        <strong>{user.name}</strong>
                        <span style={{ fontSize: '0.8rem', color: '#ddd' }}>{signupStatusLabels[user.signup_email_status ?? 'not_sent']}</span>
                      </div>
                      <div style={{ color: '#bbb' }}>{user.email}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>
      ) : view === 'users' ? (
        <section style={{ maxWidth: '760px', margin: '0 auto' }}>
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
            <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.75rem' }}>
              {users.map((user) => {
                const showAllDetails = isCurrentUserAdmin
                const signupStatus = user.signup_email_status ?? 'not_sent'

                return (
                  <li
                    key={user.id}
                    style={{
                      border: '1px solid #2a2a2a',
                      borderRadius: '12px',
                      padding: '1rem',
                      display: 'grid',
                      gap: '0.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                      <strong>{user.name}</strong>
                      {showAllDetails && (
                        <span
                          style={{
                            borderRadius: '999px',
                            padding: '0.2rem 0.6rem',
                            background: user.is_admin ? '#2f5d42' : '#3b3b3b',
                            color: '#fff',
                            fontSize: '0.75rem',
                          }}
                        >
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

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
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

                        <label style={{ display: 'grid', gap: '0.35rem' }}>
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
      ) : (
        <section style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2>Profile</h2>

          <div style={{ border: '1px solid #2a2a2a', borderRadius: '12px', padding: '1rem', display: 'grid', gap: '0.75rem' }}>
            <p style={{ margin: 0 }}>
              <strong>Name:</strong> {currentUser?.name ?? session.user.email}
            </p>
            <p style={{ margin: 0 }}>
              <strong>Costume:</strong> {currentUser?.costume ?? 'Not set'}
            </p>
            <p style={{ margin: 0 }}>
              <strong>Email:</strong> {currentUser?.email ?? session.user.email}
            </p>
            <p style={{ margin: 0 }}>
              <strong>Admin:</strong> {isCurrentUserAdmin ? 'Yes' : 'No'}
            </p>
            <p style={{ margin: 0 }}>
              <strong>Click count:</strong> {currentUser?.click_count ?? 0}
            </p>

            {currentUser && (
              <p style={{ margin: 0 }}>
                <strong>Signup email status:</strong> {signupStatusLabels[currentUser.signup_email_status ?? 'not_sent']}
              </p>
            )}

            <form onSubmit={handleSaveProfile} style={{ display: 'grid', gap: '0.75rem' }}>
              <label htmlFor="profile-name" style={{ fontWeight: 600 }}>
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
                style={{ padding: '0.6rem 0.75rem' }}
              />

              <label htmlFor="profile-costume" style={{ fontWeight: 600 }}>
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
                style={{ padding: '0.6rem 0.75rem' }}
              />

              <label htmlFor="profile-email" style={{ fontWeight: 600 }}>
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
                style={{ padding: '0.6rem 0.75rem' }}
              />

              {profileError && <p role="alert" style={{ color: '#ffb4b4', margin: 0 }}>{profileError}</p>}
              {profileMessage && <p role="status" style={{ color: '#b7f7c7', margin: 0 }}>{profileMessage}</p>}

              <button type="submit" disabled={isSavingProfile}>
                {isSavingProfile ? 'Saving...' : 'Save profile'}
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  )
}

export default App
