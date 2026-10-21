import { describe, expect, it } from 'vitest'
import { deleteAccount, DeletionError, type DeletionDependencies } from '../../supabase/functions/delete-account/core'
import { createDeletionHandler } from '../../supabase/functions/delete-account/handler'

const actor = '00000000-0000-0000-0000-000000000001'
const target = '00000000-0000-0000-0000-000000000002'

function fixture() {
  const events: string[] = []
  let pending = false
  let files = [{ bucket_id: 'avatars', name: 'old-layout/avatar.jpg' }]
  const deps: DeletionDependencies = {
    verifyUser: async (token) => token === 'valid' ? actor : null,
    begin: async () => { events.push('pending'); pending = true },
    blockSignIn: async () => { events.push('block') },
    listFiles: async () => { events.push('list'); return files },
    removeFiles: async () => { events.push('remove'); files = [] },
    deleteAuth: async () => { events.push('auth') },
    assertFinished: async () => { events.push('finished') },
  }
  return { deps, events, isPending: () => pending }
}

describe('permanent account deletion server workflow', () => {
  it('rejects unauthenticated callers and server-side self deletion before starting cleanup', async () => {
    const { deps, events } = fixture()
    expect(await deleteAccount('invalid', target, deps)).toMatchObject({ status: 401 })
    expect(await deleteAccount('valid', actor, deps)).toMatchObject({ status: 403 })
    expect(events).toEqual([])
  })

  it('does not clean up when the database rejects a non-admin or pending admin', async () => {
    const { deps, events } = fixture()
    deps.begin = async () => { throw new DeletionError(403, 'Active admin required.') }
    expect(await deleteAccount('valid', target, deps)).toMatchObject({ status: 403, body: { pending: false } })
    expect(events).toEqual([])
  })

  it('marks pending before owned-file cleanup and deletes auth only after cleanup', async () => {
    const { deps, events } = fixture()
    expect(await deleteAccount('valid', target, deps)).toMatchObject({ status: 200, body: { success: true } })
    expect(events).toEqual(['pending', 'block', 'list', 'remove', 'list', 'auth', 'finished'])
  })

  it('keeps the blocked retry target on storage failure and safely retries partially removed files', async () => {
    const { deps, events, isPending } = fixture()
    const remove = deps.removeFiles
    deps.removeFiles = async (bucket, paths) => {
      await remove(bucket, paths)
      throw new Error('Network lost after deletion')
    }
    expect(await deleteAccount('valid', target, deps)).toMatchObject({
      status: 500, body: { pending: true, error: expect.stringContaining('storage cleanup') },
    })
    expect(isPending()).toBe(true)
    expect(events).not.toContain('auth')
    deps.removeFiles = remove
    expect(await deleteAccount('valid', target, deps)).toMatchObject({ status: 200 })
    expect(events.filter((event) => event === 'remove')).toHaveLength(1)
  })

  it('reports auth deletion and completion verification failures rather than false success', async () => {
    const { deps, isPending } = fixture()
    deps.deleteAuth = async () => { throw new Error('Auth unavailable') }
    expect(await deleteAccount('valid', target, deps)).toMatchObject({
      status: 500, body: { success: false, pending: true, error: expect.stringContaining('authentication deletion') },
    })
    expect(isPending()).toBe(true)
    deps.deleteAuth = async () => {}
    deps.assertFinished = async () => { throw new Error('Profile still exists') }
    expect(await deleteAccount('valid', target, deps)).toMatchObject({
      status: 500, body: { success: false, error: expect.stringContaining('completion verification') },
    })
  })

  it('bounds each invocation and leaves large cleanups available for another retry', async () => {
    const { deps } = fixture()
    deps.listFiles = async () => [{ bucket_id: 'spooks', name: 'remaining.jpg' }]
    deps.removeFiles = async () => {}
    expect(await deleteAccount('valid', target, deps)).toMatchObject({
      status: 409, body: { pending: true, error: expect.stringContaining('Retry') },
    })
  })

  it('handles browser preflight, validates input, and uses verified identity instead of a supplied actor', async () => {
    const { deps, events } = fixture()
    const handler = createDeletionHandler(deps, { 'Access-Control-Allow-Origin': '*' })
    const request = (method: string, body?: string, token = 'valid') => new Request('https://example.com/delete', {
      method, headers: { Authorization: `Bearer ${token}` }, body,
    })
    expect((await handler(request('OPTIONS'))).headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect((await handler(request('GET'))).status).toBe(405)
    expect((await handler(request('POST', '{}'))).status).toBe(400)
    expect((await handler(request('POST', 'bad json'))).status).toBe(400)
    expect((await handler(request('POST', JSON.stringify({ userId: target }), 'invalid'))).status).toBe(401)
    expect(events).toEqual([])
    deps.begin = async (id) => { expect(id).toBe(actor); events.push('pending') }
    expect((await handler(request('POST', JSON.stringify({ userId: target, actorId: target })))).status).toBe(200)
  })
})
