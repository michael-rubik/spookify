import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDevAdminUser, getDevSession, isDevLoginEnabled } from './dev-login'

describe('dev login helper', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('enables the dev admin user when VITE_ENV is DEV', () => {
    vi.stubEnv('VITE_ENV', 'DEV')

    expect(isDevLoginEnabled()).toBe(true)
    expect(getDevAdminUser()).toMatchObject({
      id: 'dev-admin-user',
      name: 'Michael',
      costume: '👻*spooky ghost*',
      email: 'michael@spookify.dev',
      is_admin: true,
    })
    expect(getDevSession()).not.toBeNull()
  })

  it('disables the dev admin user outside DEV mode', () => {
    vi.stubEnv('VITE_ENV', 'PROD')

    expect(isDevLoginEnabled()).toBe(false)
    expect(getDevAdminUser()).toBeNull()
    expect(getDevSession()).toBeNull()
  })
})
