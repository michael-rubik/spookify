import type { Session } from '@supabase/supabase-js'

type DevAdminUser = {
  id: string
  name: string
  costume: string
  email: string
  avatar_url: string | null
  badges: string[]
  is_admin: boolean
  click_count: number
  signup_email_status: 'not_sent' | 'pending' | 'sent' | 'failed'
}

export const isDevLoginEnabled = () => String(import.meta.env.VITE_ENV ?? '').toUpperCase() === 'DEV'

export const getDevAdminUser = (): DevAdminUser | null => {
  if (!isDevLoginEnabled()) {
    return null
  }

  return {
    id: 'dev-admin-user',
    name: 'Michael',
    costume: '👻*spooky ghost*',
    email: 'michael@spookify.dev',
    avatar_url: null,
    badges: [],
    is_admin: true,
    click_count: 0,
    signup_email_status: 'sent',
  }
}

export const getDevSession = (): Session | null => {
  const devUser = getDevAdminUser()

  if (!devUser) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)

  return {
    access_token: 'dev-admin-access-token',
    refresh_token: 'dev-admin-refresh-token',
    expires_in: 3600,
    expires_at: now + 3600,
    token_type: 'bearer',
    user: {
      id: devUser.id,
      email: devUser.email,
      app_metadata: { provider: 'dev', providers: ['dev'] },
      user_metadata: {
        name: devUser.name,
        costume: devUser.costume,
      },
      aud: 'authenticated',
      created_at: new Date(0).toISOString(),
    },
  } as Session
}
