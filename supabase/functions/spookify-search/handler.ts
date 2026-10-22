import { searchSpookifySongs, type SearchDependencies } from './core.ts'

export function createSearchHandler(deps: SearchDependencies, corsHeaders: Record<string, string>) {
  return async (request: Request): Promise<Response> => {
    const respond = (status: number, body: unknown) => Response.json(body, { status, headers: corsHeaders })
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (request.method !== 'POST') return respond(405, { error: 'Use POST.' })
    const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
    if (!bearer) return respond(401, { error: 'Authentication required.' })
    let query: string
    try {
      const body: unknown = await request.json()
      if (!body || typeof body !== 'object' || !('query' in body) || typeof body.query !== 'string') {
        return respond(400, { error: 'A search query is required.' })
      }
      query = body.query
    } catch {
      return respond(400, { error: 'A JSON request body is required.' })
    }
    const result = await searchSpookifySongs(bearer, query, deps)
    return respond(result.status, result.body)
  }
}
