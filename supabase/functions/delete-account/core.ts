export type OwnedFile = { bucket_id: string; name: string }

export type DeletionDependencies = {
  verifyUser: (token: string) => Promise<string | null>
  begin: (actorId: string, targetId: string) => Promise<void>
  blockSignIn: (targetId: string) => Promise<void>
  listFiles: (targetId: string) => Promise<OwnedFile[]>
  removeFiles: (bucket: string, paths: string[]) => Promise<void>
  deleteAuth: (targetId: string) => Promise<void>
  assertFinished: (targetId: string) => Promise<void>
}

export class DeletionError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function deleteAccount(token: string, targetId: string, deps: DeletionDependencies) {
  let pending = false
  let phase = 'authorization'
  try {
    const actorId = await deps.verifyUser(token)
    if (!actorId) throw new DeletionError(401, 'Sign in again before deleting an account.')
    if (actorId === targetId) throw new DeletionError(403, 'You cannot delete your own account.')
    await deps.begin(actorId, targetId)
    pending = true
    phase = 'sign-in blocking'
    await deps.blockSignIn(targetId)
    phase = 'storage cleanup'
    // Always fetch the first remaining page: offsets skip files as earlier pages are removed.
    for (let batch = 0; ; batch++) {
      const files = await deps.listFiles(targetId)
      if (!files.length) break
      if (batch === 10) {
        throw new DeletionError(409, 'More files remain. Retry deletion to continue cleanup.')
      }
      for (const bucket of new Set(files.map((file) => file.bucket_id))) {
        await deps.removeFiles(bucket, files.filter((file) => file.bucket_id === bucket).map((file) => file.name))
      }
    }
    phase = 'authentication deletion'
    await deps.deleteAuth(targetId)
    phase = 'completion verification'
    await deps.assertFinished(targetId)
    return { status: 200, body: { success: true, pending: false } }
  } catch (error) {
    if (!(error instanceof DeletionError)) console.error(`Account deletion failed during ${phase}:`, error)
    return {
      status: error instanceof DeletionError ? error.status : 500,
      body: {
        success: false,
        pending,
        error: error instanceof DeletionError
          ? error.message
          : `Deletion ${pending ? 'incomplete' : 'failed'} during ${phase}. ${pending ? 'The account remains blocked; retry deletion.' : 'No deletion was confirmed. Refresh and try again.'}`,
      },
    }
  }
}
