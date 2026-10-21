import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  auth: { getUser: vi.fn(), admin: { updateUserById: vi.fn(), deleteUser: vi.fn(), getUserById: vi.fn() } },
  storage: { from: vi.fn() },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => client }))

import { createDeletionDependencies } from '../../supabase/functions/delete-account/adapter.ts'
import { DeletionError } from '../../supabase/functions/delete-account/core.ts'

describe('account deletion adapter', () => {
  const deps = createDeletionDependencies('http://localhost', 'service-key')
  beforeEach(() => vi.resetAllMocks())

  it('maps begin errors to explicit statuses', async () => {
    client.rpc.mockResolvedValueOnce({ error: { code: '42501' } })
    await expect(deps.begin('a', 'b')).rejects.toMatchObject({ status: 403 })
    client.rpc.mockResolvedValueOnce({ error: { code: 'P0002' } })
    await expect(deps.begin('a', 'b')).rejects.toBeInstanceOf(DeletionError)
    client.rpc.mockResolvedValueOnce({ error: { code: 'XX000', message: 'boom' } })
    await expect(deps.begin('a', 'b')).rejects.toMatchObject({ message: 'boom' })
  })

  it('verifies tokens and returns null on failure', async () => {
    client.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'u' } }, error: null })
    expect(await deps.verifyUser('t')).toBe('u')
    client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad' } })
    expect(await deps.verifyUser('t')).toBeNull()
  })

  it('keeps sign-in blocking and storage failures retryable', async () => {
    client.auth.admin.updateUserById.mockResolvedValueOnce({ error: new Error('ban failed') })
    await expect(deps.blockSignIn('u')).rejects.toThrow('ban failed')
    client.storage.from.mockReturnValue({ remove: vi.fn().mockResolvedValue({ error: new Error('storage') }) })
    await expect(deps.removeFiles('avatars', ['x'])).rejects.toThrow('storage')
  })

  it('tolerates an already-deleted Auth user but not other errors', async () => {
    client.auth.admin.deleteUser.mockResolvedValueOnce({ error: { code: 'user_not_found' } })
    await expect(deps.deleteAuth('u')).resolves.toBeUndefined()
    client.auth.admin.deleteUser.mockResolvedValueOnce({ error: Object.assign(new Error('db'), { code: 'unexpected_failure' }) })
    await expect(deps.deleteAuth('u')).rejects.toThrow('db')
  })

  it('confirms completion only when profile and Auth user are gone', async () => {
    const profile = (row: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }) }) })
    client.from.mockReturnValueOnce(profile(null))
    client.auth.admin.getUserById.mockResolvedValueOnce({ data: { user: null }, error: { code: 'user_not_found' } })
    await expect(deps.assertFinished('u')).resolves.toBeUndefined()
    client.from.mockReturnValueOnce(profile({ id: 'u' }))
    await expect(deps.assertFinished('u')).rejects.toThrow('Profile still exists')
    client.from.mockReturnValueOnce(profile(null))
    client.auth.admin.getUserById.mockResolvedValueOnce({ data: { user: { id: 'u' } }, error: null })
    await expect(deps.assertFinished('u')).rejects.toThrow('Auth account still exists')
  })
})
