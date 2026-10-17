import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './utils/supabase/supabase-client'
import './App.css'
import { Auth } from './components/auth'

type UserProfile = {
  id: string
  name: string
  costume: string
  email: string
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [view, setView] = useState<'profile' | 'users'>('profile')

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
      setLoadingUsers(true)

      const { data, error } = await supabase.from('users').select('*').order('name', { ascending: true })

      if (error) {
        console.error('Failed to load users:', error)
        setUsers([])
        setLoadingUsers(false)
        return
      }

      setUsers(data ?? [])
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
            <button type="button" onClick={() => setView('profile')}>
              Profile
            </button>
            <button type="button" onClick={() => setView('users')}>
              Users
            </button>
            <button type="button" onClick={handleLogout}>
              Logout
            </button>
          </nav>
        )}
      </header>

      {!session ? (
        <Auth />
      ) : view === 'users' ? (
        <section style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2>Users</h2>

          {loadingUsers ? (
            <p>Loading users...</p>
          ) : users.length === 0 ? (
            <p>No users found yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.75rem' }}>
              {users.map((user) => (
                <li
                  key={user.id}
                  style={{
                    border: '1px solid #2a2a2a',
                    borderRadius: '12px',
                    padding: '1rem',
                  }}
                >
                  <strong>{user.name}</strong>
                  <div>{user.costume}</div>
                  <div>{user.email}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2>Profile</h2>

          <div style={{ border: '1px solid #2a2a2a', borderRadius: '12px', padding: '1rem' }}>
            <p>
              <strong>Name:</strong> {currentUser?.name ?? session.user.email}
            </p>
            <p>
              <strong>Costume:</strong> {currentUser?.costume ?? 'Not set'}
            </p>
            <p>
              <strong>Email:</strong> {session.user.email}
            </p>
          </div>
        </section>
      )}
    </div>
  )
}

export default App
