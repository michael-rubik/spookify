import { deleteAccount, type DeletionDependencies } from './core.ts'

export function createDeletionHandler(deps: DeletionDependencies, corsHeaders: Record<string, string>) {
  return async (request: Request): Promise<Response> => {
    const respond = (status: number, body: unknown) => Response.json(body, { status, headers: corsHeaders })
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (request.method !== 'POST') return respond(405, { error: 'Use POST.' })
    const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
    if (!bearer) return respond(401, { error: 'Authentication required.' })
    let targetId: string
    try {
      const body: unknown = await request.json()
      if (!body || typeof body !== 'object' || !('userId' in body)
        || typeof body.userId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.userId)) {
        return respond(400, { error: 'A valid userId is required.' })
      }
      targetId = body.userId.toLowerCase()
    } catch {
      return respond(400, { error: 'A JSON request body is required.' })
    }
    const result = await deleteAccount(bearer, targetId, deps)
    return respond(result.status, result.body)
  }
}
