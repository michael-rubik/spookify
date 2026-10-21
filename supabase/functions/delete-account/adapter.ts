import { createClient } from '@supabase/supabase-js'
import { DeletionError, type DeletionDependencies, type OwnedFile } from './core.ts'

export function createDeletionDependencies(url: string, serviceKey: string): DeletionDependencies {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async verifyUser(token) {
      const { data, error } = await admin.auth.getUser(token)
      return error ? null : data.user?.id ?? null
    },
    async begin(actorId, targetId) {
      const { error } = await admin.rpc('begin_account_deletion', { actor_id: actorId, target_id: targetId })
      if (error?.code === '42501') throw new DeletionError(403, 'An active admin must delete another user.')
      if (error?.code === 'P0002') throw new DeletionError(404, 'User not found. Refresh the user list.')
      if (error) throw error
    },
    async listFiles(targetId) {
      const { data, error } = await admin.rpc('account_deletion_files', { target_id: targetId, batch_size: 100 })
      if (error) throw error
      if (!Array.isArray(data)) throw new Error('Storage discovery did not return a file list')
      return data as OwnedFile[]
    },
    async blockSignIn(targetId) {
      const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: '876000h' })
      if (error) throw error
    },
    async removeFiles(bucket, paths) {
      const { error } = await admin.storage.from(bucket).remove(paths)
      if (error) throw error
    },
    async deleteAuth(targetId) {
      const { error } = await admin.auth.admin.deleteUser(targetId, false)
      // Another authorized invocation may have completed the same pending deletion.
      if (error && error.code !== 'user_not_found') throw error
    },
    async assertFinished(targetId) {
      const { data: profile, error: profileError } = await admin.from('users').select('id').eq('id', targetId).maybeSingle()
      if (profileError) throw profileError
      if (profile) throw new Error('Profile still exists')
      const { data, error } = await admin.auth.admin.getUserById(targetId)
      if (error && error.code !== 'user_not_found') throw error
      if (data.user) throw new Error('Auth account still exists')
    },
  }
}
