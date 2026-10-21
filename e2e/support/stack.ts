import { execFileSync, spawnSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'

export const POD = 'spookify-e2e'
export const POSTGREST_PORT = 54330
export const API_PORT = 54331
export const JWT_SECRET = 'e2e-only-jwt-secret-0123456789-abcdefghijklmnop'

const podman = (args: string[], input?: string) =>
  execFileSync('podman', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

export const sql = (statement: string) =>
  podman(
    ['exec', '-i', `${POD}-db`, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|'],
    statement,
  ).trim()

const waitFor = async (what: string, check: () => boolean | Promise<boolean>, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

export const podmanAvailable = () => spawnSync('podman', ['info'], { stdio: 'ignore' }).status === 0

export const stopStack = () => {
  spawnSync('podman', ['pod', 'rm', '-f', POD], { stdio: 'ignore' })
}

export const startStack = async () => {
  stopStack()
  podman(['pod', 'create', '--name', POD, '-p', `${POSTGREST_PORT}:3000`])
  podman([
    'run', '-d', '--name', `${POD}-db`, '--pod', POD,
    '-e', 'POSTGRES_PASSWORD=e2e', '-e', 'POSTGRES_DB=postgres',
    'docker.io/library/postgres:16-alpine',
  ])
  await waitFor('postgres', () => sql('select 1') === '1')
  // The image restarts postgres once after init; wait until it is stable.
  await new Promise((resolve) => setTimeout(resolve, 3000))
  await waitFor('postgres (stable)', () => sql('select 1') === '1')

  sql(readFileSync('e2e/support/bootstrap.sql', 'utf8'))
  sql(readFileSync('supabase/schema.sql', 'utf8'))
  sql('grant all on all tables in schema public to authenticated, service_role')
  sql('grant execute on all functions in schema public to authenticated')

  podman([
    'run', '-d', '--name', `${POD}-rest`, '--pod', POD,
    '-e', 'PGRST_DB_URI=postgres://authenticator:e2e-authenticator@localhost:5432/postgres',
    '-e', 'PGRST_DB_SCHEMAS=public',
    '-e', 'PGRST_DB_ANON_ROLE=anon',
    '-e', `PGRST_JWT_SECRET=${JWT_SECRET}`,
    'docker.io/postgrest/postgrest:v12.2.3',
  ])
  await waitFor('postgrest', async () => (await fetch(`http://localhost:${POSTGREST_PORT}/`)).ok)

  return startApiProxy()
}

// supabase-js calls /rest/v1/*, PostgREST serves at the root.
const startApiProxy = () =>
  new Promise<http.Server>((resolve) => {
    const server = http.createServer((req, res) => {
      const cors = {
        'access-control-allow-origin': req.headers.origin ?? '*',
        'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*',
        'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'access-control-expose-headers': 'content-range',
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors).end()
        return
      }
      if (!req.url?.startsWith('/rest/v1')) {
        res.writeHead(404, cors).end('{}')
        return
      }
      const path = req.url.replace(/^\/rest\/v1/, '') || '/'
      const upstream = http.request(
        { host: 'localhost', port: POSTGREST_PORT, path, method: req.method, headers: { ...req.headers, host: 'localhost' } },
        (up) => {
          res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors })
          up.pipe(res)
        },
      )
      upstream.on('error', () => res.writeHead(502, cors).end('{}'))
      req.pipe(upstream)
    })
    server.listen(API_PORT, () => resolve(server))
  })

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

const mintToken = (userId: string, email: string) => {
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600
  const payload = b64({ sub: userId, email, role: 'authenticated', aud: 'authenticated', exp })
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
  return { token: `${header}.${payload}.${signature}`, exp }
}

export type TestUser = { id: string; email: string; name: string; costume: string }

export const seedUsers = (names: string[], adminName: string): TestUser[] => {
  sql("insert into public.signup_codes (code, seats) values ('E2E', 100) on conflict do nothing")
  const users = names.map((name) => ({
    id: randomUUID(),
    email: `${name.toLowerCase()}@e2e.test`,
    name,
    costume: `${name} costume`,
  }))
  for (const user of users) {
    const meta = JSON.stringify({ signup_code: 'E2E', name: user.name, costume: user.costume })
    sql(`insert into auth.users (id, email, raw_user_meta_data) values ('${user.id}', '${user.email}', '${meta}')`)
  }
  const admin = users.find((user) => user.name === adminName)
  if (admin) sql(`update public.users set is_admin = true where id = '${admin.id}'`)
  return users
}

export const sessionFor = (user: TestUser) => {
  const { token, exp } = mintToken(user.id, user.email)
  return {
    access_token: token,
    refresh_token: 'e2e-refresh',
    token_type: 'bearer',
    expires_in: 24 * 3600,
    expires_at: exp,
    user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' },
  }
}

export const AUTH_STORAGE_KEY = 'sb-localhost-auth-token'

export const voteTraces = () =>
  ['votes', 'vote_participation', 'vote_tallies', 'vote_winners']
    .map((table) => `${table}=${sql(`select count(*) from public.${table}`)}`)
    .join(', ')

export const NO_TRACES = 'votes=0, vote_participation=0, vote_tallies=0, vote_winners=0'
